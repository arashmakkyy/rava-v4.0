-- =====================================================================================
-- RAVA P0.3: Price verification atomicity + missing admin RPC.
-- Forward-only. Idempotent (IF NOT EXISTS / OR REPLACE / guarded DDL).
--
-- 1. Defines admin_increment_wallet (previously only in supabase/code/, never in
--    migrations) so fresh databases have it; service_role only.
-- 2. finalize_price_verification(report_id, verified, confidence): single-transaction
--    verdict + reward. Retry-safe: replays are no-ops, races collapse on PK/unique guards.
-- 3. Partial unique guard for price-verification ledger rows.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. Admin wallet RPC (moved into migrations from supabase/code/phase6_*).
--    DANGER: arbitrary target/amount — service_role only, called solely by Edge Functions.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_increment_wallet(
  target_user_id UUID,
  px_amount DECIMAL,
  px_xp_amount INTEGER,
  px_transaction_id UUID DEFAULT gen_random_uuid(),
  px_reward_type TEXT DEFAULT 'system_admin'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM reward_ledger WHERE transaction_id = px_transaction_id) THEN
    RETURN;
  END IF;

  INSERT INTO reward_ledger (transaction_id, user_id, amount, xp_amount, reward_type)
  VALUES (px_transaction_id, target_user_id, px_amount, px_xp_amount, px_reward_type);

  UPDATE profiles
  SET
    wallet_balance = wallet_balance + px_amount,
    xp_level = xp_level + px_xp_amount
  WHERE id = target_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_increment_wallet(uuid, numeric, integer, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_increment_wallet(uuid, numeric, integer, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.admin_increment_wallet(uuid, numeric, integer, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_increment_wallet(uuid, numeric, integer, uuid, text) TO service_role;

-- -------------------------------------------------------------------------------------
-- 2. Extra uniqueness rails for price-verification rewards (defense in depth;
--    the RPC below is already race-safe via the ledger PK on transaction_id).
-- -------------------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_price_verification_reward
  ON public.reward_ledger (user_id, reward_type, reference_id)
  WHERE reward_type = 'price_verification_success';

-- -------------------------------------------------------------------------------------
-- 2b. Anti-farming rails for price reports (server-derived, never client-derived).
--    Entitlement per (user, place, normalized item, server day); proof-hash
--    dedup per user; item mandatory. Backfills keep the migration re-runnable.
-- -------------------------------------------------------------------------------------
-- Order matters (historical rows must keep their own days):
--  1. ADD COLUMN with NO default (existing rows stay NULL, nothing collapses).
--  2. Backfill every row from its own created_at (unconditional = re-runnable).
--  3. Unique index creation then fails LOUDLY on real duplicates (explicit
--     cleanup, never silent merge).
--  4. Only afterwards: SET DEFAULT CURRENT_DATE + SET NOT NULL for new rows.
ALTER TABLE public.price_reports ADD COLUMN IF NOT EXISTS report_date DATE;
ALTER TABLE public.price_reports ADD COLUMN IF NOT EXISTS proof_hash TEXT;
-- Attempt accounting for the pre-AI claim gate (see claim_price_attempt below).
ALTER TABLE public.price_reports ADD COLUMN IF NOT EXISTS ai_calls_made INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.price_reports ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMP WITH TIME ZONE;

UPDATE public.price_reports SET report_date = created_at::date WHERE report_date IS NULL;
UPDATE public.price_reports SET item_name = '(unspecified)' WHERE item_name IS NULL OR btrim(item_name) = '';

ALTER TABLE public.price_reports ALTER COLUMN item_name SET NOT NULL;
ALTER TABLE public.price_reports ALTER COLUMN report_date SET DEFAULT CURRENT_DATE;
ALTER TABLE public.price_reports ALTER COLUMN report_date SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_price_report_entitlement
  ON public.price_reports (user_id, place_id, lower(btrim(item_name)), report_date);

CREATE UNIQUE INDEX IF NOT EXISTS uq_price_proof_per_user
  ON public.price_reports (user_id, proof_hash)
  WHERE proof_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_price_reports_status ON public.price_reports (ai_verification_status);

-- -------------------------------------------------------------------------------------
-- 2c. Atomic pre-AI attempt claim (the cost gate).
--    Called by verify-price BEFORE any Gemini traffic, in ONE transaction:
--     1. Locks the report row (FOR UPDATE): concurrent webhooks serialize here.
--     2. Non-pending rows are refused (retry of a final report = no-op).
--     3. A row already `processing` is refused UNLESS its lease went stale
--        (>10min: presumed crashed worker) — then it is reclaimed WITHOUT
--        consuming new quota (the crashed attempt already paid).
--     4. Fresh claims consume one unit of the user's DAILY AI-ATTEMPT quota
--        (independent of verification outcome: garbage burns quota too).
--        Over quota -> status 'capped', no AI allowed.
--    Reward entitlement (finalize_*) and attempt quota are DELIBERATELY separate
--    concepts sharing only this row's counters.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_price_attempt(
  px_report_id UUID,
  px_max_attempts_per_day INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row public.price_reports%ROWTYPE;
  v_used INTEGER;
  STALE_AFTER CONSTANT INTERVAL := '10 minutes';
BEGIN
  IF px_max_attempts_per_day IS NULL OR px_max_attempts_per_day <= 0 THEN
    RAISE EXCEPTION 'Invalid attempt cap';
  END IF;

  SELECT * INTO v_row FROM price_reports WHERE id = px_report_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REPORT_NOT_FOUND: %', px_report_id;
  END IF;

  -- Already final (verified/rejected/capped): never AI again.
  IF v_row.ai_verification_status IS DISTINCT FROM 'pending'
     AND v_row.ai_verification_status IS DISTINCT FROM 'processing' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not-pending', 'status', v_row.ai_verification_status);
  END IF;

  -- Concurrent duplicate: another worker holds a fresh lease.
  IF v_row.ai_verification_status = 'processing'
     AND v_row.processing_started_at IS NOT NULL
     AND v_row.processing_started_at > NOW() - STALE_AFTER THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'in-progress');
  END IF;

  -- Stale lease reclaim (crashed worker): resume WITHOUT new quota charge.
  IF v_row.ai_verification_status = 'processing' THEN
    UPDATE price_reports
    SET processing_started_at = NOW()
    WHERE id = px_report_id;
    RETURN jsonb_build_object('ok', true, 'resumed', true);
  END IF;

  -- Fresh claim: enforce the daily AI-attempt quota first.
  SELECT COUNT(*) INTO v_used
  FROM price_reports
  WHERE user_id = v_row.user_id
    AND created_at::date = CURRENT_DATE
    AND ai_calls_made > 0;

  IF v_used >= px_max_attempts_per_day THEN
    UPDATE price_reports
    SET ai_verification_status = 'capped'
    WHERE id = px_report_id AND ai_verification_status = 'pending';
    RETURN jsonb_build_object('ok', false, 'reason', 'capped');
  END IF;

  UPDATE price_reports
  SET ai_verification_status = 'processing',
      processing_started_at = NOW(),
      ai_calls_made = ai_calls_made + 1
  WHERE id = px_report_id;

  RETURN jsonb_build_object('ok', true, 'resumed', false);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_price_attempt(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_price_attempt(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.claim_price_attempt(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_price_attempt(uuid, integer) TO service_role;

-- -------------------------------------------------------------------------------------
-- 3. Atomic finalize: verdict + reward in ONE transaction.
--    Called ONLY by the verify-price Edge Function (service_role).
--    - Locks the report row (FOR UPDATE): concurrent invocations serialize.
--    - Non-pending rows are no-ops (retry of an already-finalized report).
--    - Ledger transaction_id = the report id itself (deterministic: UUID in, UUID out).
--    - Wallet credit + status transition commit atomically.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_price_verification(
  px_report_id UUID,
  px_verified BOOLEAN,
  px_confidence DECIMAL DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row public.price_reports%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM price_reports WHERE id = px_report_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REPORT_NOT_FOUND: %', px_report_id;
  END IF;

  IF v_row.ai_verification_status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'status', v_row.ai_verification_status);
  END IF;

  -- Server-derived entitlement date (never the client clock).
  IF v_row.report_date IS NULL THEN
    UPDATE price_reports SET report_date = CURRENT_DATE WHERE id = px_report_id;
    v_row.report_date := CURRENT_DATE;
  END IF;

  IF px_verified IS TRUE THEN
    BEGIN
      INSERT INTO reward_ledger (transaction_id, user_id, amount, xp_amount, reward_type, reference_id)
      VALUES (px_report_id, v_row.user_id, 0.5, 100, 'price_verification_success', px_report_id::TEXT);
    EXCEPTION WHEN unique_violation THEN
      -- Lost a race with a concurrent finalizer: adopt its outcome, reward once.
      UPDATE price_reports
      SET ai_verification_status = 'verified',
          ai_confidence_score = COALESCE(px_confidence, ai_confidence_score)
      WHERE id = px_report_id AND ai_verification_status = 'pending';
      RETURN jsonb_build_object('ok', true, 'idempotent', true, 'status', 'verified');
    END;

    UPDATE profiles
    SET
      wallet_balance = wallet_balance + 0.5,
      xp_level = xp_level + 100
    WHERE id = v_row.user_id;

    PERFORM unlock_xp_achievements(v_row.user_id);

    UPDATE price_reports
    SET ai_verification_status = 'verified',
        ai_confidence_score = COALESCE(px_confidence, ai_confidence_score)
    WHERE id = px_report_id;

    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'status', 'verified');
  ELSE
    UPDATE price_reports
    SET ai_verification_status = 'rejected',
        ai_confidence_score = COALESCE(px_confidence, ai_confidence_score)
    WHERE id = px_report_id;

    RETURN jsonb_build_object('ok', true, 'idempotent', false, 'status', 'rejected');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_price_verification(uuid, boolean, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_price_verification(uuid, boolean, numeric) FROM anon;
REVOKE ALL ON FUNCTION public.finalize_price_verification(uuid, boolean, numeric) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_price_verification(uuid, boolean, numeric) TO service_role;

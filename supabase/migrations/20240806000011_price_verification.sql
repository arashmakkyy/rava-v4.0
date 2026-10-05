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
-- 2d. Server-owned insert fields (BEFORE INSERT trigger).
--    RLS alone cannot stop a client from sending security-sensitive columns, so
--    the database itself forces them on every user-session insert:
--      user_id, report_date, created_at, ai_verification_status='pending',
--      ai_calls_made=0, proof_hash=NULL, processing_started_at=NULL.
--    Client supplies ONLY domain input: place_id, item_name, reported_price,
--    currency, proof_image_url. place_id + item_name are mandatory (canonical
--    identity; NULL would bypass the entitlement uniqueness).
--    Guarded by auth.uid() IS NOT NULL so service_role/internal writes pass
--    through untouched (service paths are trusted and have no user session).
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_price_report_authorship()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.user_id := auth.uid();
  NEW.report_date := CURRENT_DATE;
  NEW.created_at := NOW();
  NEW.ai_verification_status := 'pending';
  NEW.ai_calls_made := 0;
  NEW.proof_hash := NULL;
  NEW.processing_started_at := NULL;

  IF NEW.place_id IS NULL OR btrim(NEW.place_id) = '' THEN
    RAISE EXCEPTION 'PLACE_REQUIRED: price report needs a place';
  END IF;
  IF NEW.item_name IS NULL OR btrim(NEW.item_name) = '' THEN
    RAISE EXCEPTION 'ITEM_REQUIRED: price report needs an item';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_price_reports_authorship ON public.price_reports;
CREATE TRIGGER trg_price_reports_authorship
  BEFORE INSERT ON public.price_reports
  FOR EACH ROW EXECUTE FUNCTION public.enforce_price_report_authorship();

-- -------------------------------------------------------------------------------------
-- 2c. Atomic pre-AI attempt claim (the cost gate). NO policy parameters: the cap
--    is a server constant below, so no caller can override it.
--    Called by verify-price BEFORE any Gemini traffic, in ONE transaction:
--     1. Locks the report row (FOR UPDATE): concurrent webhooks serialize here.
--     2. Atomically reserves one unit of the user's DAILY AI-ATTEMPT quota via
--        the ai_usage counter row (upsert + FOR UPDATE + check + increment in the
--        SAME transaction as the report lock — parallel claims for DIFFERENT
--        reports serialize on the counter row, so N parallel requests grant at
--        most N=cap claims, never N+5).
--     3. Quota counts ATTEMPTS (garbage/rejected burns quota too), never outcomes.
--    Reward entitlement (finalize_*) and attempt quota are DELIBERATELY separate
--    concepts sharing only this row's counters.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_price_attempt(
  px_report_id UUID
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
  MAX_ATTEMPTS_PER_DAY CONSTANT INTEGER := 10;
BEGIN
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

  -- Fresh claim: atomically reserve one unit of the daily AI-attempt quota.
  INSERT INTO ai_usage (user_id, usage_date, price_attempts)
  VALUES (v_row.user_id, CURRENT_DATE, 0)
  ON CONFLICT (user_id, usage_date) DO NOTHING;

  SELECT price_attempts INTO v_used
  FROM ai_usage
  WHERE user_id = v_row.user_id AND usage_date = CURRENT_DATE
  FOR UPDATE;

  IF v_used >= MAX_ATTEMPTS_PER_DAY THEN
    UPDATE price_reports
    SET ai_verification_status = 'capped'
    WHERE id = px_report_id AND ai_verification_status = 'pending';
    RETURN jsonb_build_object('ok', false, 'reason', 'capped');
  END IF;

  UPDATE ai_usage
  SET price_attempts = price_attempts + 1, updated_at = NOW()
  WHERE user_id = v_row.user_id AND usage_date = CURRENT_DATE;

  UPDATE price_reports
  SET ai_verification_status = 'processing',
      processing_started_at = NOW(),
      ai_calls_made = ai_calls_made + 1
  WHERE id = px_report_id;

  RETURN jsonb_build_object('ok', true, 'resumed', false);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_price_attempt(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_price_attempt(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.claim_price_attempt(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_price_attempt(uuid) TO service_role;

-- -------------------------------------------------------------------------------------
-- 3. Atomic finalize: verdict + reward in ONE transaction.
--    Called ONLY by the verify-price Edge Function (service_role).
--    - Locks the report row (FOR UPDATE): concurrent invocations serialize.
--    - Claimed-first invariant: verified=TRUE (the only money path) REQUIRES
--      status='processing', i.e. a granted claim_price_attempt lease. An
--      unclaimed row can only ever be REJECTED (status write, never a reward),
--      so cheap rejection paths (empty item, duplicate proof) stay quota-free
--      without ever minting money.
--    - Terminal states (verified/rejected/capped) are idempotent no-ops:
--      webhook retries never double-reward.
--    - Ledger transaction_id = the report id itself (deterministic: UUID in, UUID out).
--    - Stuck 'processing' rows are reclaimable via claim_price_attempt's stale
--      lease rule; every finalize exits 'processing' one way or another.
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

  -- Terminal states: idempotent no-op, same result as the first finalize.
  IF v_row.ai_verification_status = 'verified'
     OR v_row.ai_verification_status = 'rejected'
     OR v_row.ai_verification_status = 'capped' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'status', v_row.ai_verification_status);
  END IF;

  -- Server-derived entitlement date (never the client clock).
  IF v_row.report_date IS NULL THEN
    UPDATE price_reports SET report_date = CURRENT_DATE WHERE id = px_report_id;
    v_row.report_date := CURRENT_DATE;
  END IF;

  IF px_verified IS TRUE THEN
    -- Money path: allowed ONLY from a claimed ('processing') row.
    IF v_row.ai_verification_status IS DISTINCT FROM 'processing' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'not-claimed', 'status', v_row.ai_verification_status);
    END IF;
    BEGIN
      INSERT INTO reward_ledger (transaction_id, user_id, amount, xp_amount, reward_type, reference_id)
      VALUES (px_report_id, v_row.user_id, 0.5, 100, 'price_verification_success', px_report_id::TEXT);
    EXCEPTION WHEN unique_violation THEN
      -- Lost a race with a concurrent finalizer: adopt its outcome, reward once.
      UPDATE price_reports
      SET ai_verification_status = 'verified',
          ai_confidence_score = COALESCE(px_confidence, ai_confidence_score)
      WHERE id = px_report_id AND ai_verification_status = 'processing';
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
    -- Rejection path: allowed from pending (cheap pre-AI rejects) or processing.
    -- Writes status only — never touches wallet.
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

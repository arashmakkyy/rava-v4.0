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
-- 2. Extra uniqueness rail for price-verification rewards (defense in depth;
--    the RPC below is already race-safe via the ledger PK on transaction_id).
-- -------------------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_price_verification_reward
  ON public.reward_ledger (user_id, reward_type, reference_id)
  WHERE reward_type = 'price_verification_success';

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

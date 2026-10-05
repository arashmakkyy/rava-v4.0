-- =====================================================================================
-- RAVA P0.4b: Live session leases — proportional, prepaid, non-refundable.
-- Forward-only. Idempotent.
--
-- Trust boundary (explicit, fail-closed):
--  - The browser NEVER calls lease RPCs directly. Flow is strictly:
--      browser -> mint-live-token Edge -> service-authorized RPCs below.
--  - acquire_live_lease takes a user id and trusts ONLY service_role callers.
--    No policy parameter comes from any client: duration cap, daily quota and
--    fuel rate are constants inside this file.
--  - Leases are PREPAID and NON-REFUNDABLE by design. There is deliberately NO
--    usage-based refund path callable with client-reported seconds: without
--    server-observed usage, any such refund is mint-free fuel. The single
--    exception is mint-failure AFTER debit, refunded by the minter itself via
--    refund_live_lease (service_role only, full amount, idempotent).
--
-- Invariant: live minutes obtainable NEVER exceed fuel actually held, even
-- under parallel mint requests (profile row is locked FOR UPDATE; reconnects
-- always acquire a NEW lease). Crash without close leaks at most one lease
-- cost (bounded, ledger-visible as live_lease).
--
-- Rate: 1 fuel-hour = 60 live-minutes. MIN 1 minute (dust denied), MAX 15.
-- =====================================================================================

CREATE TABLE IF NOT EXISTS public.live_leases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  minutes INTEGER NOT NULL,
  cost_hours DECIMAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'refunded')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.live_leases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own leases" ON public.live_leases;
CREATE POLICY "Users can view own leases"
  ON public.live_leases FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_live_leases_user_day
  ON public.live_leases (user_id, created_at DESC);

-- Policy constants are server-owned (baked into the function bodies below):
-- MAX 15 minutes per lease, 10 mints per user per day. No client input.

-- -------------------------------------------------------------------------------------
-- Acquire: balance gate + proportional minutes + upfront debit + quota, atomically.
-- Service-role callers only (the mint-live-token Edge Function). The target user
-- is an explicit parameter because service_role has no auth.uid() — the Edge
-- function validates the end-user JWT BEFORE calling, so identity is still bound
-- to a verified session, just one hop removed.
-- Returns { ok, lease_id, minutes, expires_at } or { ok:false, reason }.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acquire_live_lease(
  px_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid UUID := px_user_id;
  v_balance DECIMAL;
  v_lease_id UUID;
  v_minutes INTEGER;
  v_cost DECIMAL;
  v_mints_today INTEGER;
  v_expires_at TIMESTAMP WITH TIME ZONE;
  -- Server-owned policy (constants, never parameters).
  c_max_minutes CONSTANT INTEGER := 15;
  c_max_mints_per_day CONSTANT INTEGER := 10;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Lock the profile: parallel mints serialize here, so entitlements can never
  -- exceed the real balance.
  SELECT wallet_balance INTO v_balance
  FROM profiles
  WHERE id = v_uid
  FOR UPDATE;

  IF v_balance IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no-profile');
  END IF;

  v_minutes := LEAST(FLOOR(v_balance * 60)::INTEGER, c_max_minutes);
  IF v_minutes < 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient-fuel');
  END IF;

  SELECT COUNT(*) INTO v_mints_today
  FROM live_leases
  WHERE user_id = v_uid AND created_at::date = CURRENT_DATE;
  IF v_mints_today >= c_max_mints_per_day THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'quota-exceeded');
  END IF;

  v_cost := v_minutes::DECIMAL / 60.0;
  v_lease_id := gen_random_uuid();
  v_expires_at := NOW() + (v_minutes || ' minutes')::INTERVAL;

  INSERT INTO live_leases (id, user_id, minutes, cost_hours, status)
  VALUES (v_lease_id, v_uid, v_minutes, v_cost, 'open');

  UPDATE profiles
  SET wallet_balance = GREATEST(0, wallet_balance - v_cost)
  WHERE id = v_uid;

  INSERT INTO reward_ledger (transaction_id, user_id, amount, xp_amount, reward_type, reference_id)
  VALUES (v_lease_id, v_uid, -v_cost, 0, 'live_lease', v_lease_id::TEXT);

  RETURN jsonb_build_object(
    'ok', true,
    'lease_id', v_lease_id,
    'minutes', v_minutes,
    'expires_at', v_expires_at
  );
END;
$$;

-- -------------------------------------------------------------------------------------
-- Full refund, callable ONLY on the mint-failure path by the minter itself
-- (service_role). There is deliberately NO usage-based or client-driven refund:
-- without server-observed usage, any reported-seconds refund is mint-free fuel.
-- Idempotent: second and later calls are no-ops.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refund_live_lease(
  px_lease_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_lease public.live_leases%ROWTYPE;
BEGIN
  SELECT * INTO v_lease FROM live_leases WHERE id = px_lease_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown-lease');
  END IF;
  IF v_lease.status != 'open' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'status', v_lease.status);
  END IF;

  UPDATE profiles
  SET wallet_balance = wallet_balance + v_lease.cost_hours
  WHERE id = v_lease.user_id;

  INSERT INTO reward_ledger (transaction_id, user_id, amount, xp_amount, reward_type, reference_id)
  VALUES (gen_random_uuid(), v_lease.user_id, v_lease.cost_hours, 0, 'live_lease_refund', v_lease.id::TEXT);

  UPDATE live_leases
  SET status = 'refunded'
  WHERE id = px_lease_id;

  RETURN jsonb_build_object('ok', true, 'refunded_hours', v_lease.cost_hours);
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_live_lease(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.acquire_live_lease(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.acquire_live_lease(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_live_lease(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.refund_live_lease(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refund_live_lease(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.refund_live_lease(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.refund_live_lease(uuid) TO service_role;

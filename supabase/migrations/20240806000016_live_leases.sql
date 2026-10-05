-- =====================================================================================
-- RAVA P0.4b: Live session leases — proportional, reserved, reconcilable.
-- Forward-only. Idempotent.
--
-- Invariant: live minutes obtainable NEVER exceed fuel actually held, even
-- under parallel mint requests. Mechanism:
--  acquire_live_lease() locks the profile row (FOR UPDATE), computes affordable
--  minutes = floor(wallet_balance_hours * 60), debits the lease cost UP FRONT,
--  and records the lease. Reconnects always acquire a NEW lease (re-checked).
--  close_live_lease() refunds the unused portion (idempotent). Mint failure
--  refunds in full via the same path. Crash without close = bounded leak of at
--  most one lease cost (documented, auditable in reward_ledger as live_lease).
--
-- Rate: 1 fuel-hour = 60 live-minutes. MIN 1 minute (dust denied), MAX 15.
-- Daily mint quota enforced inside acquire (no separate check needed).
-- =====================================================================================

CREATE TABLE IF NOT EXISTS public.live_leases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  minutes INTEGER NOT NULL,
  cost_hours DECIMAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'refunded')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  closed_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.live_leases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own leases" ON public.live_leases;
CREATE POLICY "Users can view own leases"
  ON public.live_leases FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_live_leases_user_day
  ON public.live_leases (user_id, created_at DESC);

-- -------------------------------------------------------------------------------------
-- Acquire: balance gate + proportional minutes + upfront debit + quota, atomically.
-- Returns { ok, lease_id, minutes, expires_at } or { ok:false, reason }.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acquire_live_lease(
  px_max_minutes INTEGER DEFAULT 15,
  px_max_mints_per_day INTEGER DEFAULT 10
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_balance DECIMAL;
  v_lease_id UUID;
  v_minutes INTEGER;
  v_cost DECIMAL;
  v_mints_today INTEGER;
  v_expires_at TIMESTAMP WITH TIME ZONE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF px_max_minutes IS NULL OR px_max_minutes <= 0 THEN
    RAISE EXCEPTION 'Invalid lease length';
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

  v_minutes := LEAST(FLOOR(v_balance * 60)::INTEGER, px_max_minutes);
  IF v_minutes < 1 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient-fuel');
  END IF;

  SELECT COUNT(*) INTO v_mints_today
  FROM live_leases
  WHERE user_id = v_uid AND created_at::date = CURRENT_DATE;
  IF v_mints_today >= px_max_mints_per_day THEN
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
-- Close/reconcile: credit back the unused portion. Fully idempotent — second and
-- later calls are no-ops. Used on clean disconnect (actual seconds), on expiry,
-- and as a FULL refund (actual 0) when token minting fails after acquiring.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_live_lease(
  px_lease_id UUID,
  px_actual_seconds INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_lease public.live_leases%ROWTYPE;
  v_actual DECIMAL;
  v_refund DECIMAL;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_lease FROM live_leases WHERE id = px_lease_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown-lease');
  END IF;
  IF v_lease.user_id != v_uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not-owner');
  END IF;
  IF v_lease.status != 'open' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'status', v_lease.status);
  END IF;

  v_actual := GREATEST(0, COALESCE(px_actual_seconds, v_lease.minutes * 60)) / 3600.0;
  v_refund := GREATEST(0, v_lease.cost_hours - LEAST(v_actual, v_lease.cost_hours));

  IF v_refund > 0 THEN
    UPDATE profiles
    SET wallet_balance = wallet_balance + v_refund
    WHERE id = v_uid;

    INSERT INTO reward_ledger (transaction_id, user_id, amount, xp_amount, reward_type, reference_id)
    VALUES (gen_random_uuid(), v_uid, v_refund, 0, 'live_lease_refund', v_lease.id::TEXT);
  END IF;

  UPDATE live_leases
  SET status = 'closed', closed_at = NOW()
  WHERE id = px_lease_id;

  RETURN jsonb_build_object('ok', true, 'refunded_hours', v_refund);
END;
$$;

GRANT EXECUTE ON FUNCTION public.acquire_live_lease(integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_live_lease(uuid, integer) TO authenticated;

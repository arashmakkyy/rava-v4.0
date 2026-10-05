-- =====================================================================================
-- RAVA P0.1: Economy lockdown — server-authoritative wallet/XP/rewards.
-- Forward-only. Idempotent (IF NOT EXISTS / OR REPLACE / guarded DDL).
--
-- Closes:
--  1. Arbitrary mint via increment_wallet / increment_my_wallet (client-supplied amount+xp).
--  2. Direct UPDATE of profiles.wallet_balance / xp_level by the row owner.
--  3. Reward farming via fresh transaction_ids (server-derived entitlement per type).
--  4. Stamp rewards without presence (soft server-side geofence + daily cap).
--  5. Fake TopUp purchases (replaced by capped demo-credit RPC; UI relabeled separately).
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- 1. Revoke arbitrary-mint RPCs from client roles (kept for history; never called by app).
-- -------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.increment_wallet(uuid, numeric, integer, text) FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.increment_my_wallet(uuid, numeric, integer, text) FROM anon, authenticated, PUBLIC;
-- unlock hook is server-internal only (called via PERFORM inside other RPCs).
REVOKE ALL ON FUNCTION public.unlock_xp_achievements(uuid) FROM anon, authenticated, PUBLIC;

-- -------------------------------------------------------------------------------------
-- 2. Column-level protection: wallet/xp change only through SECURITY DEFINER RPCs.
--    Verified safe: no client code path updates these columns directly (only
--    current_city / semantic_profile / username / avatar_url / onboarding_completed).
-- -------------------------------------------------------------------------------------
REVOKE UPDATE (wallet_balance, xp_level) ON public.profiles FROM anon, authenticated, PUBLIC;

-- -------------------------------------------------------------------------------------
-- 3. Entitlement uniqueness (partial: only reward types with server-derived references).
--    deduct_fuel/usage rows intentionally excluded (free-text reasons repeat legitimately).
-- -------------------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_reward_entitlement
  ON public.reward_ledger (user_id, reward_type, reference_id)
  WHERE reward_type IN ('daily_itinerary', 'profile_complete', 'topup_demo');

-- -------------------------------------------------------------------------------------
-- 4. claim_reward v2 — server-derived entitlement.
--    Client sends (transaction_id, reward_type) ONLY. Reference/amounts are fixed here:
--      daily_itinerary  -> reference = server CURRENT_DATE, amounts fixed
--      profile_complete -> reference = 'profile_complete', eligible only if onboarding
--                          completed AND never rewarded before (dead path revived safely)
--      stamp / referral_bonus / achievement -> rejected (dedicated RPC paths own them)
--    Transport idempotency (tx id) AND entitlement idempotency (unique index +
--    explicit check + unique_violation trap) both hold; concurrent races
--    return idempotent:true instead of a second reward.
--    Legacy 3-arg overload delegates here and IGNORES the client reference
--    (zero-downtime deploy for already-shipped clients).
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_reward(
  px_transaction_id UUID,
  px_reward_type TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_fuel DECIMAL := 0;
  v_xp INTEGER := 0;
  v_ref TEXT := NULL;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  CASE px_reward_type
    WHEN 'daily_itinerary' THEN
      v_fuel := 0.05;
      v_xp := 75;
      v_ref := CURRENT_DATE::TEXT;
    WHEN 'profile_complete' THEN
      v_fuel := 0.2;
      v_xp := 100;
      v_ref := 'profile_complete';
      IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_uid AND onboarding_completed IS TRUE) THEN
        RAISE EXCEPTION 'NOT_ELIGIBLE: onboarding not completed';
      END IF;
    WHEN 'stamp' THEN
      RAISE EXCEPTION 'Use process_poi_visit for stamp rewards';
    WHEN 'referral_bonus' THEN
      RAISE EXCEPTION 'Use claim_referral for referral rewards';
    WHEN 'achievement' THEN
      RAISE EXCEPTION 'Achievements unlock via XP thresholds';
    ELSE
      RAISE EXCEPTION 'Unknown reward type: %', px_reward_type;
  END CASE;

  -- Transport-level idempotency first (retried outbox deliveries).
  IF EXISTS (SELECT 1 FROM reward_ledger WHERE transaction_id = px_transaction_id) THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'fuel', 0, 'xp', 0);
  END IF;

  -- Entitlement-level idempotency: explicit check for the common path plus a
  -- unique_violation trap for concurrent races (no ON CONFLICT inference needed).
  IF EXISTS (
    SELECT 1 FROM reward_ledger
    WHERE user_id = v_uid AND reward_type = px_reward_type AND reference_id = v_ref
  ) THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'fuel', 0, 'xp', 0);
  END IF;

  BEGIN
    INSERT INTO reward_ledger (transaction_id, user_id, amount, xp_amount, reward_type, reference_id)
    VALUES (px_transaction_id, v_uid, v_fuel, v_xp, px_reward_type, v_ref);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'fuel', 0, 'xp', 0);
  END;

  UPDATE profiles
  SET
    wallet_balance = wallet_balance + v_fuel,
    xp_level = xp_level + v_xp
  WHERE id = v_uid;

  PERFORM unlock_xp_achievements(v_uid);

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'fuel', v_fuel,
    'xp', v_xp,
    'reward_type', px_reward_type
  );
END;
$$;

-- Legacy 3-arg overload: keep callable during client rollout, ignore client reference.
CREATE OR REPLACE FUNCTION public.claim_reward(
  px_transaction_id UUID,
  px_reward_type TEXT,
  px_reference_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN public.claim_reward(px_transaction_id, px_reward_type);
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_reward(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_reward(uuid, text, text) TO authenticated;

-- -------------------------------------------------------------------------------------
-- 5. Demo credit (honest TopUp replacement until a real payment provider exists).
--    Fixed 0.5h + 100xp, once per server day. Clearly labeled 'topup_demo' in ledger.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_demo_credit(
  px_transaction_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_ref TEXT := CURRENT_DATE::TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF EXISTS (SELECT 1 FROM reward_ledger WHERE transaction_id = px_transaction_id) THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'fuel', 0, 'xp', 0);
  END IF;

  IF EXISTS (
    SELECT 1 FROM reward_ledger
    WHERE user_id = v_uid AND reward_type = 'topup_demo' AND reference_id = v_ref
  ) THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'fuel', 0, 'xp', 0, 'daily_cap', true);
  END IF;

  BEGIN
    INSERT INTO reward_ledger (transaction_id, user_id, amount, xp_amount, reward_type, reference_id)
    VALUES (px_transaction_id, v_uid, 0.5, 100, 'topup_demo', v_ref);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'fuel', 0, 'xp', 0, 'daily_cap', true);
  END;

  UPDATE profiles
  SET
    wallet_balance = wallet_balance + 0.5,
    xp_level = xp_level + 100
  WHERE id = v_uid;

  PERFORM unlock_xp_achievements(v_uid);

  RETURN jsonb_build_object('ok', true, 'idempotent', false, 'fuel', 0.5, 'xp', 100);
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_demo_credit(uuid) TO authenticated;

-- -------------------------------------------------------------------------------------
-- 6. process_poi_visit v2 — soft server-side geofence + daily cap.
--    - Canonical POI coordinates come from attractions (never from the client).
--    - If canonical coords exist AND client sent coords: require <= 200m.
--    - Google-only POIs (no canonical row): accepted, still daily-capped (soft model).
--    - Max 20 stamps per server day (mass-farming bound). Audit via stamps.created_at.
--    Legacy 4-arg overload delegates with NULL coords (pre-update clients keep working,
--    without the distance check — same trust level as before this migration).
-- -------------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.process_poi_visit(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.process_poi_visit(
  px_transaction_id UUID,
  px_place_id TEXT,
  px_place_name TEXT,
  px_city TEXT,
  px_lat float8 DEFAULT NULL,
  px_lng float8 DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_reward_fuel DECIMAL := 0.1;
  v_reward_xp INTEGER := 50;
  v_current_user UUID;
  v_canon GEOGRAPHY;
  v_today_count INTEGER;
BEGIN
  v_current_user := auth.uid();

  IF v_current_user IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: برای ثبت مهر باید لاگین باشی رفیق.';
  END IF;

  IF EXISTS (SELECT 1 FROM reward_ledger WHERE transaction_id = px_transaction_id) THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM stamps WHERE user_id = v_current_user AND place_id = px_place_id) THEN
    RETURN;
  END IF;

  -- Daily mass-farming bound (soft geofence companion).
  SELECT COUNT(*) INTO v_today_count
  FROM stamps
  WHERE user_id = v_current_user AND created_at::date = CURRENT_DATE;
  IF v_today_count >= 20 THEN
    RAISE EXCEPTION 'DAILY_LIMIT: سقف مهر امروز پر شده، فردا دوباره بیا.';
  END IF;

  -- Canonical coordinates from our own DB; client coords are only the *claim*.
  SELECT location INTO v_canon FROM attractions WHERE place_id = px_place_id;
  IF v_canon IS NOT NULL AND px_lat IS NOT NULL AND px_lng IS NOT NULL THEN
    IF ST_Distance(
      v_canon,
      ST_SetSRID(ST_MakePoint(px_lng, px_lat), 4326)::geography
    ) > 200 THEN
      RAISE EXCEPTION 'TOO_FAR: برای ثبت مهر باید نزدیک مکان باشی.';
    END IF;
  END IF;

  INSERT INTO stamps (user_id, place_id, place_name, city)
  VALUES (v_current_user, px_place_id, px_place_name, px_city);

  INSERT INTO reward_ledger (transaction_id, user_id, amount, xp_amount, reward_type, reference_id)
  VALUES (px_transaction_id, v_current_user, v_reward_fuel, v_reward_xp, 'stamp', px_place_id);

  UPDATE profiles
  SET
    wallet_balance = wallet_balance + v_reward_fuel,
    xp_level = xp_level + v_xp
  WHERE id = v_current_user;

  PERFORM unlock_xp_achievements(v_current_user);
END;
$$;

-- NOTE: the pre-P0.1 4-arg overload was dropped above; clients on the old build send
-- exactly 4 args. The new function has DEFAULT NULL on the new params, so old 4-arg
-- calls keep working (soft path, same trust as before). No separate wrapper needed.

GRANT EXECUTE ON FUNCTION public.process_poi_visit(uuid, text, text, text, float8, float8) TO authenticated;

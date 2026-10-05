-- =====================================================================================
-- RAVA P0.4: AI usage quotas — server-enforced cost boundary for Gemini.
-- Forward-only. Idempotent.
--
-- Tables/RPCs:
--  ai_usage(user_id, usage_date, live_mints, proxy_calls, price_attempts):
--    per-user daily counters for every AI-costing operation.
--  consume_live_mint(px_max_per_day): atomic check-and-increment for token minting.
--  consume_proxy_call(px_max_per_day): atomic check-and-increment for ai-complete calls.
--  (Price-attempt quota lives INSIDE claim_price_attempt (migration 11), sharing
--  this same table + row-lock pattern, because the report row lock and the
--  counter lock must be held in ONE transaction.)
-- Writes happen ONLY inside these SECURITY DEFINER RPCs (no client INSERT policy),
-- so quota cannot be bypassed or reset from the browser.
-- =====================================================================================

CREATE TABLE IF NOT EXISTS public.ai_usage (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
  live_mints INTEGER NOT NULL DEFAULT 0,
  proxy_calls INTEGER NOT NULL DEFAULT 0,
  price_attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (user_id, usage_date)
);

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own AI usage" ON public.ai_usage;
CREATE POLICY "Users can view own AI usage"
  ON public.ai_usage FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_ai_usage_date ON public.ai_usage (usage_date);

-- -------------------------------------------------------------------------------------
-- Atomic quota consumption. Returns true when the call is within quota (and counted),
-- false when the daily cap is already reached. Concurrent callers serialize on the row.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_live_mint(px_max_per_day INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_count INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF px_max_per_day IS NULL OR px_max_per_day <= 0 THEN
    RAISE EXCEPTION 'Invalid quota cap';
  END IF;

  INSERT INTO ai_usage (user_id, usage_date, live_mints, proxy_calls)
  VALUES (v_uid, CURRENT_DATE, 0, 0)
  ON CONFLICT (user_id, usage_date) DO NOTHING;

  SELECT live_mints INTO v_count
  FROM ai_usage
  WHERE user_id = v_uid AND usage_date = CURRENT_DATE
  FOR UPDATE;

  IF v_count >= px_max_per_day THEN
    RETURN FALSE;
  END IF;

  UPDATE ai_usage
  SET live_mints = live_mints + 1, updated_at = NOW()
  WHERE user_id = v_uid AND usage_date = CURRENT_DATE;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_proxy_call(px_max_per_day INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_count INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF px_max_per_day IS NULL OR px_max_per_day <= 0 THEN
    RAISE EXCEPTION 'Invalid quota cap';
  END IF;

  INSERT INTO ai_usage (user_id, usage_date, live_mints, proxy_calls)
  VALUES (v_uid, CURRENT_DATE, 0, 0)
  ON CONFLICT (user_id, usage_date) DO NOTHING;

  SELECT proxy_calls INTO v_count
  FROM ai_usage
  WHERE user_id = v_uid AND usage_date = CURRENT_DATE
  FOR UPDATE;

  IF v_count >= px_max_per_day THEN
    RETURN FALSE;
  END IF;

  UPDATE ai_usage
  SET proxy_calls = proxy_calls + 1, updated_at = NOW()
  WHERE user_id = v_uid AND usage_date = CURRENT_DATE;

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_live_mint(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_proxy_call(integer) TO authenticated;

-- -------------------------------------------------------------------------------------
-- Ticket processing receipts + ATOMIC pre-AI claim state machine.
-- Same (user, image_path) reprocessed → the ORIGINAL trip is returned without a
-- new Gemini call and without a new timeline row. Daily volume is bounded.
--
-- States: processing -> completed | failed (retryable) | failed_terminal.
-- The claim RPC below is the ONLY writer of these transitions (service_role),
-- fully serialized per user via an advisory lock, so parallel same-ticket
-- requests collapse to exactly ONE Gemini call by construction.
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ticket_receipts (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  image_path TEXT NOT NULL,
  trip_id UUID REFERENCES public.trips(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'completed', 'failed', 'failed_terminal')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (user_id, image_path)
);

ALTER TABLE public.ticket_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own ticket receipts" ON public.ticket_receipts;
CREATE POLICY "Users can view own ticket receipts"
  ON public.ticket_receipts FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_ticket_receipts_day
  ON public.ticket_receipts (user_id, created_at DESC);

-- -------------------------------------------------------------------------------------
-- claim_ticket_attempt: the single atomic gate before ANY ticket Gemini call.
-- Serializes per user (advisory lock), then in one transaction:
--  1. Daily quota: receipts created today >= cap -> 'capped' (no AI).
--  2. No receipt -> INSERT processing (attempts=1) + mint the trip UUID the Edge
--     MUST use (idempotent trip insert downstream) -> {allowed:true}.
--  3. Completed receipt -> {allowed:false, duplicate:true, trip_id}.
--  4. Fresh processing lease -> {allowed:false, reason:'in-progress'}.
--  5. Stale/failed receipt -> cooldown (1h) + retry cap (3): exceed either ->
--     'failed_terminal' (refuse) or reclaim with the SAME trip_id.
-- Failed AI processing is recorded by the Edge via fail_ticket_attempt().
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_ticket_attempt(
  px_user_id UUID,
  px_image_path TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_rec public.ticket_receipts%ROWTYPE;
  v_today_count INTEGER;
  v_trip_id UUID;
  MAX_PER_DAY CONSTANT INTEGER := 20;
  MAX_ATTEMPTS CONSTANT INTEGER := 3;
  COOLDOWN CONSTANT INTERVAL := '1 hour';
  STALE_AFTER CONSTANT INTERVAL := '10 minutes';
BEGIN
  IF px_user_id IS NULL OR px_image_path IS NULL OR btrim(px_image_path) = '' THEN
    RAISE EXCEPTION 'Invalid claim identity';
  END IF;

  -- Serialize this user's ticket claims: quota + claim become atomic.
  PERFORM pg_advisory_xact_lock(hashtext('ticket:' || px_user_id::TEXT));

  SELECT COUNT(*) INTO v_today_count
  FROM ticket_receipts
  WHERE user_id = px_user_id AND created_at::date = CURRENT_DATE;
  IF v_today_count >= MAX_PER_DAY THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'capped');
  END IF;

  SELECT * INTO v_rec FROM ticket_receipts
  WHERE user_id = px_user_id AND image_path = px_image_path
  FOR UPDATE;

  IF NOT FOUND THEN
    v_trip_id := gen_random_uuid();
    INSERT INTO ticket_receipts (user_id, image_path, trip_id, status, attempts, last_attempt_at)
    VALUES (px_user_id, px_image_path, v_trip_id, 'processing', 1, NOW());
    RETURN jsonb_build_object('ok', true, 'resumed', false, 'trip_id', v_trip_id);
  END IF;

  IF v_rec.status = 'completed' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'duplicate', 'trip_id', v_rec.trip_id);
  END IF;

  IF v_rec.status = 'failed_terminal' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'failed-terminal');
  END IF;

  -- 'processing' or retryable 'failed': fresh lease -> another worker is inside.
  IF v_rec.status = 'processing'
     AND v_rec.last_attempt_at IS NOT NULL
     AND v_rec.last_attempt_at > NOW() - STALE_AFTER THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'in-progress');
  END IF;

  -- Stale/failed: cooldown + bounded retries, SAME trip_id (idempotent insert).
  IF v_rec.attempts >= MAX_ATTEMPTS THEN
    UPDATE ticket_receipts SET status = 'failed_terminal' WHERE user_id = px_user_id AND image_path = px_image_path;
    RETURN jsonb_build_object('ok', false, 'reason', 'failed-terminal');
  END IF;
  IF v_rec.last_attempt_at IS NOT NULL AND v_rec.last_attempt_at > NOW() - COOLDOWN THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cooldown');
  END IF;

  UPDATE ticket_receipts
  SET status = 'processing', attempts = v_rec.attempts + 1, last_attempt_at = NOW()
  WHERE user_id = px_user_id AND image_path = px_image_path;

  RETURN jsonb_build_object('ok', true, 'resumed', true, 'trip_id', v_rec.trip_id);
END;
$$;

-- fail_ticket_attempt: records a failed AI/download processing step.
-- Keeps the SAME trip_id so the next reclaim inserts idempotently.
CREATE OR REPLACE FUNCTION public.fail_ticket_attempt(
  px_user_id UUID,
  px_image_path TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  UPDATE ticket_receipts
  SET status = 'failed', last_attempt_at = NOW()
  WHERE user_id = px_user_id AND image_path = px_image_path AND status = 'processing';
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- complete_ticket_attempt: marks success with the final trip id.
CREATE OR REPLACE FUNCTION public.complete_ticket_attempt(
  px_user_id UUID,
  px_image_path TEXT,
  px_trip_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  UPDATE ticket_receipts
  SET status = 'completed', trip_id = px_trip_id, last_attempt_at = NOW()
  WHERE user_id = px_user_id AND image_path = px_image_path;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_ticket_attempt(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_ticket_attempt(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.claim_ticket_attempt(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ticket_attempt(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.fail_ticket_attempt(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_ticket_attempt(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.fail_ticket_attempt(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fail_ticket_attempt(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.complete_ticket_attempt(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_ticket_attempt(uuid, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.complete_ticket_attempt(uuid, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.complete_ticket_attempt(uuid, text, uuid) TO service_role;

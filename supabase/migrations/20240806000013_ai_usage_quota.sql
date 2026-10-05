-- =====================================================================================
-- RAVA P0.4: AI usage quotas — server-enforced cost boundary for Gemini.
-- Forward-only. Idempotent.
--
-- Tables/RPCs:
--  ai_usage(user_id, usage_date, live_mints, proxy_calls): per-user daily counters.
--  consume_live_mint(px_max_per_day): atomic check-and-increment for token minting.
--  consume_proxy_call(px_max_per_day): atomic check-and-increment for ai-complete calls.
-- Writes happen ONLY inside these SECURITY DEFINER RPCs (no client INSERT policy),
-- so quota cannot be bypassed or reset from the browser.
-- =====================================================================================

CREATE TABLE IF NOT EXISTS public.ai_usage (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
  live_mints INTEGER NOT NULL DEFAULT 0,
  proxy_calls INTEGER NOT NULL DEFAULT 0,
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
-- Ticket processing receipts: duplicate/reprocessing policy for process-ticket.
-- Same (user, image_path) reprocessed → the ORIGINAL trip is returned without a
-- new Gemini call and without a new timeline row. Daily volume is bounded by
-- counting receipts (no separate counter needed).
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ticket_receipts (
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  image_path TEXT NOT NULL,
  trip_id UUID REFERENCES public.trips(id) ON DELETE SET NULL,
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

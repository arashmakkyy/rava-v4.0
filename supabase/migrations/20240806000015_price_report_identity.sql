-- =====================================================================================
-- RAVA P0.5: PriceWatch subject identity — explicit, not accidental.
-- Forward-only. Idempotent.
--
-- Problem: price_reports.place_id carried a FK to places_cache(place_id), but the
-- UI submits the APP-VISIBLE poi id: a curated attractions.place_id (including
-- rava_syn_*) or a Google place id for non-curated POIs. Neither reliably lives
-- in places_cache, so legitimate curated reports failed on FK violation.
--
-- Resolved semantics (documented, not just dropped):
--  price_reports.place_id = the POI identity exactly as the user saw it.
--  Readers distinguish kinds with:
--    LEFT JOIN attractions a
--      ON r.place_id = a.place_id OR r.place_id = a.google_place_id
--  AI photo verification (not the FK) is the source of truth for payout.
-- =====================================================================================

DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT conname INTO v_conname
  FROM pg_constraint
  WHERE conrelid = 'public.price_reports'::regclass
    AND contype = 'f'
    AND pg_get_constraintdef(oid) ILIKE '%REFERENCES%places_cache%';

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.price_reports DROP CONSTRAINT %I', v_conname);
    RAISE NOTICE 'Dropped FK constraint % on price_reports', v_conname;
  ELSE
    RAISE NOTICE 'No places_cache FK found on price_reports; nothing to drop.';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_price_reports_place ON public.price_reports (place_id);

COMMENT ON COLUMN public.price_reports.place_id IS
  'App-visible POI identity (curated attractions.place_id incl. rava_syn_*, or Google place id). Join attractions on place_id OR google_place_id.';

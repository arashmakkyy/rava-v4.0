-- =====================================================================================
-- RAVA B2: Places identity — stable internal PK + external Google Place ID.
-- Forward-only. Idempotent.
--
-- Identity model (locked):
--  attractions.place_id (TEXT PK) is the INTERNAL identity. Stamps, favorites,
--  narratives and all client code reference it and MUST NOT be rewritten.
--  attractions.google_place_id is the EXTERNAL Google Places (New) identifier,
--  filled by scripts/fetch_places.mjs matching. Legacy synthetic rows
--  (rava_syn_*) keep their PK forever; matching only fills google_place_id
--  plus fresh coordinates/ratings — Persian names/descriptions are never
--  overwritten by the refresh pipeline.
-- =====================================================================================

ALTER TABLE public.attractions
  ADD COLUMN IF NOT EXISTS google_place_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_attractions_google_place_id
  ON public.attractions (google_place_id)
  WHERE google_place_id IS NOT NULL;

COMMENT ON COLUMN public.attractions.google_place_id IS
  'External Google Places ID resolved by fetch_places matching. Internal PK (place_id) stays stable.';

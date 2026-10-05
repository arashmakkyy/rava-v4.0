-- =====================================================================================
-- RAVA P0.5: Footprint visibility — own pending rows are readable.
-- Forward-only. Idempotent.
--
-- Product rule: a user must always see their OWN footprints (even while
-- moderation is pending) plus all verified public ones. The RLS SELECT policy
-- already allows this (is_verified OR own row); this RPC was stricter than the
-- policy and hid own pending rows. Fixed here with explicit ownership +
-- verification flags so the UI can render pending state distinctly.
-- =====================================================================================

CREATE OR REPLACE FUNCTION public.get_nearby_footprints(
  px_lat float8,
  px_lng float8,
  px_radius float8 DEFAULT 2000
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  lat float8,
  lng float8,
  user_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE,
  is_verified BOOLEAN,
  is_mine BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    f.id,
    f.content,
    ST_Y(f.location::geometry) AS lat,
    ST_X(f.location::geometry) AS lng,
    p.username AS user_name,
    f.created_at,
    f.is_verified AS is_verified,
    (f.user_id = auth.uid()) AS is_mine
  FROM footprints f
  JOIN profiles p ON f.user_id = p.id
  WHERE
    ST_DWithin(
      f.location,
      ST_SetSRID(ST_MakePoint(px_lng, px_lat), 4326),
      px_radius
    )
    AND (f.is_verified = TRUE OR f.user_id = auth.uid())
  ORDER BY f.created_at DESC
  LIMIT 200;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_nearby_footprints(double precision, double precision, double precision) TO anon, authenticated;

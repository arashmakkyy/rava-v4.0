
/**
 * محاسبه فاصله بین دو نقطه جغرافیایی بر حسب متر (فرمول Haversine)
 */
export const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371e3; // شعاع زمین به متر
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
};

export const isWithinRadius = (lat1: number, lon1: number, lat2: number, lon2: number, radiusMeters: number = 100): boolean => {
  const distance = calculateDistance(lat1, lon1, lat2, lon2);
  return distance <= radiusMeters;
};

/**
 * Strict coordinate validity for map markers.
 * Rejects anything that is not a finite, in-range, non-null-island pair:
 * undefined/null/''/NaN/±Infinity/out-of-range lat/lng, and (0,0).
 * Markers must NEVER receive unvalidated data — AdvancedMarker throws
 * (not skips) on bad positions and can take the whole map subtree down.
 */
export const isValidLatLng = (lat: unknown, lng: unknown): lat is number => {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
};

/**
 * Routes-library navigation for Rava (Google Maps JavaScript, current API).
 *
 * Uses `google.maps.routes.Route.computeRoutes` (importLibrary "routes") —
 * the supported replacement for the deprecated DirectionsService/DistanceMatrix
 * JavaScript services. Single client-side path: no Edge Function needed because
 * routing requires no secret, no quota pooling and no caching on our side.
 *
 * Public interface (RouteResult) is unchanged, so useRouteStore and all map UI
 * keep working without modification.
 */

export type RouteMode = 'walking' | 'driving' | 'transit';

export interface LatLngLiteral {
  lat: number;
  lng: number;
}

export interface RouteResult {
  mode: RouteMode;
  distanceText: string;
  durationText: string;
  distanceMeters: number;
  durationSeconds: number;
  path: LatLngLiteral[];
  summary?: string;
}

declare const google: any;

const TRAVEL_MODE: Record<RouteMode, string> = {
  walking: 'WALKING',
  driving: 'DRIVING',
  transit: 'TRANSIT',
};

const faNum = (n: number, digits = 0): string =>
  Number(n.toFixed(digits)).toLocaleString('fa-IR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

function formatDistanceFa(meters: number): string {
  if (!meters || meters <= 0) return '—';
  if (meters < 1000) return `${faNum(Math.round(meters))} متر`;
  return `${faNum(meters / 1000, 1)} کیلومتر`;
}

function formatDurationFa(totalSeconds: number): string {
  if (!totalSeconds || totalSeconds <= 0) return '—';
  const mins = Math.round(totalSeconds / 60);
  if (mins < 60) return `${faNum(mins)} دقیقه`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest === 0 ? `${faNum(hours)} ساعت` : `${faNum(hours)} ساعت و ${faNum(rest)} دقیقه`;
}

function routesErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (/REQUEST_DENIED|ApiTargetBlockedMapError|Billing/i.test(msg)) {
    return 'مسیریابی در دسترس نیست. کلید نقشه دمو است — Billing/API باید در Google Cloud فعال شود.';
  }
  if (/OVER_QUERY_LIMIT|quota|rate/i.test(msg)) {
    return 'محدودیت درخواست مسیریابی. کمی بعد دوباره تلاش کن.';
  }
  if (/ZERO_RESULTS|NOT_FOUND/i.test(msg)) {
    return 'مسیری بین مبدا و مقصد پیدا نشد.';
  }
  if (/INVALID/i.test(msg)) {
    return 'درخواست مسیریابی نامعتبر است.';
  }
  return msg ? `مسیریابی ناموفق بود: ${msg}` : 'مسیریابی ناموفق بود.';
}

class RoutingServiceImpl {
  private lastRenderer: any = null;

  async calculateRoute(
    origin: LatLngLiteral,
    destination: LatLngLiteral,
    mode: RouteMode = 'walking',
  ): Promise<RouteResult> {
    if (typeof google === 'undefined' || !google.maps) {
      throw new Error('نقشه هنوز لود نشده. چند لحظه صبر کن و دوباره تلاش کن.');
    }

    try {
      await google.maps.importLibrary('routes');
      const RouteCtor = google.maps?.routes?.Route;
      if (!RouteCtor?.computeRoutes) {
        throw new Error('Routes library در دسترس نیست.');
      }

      const { routes } = await RouteCtor.computeRoutes({
        origin: { lat: origin.lat, lng: origin.lng },
        destination: { lat: destination.lat, lng: destination.lng },
        travelMode: TRAVEL_MODE[mode],
        // Minimal field mask: only what RouteResult needs (billing + latency).
        fields: ['distanceMeters', 'staticDurationMillis', 'durationMillis', 'path'],
        language: 'fa',
        units: 'METRIC',
      });

      const route = routes?.[0];
      if (!route) throw new Error('ZERO_RESULTS');

      const distanceMeters = Number(route.distanceMeters) || 0;
      const durationMillis =
        Number(route.durationMillis) || Number(route.staticDurationMillis) || 0;
      const durationSeconds = Math.round(durationMillis / 1000);

      const path: LatLngLiteral[] = Array.isArray(route.path)
        ? route.path
            .map((p: any) => ({
              lat: typeof p?.lat === 'function' ? p.lat() : Number(p?.lat),
              lng: typeof p?.lng === 'function' ? p.lng() : Number(p?.lng),
            }))
            .filter((p: LatLngLiteral) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
        : [];

      if (path.length < 2) throw new Error('ZERO_RESULTS');

      return {
        mode,
        distanceText: formatDistanceFa(distanceMeters),
        durationText: formatDurationFa(durationSeconds),
        distanceMeters,
        durationSeconds,
        path,
        summary: typeof route.description === 'string' ? route.description : undefined,
      };
    } catch (err) {
      throw new Error(routesErrorMessage(err));
    }
  }

  /** Encoded polyline decoder (kept for any encoded path source). */
  decodePolyline(encoded: string): LatLngLiteral[] {
    const coordinates: LatLngLiteral[] = [];
    let index = 0;
    let lat = 0;
    let lng = 0;

    while (index < encoded.length) {
      let shift = 0;
      let result = 0;
      let b: number;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlat = result & 1 ? ~(result >> 1) : result >> 1;
      lat += dlat;

      shift = 0;
      result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlng = result & 1 ? ~(result >> 1) : result >> 1;
      lng += dlng;

      coordinates.push({ lat: lat / 1e5, lng: lng / 1e5 });
    }
    return coordinates;
  }

  clear() {
    if (this.lastRenderer) {
      try {
        this.lastRenderer.setMap(null);
      } catch {
        /* noop */
      }
      this.lastRenderer = null;
    }
  }
}

export const routingService = new RoutingServiceImpl();

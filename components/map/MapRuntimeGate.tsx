import { AdvancedMarker, useMap } from '@vis.gl/react-google-maps';
import React, { useEffect, useMemo, useRef } from 'react';
import { useMapStore } from '../../store/useMapStore';
import { GeoPoint } from '../../utils/geoPoint';
import { isValidLatLng } from '../../utils/geoUtils';
import { Footprints as StepIcon, Star } from 'lucide-react';

declare const google: any;

/**
 * Central Map Runtime Gate.
 *
 * Marker mounting order (each strictly after the previous):
 *   API load -> Map object -> auth OK -> tiles loaded (base-ready)
 *   -> getMapCapabilities().isAdvancedMarkersAvailable (advanced-markers-ready)
 *   -> <MarkerLayer/> mounts.
 *
 * Rationale: a truthy object from useMap() is NOT readiness — with a rejected
 * key/billing the Map exists but is unusable, and mounting AdvancedMarker
 * against it crashes marker.js ('get'/'getRootNode' of undefined). The gate
 * also listens to `mapcapabilities_changed` so a mid-session capability loss
 * unmounts the layer instead of crashing.
 */

export const MapReadinessController: React.FC = () => {
  const map = useMap();
  const setMapRuntime = useMapStore((s) => s.setMapRuntime);
  const tilesSeen = useRef(false);

  useEffect(() => {
    if (!map || typeof google === 'undefined') return;

    let disposed = false;
    const listeners: any[] = [];

    const evaluateCapabilities = () => {
      if (disposed) return;
      try {
        const caps = typeof map.getMapCapabilities === 'function'
          ? map.getMapCapabilities()
          : null;
        if (caps && caps.isAdvancedMarkersAvailable === true) {
          useMapStore.getState().setMapRuntime('advanced-markers-ready');
        } else if (tilesSeen.current) {
          // Base tiles render but AdvancedMarker is unavailable: keep markers
          // unmounted (they would crash) while the base map stays usable.
          useMapStore.getState().setMapRuntime('base-ready');
        }
      } catch (err) {
        console.warn('[MapRuntimeGate] getMapCapabilities failed:', err);
      }
    };

    try {
      listeners.push(
        map.addListener('tilesloaded', () => {
          if (disposed) return;
          tilesSeen.current = true;
          const runtime = useMapStore.getState().mapRuntime;
          if (runtime !== 'advanced-markers-ready' && runtime !== 'auth-failed' && runtime !== 'load-failed') {
            useMapStore.getState().setMapRuntime('base-ready');
          }
          evaluateCapabilities();
        })
      );
    } catch (err) {
      console.warn('[MapRuntimeGate] tilesloaded listener failed:', err);
    }

    try {
      listeners.push(
        map.addListener('mapcapabilities_changed', () => {
          if (disposed) return;
          evaluateCapabilities();
        })
      );
    } catch (err) {
      console.warn('[MapRuntimeGate] mapcapabilities listener failed:', err);
    }

    // Evaluate immediately too (capabilities may already be available).
    evaluateCapabilities();

    return () => {
      disposed = true;
      for (const l of listeners) {
        try {
          google.maps.event.removeListener(l);
        } catch {
          /* noop */
        }
      }
    };
  }, [map, setMapRuntime]);

  return null;
};

const CuratedMarker = React.memo(({ poi, onClick, isActive }: {
  poi: any,
  onClick: (e: any) => void,
  isActive?: boolean,
}) => {
  // Belt-and-suspenders: the layer gates on capability, each marker additionally
  // requires a live map instance + strictly valid coords. Invalid data renders
  // nothing — never a (0,0) fallback pin, never an unvalidated position.
  const map = useMap();
  const position = useMemo(() => {
    const lat = Number(poi.lat);
    const lng = Number(poi.lng);

    if (!isValidLatLng(lat, lng)) return null;

    const geo = new GeoPoint(lat, lng);
    return geo.toGoogle();
  }, [poi.lat, poi.lng]);

  if (!map || !position) return null;

  return (
    <AdvancedMarker
      position={position}
      onClick={onClick}
      zIndex={isActive ? 2000 : 1000}
    >
      <div className={`relative cursor-pointer transition-transform active:scale-95 group ${isActive ? 'scale-125' : ''}`}>
        <div className={`rounded-full border-2 border-rava-gold bg-white p-1 transition-transform group-hover:scale-110 ${
          isActive ? 'shadow-[0_0_40px_rgba(234,179,8,0.9)] ring-2 ring-rava-gold/50' : 'shadow-[0_0_30px_rgba(234,179,8,0.6)]'
        }`}>
          <div className="rounded-full bg-rava-gold p-2">
             <Star size={18} className="fill-current text-black" />
          </div>
        </div>
        <div className="pointer-events-none absolute -bottom-8 start-1/2 z-[1000] hidden -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-1 glass text-white [@media(hover:hover)]:group-hover:block">
           <span className="text-rava-xs font-black">{poi.name}</span>
        </div>
      </div>
    </AdvancedMarker>
  );
});

const FootprintMarker = React.memo(({ fp, onClick }: {
  fp: any,
  onClick?: () => void,
}) => {
  const map = useMap();
  const position = useMemo(() => {
    const lat = Number(fp.lat);
    const lng = Number(fp.lng);
    if (!isValidLatLng(lat, lng)) return null;
    const geo = GeoPoint.fromArray([lat, lng]);
    return geo?.toGoogle() ?? null;
  }, [fp.lat, fp.lng]);

  if (!map || !position) return null;

  return (
    <AdvancedMarker
      position={position}
      zIndex={500}
      onClick={onClick}
    >
      <div className={`relative transition-all cursor-pointer active:scale-90 ${fp.is_verified === false ? 'opacity-40 grayscale-[0.5]' : 'opacity-80'}`}>
        <div className="bg-white/10 backdrop-blur-md p-2 rounded-full border border-white/20 shadow-xl">
          <StepIcon size={14} className={fp.is_verified === false ? 'text-white' : 'text-rava-gold'} />
        </div>
      </div>
    </AdvancedMarker>
  );
});

const UserLocationMarker = ({ location }: { location: GeoPoint }) => {
  const map = useMap();
  if (!map || !isValidLatLng(location.lat, location.lng)) return null;
  return (
    <AdvancedMarker position={location.toGoogle()}>
      <div className="relative">
        <div className="absolute inset-0 bg-blue-500 rounded-full animate-ping opacity-30" />
        <div className="relative w-5 h-5 bg-blue-500 rounded-full border-2 border-white shadow-xl flex items-center justify-center">
          <div className="w-1.5 h-1.5 bg-white rounded-full" />
        </div>
      </div>
    </AdvancedMarker>
  );
};

interface MarkerLayerProps {
  pois: any[];
  footprints: any[];
  userLocation: [number, number] | null;
  activeId?: string | null;
  onCuratedClick: (poi: any) => void;
  onFootprintClick: (fp: any) => void;
}

/**
 * The ONLY place markers mount. Rendered by MainMap exclusively when
 * mapRuntime === 'advanced-markers-ready'.
 */
export const MarkerLayer: React.FC<MarkerLayerProps> = ({
  pois,
  footprints,
  userLocation,
  activeId,
  onCuratedClick,
  onFootprintClick,
}) => {
  const userGeo = useMemo(() => GeoPoint.fromArray(userLocation), [userLocation]);

  // Dev-only audit trail: identifies exactly which POI/position reaches a marker.
  // Strip before production profiling if noisy (no behavior dependency).
  if (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) {
    for (const poi of pois) {
      console.debug('[MarkerLayer] curated', poi?.id, poi?.lat, poi?.lng);
    }
    for (const fp of footprints) {
      console.debug('[MarkerLayer] footprint', fp?.id ?? fp?.place_id, fp?.lat, fp?.lng);
    }
  }

  return (
    <>
      {pois.map((poi) => (
        <CuratedMarker
          key={poi.id}
          poi={poi}
          isActive={activeId === poi.id}
          onClick={() => onCuratedClick(poi)}
        />
      ))}

      {footprints.map((fp) => (
        <FootprintMarker
          key={fp.id}
          fp={fp}
          onClick={() => onFootprintClick(fp)}
        />
      ))}

      {userGeo && <UserLocationMarker location={userGeo} />}
    </>
  );
};

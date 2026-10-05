import { APIProvider, Map as GoogleMap, AdvancedMarker, useMap } from '@vis.gl/react-google-maps';
import React, { useEffect, useCallback, useRef, useMemo } from 'react';
import { useUserStore } from '../../store/useUserStore';
import { useMapStore } from '../../store/useMapStore';
import { useDiscoveryStore } from '../../store/useDiscoveryStore';
import { useRouteStore } from '../../store/useRouteStore';
import { PlaceService } from '../../services/placeService';
import { footprintService } from '../../services/social/footprintService';
import { selectPOI } from '../../services/poiSelectionService';
import { cityPackService } from '../../services/cityPack';
import { GeoPoint } from '../../utils/geoPoint';
import { isValidLatLng } from '../../utils/geoUtils';
import { Footprints as StepIcon, Star } from 'lucide-react';
import { APP_CONFIG } from '../../config';
import { MapControls } from './MapControls';
import { MapErrorBoundary, MapFallback } from './MapErrorBoundary';

declare const google: any;

const CuratedMarker = React.memo(({ poi, onClick, isActive }: { 
  poi: any, 
  onClick: (e: any) => void,
  isActive?: boolean,
}) => {
  // Library-sanctioned readiness: never mount a marker before the Map instance
  // exists. Mounting against a failed/initializing map crashes marker.js
  // ('get'/'getRootNode' of undefined) instead of skipping.
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
      anchorLeft="-50%"
      anchorTop="-50%"
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

  // No fallback pin: invalid footprint coords render nothing, never (0,0).
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

const RoutePolyline = () => {
  const map = useMap();
  const path = useRouteStore((s) => s.route?.path);
  const polylineRef = useRef<any>(null);

  useEffect(() => {
    if (!map || typeof google === 'undefined') return;

    if (polylineRef.current) {
      polylineRef.current.setMap(null);
      polylineRef.current = null;
    }

    if (!path || path.length < 2) return;

    polylineRef.current = new google.maps.Polyline({
      path,
      geodesic: true,
      strokeColor: '#EAB308',
      strokeOpacity: 0.95,
      strokeWeight: 5,
      map,
    });

    try {
      const bounds = new google.maps.LatLngBounds();
      path.forEach((p) => bounds.extend(p));
      map.fitBounds(bounds, 80);
    } catch {
      /* noop */
    }

    return () => {
      if (polylineRef.current) {
        polylineRef.current.setMap(null);
        polylineRef.current = null;
      }
    };
  }, [map, path]);

  return null;
};

const MapController = () => {
  const map = useMap();
  const { cityMode, setCityMode } = useUserStore(); 
  const { fetchCurated } = useDiscoveryStore();
  const { setUserLocation, setNearbyFootprints } = useMapStore();
  
  const processingClickRef = useRef<boolean>(false);
  const isCityInitialized = useRef<boolean>(false);
  // Last coords a footprint fetch was issued for (refetch only after ~1km move).
  const lastFootprintFetchRef = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!cityMode && !isCityInitialized.current) {
        isCityInitialized.current = true;
        setCityMode('Istanbul');
    }
  }, [cityMode, setCityMode]);

  useEffect(() => {
    if (!map) return;

    const clickListener = map.addListener('click', async (e: any) => {
      if (e.placeId) {
        e.stop(); 

        if (processingClickRef.current) return;
        processingClickRef.current = true;

        try {
          await selectPOI(
            { id: e.placeId, name: 'در حال شناسایی...', category: 'loading', lat: 0, lng: 0, isGooglePOI: true },
            { source: 'google', map, fetchEssentials: true },
          );
        } finally {
          setTimeout(() => { processingClickRef.current = false; }, 500);
        }
      }
    });

    return () => {
      if (clickListener) google.maps.event.removeListener(clickListener);
    };
  }, [map]);

  useEffect(() => {
    if (!map || !cityMode) return;

    PlaceService.init();
    fetchCurated(cityMode).catch(err => console.error("Fetch curated failed:", err));
    cityPackService.onCityChange(cityMode).catch(() => {});

    // New city = new area: refresh footprints immediately for the current fix.
    const currentLoc = useMapStore.getState().userLocation;
    if (currentLoc) {
      lastFootprintFetchRef.current = { lat: currentLoc[0], lng: currentLoc[1] };
      footprintService.getNearby(currentLoc[0], currentLoc[1]).then(setNearbyFootprints).catch(() => {});
    }
    
    const center = cityMode === 'Istanbul' 
      ? new GeoPoint(41.0082, 28.9784) 
      : new GeoPoint(25.2048, 55.2708);
      
    map.panTo(center.toGoogle());
    map.setZoom(13);
    
  }, [cityMode, map, fetchCurated]);

  useEffect(() => {
    if (!navigator.geolocation) return;

    try {
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const loc: [number, number] = [pos.coords.latitude, pos.coords.longitude];
          setUserLocation(loc);
          // Rehydration path: verified-nearby + own pending footprints from the DB,
          // so a refresh never wipes what the user posted. Throttled by distance.
          const last = lastFootprintFetchRef.current;
          const movedKm = last
            ? Math.hypot(loc[0] - last.lat, loc[1] - last.lng) * 111
            : Infinity;
          if (movedKm > 1) {
            lastFootprintFetchRef.current = { lat: loc[0], lng: loc[1] };
            footprintService.getNearby(loc[0], loc[1]).then(setNearbyFootprints).catch(() => {});
          }
        },
        (err) => {
          if (err.code === 1) {
            useMapStore.getState().setLocationPermissionDenied(true);
          } else {
            console.warn('Geolocation error:', err);
          }
        },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    } catch (e) {
      /* noop */
    }
  }, [setUserLocation]);

  return null;
};

const GOOGLE_LIBRARIES: ("places" | "marker")[] = ['places', 'marker'];
const MAPS_JS_VERSION = 'quarterly';

const handleMapsApiError = (error: unknown) => {
  console.error('[MainMap] Google Maps JavaScript API failed to load:', error);
  useMapStore.getState().setMapsLoadError(
    'نقشه لود نشد. اتصال اینترنت و کلید Google Maps را بررسی کن.'
  );
};

export const MainMap: React.FC = () => {
  const { curatedPlaces, showCurated } = useDiscoveryStore();
  const { nearbyFootprints, pendingFootprints, userLocation, activePOI, fullDetailPOI, mapsLoadError } = useMapStore();
  const activeId = fullDetailPOI?.id || activePOI?.id;

  const visibleCurated = useMemo(() => {
    if (!showCurated) return [];
    return curatedPlaces;
  }, [showCurated, curatedPlaces]);

  const handleCuratedClick = useCallback((poi: any) => {
    selectPOI(poi, { source: 'curated', fetchEssentials: false, map: null });
  }, []);

  const handleFootprintClick = useCallback((fp: any) => {
    selectPOI(
      {
        id: fp.place_id || fp.id,
        name: fp.place_name || fp.user || 'ردپا',
        lat: Number(fp.lat) || 0,
        lng: Number(fp.lng) || 0,
        category: 'footprint',
        description: fp.text,
      },
      { source: 'footprint', fetchEssentials: !!fp.place_id },
    );
  }, []);

  const userGeo = useMemo(() => GeoPoint.fromArray(userLocation), [userLocation]);

  // No API key at all: don't even boot the provider (it would only throw).
  // The rest of the app (tabs, sheets, tools) keeps working on the fallback.
  if (!APP_CONFIG.GOOGLE.MAPS_API_KEY) {
    return (
      <div className="w-full h-full relative map-container">
        <MapFallback message="کلید Google Maps تنظیم نشده. بقیه بخش‌های برنامه کار می‌کنند." />
      </div>
    );
  }

  // Provider already reported a fatal load error: don't mount the map at all
  // (its children, incl. the old error banner, would crash with it).
  if (mapsLoadError) {
    return (
      <div className="w-full h-full relative map-container">
        <MapFallback message={mapsLoadError} />
      </div>
    );
  }

  return (
    <div className="w-full h-full relative map-container">
      <APIProvider
        apiKey={APP_CONFIG.GOOGLE.MAPS_API_KEY}
        libraries={GOOGLE_LIBRARIES}
        version={MAPS_JS_VERSION}
        onError={handleMapsApiError}
      >
        <MapErrorBoundary>
          <GoogleMap
            defaultCenter={{ lat: 41.0082, lng: 28.9784 }}
            defaultZoom={13}
            mapId={APP_CONFIG.GOOGLE.MAPS_MAP_ID}
            disableDefaultUI={true}
          clickableIcons={true}
          className="w-full h-full"
          gestureHandling={'greedy'}
          colorScheme="DARK"
        >
          <MapController />
          <RoutePolyline />
          <MapPanOnSelect />
          
          {visibleCurated.map(poi => (
            <CuratedMarker 
              key={poi.id} 
              poi={poi} 
              isActive={activeId === poi.id}
              onClick={() => handleCuratedClick(poi)} 
            />
          ))}

          {[...nearbyFootprints, ...(pendingFootprints || [])].map(fp => (
            <FootprintMarker 
              key={fp.id} 
              fp={fp}
              onClick={() => handleFootprintClick(fp)}
            />
          ))}

          {userGeo && <UserLocationMarker location={userGeo} />}

          <MapControls />
        </GoogleMap>
        </MapErrorBoundary>
      </APIProvider>
    </div>
  );
};

/** User pulse marker — only mounts on a ready map with valid coords. */
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

/** Pan map when active POI gains real coordinates. */
const MapPanOnSelect = () => {
  const map = useMap();
  const activePOI = useMapStore((s) => s.activePOI);
  const lastId = useRef<string | null>(null);

  useEffect(() => {
    if (!map || !activePOI) return;
    if (activePOI.lat === 0 && activePOI.lng === 0) return;
    if (lastId.current === activePOI.id) return;
    lastId.current = activePOI.id;
    map.panTo({ lat: activePOI.lat, lng: activePOI.lng });
  }, [map, activePOI]);

  return null;
};

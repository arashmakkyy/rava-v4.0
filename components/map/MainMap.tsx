import { APIProvider, Map as GoogleMap, useMap } from '@vis.gl/react-google-maps';
import React, { useEffect, useCallback, useRef, useMemo } from 'react';
import { useUserStore } from '../../store/useUserStore';
import { useMapStore } from '../../store/useMapStore';
import { useDiscoveryStore } from '../../store/useDiscoveryStore';
import { useRouteStore } from '../../store/useRouteStore';
import { PlaceService } from '../../services/placeService';
import { footprintService } from '../../services/social/footprintService';
import { selectPOI } from '../../services/poiSelectionService';
import { installMapsAuthFailureHandler } from '../../services/mapsAuth';
import { cityPackService } from '../../services/cityPack';
import { GeoPoint } from '../../utils/geoPoint';
import { APP_CONFIG } from '../../config';
import { MapControls } from './MapControls';
import { MapErrorBoundary, MapFallback } from './MapErrorBoundary';
import { MapReadinessController, MarkerLayer } from './MapRuntimeGate';

declare const google: any;

// Official auth-failure callback must exist BEFORE the Maps script loads
// (APIProvider injects it on mount). See services/mapsAuth.ts.
installMapsAuthFailureHandler();

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
  const store = useMapStore.getState();
  store.setMapRuntime('load-failed');
  store.setMapsLoadError(
    'نقشه لود نشد. اتصال اینترنت و کلید Google Maps را بررسی کن.'
  );
};

export const MainMap: React.FC = () => {
  const { curatedPlaces, showCurated } = useDiscoveryStore();
  const { nearbyFootprints, pendingFootprints, userLocation, activePOI, fullDetailPOI, mapsLoadError, mapRuntime } = useMapStore();
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
            <MapReadinessController />
            <RoutePolyline />
            <MapPanOnSelect />

            {/*
              Marker layer mounts ONLY on 'advanced-markers-ready':
              map exists + auth OK + getMapCapabilities confirms it.
              Mounting earlier crashes marker.js on unhealthy maps.
            */}
            {mapRuntime === 'advanced-markers-ready' && (
              <MarkerLayer
                pois={visibleCurated}
                footprints={[...nearbyFootprints, ...(pendingFootprints || [])]}
                userLocation={userLocation}
                activeId={activeId}
                onCuratedClick={handleCuratedClick}
                onFootprintClick={handleFootprintClick}
              />
            )}

            <MapControls />
          </GoogleMap>
        </MapErrorBoundary>
      </APIProvider>
    </div>
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

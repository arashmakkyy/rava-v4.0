import { create } from 'zustand';
import { MapState, POI, Footprint } from '../types';

export const useMapStore = create<MapState>((set) => ({
  userLocation: null,
  activePOI: null,
  fullDetailPOI: null,
  nearbyFootprints: [],
  pendingFootprints: [],
  isLoadingDetails: false,
  isCelebratingStamp: false,
  isNarrativePlaying: false,
  poiError: null,
  locationPermissionDenied: false,
  mapsLoadError: null,
  mapRuntime: 'loading',

  setUserLocation: (loc: [number, number]) =>
    set({ userLocation: loc, locationPermissionDenied: false }),
  
  setActivePOI: (poi: POI | null) => set((state) => ({
    activePOI: poi,
    fullDetailPOI: poi !== null ? null : state.fullDetailPOI,
    isNarrativePlaying: false,
    isLoadingDetails: false,
    poiError: poi !== null ? null : state.poiError,
    pendingFootprints: poi !== null ? [] : state.pendingFootprints,
  })),

  clearActivePOI: () => set({
    activePOI: null,
    fullDetailPOI: null,
    isNarrativePlaying: false,
    isLoadingDetails: false,
    poiError: null,
    pendingFootprints: [],
  }),

  setFullDetailPOI: (poi: POI | null) => set({ fullDetailPOI: poi, poiError: null }),
  setNearbyFootprints: (footprints: Footprint[]) => set({ nearbyFootprints: footprints }),
  setLoadingDetails: (val: boolean) => set({ isLoadingDetails: val }),
  setCelebratingStamp: (val: boolean) => set({ isCelebratingStamp: val }),
  setNarrativePlaying: (val: boolean) => set({ isNarrativePlaying: val }),
  setPOIError: (msg: string | null) => set({ poiError: msg }),
  setLocationPermissionDenied: (val: boolean) => set({ locationPermissionDenied: val }),
  setMapsLoadError: (msg: string | null) => set({ mapsLoadError: msg }),
  setMapRuntime: (mapRuntime) => set({ mapRuntime }),
  
  addFootprintOptimistic: (poiId: string, footprint: Footprint) => set((state) => {
    const matchesActive = state.activePOI?.id === poiId;
    const matchesFull = state.fullDetailPOI?.id === poiId;
    if (!matchesActive && !matchesFull) return {};

    const pendingFootprint: Footprint = { ...footprint, is_verified: false };

    const updatedFullDetailPOI = matchesFull
      ? {
          ...state.fullDetailPOI!,
          footprints: [pendingFootprint, ...(state.fullDetailPOI!.footprints || [])],
        }
      : state.fullDetailPOI;

    return {
      fullDetailPOI: updatedFullDetailPOI,
      pendingFootprints: [pendingFootprint, ...state.pendingFootprints],
    };
  }),
}));

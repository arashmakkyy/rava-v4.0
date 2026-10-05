
import { POI, Narrative } from "../types";
import { dbService } from "./dbService";
import { supabase } from "./supabaseClient";
import { GeoPoint } from "../utils/geoPoint";
import { aiProxyService } from "./ai/aiProxyService";

const CACHE_EXPIRY = 30 * 24 * 60 * 60 * 1000;

declare const google: any;

class PlaceServiceProvider {
  init() {
    // Places readiness is checked lazily per call via waitForGoogle().
  }

  async waitForGoogle(): Promise<boolean> {
    try {
      if (typeof google === 'undefined' || !google.maps) {
        const mapsReady = await new Promise<boolean>((resolve) => {
          let attempts = 0;
          const interval = setInterval(() => {
            attempts++;
            if (typeof google !== 'undefined' && google.maps) {
              clearInterval(interval);
              resolve(true);
            } else if (attempts > 50) {
              clearInterval(interval);
              resolve(false);
            }
          }, 100);
        });
        if (!mapsReady) {
          console.error('[PlaceService] Google Maps JS not available');
          return false;
        }
      }

      if (google.maps.places) return true;

      await google.maps.importLibrary('places');
      return !!google.maps.places;
    } catch (e) {
      console.error('[PlaceService] Places library failed to load:', e);
      return false;
    }
  }

  async fetchHybridDetails(placeId: string): Promise<Partial<POI>> {
    const localCacheKey = `curated_${placeId}`;
    const cachedData = await dbService.get(localCacheKey);
    
    if (navigator.onLine) {
      this.refreshCuratedCache(placeId, localCacheKey).then();
    }

    if (cachedData) {
      return cachedData;
    }

    try {
      const { data: curated, error } = await supabase
        .from('attractions')
        .select('*, narratives(*)')
        .eq('place_id', placeId)
        .single();

      if (curated && !error) {
        const transformedPOI = this.transformCuratedToPOI(curated);
        await dbService.set(localCacheKey, transformedPOI);
        return transformedPOI;
      }
    } catch (e) {
      console.warn("Server Fetch Failed, trying Google fallback:", e);
    }

    return this.fetchEssentials(placeId);
  }

  private async refreshCuratedCache(placeId: string, key: string) {
    try {
      const { data: curated, error } = await supabase
        .from('attractions')
        .select('*, narratives(*)')
        .eq('place_id', placeId)
        .single();
      
      if (curated && !error) {
        const transformedPOI = this.transformCuratedToPOI(curated);
        await dbService.set(key, transformedPOI);
      }
    } catch (e) {}
  }

  private transformCuratedToPOI(curated: any): Partial<POI> {
    const geo = GeoPoint.fromPostGIS(curated.location);
    
    return {
      id: curated.place_id,
      name: curated.name,
      lat: geo?.lat || 0,
      lng: geo?.lng || 0,
      category: curated.static_data?.category || 'historical',
      description: curated.static_data?.description_fa || '',
      image: curated.assets?.photos?.[0] || curated.assets?.icon_3d, // عکس از دیتابیس خودمان می‌آید
      is_curated: true,
      narrative: curated.narratives?.[0] as Narrative
    };
  }

  async fetchNearbyFallback(lat: number, lng: number, mood?: string): Promise<POI[]> {
    const isReady = await this.waitForGoogle();
    if (!isReady) return [];

    try {
      const { Place, SearchNearbyRankPreference } = await google.maps.importLibrary("places");
      const center = new google.maps.LatLng(lat, lng);
      
      const request = {
        fields: ['displayName', 'location', 'formattedAddress', 'types'],
        locationRestriction: { center, radius: 2000 },
        includedPrimaryTypes: this.mapMoodToGoogleTypes(mood),
        maxResultCount: 8,
        rankPreference: SearchNearbyRankPreference.POPULARITY,
      };

      const { places } = await Place.searchNearby(request);
      
      return (places || []).map((p: any) => ({
        id: p.id,
        name: p.displayName || "مکان ناشناخته",
        lat: p.location?.lat() || 0,
        lng: p.location?.lng() || 0,
        category: mood || p.types?.[0] || 'point_of_interest',
        description: p.formattedAddress,
        image: undefined,
        isGooglePOI: true
      }));
    } catch (e) {
      console.error("Fallback Search Error:", e);
      return [];
    }
  }

  private mapMoodToGoogleTypes(mood?: string): string[] {
    switch (mood) {
      case 'luxury': return ['fine_dining', 'restaurant', 'hotel'];
      case 'budget': return ['park', 'museum', 'tourist_attraction'];
      case 'instagrammable': return ['observation_deck', 'museum', 'point_of_interest'];
      case 'hidden_gem': return ['art_gallery', 'cafe'];
      default: return ['tourist_attraction', 'point_of_interest'];
    }
  }

  async fetchEssentials(placeId: string): Promise<Partial<POI>> {
    const cacheKey = `ess_v2_${placeId}`;
    const cached = await dbService.get(cacheKey);
    if (cached && (Date.now() - cached.updatedAt < CACHE_EXPIRY)) return cached.data;

    const isReady = await this.waitForGoogle();
    if (!isReady) return { name: "خطا در اتصال" };

    try {
      const place = new google.maps.places.Place({ id: placeId, requestedLanguage: 'fa' });
      await place.fetchFields({ fields: ['displayName', 'location', 'types', 'formattedAddress'] });

      const data = {
        id: placeId,
        name: place.displayName,
        lat: place.location?.lat() || 0,
        lng: place.location?.lng() || 0,
        category: place.types?.[0],
        description: place.formattedAddress,
      };

      await dbService.set(cacheKey, { data, updatedAt: Date.now() });
      return data;
    } catch (error) {
      console.error('[PlaceService] fetchEssentials failed:', error);
      return {};
    }
  }

  async fetchFullDetails(placeId: string): Promise<Partial<POI>> {
    const cacheKey = `full_v2_${placeId}`;
    const cached = await dbService.get(cacheKey);
    if (cached && (Date.now() - cached.updatedAt < CACHE_EXPIRY)) return cached.data;

    const isReady = await this.waitForGoogle();
    if (!isReady) return {};

    try {
      const place = new google.maps.places.Place({ id: placeId, requestedLanguage: 'fa' });
      await place.fetchFields({ fields: ['rating', 'userRatingCount', 'priceLevel', 'regularOpeningHours', 'reviews', 'editorialSummary'] });

      const fullData = {
        rating: place.rating,
        userRatingCount: place.userRatingCount,
        priceLevel: place.priceLevel,
        openingHours: place.regularOpeningHours?.weekdayDescriptions,
        reviews: place.reviews,
        editorialSummary: place.editorialSummary?.text || place.editorialSummary,
      };

      await dbService.set(cacheKey, { data: fullData, updatedAt: Date.now() });
      return fullData;
    } catch (error) {
      console.error('[PlaceService] fetchFullDetails failed:', error);
      return {};
    }
  }
  
  /**
   * تابع جدید و اختصاصی برای گرفتن عکس‌ها بر اساس تقاضا
   * این تابع فقط زمانی فراخوانی می‌شود که کاربر روی دکمه «نمایش عکس‌ها» کلیک کند.
   */
  async fetchPlacePhotos(placeId: string): Promise<string[]> {
    const cacheKey = `photos_v1_${placeId}`;
    const cached = await dbService.get(cacheKey);
    if (cached) return cached;

    const isReady = await this.waitForGoogle();
    if (!isReady) return [];

    try {
      const place = new google.maps.places.Place({ id: placeId });
      // درخواست فقط برای فیلد photos (هزینه دارد)
      await place.fetchFields({ fields: ['photos'] });

      if (!place.photos || place.photos.length === 0) {
        return [];
      }

      // تبدیل عکس‌ها به URL و ذخیره در کش
      const photoUrls = place.photos.map((p: any) => p.getURI({ maxHeight: 800, maxWidth: 800 }));
      await dbService.set(cacheKey, photoUrls);
      return photoUrls;

    } catch (error) {
      console.error("[PlaceService] Failed to fetch photos:", error);
      return [];
    }
  }

  async getAIVibeCheck(reviews: any[]): Promise<string> {
    if (!reviews || reviews.length === 0) return "هنوز نظری ثبت نشده، بیا اولین ردپا رو تو بذار!";

    try {
      const text = await aiProxyService.vibeCheck(reviews);
      return text || "جای باحالی به نظر میاد!";
    } catch (e) { 
        console.warn("[AI] Vibe check failed:", e);
        return "توریست‌ها حس مثبتی به اینجا دارن."; 
    }
  }
}

export const PlaceService = new PlaceServiceProvider();

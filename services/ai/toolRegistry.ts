/**
 * Rava AI Tool Registry — Map / Trip / User / Wallet / App Control.
 * Declarations + validated handlers. Wired into geminiLive toolCallDispatcher.
 */
import { Type } from '@google/genai';
import { discoveryService } from '../discoveryService';
import { cityPackService } from '../cityPack';
import { selectPOI } from '../poiSelectionService';
import { GeoPoint } from '../../utils/geoPoint';
import { useMapStore } from '../../store/useMapStore';
import { useUserStore } from '../../store/useUserStore';
import { useAuthStore } from '../../store/useAuthStore';
import { useDiscoveryStore } from '../../store/useDiscoveryStore';
import { useUIStore } from '../../store/useUIStore';
import { useRouteStore } from '../../store/useRouteStore';
import type { AppTab, TripEvent } from '../../types';

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
export type ToolDomain = 'Map' | 'Trip' | 'User' | 'Wallet' | 'App';

export interface RegisteredTool {
  domain: ToolDomain;
  name: string;
  description: string;
  /** If true, the dispatcher pauses execution until the user confirms in-app. */
  requiresConfirmation?: boolean;
  /** Persian label shown on the confirmation sheet (required when gated). */
  confirmLabel?: string;
  declaration: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
  handler: ToolHandler;
  validate?: (args: Record<string, unknown>) => string | null;
}

function requireString(args: Record<string, unknown>, key: string): string | null {
  const v = args[key];
  if (typeof v !== 'string' || !v.trim()) return `${key} الزامی است.`;
  return null;
}

const tools: RegisteredTool[] = [
  // ─── Map ───────────────────────────────────────────────────────────────
  {
    domain: 'Map',
    name: 'get_location',
    description: 'مختصات فعلی مسافر را برمی‌گرداند.',
    declaration: {
      name: 'get_location',
      description: 'موقعیت فعلی کاربر روی نقشه.',
      parameters: { type: Type.OBJECT, properties: {} },
    },
    handler: async () => {
      const geo = GeoPoint.fromArray(useMapStore.getState().userLocation);
      if (!geo) return { error: 'موقعیت در دسترس نیست.' };
      return { lat: geo.lat, lng: geo.lng };
    },
  },
  {
    domain: 'Map',
    name: 'select_place',
    description: 'یک مکان را روی نقشه فعال می‌کند و شیت را باز می‌کند.',
    declaration: {
      name: 'select_place',
      description: 'انتخاب مکان با place_id یا نام و مختصات.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          place_id: { type: Type.STRING },
          name: { type: Type.STRING },
          lat: { type: Type.NUMBER },
          lng: { type: Type.NUMBER },
          category: { type: Type.STRING },
        },
        required: ['place_id'],
      },
    },
    validate: (args) => requireString(args, 'place_id'),
    handler: async (args) => {
      await selectPOI(
        {
          id: String(args.place_id),
          name: (args.name as string) || 'مکان',
          lat: Number(args.lat) || 0,
          lng: Number(args.lng) || 0,
          category: (args.category as string) || 'place',
        },
        { source: 'tool', fetchEssentials: true },
      );
      useUIStore.getState().setActiveTab('home');
      return { ok: true, place_id: args.place_id };
    },
  },
  {
    domain: 'Map',
    name: 'search_place',
    description: 'جستجوی مکان‌های اطراف بر اساس مود.',
    declaration: {
      name: 'search_place',
      description: 'جستجوی نزدیک بر اساس mood و شعاع.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          mood: { type: Type.STRING },
          radius: { type: Type.NUMBER },
          query: { type: Type.STRING },
        },
      },
    },
    handler: async (args) => {
      const geo = GeoPoint.fromArray(useMapStore.getState().userLocation);
      const results = await discoveryService.searchNearby(
        geo?.lat || 0,
        geo?.lng || 0,
        (args.radius as number) || 5000,
        (args.mood as string) || undefined,
      );
      useDiscoveryStore.getState().setDiscoveredPlaces(results);
      return results.length ? results.slice(0, 10) : 'چیزی پیدا نکردم.';
    },
  },
  {
    domain: 'Map',
    name: 'show_places_on_map',
    description: 'نمایش لایه مکان‌های منتخب راوا روی نقشه.',
    declaration: {
      name: 'show_places_on_map',
      description: 'روشن کردن لایه Gems / curated.',
      parameters: {
        type: Type.OBJECT,
        properties: { show: { type: Type.BOOLEAN } },
      },
    },
    handler: async (args) => {
      const show = args.show !== false;
      const { showCurated, toggleShowCurated } = useDiscoveryStore.getState();
      if (show !== showCurated) toggleShowCurated();
      useUIStore.getState().setActiveTab('home');
      return { showCurated: useDiscoveryStore.getState().showCurated };
    },
  },
  {
    domain: 'Map',
    name: 'start_route',
    description: 'شروع مسیریابی به POI فعال یا مقصد داده‌شده.',
    requiresConfirmation: true,
    confirmLabel: 'مسیریابی شروع شود؟',
    declaration: {
      name: 'start_route',
      description: 'مسیریابی پیاده/خودرو/حمل‌ونقل عمومی.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          mode: { type: Type.STRING, enum: ['walking', 'driving', 'transit'] },
          place_id: { type: Type.STRING },
        },
      },
    },
    handler: async (args) => {
      if (args.place_id) {
        await selectPOI({ id: String(args.place_id), name: 'مقصد' }, { source: 'tool' });
      }
      const mode = (args.mode as 'walking' | 'driving' | 'transit') || 'walking';
      await useRouteStore.getState().startRoute(null, mode);
      useUIStore.getState().setActiveTab('home');
      const { route, error } = useRouteStore.getState();
      if (error) return { error };
      return {
        ok: true,
        duration: route?.durationText,
        distance: route?.distanceText,
        mode,
      };
    },
  },
  {
    domain: 'Map',
    name: 'stop_route',
    description: 'لغو مسیر فعال.',
    declaration: {
      name: 'stop_route',
      description: 'لغو مسیریابی.',
      parameters: { type: Type.OBJECT, properties: {} },
    },
    handler: async () => {
      useRouteStore.getState().cancelRoute();
      return { ok: true };
    },
  },
  {
    domain: 'Map',
    name: 'get_active_poi',
    description: 'POI فعال یا جزئیات باز را برمی‌گرداند.',
    declaration: {
      name: 'get_active_poi',
      description: 'مکان فعال روی نقشه.',
      parameters: { type: Type.OBJECT, properties: {} },
    },
    handler: async () => {
      const { activePOI, fullDetailPOI } = useMapStore.getState();
      const poi = fullDetailPOI || activePOI;
      if (!poi) return { active: null };
      return {
        id: poi.id,
        name: poi.name,
        lat: poi.lat,
        lng: poi.lng,
        category: poi.category,
        rating: poi.rating,
      };
    },
  },
  {
    domain: 'Map',
    name: 'get_city_details',
    description: 'جزئیات پک شهر (محله، حمل‌ونقل، فرهنگ، هشدارها) — نه خلاصه کوتاه.',
    declaration: {
      name: 'get_city_details',
      description: 'دریافت بخش‌های City Pack.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          section: {
            type: Type.STRING,
            enum: ['districts', 'transport', 'culture', 'warnings', 'categories', 'selectedPOIs', 'summary'],
          },
        },
      },
    },
    handler: async (args) => {
      const city = useUserStore.getState().cityMode;
      return cityPackService.getDetails(city, args.section as any);
    },
  },

  // ─── Trip ──────────────────────────────────────────────────────────────
  {
    domain: 'Trip',
    name: 'create_itinerary',
    description: 'ایجاد رویداد سفر جدید.',
    declaration: {
      name: 'create_itinerary',
      description: 'افزودن آیتم برنامه سفر.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          type: { type: Type.STRING, enum: ['flight', 'hotel', 'activity', 'food'] },
          time: { type: Type.STRING },
          date: { type: Type.STRING },
          place_id: { type: Type.STRING },
          place_name: { type: Type.STRING },
        },
        required: ['title'],
      },
    },
    validate: (args) => requireString(args, 'title'),
    handler: async (args) => {
      const event: TripEvent = {
        id: crypto.randomUUID(),
        type: (args.type as TripEvent['type']) || 'activity',
        title: String(args.title),
        time: (args.time as string) || '12:00',
        date: (args.date as string) || new Date().toISOString().slice(0, 10),
        status: 'pending',
        sequence: useUserStore.getState().tripEvents.length,
        placeId: args.place_id as string | undefined,
        placeName: args.place_name as string | undefined,
        details: {},
      };
      await useUserStore.getState().addTripEvent(event);
      return { ok: true, id: event.id };
    },
  },
  {
    domain: 'Trip',
    name: 'add_to_itinerary',
    description: 'افزودن POI فعال به برنامه سفر.',
    declaration: {
      name: 'add_to_itinerary',
      description: 'POI فعلی یا place_id را به itinerary اضافه کن.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          place_id: { type: Type.STRING },
          place_name: { type: Type.STRING },
          time: { type: Type.STRING },
          date: { type: Type.STRING },
        },
      },
    },
    handler: async (args) => {
      const poi = useMapStore.getState().fullDetailPOI || useMapStore.getState().activePOI;
      const title = (args.place_name as string) || poi?.name || 'فعالیت';
      const event: TripEvent = {
        id: crypto.randomUUID(),
        type: 'activity',
        title,
        time: (args.time as string) || '14:00',
        date: (args.date as string) || new Date().toISOString().slice(0, 10),
        status: 'pending',
        sequence: useUserStore.getState().tripEvents.length,
        placeId: (args.place_id as string) || poi?.id,
        placeName: title,
        coordinates: poi ? [poi.lat, poi.lng] : undefined,
        details: {},
      };
      await useUserStore.getState().addTripEvent(event);
      return { ok: true, id: event.id, title };
    },
  },
  {
    domain: 'Trip',
    name: 'remove_reorder_item',
    description: 'حذف یا جابه‌جایی آیتم برنامه.',
    requiresConfirmation: true,
    confirmLabel: 'این تغییر در برنامه سفر انجام شود؟',
    declaration: {
      name: 'remove_reorder_item',
      description: 'حذف با event_id یا تغییر sequence.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          event_id: { type: Type.STRING },
          action: { type: Type.STRING, enum: ['remove', 'reorder'] },
          new_sequence: { type: Type.NUMBER },
        },
        required: ['event_id', 'action'],
      },
    },
    validate: (args) => requireString(args, 'event_id') || requireString(args, 'action'),
    handler: async (args) => {
      const id = String(args.event_id);
      if (args.action === 'remove') {
        await useUserStore.getState().removeTripEvent(id);
        return { ok: true, removed: id };
      }
      await useUserStore.getState().updateTripEvent(id, {
        sequence: Number(args.new_sequence) || 0,
      });
      return { ok: true, reordered: id };
    },
  },
  {
    domain: 'Trip',
    name: 'get_today_itinerary',
    description: 'برنامه امروز مسافر.',
    declaration: {
      name: 'get_today_itinerary',
      description: 'لیست فعالیت‌های امروز.',
      parameters: { type: Type.OBJECT, properties: {} },
    },
    handler: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const events = useUserStore
        .getState()
        .tripEvents.filter((e) => e.date === today || e.date.includes(today));
      return events.length ? events : 'برای امروز چیزی تو برنامه نیست.';
    },
  },
  {
    domain: 'Trip',
    name: 'complete_activity',
    description: 'علامت‌زدن فعالیت به‌عنوان انجام‌شده.',
    requiresConfirmation: true,
    confirmLabel: 'این فعالیت انجام‌شده ثبت شود؟',
    declaration: {
      name: 'complete_activity',
      description: 'تکمیل فعالیت با event_id.',
      parameters: {
        type: Type.OBJECT,
        properties: { event_id: { type: Type.STRING } },
        required: ['event_id'],
      },
    },
    validate: (args) => requireString(args, 'event_id'),
    handler: async (args) => {
      const result = await useUserStore.getState().completeActivity(String(args.event_id));
      return { ok: true, next: result?.next || null };
    },
  },

  // ─── User ──────────────────────────────────────────────────────────────
  {
    domain: 'User',
    name: 'get_profile',
    description: 'خلاصه پروفایل مسافر.',
    declaration: {
      name: 'get_profile',
      description: 'پروفایل و ترجیحات سطح بالا.',
      parameters: { type: Type.OBJECT, properties: {} },
    },
    handler: async () => {
      const { cityMode, wallet } = useUserStore.getState();
      const { semanticProfile, user } = useAuthStore.getState();
      return {
        city: cityMode,
        name: user?.email || null,
        fuel_hours: wallet.balance,
        xp: wallet.xp,
        travel_style: semanticProfile.travel_style,
        crew: semanticProfile.crew_type,
      };
    },
  },
  {
    domain: 'User',
    name: 'update_preferences',
    description: 'به‌روزرسانی یک ترجیح.',
    declaration: {
      name: 'update_preferences',
      description: 'ذخیره preference_key و value.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          preference_key: { type: Type.STRING },
          value: { type: Type.STRING },
        },
        required: ['preference_key', 'value'],
      },
    },
    validate: (args) => requireString(args, 'preference_key') || requireString(args, 'value'),
    handler: async (args) => {
      await useAuthStore.getState().updatePreference(String(args.preference_key), args.value);
      return `ترجیح ${args.preference_key} ذخیره شد.`;
    },
  },
  {
    domain: 'User',
    name: 'get_interests',
    description: 'علایق مسافر.',
    declaration: {
      name: 'get_interests',
      description: 'لیست interests و food_preferences.',
      parameters: { type: Type.OBJECT, properties: {} },
    },
    handler: async () => {
      const p = useAuthStore.getState().semanticProfile;
      return {
        interests: p.interests || [],
        food: p.food_preferences || [],
        energy: p.energy_level,
      };
    },
  },
  {
    domain: 'User',
    name: 'get_restrictions',
    description: 'محدودیت‌ها و ناپسندها.',
    declaration: {
      name: 'get_restrictions',
      description: 'dislikes و budget_sensitivity.',
      parameters: { type: Type.OBJECT, properties: {} },
    },
    handler: async () => {
      const p = useAuthStore.getState().semanticProfile;
      return {
        dislikes: p.dislikes || [],
        budget: p.budget_sensitivity,
      };
    },
  },

  // ─── Wallet ────────────────────────────────────────────────────────────
  {
    domain: 'Wallet',
    name: 'get_balance',
    description: 'موجودی سوخت و XP.',
    declaration: {
      name: 'get_balance',
      description: 'موجودی کیف پول راوا.',
      parameters: { type: Type.OBJECT, properties: {} },
    },
    handler: async () => {
      const { wallet } = useUserStore.getState();
      return {
        fuel_hours: Number(wallet.balance.toFixed(2)),
        fuel_mins: Math.floor(wallet.balance * 60),
        xp: wallet.xp,
        stamps: wallet.stamps.length,
      };
    },
  },
  {
    domain: 'Wallet',
    name: 'get_transactions',
    description: 'آخرین تراکنش‌های سوخت.',
    declaration: {
      name: 'get_transactions',
      description: 'لیست تراکنش‌ها.',
      parameters: {
        type: Type.OBJECT,
        properties: { limit: { type: Type.NUMBER } },
      },
    },
    handler: async (args) => {
      const limit = Math.min(Number(args.limit) || 10, 30);
      const txs = (useUserStore.getState() as any).fuelTransactions || [];
      return txs.slice(0, limit);
    },
  },
  {
    domain: 'Wallet',
    name: 'estimate_itinerary_cost',
    description: 'تخمین هزینه تقریبی برنامه امروز.',
    declaration: {
      name: 'estimate_itinerary_cost',
      description: 'جمع قیمت‌های ثبت‌شده در جزئیات فعالیت‌ها.',
      parameters: { type: Type.OBJECT, properties: {} },
    },
    handler: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const events = useUserStore.getState().tripEvents.filter((e) => e.date.startsWith(today.slice(0, 7)) || e.date === today);
      const total = events.reduce((sum, e) => sum + (e.details?.price || 0), 0);
      return { currency_hint: 'local', estimated: total, items: events.length };
    },
  },
  {
    domain: 'Wallet',
    name: 'get_rewards',
    description: 'مهرها و پاداش‌ها.',
    declaration: {
      name: 'get_rewards',
      description: 'stamps و referral.',
      parameters: { type: Type.OBJECT, properties: {} },
    },
    handler: async () => {
      const { wallet } = useUserStore.getState();
      return {
        stamps: wallet.stamps.slice(0, 20),
        referralCode: wallet.referralCode,
        xp: wallet.xp,
      };
    },
  },

  // ─── App Control ───────────────────────────────────────────────────────
  {
    domain: 'App',
    name: 'open_tab',
    description: 'باز کردن تب اپ.',
    declaration: {
      name: 'open_tab',
      description: 'home | explore | trip | tools | profile',
      parameters: {
        type: Type.OBJECT,
        properties: {
          tab: { type: Type.STRING, enum: ['home', 'explore', 'trip', 'tools', 'profile'] },
        },
        required: ['tab'],
      },
    },
    validate: (args) => requireString(args, 'tab'),
    handler: async (args) => {
      useUIStore.getState().setActiveTab(args.tab as AppTab);
      return { ok: true, tab: args.tab };
    },
  },
  {
    domain: 'App',
    name: 'open_bottom_sheet',
    description: 'باز کردن شیت POI برای place_id.',
    declaration: {
      name: 'open_bottom_sheet',
      description: 'نمایش شیت مکان.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          place_id: { type: Type.STRING },
          name: { type: Type.STRING },
        },
        required: ['place_id'],
      },
    },
    validate: (args) => requireString(args, 'place_id'),
    handler: async (args) => {
      await selectPOI(
        { id: String(args.place_id), name: (args.name as string) || 'مکان', category: 'place', lat: 0, lng: 0 },
        { source: 'tool', fetchEssentials: true },
      );
      useUIStore.getState().setActiveTab('home');
      return { ok: true };
    },
  },
  {
    domain: 'App',
    name: 'show_passport',
    description: 'باز کردن پاسپورت در پروفایل.',
    declaration: {
      name: 'show_passport',
      description: 'نمایش پاسپورت سفر.',
      parameters: { type: Type.OBJECT, properties: {} },
    },
    handler: async () => {
      useUIStore.getState().setActiveTab('profile');
      return { ok: true, hint: 'تب پروفایل باز شد.' };
    },
  },
  {
    domain: 'App',
    name: 'open_wallet_or_profile',
    description: 'باز کردن سفر من (trip) یا پروفایل. alias: wallet → trip.',
    declaration: {
      name: 'open_wallet_or_profile',
      description: 'target: trip | wallet | profile (wallet is legacy alias for trip)',
      parameters: {
        type: Type.OBJECT,
        properties: {
          target: { type: Type.STRING, enum: ['trip', 'wallet', 'profile'] },
        },
      },
    },
    handler: async (args) => {
      const target = (args.target as string) || 'profile';
      const tab = target === 'wallet' || target === 'trip' ? 'trip' : 'profile';
      useUIStore.getState().setActiveTab(tab);
      return { ok: true, target: tab };
    },
  },
];

export function getToolDeclarations() {
  return tools.map((t) => t.declaration);
}

export function getToolHandlers(): Record<string, ToolHandler> {
  const map: Record<string, ToolHandler> = {};
  for (const t of tools) {
    map[t.name] = async (args) => {
      if (t.validate) {
        const err = t.validate(args);
        if (err) return { error: err };
      }
      return t.handler(args);
    };
  }
  return map;
}

export function listToolsByDomain(): Record<ToolDomain, string[]> {
  return tools.reduce(
    (acc, t) => {
      acc[t.domain] = acc[t.domain] || [];
      acc[t.domain].push(t.name);
      return acc;
    },
    {} as Record<ToolDomain, string[]>,
  );
}

/** Register all Phase-2 tools into the live dispatcher. */
export function wireToolRegistry(
  registerTool: (name: string, handler: ToolHandler) => void,
  declarations: { push: (...items: any[]) => number; length: number },
): void {
  const existing = new Set<string>();
  // declarations may already include legacy tools — skip dup names when pushing
  for (const d of declarations as unknown as { name: string }[]) {
    if (d?.name) existing.add(d.name);
  }

  for (const t of tools) {
    registerTool(t.name, async (args) => {
      if (t.validate) {
        const err = t.validate(args);
        if (err) return { error: err };
      }
      return t.handler(args);
    });
    if (!existing.has(t.name)) {
      (declarations as any[]).push(t.declaration);
      existing.add(t.name);
    }
  }
}

export const TOOL_REGISTRY = tools;

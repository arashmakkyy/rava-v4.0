import { Type, FunctionCall } from '@google/genai';
import { discoveryService } from '../discoveryService';
import { GeoPoint } from '../../utils/geoPoint';
import { useMapStore } from '../../store/useMapStore';
import { useUserStore } from '../../store/useUserStore';
import { useAuthStore } from '../../store/useAuthStore';
import { useDiscoveryStore } from '../../store/useDiscoveryStore';
import { conversationState } from './conversationState';
import { logContextVolume } from '../../prompts';
import { wireToolRegistry, TOOL_REGISTRY } from '../ai/toolRegistry';
import { requestToolConfirm } from './toolConfirmation';

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

/** Gemini Live function declarations (shared by sessionManager). */
export const LIVE_TOOL_DECLARATIONS: any[] = [
  {
    name: 'search_nearby',
    description: 'جستجوی مکان‌های اطراف بر اساس مود و شعاع.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        mood: { type: Type.STRING, enum: ['luxury', 'budget', 'instagrammable', 'hidden_gem'] },
        radius: { type: Type.NUMBER },
      },
      required: ['mood'],
    },
  },
  {
    name: 'get_user_context',
    description:
      'دریافت کانتکست پویای مسافر: مختصات، سوخت، شهر، زبان، نوع سفر، تنظیمات صدا و ترجیحات.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'update_user_preference',
    description: 'ذخیره یک ترجیح یا علاقه جدید در پروفایل دائمی مسافر.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        preference_key: { type: Type.STRING, description: 'مثلاً food_preferences یا dislikes' },
        value: { type: Type.STRING },
      },
      required: ['preference_key', 'value'],
    },
  },
];

const toolRegistry: Record<string, ToolHandler> = {
  async search_nearby(args) {
    const userLocation = useMapStore.getState().userLocation;
    const geo = GeoPoint.fromArray(userLocation);
    const results = await discoveryService.searchNearby(
      geo?.lat || 0,
      geo?.lng || 0,
      (args.radius as number) || 5000,
      args.mood as string | undefined,
    );
    useDiscoveryStore.getState().setDiscoveredPlaces(results);
    return results.length > 0 ? results : 'چیزی پیدا نکردم رفیق.';
  },

  async get_user_context() {
    const userLocation = useMapStore.getState().userLocation;
    const geo = GeoPoint.fromArray(userLocation);
    const { wallet, cityMode } = useUserStore.getState();
    const { semanticProfile } = useAuthStore.getState();
    const voice = semanticProfile.voice_config;

    const payload = {
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
      city: cityMode,
      language: 'fa-IR',
      fuel_mins: Math.floor(wallet.balance * 60),
      fuel_hours: Number(wallet.balance.toFixed(2)),
      trip_type: semanticProfile.travel_style ?? null,
      crew_type: semanticProfile.crew_type ?? null,
      is_traveling_now: semanticProfile.is_traveling_now ?? null,
      voice: {
        name: voice?.voiceName ?? 'Kore',
        speech_rate: voice?.speechRate ?? 1,
      },
      preferences: semanticProfile,
      local_time: new Date().toLocaleString('fa-IR', { hour12: false }),
    };

    logContextVolume('get_user_context response', JSON.stringify(payload));
    return payload;
  },

  async update_user_preference(args) {
    const key = args.preference_key as string;
    const value = args.value;
    await useAuthStore.getState().updatePreference(key, value);
    return `حافظه‌ی من آپدیت شد: ${key} برای مسافر ثبت شد.`;
  },
};

export function registerTool(name: string, handler: ToolHandler) {
  toolRegistry[name] = handler;
}

// Phase 2 tool registry (Map / Trip / User / Wallet / App) — once at module load
wireToolRegistry(registerTool, LIVE_TOOL_DECLARATIONS);

/**
 * Dispatch tool calls from Gemini Live to the registry and send responses.
 * Failed tools return soft errors to the model without killing the session.
 *
 * Gated tools (requiresConfirmation) PAUSE here: the sheet is shown via
 * requestToolConfirm and execution resumes only after the user decides.
 * A cancel produces an explicit {cancelled:true} result for the model —
 * the side effect never runs.
 */
export async function dispatchToolCalls(
  functionCalls: FunctionCall[],
  sendResponse: (responses: { id?: string; name?: string; response: { result: unknown } }[]) => void,
): Promise<void> {
  conversationState.setThinking(true);

  const responses: { id?: string; name?: string; response: { result: unknown } }[] = [];

  for (const fc of functionCalls) {
    const registered = TOOL_REGISTRY.find((t) => t.name === fc.name);
    if (registered?.requiresConfirmation) {
      const callId = fc.id || `${fc.name}:${Date.now()}`;
      const approved = await requestToolConfirm(
        callId,
        fc.name || '',
        registered.confirmLabel || 'این کار انجام شود؟',
      );
      if (!approved) {
        responses.push({
          id: fc.id,
          name: fc.name,
          response: {
            result: {
              cancelled: true,
              message: 'کاربر این کار را لغو کرد. هیچ تغییری انجام نشد.',
            },
          },
        });
        continue;
      }
    }

    const handler = toolRegistry[fc.name || ''];
    let result: unknown = 'اوکی شد.';

    try {
      if (handler) {
        result = await handler((fc.args as Record<string, unknown>) || {});
      } else {
        console.warn(`[ToolDispatcher] Unknown tool: ${fc.name}`);
        result = `ابزار ${fc.name} را نمی‌شناسم.`;
      }
    } catch (err) {
      console.error(`[ToolDispatcher] ${fc.name} failed:`, err);
      result = {
        error: true,
        message: 'یه مشکل فنی پیش اومد رفیق، یه بار دیگه بگو.',
        detail: err instanceof Error ? err.message : String(err),
      };
    }

    responses.push({
      id: fc.id,
      name: fc.name,
      response: { result },
    });
  }

  sendResponse(responses);
}

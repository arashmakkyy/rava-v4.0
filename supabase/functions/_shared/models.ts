/**
 * Central Gemini model registry for Rava Edge Functions.
 *
 * Single source of truth for production model IDs. Before changing any ID,
 * revalidate against the current models list:
 *   https://ai.google.dev/gemini-api/docs/models
 * and exercise every affected task in B0 (a renamed/retired model fails LOUDLY
 * at call time — there is no compile-time protection for model strings).
 *
 * Task fit (deliberate, not one-size-fits-all):
 *  - TICKET_OCR / PRICE_VERIFY / DREAMER / BARGAIN / PLAN: gemini-3-flash-preview
 *    (repo-standard vision+JSON workhorse).
 *  - RECAP / VIBE: same 3-flash-preview. (Retired: gemini-2.0-flash and
 *    gemini-1.5-flash were unified here for availability; revisit only with
 *    a cost/quality measurement behind each task.)
 *  - LIVE: pinned separately below. Live preview models churn fast; the B0
 *    behavioral probe (real key, real connect) is the source of truth for
 *    this ID — do NOT rotate it blindly. Client mirror: sessionManager LIVE_MODEL.
 */
export const AI_MODELS = {
  TICKET_OCR: 'gemini-3-flash-preview',
  PRICE_VERIFY: 'gemini-3-flash-preview',
  DREAMER: 'gemini-3-flash-preview',
  BARGAIN: 'gemini-3-flash-preview',
  PLAN: 'gemini-3-flash-preview',
  RECAP: 'gemini-3-flash-preview',
  VIBE: 'gemini-3-flash-preview',
  LIVE: 'gemini-2.5-flash-native-audio-preview-12-2025',
} as const;

export type AiModelKey = keyof typeof AI_MODELS;

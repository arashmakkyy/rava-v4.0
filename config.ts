
/**
 * مرکز تنظیمات و کلیدهای پروژه
 * استانداردسازی شده برای محیط Vite (استفاده از import.meta.env)
 */

// تابع کمکی برای دسترسی ایمن به متغیرهای محیطی
const getEnv = (key: string, fallback: string = ''): string => {
  if (typeof import.meta !== 'undefined' && (import.meta as any).env) {
    return (import.meta as any).env[key] || fallback;
  }
  return fallback;
};

export const APP_CONFIG = {
  SUPABASE: {
    URL: getEnv('VITE_SUPABASE_URL', "https://thmsfdugojokxtemnqdw.supabase.co"),
    ANON_KEY: getEnv('VITE_SUPABASE_ANON_KEY', "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRobXNmZHVnb2pva3h0ZW1ucWR3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzODY2MTAsImV4cCI6MjA4NTk2MjYxMH0.Vk2wJZ1JY25-ihO1NF_UNtIy5O2t6gwBI7Y5ieFxaV0")
  },
  GOOGLE: {
    // Dedicated Vite env vars only — no embedded API key fallbacks.
    // NOTE: Gemini is NEVER bundled in the client. Live voice uses short-lived
    // ephemeral tokens (mint-live-token Edge Function); other AI calls go through
    // the authenticated ai-complete proxy. Do NOT add a client Gemini key here.
    MAPS_API_KEY: getEnv('VITE_GOOGLE_MAPS_API_KEY', ''),
    // Cloud Map ID for AdvancedMarker + styling. Production MUST set
    // VITE_GOOGLE_MAPS_MAP_ID to the styled Map ID of the billed project.
    // Local dev falls back to Google's public DEMO_MAP_ID (unstyled, but loads
    // with any valid key — a hardcoded production Map ID + demo key = blank map).
    MAPS_MAP_ID: getEnv('VITE_GOOGLE_MAPS_MAP_ID', 'DEMO_MAP_ID'),
  }
};

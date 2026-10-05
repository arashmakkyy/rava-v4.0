
import { createClient } from '@supabase/supabase-js';
import { APP_CONFIG } from '../config';

/**
 * کلاینت سوپابیس راوا
 * متصل به تنظیمات مرکزی (APP_CONFIG) که از متغیرهای محیطی Vite تغذیه می‌کند.
 * فقط ANON KEY — بدون service role در فرانت‌اند.
 */

export const supabase = createClient(
  APP_CONFIG.SUPABASE.URL, 
  APP_CONFIG.SUPABASE.ANON_KEY, 
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage
    }
  }
);

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { supabase } from '../services/supabaseClient';
import { CityMode, SemanticProfile } from '../types';
import { dbService } from '../services/dbService';
import { useUserStore } from './useUserStore';
import { migrateLocalStorageKey } from '../utils/storageMigration';

migrateLocalStorageKey('rahnam-auth-storage-v3', 'rava-auth-storage-v3');

export type AuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_NOT_CONFIRMED'
  | 'USER_ALREADY_EXISTS'
  | 'RATE_LIMIT'
  | 'UNKNOWN';

export interface AuthResult {
  success: boolean;
  errorCode?: AuthErrorCode;
  message?: string;
}

interface AuthState {
  session: any | null;
  user: any | null;
  onboardingCompleted: boolean;
  isAuthInitialized: boolean;
  semanticProfile: SemanticProfile;
  _hasHydrated: boolean;

  setHasHydrated: (val: boolean) => void;
  initializeAuth: () => Promise<void>;
  hydrateFromProfile: (userId: string) => Promise<void>;
  login: (email: string, pass: string) => Promise<AuthResult>;
  signUp: (email: string, pass: string) => Promise<AuthResult>;
  resetPassword: (email: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  finalizeOnboarding: (data: {
    city: CityMode;
    vibe: string;
    crew: string;
    isTravelingNow: boolean;
  }) => Promise<void>;
  updatePreference: (key: string, value: any) => Promise<void>;
  updateProfile: (updates: {
    username?: string;
    avatar_url?: string;
  }) => Promise<void>;
  removeSemanticTag: (category: keyof SemanticProfile, tag: string) => Promise<void>;
  updateVoiceSettings: (voiceName: string, speechRate: number) => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      session: null,
      user: null,
      onboardingCompleted: false,
      isAuthInitialized: false,
      semanticProfile: {},
      _hasHydrated: false,

      setHasHydrated: (val) => set({ _hasHydrated: val }),

      hydrateFromProfile: async (userId: string) => {
        const metaFallback =
          get().user?.user_metadata?.onboarding_completed ??
          get().onboardingCompleted ??
          false;

        try {
          const { data: profile, error } = await supabase
            .from('profiles')
            .select(
              'onboarding_completed, current_city, semantic_profile, username, avatar_url'
            )
            .eq('id', userId)
            .maybeSingle();

          if (error || !profile) {
            set({ onboardingCompleted: !!metaFallback });
            return;
          }

          const semantic = (profile.semantic_profile || {}) as SemanticProfile;
          const completed =
            profile.onboarding_completed === true ||
            get().onboardingCompleted === true ||
            !!metaFallback;
          set({
            onboardingCompleted: completed,
            semanticProfile: Object.keys(semantic).length
              ? semantic
              : get().semanticProfile,
          });

          if (profile.current_city) {
            useUserStore.getState().setCityMode(profile.current_city as CityMode);
          }
          useUserStore.setState({ semanticProfile: semantic });

          // Keep auth metadata username/avatar in sync for UI that reads user_metadata
          const meta: Record<string, unknown> = {};
          if (profile.username) meta.username = profile.username;
          if (profile.avatar_url) meta.avatar_url = profile.avatar_url;
          if (Object.keys(meta).length > 0 && get().user) {
            set({
              user: {
                ...get().user,
                user_metadata: { ...get().user.user_metadata, ...meta },
              },
            });
          }
        } catch {
          set({ onboardingCompleted: !!metaFallback });
        }
      },

      initializeAuth: async () => {
        supabase.auth.onAuthStateChange(async (event, session) => {
          const user = session?.user ?? null;
          set({
            session,
            user,
            isAuthInitialized: true,
          });

          if (user) {
            await get().hydrateFromProfile(user.id);
          } else if (event === 'SIGNED_OUT') {
            set({ onboardingCompleted: false, semanticProfile: {} });
            supabase.removeAllChannels();
          }
        });

        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          const user = session?.user ?? null;
          set({
            session,
            user,
            isAuthInitialized: true,
          });
          if (user) {
            await get().hydrateFromProfile(user.id);
          }
        } catch {
          set({ isAuthInitialized: true });
        }
      },

      login: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) {
          if (error.message.includes('Email not confirmed')) {
            return {
              success: false,
              errorCode: 'EMAIL_NOT_CONFIRMED',
              message: 'ایمیلت هنوز تایید نشده رفیق.',
            };
          }
          if (error.message.includes('Invalid login credentials')) {
            return {
              success: false,
              errorCode: 'INVALID_CREDENTIALS',
              message: 'ایمیل یا رمز عبورت درست نیست.',
            };
          }
          return {
            success: false,
            errorCode: 'UNKNOWN',
            message: 'یه مشکل فنی پیش اومد.',
          };
        }
        return { success: true };
      },

      signUp: async (email, password) => {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) {
          if (error.message.includes('already registered')) {
            return {
              success: false,
              errorCode: 'USER_ALREADY_EXISTS',
              message: 'این ایمیل قبلاً هست، وارد شو.',
            };
          }
          return {
            success: false,
            errorCode: 'UNKNOWN',
            message: error.message,
          };
        }
        return { success: true };
      },

      resetPassword: async (email: string) => {
        const redirectTo = `${window.location.origin}/`;
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo,
        });
        if (error) {
          if (error.message.toLowerCase().includes('rate')) {
            return {
              success: false,
              errorCode: 'RATE_LIMIT',
              message: 'خیلی سریع درخواست دادی، کمی صبر کن.',
            };
          }
          return {
            success: false,
            errorCode: 'UNKNOWN',
            message: error.message || 'ارسال ایمیل بازیابی ناموفق بود.',
          };
        }
        return { success: true };
      },

      finalizeOnboarding: async (data) => {
        const { user } = get();
        if (!user || !data.city) return;

        const semanticData: SemanticProfile = {
          travel_style: data.vibe,
          crew_type: data.crew as SemanticProfile['crew_type'],
          is_traveling_now: data.isTravelingNow,
          last_summary_at: new Date().toISOString(),
        };

        const tripPayload = {
          id: crypto.randomUUID(),
          user_id: user.id,
          type: 'activity' as const,
          title: `شروع ماجراجویی در ${data.city}`,
          start_time: data.isTravelingNow ? new Date().toISOString() : null,
          status: 'upcoming' as const,
        };

        const profilePayload = {
          id: user.id,
          current_city: data.city,
          semantic_profile: semanticData,
          onboarding_completed: true,
        };

        // Persist profile FIRST so hydrateFromProfile (triggered by updateUser)
        // cannot race and reset onboardingCompleted back to false.
        let profileSaved = false;
        try {
          const { error: profileError } = await supabase
            .from('profiles')
            .upsert(profilePayload, { onConflict: 'id' });
          if (profileError) throw profileError;
          profileSaved = true;

          const { error: tripError } = await supabase
            .from('trips')
            .insert(tripPayload);
          if (tripError) throw tripError;
        } catch {
          await dbService.pushToOutbox({
            type: 'FINALIZE_ONBOARDING',
            payload: { profile: profilePayload, trip: tripPayload },
          }, user.id);
        }

        set({ onboardingCompleted: true, semanticProfile: semanticData });
        useUserStore.getState().setCityMode(data.city);

        try {
          await supabase.auth.updateUser({
            data: { onboarding_completed: true },
          });
        } catch {
          /* metadata is secondary; profile row is source of truth */
        }

        // Re-hydrate after writes so AuthGuard stays on Dashboard
        if (profileSaved) {
          await get().hydrateFromProfile(user.id);
        }
      },

      updatePreference: async (key, value) => {
        const { user, semanticProfile } = get();
        if (!user) return;
        const prev = semanticProfile;
        const newProfile = { ...semanticProfile, [key]: value };
        set({ semanticProfile: newProfile });
        const { error } = await supabase
          .from('profiles')
          .update({ semantic_profile: newProfile })
          .eq('id', user.id);
        if (error) set({ semanticProfile: prev });
      },

      updateProfile: async (updates) => {
        const { user } = get();
        if (!user) return;

        const prevUser = user;
        const optimisticUser = {
          ...user,
          user_metadata: { ...user.user_metadata, ...updates },
        };
        set({ user: optimisticUser });

        try {
          const { data, error } = await supabase.auth.updateUser({
            data: { ...user.user_metadata, ...updates },
          });
          if (error) throw error;

          const profileUpdates: Record<string, string> = {};
          if (updates.username) profileUpdates.username = updates.username;
          if (updates.avatar_url) profileUpdates.avatar_url = updates.avatar_url;

          if (Object.keys(profileUpdates).length > 0) {
            const { error: profileError } = await supabase
              .from('profiles')
              .update(profileUpdates)
              .eq('id', user.id);
            if (profileError) throw profileError;
          }

          set({ user: data.user });
        } catch (err) {
          set({ user: prevUser });
          throw err;
        }
      },

      removeSemanticTag: async (category, tag) => {
        const { user, semanticProfile } = get();
        if (!user) return;

        const currentVal = semanticProfile[category];
        if (!Array.isArray(currentVal)) return;

        const prev = semanticProfile;
        const newVal = currentVal.filter((t) => t !== tag);
        const newProfile = { ...semanticProfile, [category]: newVal };
        set({ semanticProfile: newProfile });

        const { error } = await supabase
          .from('profiles')
          .update({ semantic_profile: newProfile })
          .eq('id', user.id);
        if (error) set({ semanticProfile: prev });
      },

      updateVoiceSettings: async (voiceName, speechRate) => {
        const { user, semanticProfile } = get();
        if (!user) return;

        const prev = semanticProfile;
        const newProfile = {
          ...semanticProfile,
          voice_config: { voiceName, speechRate },
        };
        set({ semanticProfile: newProfile });

        const { error } = await supabase
          .from('profiles')
          .update({ semantic_profile: newProfile })
          .eq('id', user.id);
        if (error) set({ semanticProfile: prev });
      },

      signOut: async () => {
        await supabase.auth.signOut();
        localStorage.clear();
        window.location.reload();
      },
    }),
    {
      name: 'rava-auth-storage-v3',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => {
        const {
          session,
          user,
          isAuthInitialized,
          _hasHydrated,
          ...rest
        } = state;
        return rest;
      },
      onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
    }
  )
);

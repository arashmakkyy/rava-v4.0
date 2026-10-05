
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  UserState,
  CityMode,
  TripEvent,
  Trip,
  Stamp,
  FuelTransaction,
  Favorite,
  POI,
  TripLifecycleStatus,
  TripBudgetSnapshot,
  RewardEventType,
} from '../types';
import { supabase } from '../services/supabaseClient';
import { useUIStore } from './useUIStore';
import { AudioGraph } from '../services/audioGraph';
import { dbService } from '../services/dbService';
import { migrateLocalStorageKey } from '../utils/storageMigration';
import { getStaticTrip } from '../data/staticTrips';
import {
  addDaysIso,
  mapDbTripToEvent,
  mapDbUserTrip,
  mapEventToDbPayload,
  mapTripToDbPayload,
  normalizeActivityStatus,
  sortEvents,
  suggestNextActivity,
  todayIso,
} from '../utils/tripMapper';

migrateLocalStorageKey('rahnam-data-storage-v3', 'rava-data-storage-v3');

interface CleanUserState extends Omit<
  UserState,
  'session' | 'user' | 'onboardingCompleted' | 'setSession' | 'completeOnboarding' | 'signOut'
> {
  isStamping: boolean;
  isOnline: boolean;
  fuelTransactions: FuelTransaction[];
  setIsOnline: (val: boolean) => void;
  deductFuel: (seconds: number, reason?: string) => Promise<void>;
  hasActiveTrip: () => boolean;
  fetchFuelHistory: () => Promise<void>;
  setActiveTripLocal: (trip: Trip | null) => void;
  claimReward: (type: RewardEventType, transactionId?: string) => Promise<void>;
  recordStreak: () => Promise<void>;
  updateTripBudget: (patch: {
    totalBudget?: number;
    estimatedCost?: number;
    expenseDelta?: number;
    dailyExpenses?: number;
  }) => Promise<TripBudgetSnapshot | null>;
}

async function resolveUserId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

function pickActiveTrip(trips: Trip[]): Trip | null {
  const priority: TripLifecycleStatus[] = ['active', 'paused', 'upcoming', 'planning'];
  for (const status of priority) {
    const found = trips.find((t) => t.status === status);
    if (found) return found;
  }
  return trips[0] || null;
}

function budgetFromTrip(trip: Trip | null | undefined): TripBudgetSnapshot | null {
  if (!trip) return null;
  const total = Number(trip.totalBudget ?? 0);
  const recorded = Number(trip.recordedExpenses ?? 0);
  const remaining = total - recorded;
  return {
    total_budget: total,
    daily_expenses: Number(trip.dailyExpenses ?? 0),
    recorded_expenses: recorded,
    estimated_cost: Number(trip.estimatedCost ?? 0),
    remaining,
    over_budget: remaining < 0,
    currency: trip.currency ?? 'IRT',
  };
}

export const useUserStore = create<CleanUserState>()(
  persist(
    (set, get) => ({
      cityMode: null,
      wallet: {
        balance: 2.0,
        xp: 0,
        stamps: [],
        currentStreak: 0,
        lastActiveDate: null,
      },
      tripEvents: [],
      trips: [],
      activeTrip: null,
      tripBudget: null,
      fuelTransactions: [],
      favorites: [],
      isSyncing: false,
      isStamping: false,
      isOnline: navigator.onLine,
      semanticProfile: {},

      setIsOnline: (val) => set({ isOnline: val }),
      setCityMode: (mode: CityMode) => set({ cityMode: mode }),
      setActiveTripLocal: (trip) => set({ activeTrip: trip }),

      hasActiveTrip: () => {
        const { activeTrip, tripEvents } = get();
        if (activeTrip?.status === 'active' || activeTrip?.status === 'paused') return true;
        if (tripEvents.length === 0) return false;
        const now = new Date();
        return tripEvents.some((e) => {
          const open =
            e.status === 'upcoming' ||
            e.status === 'pending' ||
            e.status === 'now' ||
            e.status === 'active';
          const endDate = e.start_time
            ? new Date(new Date(e.start_time).getTime() + 7 * 24 * 60 * 60 * 1000)
            : null;
          return open && (!endDate || endDate > now);
        });
      },

      updateWallet: (balance: number, xp: number) =>
        set((state) => ({
          wallet: { ...state.wallet, balance, xp },
        })),

      subscribeToUpdates: async () => {
        const { isOnline } = get();
        if (!isOnline) return;

        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        supabase.removeAllChannels();

        supabase
          .channel('schema-db-changes')
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'profiles',
              filter: `id=eq.${user.id}`,
            },
            (payload: { new: Record<string, any> }) => {
              const newBalance = payload.new.wallet_balance;
              const newXP = payload.new.xp_level;
              const oldBalance = get().wallet.balance;

              set((state) => ({
                wallet: {
                  ...state.wallet,
                  balance: newBalance,
                  xp: newXP,
                  currentStreak: payload.new.current_streak ?? state.wallet.currentStreak,
                  lastActiveDate: payload.new.last_active_date ?? state.wallet.lastActiveDate,
                },
              }));

              if (newBalance > oldBalance) {
                const diffMins = Math.floor((newBalance - oldBalance) * 60);
                useUIStore.getState().setRewardNotify({
                  show: true,
                  amount: `${diffMins} دقیقه شارژ`,
                });
                AudioGraph.getInstance().playCoinSound();
                setTimeout(() => useUIStore.getState().setRewardNotify(null), 5000);
              }
              get().fetchFuelHistory();
            }
          )
          .subscribe();
      },

      fetchFuelHistory: async () => {
        const { data } = await supabase
          .from('reward_ledger')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(40);

        if (data) {
          set({
            fuelTransactions: data.map((t: { transaction_id: string; amount: number; reward_type: string; reference_id: string | null; created_at: string }) => ({
              id: t.transaction_id,
              amount: t.amount,
              type: t.reward_type,
              reference_id: t.reference_id,
              reason: t.reference_id ?? undefined,
              created_at: t.created_at,
            })),
          });
        }
      },

      deductFuel: async (seconds: number, reason = 'مکالمه صوتی') => {
        if (!seconds || seconds <= 0) return;
        const hours = seconds / 3600.0;
        const transactionId = crypto.randomUUID();
        const currentBalance = get().wallet.balance;
        // Optimistic hours deduct; reconcile via syncWithCloud after outbox
        set((state) => ({
          wallet: { ...state.wallet, balance: Math.max(0, currentBalance - hours) },
        }));
        const userId = await resolveUserId();
        await dbService.pushToOutbox({
          type: 'DEDUCT_FUEL',
          payload: {
            seconds,
            reason,
            // Stable id — syncManager must reuse on retry (never regenerate)
            transaction_id: transactionId,
          },
        }, userId);
      },

      claimReward: async (type: RewardEventType, transactionId?: string) => {
        // Server derives entitlement (reference/amounts) from the reward type only.
        // transactionId is purely a transport idempotency key for retried outbox delivery.
        const txId = transactionId ?? crypto.randomUUID();
        const optimistic: Record<string, { fuel: number; xp: number }> = {
          stamp: { fuel: 0.1, xp: 50 },
          daily_itinerary: { fuel: 0.05, xp: 75 },
          profile_complete: { fuel: 0.2, xp: 100 },
          achievement: { fuel: 0.1, xp: 150 },
        };
        const hint = optimistic[type];
        if (hint) {
          set((state) => ({
            wallet: {
              ...state.wallet,
              balance: state.wallet.balance + hint.fuel,
              xp: state.wallet.xp + hint.xp,
            },
          }));
        }
        await dbService.pushToOutbox({
          type: 'CLAIM_REWARD',
          payload: {
            px_transaction_id: txId,
            px_reward_type: type,
          },
        }, await resolveUserId());
      },

      recordStreak: async () => {
        await dbService.pushToOutbox({
          type: 'RECORD_STREAK',
          payload: { date: new Date().toISOString().slice(0, 10) },
        }, await resolveUserId());
      },

      updateTripBudget: async (patch) => {
        const journeyId = get().activeTrip?.id;
        if (!journeyId) return null;

        const { data, error } = await supabase.rpc('update_trip_budget', {
          px_journey_id: journeyId,
          px_total_budget: patch.totalBudget ?? null,
          px_estimated_cost: patch.estimatedCost ?? null,
          px_expense_delta: patch.expenseDelta ?? null,
          px_daily_expenses: patch.dailyExpenses ?? null,
        });

        if (error) {
          console.error('[updateTripBudget]', error);
          return null;
        }

        const snap = data as TripBudgetSnapshot;
        set((state) => ({
          tripBudget: snap,
          semanticProfile: { ...state.semanticProfile, trip_budget: snap },
          activeTrip: state.activeTrip
            ? {
                ...state.activeTrip,
                totalBudget: snap.total_budget,
                dailyExpenses: snap.daily_expenses,
                recordedExpenses: snap.recorded_expenses,
                estimatedCost: snap.estimated_cost,
                currency: snap.currency,
              }
            : null,
        }));
        return snap;
      },

      toggleFavorite: async (poi: POI) => {
        const { favorites } = get();
        const isFav = favorites.some((f) => f.placeId === poi.id);

        if (isFav) {
          set({ favorites: favorites.filter((f) => f.placeId !== poi.id) });
          await supabase.from('favorites').delete().eq('place_id', poi.id);
        } else {
          const newFav: Favorite = {
            id: crypto.randomUUID(),
            placeId: poi.id,
            snapshot: {
              name: poi.name,
              image: poi.image,
              category: poi.category,
              lat: poi.lat,
              lng: poi.lng,
              address: poi.address,
            },
          };
          set({ favorites: [newFav, ...favorites] });
          await supabase.from('favorites').insert({
            place_id: poi.id,
            place_snapshot: newFav.snapshot,
          });
        }
        AudioGraph.haptic(10);
      },

      claimReferral: async (code: string) => {
        const { error } = await supabase.rpc('claim_referral', { px_code: code });
        if (error) throw error;
        await get().syncWithCloud();
        AudioGraph.getInstance().playCoinSound();
      },

      addStamp: async (stamp: Stamp) => {
        const { wallet, isStamping, cityMode } = get();
        if (isStamping || wallet.stamps.some((s) => s.placeId === stamp.placeId)) return;

        set({ isStamping: true });

        set((state) => ({
          wallet: {
            ...state.wallet,
            stamps: [stamp, ...state.wallet.stamps],
            balance: state.wallet.balance + 0.1,
            xp: state.wallet.xp + 50,
          },
        }));

        const transactionId = crypto.randomUUID();
        await dbService.pushToOutbox({
          type: 'PROCESS_STAMP',
          payload: {
            px_transaction_id: transactionId,
            px_place_id: stamp.placeId,
            px_place_name: stamp.placeName,
            px_city: cityMode || 'Unknown',
            px_lat: stamp.lat ?? null,
            px_lng: stamp.lng ?? null,
          },
        }, await resolveUserId());

        set({ isStamping: false });
      },

      syncWithCloud: async () => {
        const { isOnline } = get();
        if (!isOnline) return;

        set({ isSyncing: true });
        try {
          const { data: profile, error: profileError } = await supabase.from('profiles').select('*').single();
          const { data: tripRows, error: tripsError } = await supabase
            .from('trips')
            .select('*')
            .order('start_time', { ascending: true });
          const { data: journeyRows, error: journeysError } = await supabase
            .from('user_trips')
            .select('*')
            .order('updated_at', { ascending: false });
          const { data: stamps, error: stampsError } = await supabase
            .from('stamps')
            .select('*')
            .order('created_at', { ascending: false });
          const { data: favs, error: favsError } = await supabase
            .from('favorites')
            .select('*')
            .order('created_at', { ascending: false });

          // A failed query returns { data: null, error } — never confuse it with
          // an empty list, or local state gets wiped by a network/RLS hiccup.
          if (profile && !profileError) {
            const prev = get();
            set({
              wallet: {
                balance: profile.wallet_balance,
                xp: profile.xp_level,
                referralCode: profile.referral_code,
                isReferred: !!profile.referred_by,
                currentStreak: profile.current_streak ?? 0,
                lastActiveDate: profile.last_active_date ?? null,
                stamps: !stampsError
                  ? (stamps || []).map((s: { id: string; place_id: string; place_name: string; created_at: string; city?: string | null }) => ({
                      id: s.id,
                      placeId: s.place_id,
                      placeName: s.place_name,
                      date: new Date(s.created_at).toISOString().slice(0, 10),
                      city: s.city || undefined,
                    }))
                  : prev.wallet.stamps,
              },
              favorites: !favsError
                ? (favs || []).map((f: { id: string; place_id: string; place_snapshot: Favorite['snapshot'] }) => ({
                    id: f.id,
                    placeId: f.place_id,
                    snapshot: f.place_snapshot,
                  }))
                : prev.favorites,
              semanticProfile: profile.semantic_profile || {},
              // Tehran is not a selectable MVP city (no curated pack/map coverage).
              // Legacy Tehran profiles are coerced to unset so the user re-picks
              // Istanbul/Dubai via the city picker instead of falling back to Dubai silently.
              ...(profile.current_city && profile.current_city !== 'Tehran'
                ? { cityMode: profile.current_city as CityMode }
                : { cityMode: null }),
            });
            if (profile.current_city === 'Tehran') {
              useUIStore.getState().setShowCityPicker(true);
            }

            try {
              const { useAuthStore } = await import('./useAuthStore');
              useAuthStore.setState({
                semanticProfile: profile.semantic_profile || {},
                onboardingCompleted:
                  profile.onboarding_completed ?? useAuthStore.getState().onboardingCompleted,
              });
            } catch {
              /* ignore circular load races */
            }
          }

          if (!tripsError && !journeysError) {
            const trips = (journeyRows || []).map(mapDbUserTrip);
            const tripEvents = sortEvents((tripRows || []).map(mapDbTripToEvent));
            const active = pickActiveTrip(trips);
            const budget = budgetFromTrip(active);
            set({
              trips,
              tripEvents,
              activeTrip: active,
              tripBudget: budget,
              ...(budget
                ? {
                    semanticProfile: {
                      ...get().semanticProfile,
                      trip_budget: budget,
                    },
                  }
                : {}),
            });
          }

          await get().fetchFuelHistory();
        } catch (e) {
          console.error('Cloud Sync Failed:', e);
        } finally {
          set({ isSyncing: false });
        }
      },

      addTripEvent: async (event: TripEvent) => {
        const normalized: TripEvent = {
          ...event,
          status: normalizeActivityStatus(event.status),
          sequence: event.sequence ?? get().tripEvents.length,
          journeyId: event.journeyId || get().activeTrip?.id,
        };
        set((state) => ({
          tripEvents: sortEvents([...state.tripEvents, normalized]),
        }));
        const userId = await resolveUserId();
        await dbService.pushToOutbox({
          type: 'ADD_TRIP_EVENT',
          payload: mapEventToDbPayload(normalized, userId || undefined),
        }, userId);
      },

      removeTripEvent: async (id: string) => {
        set((state) => ({
          tripEvents: state.tripEvents.filter((e) => e.id !== id),
        }));
        await dbService.pushToOutbox({
          type: 'REMOVE_TRIP_EVENT',
          payload: { id },
        }, await resolveUserId());
      },

      updateTripEvent: async (id: string, patch: Partial<TripEvent>) => {
        let updated: TripEvent | null = null;
        set((state) => {
          const tripEvents = sortEvents(
            state.tripEvents.map((e) => {
              if (e.id !== id) return e;
              updated = {
                ...e,
                ...patch,
                status: normalizeActivityStatus(patch.status ?? e.status),
                details: { ...e.details, ...patch.details },
              };
              return updated!;
            })
          );
          return { tripEvents };
        });
        if (updated) {
          const userId = await resolveUserId();
          await dbService.pushToOutbox({
            type: 'UPDATE_TRIP_EVENT',
            payload: mapEventToDbPayload(updated, userId || undefined),
          }, userId);
        }
      },

      startActivity: async (id: string) => {
        const { tripEvents, updateTripEvent } = get();
        for (const e of tripEvents) {
          if (e.status === 'active' || e.status === 'now') {
            await updateTripEvent(e.id, { status: 'pending' });
          }
        }
        await updateTripEvent(id, { status: 'active' });
        AudioGraph.haptic(10);
      },

      completeActivity: async (id: string) => {
        await get().updateTripEvent(id, { status: 'completed' });
        const next = suggestNextActivity(get().tripEvents, id);
        AudioGraph.haptic(15);
        return { next };
      },

      skipActivity: async (id: string) => {
        await get().updateTripEvent(id, { status: 'skipped' });
        const next = suggestNextActivity(get().tripEvents, id);
        return { next };
      },

      rescheduleActivity: async (id: string, time: string, date?: string) => {
        const event = get().tripEvents.find((e) => e.id === id);
        if (!event) return;
        const nextDate = date || event.date;
        await get().updateTripEvent(id, {
          time,
          date: nextDate,
          start_time: `${nextDate}T${time}:00`,
        });
      },

      replaceActivity: async (id: string, replacement: Partial<TripEvent>) => {
        await get().updateTripEvent(id, {
          ...replacement,
          status: 'pending',
        });
      },

      createTrip: async (draft) => {
        const userId = await resolveUserId();
        const trip: Trip = {
          id: crypto.randomUUID(),
          city: draft.city,
          title: draft.title,
          status: draft.status || 'planning',
          startDate: draft.startDate || todayIso(),
          endDate: draft.endDate || draft.startDate || todayIso(),
          budgetStyle: draft.budgetStyle,
          interests: draft.interests || [],
          templateId: draft.templateId || null,
          passportEntry: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        set((state) => ({
          trips: [trip, ...state.trips],
          activeTrip: trip,
          ...(draft.city ? { cityMode: draft.city } : {}),
        }));

        await dbService.pushToOutbox({
          type: 'UPSERT_USER_TRIP',
          payload: mapTripToDbPayload(trip, userId || undefined),
        }, userId);

        return trip;
      },

      startTrip: async (tripId) => {
        const { trips, activeTrip } = get();
        const id = tripId || activeTrip?.id;
        if (!id) return;
        const trip = trips.find((t) => t.id === id) || activeTrip;
        if (!trip) return;

        const updated: Trip = {
          ...trip,
          status: 'active',
          updatedAt: new Date().toISOString(),
        };
        set((state) => ({
          trips: state.trips.map((t) => (t.id === id ? updated : t)),
          activeTrip: updated,
          ...(updated.city ? { cityMode: updated.city } : {}),
        }));

        const userId = await resolveUserId();
        await dbService.pushToOutbox({
          type: 'UPSERT_USER_TRIP',
          payload: mapTripToDbPayload(updated, userId || undefined),
        }, userId);
        AudioGraph.getInstance().playCoinSound();
      },

      pauseTrip: async (tripId) => {
        const { trips, activeTrip } = get();
        const id = tripId || activeTrip?.id;
        if (!id) return;
        const trip = trips.find((t) => t.id === id) || activeTrip;
        if (!trip || trip.status !== 'active') return;

        const updated: Trip = { ...trip, status: 'paused', updatedAt: new Date().toISOString() };
        set((state) => ({
          trips: state.trips.map((t) => (t.id === id ? updated : t)),
          activeTrip: updated,
        }));
        const userId = await resolveUserId();
        await dbService.pushToOutbox({
          type: 'UPSERT_USER_TRIP',
          payload: mapTripToDbPayload(updated, userId || undefined),
        }, userId);
      },

      resumeTrip: async (tripId) => {
        const { trips, activeTrip } = get();
        const id = tripId || activeTrip?.id;
        if (!id) return;
        const trip = trips.find((t) => t.id === id) || activeTrip;
        if (!trip || trip.status !== 'paused') return;
        await get().startTrip(id);
      },

      completeTrip: async (tripId) => {
        const { trips, activeTrip, tripEvents, cityMode, wallet } = get();
        const id = tripId || activeTrip?.id;
        if (!id) return;
        const trip = trips.find((t) => t.id === id) || activeTrip;
        if (!trip) return;

        const visited = wallet.stamps.filter((s) => !trip.city || s.city === trip.city);
        const passportEntry =
          trip.passportEntry ||
          `${trip.city || cityMode || 'سفر'} · ${trip.startDate}→${trip.endDate} · ${visited.length} مهر`;

        const updated: Trip = {
          ...trip,
          status: 'completed',
          passportEntry,
          updatedAt: new Date().toISOString(),
        };

        // Mark remaining open activities completed/skipped soft-close as completed journey
        const closedEvents = tripEvents.map((e) =>
          e.journeyId === id && (e.status === 'pending' || e.status === 'upcoming' || e.status === 'active' || e.status === 'now')
            ? { ...e, status: 'skipped' as const }
            : e
        );

        set((state) => ({
          trips: state.trips.map((t) => (t.id === id ? updated : t)),
          activeTrip: pickActiveTrip(state.trips.map((t) => (t.id === id ? updated : t))),
          tripEvents: closedEvents,
        }));

        const userId = await resolveUserId();
        await dbService.pushToOutbox({
          type: 'UPSERT_USER_TRIP',
          payload: mapTripToDbPayload(updated, userId || undefined),
        }, userId);

        for (const e of closedEvents.filter((ev) => ev.journeyId === id && ev.status === 'skipped')) {
          await dbService.pushToOutbox({
            type: 'UPDATE_TRIP_EVENT',
            payload: mapEventToDbPayload(e, userId || undefined),
          }, userId);
        }

        // Reward via ledger RPC (idempotent, server-derived daily entitlement).
        await get().claimReward('daily_itinerary');

        AudioGraph.getInstance().playCoinSound();
      },

      cancelTrip: async (tripId) => {
        const { trips, activeTrip } = get();
        const id = tripId || activeTrip?.id;
        if (!id) return;
        const trip = trips.find((t) => t.id === id) || activeTrip;
        if (!trip) return;

        const updated: Trip = {
          ...trip,
          status: 'cancelled',
          updatedAt: new Date().toISOString(),
        };
        const nextTrips = trips.map((t) => (t.id === id ? updated : t));
        set({
          trips: nextTrips,
          activeTrip: pickActiveTrip(nextTrips.filter((t) => t.id !== id || t.status !== 'cancelled')),
        });

        const userId = await resolveUserId();
        await dbService.pushToOutbox({
          type: 'UPSERT_USER_TRIP',
          payload: mapTripToDbPayload(updated, userId || undefined),
        }, userId);
      },

      cloneStaticTrip: async (templateId, startDate) => {
        const template = getStaticTrip(templateId);
        if (!template) throw new Error('قالب سفر پیدا نشد');

        const start = startDate || todayIso();
        const end = addDaysIso(start, Math.max(0, template.days - 1));
        const trip = await get().createTrip({
          city: template.city,
          title: template.titleFa,
          status: 'upcoming',
          startDate: start,
          endDate: end,
          budgetStyle: template.budgetStyle,
          interests: template.tags,
          templateId: template.id,
        });

        const events: TripEvent[] = template.activities.map((a) => {
          const date = addDaysIso(start, a.dayOffset);
          return {
            id: crypto.randomUUID(),
            type: a.type,
            title: a.title,
            time: a.time,
            date,
            status: 'pending',
            sequence: a.sequence,
            journeyId: trip.id,
            placeId: a.placeId,
            placeName: a.placeName,
            coordinates: a.coordinates,
            start_time: `${date}T${a.time}:00`,
            details: { ...a.details },
          };
        });

        set((state) => ({
          tripEvents: sortEvents([...state.tripEvents, ...events]),
        }));

        const userId = await resolveUserId();
        for (const event of events) {
          await dbService.pushToOutbox({
            type: 'ADD_TRIP_EVENT',
            payload: mapEventToDbPayload(event, userId || undefined),
          }, userId);
        }

        return trip;
      },
    }),
    {
      name: 'rava-data-storage-v3',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => {
        const { isSyncing, isStamping, isOnline, ...rest } = state;
        return rest;
      },
    }
  )
);

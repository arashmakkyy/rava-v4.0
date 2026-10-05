import { dbService, type OutboxItem } from './dbService';
import { supabase } from './supabaseClient';
import { useUserStore } from '../store/useUserStore';
import { useAuthStore } from '../store/useAuthStore';

const MAX_ATTEMPTS = 5;
const BACKOFF_CAP_MS = 8000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class SyncManagerProvider {
  private isSyncing = false;
  private initialized = false;

  init() {
    // گارد بحرانی: جلوگیری از مقداردهی اولیه تکراری در React Strict Mode
    if (this.initialized) return;
    this.initialized = true;

    console.log('[Sync Manager] Initializing global listeners...');

    // Immediate flush right after any enqueue while online (registered hook).
    dbService.setFlushHook(() => {
      void this.processOutbox();
    });

    window.addEventListener('online', () => this.processOutbox());

    if (navigator.onLine) {
      this.processOutbox();
    }
  }

  /** Owner resolution: explicit owner first, then payload-carried ids. Never assumed. */
  private ownerOf(action: OutboxItem): string | null {
    if (action.userId) return action.userId;
    const p = action.payload as Record<string, any> | null | undefined;
    if (!p || typeof p !== 'object') return null;
    if (typeof p.user_id === 'string') return p.user_id;
    if (p.profile && typeof p.profile.id === 'string') return p.profile.id;
    return null;
  }

  /** Execute one action. Supabase never throws on API errors — { error } must be checked. */
  private async executeAction(action: OutboxItem): Promise<void> {
    const fail = (where: string, error: unknown): never => {
      throw new Error(`[Sync Manager] ${action.type} failed at ${where}: ${(error as any)?.message || error}`);
    };

    switch (action.type) {
      case 'DEDUCT_FUEL': {
        const txId = action.payload.transaction_id;
        if (!txId) throw new Error('DEDUCT_FUEL missing transaction_id');
        const { error } = await supabase.rpc('deduct_fuel', {
          px_seconds: action.payload.seconds,
          px_reason: action.payload.reason ?? 'مکالمه صوتی',
          px_transaction_id: txId,
        });
        if (error) fail('deduct_fuel', error);
        break;
      }
      case 'ADD_TRIP_EVENT':
      case 'UPDATE_TRIP_EVENT': {
        const { error } = await supabase.from('trips').upsert(action.payload, { onConflict: 'id' });
        if (error) fail('trips.upsert', error);
        break;
      }
      case 'REMOVE_TRIP_EVENT': {
        const { error } = await supabase.from('trips').delete().eq('id', action.payload.id);
        if (error) fail('trips.delete', error);
        break;
      }
      case 'UPSERT_USER_TRIP': {
        const { error } = await supabase.from('user_trips').upsert(action.payload, { onConflict: 'id' });
        if (error) fail('user_trips.upsert', error);
        break;
      }
      case 'PROCESS_STAMP': {
        const { error } = await supabase.rpc('process_poi_visit', action.payload);
        if (error) fail('process_poi_visit', error);
        break;
      }
      case 'CLAIM_REWARD': {
        const { error } = await supabase.rpc('claim_reward', action.payload);
        if (error) fail('claim_reward', error);
        break;
      }
      case 'RECORD_STREAK': {
        const { error } = await supabase.rpc('record_daily_activity', {
          px_date: action.payload.date,
        });
        if (error) fail('record_daily_activity', error);
        break;
      }
      case 'FINALIZE_ONBOARDING': {
        const { profile, trip } = action.payload;
        const { error: profileError } = await supabase
          .from('profiles')
          .upsert(profile, { onConflict: 'id' });
        if (profileError) fail('profiles.upsert', profileError);
        if (trip) {
          const { error: tripError } = await supabase.from('trips').insert(trip);
          if (tripError) fail('trips.insert', tripError);
        }
        // Profile-complete reward — server derives entitlement (onboarding flag);
        // only when outbound payload carries a stable tx id.
        if (profile?.id && action.payload.profile_reward_tx) {
          const { error: rewardError } = await supabase.rpc('claim_reward', {
            px_transaction_id: action.payload.profile_reward_tx,
            px_reward_type: 'profile_complete',
          });
          if (rewardError) fail('claim_reward(profile_complete)', rewardError);
        }
        break;
      }
      default:
        throw new Error(`Unknown outbox action type: ${action.type}`);
    }
  }

  async processOutbox() {
    if (this.isSyncing || !navigator.onLine) return;
    this.isSyncing = true;

    try {
      const currentUid = useAuthStore.getState().user?.id ?? null;
      // No signed-in owner -> replay nothing. Items wait for their owner's session.
      if (!currentUid) return;

      const pendingActions = await dbService.getAllOutboxItems();
      if (pendingActions.length === 0) return;

      console.log(`[Sync Manager] Processing ${pendingActions.length} pending actions...`);

      for (const action of pendingActions) {
        // Account isolation: never replay another owner's action in this session.
        // Legacy owner-less items that cannot be attributed are quarantined, not assumed.
        const owner = this.ownerOf(action);
        if (!owner) {
          console.warn(`[Sync Manager] Quarantining owner-less action ${action.id} (${action.type}).`);
          await dbService.moveToDeadLetter(action, 'owner-unattributable');
          continue;
        }
        if (owner !== currentUid) {
          console.warn(`[Sync Manager] Quarantining foreign action ${action.id} (${action.type}).`);
          await dbService.moveToDeadLetter(action, 'owner-mismatch');
          continue;
        }

        try {
          await this.executeAction(action);
          await dbService.removeFromOutbox(action.id);
        } catch (individualErr) {
          const attempts = (action.attempts ?? 0) + 1;
          console.error(`[Sync Manager] Action failed (ID: ${action.id}, attempt ${attempts}).`, individualErr);
          if (attempts >= MAX_ATTEMPTS) {
            await dbService.moveToDeadLetter(action, `retries-exhausted:${attempts}`);
            continue;
          }
          await dbService.updateOutboxAttempts(action.id, attempts);
          // Back off, then stop this run to preserve trip/fuel ordering.
          await sleep(Math.min(1000 * 2 ** (attempts - 1), BACKOFF_CAP_MS));
          break;
        }
      }

      // Reconcile optimistic wallet with server after outbox drain
      await useUserStore.getState().syncWithCloud();
    } finally {
      this.isSyncing = false;
    }
  }
}

export const syncManager = new SyncManagerProvider();

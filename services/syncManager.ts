import { dbService } from './dbService';
import { supabase } from './supabaseClient';
import { useUserStore } from '../store/useUserStore';

class SyncManagerProvider {
  private isSyncing = false;
  private initialized = false;

  init() {
    // گارد بحرانی: جلوگیری از مقداردهی اولیه تکراری در React Strict Mode
    if (this.initialized) return;
    this.initialized = true;

    console.log('[Sync Manager] Initializing global listeners...');

    window.addEventListener('online', () => this.processOutbox());

    if (navigator.onLine) {
      this.processOutbox();
    }
  }

  async processOutbox() {
    if (this.isSyncing || !navigator.onLine) return;
    this.isSyncing = true;

    try {
      const pendingActions = await dbService.getAllOutboxItems();
      if (pendingActions.length === 0) return;

      console.log(`[Sync Manager] Processing ${pendingActions.length} pending actions...`);

      for (const action of pendingActions) {
        let success = false;
        try {
          switch (action.type) {
            case 'DEDUCT_FUEL': {
              // Reuse stable transaction_id from payload — never mint a new UUID on retry
              const txId = action.payload.transaction_id;
              if (!txId) {
                throw new Error('DEDUCT_FUEL missing transaction_id');
              }
              await supabase.rpc('deduct_fuel', {
                px_seconds: action.payload.seconds,
                px_reason: action.payload.reason ?? 'مکالمه صوتی',
                px_transaction_id: txId,
              });
              success = true;
              break;
            }
            case 'ADD_TRIP_EVENT':
              await supabase.from('trips').upsert(action.payload, { onConflict: 'id' });
              success = true;
              break;
            case 'UPDATE_TRIP_EVENT':
              await supabase.from('trips').upsert(action.payload, { onConflict: 'id' });
              success = true;
              break;
            case 'REMOVE_TRIP_EVENT':
              await supabase.from('trips').delete().eq('id', action.payload.id);
              success = true;
              break;
            case 'UPSERT_USER_TRIP':
              await supabase.from('user_trips').upsert(action.payload, { onConflict: 'id' });
              success = true;
              break;
            case 'PROCESS_STAMP':
              await supabase.rpc('process_poi_visit', action.payload);
              success = true;
              break;
            case 'CLAIM_REWARD':
              await supabase.rpc('claim_reward', action.payload);
              success = true;
              break;
            case 'RECORD_STREAK':
              await supabase.rpc('record_daily_activity', {
                px_date: action.payload.date,
              });
              success = true;
              break;
            case 'FINALIZE_ONBOARDING': {
              const { profile, trip } = action.payload;
              const { error: profileError } = await supabase
                .from('profiles')
                .upsert(profile, { onConflict: 'id' });
              if (profileError) throw profileError;
              if (trip) {
                const { error: tripError } = await supabase.from('trips').insert(trip);
                if (tripError) throw tripError;
              }
              // Profile-complete reward — server derives entitlement (onboarding flag);
              // only when outbound payload carries a stable tx id.
              if (profile?.id && action.payload.profile_reward_tx) {
                await supabase.rpc('claim_reward', {
                  px_transaction_id: action.payload.profile_reward_tx,
                  px_reward_type: 'profile_complete',
                });
              }
              success = true;
              break;
            }
          }

          if (success) {
            await dbService.removeFromOutbox(action.id);
          }
        } catch (individualErr) {
          console.error(`[Sync Manager] Action failed (ID: ${action.id}), will retry.`, individualErr);
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

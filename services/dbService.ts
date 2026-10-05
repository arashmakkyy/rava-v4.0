/**
 * IndexedDB Wrapper v2.2 - Atomic Outbox Pattern
 * DB renamed rahnam_resilience_v3 → rava_resilience_v3 with one-time migration.
 *
 * v4 adds:
 *  - `dead_letter` store: failed/quarantined actions are moved here, never silently dropped.
 *  - Outbox items carry `userId` (owner) + `attempts` (retry count).
 *  - A flush hook lets SyncManager start a sync right after enqueue (no import cycle).
 *
 * Failure semantics (explicit, by path):
 *  - OUTBOX WRITES (push/update/remove/dead-letter): LOUD. Rejections propagate to
 *    the caller (syncManager/store) with action context. Never resolve-as-success.
 *  - OUTBOX READS (getAll): LOUD. A read failure rejects — the scheduler must be
 *    able to distinguish "queue empty" ([]) from "storage broken" (throw), and
 *    must never treat the latter as the former.
 *  - PLACES CACHE (get/set): best-effort by design. A cache miss/failure falls
 *    back to network without failing the UX; staleness self-heals on next fetch.
 */
export interface OutboxItem {
  id: string;
  type: string;
  payload: any;
  timestamp: number;
  /** Owner at enqueue time. Legacy items may lack it -> quarantined, never assumed. */
  userId?: string | null;
  attempts?: number;
}

export interface DeadLetterItem extends OutboxItem {
  deadReason: string;
  deadAt: number;
}

class IndexedDBService {
  private dbName = 'rava_resilience_v3';
  private oldDbName = 'rahnam_resilience_v3';
  private version = 4;
  private stores = {
    places: 'places',
    outbox: 'outbox',
    deadLetter: 'dead_letter'
  };
  private migrationPromise: Promise<void> | null = null;
  private flushHook: (() => void) | null = null;

  /** Registered once by SyncManager to flush immediately after enqueue while online. */
  setFlushHook(hook: (() => void) | null) {
    this.flushHook = hook;
  }

  private openDb(name: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, this.version);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.stores.places)) {
          db.createObjectStore(this.stores.places);
        }
        if (!db.objectStoreNames.contains(this.stores.outbox)) {
          db.createObjectStore(this.stores.outbox, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(this.stores.deadLetter)) {
          db.createObjectStore(this.stores.deadLetter, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async ensureMigrated(): Promise<void> {
    if (!this.migrationPromise) {
      this.migrationPromise = this.migrateFromLegacyDb();
    }
    await this.migrationPromise;
  }

  private async legacyDbExists(): Promise<boolean> {
    if (typeof indexedDB.databases === 'function') {
      const dbs = await indexedDB.databases();
      return dbs.some((d) => d.name === this.oldDbName);
    }

    // Fallback when databases() is unavailable: open and detect fresh creation.
    return new Promise((resolve) => {
      let created = false;
      const req = indexedDB.open(this.oldDbName, this.version);
      req.onupgradeneeded = () => {
        created = true;
        const db = req.result;
        if (!db.objectStoreNames.contains(this.stores.places)) {
          db.createObjectStore(this.stores.places);
        }
        if (!db.objectStoreNames.contains(this.stores.outbox)) {
          db.createObjectStore(this.stores.outbox, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.close();
        if (created) {
          indexedDB.deleteDatabase(this.oldDbName);
          resolve(false);
          return;
        }
        resolve(true);
      };
      req.onerror = () => resolve(false);
    });
  }

  private async migrateFromLegacyDb(): Promise<void> {
    try {
      const legacyExists = await this.legacyDbExists();
      if (!legacyExists) return;

      const oldDb = await this.openDb(this.oldDbName);
      const newDb = await this.openDb(this.dbName);

      const copyStore = async (storeName: string, useKeyPath: boolean) => {
        if (!oldDb.objectStoreNames.contains(storeName)) return;
        if (!newDb.objectStoreNames.contains(storeName)) return;

        const items: { key?: IDBValidKey; value: unknown }[] = await new Promise((resolve) => {
          const tx = oldDb.transaction(storeName, 'readonly');
          const store = tx.objectStore(storeName);
          if (useKeyPath) {
            const req = store.getAll();
            req.onsuccess = () => resolve((req.result || []).map((value) => ({ value })));
            req.onerror = () => resolve([]);
          } else {
            const req = store.openCursor();
            const rows: { key: IDBValidKey; value: unknown }[] = [];
            req.onsuccess = () => {
              const cursor = req.result;
              if (cursor) {
                rows.push({ key: cursor.key, value: cursor.value });
                cursor.continue();
              } else {
                resolve(rows);
              }
            };
            req.onerror = () => resolve([]);
          }
        });

        if (items.length === 0) return;

        await new Promise<void>((resolve) => {
          const tx = newDb.transaction(storeName, 'readwrite');
          const store = tx.objectStore(storeName);
          for (const item of items) {
            if (useKeyPath) {
              store.put(item.value);
            } else if (item.key !== undefined) {
              store.put(item.value, item.key);
            }
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        });
      };

      await copyStore(this.stores.places, false);
      await copyStore(this.stores.outbox, true);

      oldDb.close();
      newDb.close();

      await new Promise<void>((resolve) => {
        const del = indexedDB.deleteDatabase(this.oldDbName);
        del.onsuccess = () => resolve();
        del.onerror = () => resolve();
        del.onblocked = () => resolve();
      });
    } catch {
      // Migration is best-effort; app continues with the new DB name.
    }
  }

  private async getDB(): Promise<IDBDatabase> {
    await this.ensureMigrated();
    return this.openDb(this.dbName);
  }

  async set(key: string, value: any): Promise<void> {
    const db = await this.getDB();
    const tx = db.transaction(this.stores.places, 'readwrite');
    tx.objectStore(this.stores.places).put(value, key);
  }

  async get(key: string): Promise<any> {
    const db = await this.getDB();
    return new Promise((resolve) => {
      const tx = db.transaction(this.stores.places, 'readonly');
      const request = tx.objectStore(this.stores.places).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  }

  // مدیریت صف آفلاین اتمیک.
  // Write failures REJECT (never resolve-as-success): the caller sees the error,
  // logs it with context, and the optimistic state reconciles on the next
  // successful syncWithCloud. Silent loss is not an option.
  async pushToOutbox(action: { type: string; payload: any }, userId?: string | null): Promise<void> {
    const db = await this.getDB();
    const tx = db.transaction(this.stores.outbox, 'readwrite');
    const item: OutboxItem = {
      id: crypto.randomUUID(),
      ...action,
      timestamp: Date.now(),
      userId: userId ?? null,
      attempts: 0,
    };
    await new Promise<void>((resolve, reject) => {
      const request = tx.objectStore(this.stores.outbox).add(item);
      request.onerror = () => reject(
        new Error(`[dbService] outbox enqueue failed (${action.type}): ${request.error?.message || 'IndexedDB error'}`)
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(
        new Error(`[dbService] outbox transaction failed (${action.type}): ${tx.error?.message || 'IndexedDB error'}`)
      );
      tx.onabort = () => reject(
        new Error(`[dbService] outbox transaction aborted (${action.type})`)
      );
    });
    // Best-effort immediate flush while online (guarded against reentrancy downstream).
    if (typeof navigator !== 'undefined' && navigator.onLine && this.flushHook) {
      try {
        this.flushHook();
      } catch {
        /* flush failures are retried on the next trigger */
      }
    }
  }

  async getAllOutboxItems(): Promise<OutboxItem[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.stores.outbox, 'readonly');
      const request = tx.objectStore(this.stores.outbox).getAll();
      request.onsuccess = () => {
        // مرتب‌سازی بر اساس زمان برای حفظ ترتیب وقایع سفر
        const items = (request.result || []).sort((a, b) => a.timestamp - b.timestamp);
        resolve(items);
      };
      // LOUD: [] means "empty queue". A read failure must throw, never masquerade as empty.
      request.onerror = () => reject(
        new Error(`[dbService] outbox read failed: ${request.error?.message || 'IndexedDB error'}`)
      );
    });
  }

  async updateOutboxAttempts(id: string, attempts: number): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.stores.outbox, 'readwrite');
      const store = tx.objectStore(this.stores.outbox);
      const get = store.get(id);
      get.onsuccess = () => {
        const item = get.result as OutboxItem | undefined;
        if (!item) {
          reject(new Error(`[dbService] attempts update: item ${id} not found`));
          return;
        }
        item.attempts = attempts;
        const put = store.put(item);
        put.onsuccess = () => resolve();
        put.onerror = () => reject(
          new Error(`[dbService] attempts update failed for ${id}: ${put.error?.message || 'IndexedDB error'}`)
        );
      };
      get.onerror = () => reject(
        new Error(`[dbService] attempts read failed for ${id}: ${get.error?.message || 'IndexedDB error'}`)
      );
    });
  }

  async removeFromOutbox(id: string): Promise<void> {
    // Resolve-on-error is DELIBERATE here: a failed delete replays the action,
    // and every outbox action is idempotent server-side (stable transaction_ids),
    // so a duplicate delivery is harmless while a lost delete would loop forever.
    const db = await this.getDB();
    return new Promise((resolve) => {
      const tx = db.transaction(this.stores.outbox, 'readwrite');
      const request = tx.objectStore(this.stores.outbox).delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
  }

  /**
   * Quarantine: move an item out of the replay queue WITHOUT executing it.
   * Used for owner mismatches, legacy owner-less items, and exhausted retries.
   * Nothing is ever silently dropped — dead letters stay inspectable on-device.
   */
  async moveToDeadLetter(item: OutboxItem, reason: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([this.stores.outbox, this.stores.deadLetter], 'readwrite');
      const dead: DeadLetterItem = { ...item, deadReason: reason, deadAt: Date.now() };
      const put = tx.objectStore(this.stores.deadLetter).put(dead);
      put.onerror = () => {
        console.error(`[dbService] dead-letter store failed for ${item.id} (${reason})`);
      };
      tx.objectStore(this.stores.outbox).delete(item.id);
      tx.oncomplete = () => resolve();
      // LOUD: if quarantine itself fails, the caller must know — the action is
      // neither queued nor quarantined, and retrying blindly could double-execute.
      tx.onerror = () => reject(
        new Error(`[dbService] dead-letter transaction failed for ${item.id} (${reason}): ${tx.error?.message || 'IndexedDB error'}`)
      );
    });
  }

  async getDeadLetterCount(): Promise<number> {
    const db = await this.getDB();
    return new Promise((resolve) => {
      const tx = db.transaction(this.stores.deadLetter, 'readonly');
      const request = tx.objectStore(this.stores.deadLetter).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(0);
    });
  }
}

export const dbService = new IndexedDBService();

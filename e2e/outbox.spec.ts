import { test, expect } from '@playwright/test';

/**
 * Outbox offline/online semantics (B1 layer 2 extension).
 * Requires E2E_EMAIL/E2E_PASSWORD of an onboarded test account; SKIPS otherwise.
 *
 * Covers: offline action carries owner metadata, and coming back online
 * replays the queue without reload (found items drain or gain attempts).
 * Supabase-error and cross-account paths stay in abuse_test.mjs + manual matrix.
 */
const EMAIL = process.env.E2E_EMAIL || '';
const PASSWORD = process.env.E2E_PASSWORD || '';

async function outboxItems(page: import('@playwright/test').Page) {
  return page.evaluate(() => new Promise<any[]>((resolve) => {
    try {
      const req = indexedDB.open('rava_resilience_v3');
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('outbox')) {
          db.close();
          resolve([]);
          return;
        }
        const tx = db.transaction('outbox', 'readonly');
        const get = tx.objectStore('outbox').getAll();
        get.onsuccess = () => {
          db.close();
          resolve(Array.from(get.result || []));
        };
        get.onerror = () => {
          db.close();
          resolve([]);
        }
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  }));
}

test.describe('Rava outbox offline/online', () => {
  test.skip(!EMAIL || !PASSWORD, 'needs E2E_EMAIL + E2E_PASSWORD of an onboarded test account');

  test('offline enqueue carries owner, online replays', async ({ page, context }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(String(err)));

    await page.goto('/');
    await page.getByPlaceholder('example@mail.com').fill(EMAIL);
    await page.getByRole('button', { name: 'ورود' }).click();
    await page.getByPlaceholder('••••••••').fill(PASSWORD);
    await page.getByRole('button', { name: 'بزن بریم تو' }).click();
    await page.getByRole('button', { name: 'سفر من' }).first().click({ timeout: 20000 });

    // Go offline, then clone a static trip (outbox-backed writes).
    await context.setOffline(true);
    await page.getByRole('button', { name: 'قالب‌ها' }).first().click();
    await page.getByText('برنامه‌های آماده راوا').waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: 'کپی کن' }).first().click();
    await page.waitForTimeout(2500);

    const queued = await outboxItems(page);
    expect(queued.length).toBeGreaterThan(0);
    for (const item of queued) {
      expect(item.userId, 'outbox item carries owner').toBeTruthy();
    }

    // Back online: queue must drain (or show retry attempts) without reload.
    await context.setOffline(false);
    await page.waitForTimeout(12000);
    const after = await outboxItems(page);
    const drained = after.length < queued.length;
    const retrying = after.some((i: any) => (i.attempts ?? 0) > 0);
    expect(drained || retrying).toBe(true);
    expect(errors).toEqual([]);
  });
});

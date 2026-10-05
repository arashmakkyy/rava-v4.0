import { test, expect } from '@playwright/test';

/**
 * Minimal browser E2E (B1 layer 2). Covers the unauthenticated boot path:
 * document locale, auth screen render, and a console-error budget.
 * Authenticated flows (tabs, map, voice) stay in the manual/real-device matrix
 * until test users + keys are wired into this harness.
 */
test.describe('Rava boot (unauthenticated)', () => {
  test('document is Persian RTL', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('auth screen renders Rava branding', async ({ page }) => {
    await page.goto('/');
    // Splash -> auth screen; brand appears in either.
    await expect(page.getByText('راوا', { exact: false }).first()).toBeVisible({ timeout: 20000 });
  });

  test('no page errors during boot', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.goto('/');
    await page.waitForTimeout(8000);
    expect(errors).toEqual([]);
  });
});

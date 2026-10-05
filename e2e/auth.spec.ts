import { test, expect } from '@playwright/test';

/**
 * Authenticated happy path (B1 layer 2 extension).
 *
 * Requires a pre-provisioned, already-onboarded test account:
 *   E2E_EMAIL=... E2E_PASSWORD=... npx playwright test
 * Without credentials the suite SKIPS (honest: no fake coverage).
 * The account must already be onboarded so AuthGuard lands on Dashboard.
 *
 * Covers: login -> dashboard -> all 5 tabs -> profile metrics visible.
 * Voice/real-map/stamp flows stay in the manual + real-device matrix.
 */
const EMAIL = process.env.E2E_EMAIL || '';
const PASSWORD = process.env.E2E_PASSWORD || '';

test.describe('Rava authenticated happy path', () => {
  test.skip(!EMAIL || !PASSWORD, 'needs E2E_EMAIL + E2E_PASSWORD of an onboarded test account');

  test('login, tabs, profile', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(String(err)));

    await page.goto('/');
    await page.getByPlaceholder('example@mail.com').fill(EMAIL);
    await page.getByRole('button', { name: 'ورود' }).click();
    await page.getByPlaceholder('••••••••').fill(PASSWORD);
    await page.getByRole('button', { name: 'بزن بریم تو' }).click();

    // Onboarded account -> dashboard. Fresh account -> onboarding city step.
    const cityHeading = page.getByText('کجا قراره خاطره بسازیم؟');
    if (await cityHeading.isVisible({ timeout: 8000 }).catch(() => false)) {
      await page.getByText('استانبول').click();
      await page.getByRole('button', { name: 'تایید و ادامه' }).click();
      await page.getByText('مفت گردی').click();
      await page.getByText('تنهایی').click();
      await page.getByRole('button', { name: 'آماده‌سازی سفر لوکس' }).click();
    }

    // Bottom tabs navigate without errors.
    for (const tab of ['نقشه', 'کشف', 'سفر من', 'ابزارها', 'پروفایل']) {
      await page.getByRole('button', { name: tab }).first().click();
      await page.waitForTimeout(1200);
    }

    await page.getByRole('button', { name: 'پروفایل' }).first().click();
    await expect(page.getByText('حساب کاربری').first()).toBeVisible({ timeout: 15000 });
    expect(errors).toEqual([]);
  });
});

import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:3001';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL,
    viewport: { width: 390, height: 844 }, // mobile-first: iPhone-class width
    hasTouch: true,
    isMobile: true,
  },
  // The app's own dev/preview server must already be running (npm run dev / preview).
});

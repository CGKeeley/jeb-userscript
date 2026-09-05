import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  reporter: [['list']],
  projects: [
    { name: 'unit', testMatch: /unit\/.*\.spec\.ts/ },
    // Live tests drive the real site with the persistent profile created by `npm run login`.
    // Cloudflare blocks headless Chromium, so they run headed and serially.
    { name: 'live', testMatch: /live\/.*\.spec\.ts/, workers: 1, retries: 0 },
  ],
});

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 75_000,
  expect: { timeout: 8_000 },
  workers: 1,
  reporter: 'list',
  use: { channel: process.env.PLAYWRIGHT_CHROME_CHANNEL, reducedMotion: 'reduce' },
  projects: [
    { name: 'Android viewport 360', use: { ...devices['Pixel 7'], viewport: { width: 360, height: 800 } } },
    { name: 'Android viewport 390', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 824 } } },
    { name: 'Desktop 1280', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
  ],
});

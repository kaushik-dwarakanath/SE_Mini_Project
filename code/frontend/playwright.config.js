import { defineConfig } from '@playwright/test';
import process from 'node:process';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  use: {
    baseURL: 'http://127.0.0.1:5174',
    trace: 'retain-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
  },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 320, height: 640 } } },
  ],
  webServer: [
    {
      command: 'npm run build && node ../backend/tests/e2e-server.js',
      url: 'http://127.0.0.1:5001/api/health',
      timeout: 120000,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5174 --strictPort',
      env: { API_PROXY_TARGET: 'http://127.0.0.1:5001' },
      url: 'http://127.0.0.1:5174',
    },
  ],
});

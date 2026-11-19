import { defineConfig } from "@playwright/test";

// E2e de la biblioteca con sesión (fase 5J): navegador → proxy /graphql de Vite →
// API compilada → MongoDB en memoria. Va aparte de `test:e2e` porque levanta la API.
// Uso: npm run test:e2e:session (desde la raíz).
const apiPort = 3100;
const webPort = 4180;

export default defineConfig({
  testDir: "./e2e-session", testMatch: "**/*.e2e.ts", fullyParallel: false, workers: 1,
  timeout: 60000, expect: { timeout: 10000 }, retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-session" }]],
  outputDir: "test-results-session",
  use: { baseURL: `http://127.0.0.1:${webPort}`, locale: "es-CL", timezoneId: "America/Santiago",
    serviceWorkers: "block", trace: "retain-on-failure", screenshot: "only-on-failure",
    browserName: "chromium", viewport: { width: 1440, height: 900 } },
  projects: [{ name: "chromium-session" }],
  webServer: [
    {
      command: "npm run build -w @cancha/core && npm run build -w @cancha/api && node apps/api/scripts/session-e2e-api.mjs",
      cwd: "../..",
      url: `http://127.0.0.1:${apiPort}/health`,
      env: {
        NODE_ENV: "test",
        PORT: String(apiPort),
        CORS_ORIGINS: `http://127.0.0.1:${webPort}`,
        AUTH_RATE_LIMIT: "1000",
      },
      reuseExistingServer: false,
      timeout: 240000,
    },
    {
      command: `node ../../node_modules/vite/bin/vite.js build && node ../../node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port ${webPort} --strictPort`,
      url: `http://127.0.0.1:${webPort}`,
      env: { CANCHA_API_URL: `http://127.0.0.1:${apiPort}` },
      reuseExistingServer: false,
      timeout: 180000,
    },
  ],
});

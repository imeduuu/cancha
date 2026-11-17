import { defineConfig } from "@playwright/test";

const sizes = { desktop: { width: 1440, height: 900 }, notebook: { width: 1366, height: 768 },
  tablet: { width: 768, height: 1024 }, mobile: { width: 390, height: 844 } };
export default defineConfig({
  testDir: "./e2e", testMatch: "**/*.e2e.ts", fullyParallel: true, workers: 2,
  timeout: 45000, expect: { timeout: 8000 }, retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://127.0.0.1:4179", locale: "es-CL", timezoneId: "America/Santiago",
    serviceWorkers: "block", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: ["chromium", "firefox", "webkit"].flatMap(browserName =>
    Object.entries(sizes).map(([size, viewport]) => ({ name: `${browserName}-${size}`,
      use: { browserName, viewport, ...(browserName !== "firefox" && size === "mobile"
        ? { isMobile: true, hasTouch: true } : {}) } }))),
  webServer: { command: "npm run build && node ../../node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4179 --strictPort",
    url: "http://127.0.0.1:4179", reuseExistingServer: false, timeout: 120000 },
});

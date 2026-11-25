import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const outputDir = path.resolve(webRoot, "../../docs/screenshots");
const port = Number(process.env.CANCHA_SCREENSHOT_PORT ?? 4181);
const baseURL = `http://127.0.0.1:${port}`;
const preview = spawn(process.execPath, [
  "../../node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1",
  "--port", String(port), "--strictPort",
], { cwd: webRoot, stdio: "inherit", windowsHide: true });

let browser;
try {
  await mkdir(outputDir, { recursive: true });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (preview.exitCode !== null) throw new Error(`Vite preview terminó con código ${preview.exitCode}`);
    try {
      const response = await fetch(baseURL);
      if (response.ok) { ready = true; break; }
    } catch { /* El servidor todavía está iniciando. */ }
    await delay(500);
  }
  if (!ready) throw new Error(`Vite preview no respondió en ${baseURL}`);

  browser = await chromium.launch();
  for (const [name, viewport] of Object.entries({
    desktop: { width: 1440, height: 1000 },
    mobile: { width: 390, height: 844 },
  })) {
    const page = await browser.newPage({ viewport, colorScheme: "dark", locale: "es-CL" });
    await page.goto(baseURL, { waitUntil: "networkidle" });
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    await page.screenshot({ path: path.join(outputDir, `estadio-nocturno-${name}.png`), fullPage: true });
    await page.close();
  }
} finally {
  await browser?.close();
  preview.kill();
}

import type { SportsUniverseLibrary } from "../src/domain/entities/sports-universe";
import {decisionTie,decisionInput} from "../src/test-utils/sports-decision-fixtures";
import {drawCup,drawGroups} from "../src/test-utils/stage-draw-fixtures";
import {generatorScenario} from "../src/test-utils/group-generator-fixtures";
import {clubAssociationScenario} from "../src/test-utils/club-association-fixtures";
import {drawFoundation} from "../src/application/services/draw-and-bracket";
import { closureLeague, closureCup, closureMemory } from "../src/test-utils/season-closure-fixtures";
import {reviewSeasonClosure,confirmSeasonClosure} from "../src/application/use-cases/confirm-season-closure";
import {cupPlanningFixture} from "../src/test-utils/national-cup-planning-fixtures";
import {advanceSecondDivision} from "../src/domain/services/second-division-progression";
import {simulateChampionship} from "../src/application/use-cases/simulate-championship";
import {brazilUpper} from "../src/test-utils/journey-competition-fixtures";
import { continentalLeague } from "../src/test-utils/continental-qualification-fixtures";
import { test as base, expect, type Page, type TestInfo } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { generateRoundRobinSchedule } from "../src/domain/services/round-robin-scheduler";
import { divisionFixture } from "../src/domain/services/second-division-test-fixtures";
import { continentalCup, nationalCup, argentinaUpper } from "../src/test-utils/journey-competition-fixtures";
import { recordSourceRejection } from "../src/application/services/source-incidents";
import type { Tournament } from "../src/domain/entities/tournament";
import type { SaveCheckpoint } from "../src/domain/entities/save-checkpoint";

// Each Playwright test owns a new browser context; never open a user profile.
const test = base.extend<{ browserAudit: void }>({
  browserAudit: [async ({ page, context, browser }, use, info) => {
    const errors: string[] = [], failed: string[] = [];
    const consoleReads: Promise<void>[] = [];
    info.annotations.push({ type: "browser-version", description: browser.version() });
    function auditPage(page: Page) {
      page.on("pageerror", e => errors.push(e.message));
      page.on("console", message => {
        if (message.type() !== "error") return;
        // Firefox represents console.error(Error) as JSHandle@object in text().
        // Read its message immediately, before navigation destroys the handle.
        consoleReads.push(Promise.all(message.args().map(arg => arg.evaluate(value =>
          value instanceof Error ? `${value.name}: ${value.message}` : String(value)
        ).catch(() => ""))).then(args => { errors.push(args.filter(Boolean).join(" ") || message.text()); }));
      });
      page.on("requestfailed", request => failed.push(`${request.method()} ${request.url()} ${request.failure()?.errorText}`));
      page.on("response", response => { if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`); });
    }
    auditPage(page); context.on("page", auditPage);
    // Network-independent layout: external fonts use the existing system fallbacks.
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin === "http://127.0.0.1:4179" && !/^\/(official-source|third-division-source|argentina-cup-source|brazil-cup-source)(\/|$)/.test(url.pathname)) return route.continue();
      if (url.hostname === "fonts.googleapis.com") return route.fulfill({ contentType: "text/css", body: "" });
      return route.abort("blockedbyclient");
    });
    await page.route("http://127.0.0.1:4179/__e2e_storage", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>E2E storage preparation</title>" }));
    await page.addInitScript(() => {
      let seed = 42;
      Math.random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; };
    });
    await use();
    await Promise.all(consoleReads);
    await info.attach("browser-errors", { body: JSON.stringify({ errors, failed }, null, 2), contentType: "application/json" });
    if (!info.annotations.some(a => a.type === "expected-chunk-failure")) {
      expect(errors, "Unexpected browser console/runtime errors").toEqual([]);
      expect(failed, "Unexpected failed requests").toEqual([]);
    } else {
      expect(failed.length).toBeGreaterThan(0);
      expect(failed.every(item => item.includes("tournament-statistics-panel-"))).toBe(true);
      expect(errors.every(item => /dynamically imported module|Importing a module script failed|Failed to load resource|Load failed|Loading module.*failed|NetworkError.*fetch/i.test(item)), JSON.stringify(errors)).toBe(true);
    }
  }, { auto: true }],
});
function league(id = "e2e-league", name = "Liga de navegador"): Tournament {
  const teams = ["Alfa", "Beta", "Gamma", "Delta"].map((name, i) => ({ id: `${id}-${i}`, name }));
  return { id, name, season: 2026, teams, legs: 2, tieBreakers: ["goalDifference", "goalsFor"],
    createdAt: "2026-01-01T00:00:00.000Z", matchdays: generateRoundRobinSchedule(teams, 2) };
}
async function seed(page: Page, tournaments: Tournament[], activity: unknown[] = [], universes?: SportsUniverseLibrary) {
  await page.goto("/__e2e_storage");
  await page.evaluate(({ tournaments, activity, universes }) => {
    localStorage.clear(); localStorage.setItem("cancha.tournaments", JSON.stringify(tournaments));
    if (activity.length) localStorage.setItem("cancha.activity", JSON.stringify(activity));
    if (universes) localStorage.setItem("cancha.sportsUniverses", JSON.stringify(universes));
  }, { tournaments, activity, universes });
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Cancha, inicio" })).toBeVisible();
}
async function saved(page: Page): Promise<Tournament[]> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("cancha.tournaments") ?? "[]"));
}

test("centro de simulación exige revisión y confirmación antes de guardar", async ({ page }) => {
  const t: Tournament = {...league(), format: "round-robin", competitionRules: {
    season: 2026, verification: {standings: "verified", placements: "verified"},
  }};
  await seed(page, [t]);
  await page.getByRole("button", {name: "Centro de simulación", exact: true}).click();
  const center = page.getByRole("region", {name: "Centro de simulación de temporadas", exact: true});
  expect((await saved(page))[0].matchdays.flatMap(d => d.fixtures).every(f => !f.result)).toBe(true);
  await center.getByRole("combobox", {name: "Alcance", exact: true}).selectOption("0");
  await center.getByRole("button", {name: "Revisar simulación", exact: true}).click();
  await expect(center.getByText("2 encuentros pendientes incluidos. Se conservarán 0 resultados existentes.")).toBeVisible();
  expect((await saved(page))[0].matchdays.flatMap(d => d.fixtures).every(f => !f.result)).toBe(true);
  await center.getByRole("button", {name: "Confirmar simulación local", exact: true}).click();
  await expect(center.getByRole("status")).toContainText("Se simularon localmente 2 partidos");
  expect((await saved(page))[0].matchdays.flatMap(d => d.fixtures).filter(f => f.result)).toHaveLength(2);
});
async function layout(page: Page, info: TestInfo, label: string) {
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return { width, scroll: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll("body *")].filter(el => {
        const box = el.getBoundingClientRect(); const css = getComputedStyle(el);
        return box.width && css.position !== "fixed" && (box.right > width + 1 || box.left < -1)
          && !el.closest(".statistics-table-scroll, .standings-scroll, .table-scroll");
      }).slice(0, 10).map(el => `${el.tagName}.${el.className}`) };
  });
  const path = info.outputPath(`${label}.png`);
  // Full-page captures can exceed WebKit's 32767px image limit for long group views.
  // Keep global document-width assertions, and capture readable viewport/section images.
  await page.screenshot({ path, fullPage: false });
  await info.attach(label, { path, contentType: "image/png" });
  if (["groups", "championship", "second-argentina", "second-brasil"].includes(label)) {
    const table = page.getByRole("region", { name: "Tabla de posiciones", exact: true }).first();
    if (await table.isVisible()) {
      const tablePath = info.outputPath(`${label}-standings.png`);
      await table.screenshot({ path: tablePath });
      await info.attach(`${label}-standings`, { path: tablePath, contentType: "image/png" });
    }
  }
  expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width + 1);
}
async function library(page: Page) { await page.getByRole("button", { name: "Biblioteca", exact: true }).click(); }
async function createScreen(page: Page) {
  await page.getByRole("button", { name: "Crear o importar torneo", exact: true }).click();
  await expect(page.getByRole("region", { name: "Importar campeonatos" })).toBeVisible();
}
function game(page: Page) { return page.getByRole("group", { name: / contra / }).first(); }

test("creación, participantes, resultados, tabla y simulaciones desde la interfaz", async ({ page }, info) => {
  await page.goto("/"); await expect(page.getByRole("heading", { name: "Biblioteca de torneos" })).toBeVisible();
  await layout(page, info, "library"); await createScreen(page);
  await page.getByLabel("Nombre del campeonato").fill("Liga visual");
  await page.getByRole("button", { name: "+ Agregar equipo", exact: true }).click();
  await page.getByLabel("Equipo 5", { exact: true }).fill("Club agregado");
  await page.getByRole("button", { name: "Quitar equipo 5", exact: true }).click();
  for (const [i, name] of ["Alfa", "Beta", "Gamma", "Delta"].entries()) await page.getByLabel(`Equipo ${i + 1}`, { exact: true }).fill(name);
  await page.getByLabel("Ruedas (veces que se enfrentan entre sí)").fill("2");
  await page.getByLabel("Puntos por victoria").fill("5");
  await library(page); await createScreen(page);
  await expect(page.getByLabel("Nombre del campeonato")).toHaveValue("Liga visual");
  await layout(page, info, "setup");
  await page.getByRole("button", { name: /Crear campeonato/ }).click();
  await expect(game(page)).toBeVisible();
  let inputs = game(page).getByRole("spinbutton");
  await inputs.nth(0).fill("3"); await inputs.nth(1).fill("1");
  await game(page).getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByText("Resultado guardado.", { exact: true })).toBeVisible();
  const home = (await saved(page))[0].matchdays[0].fixtures[0].homeTeamId;
  const homeName = (await saved(page))[0].teams.find(t => t.id === home)!.name;
  const row = page.getByRole("region", { name: "Tabla de posiciones", exact: true }).getByRole("row").filter({ hasText: homeName });
  await expect(row.locator(".standing-points")).toHaveText("5");
  await inputs.nth(0).fill("0"); await inputs.nth(1).fill("2");
  await game(page).getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(row.locator(".standing-points")).toHaveText("0");
  await game(page).getByRole("button", { name: /^Simular (partido|de nuevo)$/ }).click();
  await page.getByRole("button", { name: "Simular fecha", exact: true }).first().click();
  await expect(page.getByRole("region", { name: "Estadísticas del campeonato" })).toBeVisible();
  const stored = (await saved(page))[0];
  expect(stored.matchdays).toHaveLength(6); expect(stored.matchdays[0].fixtures.every(f => f.result)).toBe(true);
  await layout(page, info, "championship");
  await page.reload(); expect((await saved(page))[0].matchdays).toEqual(stored.matchdays);
  await expect(game(page)).toBeVisible();
});

test("simular la segunda rueda conserva íntegramente la primera", async ({ page }) => {
  const original = league(); await seed(page, [original]);
  await page.getByRole("combobox", { name: "Rueda", exact: true }).selectOption("2");
  await page.getByRole("button", { name: "Simular rueda", exact: true }).click();
  await expect.poll(async () => (await saved(page))[0].matchdays.filter(d => d.leg === 2).every(d => d.fixtures.every(f => f.result))).toBe(true);
  expect((await saved(page))[0].matchdays.filter(d => d.leg === 1)).toEqual(original.matchdays.filter(d => d.leg === 1));
});

test("borradores entre resumen, calendario y biblioteca; separación y recarga real", async ({ page }, info) => {
  const a = league(), other = league("other", "Otra competición");
  const b: Tournament = { ...other, teams: other.teams.map(t => ({ ...t, name: `Otro ${t.name}` })) };
  await seed(page, [a, b]); await game(page).getByRole("spinbutton").nth(0).fill("7");
  await page.getByRole("button", { name: "Centro de calendario", exact: true }).click();
  const calendar = page.getByRole("region", { name: `Calendario de ${a.name}` });
  await expect(calendar.getByRole("group").first().getByRole("spinbutton").nth(0)).toHaveValue("7");
  await layout(page, info, "calendar");
  await library(page); await page.getByRole("listitem", { name: b.name, exact: true }).getByRole("button", { name: "Abrir torneo", exact: true }).click();
  await expect(game(page).getByRole("spinbutton").nth(0)).toHaveValue("");
  await expect(game(page)).toHaveAccessibleName(/Otro /);
  await library(page); await page.getByRole("listitem", { name: a.name, exact: true }).getByRole("button", { name: "Abrir torneo", exact: true }).click();
  await expect(game(page).getByRole("spinbutton").nth(0)).toHaveValue("7");
  expect((await saved(page))[0].matchdays[0].fixtures[0].result).toBeUndefined();
  await page.reload(); await expect(game(page).getByRole("spinbutton").nth(0)).toHaveValue("");
});

test("descarga y restauración JSON v7, confirmación nativa y teclado", async ({ page }, info) => {
  const original = league(); await seed(page, [original]); await library(page);
  await page.getByRole("button", { name: "Centro de guardado y recuperación", exact: true }).click();
  const center = page.getByRole("region", { name: "Centro de guardado y recuperación", exact: true });
  await expect(center.getByText("JSON v7 · cancha-backup")).toBeVisible();
  await expect(center.getByText("Respaldo por universo", { exact: true })).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await center.getByRole("button", { name: "Descargar respaldo completo", exact: true }).click();
  const download = await downloadEvent; const bytes = await readFile((await download.path())!);
  const archive = JSON.parse(bytes.toString()); expect(archive.version).toBe(7);
  await center.getByRole("button", { name: "Restaurar respaldo", exact: true }).click();
  const input = page.getByLabel("Archivo JSON de respaldo");
  await input.setInputFiles({ name: "corrupt.json", mimeType: "application/json", buffer: Buffer.from("{broken") });
  await expect(page.getByRole("alert").filter({ hasText: /JSON válido/ })).toBeVisible();
  expect((await saved(page))[0]).toEqual(original);
  await input.setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: bytes });
  const dialog = page.getByRole("dialog", { name: "Restaurar respaldo", exact: true });
  await expect(dialog.getByRole("button", { name: "Cancelar", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Reemplazar biblioteca", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Cancelar", exact: true })).toBeFocused();
  await layout(page, info, "restore-dialog");
  await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible();
  expect((await saved(page))[0]).toEqual(original);
  await input.setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: bytes });
  await dialog.getByRole("button", { name: "Reemplazar biblioteca", exact: true }).click();
  await expect(dialog).not.toBeVisible(); await page.reload();
  expect(await saved(page)).toEqual(archive.tournaments);
});

test("grupos y eliminatorias reales en componentes diferidos", async ({ page }, info) => {
  const cup = continentalCup("libertadores"); await seed(page, [cup]);
  await page.getByRole("combobox", { name: "Etapa", exact: true }).selectOption({ label: "Copa Libertadores · Fase de grupos" });
  await expect(page.getByRole("region", { name: "Tabla de posiciones", exact: true })).toHaveCount(8);
  await layout(page, info, "groups");
  await page.getByRole("combobox", { name: "Etapa", exact: true }).selectOption({ label: "Copa Libertadores · Octavos de final · Ida" });
  await expect(game(page)).toBeVisible(); await game(page).getByRole("button", { name: /^Simular (partido|de nuevo)$/ }).click();
  await layout(page, info, "knockout");
});

test("copas nacionales de ida y vuelta y partido único", async ({ page }, info) => {
  for (const kind of ["argentina", "brasil"] as const) {
    const cup = nationalCup(kind); await seed(page, [cup]);
    await expect(game(page)).toBeVisible(); await game(page).getByRole("button", { name: /^Simular (partido|de nuevo)$/ }).click();
    await page.getByRole("button", { name: "Centro de calendario", exact: true }).click();
    await expect(page.getByRole("region", { name: `Calendario de ${cup.name}` })).toBeVisible();
    await layout(page, info, `national-cup-${kind}`);
  }
});

test("Segunda División, sorteos y transición bloqueada con cobertura incompleta", async ({ page }, info) => {
  for (const kind of ["argentina", "brasil"] as const) {
    const original = divisionFixture(kind);
    const lower: Tournament = { ...original, matchdays: original.matchdays.slice(0, 1)
      .map(d => ({ ...d, fixtures: d.fixtures.map(({ result: _result, ...f }) => f) })) };
    await seed(page, [lower]);
    const panel = page.getByRole("region", { name: "Ascensos y descensos", exact: true });
    await expect(panel).toBeVisible();
    await expect(page.getByRole("region", { name: "Resoluciones oficiales" })).toBeVisible();
    await panel.getByText("Conectar divisiones y planificar la próxima temporada", { exact: true }).click();
    await expect(panel.getByRole("button", { name: "Revisar nuevas temporadas", exact: true })).toBeDisabled();
    await layout(page, info, `second-${kind}`);
  }
});

test("temporada futura pendiente conserva el borrador de reglamento sin verificarlo", async ({ page }, info) => {
  const future: Tournament = { ...league("brasileirao-serie-a-2027", "Série A 2027"), competitionId: "brasileirao-serie-a", season: 2027,
    matchdays: [], competitionRules: { season: 2027, points: { win: 3, draw: 1, loss: 0 }, tieBreakers: [],
      verification: { standings: "pending", placements: "pending" }, standingsNote: "Reglamento pendiente", placementsNote: "Movimientos pendientes" } };
  await seed(page, [future]); const panel = page.getByRole("region", { name: "Preparación de temporada", exact: true });
  await expect(panel).toBeVisible(); await panel.getByText("Registrar reglamento anual documentado", { exact: true }).click();
  await panel.getByLabel("Disposiciones de tabla y referencia documental").fill("Borrador sin fuente");
  await layout(page, info, "future-rules");
  await library(page); await page.getByRole("button", { name: "Volver al torneo activo", exact: true }).click();
  await panel.getByText("Registrar reglamento anual documentado", { exact: true }).click();
  await expect(panel.getByLabel("Disposiciones de tabla y referencia documental")).toHaveValue("Borrador sin fuente");
  expect((await saved(page))[0].competitionRules!.verification.standings).toBe("pending");
});

test("expediente de proveedor conserva datos originales y formulario navegable", async ({ page }, info) => {
  const activity: unknown[] = [];
  recordSourceRejection({ findActivity: () => activity, recordActivity: event => { activity.push(event); } } as Parameters<typeof recordSourceRejection>[0], {
    id: "e2e-provider", name: "Proveedor sintético", season: 2026, sourceName: "Fixture E2E", sourceUrl: "https://example.org/source",
    matchdays: [1, 2].map(number => ({ number, matches: [{ id: `game-${number}`, homeTeamName: "Comunal", awayTeamName: "Aguará" }] }))
  }, "Localía duplicada de prueba");
  expect(activity).toHaveLength(1);
  await seed(page, [], activity); await createScreen(page);
  const panel = page.getByRole("region", { name: "Incidencias de fuentes externas" });
  await panel.getByText(/Proveedor sintético · 2026 · Pendiente/).click();
  await panel.getByLabel("Documento HTTPS").fill("https://example.org/document");
  await panel.getByText("Datos originales y correcciones registradas", { exact: true }).click();
  await expect(panel.locator("pre")).toContainText("Comunal");
  await layout(page, info, "source-incident");
  await library(page); await createScreen(page); await panel.getByText(/Proveedor sintético · 2026 · Pendiente/).click();
  await expect(panel.getByLabel("Documento HTTPS")).toHaveValue("https://example.org/document");
  expect(await saved(page)).toEqual([]);
});

test("carga lenta del calendario presenta su estado y conserva las ediciones", async ({ page }) => {
  await seed(page, [league()]); await game(page).getByRole("spinbutton").nth(0).fill("6");
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/match-calendar-*.js", async route => { await gate; await route.continue(); });
  try {
    await page.getByRole("button", { name: "Centro de calendario", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Cargando calendario" })).toBeVisible();
  } finally { release(); }
  await expect(page.getByRole("region", { name: "Calendario de Liga de navegador" }).getByRole("group").first().getByRole("spinbutton").nth(0)).toHaveValue("6");
});

test("fallo HTTP de un chunk aísla el panel y permite recuperar con las acciones disponibles", async ({ page, browserName }, info) => {
  info.annotations.push({ type: "expected-chunk-failure", description: "Se devuelve HTTP 503 exclusivamente para el chunk de estadísticas" });
  await page.route("**/tournament-statistics-panel-*.js", route => route.fulfill({ status: 503, contentType: "text/javascript", headers: { "cache-control": "no-store" }, body: "Temporary E2E failure" }));
  await seed(page, [league()]);
  await expect(page.getByRole("alert").filter({ hasText: "No se pudo abrir este panel" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Tabla de posiciones", exact: true })).toBeVisible();
  await game(page).getByRole("spinbutton").nth(0).fill("4");
  await game(page).getByRole("spinbutton").nth(1).fill("1");
  await game(page).getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByText("Resultado guardado.", { exact: true })).toBeVisible();
  await layout(page, info, "failed-panel");
  await page.unroute("**/tournament-statistics-panel-*.js");
  let recovered = page;
  if (browserName === "webkit") {
    info.annotations.push({ type: "recovery", description: "Pestaña nueva: WebKit reutiliza el módulo fallido tras una recarga normal" });
    await expect(page.getByRole("alert")).toContainText("abre una pestaña vacía desde el navegador");
    // A blank tab created from the browser, followed by address-bar navigation.
    // A popup link in WebKit can reuse the failed document's module cache.
    recovered = await page.context().newPage();
    await recovered.goto(page.url());
  } else await page.getByRole("button", { name: "Recargar la aplicación", exact: true }).click();
  await expect(recovered.getByRole("region", { name: "Estadísticas del campeonato" })).toBeVisible();
  expect((await saved(recovered))[0].matchdays[0].fixtures[0].result).toEqual({ homeGoals: 4, awayGoals: 1 });
  if (recovered !== page) await recovered.close();
});


test("confirmaciones con nombres largos y ventana baja permiten alcanzar sus acciones", async ({ page }, info) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await seed(page, [league()]); await library(page);
  await page.getByRole("button", { name: "Centro de guardado y recuperación", exact: true }).click();
  const center = page.getByRole("region", { name: "Centro de guardado y recuperación", exact: true });
  const downloadEvent = page.waitForEvent("download");
  await center.getByRole("button", { name: "Descargar respaldo completo", exact: true }).click();
  const download = await downloadEvent; const bytes = await readFile((await download.path())!);
  await center.getByRole("button", { name: "Restaurar respaldo", exact: true }).click();
  await page.getByLabel("Archivo JSON de respaldo").setInputFiles({ name: `${"respaldo".repeat(22)}.json`, mimeType: "application/json", buffer: bytes });
  const dialog = page.getByRole("dialog", { name: "Restaurar respaldo", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.screenshot({ path: info.outputPath("short-window-dialog.png") });
  const metrics = await dialog.evaluate(d => ({ scrollWidth: d.scrollWidth, width: d.clientWidth,
    scrollHeight: d.scrollHeight, height: d.clientHeight, overflowY: getComputedStyle(d).overflowY }));
  expect(metrics.scrollWidth, JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.width + 1);
  if (metrics.scrollHeight > metrics.height + 1) expect(metrics.overflowY).toMatch(/auto|scroll/);
  const cancel = dialog.getByRole("button", { name: "Cancelar", exact: true });
  await cancel.scrollIntoViewIfNeeded();
  const box = (await cancel.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(375);
  await cancel.click(); await expect(dialog).not.toBeVisible();
  expect(await saved(page)).toHaveLength(1);
});


test("diálogo de simulación sigue utilizable con poca altura", async ({ page }, info) => {
  await page.setViewportSize({ width: 667, height: 375 });
  const original = argentinaUpper();
  const argentina: Tournament = { ...original, matchdays: original.matchdays.slice(0, 1) };
  await seed(page, [argentina]);
  await page.getByRole("button", { name: "Simular fase", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "¿Hasta qué etapa quieres simular?", exact: true });
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: info.outputPath("short-simulation-dialog.png") });
  const metrics = await dialog.evaluate(d => ({ scrollHeight: d.scrollHeight, height: d.clientHeight, overflowY: getComputedStyle(d).overflowY }));
  if (metrics.scrollHeight > metrics.height + 1) expect(metrics.overflowY, JSON.stringify(metrics)).toMatch(/auto|scroll/);
  const cancel = dialog.getByRole("button", { name: "Cancelar", exact: true });
  await cancel.scrollIntoViewIfNeeded(); const box = (await cancel.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(375);
  await page.keyboard.press("Escape"); await expect(dialog).not.toBeVisible();
  expect((await saved(page))[0].matchdays).toEqual(argentina.matchdays);
});


test("guardar un resultado mantiene el panel en su columna", async ({ page }) => {
  await seed(page, [league()]);
  const panel = page.locator(".preview-panel"); const before = (await panel.boundingBox())!;
  await game(page).getByRole("spinbutton").nth(0).fill("2");
  await game(page).getByRole("spinbutton").nth(1).fill("0");
  await game(page).getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page.getByText("Resultado guardado.", { exact: true })).toBeVisible();
  const after = (await panel.boundingBox())!;
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
  const vertical = await page.evaluate(() => ({ panelBottom: document.querySelector(".preview-panel")!.getBoundingClientRect().bottom,
    footerTop: document.querySelector(".page-footer")!.getBoundingClientRect().top }));
  expect(vertical.footerTop, JSON.stringify(vertical)).toBeGreaterThanOrEqual(vertical.panelBottom);
});

test("centro de competiciones conserva temporadas y navega con diseño adaptable", async ({ page }, info) => {
  const source = { ...league(), competitionId: "brasileirao-serie-a", sourceUrl: "https://www.espn.com/soccer/", sourceName: "ESPN" };
  const future: Tournament = { ...source, id: "planned-center", season: 2027, name: "Planificación 2027", matchdays: [], sourceUrl: undefined,
    seasonPreparation: { schemaVersion: 1, sourceTournamentIds: [source.id], plannedParticipants: source.teams.map(t => t.name), calendarReviews: [] } };
  await seed(page, [source, future]);
  await game(page).getByRole("spinbutton").nth(0).fill("8");
  await library(page);
  await page.getByRole("button", { name: "Centro de competiciones y temporadas", exact: true }).click();
  await page.getByLabel("País o confederación").selectOption("Brasil");
  await page.getByLabel("Competición guardada").selectOption("brasileirao-serie-a");
  const center = page.getByRole("region", { name: "Centro de competiciones y temporadas" });
  await expect(center.getByRole("article")).toHaveCount(2);
  await expect(center.getByText("Planificación · escenario local", { exact: true })).toBeVisible();
  await center.getByRole("article").first().scrollIntoViewIfNeeded();
  await layout(page, info, "competition-center");
  await center.getByRole("article", { name: "Temporada 2027: Planificación 2027" }).getByRole("button", { name: "Abrir temporada", exact: true }).click();
  await library(page);
  await expect(page.getByLabel("Competición guardada")).toHaveValue("brasileirao-serie-a");
  await page.getByRole("article", { name: `Temporada 2026: ${source.name}` }).getByRole("button", { name: "Abrir temporada", exact: true }).click();
  await expect(game(page).getByRole("spinbutton").nth(0)).toHaveValue("8");
  expect((await saved(page)).map(t => ({ id: t.id, matchdays: t.matchdays }))).toEqual([source, future].map(t => ({ id: t.id, matchdays: t.matchdays })));
});

test("clasificación internacional documentada desde el centro conserva trazabilidad y resultados", async ({ page }, info) => {
  const national=continentalLeague(); await seed(page,[national]); await library(page);
  await page.getByRole("button",{name:"Centro de competiciones y temporadas",exact:true}).click();
  await page.getByLabel("Competición guardada").selectOption(national.competitionId!);
  await page.getByText("Clasificación internacional y ediciones continentales",{exact:true}).click();
  const panel=page.getByRole("region",{name:`Clasificación internacional de ${national.name}`});
  await expect(panel.getByText(/Alfa · Confirmado por reglas verificadas/)).toBeVisible();
  await panel.getByLabel("Edición continental propuesta").fill("2027");
  await panel.getByLabel(/Alfa · Confirmado por reglas verificadas/).check();
  await panel.getByLabel("Referencia documental HTTPS").fill("https://www.conmebol.com/documento-sintetico");
  await panel.getByLabel("Decisión y relación entre temporadas").fill("Vinculación 2026 a 2027 sintética para pruebas. Planificación local.");
  await panel.getByRole("button",{name:"Revisar vinculación continental"}).click();
  await expect(page.getByRole("dialog",{name:"Preparar edición continental"})).toBeVisible();
  expect(await saved(page)).toHaveLength(1);
  await page.getByRole("button",{name:"Confirmar planificación",exact:true}).click();
  await expect(panel.getByRole("status")).toContainText("Se guardó la vinculación");
  let data=await saved(page);expect(data).toHaveLength(2);expect(data.find(t=>t.id===national.id)?.matchdays).toEqual(national.matchdays);
  const cup=data.find(t=>t.competitionId==="conmebol-libertadores")!;expect(cup.matchdays).toEqual([]);expect(cup.teams.map(t=>t.name)).toEqual(["Alfa"]);
  await page.getByLabel("Competición guardada").selectOption("conmebol-libertadores");
  await page.getByText("Clasificación internacional y ediciones continentales",{exact:true}).click();
  await page.getByText(/Procedencia registrada · 2026/).click();
  await expect(page.getByText("Dependencias vigentes · planificación local",{exact:false})).toBeVisible();
  await page.getByText(/Procedencia registrada · 2026/).scrollIntoViewIfNeeded();await layout(page,info,"continental-qualification");
  await page.reload();data=await saved(page);
  expect(data.find(t=>t.id===cup.id)?.continentalPlans?.[0].entries[0].originTournamentId).toBe(national.id);
});

test("historial de clubes desde el centro conserva borradores y separa identidades homónimas",async({page},info)=>{
 const first=continentalLeague(),second={...first,id:"club-history-next",season:2027,name:"Liga histórica 2027",competitionRules:{...first.competitionRules!,season:2027}};
 const homonym=continentalLeague("homonym-2026");await seed(page,[first,second,homonym]);
 await game(page).getByRole("spinbutton").nth(0).fill("7");await library(page);
 await page.getByRole("button",{name:"Centro de competiciones y temporadas",exact:true}).click();
 await page.getByRole("button",{name:"Historial deportivo de clubes",exact:true}).click();
 const history=page.getByRole("region",{name:"Historial deportivo de clubes"});
 const selector=history.getByRole("combobox",{name:"Club registrado",exact:true});
 const option=selector.getByRole("option").filter({hasText:`Alfa · ID ${first.teams[0].id} · 2 registro(s)`});
 await selector.selectOption((await option.getAttribute("value"))!);
 await expect(history.getByRole("article")).toHaveCount(2);await expect(history.getByText(/Hay otros registros con el mismo nombre/)).toBeVisible();
 await history.getByRole("checkbox").nth(0).check();await history.getByRole("checkbox").nth(1).check();
 await expect(history.getByRole("region",{name:"Estadísticas acumuladas del club"}).getByText(/6 PJ · 6 G/)).toBeVisible();
 await history.getByRole("article").first().scrollIntoViewIfNeeded();await layout(page,info,"club-history");
 await history.getByRole("button",{name:"Abrir torneo de origen",exact:true}).first().click();
 await expect(game(page).getByRole("spinbutton").nth(0)).toHaveValue("7");await library(page);
 await expect(page.getByRole("region",{name:"Historial deportivo de clubes"}).getByRole("checkbox").first()).toBeChecked();
 expect((await saved(page)).find(t=>t.id===first.id)?.matchdays).toEqual(first.matchdays);
 await page.getByRole("region",{name:"Historial deportivo de clubes"}).getByRole("button",{name:"Abrir torneo de origen",exact:true}).first().click();
 await game(page).getByRole("button",{name:"Guardar",exact:true}).click();
 await expect(page.getByText("Resultado guardado.",{exact:true})).toBeVisible();await library(page);
 const updated=page.getByRole("region",{name:"Historial deportivo de clubes"});
 await expect(updated.getByRole("article").first().getByText(/6 puntos/)).toBeVisible();
 await expect(updated.getByRole("alert")).toContainText("escenarios");
});


test("palmarés y récords históricos conservan alcances y respaldos",async({page},info)=>{
 const first=continentalLeague(),second={...first,id:"honours-next",season:2027,name:"Liga histórica 2027",competitionRules:{...first.competitionRules!,season:2027}};
 await seed(page,[first,second]);await library(page);
 await page.getByRole("button",{name:"Centro de competiciones y temporadas",exact:true}).click();
 await page.getByRole("button",{name:"Palmarés y récords históricos",exact:true}).click();
 const panel=page.getByRole("region",{name:"Clasificaciones históricas",exact:true});
 await panel.getByLabel("Competición para récords").selectOption(first.competitionId!);
 await panel.getByRole("checkbox").nth(0).check();await panel.getByRole("checkbox").nth(1).check();
 await expect(panel.getByText("Alfa: 2",{exact:true})).toBeVisible();
 await panel.getByLabel("Estadística histórica").selectOption("points");
 const scopes=panel.getByLabel("Fase y alcance comparables");await scopes.selectOption((await scopes.getByRole("option").nth(1).getAttribute("value"))!);
 await expect(panel.getByText("Alfa: 9",{exact:true})).toHaveCount(2);
 await panel.scrollIntoViewIfNeeded();await layout(page,info,"historical-records");
 await panel.getByRole("button",{name:/Abrir respaldo/}).first().click();await library(page);
 await expect(page.getByLabel("Estadística histórica")).toHaveValue("points");
 expect((await saved(page)).map(t=>t.matchdays)).toEqual([first,second].map(t=>t.matchdays));
 await page.getByRole("button",{name:"Historial deportivo de clubes",exact:true}).click();
 const history=page.getByRole("region",{name:"Historial deportivo de clubes",exact:true});
 const club=history.getByRole("combobox",{name:"Club registrado",exact:true});
 const option=club.getByRole("option").filter({hasText:`Alfa · ID ${first.teams[0].id}`});await club.selectOption((await option.getAttribute("value"))!);
 await expect(history.getByRole("region",{name:"Palmarés y récords del club",exact:true}).getByText("Campeón: Alfa",{exact:true})).toHaveCount(2);
 await history.getByRole("button",{name:/Abrir respaldo del palmarés/}).first().click();await library(page);
 await expect(page.getByLabel("Estadística histórica")).toHaveValue("points");
});


test("H2H desde centro, perfil y calendario conserva filtros y marcadores",async({page},info)=>{
 const t=continentalLeague();await seed(page,[t]);
 await game(page).getByRole("spinbutton").nth(0).fill("7");await library(page);
 await page.getByRole("button",{name:"Centro de competiciones y temporadas",exact:true}).click();
 await page.getByRole("button",{name:"Enfrentamientos directos (H2H)",exact:true}).click();
 const panel=page.getByRole("region",{name:"Enfrentamientos directos (H2H) · Centro",exact:true});
 const a=panel.getByRole("combobox",{name:"Club A",exact:true}),b=panel.getByRole("combobox",{name:"Club B",exact:true});
 const aOption=a.getByRole("option").filter({hasText:`Alfa · ID ${t.teams[0].id}`}),bOption=b.getByRole("option").filter({hasText:`Beta · ID ${t.teams[1].id}`});
 await a.selectOption((await aOption.getAttribute("value"))!);await b.selectOption((await bOption.getAttribute("value"))!);
 await expect(panel.getByRole("article")).toHaveCount(1);await panel.getByRole("checkbox").check();
 await expect(panel.getByRole("region",{name:"Acumulado H2H"}).getByText(/1 PJ · A: 1 victorias/)).toBeVisible();
 await panel.getByLabel("Temporada H2H").selectOption("2026");await panel.scrollIntoViewIfNeeded();await layout(page,info,"head-to-head");
 await panel.getByRole("button",{name:"Abrir torneo del encuentro",exact:true}).click();await expect(game(page).getByRole("spinbutton").nth(0)).toHaveValue("7");
 await game(page).getByRole("button",{name:"Comparar clubes (H2H)",exact:true}).click();
 const calendar=page.getByRole("region",{name:"Enfrentamientos directos (H2H) · Calendario",exact:true});await expect(calendar.getByRole("combobox",{name:"Club A",exact:true})).not.toHaveValue("");await expect(calendar.getByRole("combobox",{name:"Club B",exact:true})).not.toHaveValue("");
 await page.getByRole("button",{name:"Cerrar comparación del calendario",exact:true}).click();await library(page);
 await expect(panel.getByLabel("Temporada H2H")).toHaveValue("2026");await expect(panel.getByRole("checkbox")).toBeChecked();
 expect((await saved(page))[0].matchdays).toEqual(t.matchdays);
 await page.getByRole("button",{name:"Historial deportivo de clubes",exact:true}).click();
 const history=page.getByRole("region",{name:"Historial deportivo de clubes",exact:true});const club=history.getByRole("combobox",{name:"Club registrado",exact:true});await club.selectOption((await club.getByRole("option").filter({hasText:`Alfa · ID ${t.teams[0].id}`}).getAttribute("value"))!);
 await history.getByRole("button",{name:"Enfrentamientos directos (H2H)",exact:true}).click();await expect(history.getByRole("region",{name:"Enfrentamientos directos (H2H) · Perfil de club",exact:true}).getByRole("combobox",{name:"Club A",exact:true})).not.toHaveValue("");
});


test("rendimiento de clubes grafica temporadas y compara actuación general sin perder borradores",async({page},info)=>{
 const t=continentalLeague(),next={...t,id:"performance-next",season:2027,name:"Liga de prueba 2027",competitionRules:{...t.competitionRules!,season:2027}};
 await seed(page,[t,next]);await game(page).getByRole("spinbutton").nth(0).fill("7");await library(page);
 await page.getByRole("button",{name:"Centro de competiciones y temporadas",exact:true}).click();await page.getByRole("button",{name:"Rendimiento deportivo de clubes",exact:true}).click();
 const panel=page.getByRole("region",{name:"Rendimiento deportivo · Centro",exact:true});
 const club=panel.getByRole("combobox",{name:"Club para rendimiento",exact:true});await club.selectOption((await club.getByRole("option").filter({hasText:`Alfa · ID ${t.teams[0].id}`}).getAttribute("value"))!);
 await panel.getByRole("combobox",{name:"Competición para rendimiento",exact:true}).selectOption(t.competitionId!);
 const scope=panel.getByRole("combobox",{name:"Temporada y fase de rendimiento",exact:true});await scope.selectOption((await scope.getByRole("option").nth(1).getAttribute("value"))!);
 await expect(panel.getByText(/Promedio de goles a favor por partido: 2,00/)).toBeVisible();await expect(panel.getByRole("figure",{name:"Resultados generales de Alfa",exact:true})).toBeVisible();
 await panel.getByText("Evolución por jornada de Alfa",{exact:true}).click();await expect(panel.getByRole("table",{name:"Jornadas y acumulados disponibles",exact:true})).toBeVisible();
 const peer=panel.getByRole("combobox",{name:"Segundo club para comparar rendimiento",exact:true});await peer.selectOption((await peer.getByRole("option").filter({hasText:`Beta · ID ${t.teams[1].id}`}).getAttribute("value"))!);
 await expect(panel.getByRole("region",{name:"Comparación de rendimiento general",exact:true})).toBeVisible();
 await panel.getByRole("checkbox").nth(0).check();await panel.getByRole("checkbox").nth(1).check();await expect(panel.getByRole("region",{name:"Evolución entre temporadas",exact:true})).toBeVisible();
 await panel.getByRole("figure",{name:"Resultados generales de Alfa",exact:true}).scrollIntoViewIfNeeded();await layout(page,info,"club-performance");
 await panel.getByRole("button",{name:"Abrir origen del rendimiento",exact:true}).first().click();await expect(game(page).getByRole("spinbutton").nth(0)).toHaveValue("7");await library(page);
 await expect(panel.getByRole("checkbox").first()).toBeChecked();await expect(panel.getByRole("combobox",{name:"Segundo club para comparar rendimiento",exact:true})).not.toHaveValue("");
 expect((await saved(page)).map(t=>t.matchdays)).toEqual([t,next].map(t=>t.matchdays));
 await panel.getByRole("button",{name:"Abrir origen del rendimiento",exact:true}).first().click();await game(page).getByRole("button",{name:"Guardar",exact:true}).click();await expect(page.getByText("Resultado guardado.",{exact:true})).toBeVisible();await library(page);
 await expect(panel.getByText(/Promedio de goles a favor por partido: 2,00 · En contra: 2,33/)).toBeVisible();await expect(panel.getByRole("alert")).toContainText("incompatibles");
 expect((await saved(page)).find(saved=>saved.id===next.id)?.matchdays).toEqual(next.matchdays);

 await page.getByRole("button",{name:"Historial deportivo de clubes",exact:true}).click();const history=page.getByRole("region",{name:"Historial deportivo de clubes",exact:true});const identity=history.getByRole("combobox",{name:"Club registrado",exact:true});await identity.selectOption((await identity.getByRole("option").filter({hasText:`Alfa · ID ${t.teams[0].id}`}).getAttribute("value"))!);
 await history.getByRole("button",{name:"Rendimiento deportivo de clubes",exact:true}).click();await expect(history.getByRole("region",{name:"Rendimiento deportivo · Perfil de club",exact:true}).getByRole("combobox",{name:"Club para rendimiento",exact:true})).not.toHaveValue("");
});


test("centro de planificación revisa nóminas locales sin escribir hasta confirmar",async({page},info)=>{
 const t=continentalLeague();await seed(page,[t]);await game(page).getByRole("spinbutton").nth(0).fill("7");await library(page);
 await page.getByRole("button",{name:"Centro de competiciones y temporadas",exact:true}).click();await page.getByRole("button",{name:"Planificación de temporadas",exact:true}).click();
 const panel=page.getByRole("region",{name:"Centro de planificación de temporadas",exact:true});
 await panel.getByRole("combobox",{name:"Competición de planificación",exact:true}).selectOption(t.competitionId!);await panel.getByRole("combobox",{name:"Temporada de origen de planificación",exact:true}).selectOption(t.id);await panel.getByRole("spinbutton",{name:"Año o edición de destino",exact:true}).fill("2028");await panel.getByRole("checkbox",{name:/Propongo expresamente/}).check();
 await expect(panel.getByRole("region",{name:"Vista previa de temporada"}).getByText(/4 participantes seleccionados/)).toBeVisible();expect(await saved(page)).toHaveLength(1);
 await panel.getByRole("button",{name:`Abrir origen: ${t.name}`,exact:true}).first().click();await expect(game(page).getByRole("spinbutton").nth(0)).toHaveValue("7");await library(page);await expect(panel.getByRole("spinbutton",{name:"Año o edición de destino",exact:true})).toHaveValue("2028");
 await panel.getByRole("region",{name:"Vista previa de temporada"}).scrollIntoViewIfNeeded();await layout(page,info,"season-planning-roster");await panel.getByRole("button",{name:"Revisar planificación y continuar",exact:true}).click();await expect(page.getByRole("dialog",{name:"Confirmar planificación local"})).toBeVisible();expect(await saved(page)).toHaveLength(1);await page.getByRole("button",{name:"Cancelar",exact:true}).click();expect(await saved(page)).toHaveLength(1);
 await panel.getByRole("button",{name:"Revisar planificación y continuar",exact:true}).click();await page.getByRole("button",{name:"Confirmar preparación",exact:true}).click();await expect(panel.getByRole("status")).toContainText("Planificación guardada");
 const data=await saved(page),next=data.find(s=>s.id!==t.id)!;expect(data).toHaveLength(2);expect(data.find(s=>s.id===t.id)?.matchdays).toEqual(t.matchdays);expect(next.season).toBe(2028);expect(next.matchdays).toEqual([]);expect(next.competitionRules?.verification.standings).toBe("pending");expect(next.seasonPreparation?.sourceTournamentIds).toEqual([t.id]);
 await panel.getByRole("button",{name:"Historial de Alfa",exact:true}).click();await expect(panel.getByRole("region",{name:"Historial deportivo de clubes",exact:true}).getByRole("combobox",{name:"Club registrado",exact:true})).not.toHaveValue("");
});

test("centro de planificación continental revalida dependencias antes de escribir",async({page},info)=>{
 const t=continentalLeague();await seed(page,[t]);await library(page);await page.getByRole("button",{name:"Centro de competiciones y temporadas",exact:true}).click();await page.getByRole("button",{name:"Planificación de temporadas",exact:true}).click();const panel=page.getByRole("region",{name:"Centro de planificación de temporadas",exact:true});
 await panel.getByRole("combobox",{name:"Competición de planificación",exact:true}).selectOption(t.competitionId!);await panel.getByRole("combobox",{name:"Temporada de origen de planificación",exact:true}).selectOption(t.id);await panel.getByRole("combobox",{name:"Flujo existente de preparación",exact:true}).selectOption("continental");await panel.getByRole("spinbutton",{name:"Año o edición de destino",exact:true}).fill("2027");await panel.getByRole("spinbutton",{name:"Temporada nacional de clasificación",exact:true}).fill("2026");await panel.getByLabel("Referencia documental HTTPS de la edición").fill("https://www.conmebol.com/documento-sintetico");await panel.getByLabel("Decisión documental y relación de ediciones").fill("Planificación sintética de prueba, sin carácter oficial. Relación 2026 a edición 2027.");await panel.getByRole("group",{name:"Seleccionar clasificados para la revisión existente",exact:true}).getByRole("checkbox").check();
 await panel.getByRole("region",{name:"Vista previa de temporada"}).scrollIntoViewIfNeeded();await layout(page,info,"season-planning-continental");await panel.getByRole("button",{name:"Revisar planificación y continuar",exact:true}).click();expect(await saved(page)).toHaveLength(1);await page.getByRole("button",{name:"Confirmar preparación",exact:true}).click();await expect(panel.getByRole("status")).toContainText("Planificación guardada");
 const data=await saved(page),cup=data.find(s=>s.competitionId==="conmebol-libertadores")!;expect(cup.teams.map(t=>t.name)).toEqual(["Alfa"]);expect(cup.matchdays).toEqual([]);expect(cup.continentalPlans).toHaveLength(1);
 await panel.getByRole("combobox",{name:"Edición guardada para revisión documental",exact:true}).selectOption(cup.id);await panel.getByRole("button",{name:"Revisar planificación y continuar",exact:true}).click();
 await page.evaluate(id=>{const data=JSON.parse(localStorage.getItem("cancha.tournaments") ?? "[]");const source=data.find((t:{id:string})=>t.id===id);source.matchdays[0].fixtures[0].result={homeGoals:7,awayGoals:2};localStorage.setItem("cancha.tournaments",JSON.stringify(data));},t.id);
 await page.getByRole("button",{name:"Confirmar preparación",exact:true}).click();await expect(panel.getByRole("alert")).toContainText("La biblioteca cambió");const unchanged=(await saved(page)).find(s=>s.id===cup.id)!;expect(unchanged.teams).toEqual(cup.teams);expect(unchanged.matchdays).toEqual(cup.matchdays);expect(unchanged.continentalPlans).toHaveLength(1);
});

test("centro de planificación coordina las dos divisiones mediante el caso existente",async({page},info)=>{
 const lowerSource=advanceSecondDivision(divisionFixture("brasil"));let randomSeed=42;const random=()=>{randomSeed=(Math.imul(1664525,randomSeed)+1013904223)>>>0;return randomSeed/4294967296;};
 const lower=simulateChampionship(lowerSource,"pendingOnly",{findAll:()=>[lowerSource],save(){},saveWithActivity(){}},random).tournament,upper=brazilUpper();await seed(page,[lower,upper]);await library(page);await page.getByRole("button",{name:"Centro de competiciones y temporadas",exact:true}).click();await page.getByRole("button",{name:"Planificación de temporadas",exact:true}).click();const panel=page.getByRole("region",{name:"Centro de planificación de temporadas",exact:true});
 await panel.getByRole("combobox",{name:"Competición de planificación",exact:true}).selectOption("brasileirao-serie-b");await panel.getByRole("combobox",{name:"Temporada de origen de planificación",exact:true}).selectOption(lower.id);await panel.getByRole("spinbutton",{name:"Año o edición de destino",exact:true}).fill("2027");await panel.getByRole("combobox",{name:"Flujo existente de preparación",exact:true}).selectOption("divisions");await panel.getByRole("combobox",{name:"Otra división elegida expresamente",exact:true}).selectOption(upper.id);await panel.getByLabel("Ascendidos inferiores aportados (uno por línea)").fill("Aportado 1\nAportado 2\nAportado 3\nAportado 4");await panel.getByLabel("Referencia HTTPS de los ascendidos inferiores").fill("https://www.cbf.com.br/ascensos-sinteticos");
 await expect(panel.getByRole("region",{name:"Vista previa de temporada"}).getByText(/40 participantes seleccionados/)).toBeVisible();await panel.getByRole("region",{name:"Vista previa de temporada"}).scrollIntoViewIfNeeded();await layout(page,info,"season-planning-divisions");await panel.getByRole("button",{name:"Revisar planificación y continuar",exact:true}).click();expect(await saved(page)).toHaveLength(2);await page.getByRole("button",{name:"Confirmar preparación",exact:true}).click();await expect(panel.getByRole("status")).toContainText("Planificación guardada");const data=await saved(page),future=data.filter(t=>t.season===2027);expect(future).toHaveLength(2);expect(future.every(t=>t.teams.length===20 && t.matchdays.length===0)).toBe(true);expect(data.find(t=>t.id===upper.id)?.matchdays).toEqual(upper.matchdays);expect(data.find(t=>t.id===lower.id)?.matchdays).toEqual(lower.matchdays);
});

test("copa nacional documenta admisión y prepara una edición sin reemplazos",async({page},info)=>{
 const {cup,league}=cupPlanningFixture();await seed(page,[cup,league]);await library(page);await page.getByRole("button",{name:"Centro de competiciones y temporadas",exact:true}).click();await page.getByRole("button",{name:"Planificación de temporadas",exact:true}).click();const panel=page.getByRole("region",{name:"Centro de planificación de temporadas",exact:true});
 await panel.getByRole("combobox",{name:"Competición de planificación",exact:true}).selectOption(cup.competitionId);await panel.getByRole("combobox",{name:"Temporada de origen de planificación",exact:true}).selectOption(cup.id);await panel.getByRole("spinbutton",{name:"Año o edición de destino",exact:true}).fill("2027");await panel.getByRole("combobox",{name:"Flujo existente de preparación",exact:true}).selectOption("national-cup");await expect(panel.getByRole("button",{name:"Revisar planificación y continuar",exact:true})).toBeDisabled();
 await panel.getByText("Registrar reglamento de admisión para esta edición",{exact:true}).click();const editor=panel.getByRole("region",{name:"Registro de admisión de copa nacional",exact:true});await editor.getByRole("combobox",{name:"Verificación del reglamento de admisión",exact:true}).selectOption("verified");await editor.getByRole("textbox",{name:"Fuente HTTPS del reglamento de admisión",exact:true}).fill("https://www.afa.com.ar/documento-sintetico");await editor.getByRole("textbox",{name:"Decisión documental de admisión",exact:true}).fill("Solo pruebas: la nómina de la división está prevista expresamente para esta edición.");await editor.getByRole("spinbutton",{name:"Cantidad total de participantes documentada",exact:true}).fill("4");
 await panel.getByRole("button",{name:`Abrir origen: ${cup.name}`,exact:true}).first().click();await library(page);await expect(panel).toBeVisible();if(!await editor.isVisible())await panel.getByText("Registrar reglamento de admisión para esta edición",{exact:true}).click();await expect(editor.getByRole("textbox",{name:"Decisión documental de admisión",exact:true})).toHaveValue(/Solo pruebas/);
 await editor.getByRole("combobox",{name:"Competición y temporada de procedencia",exact:true}).selectOption(league.id);await editor.getByRole("spinbutton",{name:"Cupos de este criterio",exact:true}).fill("4");await editor.getByRole("textbox",{name:"Descripción documental del criterio",exact:true}).fill("Nómina de división expresamente prevista");await editor.getByRole("textbox",{name:"Fuente HTTPS del criterio",exact:true}).fill("https://www.afa.com.ar/anexo-sintetico");await editor.getByRole("combobox",{name:"Verificación del criterio de admisión",exact:true}).selectOption("verified");await editor.getByRole("button",{name:"Agregar criterio a borrador",exact:true}).click();expect((await saved(page)).find(t=>t.id===cup.id)?.nationalCupPlanning).toBeUndefined();
 await editor.getByRole("button",{name:"Revisar registro de admisión",exact:true}).click();await page.getByRole("dialog",{name:"Confirmar registro de admisión",exact:true}).getByRole("button",{name:"Cancelar",exact:true}).click();expect((await saved(page)).find(t=>t.id===cup.id)?.nationalCupPlanning).toBeUndefined();await editor.getByRole("button",{name:"Revisar registro de admisión",exact:true}).click();await page.getByRole("button",{name:"Confirmar registro documental",exact:true}).click();await expect(panel.getByRole("region",{name:"Vista previa de temporada",exact:true}).getByText(/4 participantes seleccionados/)).toBeVisible();expect(await saved(page)).toHaveLength(2);
 await panel.getByRole("region",{name:"Vista previa de temporada",exact:true}).scrollIntoViewIfNeeded();await layout(page,info,"national-cup-planning");await panel.getByRole("button",{name:"Revisar planificación y continuar",exact:true}).click();expect(await saved(page)).toHaveLength(2);await page.getByRole("button",{name:"Confirmar preparación",exact:true}).click();await expect(panel.getByRole("status")).toContainText("Planificación guardada");const data=await saved(page),future=data.find(t=>t.season===2027)!;expect(future.matchdays).toEqual([]);expect(future.knockoutStages).toBeUndefined();expect(future.teams.map(t=>t.id)).toEqual(league.teams.map(t=>t.id));expect(future.competitionRules?.verification.placements).toBe("pending");expect(data.find(t=>t.id===cup.id)?.matchdays).toEqual(cup.matchdays);
 await panel.getByRole("combobox",{name:"Edición nacional existente para revisión",exact:true}).selectOption(future.id);await panel.getByRole("button",{name:"Revisar planificación y continuar",exact:true}).click();await page.getByRole("button",{name:"Confirmar preparación",exact:true}).click();await expect(panel.getByRole("status")).toContainText("Planificación guardada");const reviewed=(await saved(page)).find(t=>t.id===future.id)!;expect(reviewed.nationalCupPlanning?.reviews).toHaveLength(2);expect(reviewed.teams).toEqual(future.teams);expect(reviewed.matchdays).toEqual(future.matchdays);await page.reload();expect((await saved(page)).find(t=>t.id===future.id)?.nationalCupPlanning?.reviews).toHaveLength(2);
});

test("asistente de progresión consulta sin simular y navega al calendario",async({page})=>{
 const t=continentalLeague();await seed(page,[t]);await library(page);
 await page.getByRole("button",{name:"Centro de competiciones y temporadas",exact:true}).click();
 await page.getByText("Asistente de progresión de temporadas",{exact:true}).click();
 const panel=page.getByRole("region",{name:"Progresión encadenada de temporadas",exact:true});
 await panel.getByRole("checkbox").check();
 await expect(panel.getByRole("article")).toHaveCount(1);
 await expect(panel.getByText(/Partidos válidos:/)).toBeVisible();
 expect(await saved(page)).toEqual([t]);
 await panel.getByRole("button",{name:"Ir a simulación en calendario",exact:true}).click();
 await expect(page.getByRole("region",{name:`Calendario de ${t.name}`,exact:true})).toBeVisible();
 expect(await saved(page)).toEqual([t]);
});

async function checkpointRecords(page: Page): Promise<SaveCheckpoint[]> {
  return page.evaluate(() => new Promise<SaveCheckpoint[]>((resolve, reject) => {
    const request = indexedDB.open("cancha.save-checkpoints", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction("checkpoints", "readonly");let rows: SaveCheckpoint[] = [];
      const read = tx.objectStore("checkpoints").getAll();read.onsuccess = () => {rows = read.result;};
      tx.oncomplete = () => {db.close();resolve(rows);};tx.onabort = () => {db.close();reject(tx.error);};
    };
  }));
}
async function checkpointPanel(page: Page) {
  await library(page);
  await page.getByRole("button", {name: "Centro de guardado y recuperación", exact: true}).click();
  const panel = page.getByRole("region", {name: "Puntos de control manuales", exact: true});
  await expect(panel.getByText("Leyendo puntos guardados…")).toHaveCount(0);
  return panel;
}
async function sportsStorage(page: Page) {
  return page.evaluate(() => ["cancha.tournaments", "cancha.activity", "cancha.sportsUniverses"].map(key => localStorage.getItem(key)));
}

test("puntos de control: IndexedDB real, recarga, descarga, restauración y eliminación", async ({page}, info) => {
  const source = league("checkpoint-source", "Liga del punto");
  const first = source.matchdays[0].fixtures[0];
  const tournaments: Tournament[] = [{...source, calendarProvenance: "official-import", matchdays: source.matchdays.map((d,i) => i ? d : {...d, fixtures: d.fixtures.map((f,j) => j ? f : {...f, result: {homeGoals: 2, awayGoals: 1}})})},
    league("checkpoint-other", "Otra partida"), league("checkpoint-unassigned", "Sin asignar")];
  const universes: SportsUniverseLibrary = {version: 1, activeUniverseId: "checkpoint-u-one", universes: [{id: "checkpoint-u-one", name: "Universo uno"}, {id: "checkpoint-u-two", name: "Universo dos"}],
    assignments: {[source.id]: "checkpoint-u-one", "checkpoint-other": "checkpoint-u-two"}};
  await seed(page, tournaments, [{id: "checkpoint-event", action: "match-result-updated", tournamentId: source.id, tournamentName: source.name,
    universeId: "checkpoint-u-one", entityId: first.id, occurredAt: "2026-01-01T00:00:00Z", summary: "Resultado manual conservado", after: {homeGoals: 2, awayGoals: 1}}], universes);
  let panel = await checkpointPanel(page);const before = await sportsStorage(page);
  await panel.getByLabel("Nombre del punto", {exact: true}).fill("Ligas terminadas");
  await panel.getByRole("button", {name: "Revisar punto de control", exact: true}).click();
  await expect(panel.getByRole("region", {name: "Vista previa del punto de control"})).toContainText("3 torneos · 2 universos");
  expect(await checkpointRecords(page)).toHaveLength(0);
  await panel.getByRole("button", {name: "Confirmar creación del punto", exact: true}).click();
  await expect(panel.getByText(/guardado y verificado/)).toBeVisible();expect(await sportsStorage(page)).toEqual(before);
  let row = panel.getByRole("article", {name: "Punto: Ligas terminadas", exact: true});
  const download = page.waitForEvent("download");await row.getByRole("button", {name: "Descargar JSON del punto", exact: true}).click();
  const file = await download;const data = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(data.version).toBe(7);expect(data.tournaments).toEqual(tournaments);expect(data.extensions.sportsUniverses).toEqual(universes);expect(data.activity[0].id).toBe("checkpoint-event");
  await layout(page, info, "checkpoint-center");
  await page.reload();panel = await checkpointPanel(page);row = panel.getByRole("article", {name: "Punto: Ligas terminadas", exact: true});
  await expect(row).toContainText("Validación pendiente");await row.getByRole("button", {name: "Verificar integridad", exact: true}).click();await expect(row).toContainText("Disponible");
  await page.evaluate(() => {
    const current = JSON.parse(localStorage.getItem("cancha.tournaments")!);
    current[0].matchdays[0].fixtures[0].result = {homeGoals: 9, awayGoals: 0};
    current.push({...current[0], id: "checkpoint-later", name: "Temporada posterior", season: 2028});
    localStorage.setItem("cancha.tournaments", JSON.stringify(current));
  });
  const later = await sportsStorage(page);const review = row.getByRole("button", {name: "Revisar restauración", exact: true});
  await review.focus();await review.press("Enter");
  let dialog = page.getByRole("dialog", {name: "Restaurar punto de control", exact: true});
  await expect(dialog).toContainText("checkpoint-later");await expect(dialog.getByRole("button", {name: "Cancelar", exact: true})).toBeFocused();
  await dialog.press("Escape");await expect(dialog).not.toBeVisible();expect(await sportsStorage(page)).toEqual(later);await expect(review).toBeFocused();
  await review.click();dialog = page.getByRole("dialog", {name: "Restaurar punto de control", exact: true});
  const safety = page.waitForEvent("download");await dialog.getByRole("button", {name: "Descargar respaldo actual antes de restaurar", exact: true}).click();await safety;
  await dialog.getByRole("button", {name: "Confirmar reemplazo por el punto", exact: true}).click();
  await expect(page.getByRole("button", {name: "Biblioteca", exact: true})).toBeVisible();expect(await saved(page)).toEqual(tournaments);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cancha.sportsUniverses")!))).toEqual(universes);
  const activity = await page.evaluate(() => JSON.parse(localStorage.getItem("cancha.activity")!));
  expect(activity.some((e: {id: string}) => e.id === "checkpoint-event")).toBe(true);expect(activity.at(-1).action).toBe("library-restored");
  panel = await checkpointPanel(page);row = panel.getByRole("article", {name: "Punto: Ligas terminadas", exact: true});
  const stored = (await checkpointRecords(page))[0];await row.getByRole("button", {name: "Editar nombre y descripción", exact: true}).click();
  await panel.getByLabel("Nuevo nombre", {exact: true}).fill("Finales revisadas");await panel.getByRole("button", {name: "Guardar metadatos", exact: true}).click();
  row = panel.getByRole("article", {name: "Punto: Finales revisadas", exact: true});await expect(row).toBeVisible();expect((await checkpointRecords(page))[0].content).toBe(stored.content);
  const restored = await sportsStorage(page);await row.getByRole("button", {name: "Eliminar punto", exact: true}).click();
  await page.getByRole("dialog", {name: "Eliminar punto de control", exact: true}).getByRole("button", {name: "Confirmar eliminación", exact: true}).click();
  await expect(row).toHaveCount(0);expect(await checkpointRecords(page)).toHaveLength(0);expect(await sportsStorage(page)).toEqual(restored);
});

test("puntos de control: simulación conserva contexto y rechaza contenido corrupto", async ({page}, info) => {
  const t: Tournament = {...league(), format: "round-robin", competitionRules: {season: 2026, verification: {standings: "verified", placements: "verified"}}};
  await seed(page, [t]);await page.getByRole("button", {name: "Centro de simulación", exact: true}).click();
  const simulation = page.getByRole("region", {name: "Centro de simulación de temporadas", exact: true});
  await simulation.getByRole("combobox", {name: "Alcance", exact: true}).selectOption("0");await simulation.getByRole("button", {name: "Revisar simulación", exact: true}).click();
  await simulation.getByRole("button", {name: "Crear punto de control antes de simular", exact: true}).click();
  const panel = page.getByRole("region", {name: "Puntos de control manuales", exact: true});
  await expect(panel.getByLabel("Nombre del punto", {exact: true})).toHaveValue(`Antes de simular — ${t.name} 2026`);
  await panel.getByLabel("Nombre del punto", {exact: true}).fill("Antes de la fecha");
  await panel.getByRole("button", {name: "Revisar punto de control", exact: true}).click();await panel.getByRole("button", {name: "Confirmar creación del punto", exact: true}).click();
  await expect(panel.getByText(/guardado y verificado/)).toBeVisible();expect(await saved(page)).toEqual([t]);
  await panel.getByRole("button", {name: "Volver al contexto de origen", exact: true}).click();
  await expect(simulation.getByRole("combobox", {name: "Alcance", exact: true})).toHaveValue("0");
  await simulation.getByRole("button", {name: "Confirmar simulación local", exact: true}).click();await expect(simulation.getByRole("status")).toContainText("Se simularon localmente 2 partidos");
  const original = JSON.parse((await checkpointRecords(page))[0].content);expect(original.tournaments).toEqual([t]);
  await simulation.getByRole("button", {name: "Cerrar simulación", exact: true}).click();const admin = await checkpointPanel(page);
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("cancha.save-checkpoints", 1);open.onerror = () => reject(open.error);
    open.onsuccess = () => {const db = open.result, tx = db.transaction("checkpoints", "readwrite"), store = tx.objectStore("checkpoints");
      const rows = store.getAll();rows.onsuccess = () => store.put({...rows.result[0], content: rows.result[0].content + " "});
      tx.oncomplete = () => {db.close();resolve();};tx.onabort = () => {db.close();reject(tx.error);};};
  }));
  const before = await sportsStorage(page);const row = admin.getByRole("article", {name: "Punto: Antes de la fecha", exact: true});
  await row.getByRole("button", {name: "Verificar integridad", exact: true}).click();await expect(admin.getByRole("alert")).toContainText("SHA-256");await expect(row).toContainText("Inválido");
  await row.getByRole("button", {name: "Revisar restauración", exact: true}).click();await expect(admin.getByRole("alert")).toContainText("SHA-256");expect(await sportsStorage(page)).toEqual(before);
  await expect(page.getByRole("dialog", {name: "Restaurar punto de control", exact: true})).not.toBeVisible();
  await layout(page, info, "checkpoint-invalid");
});

test("puntos de control: pestañas simultáneas y restauración invalidada por edición", async ({page, context}) => {
  await seed(page, [league()]);const first = await checkpointPanel(page);
  const secondPage = await context.newPage();await secondPage.goto("/");const second = await checkpointPanel(secondPage);
  for (const panel of [first, second]) {await panel.getByLabel("Nombre del punto", {exact: true}).fill("Mismo nombre");await panel.getByRole("button", {name: "Revisar punto de control", exact: true}).click();}
  for (const current of [page, secondPage]) await current.evaluate(() => {
    document.documentElement.dataset.checkpointClicks = "0";
    document.documentElement.dataset.checkpointPointer = "";
    document.addEventListener("click", event => {
      const button = event.target instanceof Element ? event.target.closest("button") : null;
      if (button?.textContent?.trim() === "Confirmar creación del punto") document.documentElement.dataset.checkpointClicks = String(Number(document.documentElement.dataset.checkpointClicks) + 1);
    }, true);
    for (const type of ["pointerdown", "pointerup"]) document.addEventListener(type, event => {
      const button = event.target instanceof Element ? event.target.closest("button") : null;
      document.documentElement.dataset.checkpointPointer += `${type}:${button?.textContent?.trim() ?? "outside-button"};`;
    }, true);
  });
  const confirmations = [first, second].map(panel => panel.getByRole("button", {name: "Confirmar creación del punto", exact: true}));
  for (const button of confirmations) {await expect(button).toBeVisible();await expect(button).toBeEnabled();}
  // Independent DOM activations exercise simultaneous native IDB/Web Locks requests without sharing a physical pointer.
  // The administration and simulation journeys above retain physical Playwright clicks in every viewport.
  await Promise.all(confirmations.map(button => button.dispatchEvent("click")));
  const delivery = await Promise.all([page, secondPage].map(current => current.evaluate(() => ({clicks: document.documentElement.dataset.checkpointClicks, pointer: document.documentElement.dataset.checkpointPointer}))));
  await test.info().attach("checkpoint-input-delivery", {body: JSON.stringify(delivery, null, 2), contentType: "application/json"});
  expect(delivery.map(event => event.clicks), "Ambas confirmaciones deben recibir su clic antes de comprobar la persistencia").toEqual(["1", "1"]);
  await expect(first.getByText(/guardado y verificado/)).toBeVisible();await expect(second.getByText(/guardado y verificado/)).toBeVisible();
  const rows = await checkpointRecords(page);expect(rows).toHaveLength(2);expect(rows[0].id).not.toBe(rows[1].id);
  await expect(first.getByRole("article", {name: "Punto: Mismo nombre", exact: true})).toHaveCount(2);
  const chosen = rows[0].id;
  await first.getByRole("article", {name: "Punto: Mismo nombre", exact: true}).filter({hasText: chosen}).getByRole("button", {name: "Revisar restauración", exact: true}).click();
  const dialog = page.getByRole("dialog", {name: "Restaurar punto de control", exact: true});await expect(dialog).toBeVisible();
  const otherRow = second.getByRole("article", {name: "Punto: Mismo nombre", exact: true}).filter({hasText: chosen});
  await otherRow.getByRole("button", {name: "Editar nombre y descripción", exact: true}).click();await second.getByLabel("Nuevo nombre", {exact: true}).fill("Cambio desde otra pestaña");
  await second.getByRole("button", {name: "Guardar metadatos", exact: true}).click();await expect(second.getByRole("article", {name: "Punto: Cambio desde otra pestaña", exact: true})).toBeVisible();
  const before = await sportsStorage(page);await dialog.getByRole("button", {name: "Confirmar reemplazo por el punto", exact: true}).click();
  await expect(first.getByRole("alert")).toContainText("El punto cambió");expect(await sportsStorage(page)).toEqual(before);await secondPage.close();
});

async function readyEditor(page: Page) {
  await expect(page.locator("main")).toHaveAttribute("aria-busy", "false");
  await expect(game(page)).toBeVisible();
  return game(page);
}

test("coordinación entre pestañas: dos ediciones simultáneas conservan una sola confirmación", async ({page, context}) => {
  await seed(page, [league()]);const first = await readyEditor(page);
  const other = await context.newPage();await other.goto("/");const second = await readyEditor(other);
  await first.getByRole("spinbutton").nth(0).fill("2");await first.getByRole("spinbutton").nth(1).fill("1");
  await second.getByRole("spinbutton").nth(0).fill("7");await second.getByRole("spinbutton").nth(1).fill("0");
  const saves = [first, second].map(editor => editor.getByRole("button", {name: "Guardar", exact: true}));
  for (const save of saves) {await expect(save).toBeVisible();await expect(save).toBeEnabled();}
  await Promise.all(saves.map(save => save.dispatchEvent("click")));
  await expect.poll(async () => (await saved(page))[0].matchdays[0].fixtures[0].result?.homeGoals).toBeDefined();
  const result = (await saved(page))[0].matchdays[0].fixtures[0].result!;
  expect([2, 7]).toContain(result.homeGoals);
  const loser = result.homeGoals === 2 ? other : page, draft = result.homeGoals === 2 ? "7" : "2";
  await expect(loser.getByRole("alert", {name: "Cambios externos en la biblioteca", exact: true})).toBeVisible();
  await expect(game(loser).getByRole("spinbutton").nth(0)).toHaveValue(draft);
  const events = await page.evaluate(() => JSON.parse(localStorage.getItem("cancha.activity") ?? "[]") as {action: string}[]);
  expect(events.filter(event => event.action === "match-result-updated")).toHaveLength(1);
  await other.close();
});

test("coordinación entre pestañas: simulación invalida un borrador y actualizar conserva los resultados", async ({page, context}, info) => {
  await seed(page, [league()]);await readyEditor(page);
  const other = await context.newPage();await other.goto("/");const editor = await readyEditor(other);
  await editor.getByRole("spinbutton").nth(0).fill("9");await editor.getByRole("spinbutton").nth(1).fill("8");
  await page.getByRole("button", {name: "Simular fecha", exact: true}).first().click();
  await expect.poll(async () => (await saved(page))[0].matchdays[0].fixtures.filter(f => f.result).length).toBe(2);
  const simulated = await sportsStorage(page);
  await expect(other.getByRole("alert", {name: "Cambios externos en la biblioteca", exact: true})).toBeVisible();
  await expect(editor.getByRole("spinbutton").nth(0)).toHaveValue("9");
  await editor.getByRole("button", {name: "Guardar", exact: true}).click();
  await expect(other.getByRole("status").filter({hasText: "Actualiza la vista"})).toBeVisible();
  expect(await sportsStorage(other)).toEqual(simulated);
  await other.getByRole("button", {name: "Actualizar biblioteca conservando borradores", exact: true}).click();
  await expect(editor.getByRole("spinbutton").nth(0)).toHaveValue("9");expect(await sportsStorage(other)).toEqual(simulated);
  await layout(other, info, "external-change-draft-retained");
  await library(other);
  await other.getByRole("listitem", {name: "Liga de navegador", exact: true}).getByRole("button", {name: "Volver al torneo activo", exact: true}).click();
  const current = (await saved(other))[0].matchdays[0].fixtures[0].result!;
  await expect(game(other).getByRole("spinbutton").nth(0)).toHaveValue(String(current.homeGoals));
  expect(await sportsStorage(other)).toEqual(simulated);await other.close();
});

test("coordinación entre pestañas: restaurar un punto invalida la edición pendiente", async ({page, context}) => {
  await seed(page, [league()]);await readyEditor(page);
  const panel = await checkpointPanel(page);
  await panel.getByLabel("Nombre del punto", {exact: true}).fill("Antes de editar en otra pestaña");
  await panel.getByRole("button", {name: "Revisar punto de control", exact: true}).click();
  await panel.getByRole("button", {name: "Confirmar creación del punto", exact: true}).click();
  await expect(panel.getByText(/guardado y verificado/)).toBeVisible();
  const other = await context.newPage();await other.goto("/");const editor = await readyEditor(other);
  await editor.getByRole("spinbutton").nth(0).fill("6");await editor.getByRole("spinbutton").nth(1).fill("5");
  await panel.getByRole("article", {name: "Punto: Antes de editar en otra pestaña", exact: true}).getByRole("button", {name: "Revisar restauración", exact: true}).click();
  await page.getByRole("dialog", {name: "Restaurar punto de control", exact: true}).getByRole("button", {name: "Confirmar reemplazo por el punto", exact: true}).click();
  await expect(page.getByRole("button", {name: "Biblioteca", exact: true})).toBeVisible();
  const restored = await sportsStorage(page);expect((await checkpointRecords(page))).toHaveLength(1);
  await expect(other.getByRole("alert", {name: "Cambios externos en la biblioteca", exact: true})).toBeVisible();
  await expect(editor.getByRole("spinbutton").nth(0)).toHaveValue("6");
  await editor.getByRole("button", {name: "Guardar", exact: true}).click();
  await expect(other.getByRole("status").filter({hasText: "Actualiza la vista"})).toBeVisible();
  expect(await sportsStorage(other)).toEqual(restored);await other.close();
});

async function closureCenter(page: Page) {
  await page.getByRole("button",{name:"Centro de cierre",exact:true}).click();
  const center=page.getByRole("region",{name:"Centro de cierre de temporadas",exact:true});await expect(center).toBeVisible();return center;
}
test("cierre deportivo: revisión, confirmación, planificación y modificación posterior",async({page},info)=>{
  const t=closureLeague();await seed(page,[t]);await readyEditor(page);
  const before=await sportsStorage(page), center=await closureCenter(page);
  await expect(center.getByRole("status")).toContainText("Lista para revisión final");
  await center.getByRole("button",{name:"Revisar cierre deportivo",exact:true}).click();
  await expect(center.getByLabel("Vista previa del cierre deportivo",{exact:true})).toBeVisible();expect(await sportsStorage(page)).toEqual(before);
  await layout(page,info,"season-closure-preview");
  await center.getByRole("button",{name:"Confirmar cierre deportivo",exact:true}).click();
  await expect(center.getByRole("status").filter({hasText:"Estado:"})).toContainText("Cierre confirmado");
  expect(await saved(page)).toEqual([t]);
  const activity=await page.evaluate(()=>JSON.parse(localStorage.getItem("cancha.activity") ?? "[]") as {action:string}[]);
  expect(activity.filter(e=>e.action==="season-closure-confirmed")).toHaveLength(1);
  await center.getByRole("button",{name:"Preparar siguiente edición en planificación",exact:true}).click();
  await expect(page.getByRole("region",{name:"Centro de planificación de temporadas",exact:true})).toBeVisible();expect(await saved(page)).toEqual([t]);
  const reopened=await closureCenter(page);await reopened.getByRole("button",{name:"Abrir edición de temporada",exact:true}).click();
  const editor=await readyEditor(page);await editor.getByRole("spinbutton").nth(0).fill("8");await editor.getByRole("spinbutton").nth(1).fill("1");
  await editor.getByRole("button",{name:"Guardar",exact:true}).click();
  await expect.poll(async()=>(await saved(page))[0].matchdays[0].fixtures[0].result?.homeGoals).toBe(8);
  const stale=await closureCenter(page);await expect(stale.getByRole("status").filter({hasText:"Estado:"})).toContainText("Cierre desactualizado");
  await expect(stale.getByText("Historial de confirmaciones (1)",{exact:true})).toBeVisible();
});
test("cierre deportivo: dos pestañas no duplican una confirmación revisada",async({page,context})=>{
  const t=closureLeague();await seed(page,[t]);await readyEditor(page);const first=await closureCenter(page);
  const other=await context.newPage();await other.goto("/");await readyEditor(other);const second=await closureCenter(other);
  for(const center of [first,second])await center.getByRole("button",{name:"Revisar cierre deportivo",exact:true}).click();
  await first.getByRole("button",{name:"Confirmar cierre deportivo",exact:true}).click();
  await expect(first.getByRole("status").filter({hasText:"Estado:"})).toContainText("Cierre confirmado");
  const confirmed=await sportsStorage(page);
  await second.getByRole("button",{name:"Confirmar cierre deportivo",exact:true}).click();
  await expect(second.getByRole("status").filter({hasText:"La biblioteca cambió"})).toBeVisible();
  expect(await sportsStorage(other)).toEqual(confirmed);expect(await saved(other)).toEqual([t]);
  const events=await other.evaluate(()=>JSON.parse(localStorage.getItem("cancha.activity") ?? "[]") as {action:string}[]);
  expect(events.filter(e=>e.action==="season-closure-confirmed")).toHaveLength(1);await other.close();
});
test("cierre deportivo: copa finalizada reutiliza campeón y subcampeón",async({page})=>{
  const t=closureCup();await seed(page,[t]);await readyEditor(page);const center=await closureCenter(page), before=await sportsStorage(page);
  await expect(center.getByText(`Campeón: ${t.teams[0].name}`,{exact:true})).toBeVisible();
  await expect(center.getByText(`Subcampeón: ${t.teams[2].name}`,{exact:true})).toBeVisible();
  await center.getByRole("button",{name:"Revisar cierre deportivo",exact:true}).click();expect(await sportsStorage(page)).toEqual(before);
  await center.getByRole("button",{name:"Confirmar cierre deportivo",exact:true}).click();
  await expect(center.getByRole("status").filter({hasText:"Estado:"})).toContainText("Cierre confirmado");expect(await saved(page)).toEqual([t]);
});
test("cierre deportivo: final pendiente bloquea y enlaza al calendario sin escribir",async({page})=>{
  const cup=closureCup(), t={...cup,matchdays:cup.matchdays.map((day,index)=>index?{...day,fixtures:day.fixtures.map(f=>({...f,result:undefined}))}:day)};
  await seed(page,[t]);await readyEditor(page);let center=await closureCenter(page);const before=await sportsStorage(page);
  await expect(center.getByRole("button",{name:"Revisar cierre deportivo",exact:true})).toBeDisabled();
  await center.getByRole("button",{name:"Revisar partidos y calendario",exact:true}).click();
  const calendar=page.getByRole("region",{name:`Calendario de ${t.name}`,exact:true});await expect(calendar).toBeVisible();
  await calendar.getByRole("button",{name:"Revisar cierre de temporada",exact:true}).click();center=page.getByRole("region",{name:"Centro de cierre de temporadas",exact:true});
  await expect(center.getByRole("button",{name:"Revisar cierre deportivo",exact:true})).toBeDisabled();expect(await sportsStorage(page)).toEqual(before);
  await center.getByRole("button",{name:"Volver al contexto anterior",exact:true}).click();
  await expect(page.getByRole("button",{name:"Centro de cierre",exact:true})).toBeFocused();
});

async function historicalArchive(page:Page) {
  await page.locator("#open-historical-archive").click();
  const archive=page.getByRole("region",{name:"Archivo histórico del universo",exact:true});await expect(archive).toBeVisible();return archive;
}
test("archivo histórico: anuarios, filtros combinados y navegación conservan los datos",async({page},info)=>{
  const current={...closureLeague("archive-main"),competitionId:"anfp-liga-primera",name:"Liga del anuario"};
  const previous={...current,id:"archive-previous",season:2025,competitionRules:{...current.competitionRules!,season:2025}};
  const cup={...closureCup(),competitionId:"afa-copa-argentina",name:"Copa del anuario"};
  const undated={...closureLeague("archive-undated"),name:"Edición sin año",season:undefined,matchdays:[]};
  await seed(page,[current,previous,cup,undated]);await readyEditor(page);const before=await sportsStorage(page),archive=await historicalArchive(page);
  for(const year of ["2026","2025","Sin año registrado"])await expect(archive.getByRole("region",{name:`Anuario ${year}`,exact:true})).toBeVisible();
  await archive.getByRole("combobox",{name:"País",exact:true}).selectOption("Chile");
  await archive.getByRole("searchbox",{name:"Buscar clubes y competiciones",exact:true}).fill("ALFA");
  await archive.getByRole("combobox",{name:"Año del archivo",exact:true}).selectOption("2025");
  await expect(archive.getByRole("article",{name:`Ficha histórica de ${current.name}`,exact:true})).toHaveCount(1);
  await expect(archive.getByRole("article",{name:`Ficha histórica de ${cup.name}`,exact:true})).toHaveCount(0);
  expect(await sportsStorage(page)).toEqual(before);
  await archive.getByRole("button",{name:"Limpiar filtros históricos",exact:true}).click();
  await archive.getByRole("heading",{name:"Archivo histórico",exact:true}).scrollIntoViewIfNeeded();await layout(page,info,"historical-archive");
  const card=archive.getByRole("region",{name:"Anuario 2026",exact:true}).getByRole("article",{name:`Ficha histórica de ${current.name}`,exact:true});
  await card.getByText(`Clasificación, fases y decisiones de ${current.name}`,{exact:true}).click();
  await expect(card.getByRole("table")).toBeVisible();expect(await sportsStorage(page)).toEqual(before);
  await card.getByRole("button",{name:"Calendario",exact:true}).click();await expect(page.getByRole("region",{name:`Calendario de ${current.name}`,exact:true})).toBeVisible();
  expect(await sportsStorage(page)).toEqual(before);
  const reopened=await historicalArchive(page);await reopened.getByRole("button",{name:"Volver al contexto anterior",exact:true}).click();
  await expect(page.locator("#open-historical-archive")).toBeFocused();
});
test("archivo histórico: cambios externos actualizan cierres y cambiar universo descarta filtros",async({page,context})=>{
  const current={...closureLeague("archive-closed"),name:"Liga histórica visible"},hidden={...closureLeague("archive-hidden"),name:"Liga del universo rival"};
  const memory=closureMemory([current]);confirmSeasonClosure(reviewSeasonClosure(current.id,"u1",memory.repository),"u1",memory.repository,true);
  const universes:SportsUniverseLibrary={version:1,activeUniverseId:"u1",universes:[{id:"u1",name:"Partida histórica"},{id:"u2",name:"Partida rival"}],assignments:{[current.id]:"u1",[hidden.id]:"u2"}};
  await seed(page,[current,hidden],memory.state.activity,universes);await readyEditor(page);let archive=await historicalArchive(page);
  const before=await sportsStorage(page);await expect(archive.getByText("Campeón con cierre vigente",{exact:true})).toHaveCount(2);
  await expect(archive.getByText(hidden.name,{exact:true})).toHaveCount(0);expect(await sportsStorage(page)).toEqual(before);
  await archive.getByRole("searchbox",{name:"Buscar clubes y competiciones",exact:true}).fill("Alfa");
  const other=await context.newPage();await other.goto("/");const editor=await readyEditor(other);
  await editor.getByRole("spinbutton").nth(0).fill("8");await editor.getByRole("spinbutton").nth(1).fill("1");await editor.getByRole("button",{name:"Guardar",exact:true}).click();
  await expect.poll(async()=>(await saved(other)).find(t=>t.id===current.id)!.matchdays[0].fixtures[0].result?.homeGoals).toBe(8);
  await expect(archive.getByText("Cierre desactualizado",{exact:true})).toHaveCount(2);
  const after=await sportsStorage(other);expect(await sportsStorage(page)).toEqual(after);
  await other.close();
  // Opening the saved source explicitly acknowledges the changed library before the next write command.
  await archive.getByRole("article",{name:`Ficha histórica de ${current.name}`,exact:true}).getByRole("button",{name:"Abrir temporada original",exact:true}).click();
  await readyEditor(page);await page.getByRole("button",{name:"Biblioteca",exact:true}).click();
  await page.getByRole("combobox",{name:"Universo activo",exact:true}).selectOption("u2");
  await expect.poll(async()=>page.evaluate(()=>JSON.parse(localStorage.getItem("cancha.sportsUniverses")!).activeUniverseId)).toBe("u2");
  archive=await historicalArchive(page);await expect(archive.getByRole("searchbox")).toHaveValue("");
  await expect(archive.getByRole("article",{name:`Ficha histórica de ${hidden.name}`,exact:true})).toBeVisible();
  await expect(archive.getByRole("article",{name:`Ficha histórica de ${current.name}`,exact:true})).toHaveCount(0);
  expect((await saved(page)).find(t=>t.id===hidden.id)).toEqual(hidden);
});

async function drawCenter(page:Page){await expect(page.locator("main")).toHaveAttribute("aria-busy","false");await page.locator("#open-draw-center").click();const center=page.getByRole("region",{name:"Centro de sorteos y cruces",exact:true});await expect(center).toBeVisible();return center;}

async function associationsManager(page:Page){
  await page.getByRole("button",{name:"Asociaciones y afiliaciones",exact:true}).first().click();
  const manager=page.getByRole("region",{name:"Administración de asociaciones y afiliaciones",exact:true});await expect(manager).toBeVisible();return manager;
}
test("afiliaciones: registra asociación y aparición documental con revisión e historial",async({page},info)=>{
  const s=generatorScenario();await seed(page,[s.t],s.state.activity);const manager=await associationsManager(page),before=await sportsStorage(page);
  await manager.getByRole("button",{name:"Registrar asociación",exact:true}).click();await manager.getByRole("textbox",{name:"Nombre de la asociación",exact:true}).fill("Asociación ficticia de navegador");await manager.getByRole("combobox",{name:"Procedencia de la asociación",exact:true}).selectOption("documented");
  await manager.getByRole("textbox",{name:"URL HTTPS de la asociación",exact:true}).fill("https://example.org/fictitious-association");await manager.getByRole("textbox",{name:"Referencia de la asociación",exact:true}).fill("Fixture documental ficticio");await manager.getByRole("combobox",{name:"Estado documental de la asociación",exact:true}).selectOption("verified");await manager.getByRole("checkbox",{name:/Contrasté los documentos/}).check();
  await manager.getByRole("button",{name:"Revisar registro de asociación o afiliación",exact:true}).click();expect(await sportsStorage(page)).toEqual(before);await layout(page,info,"association-review");await manager.getByRole("button",{name:"Confirmar registro de asociación o afiliación",exact:true}).focus();await page.keyboard.press("Enter");await expect(manager.getByText(/Registro confirmado\. Se conservaron/)).toBeVisible();
  const associationId=await page.evaluate(()=>JSON.parse(localStorage.getItem("cancha.activity")!).find((e:{action:string})=>e.action==="association-recorded").after.association.id);
  await manager.getByRole("button",{name:"Registrar o revisar afiliación de temporada",exact:true}).click();await manager.getByRole("combobox",{name:"Asociación del participante",exact:true}).selectOption(associationId);await manager.getByRole("combobox",{name:"Procedencia de la afiliación",exact:true}).selectOption("documented");await manager.getByRole("textbox",{name:"URL HTTPS de la afiliación",exact:true}).fill("https://example.org/fictitious-affiliation");await manager.getByRole("textbox",{name:"Referencia de la afiliación",exact:true}).fill("Afiliación ficticia de esta temporada");await manager.getByRole("combobox",{name:"Estado documental de la afiliación",exact:true}).selectOption("verified");await manager.getByRole("checkbox",{name:/Contrasté los documentos/}).check();
  const afterAssociation=await sportsStorage(page);await manager.getByRole("button",{name:"Revisar registro de asociación o afiliación",exact:true}).click();expect(await sportsStorage(page)).toEqual(afterAssociation);await manager.getByRole("button",{name:"Confirmar registro de asociación o afiliación",exact:true}).click();await expect(manager.getByText(/Registro confirmado\. Se conservaron/)).toBeVisible();
  const summary=manager.getByRole("region",{name:"Afiliación de Participante 1 en 2026",exact:true});await expect(summary).toContainText("Verificada por el usuario");await summary.getByText("Historial de afiliaciones de esta aparición (1)",{exact:true}).click();await expect(summary).toContainText("Afiliación ficticia de esta temporada");expect((await saved(page))[0]).toEqual(s.t);
});

test("afiliaciones: restricción explícita rechaza grupos manuales y permite generación compatible",async({page},info)=>{
  const s=clubAssociationScenario(false);await seed(page,[s.t],s.state.activity);const center=await drawCenter(page),editor=center.getByRole("region",{name:"Bombos y restricciones",exact:true});
  await editor.getByRole("button",{name:"Revisar configuración de bombos",exact:true}).click();await editor.getByRole("button",{name:"Añadir máximo por asociación",exact:true}).click();await editor.getByRole("button",{name:"Revisar bombos y restricciones",exact:true}).click();await editor.getByRole("button",{name:"Confirmar bombos y restricciones",exact:true}).click();await expect(editor.getByText(/Configuración registrada\. Se conservaron/)).toBeVisible();
  await center.getByRole("button",{name:"Revisar Grupos registrados",exact:true}).click();const before=await sportsStorage(page);await center.getByRole("button",{name:"Revisar distribución y cruces",exact:true}).click();await expect(center.getByRole("status").filter({hasText:"máximo de participantes por asociación"})).toBeVisible();expect(await sportsStorage(page)).toEqual(before);
  const generator=center.getByRole("region",{name:"Generación local de grupos",exact:true});await generator.getByRole("button",{name:"Generar distribución local",exact:true}).click();await generator.getByRole("button",{name:"Revisar distribución",exact:true}).click();expect(await sportsStorage(page)).toEqual(before);await layout(page,info,"association-draw-review");await center.getByRole("button",{name:"Confirmar distribución y cruces",exact:true}).click();await expect(center.getByRole("status").filter({hasText:"Distribución confirmada."})).toBeVisible();
  const record=await page.evaluate(()=>JSON.parse(localStorage.getItem("cancha.activity")!).find((e:{action:string})=>e.action==="stage-draw-confirmed").after);expect(record.associationFoundation).toBeTruthy();expect(record.configurationRevision).toBe(2);for(const group of record.groups){expect(group.teamIds.filter((id:string)=>s.ids.slice(0,2).includes(id))).toHaveLength(1);}expect((await saved(page))[0].matchdays).toEqual([]);
  const archive=await historicalArchive(page);await archive.getByText(`Asociaciones registradas de ${s.t.name}`,{exact:true}).click();await expect(archive.getByText(/Asociación ficticia A: 2 inscritos.*0 con encuentros.*0 con partidos disputados/)).toBeVisible();
});

test("afiliaciones: dos pestañas conservan una sola corrección y rechazan revisión obsoleta",async({page,context})=>{
  const s=clubAssociationScenario(false);await seed(page,[s.t],s.state.activity);const first=await associationsManager(page),other=await context.newPage();await other.goto("/");const second=await associationsManager(other);
  for(const manager of [first,second]){await manager.getByRole("button",{name:"Registrar o revisar afiliación de temporada",exact:true}).click();await manager.getByRole("combobox",{name:"Estado de la relación",exact:true}).selectOption("unknown");await manager.getByRole("combobox",{name:"Procedencia de la afiliación",exact:true}).selectOption("local");await manager.getByRole("button",{name:"Revisar registro de asociación o afiliación",exact:true}).click();}
  await first.getByRole("button",{name:"Confirmar registro de asociación o afiliación",exact:true}).click();await expect(first.getByText(/Registro confirmado\. Se conservaron/)).toBeVisible();const after=await sportsStorage(page);
  await second.getByRole("button",{name:"Confirmar registro de asociación o afiliación",exact:true}).click();await expect(second.getByRole("status").filter({hasText:"La biblioteca cambió"})).toBeVisible();expect(await sportsStorage(other)).toEqual(after);expect((await saved(page))[0]).toEqual(s.t);await other.close();
});

test("afiliaciones: cambiar universo no comparte asociaciones ni clubes homónimos",async({page})=>{
  const s=clubAssociationScenario(false),other={...s.t,id:"homonym-other-universe",name:"Homónimos de otra partida"};
  for(const event of s.state.activity){const after=event.after as {universeId?:string;foundation?:string};if(after.universeId===null){after.universeId="u1";if(after.foundation)after.foundation=drawFoundation(s.t,"u1",[s.t,other],s.state.activity);}}
  const universe:SportsUniverseLibrary={version:1,activeUniverseId:"u1",universes:[{id:"u1",name:"Partida con asociaciones"},{id:"u2",name:"Partida independiente"}],assignments:{[s.t.id]:"u1",[other.id]:"u2"}};
  await seed(page,[s.t,other],s.state.activity,universe);let manager=await associationsManager(page);await expect(manager.getByRole("heading",{name:"Asociación ficticia A",exact:true})).toBeVisible();const before=await sportsStorage(page);await expect(manager.getByRole("region",{name:"Afiliación de Participante 1 en 2026",exact:true})).toContainText("Verificada por el usuario");expect(await sportsStorage(page)).toEqual(before);
  await library(page);await page.getByRole("combobox",{name:"Universo activo",exact:true}).selectOption("u2");manager=await associationsManager(page);const changed=await sportsStorage(page);await expect(manager.getByText(/Sin asociaciones registradas/)).toBeVisible();await expect(manager.getByRole("region",{name:"Afiliación de Participante 1 en 2026",exact:true})).toContainText("Desconocida");expect(await sportsStorage(page)).toEqual(changed);expect((await saved(page)).find(t=>t.id===other.id)).toEqual(other);
});

test("afiliaciones: exportación y restauración v7 conservan catálogo, revisiones y referencias",async({page})=>{
  const s=clubAssociationScenario();await seed(page,[s.t],s.state.activity);await library(page);await page.getByRole("button",{name:"Centro de guardado y recuperación",exact:true}).click();const center=page.getByRole("region",{name:"Centro de guardado y recuperación",exact:true}),downloadEvent=page.waitForEvent("download");await center.getByRole("button",{name:"Descargar respaldo completo",exact:true}).click();const download=await downloadEvent,bytes=await readFile((await download.path())!),archive=JSON.parse(bytes.toString());expect(archive.version).toBe(7);expect(archive.activity.filter((e:{action:string})=>e.action==="association-recorded")).toHaveLength(2);
  await center.getByRole("button",{name:"Restaurar respaldo",exact:true}).click();await page.getByLabel("Archivo JSON de respaldo").setInputFiles({name:"synthetic-affiliations.json",mimeType:"application/json",buffer:bytes});await page.getByRole("dialog",{name:"Restaurar respaldo",exact:true}).getByRole("button",{name:"Reemplazar biblioteca",exact:true}).click();await page.reload();const manager=await associationsManager(page),before=await sportsStorage(page);await expect(manager.getByRole("region",{name:"Afiliación de Participante 1 en 2026",exact:true})).toContainText("Verificada por el usuario");await expect(manager.getByRole("heading",{name:"Asociación ficticia B",exact:true})).toBeVisible();expect(await sportsStorage(page)).toEqual(before);expect((await saved(page))[0]).toEqual(s.t);
});

test("generador local: configura bombos, comprueba, genera otra propuesta y confirma antes del calendario",async({page},info)=>{
  const t=drawGroups(),historical=closureLeague("generator-history");await seed(page,[t,historical]);const center=await drawCenter(page),editor=center.getByRole("region",{name:"Bombos y restricciones",exact:true});
  await editor.getByRole("button",{name:"Configurar bombos y restricciones",exact:true}).click();await editor.getByRole("button",{name:"Crear bombo",exact:true}).click();await editor.getByRole("spinbutton",{name:"Capacidad de Bombo 1",exact:true}).fill("4");
  for(const team of t.teams)await editor.getByRole("combobox",{name:`Bombo de ${team.name}`,exact:true}).selectOption({label:"Bombo 1"});
  await editor.getByRole("button",{name:"Añadir Cuota por bombo",exact:true}).click();await editor.getByRole("spinbutton",{name:"Participantes por grupo",exact:true}).fill("2");
  await editor.getByRole("button",{name:"Revisar bombos y restricciones",exact:true}).click();await editor.getByRole("button",{name:"Confirmar bombos y restricciones",exact:true}).click();await expect(editor.getByText(/Configuración registrada\. Se conservaron/)).toBeVisible();
  await center.getByRole("button",{name:"Revisar Grupos registrados",exact:true}).click();const generator=center.getByRole("region",{name:"Generación local de grupos",exact:true}),before=await sportsStorage(page);
  await expect(generator.getByText(/Viabilidad:/)).toHaveCount(0);await generator.getByRole("button",{name:"Comprobar viabilidad",exact:true}).click();await expect(generator.getByText("Viabilidad: Viable",{exact:true})).toBeVisible();expect(await sportsStorage(page)).toEqual(before);
  await generator.getByRole("textbox",{name:"Semilla de generación local",exact:true}).fill("e2e-explicit-seed");await generator.getByRole("button",{name:"Generar distribución local",exact:true}).click();await expect(generator.getByRole("region",{name:"Propuesta local de grupos",exact:true})).toBeVisible();
  await generator.getByRole("button",{name:"Generar otra propuesta",exact:true}).click();await expect(generator.getByRole("button",{name:"Revisar distribución",exact:true})).toBeEnabled();expect(await sportsStorage(page)).toEqual(before);
  await generator.getByRole("button",{name:"Revisar distribución",exact:true}).focus();await page.keyboard.press("Enter");await expect(center.getByRole("region",{name:"Vista previa de distribución",exact:true})).toBeVisible();await expect(generator.getByRole("button",{name:"Generar otra propuesta",exact:true})).toBeDisabled();expect(await sportsStorage(page)).toEqual(before);await layout(page,info,"constraint-generator-preview");
  await center.getByRole("button",{name:"Confirmar distribución y cruces",exact:true}).click();await expect(center.getByRole("status").filter({hasText:"Distribución confirmada."})).toBeVisible();
  expect((await saved(page)).find(s=>s.id===t.id)!.matchdays).toEqual([]);expect((await saved(page)).find(s=>s.id===historical.id)).toEqual(historical);
  const record=await page.evaluate(()=>JSON.parse(localStorage.getItem("cancha.activity")!).find((e:{action:string})=>e.action==="stage-draw-confirmed").after);expect(record.mode).toBe("generated");expect(record.generation.method).toBe("constraint-groups-v1");expect(record.configurationRevision).toBe(1);
  await center.getByRole("button",{name:"Revisar creación de encuentros",exact:true}).click();await center.getByRole("button",{name:"Confirmar creación de encuentros",exact:true}).click();await expect(center.getByRole("status").filter({hasText:"Encuentros creados."})).toBeVisible();
  expect((await saved(page)).find(s=>s.id===t.id)!.matchdays.flatMap(d=>d.fixtures).every(f=>!f.result)).toBe(true);await center.getByRole("button",{name:"Abrir calendario",exact:true}).click();await expect(page.getByRole("region",{name:`Calendario de ${t.name}`,exact:true})).toBeVisible();
});

test("generador local: demuestra imposibilidad sin escribir ni habilitar confirmación",async({page})=>{
  const s=generatorScenario();s.configuration.restrictions=[[0,1],[1,2],[2,0]].map((pair,i)=>({id:`pair-${i}`,type:"incompatible",teamIds:pair.map(j=>s.ids[j])}));await seed(page,[s.t],s.state.activity);
  const center=await drawCenter(page);await center.getByRole("button",{name:"Revisar Grupos registrados",exact:true}).click();const generator=center.getByRole("region",{name:"Generación local de grupos",exact:true}),before=await sportsStorage(page);
  await generator.getByRole("button",{name:"Comprobar viabilidad",exact:true}).click();await expect(generator.getByText("Viabilidad: Imposible",{exact:true})).toBeVisible();await generator.getByRole("button",{name:"Generar distribución local",exact:true}).click();await expect(generator.getByText("Viabilidad: Imposible",{exact:true})).toBeVisible();await expect(generator.getByRole("region",{name:"Propuesta local de grupos",exact:true})).toHaveCount(0);expect(await sportsStorage(page)).toEqual(before);
});

test("generador local: dos pestañas rechazan la confirmación obsoleta",async({page,context})=>{
  const s=generatorScenario();await seed(page,[s.t],s.state.activity);const first=await drawCenter(page),other=await context.newPage();await other.goto("/");const second=await drawCenter(other);
  for(const center of [first,second]){await center.getByRole("button",{name:"Revisar Grupos registrados",exact:true}).click();const generator=center.getByRole("region",{name:"Generación local de grupos",exact:true});await generator.getByRole("button",{name:"Generar distribución local",exact:true}).click();await generator.getByRole("button",{name:"Revisar distribución",exact:true}).click();}
  await first.getByRole("button",{name:"Confirmar distribución y cruces",exact:true}).click();await expect(first.getByRole("status").filter({hasText:"Distribución confirmada."})).toBeVisible();const after=await sportsStorage(page);
  await second.getByRole("button",{name:"Confirmar distribución y cruces",exact:true}).click();await expect(second.getByRole("status").filter({hasText:"La biblioteca cambió"})).toBeVisible();expect(await sportsStorage(other)).toEqual(after);await other.close();
});

test("generador local: cambiar universo invalida la revisión y no comparte bombos",async({page,context})=>{
  const s=generatorScenario(),otherSeason={...drawGroups(),id:"other-generator-universe",name:"Grupos del otro universo"};
  const universes:SportsUniverseLibrary={version:1,activeUniverseId:"u1",universes:[{id:"u1",name:"Generación local"},{id:"u2",name:"Universo sin configuración"}],assignments:{[s.t.id]:"u1",[otherSeason.id]:"u2"}};
  s.configuration.universeId="u1";s.configuration.foundation=drawFoundation(s.t,"u1",[s.t,otherSeason],s.state.activity);
  await seed(page,[s.t,otherSeason],s.state.activity,universes);const center=await drawCenter(page);await center.getByRole("button",{name:"Revisar Grupos registrados",exact:true}).click();const generator=center.getByRole("region",{name:"Generación local de grupos",exact:true});await generator.getByRole("button",{name:"Generar distribución local",exact:true}).click();await generator.getByRole("button",{name:"Revisar distribución",exact:true}).click();
  const other=await context.newPage();await other.goto("/");await other.getByRole("button",{name:"Biblioteca",exact:true}).click();await other.getByRole("combobox",{name:"Universo activo",exact:true}).selectOption("u2");await expect(center.getByRole("button",{name:"Confirmar distribución y cruces",exact:true})).toHaveCount(0);
  const second=await drawCenter(other);await expect(second.getByRole("option",{name:/Grupos del otro universo/})).toHaveCount(1);await second.getByRole("button",{name:"Revisar Grupos registrados",exact:true}).click();await expect(second.getByRole("button",{name:"Generar distribución local",exact:true})).toBeDisabled();expect((await saved(page)).find(t=>t.id===otherSeason.id)).toEqual(otherSeason);await other.close();
});

test("bombos y restricciones: revisión accesible, rechazo incompatible y confirmación sin partidos",async({page},info)=>{
  const t=drawGroups();await seed(page,[t]);const center=await drawCenter(page),editor=center.getByRole("region",{name:"Bombos y restricciones",exact:true});
  await editor.getByRole("button",{name:"Configurar bombos y restricciones",exact:true}).click();
  await editor.getByRole("button",{name:"Crear bombo",exact:true}).click();
  for(const team of t.teams)await editor.getByRole("combobox",{name:`Bombo de ${team.name}`,exact:true}).selectOption({label:"Bombo 1"});
  const before=await sportsStorage(page);
  await editor.getByRole("button",{name:"Revisar bombos y restricciones",exact:true}).click();
  await expect(editor.getByRole("region",{name:"Vista previa de bombos",exact:true})).toHaveCount(0);expect(await sportsStorage(page)).toEqual(before);
  await editor.getByRole("spinbutton",{name:"Capacidad de Bombo 1",exact:true}).fill("4");
  await editor.getByRole("button",{name:"Revisar bombos y restricciones",exact:true}).click();
  await expect(editor.getByRole("region",{name:"Vista previa de bombos",exact:true})).toBeVisible();expect(await sportsStorage(page)).toEqual(before);
  await layout(page,info,"draw-pots-preview");
  await editor.getByRole("button",{name:"Confirmar bombos y restricciones",exact:true}).click();
  await expect(editor.getByText(/Configuración registrada\. Se conservaron/)).toBeVisible();
  expect((await saved(page))[0]).toEqual(t);await expect(center.getByRole("button",{name:"Sorteo aleatorio no disponible",exact:true})).toBeDisabled();
});

test("bombos y restricciones: dos pestañas rechazan revisiones obsoletas",async({page,context})=>{
  const t=drawGroups();await seed(page,[t]);const other=await context.newPage();await other.goto("/");
  for(const tab of [page,other]){const center=await drawCenter(tab),editor=center.getByRole("region",{name:"Bombos y restricciones",exact:true});await editor.getByRole("button",{name:"Configurar bombos y restricciones",exact:true}).click();await editor.getByRole("button",{name:"Revisar bombos y restricciones",exact:true}).click();}
  await page.getByRole("button",{name:"Confirmar bombos y restricciones",exact:true}).click();await expect(page.getByText(/Configuración registrada\. Se conservaron/)).toBeVisible();
  await other.getByRole("button",{name:"Confirmar bombos y restricciones",exact:true}).click();await expect(other.getByText(/obsoleta|cambió|cambiado/i).first()).toBeVisible();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("cancha.activity")!).filter((e:{action:string})=>e.action==="draw-configuration-recorded").length)).toBe(1);await other.close();
});
async function manualPairs(center:ReturnType<Page["getByRole"]>,t:Tournament){
  await center.getByRole("button",{name:"Revisar Semifinal",exact:true}).click();
  for(const [label,id] of [["Local o local de ida · Cruce 1",t.teams[0].id],["Visitante o local de vuelta · Cruce 1",t.teams[1].id],["Local o local de ida · Cruce 2",t.teams[2].id],["Visitante o local de vuelta · Cruce 2",t.teams[3].id]])await center.getByRole("combobox",{name:label,exact:true}).selectOption(id);
  await center.getByRole("button",{name:"Revisar distribución y cruces",exact:true}).click();
}
test("sorteos y cruces: ida y vuelta exige dos confirmaciones y conserva la propuesta",async({page},info)=>{
  const t=drawCup(true);await seed(page,[t]);const center=await drawCenter(page),before=await sportsStorage(page);
  await manualPairs(center,t);expect(await sportsStorage(page)).toEqual(before);
  await expect(center.getByRole("region",{name:"Vista previa de distribución",exact:true})).toContainText("Ida y vuelta");
  await center.getByRole("button",{name:"Confirmar distribución y cruces",exact:true}).click();
  await expect(center.getByRole("status").filter({hasText:"Distribución confirmada."})).toBeVisible();
  expect((await saved(page))[0].matchdays.flatMap(d=>d.fixtures)).toEqual([]);
  const afterDraw=await sportsStorage(page);await center.getByRole("button",{name:"Revisar creación de encuentros",exact:true}).click();expect(await sportsStorage(page)).toEqual(afterDraw);
  await center.getByRole("button",{name:"Confirmar creación de encuentros",exact:true}).click();await expect(center.getByRole("status").filter({hasText:"Encuentros creados."})).toBeVisible();
  const current=(await saved(page))[0],first=current.matchdays.find(d=>d.phaseName==="Semifinal · Ida")!,second=current.matchdays.find(d=>d.phaseName==="Semifinal · Vuelta")!;
  expect(first.fixtures).toHaveLength(2);expect(second.fixtures).toHaveLength(2);expect(first.fixtures[0].homeTeamId).toBe(t.teams[0].id);expect(second.fixtures[0].homeTeamId).toBe(t.teams[1].id);
  expect(current.matchdays).toHaveLength(t.matchdays.length);expect(current.matchdays.flatMap(d=>d.fixtures).every(f=>!f.result && !f.schedule)).toBe(true);
  await expect(center.getByRole("button",{name:"Revisar distribución y cruces",exact:true})).toBeDisabled();
  await center.getByRole("region",{name:"Cuadro de encuentros registrados",exact:true}).scrollIntoViewIfNeeded();await layout(page,info,"draw-bracket");
  await center.getByRole("button",{name:"Abrir calendario",exact:true}).click();await expect(page.getByRole("region",{name:`Calendario de ${t.name}`,exact:true})).toBeVisible();
  const reopened=await drawCenter(page);await reopened.getByRole("button",{name:"Centro de cierre",exact:true}).click();await expect(page.getByRole("region",{name:"Centro de cierre de temporadas",exact:true})).toBeVisible();
});
test("sorteos y cruces: grupos documentados conservan fuente y programan sin simular",async({page},info)=>{
  const t=drawGroups();await seed(page,[t]);const center=await drawCenter(page);await center.getByRole("button",{name:"Revisar Grupos registrados",exact:true}).click();
  await center.getByRole("combobox",{name:"Modalidad de preparación",exact:true}).selectOption("documented");
  await center.getByRole("combobox",{name:`Grupo de ${t.teams[1].name}`,exact:true}).selectOption("B");await center.getByRole("combobox",{name:`Grupo de ${t.teams[2].name}`,exact:true}).selectOption("A");
  await center.getByRole("textbox",{name:"URL de la fuente",exact:true}).fill("https://example.org/distribution");await center.getByRole("textbox",{name:"Referencia de la distribución",exact:true}).fill("Distribución contrastada por el usuario");
  await center.getByRole("combobox",{name:"Verificación de la fuente",exact:true}).selectOption("verified");await center.getByRole("checkbox").check();
  const before=await sportsStorage(page);await center.getByRole("button",{name:"Revisar distribución y cruces",exact:true}).click();expect(await sportsStorage(page)).toEqual(before);await layout(page,info,"draw-groups-preview");
  await center.getByRole("button",{name:"Confirmar distribución y cruces",exact:true}).click();await expect(center.getByRole("status").filter({hasText:"Distribución confirmada."})).toBeVisible();
  const confirmed=(await saved(page))[0];expect(confirmed.teams[2].groupName).toBe("A");expect(confirmed.matchdays).toEqual([]);
  const record=await page.evaluate(()=>JSON.parse(localStorage.getItem("cancha.activity")!).find((e:{action:string})=>e.action==="stage-draw-confirmed"));expect(record.after.mode).toBe("documented");expect(record.after.source.url).toBe("https://example.org/distribution");
  await center.getByRole("button",{name:"Revisar creación de encuentros",exact:true}).click();await center.getByRole("button",{name:"Confirmar creación de encuentros",exact:true}).click();await expect(center.getByRole("status").filter({hasText:"Encuentros creados."})).toBeVisible();
  expect((await saved(page))[0].matchdays.flatMap(d=>d.fixtures)).toHaveLength(2);expect((await saved(page))[0].matchdays.flatMap(d=>d.fixtures).every(f=>!f.result)).toBe(true);
  await center.getByRole("button",{name:"Centro de simulación",exact:true}).click();await expect(page.getByRole("region",{name:"Centro de simulación de temporadas",exact:true})).toBeVisible();
});
test("sorteos y cruces: dos pestañas rechazan confirmaciones incompatibles y respetan universos",async({page,context})=>{
  const t=drawCup(),otherUniverse={...drawGroups(),name:"Grupos del universo rival"};
  const universes:SportsUniverseLibrary={version:1,activeUniverseId:"u1",universes:[{id:"u1",name:"Partida de cruces"},{id:"u2",name:"Otra partida"}],assignments:{[t.id]:"u1",[otherUniverse.id]:"u2"}};
  await seed(page,[t,otherUniverse],[],universes);const first=await drawCenter(page),other=await context.newPage();await other.goto("/");const second=await drawCenter(other);
  await expect(first.getByRole("option",{name:/universo rival/})).toHaveCount(0);
  await manualPairs(first,t);await manualPairs(second,t);await first.getByRole("button",{name:"Confirmar distribución y cruces",exact:true}).click();await expect(first.getByRole("status").filter({hasText:"Distribución confirmada."})).toBeVisible();
  const after=await sportsStorage(page);await second.getByRole("button",{name:"Confirmar distribución y cruces",exact:true}).click();await expect(second.getByRole("status").filter({hasText:"La biblioteca cambió"})).toBeVisible();
  expect(await sportsStorage(other)).toEqual(after);expect((await saved(page)).find(s=>s.id===otherUniverse.id)).toEqual(otherUniverse);
  const events=await page.evaluate(()=>JSON.parse(localStorage.getItem("cancha.activity")!) as {action:string;universeId?:string}[]);expect(events.filter(e=>e.action==="stage-draw-confirmed")).toHaveLength(1);expect(events.find(e=>e.action==="stage-draw-confirmed")?.universeId).toBe("u1");await other.close();
});

async function sportsDecisions(page:Page,id:string){await expect(page.locator("main")).toHaveAttribute("aria-busy","false");await page.locator("#open-sports-decisions").click();const center=page.getByRole("region",{name:"Centro de decisiones deportivas",exact:true});await expect(center).toBeVisible();await center.getByRole("combobox",{name:"Competición y temporada para decisiones",exact:true}).selectOption(id);return center;}
async function documentaryReview(center:ReturnType<Page["getByRole"]>,t:Tournament){
  const input=decisionInput(t),manager=center.getByRole("region",{name:"Resoluciones oficiales",exact:true});
  await manager.getByText(`${input.context.title} · Pendiente`,{exact:true}).click();
  await manager.getByRole("textbox",{name:"URL oficial de la publicación",exact:true}).fill(input.source.url);
  await manager.getByRole("textbox",{name:"Referencia verificable (boletín, artículo o acta)",exact:true}).fill(input.source.reference);
  for(const [index,id] of input.orderedTeamIds!.entries())await manager.getByRole("combobox",{name:`Sorteo · posición ${index+1}`,exact:true}).selectOption(id);
  await manager.getByRole("combobox",{name:"Estado de verificación",exact:true}).selectOption("verified");await manager.getByRole("checkbox",{name:/Contrasté los participantes/}).check();
  await manager.getByRole("button",{name:"Revisar registro oficial",exact:true}).click();await expect(center.getByRole("region",{name:"Vista previa de resolución deportiva",exact:true})).toBeVisible();
}
test("decisiones deportivas: publicación revisada conserva partidos y conecta sorteos y cierre",async({page},info)=>{
  const small=closureLeague("decision-small"),t=decisionTie();await seed(page,[small,t]);const center=await sportsDecisions(page,t.id),before=await sportsStorage(page),original=(await saved(page)).find(s=>s.id===t.id)!;
  await documentaryReview(center,original);expect(await sportsStorage(page)).toEqual(before);
  await expect(center.getByRole("heading",{name:"Revisión antes de confirmar",exact:true})).toBeFocused();await layout(page,info,"sports-decision-preview");
  await center.getByRole("button",{name:"Confirmar resolución deportiva",exact:true}).click();await expect(center.getByRole("status").filter({hasText:"Resolución registrada."})).toBeVisible();
  const next=(await saved(page)).find(s=>s.id===t.id)!;expect(next.matchdays).toEqual(original.matchdays);expect(next.teams).toEqual(original.teams);expect(next.officialResolutions).toHaveLength(1);
  await expect(center.getByRole("region",{name:"Historial y vigencia documental",exact:true}).getByRole("heading",{name:`${decisionInput(original).context.key} · Resuelta`,exact:true})).toBeVisible();
  await center.getByRole("button",{name:"Centro de sorteos",exact:true}).click();await expect(page.getByRole("region",{name:"Centro de sorteos y cruces",exact:true})).toBeVisible();
  const returned=await sportsDecisions(page,t.id);await returned.getByRole("button",{name:"Centro de cierre",exact:true}).click();await expect(page.getByRole("region",{name:"Centro de cierre de temporadas",exact:true})).toBeVisible();expect((await saved(page)).find(s=>s.id===t.id)!.matchdays).toEqual(original.matchdays);
});
test("decisiones deportivas: dos pestañas no duplican publicaciones ni cruzan universos",async({page,context})=>{
  const small=closureLeague("decision-small"),t=decisionTie(),hidden={...closureLeague("decision-hidden"),name:"Otra partida oculta"};
  const universes:SportsUniverseLibrary={version:1,activeUniverseId:"u1",universes:[{id:"u1",name:"Decisiones de la partida"},{id:"u2",name:"Otra partida"}],assignments:{[small.id]:"u1",[t.id]:"u1",[hidden.id]:"u2"}};
  await seed(page,[small,t,hidden],[],universes);const first=await sportsDecisions(page,t.id),other=await context.newPage();await other.goto("/");const second=await sportsDecisions(other,t.id);await expect(first.getByRole("option",{name:/Otra partida oculta/})).toHaveCount(0);
  const original=(await saved(page)).find(s=>s.id===t.id)!;await documentaryReview(first,original);await documentaryReview(second,original);await first.getByRole("button",{name:"Confirmar resolución deportiva",exact:true}).click();await expect(first.getByRole("status").filter({hasText:"Resolución registrada."})).toBeVisible();
  const after=await sportsStorage(page);await second.getByRole("button",{name:"Confirmar resolución deportiva",exact:true}).click();await expect(second.getByRole("status").filter({hasText:"La biblioteca cambió"})).toBeVisible();expect(await sportsStorage(other)).toEqual(after);
  expect((await saved(page)).find(s=>s.id===hidden.id)).toEqual(hidden);expect((await saved(page)).find(s=>s.id===t.id)!.matchdays).toEqual(original.matchdays);
  const events=await page.evaluate(()=>JSON.parse(localStorage.getItem("cancha.activity")!) as {action:string;universeId?:string}[]);expect(events.filter(e=>e.action==="official-resolution-recorded")).toHaveLength(1);expect(events.find(e=>e.action==="official-resolution-recorded")?.universeId).toBe("u1");await other.close();
});
test("decisiones deportivas: penales pendientes navegan al editor y el cálculo válido no exige confirmación",async({page})=>{
  const source=closureCup(),t={...source,matchdays:source.matchdays.map((day,index)=>index?{...day,fixtures:day.fixtures.map(f=>({...f,result:undefined}))}:day)};
  await seed(page,[t]);let center=await sportsDecisions(page,t.id);const before=await sportsStorage(page);
  const pending=center.getByRole("article",{name:"Cruce sin ganador acreditado",exact:true});await expect(pending).toHaveCount(1);await expect(center.getByRole("button",{name:"Confirmar resolución deportiva",exact:true})).toHaveCount(0);
  await pending.getByRole("button",{name:"Abrir encuentro final",exact:true}).click();const calendar=page.getByRole("region",{name:`Calendario de ${t.name}`,exact:true});await expect(calendar).toBeVisible();expect(await sportsStorage(page)).toEqual(before);
  const final=calendar.locator("#calendar-fixture-final");await final.getByRole("spinbutton").nth(0).fill("2");await final.getByRole("spinbutton").nth(1).fill("0");await final.getByRole("button",{name:"Guardar",exact:true}).click();
  await expect.poll(async()=>(await saved(page))[0].matchdays.at(-1)!.fixtures[0].result?.homeGoals).toBe(2);center=await sportsDecisions(page,t.id);await expect(center.getByRole("article",{name:"Ganador calculado",exact:true})).toHaveCount(3);await expect(center.getByRole("article",{name:"Cruce sin ganador acreditado",exact:true})).toHaveCount(0);
  await center.getByRole("button",{name:"Centro de simulación",exact:true}).click();await expect(page.getByRole("region",{name:"Centro de simulación de temporadas",exact:true})).toBeVisible();
});


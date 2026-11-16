import { renderApplication } from "../test-utils/render-application";
import { installTestWebLocks } from "../test-utils/web-locks";
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importOfficialTournament } from "../application/use-cases/import-official-tournament";
import argentinaSample from "../test-utils/fixtures/live/argentina-apertura-2026.json";
import type { OfficialLeagueSeason } from "../application/ports/official-league-source";
import { seedTie } from "../test-utils/official-resolution-fixtures";
import { App } from "./app";
import { divisionFixture } from "../domain/services/second-division-test-fixtures";
import { getDivisionOutcome } from "../domain/services/second-division-progression";
import { validateTournamentIntegrity } from "../domain/services/tournament-integrity";
import { LocalStorageTournamentRepository } from "../infrastructure/persistence/local-storage-tournament-repository";
import { nationalCup, continentalCup, brazilUpper, argentinaUpper } from "../test-utils/journey-competition-fixtures";
import type { Tournament } from "../domain/entities/tournament";

const showModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
beforeEach(() => {
  installTestWebLocks();
  localStorage.clear();
  let seed = 42;
  vi.spyOn(Math, "random").mockImplementation(() => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function(this: HTMLDialogElement) { this.removeAttribute("open"); } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks();
  for (const [key, descriptor] of [["showModal", showModal], ["close", close]] as const) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, key, descriptor); else Reflect.deleteProperty(HTMLDialogElement.prototype, key);
  }
});
function seed(tournaments: Tournament[], active = tournaments[0].id) {
  const repository = new LocalStorageTournamentRepository(false);
  tournaments.forEach(t => repository.save(t)); repository.setActiveTournamentId(active); return repository;
}
function click(name: string | RegExp) { fireEvent.click(screen.getByRole("button", { name })); }
async function simulate() { fireEvent.click(await screen.findByRole("button", { name: "Simular campeonato" })); }

describe("competition journeys through the actual App and persistence", () => {
  it.each(["argentina", "brasil"] as const)("simulates %s second division playoffs and keeps regular standings intact", async kind => {
    const original = divisionFixture(kind); const repository = seed([original]);
    const view = await renderApplication(<App />);
    await screen.findByRole("region", { name: "Ascensos y descensos" }, { timeout: 10000 });
    await simulate();
    await waitFor(() => expect(getDivisionOutcome(repository.findAll()[0]).complete).toBe(true));
    const final = repository.findAll()[0];
    expect(getDivisionOutcome(final).promoted).toHaveLength(kind === "argentina" ? 2 : 4);
    expect(getDivisionOutcome(final).relegated).toHaveLength(4);
    expect(final.matchdays.filter(d => d.phaseName === "Fase regular")).toEqual(original.matchdays);
    expect(validateTournamentIntegrity(final)).toEqual([]);
    const outcome = screen.getByRole("region", { name: "Ascensos y descensos" });
    expect(within(outcome).getByText(/Ascendidos confirmados:/)).not.toHaveTextContent("Pendiente");
    view.unmount(); await renderApplication(<App />);
    await screen.findByRole("region", { name: "Ascensos y descensos" }, { timeout: 10000 });
    expect(getDivisionOutcome(repository.findAll()[0]).complete).toBe(true);
  }, 20000);
  it.each(["argentina", "brasil"] as const)("simulates the national cup in %s through its configured final", async country => {
    const source = nationalCup(country); const repository = seed([source]);
    await renderApplication(<App />); await simulate();
    await waitFor(() => expect(repository.findAll()[0].matchdays.some(d => d.phaseName?.endsWith(" · Final") && d.fixtures[0]?.result)).toBe(true));
    const tournament = repository.findAll()[0]; expect(validateTournamentIntegrity(tournament)).toEqual([]);
    expect(tournament.matchdays.every(d => d.fixtures.length > 0 && d.fixtures.every(f => !!f.result))).toBe(true);
    expect(repository.findActivity().some(e => e.action === "matches-simulated")).toBe(true);
  });
  it.each(["libertadores", "sudamericana"] as const)("progresses %s groups and knockout stages with the linked competitions", async kind => {
    const lib = continentalCup("libertadores"), suda = continentalCup("sudamericana");
    const active = kind === "libertadores" ? lib : suda;
    const repository = seed([lib, suda], active.id);
    await renderApplication(<App />); await simulate();
    await waitFor(() => expect(repository.findAll().find(t => t.id === active.id)?.matchdays
      .some(d => d.phaseName?.endsWith(" · Final") && d.fixtures[0]?.result)).toBe(true));
    const completed = repository.findAll().find(t => t.id === active.id)!;
    expect(validateTournamentIntegrity(completed)).toEqual([]);
    expect(completed.matchdays.filter(d => d.phaseName?.includes("Fase de grupos"))).toEqual(active.matchdays.filter(d => d.phaseName?.includes("Fase de grupos")));
  }, 20000);
  it.each(["brasil", "argentina"] as const)("reviews %s roster exchanges and confirms future seasons without changing history", async kind => {
    const lower = divisionFixture(kind), upper = kind === "brasil" ? brazilUpper() : argentinaUpper();
    const history: Tournament[] = kind === "brasil" ? [] : [2024, 2025].map(year => ({ ...upper,
      id: `arg-liga-profesional-${year}`, season: year, importCoverage: "complete",
      matchdays: upper.matchdays.filter(d => d.phaseName?.endsWith("Fase regular")) }));
    const documentaryUrl = kind === "brasil" ? "https://www.cbf.com.br/" : "https://www.afa.com.ar/";
    const repository = seed([upper, ...history, lower], lower.id); await renderApplication(<App />); await simulate();
    const before = repository.findAll();
    fireEvent.click(await screen.findByText("Conectar divisiones y planificar la próxima temporada"));
    fireEvent.change(screen.getByLabelText("Ascendidos desde categorías inferiores (un club por línea)"), { target: { value: "Nuevo 1\nNuevo 2\nNuevo 3\nNuevo 4" } });
    fireEvent.change(screen.getByLabelText("Fuente de esos ascensos"), { target: { value: documentaryUrl } });
    click("Biblioteca"); click(/Volver al torneo activo/);
    fireEvent.click(await screen.findByText("Conectar divisiones y planificar la próxima temporada"));
    expect(screen.getByLabelText("Fuente de esos ascensos")).toHaveValue(documentaryUrl);
    expect(screen.getByLabelText("Ascendidos desde categorías inferiores (un club por línea)")).toHaveValue("Nuevo 1\nNuevo 2\nNuevo 3\nNuevo 4");
    click("Revisar nuevas temporadas");
    const review = await screen.findByRole("dialog", { name: "Planificar temporadas 2027" });
    expect(review).toHaveTextContent(`Primera (${upper.teams.length})`); expect(review).toHaveTextContent(`Segunda (${lower.teams.length})`);
    expect(repository.findAll()).toHaveLength(before.length);
    fireEvent.click(within(review).getByRole("button", { name: "Crear ambas temporadas" }));
    await waitFor(() => expect(repository.findAll()).toHaveLength(before.length + 2));
    expect(repository.findAll().filter(t => t.season !== 2027)).toEqual(before);
    const future = repository.findAll().filter(t => t.season === 2027);
    expect(future.every(t => t.matchdays.length === 0 && t.competitionRules?.verification.placements === "pending")).toBe(true);
    expect(future.map(t => t.teams.length).sort((a, b) => a - b)).toEqual([upper.teams.length, lower.teams.length].sort((a, b) => a - b));
  }, 20000);
  it("finishes the published Argentina Apertura final without inventing the missing Clausura", async () => {
    const repository = new LocalStorageTournamentRepository(false);
    const imported = await importOfficialTournament({ fetchSeason: async () => argentinaSample as OfficialLeagueSeason }, repository);
    const finalDay = imported.matchdays.find(d => d.phaseName === "Torneo Apertura · Final")!;
    expect(finalDay.fixtures).toHaveLength(1);
    const source = { ...imported, importCoverage: "partial" as const, matchdays: imported.matchdays.map(d => d === finalDay
      ? { ...d, fixtures: d.fixtures.map(f => ({ ...f, result: undefined, operationalState: undefined })) } : d) };
    repository.save(source); repository.setActiveTournamentId(source.id);
    await renderApplication(<App />); await simulate();
    const completed = repository.findAll()[0];
    expect(completed.matchdays.find(d => d.phaseName === finalDay.phaseName)?.fixtures[0].result).toBeDefined();
    expect(completed.matchdays.filter(d => d.phaseName?.includes("Clausura")).flatMap(d => d.fixtures)).toEqual([]);
    expect(repository.findAll().every(t => t.season === 2026)).toBe(true);
    expect(validateTournamentIntegrity(completed)).toEqual([]);
    expect(await screen.findByRole("region", { name: "Estadísticas del campeonato" }, { timeout: 10000 })).toBeInTheDocument();
  }, 20000);
  it("simulates a pending Série A match, shows its table and retains the score after reload", async () => {
    const upper = brazilUpper();
    const last = upper.matchdays[upper.matchdays.length - 1].fixtures[0].id;
    const source = { ...upper, importCoverage: "partial" as const, matchdays: upper.matchdays.slice(-1).map(d => ({ ...d, fixtures: d.fixtures.map(f => ({ ...f,
      ...(f.id === last ? { result: undefined } : {}) })) })) };
    const repository = seed([source]); const view = await renderApplication(<App />); await simulate();
    const stored = repository.findAll()[0];
    expect(stored.matchdays.flatMap(d => d.fixtures).find(f => f.id === last)?.result).toBeDefined();
    expect(stored.matchdays.flatMap(d => d.fixtures)).toHaveLength(10);
    expect(stored.importCoverage).toBe("partial");
    expect(screen.getByRole("region", { name: "Tabla de posiciones" })).toBeInTheDocument();
    view.unmount(); await renderApplication(<App />);
    await screen.findByRole("heading", { name: stored.name });
    expect(repository.findAll()[0]).toEqual(stored);
  }, 30000);
  it("leaves Brazilian discipline/tie resolutions pending and disables the season transition", async () => {
    const lower = divisionFixture("brasil");
    const tied = { ...lower, matchdays: lower.matchdays.map(d => ({ ...d, fixtures: d.fixtures.map(f => ({ ...f, result: { homeGoals: 0, awayGoals: 0 } })) })) };
    const repository = seed([brazilUpper(), tied], tied.id);
    await renderApplication(<App />); await screen.findByRole("region", { name: "Ascensos y descensos" }, { timeout: 10000 });
    await simulate(); const current = repository.findAll().find(t => t.id === tied.id)!;
    expect(getDivisionOutcome(current).complete).toBe(false);
    expect(getDivisionOutcome(current).promoted).toEqual([]);
    expect(current.officialResolutions ?? []).toEqual([]);
    fireEvent.click(await screen.findByText("Conectar divisiones y planificar la próxima temporada"));
    expect(screen.getByRole("button", { name: "Revisar nuevas temporadas" })).toBeDisabled();
    expect(repository.findAll()).toHaveLength(2);
  }, 20000);
  it("keeps an Argentine official draw blocked and retains its unfinished documentary reference", async () => {
    const source = seedTie(); const repository = seed([source]); await renderApplication(<App />);
    await screen.findByRole("region", { name: "Resoluciones oficiales" }, { timeout: 10000 });
    fireEvent.click(screen.getByText(/Sorteo de ordenamiento · Reducido · Primera fase · Quintos · Pendiente/));
    fireEvent.change(screen.getByLabelText("URL oficial de la publicación"), { target: { value: "https://www.afa.com.ar/boletines" } });
    click("Biblioteca"); click(/Volver al torneo activo/);
    fireEvent.click(await screen.findByText(/Sorteo de ordenamiento · Reducido · Primera fase · Quintos · Pendiente/));
    expect(screen.getByLabelText("URL oficial de la publicación")).toHaveValue("https://www.afa.com.ar/boletines");
    expect(getDivisionOutcome(repository.findAll()[0]).complete).toBe(false);
    expect(repository.findAll()[0].officialResolutions ?? []).toEqual([]);
  }, 20000);
  it("shows pending future rules and preserves a draft without treating it as a verified regulation", async () => {
    const original = divisionFixture("brasil");
    const future: Tournament = { ...original, id: "future-b-2027", name: "Série B 2027", season: 2027, matchdays: [],
      competitionRules: { season: 2027, verification: { standings: "pending", placements: "pending" } },
      tieBreakers: [], seasonPreparation: { schemaVersion: 1, sourceTournamentIds: [original.id], plannedParticipants: original.teams.map(t => t.name), calendarReviews: [] } };
    const repository = seed([future]); await renderApplication(<App />);
    await screen.findByRole("region", { name: "Preparación de temporada" }, { timeout: 10000 });
    fireEvent.click(screen.getByText("Registrar reglamento anual documentado"));
    fireEvent.change(screen.getByLabelText("Disposiciones de tabla y referencia documental"), { target: { value: "Documento por revisar" } });
    click("Biblioteca"); click(/Volver al torneo activo/);
    expect(await screen.findByLabelText("Disposiciones de tabla y referencia documental")).toHaveValue("Documento por revisar");
    expect(repository.findAll()[0].competitionRules?.verification.standings).toBe("pending");
    expect(repository.findAll()[0].matchdays).toEqual([]);
  });

});

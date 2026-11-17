import { renderApplication } from "../test-utils/render-application";
import { installTestWebLocks } from "../test-utils/web-locks";
// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadOfficialLeagueSource } from "../infrastructure/external-services/load-official-league-source";
import type { OfficialLeagueSeason } from "@cancha/core/application/ports/official-league-source";
import { LocalStorageTournamentRepository } from "../infrastructure/persistence/local-storage-tournament-repository";
import { parseTournamentBackupWithActivity } from "@cancha/core/application/services/tournament-archive";
import { listSourceIncidents } from "@cancha/core/application/services/source-incidents";
vi.mock("../infrastructure/external-services/load-official-league-source", () => ({
  loadOfficialLeagueSource: vi.fn(), publishedSeasonSource: { fetchPublishedSeason: vi.fn() },
}));
import { App } from "./app";
import type { Tournament } from "@cancha/core/domain/entities/tournament";

const saved: Tournament = { id: "journey-2026", name: "Liga recorrido", season: 2026,
  teams: [{ id: "a", name: "Club A" }, { id: "b", name: "Club B" }], legs: 1,
  tieBreakers: ["goalDifference", "goalsFor"], pointsSystem: { win: 3, draw: 1, loss: 0 },
  createdAt: "2026-01-01T00:00:00.000Z", matchdays: [{ number: 1, leg: 1,
    fixtures: [{ id: "game", homeTeamId: "a", awayTeamId: "b" }] }] };
function click(name: string | RegExp) { fireEvent.click(screen.getByRole("button", { name })); }
function openSaveRecoveryCenter() {
  const button = screen.getByRole("button", { name: /^Centro de guardado y recuperación$/ });
  if (button.getAttribute("aria-expanded") !== "true") fireEvent.click(button);
}
let exported: Blob | undefined;
const originalCreateUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalDialogShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalDialogClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
beforeEach(() => {
  installTestWebLocks();
  localStorage.clear(); vi.clearAllMocks(); exported = undefined;
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: (blob: Blob) => { exported = blob; return "blob:test"; } });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true,
    value: function(this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true,
    value: function(this: HTMLDialogElement) { this.removeAttribute("open"); } });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks();
  for (const [object, key, descriptor] of [[URL, "createObjectURL", originalCreateUrl],
    [HTMLDialogElement.prototype, "showModal", originalDialogShow], [HTMLDialogElement.prototype, "close", originalDialogClose]] as const) {
    if (descriptor) Object.defineProperty(object, key, descriptor); else Reflect.deleteProperty(object, key);
  }
});
function readExport(): Promise<string> {
  if (!exported) throw new Error("No se exportó un archivo");
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject; reader.readAsText(exported!); });
}
function upload(text: string) {
  const file = new File([text], "backup.json", { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => text });
  fireEvent.change(screen.getByLabelText("Archivo JSON de respaldo"), { target: { files: [file] } });
}
async function setup() {
  fireEvent.click(await screen.findByRole("button", { name: "Crear o importar torneo" }));
  return screen.findByRole("region", { name: "Importar campeonatos" });
}
async function importChile() {
  const card = (await screen.findByRole("heading", { name: "Liga de Primera 2026" })).closest("article")!;
  fireEvent.click(within(card).getByRole("button", { name: "Importar / actualizar" }));
}
function providerSeason(bad = false): OfficialLeagueSeason {
  const pairs = [["A", "B"], ["C", "D"], ["A", "C"], ["B", "D"], ["A", "D"], ["B", "C"],
    [bad ? "A" : "B", bad ? "B" : "A"], ["D", "C"], ["C", "A"], ["D", "B"], ["D", "A"], ["C", "B"]];
  return { id: "journey-provider-2026", name: "Proveedor de prueba", season: 2026,
    sourceName: "Proveedor sintético", sourceUrl: "https://example.org/calendar",
    matchdays: Array.from({ length: 6 }, (_, i) => ({ number: i + 1, matches: pairs.slice(i * 2, i * 2 + 2)
      .map(([home, away], j) => ({ id: `${i}-${j}`, homeTeamName: `Club ${home}`, awayTeamName: `Club ${away}`, homeGoals: 1, awayGoals: 0 })) })) };
}

describe("complete application journeys with isolated browser storage", () => {
  it("opens recovery from the universe dashboard and exports the complete library without writing data", async () => {
    const played: Tournament = {
      ...saved,
      matchdays: [{
        ...saved.matchdays[0],
        fixtures: [{
          ...saved.matchdays[0].fixtures[0],
          result: { homeGoals: 2, awayGoals: 1 },
        }],
      }],
    };
    const universes = {
      version: 1 as const,
      activeUniverseId: "career",
      universes: [{ id: "career", name: "Partida local", description: "Respaldo de prueba" }],
      assignments: { [played.id]: "career" },
    };
    localStorage.setItem("cancha.tournaments", JSON.stringify([played]));
    localStorage.setItem("cancha.sportsUniverses", JSON.stringify(universes));
    await renderApplication(<App />);
    click("Biblioteca");
    click("Panel principal del universo");
    const dashboard = screen.getByRole("region", { name: "Panel del universo deportivo" });
    fireEvent.click(within(dashboard).getByRole("button", {
      name: "Centro de guardado y recuperación",
    }));

    const center = screen.getByRole("region", { name: "Centro de guardado y recuperación" });
    expect(within(center).getByText("Torneos").parentElement).toHaveTextContent("1");
    expect(within(center).getByText("JSON v7 · cancha-backup")).toBeInTheDocument();
    expect(within(center).getByText(/Respaldo por universo/)).toBeInTheDocument();
    expect(within(center).getByText(/No disponible: separar torneos/)).toBeInTheDocument();

    const before = ["cancha.tournaments", "cancha.activity", "cancha.sportsUniverses"]
      .map((key) => localStorage.getItem(key));
    click("Descargar respaldo completo");
    const backup = parseTournamentBackupWithActivity(await readExport());

    expect(backup.version).toBe(7);
    expect(backup.exportedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(backup.tournaments).toEqual([played]);
    expect(backup.universes).toEqual(universes);
    expect(["cancha.tournaments", "cancha.activity", "cancha.sportsUniverses"]
      .map((key) => localStorage.getItem(key))).toEqual(before);
  });

  it("retains an unfinished custom championship when navigating through the library", async () => {
    await renderApplication(<App />);
    await setup();
    fireEvent.change(screen.getByLabelText("Nombre del campeonato"), { target: { value: "Borrador sin guardar" } });
    fireEvent.change(screen.getByLabelText("Equipo 1"), { target: { value: "Equipo editado" } });
    click("Biblioteca");
    click("Crear o importar torneo");
    expect(screen.getByLabelText("Nombre del campeonato")).toHaveValue("Borrador sin guardar");
    expect(screen.getByLabelText("Equipo 1")).toHaveValue("Equipo editado");
    expect(localStorage.getItem("cancha.tournaments")).toBeNull();
  });
  it("retains an unsaved result across library navigation without persisting it", async () => {
    localStorage.setItem("cancha.tournaments", JSON.stringify([saved]));
    await renderApplication(<App />);
    const fixture = await screen.findByRole("group", { name: "Club A contra Club B" });
    fireEvent.change(within(fixture).getAllByRole("spinbutton")[0], { target: { value: "7" } });
    click("Biblioteca"); click(/Volver al torneo activo/);
    const returned = await screen.findByRole("group", { name: "Club A contra Club B" });
    expect(within(returned).getAllByRole("spinbutton")[0]).toHaveValue(7);
    expect(JSON.parse(localStorage.getItem("cancha.tournaments")!)[0].matchdays[0].fixtures[0].result).toBeUndefined();
  });
  it("imports, edits, cancels reimport, updates conservatively and reloads the local score", async () => {
    const fetchSeason = vi.fn(async () => providerSeason());
    vi.mocked(loadOfficialLeagueSource).mockResolvedValue({ fetchSeason });
    const view = await renderApplication(<App />); await setup(); await importChile();
    const fixture = (await screen.findAllByRole("group", { name: "Club A contra Club B" }))[0];
    const inputs = within(fixture).getAllByRole("spinbutton");
    fireEvent.change(inputs[0], { target: { value: "4" } });
    fireEvent.change(inputs[1], { target: { value: "2" } });
    fireEvent.click(within(fixture).getByRole("button", { name: "Guardar" }));
    await screen.findByText("Resultado guardado.");
    click("Biblioteca"); await setup(); await importChile();
    const dialog = await screen.findByRole("dialog", { name: "La temporada 2026 ya está guardada" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(new LocalStorageTournamentRepository(false).findAll()[0].matchdays[0].fixtures[0].result).toEqual({ homeGoals: 4, awayGoals: 2 });
    await importChile();
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Actualizar y conservar marcadores" }));
    await screen.findByRole("heading", { name: "Proveedor de prueba 2026" });
    view.unmount(); await renderApplication(<App />);
    const restored = await screen.findByRole("group", { name: "Club A contra Club B" });
    expect(within(restored).getByText("4 — 2")).toBeInTheDocument();
    expect(fetchSeason).toHaveBeenCalledTimes(3);
  }, 15000);
  it("records a rejection, reviews its file, exports/restores the registry, imports and reloads", async () => {
    vi.mocked(loadOfficialLeagueSource).mockResolvedValue({ fetchSeason: async () => providerSeason(true) });
    let view = await renderApplication(<App />); await setup(); await importChile();
    expect(await screen.findByRole("alert")).toHaveTextContent("calendario inválido");
    let region = screen.getByRole("region", { name: "Incidencias de fuentes externas" });
    fireEvent.click(within(region).getByText(/Proveedor de prueba · 2026 · Pendiente/));
    const select = within(region).getByLabelText("Encuentro afectado");
    fireEvent.change(select, { target: { value: "1" } });
    fireEvent.change(within(region).getByLabelText("Local corregido"), { target: { value: "Club B" } });
    fireEvent.change(within(region).getByLabelText("Visitante corregido"), { target: { value: "Club A" } });
    for (const [label, value] of [["Documento HTTPS", "https://example.org/document"], ["Referencia documental", "Documento sintético"], ["Motivo de la revisión", "Prueba documentada"]]) {
      fireEvent.change(within(region).getByLabelText(label), { target: { value } });
    }
    click("Biblioteca"); await setup();
    region = screen.getByRole("region", { name: "Incidencias de fuentes externas" });
    fireEvent.click(within(region).getByText(/Proveedor de prueba · 2026 · Pendiente/));
    expect(within(region).getByLabelText("Documento HTTPS")).toHaveValue("https://example.org/document");
    expect(within(region).getByLabelText("Local corregido")).toHaveValue("Club B");
    fireEvent.click(within(region).getByLabelText(/He contrastado/));
    fireEvent.click(within(region).getByLabelText(/Confirmo expresamente/));
    fireEvent.click(within(region).getByRole("button", { name: "Registrar revisión" }));
    expect(await within(region).findByText(/Revisión guardada/)).toBeInTheDocument();
    click("Biblioteca"); openSaveRecoveryCenter(); click("Descargar respaldo completo");
    const text = await readExport(); const backup = parseTournamentBackupWithActivity(text);
    expect(backup.tournaments).toEqual([]); expect(backup.activity).toHaveLength(2);
    view.unmount(); localStorage.clear(); view = await renderApplication(<App />);
    openSaveRecoveryCenter(); click("Restaurar respaldo");
    upload(text);
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Restaurar respaldo" })).getByRole("button", { name: "Reemplazar biblioteca" }));
    await waitFor(() => expect(listSourceIncidents(new LocalStorageTournamentRepository(false))[0]?.status).toBe("verified"));
    await setup(); await importChile();
    await screen.findByRole("heading", { name: "Proveedor de prueba 2026" });
    const stored = new LocalStorageTournamentRepository(false).findAll()[0];
    expect(stored.matchdays[3].fixtures[0].id).toBe("official-2026-3-0");
    expect(stored.teams.find(t => t.id === stored.matchdays[3].fixtures[0].homeTeamId)?.name).toBe("Club B");
    view.unmount(); await renderApplication(<App />);
    await screen.findByRole("heading", { name: stored.name });
    expect(new LocalStorageTournamentRepository(false).findAll()[0]).toEqual(stored);
  }, 15000);
  it("exports real UI changes, rejects a corrupt restore, confirms a valid restore and preserves it after reload", async () => {
    localStorage.setItem("cancha.tournaments", JSON.stringify([saved]));
    let view = await renderApplication(<App />);
    const fixture = await screen.findByRole("group", { name: "Club A contra Club B" });
    fireEvent.change(within(fixture).getAllByRole("spinbutton")[0], { target: { value: "3" } });
    fireEvent.change(within(fixture).getAllByRole("spinbutton")[1], { target: { value: "1" } });
    fireEvent.click(within(fixture).getByRole("button", { name: "Guardar" }));
    await screen.findByText("Resultado guardado.");
    click("Biblioteca"); openSaveRecoveryCenter(); click("Descargar respaldo completo");
    const text = await readExport(); const backup = parseTournamentBackupWithActivity(text);
    const before = new LocalStorageTournamentRepository(false).findAll();
    openSaveRecoveryCenter(); click("Restaurar respaldo"); upload("{broken");
    expect(await screen.findByRole("alert")).toHaveTextContent("JSON válido");
    expect(new LocalStorageTournamentRepository(false).findAll()).toEqual(before);
    view.unmount(); localStorage.clear(); view = await renderApplication(<App />);
    await screen.findByRole("heading", { name: "Biblioteca de torneos" });
    openSaveRecoveryCenter(); click("Restaurar respaldo"); upload(text);
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Reemplazar biblioteca" }));
    await waitFor(() => expect(new LocalStorageTournamentRepository(false).findAll()).toEqual(backup.tournaments));
    view.unmount(); await renderApplication(<App />);
    expect(await screen.findByRole("group", { name: "Club A contra Club B" })).toHaveTextContent("3 — 1");
  });
  it("rejects a result write when storage is full and reloads the previous saved state", async () => {
    const previous = { ...saved, matchdays: [{ ...saved.matchdays[0], fixtures: [{ ...saved.matchdays[0].fixtures[0], result: { homeGoals: 1, awayGoals: 0 } }] }] };
    localStorage.setItem("cancha.tournaments", JSON.stringify([previous]));
    const view = await renderApplication(<App />);
    const fixture = await screen.findByRole("group", { name: "Club A contra Club B" });
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    fireEvent.change(within(fixture).getAllByRole("spinbutton")[0], { target: { value: "8" } });
    fireEvent.click(within(fixture).getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText(/No se confirmó el último cambio/)).toBeInTheDocument();
    expect(new LocalStorageTournamentRepository(false).findAll()).toEqual([previous]);
    view.unmount(); write.mockRestore(); await renderApplication(<App />);
    expect(await screen.findByRole("group", { name: "Club A contra Club B" })).toHaveTextContent("1 — 0");
  });

  it("preserves an unfinished venue while navigating away, and discards it on a true reload", async () => {
    localStorage.setItem("cancha.tournaments", JSON.stringify([saved]));
    const view = await renderApplication(<App />);
    await screen.findByRole("group", { name: "Club A contra Club B" });
    fireEvent.change(screen.getByLabelText("Estadio del partido Club A contra Club B"), { target: { value: "Recinto sin guardar" } });
    click("Biblioteca"); click(/Volver al torneo activo/);
    expect(await screen.findByLabelText("Estadio del partido Club A contra Club B")).toHaveValue("Recinto sin guardar");
    view.unmount(); await renderApplication(<App />);
    expect(await screen.findByLabelText("Estadio del partido Club A contra Club B")).toHaveValue("");
    expect(new LocalStorageTournamentRepository(false).findAll()[0].matchdays[0].fixtures[0].schedule).toBeUndefined();
  });

  it("configures participants and points, generates the fixture, simulates a date and recalculates an edited score", async () => {
    await renderApplication(<App />); await setup();
    fireEvent.change(screen.getByLabelText("Nombre del campeonato"), { target: { value: "Reglas del recorrido" } });
    click("Quitar equipo 4"); click("Quitar equipo 3");
    fireEvent.change(screen.getByLabelText("Equipo 1"), { target: { value: "Equipo Alfa" } });
    fireEvent.change(screen.getByLabelText("Equipo 2"), { target: { value: "Equipo Beta" } });
    fireEvent.change(screen.getByLabelText("Puntos por victoria"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Puntos por empate"), { target: { value: "2" } });
    click(/Crear campeonato/);
    const fixture = (await screen.findAllByRole("group", { name: /Equipo (Alfa|Beta) contra Equipo/ }))[0];
    const goals = within(fixture).getAllByRole("spinbutton");
    fireEvent.change(goals[0], { target: { value: "2" } }); fireEvent.change(goals[1], { target: { value: "0" } });
    fireEvent.click(within(fixture).getByRole("button", { name: "Guardar" }));
    const home = fixture.getAttribute("aria-label")!.split(" contra ")[0];
    const table = screen.getByRole("region", { name: "Tabla de posiciones" });
    await waitFor(() => expect(within(within(table).getByRole("row", { name: new RegExp(home) })).getAllByRole("cell").slice(-1)[0]).toHaveTextContent("5"));
    fireEvent.change(goals[0], { target: { value: "1" } }); fireEvent.change(goals[1], { target: { value: "1" } });
    fireEvent.click(within(fixture).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(within(within(table).getByRole("row", { name: new RegExp(home) })).getAllByRole("cell").slice(-1)[0]).toHaveTextContent("2"));
    fireEvent.change(screen.getByLabelText("Rueda"), { target: { value: "2" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Simular fecha" })[1]);
    await waitFor(() => expect(new LocalStorageTournamentRepository(false).findAll()[0].matchdays.every(d => d.fixtures[0].result)).toBe(true));
    const stored = new LocalStorageTournamentRepository(false).findAll()[0];
    expect(stored.teams.map(t => t.name)).toEqual(["Equipo Alfa", "Equipo Beta"]);
    expect(stored.pointsSystem).toEqual({ win: 5, draw: 2, loss: 0 });
    expect(stored.matchdays).toHaveLength(2); expect(stored.matchdays.every(d => d.fixtures[0].result)).toBe(true);
    expect(await screen.findByRole("region", { name: "Estadísticas del campeonato" })).toBeInTheDocument();
  }, 15000);

  it("simulates only the selected round-robin leg when pressing Simular rueda", async () => {
    const twoLegs: Tournament = { ...saved, legs: 2, matchdays: [...saved.matchdays,
      { number: 2, leg: 2, fixtures: [{ id: "return", homeTeamId: "b", awayTeamId: "a" }] }] };
    localStorage.setItem("cancha.tournaments", JSON.stringify([twoLegs]));
    await renderApplication(<App />);
    await screen.findByRole("group", { name: "Club A contra Club B" });
    fireEvent.change(screen.getByLabelText("Rueda"), { target: { value: "2" } });
    click("Simular rueda");
    await waitFor(() => expect(new LocalStorageTournamentRepository(false).findAll()[0].matchdays[1].fixtures[0].result).toBeDefined());
    const stored = new LocalStorageTournamentRepository(false).findAll()[0];
    expect(stored.matchdays[0].fixtures[0].result).toBeUndefined();
    expect(stored.matchdays[1].fixtures[0].result).toBeDefined();
  });

  it.each([false, true])("separates unsaved results by tournament, including separator-bearing IDs: %s", async withSeparators => {
    const firstSource = withSeparators ? { ...saved, id: "journey:part" } : saved;
    const other = { ...saved, id: withSeparators ? "journey" : "other-2026", name: "Otra liga",
      matchdays: saved.matchdays.map(d => ({ ...d, fixtures: d.fixtures.map(f => ({ ...f, id: withSeparators ? "part:game" : f.id })) })) };
    localStorage.setItem("cancha.tournaments", JSON.stringify([firstSource, other]));
    await renderApplication(<App />);
    const first = await screen.findByRole("group", { name: "Club A contra Club B" });
    fireEvent.change(within(first).getAllByRole("spinbutton")[0], { target: { value: "6" } });
    click("Biblioteca");
    fireEvent.click(within(await screen.findByRole("listitem", { name: "Otra liga" })).getByRole("button", { name: "Abrir torneo" }));
    const second = await screen.findByRole("group", { name: "Club A contra Club B" });
    expect(within(second).getAllByRole("spinbutton")[0]).toHaveValue(null);
    click("Biblioteca");
    fireEvent.click(within(await screen.findByRole("listitem", { name: "Liga recorrido" })).getByRole("button", { name: "Abrir torneo" }));
    const returned = await screen.findByRole("group", { name: "Club A contra Club B" });
    expect(within(returned).getAllByRole("spinbutton")[0]).toHaveValue(6);
  });
  it("discards an obsolete score draft when the stored match changes while the user is in the library", async () => {
    localStorage.setItem("cancha.tournaments", JSON.stringify([saved])); await renderApplication(<App />);
    const first = await screen.findByRole("group", { name: "Club A contra Club B" });
    fireEvent.change(within(first).getAllByRole("spinbutton")[0], { target: { value: "9" } });
    click("Biblioteca");
    new LocalStorageTournamentRepository(false).save({ ...saved, matchdays: [{ ...saved.matchdays[0],
      fixtures: [{ ...saved.matchdays[0].fixtures[0], result: { homeGoals: 2, awayGoals: 1 } }] }] });
    click(/Volver al torneo activo/);
    const returned = await screen.findByRole("group", { name: "Club A contra Club B" });
    expect(within(returned).getAllByRole("spinbutton")[0]).toHaveValue(2);
    expect(within(returned).getAllByRole("spinbutton")[1]).toHaveValue(1);
  });

  it("creates a universe, incorporates one legacy tournament, and scopes the library and competition center", async () => {
    const other = { ...saved, id: "another-season", name: "Otra liga", season: 2025 };
    localStorage.setItem("cancha.tournaments", JSON.stringify([saved, other]));
    await renderApplication(<App />);
    click("Biblioteca");

    fireEvent.click(screen.getByText("Crear universo"));
    fireEvent.change(screen.getAllByLabelText("Nombre")[0], { target: { value: "Simulación" } });
    fireEvent.change(screen.getByLabelText("Descripción opcional"), { target: { value: "Escenario de prueba" } });
    click("Crear y activar universo");

    await waitFor(() => expect(localStorage.getItem("cancha.sportsUniverses")).not.toBeNull());
    const universeId = JSON.parse(localStorage.getItem("cancha.sportsUniverses")!).activeUniverseId as string;
    const universeSelect = screen.getByRole("combobox", { name: "Universo activo" });
    await waitFor(() => expect(universeSelect).toHaveValue(universeId));
    fireEvent.click(screen.getByText(/Incorporar torneos existentes/));
    const firstCheckbox = screen.getByRole("checkbox", { name: "Liga recorrido · 2026" });
    fireEvent.click(firstCheckbox);
    click("Incorporar seleccionados");
    click("Confirmar");

    expect(await screen.findByRole("listitem", { name: "Liga recorrido" })).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: "Otra liga" })).not.toBeInTheDocument();
    click("Centro de competiciones y temporadas");
    expect(screen.getAllByRole("combobox", { name: "Universo activo" })).toHaveLength(2);
    fireEvent.change(screen.getAllByRole("combobox", { name: "Universo activo" })[1], {
      target: { value: "" },
    });
    expect(await screen.findByRole("listitem", { name: "Otra liga" })).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: "Liga recorrido" })).not.toBeInTheDocument();
  });

  it("assigns newly created tournaments to the active universe", async () => {
    await renderApplication(<App />);
    fireEvent.click(screen.getByText("Crear universo"));
    fireEvent.change(screen.getAllByLabelText("Nombre")[0], { target: { value: "Escenario activo" } });
    click("Crear y activar universo");

    await waitFor(() => expect(localStorage.getItem("cancha.sportsUniverses")).not.toBeNull());
    const library = JSON.parse(localStorage.getItem("cancha.sportsUniverses")!);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Universo activo" }))
      .toHaveValue(library.activeUniverseId));
    await setup();
    fireEvent.change(screen.getByLabelText("Nombre del campeonato"), {
      target: { value: "Torneo del escenario" },
    });
    click("Crear campeonato");

    await screen.findByRole("button", { name: "Centro de calendario" });
    const tournaments = JSON.parse(localStorage.getItem("cancha.tournaments")!) as Tournament[];
    const savedUniverses = JSON.parse(localStorage.getItem("cancha.sportsUniverses")!);
    expect(tournaments).toHaveLength(1);
    expect(savedUniverses.assignments[tournaments[0].id]).toBe(library.activeUniverseId);
  });

  it("cancels a pending organization confirmation when switching universes", async () => {
    localStorage.setItem("cancha.tournaments", JSON.stringify([saved]));
    await renderApplication(<App />);
    click("Biblioteca");

    async function createUniverse(name: string) {
      fireEvent.click(screen.getByText("Crear universo"));
      fireEvent.change(screen.getAllByLabelText("Nombre")[0], { target: { value: name } });
      await act(async () => { click("Crear y activar universo"); });
      await waitFor(() => { const next = JSON.parse(localStorage.getItem("cancha.sportsUniverses") ?? "null"); expect(next?.universes.find((u: {id: string; name: string}) => u.id === next.activeUniverseId)?.name).toBe(name); });
      const current = JSON.parse(localStorage.getItem("cancha.sportsUniverses")!);
      await waitFor(() => expect(screen.getByRole("combobox", { name: "Universo activo" }))
        .toHaveValue(current.activeUniverseId));
      return current.activeUniverseId as string;
    }

    const firstId = await createUniverse("Partida A");
    const secondId = await createUniverse("Partida B");
    const selector = screen.getByRole("combobox", { name: "Universo activo" });
    await act(async () => { fireEvent.change(selector, { target: { value: firstId } }); });
    await waitFor(() => expect(screen.getByRole("combobox", {name: "Universo activo"})).toHaveValue(firstId));
    fireEvent.click(screen.getByText(/Incorporar torneos existentes/));
    fireEvent.click(screen.getByRole("checkbox", { name: "Liga recorrido · 2026" }));
    click("Incorporar seleccionados");
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Universo activo" }), {
      target: { value: secondId },
    });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Confirmar" })).not.toBeInTheDocument());
    expect(JSON.parse(localStorage.getItem("cancha.sportsUniverses")!).assignments).toEqual({});
  });

  it("opens the universe dashboard from the library and follows a recommendation without writing results", async () => {
    localStorage.setItem("cancha.tournaments", JSON.stringify([saved]));
    await renderApplication(<App />);
    click("Biblioteca");
    await screen.findByRole("heading", { name: "Biblioteca de torneos" });
    click("Panel principal del universo");
    const dashboard = await screen.findByRole("region", { name: "Panel del universo deportivo" });
    expect(within(dashboard).getByRole("heading", {
      name: "Biblioteca anterior · sin asignar",
    })).toBeInTheDocument();
    expect(within(dashboard).getByText("Temporadas", { exact: true })).toBeInTheDocument();
    const storageBefore = localStorage.getItem("cancha.tournaments");
    const recommendation = within(dashboard).getByText(/Completar o revisar partidos/).closest("li")!;
    fireEvent.click(within(recommendation).getByRole("button", { name: "Abrir flujo" }));
    await screen.findByRole("button", { name: "Volver al resumen" });
    expect(localStorage.getItem("cancha.tournaments")).toBe(storageBefore);
  });

  it("refreshes the dashboard scope and drops its open state when switching universes", async () => {
    const other = { ...saved, id: "another-season", name: "Otra liga", season: 2025 };
    localStorage.setItem("cancha.tournaments", JSON.stringify([saved, other]));
    localStorage.setItem("cancha.sportsUniverses", JSON.stringify({
      version: 1,
      activeUniverseId: "universe-a",
      universes: [{ id: "universe-a", name: "Partida A" }, { id: "universe-b", name: "Partida B" }],
      assignments: { [saved.id]: "universe-a", [other.id]: "universe-b" },
    }));
    await renderApplication(<App />);
    click("Biblioteca");
    await screen.findByRole("heading", { name: "Biblioteca de torneos" });
    click("Panel principal del universo");
    let dashboard = await screen.findByRole("region", { name: "Panel del universo deportivo" });
    expect(within(dashboard).getByRole("article", { name: /Liga recorrido 2026/ })).toBeInTheDocument();
    expect(within(dashboard).queryByRole("article", { name: /Otra liga/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Universo activo" }), {
      target: { value: "universe-b" },
    });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Panel del universo deportivo" })).not.toBeInTheDocument());
    click("Panel principal del universo");
    dashboard = await screen.findByRole("region", { name: "Panel del universo deportivo" });
    expect(within(dashboard).getByRole("article", { name: /Otra liga 2025/ })).toBeInTheDocument();
    expect(within(dashboard).queryByRole("article", { name: /Liga recorrido/ })).not.toBeInTheDocument();
  });

});

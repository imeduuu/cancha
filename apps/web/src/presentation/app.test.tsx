import { renderApplication } from "../test-utils/render-application";
import { installTestWebLocks } from "../test-utils/web-locks";
// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import { App } from "./app";
import { TournamentLibrary } from "./components/tournament-library";
import { LocalStorageTournamentRepository } from "../infrastructure/persistence/local-storage-tournament-repository";
import type {
  BackupRestoreMode,
  TournamentImportMode,
} from "./components/tournament-library";
import {
  createTournamentArchive,
  createTournamentBackup,
} from "@cancha/core/application/services/tournament-archive";
import {
  duplicateTournament,
  renameTournament,
} from "@cancha/core/application/use-cases/manage-tournaments";
import { importTournamentArchive } from "@cancha/core/application/use-cases/import-tournament-archive";
import { createTournamentSeason } from "@cancha/core/application/use-cases/create-tournament-season";

const tournament: Tournament = {
  id: "league-one",
  name: "Liga Uno",
  season: 2026,
  teams: [
    { id: "team-a", name: "Club A" },
    { id: "team-b", name: "Club B" },
  ],
  legs: 1,
  tieBreakers: ["goalDifference", "goalsFor"],
  pointsSystem: { win: 3, draw: 1, loss: 0 },
  matchdays: [{
    number: 1,
    leg: 1,
    fixtures: [{
      id: "fixture-one",
      homeTeamId: "team-a",
      awayTeamId: "team-b",
      result: { homeGoals: 2, awayGoals: 1 },
    }],
  }],
  createdAt: "2026-01-01T00:00:00.000Z",
};

let exportedBlob: Blob | null;
let exportedFileName: string;
let originalCreateObjectUrl: PropertyDescriptor | undefined;
let originalShowModal: PropertyDescriptor | undefined;
let originalDialogClose: PropertyDescriptor | undefined;

function createJsonFile(name: string, contents: string): File {
  const file = new File([contents], name, { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => contents });
  return file;
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });
}

function getFixtureGroup(): HTMLElement {
  const group = screen.getAllByRole("group").find((candidate) =>
    candidate.getAttribute("aria-label")?.includes(" contra "),
  );
  if (!group) throw new Error("No se encontró un grupo accesible de partido.");
  fireEvent.click(within(group).getByText("Detalle"));
  return group;
}

function LibraryHarness({ initialTournaments }: { initialTournaments: Tournament[] }) {
  const [repository] = React.useState(() => {
    const current = new LocalStorageTournamentRepository(false);
    initialTournaments.forEach((saved) => current.save(saved));
    return current;
  });
  const [tournaments, setTournaments] = React.useState(() => repository.findAll());
  const [activeTournamentId, setActiveTournamentId] = React.useState<string | null>(null);

  function refresh() {
    setTournaments(repository.findAll());
  }

  function handleDuplicate(saved: Tournament, mode: "copy" | "reset") {
    duplicateTournament(saved, mode, repository, () => new Date("2026-03-01T00:00:00.000Z"));
    refresh();
  }

  function handleRename(saved: Tournament, name: string) {
    renameTournament(saved, name, repository);
    refresh();
  }

  function handleDelete(saved: Tournament) {
    repository.deleteById(saved.id);
    if (activeTournamentId === saved.id) setActiveTournamentId(null);
    refresh();
  }

  function handleImport(saved: Tournament, mode: TournamentImportMode) {
    const imported = importTournamentArchive(saved, mode, repository);
    refresh();
    return imported ?? undefined;
  }

  function handleRestore(saved: readonly Tournament[], mode: BackupRestoreMode) {
    const result = repository.importTournaments(saved, mode);
    refresh();
    return result;
  }

  function handleCreateSeason(saved: Tournament, season: number, includeSquad: boolean) {
    let id = 0;
    const created = createTournamentSeason(
      saved,
      season,
      repository,
      () => `season-${season}-${++id}`,
      () => new Date("2026-10-14T00:00:00.000Z"),
      includeSquad,
    );
    setActiveTournamentId(created.id);
    refresh();
    return created;
  }

  return (
    <>
      <p>Activo: {tournaments.find(({ id }) => id === activeTournamentId)?.name ?? "ninguno"}</p>
      <TournamentLibrary
        activeTournamentId={activeTournamentId}
        loading={false}
        tournaments={tournaments}
        onOpen={(saved) => setActiveTournamentId(saved.id)}
        onOpenCalendar={(saved) => setActiveTournamentId(saved.id)}
        onOpenAlerts={(saved) => setActiveTournamentId(saved.id)}
        onCreate={() => undefined}
        onDuplicate={handleDuplicate}
        onRename={handleRename}
        onDelete={handleDelete}
        onSetArchived={(saved, archived) => {
          const updated = { ...saved, archived };
          repository.save(updated);
          refresh();
        }}
        onCreateSeason={handleCreateSeason}
        onImportTournament={handleImport}
        onRestoreBackup={handleRestore}
      />
    </>
  );
}

beforeEach(() => {
  installTestWebLocks();
  localStorage.clear();
  exportedBlob = null;
  exportedFileName = "";
  originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
  originalDialogClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn((blob: Blob) => {
      exportedBlob = blob;
      return "blob:test-export";
    }),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click(
    this: HTMLAnchorElement,
  ) {
    exportedFileName = this.download;
  });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function close(this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalCreateObjectUrl) {
    Object.defineProperty(URL, "createObjectURL", originalCreateObjectUrl);
  } else {
    Reflect.deleteProperty(URL, "createObjectURL");
  }
  if (originalShowModal) {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShowModal);
  } else {
    Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  }
  if (originalDialogClose) {
    Object.defineProperty(HTMLDialogElement.prototype, "close", originalDialogClose);
  } else {
    Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  }
});

describe("simulator UI integration", () => {
  it("shows global navigation, a compact tournament selector, and active section tabs", async () => {
    localStorage.setItem("cancha.tournaments", JSON.stringify([tournament]));
    localStorage.setItem("cancha.activeTournamentId", tournament.id);
    await renderApplication(<App />);

    expect(screen.getByRole("button", { name: "Mis torneos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crear torneo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cuenta" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Torneo activo" })).toHaveTextContent("Liga Uno");
    expect(screen.getByRole("combobox", { name: "Cambiar torneo activo" })).toHaveValue("league-one");
    expect(screen.getByRole("button", { name: "Resumen" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Herramientas" })).not.toHaveAttribute("aria-current");
    expect(screen.queryByText("SIMULADOR DE CAMPEONATOS")).not.toBeInTheDocument();
    expect(screen.queryByText("TU TORNEO, TUS REGLAS")).not.toBeInTheDocument();
  });

  it("keeps the library usable and reports an unavailable LocalStorage", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("browser storage unavailable");
    });
    await renderApplication(<App />);

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("No se pudieron leer los campeonatos guardados del navegador.");
    expect(screen.getByRole("heading", { name: "Biblioteca de torneos" })).toBeInTheDocument();
  });

  it("offers a recoverable prior library after replacement and restores it", async () => {
    const repository = new LocalStorageTournamentRepository(false);
    repository.save(tournament);
    repository.importTournaments([{
      ...tournament,
      id: "replacement",
      name: "Biblioteca reemplazada",
    }], "replace");
    const user = userEvent.setup();
    await renderApplication(<App />);

    await user.click(await screen.findByRole("button", { name: "Mis torneos" }));
    await user.click(screen.getByRole("button", { name: /^Centro de guardado y recuperación$/ }));
    await user.click(await screen.findByRole("button", { name: "Recuperar estado anterior" }));
    await user.click(await screen.findByRole("button", { name: "Restaurar copia local" }));

    expect(await screen.findByRole("heading", { name: "Liga Uno" })).toBeInTheDocument();
    expect(repository.findAll().map(({ id }) => id)).toEqual(["league-one"]);
    expect(screen.queryByRole("button", { name: "Recuperar estado anterior" })).not.toBeInTheDocument();
  });

  it("treats a preserved postponed score as unresolved in the next-match navigation", async () => {
    const postponedTournament: Tournament = {
      ...tournament,
      matchdays: [{
        ...tournament.matchdays[0],
        fixtures: [{
          ...tournament.matchdays[0].fixtures[0],
          operationalState: {
            status: "postponed",
            updatedAt: "2026-10-14T18:00:00.000Z",
          },
        }],
      }],
    };
    localStorage.setItem("cancha.tournaments", JSON.stringify([postponedTournament]));
    await renderApplication(<App />);

    expect(await screen.findByText("Siguiente sin resolver · Fecha 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ir al siguiente partido pendiente" }))
      .toBeEnabled();
  });

  it("opens the audit history from the library and from a match card", async () => {
    const user = userEvent.setup();
    localStorage.setItem("cancha.tournaments", JSON.stringify([tournament]));
    await renderApplication(<App />);

    await user.click((await screen.findAllByRole("button", { name: "Historial de actividad" }))[0]);
    expect(screen.getByRole("heading", { name: "Historial de actividad" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cerrar historial" }));
    await user.click(screen.getByRole("button", { name: "Mis torneos" }));
    await user.click(await screen.findByRole("button", { name: "Auditoría" }));
    expect(screen.getByRole("heading", { name: "Historial de actividad" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cerrar historial" }));
    await user.click(screen.getByRole("button", { name: /Volver al torneo activo/ }));
    const fixture = getFixtureGroup();
    await user.click(within(fixture).getByRole("button", { name: "Historial del partido" }));
    expect(screen.getByRole("heading", { name: "Actividad del partido" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Todavía no hay actividad registrada");
  }, 10000);

  it("creates a league through the form, generates its schedule, simulates and edits a result", async () => {
    const user = userEvent.setup();
    await renderApplication(<App />);

    expect(await screen.findByRole("heading", { name: "Aún no tienes torneos guardados" }))
      .toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Crear o importar torneo" }));
    const nameInput = screen.getByRole("textbox", { name: /Nombre del campeonato/ });
    await user.clear(nameInput);
    await user.type(nameInput, "Campeonato UI");
    const legsInput = screen.getByRole("spinbutton", {
      name: "Ruedas (veces que se enfrentan entre sí)",
    });
    await user.clear(legsInput);
    await user.type(legsInput, "1");
    expect(screen.queryByRole("option", { name: "Enfrentamiento directo · minitabla completa (legado)" }))
      .not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Crear campeonato/ }));

    expect(await screen.findByRole("heading", { name: "Campeonato UI" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Fecha 03" })).toBeInTheDocument();
    expect(screen.getByText(/Desempates: Puntos.*Diferencia de goles → Goles a favor/))
      .toBeInTheDocument();
    const fixture = getFixtureGroup();
    await user.click(within(fixture).getByRole("button", { name: "Simular" }));
    await waitFor(() => expect(within(fixture).getByText(/\d+ — \d+/)).toBeInTheDocument());

    const goalInputs = within(fixture).getAllByRole("spinbutton");
    await user.clear(goalInputs[0]);
    await user.type(goalInputs[0], "4");
    await user.clear(goalInputs[1]);
    await user.type(goalInputs[1], "1");
    await user.click(within(fixture).getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("Resultado guardado.")).toBeInTheDocument();
    expect(await screen.findByText(/Cambio guardado en este dispositivo/)).toBeInTheDocument();
    expect(within(fixture).getByText("4 — 1")).toBeInTheDocument();

    const matchup = fixture.getAttribute("aria-label") ?? "";
    const [homeTeam, awayTeam] = matchup.split(" contra ");
    const standings = screen.getByRole("region", { name: "Tabla de posiciones" });
    const homeRow = within(standings).getByRole("row", { name: new RegExp(homeTeam) });
    const awayRow = within(standings).getByRole("row", { name: new RegExp(awayTeam) });
    const homeCells = within(homeRow).getAllByRole("cell");
    const awayCells = within(awayRow).getAllByRole("cell");
    expect(homeCells[homeCells.length - 1]).toHaveTextContent("3");
    expect(awayCells[awayCells.length - 1]).toHaveTextContent("0");

    await user.clear(goalInputs[0]);
    await user.type(goalInputs[0], "0");
    await user.clear(goalInputs[1]);
    await user.type(goalInputs[1], "2");
    await user.click(within(fixture).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(within(fixture).getByText("0 — 2")).toBeInTheDocument());
    const updatedStandings = screen.getByRole("region", { name: "Tabla de posiciones" });
    const updatedHomeCells = within(within(updatedStandings)
      .getByRole("row", { name: new RegExp(homeTeam) }))
      .getAllByRole("cell");
    const updatedAwayCells = within(within(updatedStandings)
      .getByRole("row", { name: new RegExp(awayTeam) }))
      .getAllByRole("cell");
    expect(updatedHomeCells[updatedHomeCells.length - 1]).toHaveTextContent("0");
    expect(updatedAwayCells[updatedAwayCells.length - 1]).toHaveTextContent("3");

    const repository = new LocalStorageTournamentRepository(false);
    expect(repository.findAll()[0].matchdays[0].fixtures[0].result)
      .toEqual({ homeGoals: 0, awayGoals: 2 });
    expect(repository.getActiveTournamentId()).toBe(repository.findAll()[0].id);

    cleanup();
    await renderApplication(<App />);
    expect(await screen.findByRole("heading", { name: "Campeonato UI" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Torneo activo" })).toHaveTextContent("Campeonato UI");
    expect(screen.queryByRole("heading", { name: /El campeonato lo armas tú/ })).not.toBeInTheDocument();
  }, 10_000);

  it("switches active tournaments from the library and persists the selected tournament", async () => {
    const repository = new LocalStorageTournamentRepository(false);
    const second = { ...tournament, id: "league-two", name: "Liga Dos" };
    repository.save(tournament);
    repository.save(second);
    repository.setActiveTournamentId(tournament.id);
    const user = userEvent.setup();
    await renderApplication(<App />);

    expect(await screen.findByRole("heading", { name: "Liga Uno" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mis torneos" }));
    const secondCard = screen.getByRole("listitem", { name: /Liga Dos/ });
    await user.click(within(secondCard).getByRole("button", { name: "Abrir torneo" }));
    expect(await screen.findByRole("heading", { name: "Liga Dos" })).toBeInTheDocument();
    expect(repository.getActiveTournamentId()).toBe(second.id);

    cleanup();
    await renderApplication(<App />);
    expect(await screen.findByRole("heading", { name: "Liga Dos" })).toBeInTheDocument();
  });

  it("updates the statistics when switching the active tournament from the panel", async () => {
    const repository = new LocalStorageTournamentRepository(false);
    const second: Tournament = {
      ...tournament,
      id: "league-two-stats",
      name: "Liga Dos",
      matchdays: [{
        ...tournament.matchdays[0],
        fixtures: [{
          ...tournament.matchdays[0].fixtures[0],
          result: { homeGoals: 4, awayGoals: 0 },
        }],
      }],
    };
    repository.save(tournament);
    repository.save(second);
    repository.setActiveTournamentId(tournament.id);
    const user = userEvent.setup();
    await renderApplication(<App />);

    await screen.findByRole("heading", { name: "Liga Uno" });
    expect(screen.getByRole("region", { name: "Estadísticas del campeonato" }))
      .toHaveTextContent("3.00 por partido jugado");
    await user.selectOptions(screen.getByRole("combobox", {
      name: "Torneo activo para estadísticas",
    }), second.id);
    expect(await screen.findByRole("heading", { name: "Liga Dos" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Estadísticas del campeonato" }))
      .toHaveTextContent("4.00 por partido jugado");
    expect(repository.getActiveTournamentId()).toBe(second.id);
  });

  it("edits scorer records independently and recalculates statistics after a score edit", async () => {
    const repository = new LocalStorageTournamentRepository(false);
    repository.save(tournament);
    repository.setActiveTournamentId(tournament.id);
    const user = userEvent.setup();
    await renderApplication(<App />);
    await screen.findByRole("heading", { name: "Liga Uno" });
    const statistics = screen.getByRole("region", { name: "Estadísticas del campeonato" });
    expect(statistics).toHaveTextContent("Todavía no hay información suficiente");

    const fixture = screen.getByRole("group", { name: "Club A contra Club B" });
    await user.click(within(fixture).getByText("Detalle"));
    await user.click(within(fixture).getByText("Autores de goles (0)"));
    await user.type(within(fixture).getByRole("textbox", { name: "Nombre del nuevo autor" }), "Jugador A");
    await user.type(within(fixture).getByRole("spinbutton", { name: "Minuto del nuevo autor" }), "20");
    await user.click(within(fixture).getByRole("button", { name: "Agregar gol" }));
    await user.click(within(fixture).getByRole("button", { name: "Guardar autores" }));
    expect(await screen.findByRole("status"))
      .toHaveTextContent("El marcador se mantuvo sin cambios");
    expect(repository.findAll()[0].matchdays[0].fixtures[0].result)
      .toEqual({ homeGoals: 2, awayGoals: 1 });
    expect(statistics).toHaveTextContent("Jugador A");
    expect(statistics).toHaveTextContent("1 autores registrados y 3 goles computados");

    await user.clear(within(fixture).getByRole("textbox", { name: "Nombre del autor 1" }));
    await user.type(within(fixture).getByRole("textbox", { name: "Nombre del autor 1" }), "Jugador Editado");
    await user.click(within(fixture).getByRole("button", { name: "Guardar autores" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Autores de goles guardados");
    expect(statistics).toHaveTextContent("Jugador Editado");
    expect(statistics).not.toHaveTextContent("Jugador A");

    const scoreInputs = within(fixture).getAllByRole("spinbutton");
    await user.clear(scoreInputs[0]);
    await user.type(scoreInputs[0], "1");
    await user.clear(scoreInputs[1]);
    await user.type(scoreInputs[1], "1");
    await user.click(within(fixture).getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Resultado guardado");
    expect(statistics).toHaveTextContent("2.00 por partido jugado");
    expect(repository.findAll()[0].matchdays[0].fixtures[0].result)
      .toEqual({ homeGoals: 1, awayGoals: 1 });
  });

  it("manages a seasonal roster and selects a registered player as a goal scorer", async () => {
    const repository = new LocalStorageTournamentRepository(false);
    repository.save(tournament);
    repository.setActiveTournamentId(tournament.id);
    const user = userEvent.setup();
    await renderApplication(<App />);
    await screen.findByRole("heading", { name: "Liga Uno" });

    await user.type(screen.getByRole("textbox", { name: "Nombre del jugador" }), "Alex");
    await user.type(screen.getByRole("textbox", { name: "Apellidos del jugador" }), "Jugador");
    await user.click(screen.getByRole("button", { name: "Crear jugador" }));
    const player = repository.findAll()[0].players?.[0];
    expect(player).toMatchObject({ firstName: "Alex", lastName: "Jugador" });

    await user.selectOptions(screen.getByRole("combobox", { name: "Equipo para plantilla" }), "team-a");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Jugador para agregar a plantilla" }),
      player?.id ?? "",
    );
    await user.type(screen.getByRole("spinbutton", { name: "Número de camiseta" }), "9");
    await user.click(screen.getByRole("button", { name: "Agregar a plantilla" }));
    expect(repository.findAll()[0].playerRegistrations)
      .toEqual([{ playerId: player?.id, teamId: "team-a", shirtNumber: 9, status: "active" }]);

    const fixture = screen.getByRole("group", { name: "Club A contra Club B" });
    await user.click(within(fixture).getByText("Autores de goles (0)"));
    await user.selectOptions(
      within(fixture).getByRole("combobox", { name: "Jugador registrado del nuevo autor" }),
      player?.id ?? "",
    );
    await user.click(within(fixture).getByRole("button", { name: "Agregar gol" }));
    await user.click(within(fixture).getByRole("button", { name: "Guardar autores" }));

    const saved = repository.findAll()[0];
    expect(saved.matchdays[0].fixtures[0].goalScorers?.[0])
      .toMatchObject({ playerId: player?.id, playerName: "Alex Jugador", teamId: "team-a" });
    expect(saved.matchdays[0].fixtures[0].result).toEqual({ homeGoals: 2, awayGoals: 1 });
    expect(screen.getByRole("region", { name: "Estadísticas del campeonato" }))
      .toHaveTextContent("Apariciones, asistencias, tarjetas y minutos no se calculan");
  });

  it("advances an elimination round and clears dependent results when an earlier winner changes", async () => {
    const cup: Tournament = {
      id: "cup-ui",
      name: "Copa UI",
      teams: [
        { id: "team-a", name: "Club A" },
        { id: "team-b", name: "Club B" },
        { id: "team-c", name: "Club C" },
        { id: "team-d", name: "Club D" },
      ],
      legs: 3,
      tieBreakers: [],
      matchdays: [
        {
          number: 1,
          leg: 1,
          phaseName: "Copa UI · Cuartos",
          fixtures: [
            {
              id: "qf-a-b",
              homeTeamId: "team-a",
              awayTeamId: "team-b",
              result: { homeGoals: 2, awayGoals: 0 },
            },
            {
              id: "qf-c-d",
              homeTeamId: "team-c",
              awayTeamId: "team-d",
              result: { homeGoals: 1, awayGoals: 0 },
            },
          ],
        },
        { number: 1, leg: 2, phaseName: "Copa UI · Semifinales", fixtures: [] },
        { number: 1, leg: 3, phaseName: "Copa UI · Final", fixtures: [] },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
      format: "staged",
      competitionType: "cup",
      knockoutStages: [
        { name: "Copa UI · Cuartos", legs: 1 },
        { name: "Copa UI · Semifinales", legs: 1 },
        { name: "Copa UI · Final", legs: 1 },
      ],
    };
    const repository = new LocalStorageTournamentRepository(false);
    repository.save(cup);
    repository.setActiveTournamentId(cup.id);
    const user = userEvent.setup();
    await renderApplication(<App />);

    await screen.findByRole("heading", { name: "Copa UI" });
    const phaseSelector = screen.getByRole("combobox", { name: "Etapa" });
    expect(phaseSelector).toHaveValue("2");
    const semifinal = screen.getByRole("group", { name: "Club A contra Club C" });
    const semifinalScores = within(semifinal).getAllByRole("spinbutton");
    await user.clear(semifinalScores[0]);
    await user.type(semifinalScores[0], "2");
    await user.clear(semifinalScores[1]);
    await user.type(semifinalScores[1], "0");
    await user.click(within(semifinal).getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Resultado guardado.");

    await user.selectOptions(phaseSelector, "3");
    expect(await screen.findByText("Los cruces de esta etapa se definirán al completar la ronda anterior."))
      .toBeInTheDocument();

    await user.selectOptions(phaseSelector, "1");
    const quarterfinal = screen.getByRole("group", { name: "Club A contra Club B" });
    const qfScores = within(quarterfinal).getAllByRole("spinbutton");
    await user.clear(qfScores[0]);
    await user.type(qfScores[0], "0");
    await user.clear(qfScores[1]);
    await user.type(qfScores[1], "1");
    await user.click(within(quarterfinal).getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Resultado guardado.");

    await user.selectOptions(phaseSelector, "2");
    const rebuiltSemifinal = await screen.findByRole("group", { name: "Club B contra Club C" });
    expect(within(rebuiltSemifinal).getByRole("spinbutton", { name: "Goles de Club B" }))
      .toHaveValue(null);
    expect(within(rebuiltSemifinal).getByRole("spinbutton", { name: "Goles de Club C" }))
      .toHaveValue(null);
    expect(repository.findAll()[0].matchdays.find(({ phaseName }) =>
      phaseName === "Copa UI · Final")?.fixtures).toEqual([]);
  });

  it("keeps cup qualifications and relegation averages visibly pending when rules or data are missing", async () => {
    const configured: Tournament = {
      ...tournament,
      competitionRules: {
        season: 2026,
        verification: { standings: "pending", placements: "pending" },
        internationalQualification: {
          verification: "pending",
          slots: [{ destination: "Copa Internacional", position: 1 }],
          cupChampions: [{
            sourceTournamentId: "cup-not-imported",
            destination: "Copa Internacional",
          }],
        },
        relegationAverage: {
          verification: "pending",
          seasons: [2024, 2025, 2026],
          relegatedCount: 1,
        },
      },
    };
    const repository = new LocalStorageTournamentRepository(false);
    repository.save(configured);
    repository.setActiveTournamentId(configured.id);
    await renderApplication(<App />);

    await screen.findByRole("heading", { name: "Liga Uno" });
    expect(screen.getByText(/pendientes de verificar; el orden mostrado es orientativo/))
      .toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Clasificación internacional" }))
      .toHaveTextContent("pendiente");
    const averages = screen.getByRole("region", { name: "Descenso por promedios" });
    expect(averages).toHaveTextContent("descenso pendiente");
    expect(averages).toHaveTextContent("Faltan datos de las temporadas: 2024, 2025");
  });

  it("reports a LocalStorage write error without presenting tournament creation as successful", async () => {
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function setItem(
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === "cancha.activeTournamentId") throw new Error("Storage bloqueado");
      originalSetItem.call(this, key, value);
    });
    const user = userEvent.setup();
    await renderApplication(<App />);
    await user.click(await screen.findByRole("button", { name: "Crear o importar torneo" }));
    await user.click(screen.getByRole("button", { name: /Crear campeonato/ }));
    expect(await screen.findByRole("alert"))
      .toHaveTextContent("No se pudo guardar la selección del campeonato activo.");
    expect(screen.queryByText(/Campeonato guardado y abierto/)).not.toBeInTheDocument();
    expect(screen.getByText(/No se confirmó el último cambio/)).toBeInTheDocument();
    expect(screen.queryByText(/Cambio guardado en este dispositivo/)).not.toBeInTheDocument();
  });

  it("supports library renaming, both duplicate result modes, and confirmed or cancelled deletion", async () => {
    const user = userEvent.setup();
    render(<LibraryHarness initialTournaments={[tournament, { ...tournament, id: "league-two", name: "Liga Dos" }]} />);

    const firstCard = screen.getByRole("listitem", { name: /Liga Uno/ });
    await user.click(within(firstCard).getByRole("button", { name: "Abrir torneo" }));
    expect(screen.getByText("Activo: Liga Uno")).toBeInTheDocument();

    await user.click(within(firstCard).getByRole("button", { name: "Renombrar" }));
    const renameInput = within(firstCard).getByRole("textbox");
    await user.clear(renameInput);
    await user.type(renameInput, "Liga Renombrada");
    await user.click(within(firstCard).getByRole("button", { name: "Guardar nombre" }));
    expect(screen.getByRole("heading", { name: "Liga Renombrada" })).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Resultados de la copia" }), "copy");
    const renamedCard = screen.getByRole("listitem", { name: /Liga Renombrada/ });
    await user.click(within(renamedCard).getByRole("button", { name: "Duplicar" }));
    const copyCard = await screen.findByRole("listitem", { name: /Liga Renombrada \(copia\)/ });
    expect(within(copyCard).getByText("1/1 resultados")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Resultados de la copia" }), "reset");
    await user.click(within(renamedCard).getByRole("button", { name: "Duplicar" }));
    const resetCopy = await screen.findAllByRole("listitem", { name: /Liga Renombrada \(copia\)/ });
    expect(resetCopy.some((card) => within(card).queryByText("0/1 resultados"))).toBe(true);

    const secondCard = screen.getByRole("listitem", { name: /Liga Dos/ });
    await user.click(within(secondCard).getByRole("button", { name: "Eliminar" }));
    const deleteDialog = screen.getByRole("dialog", { name: "¿Eliminar este torneo?" });
    await user.click(within(deleteDialog).getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("listitem", { name: /Liga Dos/ })).toBeInTheDocument();

    await user.click(within(secondCard).getByRole("button", { name: "Eliminar" }));
    const confirmDialog = screen.getByRole("dialog", { name: "¿Eliminar este torneo?" });
    await user.click(within(confirmDialog).getByRole("button", { name: "Sí, eliminar torneo" }));
    await waitFor(() => expect(screen.queryByRole("listitem", { name: /Liga Dos/ })).not.toBeInTheDocument());
  });

  it("creates a new season from the library and archives or restores seasons without losing results", async () => {
    const source: Tournament = {
      ...tournament,
      competitionId: "liga-chilena",
      format: "round-robin",
      competitionType: "league",
    };
    const user = userEvent.setup();
    render(<LibraryHarness initialTournaments={[source]} />);

    const sourceCard = screen.getByRole("listitem", { name: "Liga Uno" });
    await user.click(within(sourceCard).getByRole("button", { name: "Nueva temporada" }));
    await user.type(
      within(sourceCard).getByRole("spinbutton", { name: "Año de nueva temporada para Liga Uno" }),
      "2027",
    );
    await user.click(within(sourceCard).getByRole("button", { name: "Crear y abrir temporada" }));

    const newCard = await screen.findByRole("listitem", { name: /Liga Uno 2027/ });
    expect(within(newCard).getByText("0/1 resultados")).toBeInTheDocument();
    expect(screen.getByText("Activo: Liga Uno 2027")).toBeInTheDocument();
    const repository = new LocalStorageTournamentRepository(false);
    expect(repository.findAll().find(({ id }) => id === source.id)?.matchdays[0].fixtures[0].result)
      .toEqual({ homeGoals: 2, awayGoals: 1 });
    expect(repository.findAll().find(({ id }) => id !== source.id)?.matchdays[0].fixtures[0])
      .not.toHaveProperty("result");

    const oldCard = screen.getByRole("listitem", { name: "Liga Uno" });
    await user.click(within(oldCard).getByRole("button", { name: "Archivar" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Se archivó");
    await user.click(screen.getByRole("button", { name: /Historial/ }));
    const archivedCard = screen.getByRole("listitem", { name: "Liga Uno" });
    expect(within(archivedCard).getByText(/Campeón: Club [AB]/)).toBeInTheDocument();
    await user.click(within(archivedCard).getByRole("button", { name: "Desarchivar" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Se restauró");
    await user.click(screen.getByRole("button", { name: /Torneos activos/ }));
    expect(screen.getByRole("listitem", { name: "Liga Uno" })).toBeInTheDocument();
  });

  it("combines competition search and season and status filters", async () => {
    const notStarted: Tournament = {
      ...tournament,
      id: "league-two",
      name: "Liga Dos",
      season: 2025,
      matchdays: [{
        ...tournament.matchdays[0],
        fixtures: [{
          id: "fixture-pending",
          homeTeamId: "team-a",
          awayTeamId: "team-b",
        }],
      }],
    };
    const user = userEvent.setup();
    render(<LibraryHarness initialTournaments={[tournament, notStarted]} />);

    await user.type(screen.getByRole("searchbox", { name: "Buscar por nombre de competición" }), "dos");
    await user.selectOptions(screen.getByRole("combobox", { name: "Filtrar por temporada" }), "2025");
    await user.selectOptions(screen.getByRole("combobox", { name: "Filtrar por estado" }), "sin-comenzar");
    expect(screen.getByRole("listitem", { name: "Liga Dos" })).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: "Liga Uno" })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Filtrar por estado" }), "finalizado");
    expect(screen.getByText(/No hay torneos que coincidan con la búsqueda y los filtros actuales/))
      .toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("summarizes an archived season and opens it without changing its saved results or archive status", async () => {
    const archived: Tournament = { ...tournament, archived: true };
    const user = userEvent.setup();
    render(<LibraryHarness initialTournaments={[archived]} />);

    await user.click(screen.getByRole("button", { name: /Historial/ }));
    const card = screen.getByRole("listitem", { name: "Liga Uno" });
    await user.click(within(card).getByRole("button", { name: "Ver resumen" }));
    const summary = screen.getByRole("region", { name: "Resumen de Liga Uno" });
    expect(summary).toHaveTextContent("País / confederación");
    expect(summary).toHaveTextContent("No registrado");
    expect(summary).toHaveTextContent("No hay partidos pendientes con estado programado.");
    expect(summary).toHaveTextContent("Campeón");

    await user.click(within(summary).getByRole("button", { name: "Abrir torneo y estadísticas" }));
    expect(screen.getByText("Activo: Liga Uno")).toBeInTheDocument();
    expect(within(screen.getByRole("listitem", { name: "Liga Uno" }))
      .getByText("ARCHIVADO")).toBeInTheDocument();
    expect(new LocalStorageTournamentRepository(false).findAll()[0].matchdays[0].fixtures[0].result)
      .toEqual({ homeGoals: 2, awayGoals: 1 });
  });

  it("opens the selected season calendar and returns to its tournament without switching context", async () => {
    const repository = new LocalStorageTournamentRepository(false);
    repository.save(tournament);
    repository.setActiveTournamentId(tournament.id);
    const user = userEvent.setup();
    await renderApplication(<App />);

    await screen.findByRole("heading", { name: "Liga Uno" });
    await user.click(screen.getByRole("button", { name: "Centro de calendario" }));
    expect(await screen.findByRole("region", { name: "Calendario de Liga Uno" })).toBeInTheDocument();
    const fixture = screen.getByRole("group", { name: "Club A contra Club B" });
    expect(fixture).toBeInTheDocument();
    await user.click(within(fixture).getByText("Detalle"));
    await user.clear(within(fixture).getByRole("spinbutton", { name: "Goles de Club A" }));
    await user.type(within(fixture).getByRole("spinbutton", { name: "Goles de Club A" }), "3");
    await user.click(within(fixture).getByRole("button", { name: "Guardar" }));
    expect(repository.findAll().find(({ id }) => id === tournament.id)
      ?.matchdays[0].fixtures[0].result)
      .toEqual({ homeGoals: 3, awayGoals: 1 });
    expect(repository.getActiveTournamentId()).toBe(tournament.id);

    // Keep an unsaved edit mounted while changing between the summary and lazy calendar.
    fireEvent.change(within(fixture).getByRole("spinbutton", { name: "Goles de Club A" }), { target: { value: "9" } });
    await user.click(screen.getByRole("button", { name: "Volver al torneo" }));
    expect(screen.getByRole("region", { name: "Estadísticas del campeonato" })).toBeInTheDocument();
    expect(repository.getActiveTournamentId()).toBe(tournament.id);
    await user.click(screen.getByRole("button", { name: "Centro de calendario" }));
    const reopened = await screen.findByRole("region", { name: "Calendario de Liga Uno" });
    expect(within(reopened).getByRole("spinbutton", { name: "Goles de Club A" })).toHaveValue(9);
    expect(repository.findAll()[0].matchdays[0].fixtures[0].result?.homeGoals).toBe(3);
  });

  it("opens the calendar from the competition library summary", async () => {
    const repository = new LocalStorageTournamentRepository(false);
    repository.save(tournament);
    repository.setActiveTournamentId(tournament.id);
    const user = userEvent.setup();
    await renderApplication(<App />);

    await screen.findByRole("heading", { name: "Liga Uno" });
    await user.click(screen.getByRole("button", { name: "Mis torneos" }));
    await user.click(await screen.findByRole("button", { name: "Ver resumen" }));
    await user.click(screen.getByRole("button", { name: "Abrir calendario de partidos" }));

    expect(await screen.findByRole("region", { name: "Calendario de Liga Uno" })).toBeInTheDocument();
    expect(repository.getActiveTournamentId()).toBe(tournament.id);
  });

  it("shows real alert counts in the library and opens the related fixture in its season calendar", async () => {
    const repository = new LocalStorageTournamentRepository(false);
    const withSchedule: Tournament = {
      ...tournament,
      matchdays: [{
        ...tournament.matchdays[0],
        fixtures: [{
          ...tournament.matchdays[0].fixtures[0],
          result: undefined,
          schedule: { date: "2099-06-02", time: "18:30" },
        }],
      }],
    };
    repository.save(withSchedule);
    repository.setActiveTournamentId(withSchedule.id);
    const user = userEvent.setup();
    await renderApplication(<App />);

    await screen.findByRole("heading", { name: "Liga Uno" });
    await user.click(screen.getByRole("button", { name: "Mis torneos" }));
    const card = screen.getByRole("listitem", { name: "Liga Uno" });
    expect(within(card).getByLabelText("Alertas de Liga Uno")).toHaveTextContent("Incidencias: 2");
    expect(within(card).getByLabelText("Alertas de Liga Uno")).toHaveTextContent("Informativas 2");
    await user.click(within(card).getByRole("button", { name: "Ver resumen" }));
    const summary = screen.getByRole("region", { name: "Resumen de Liga Uno" });
    await user.click(within(summary).getByRole("button", { name: "Centro de alertas" }));

    const alertCenter = await screen.findByRole("region", { name: "Alertas de Liga Uno" });
    expect(alertCenter).toHaveTextContent("Próximo partido pendiente");
    await user.click(within(alertCenter).getByRole("button", { name: "Abrir partido" }));
    expect(await screen.findByRole("region", { name: "Calendario de Liga Uno" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Club A contra Club B" })).toBeInTheDocument();
    expect(repository.getActiveTournamentId()).toBe(withSchedule.id);
  });

  it("navigates from a regulation alert to the editable regulation section", async () => {
    const repository = new LocalStorageTournamentRepository(false);
    const withPendingRules: Tournament = {
      ...tournament,
      matchRegulations: { schemaVersion: 1, season: 2026, verification: "pending" },
    };
    repository.save(withPendingRules);
    repository.setActiveTournamentId(withPendingRules.id);
    const user = userEvent.setup();
    await renderApplication(<App />);

    await screen.findByRole("heading", { name: "Liga Uno" });
    await user.click(screen.getByRole("button", { name: "Centro de alertas" }));
    const alertCenter = await screen.findByRole("region", { name: "Alertas de Liga Uno" });
    await user.click(within(alertCenter).getByRole("button", { name: "Revisar reglamento" }));

    await waitFor(() => expect(document.getElementById("match-regulations-editor"))
      .toHaveAttribute("open"));
    const regulationsEditor = document.getElementById("match-regulations-editor");
    expect(regulationsEditor).toHaveTextContent("Verificación");
  });

  it("confirms operational transitions and keeps the existing score and events", async () => {
    const repository = new LocalStorageTournamentRepository(false);
    const withEvent: Tournament = {
      ...tournament,
      matchdays: tournament.matchdays.map((matchday) => ({
        ...matchday,
        fixtures: matchday.fixtures.map((fixture) => ({
          ...fixture,
          events: [{
            id: "goal-ui",
            type: "goal",
            teamId: fixture.homeTeamId,
            playerName: "Goleador",
          }],
        })),
      })),
    };
    repository.save(withEvent);
    repository.setActiveTournamentId(withEvent.id);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    await renderApplication(<App />);

    await screen.findByRole("heading", { name: "Liga Uno" });
    const fixture = screen.getByRole("group", { name: "Club A contra Club B" });
    await user.selectOptions(
      within(fixture).getByRole("combobox", { name: "Estado operativo de Club A contra Club B" }),
      "suspended",
    );
    await user.click(within(fixture).getByRole("button", { name: "Confirmar estado" }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("El marcador, las alineaciones"));
    await waitFor(() => {
      const updatedFixture = repository.findAll()[0].matchdays[0].fixtures[0];
      expect(updatedFixture.operationalState?.status).toBe("suspended");
      expect(updatedFixture.result).toEqual({ homeGoals: 2, awayGoals: 1 });
      expect(updatedFixture.events).toEqual(withEvent.matchdays[0].fixtures[0].events);
    });
    expect(screen.getByRole("region", { name: "Estadísticas del campeonato" }))
      .toHaveTextContent("1 suspendidos");
  });

  it("persists local date, time and venue from the calendar without changing the result", async () => {
    const repository = new LocalStorageTournamentRepository(false);
    repository.save(tournament);
    repository.setActiveTournamentId(tournament.id);
    const user = userEvent.setup();
    await renderApplication(<App />);

    await screen.findByRole("heading", { name: "Liga Uno" });
    await user.click(screen.getByRole("button", { name: "Centro de calendario" }));
    const fixture = screen.getByRole("group", { name: "Club A contra Club B" });
    await user.click(within(fixture).getByText("Alineaciones y eventos"));
    await user.click(within(fixture).getByText("Programación del partido"));
    fireEvent.change(within(fixture).getByLabelText("Fecha del partido Club A contra Club B"), {
      target: { value: "2026-10-14" },
    });
    fireEvent.change(within(fixture).getByLabelText("Hora del partido Club A contra Club B"), {
      target: { value: "21:42" },
    });
    await user.type(within(fixture).getByLabelText("Estadio del partido Club A contra Club B"), " Estadio Norte ");
    await user.click(within(fixture).getByRole("button", { name: "Guardar programación" }));

    const savedFixture = repository.findAll().find(({ id }) => id === tournament.id)
      ?.matchdays[0].fixtures[0];
    expect(savedFixture?.schedule).toEqual({
      date: "2026-10-14",
      time: "21:42",
      venue: "Estadio Norte",
      provenance: "manual",
    });
    expect(savedFixture?.result).toEqual({ homeGoals: 2, awayGoals: 1 });
  });

  it("does not report a full schedule as a finalized cup when a configured final is not scheduled", async () => {
    const cup: Tournament = {
      ...tournament,
      id: "cup-in-progress",
      name: "Copa en curso",
      competitionId: "copa",
      competitionType: "cup",
      format: "staged",
      knockoutStages: [{ name: "Final", legs: 1 }],
      matchdays: [{
        number: 1,
        leg: 1,
        phaseName: "Fase de grupos",
        fixtures: [{
          id: "group-match",
          homeTeamId: "team-a",
          awayTeamId: "team-b",
          result: { homeGoals: 1, awayGoals: 0 },
        }],
      }],
    };
    const user = userEvent.setup();
    render(<LibraryHarness initialTournaments={[cup]} />);

    const card = screen.getByRole("listitem", { name: "Copa en curso" });
    expect(within(card).getByText("Indeterminado")).toBeInTheDocument();
    expect(within(card).getByText("100% de partidos programados")).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Ver resumen" }));
    const summary = screen.getByRole("region", { name: "Resumen de Copa en curso" });
    expect(summary).toHaveTextContent("no representa etapas futuras que aún no estén cargadas");
    expect(summary).toHaveTextContent("El formato o las etapas pendientes no permiten confirmar el campeón");
    expect(summary).toHaveTextContent("Sin partidos programados");
  });

  it("withholds round-robin progress when the saved schedule is incomplete", () => {
    const incompleteLeague: Tournament = {
      ...tournament,
      id: "incomplete-schedule",
      name: "Liga con calendario incompleto",
      competitionId: "liga-incompleta",
      competitionType: "league",
      format: "round-robin",
      teams: [...tournament.teams, { id: "team-c", name: "Club C" }],
    };
    render(<LibraryHarness initialTournaments={[incompleteLeague]} />);

    expect(screen.getByRole("listitem", { name: "Liga con calendario incompleto" }))
      .toHaveTextContent("No disponible · calendario incompleto");
  });

  it("exports a valid tournament JSON, imports valid files and rejects invalid files without mutation", async () => {
    const user = userEvent.setup();
    render(<LibraryHarness initialTournaments={[tournament]} />);
    const card = screen.getByRole("listitem", { name: /Liga Uno/ });

    await user.click(within(card).getByRole("button", { name: "Exportar" }));
    expect(exportedFileName).toBe("league-one.json");
    expect(exportedBlob).not.toBeNull();
    const exported = JSON.parse(await readBlob(exportedBlob as Blob)) as {
      format: string;
      version: number;
      tournament: Tournament;
    };
    expect(exported).toMatchObject({
      format: "cancha-tournament",
      version: 7,
      tournament: { id: "league-one", name: "Liga Uno" },
    });

    const imported = { ...tournament, id: "league-imported", name: "Liga Importada" };
    await user.upload(
      screen.getByLabelText("Archivo JSON de torneo"),
      createJsonFile("importado.json", JSON.stringify(createTournamentArchive(imported))),
    );
    expect(await screen.findByRole("listitem", { name: /Liga Importada/ })).toBeInTheDocument();

    await user.upload(
      screen.getByLabelText("Archivo JSON de torneo"),
      createJsonFile("invalido.json", "{no json"),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("JSON válido");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("requires a decision for an existing archive and applies copy or update only after confirmation", async () => {
    const user = userEvent.setup();
    render(<LibraryHarness initialTournaments={[tournament]} />);
    const archiveForSameId = {
      ...tournament,
      name: "Liga Actualizada",
      matchdays: [{
        ...tournament.matchdays[0],
        fixtures: [{
          ...tournament.matchdays[0].fixtures[0],
          result: { homeGoals: 3, awayGoals: 0 },
        }],
      }],
    };
    const file = () => createJsonFile(
      "liga.json",
      JSON.stringify(createTournamentArchive(archiveForSameId)),
    );
    const picker = screen.getByLabelText("Archivo JSON de torneo");

    await user.upload(picker, file());
    const firstDecision = await screen.findByRole("dialog", { name: "Este torneo ya está guardado" });
    await user.click(within(firstDecision).getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("listitem", { name: "Liga Uno" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);

    await user.upload(picker, file());
    const copyDecision = await screen.findByRole("dialog", { name: "Este torneo ya está guardado" });
    await user.click(within(copyDecision).getByRole("button", { name: "Crear copia independiente" }));
    expect(await screen.findByRole("listitem", { name: /Liga Actualizada \(copia\)/ }))
      .toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);

    await user.upload(picker, file());
    const updateDecision = await screen.findByRole("dialog", { name: "Este torneo ya está guardado" });
    await user.click(within(updateDecision).getByRole("button", { name: "Actualizar torneo existente" }));
    expect(await screen.findByRole("listitem", { name: "Liga Actualizada" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("requires an explicit update or independent copy when IDs differ but competition and season match", async () => {
    const user = userEvent.setup();
    const saved = { ...tournament, competitionId: "liga-profesional", season: 2026 };
    const imported = {
      ...tournament,
      id: "otro-id",
      competitionId: "liga-profesional",
      name: "Liga desde otro archivo",
    };
    render(<LibraryHarness initialTournaments={[saved]} />);

    await user.upload(
      screen.getByLabelText("Archivo JSON de torneo"),
      createJsonFile("otra-identidad.json", JSON.stringify(createTournamentArchive(imported))),
    );
    const decision = await screen.findByRole("dialog", {
      name: "Esta competición y temporada ya están guardadas",
    });
    expect(decision).toHaveTextContent("liga-profesional");
    expect(decision).toHaveTextContent("2026");
    await user.click(within(decision).getByRole("button", { name: "Actualizar torneo existente" }));

    expect(await screen.findByRole("listitem", { name: "Liga desde otro archivo" }))
      .toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("previews backups, cancels replacement without changes, then confirms restoration", async () => {
    const user = userEvent.setup();
    render(<LibraryHarness initialTournaments={[tournament]} />);
    const backupTournaments = [
      { ...tournament, id: "restored-a", name: "Restaurado A" },
      { ...tournament, id: "restored-b", name: "Restaurado B" },
    ];
    const backupText = JSON.stringify(createTournamentBackup(backupTournaments));

    await user.click(screen.getByRole("button", { name: /^Centro de guardado y recuperación$/ }));
    await user.click(screen.getByRole("button", { name: "Restaurar respaldo" }));
    await user.upload(
      screen.getByLabelText("Archivo JSON de respaldo"),
      createJsonFile("backup-corrupto.json", "{inválido"),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("JSON válido");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);

    await user.upload(
      screen.getByLabelText("Archivo JSON de respaldo"),
      createJsonFile("backup.json", backupText),
    );
    const confirmation = await screen.findByRole("dialog", { name: "Restaurar respaldo" });
    expect(confirmation).toHaveTextContent("JSON v7");
    expect(confirmation).toHaveTextContent("Torneos que se incorporarían");
    await user.click(within(confirmation).getByRole("button", { name: "Cancelar" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("listitem", { name: /Liga Uno/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Restaurar respaldo" }));
    await user.upload(
      screen.getByLabelText("Archivo JSON de respaldo"),
      createJsonFile("backup.json", backupText),
    );
    const restoreDialog = screen.getByRole("dialog", { name: "Restaurar respaldo" });
    await user.click(within(restoreDialog).getByRole("button", { name: "Reemplazar biblioteca" }));
    expect(await screen.findByRole("listitem", { name: /Restaurado A/ })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("listitem", { name: /Liga Uno/ })).not.toBeInTheDocument();
  });

  it("previews ID conflicts and keeps local results when combining backups", async () => {
    const user = userEvent.setup();
    localStorage.setItem("cancha.tournaments", JSON.stringify([tournament]));
    const conflicting: Tournament = {
      ...tournament,
      name: "Versión del archivo",
      matchdays: [{
        ...tournament.matchdays[0],
        fixtures: [{
          ...tournament.matchdays[0].fixtures[0],
          result: { homeGoals: 0, awayGoals: 5 },
        }],
      }],
    };
    const backupText = JSON.stringify(createTournamentBackup([conflicting]));
    await renderApplication(<App />);
    await user.click(await screen.findByRole("button", { name: "Mis torneos" }));
    await user.click(screen.getByRole("button", { name: /^Centro de guardado y recuperación$/ }));
    await user.click(screen.getByRole("button", { name: "Restaurar respaldo" }));
    await user.upload(
      screen.getByLabelText("Archivo JSON de respaldo"),
      createJsonFile("conflicto.json", backupText),
    );

    const dialog = await screen.findByRole("dialog", { name: "Restaurar respaldo" });
    expect(dialog).toHaveTextContent("IDs que ya existen y se conservarían al combinar");
    expect(dialog).toHaveTextContent("league-one");
    expect(within(dialog).getByRole("button", {
      name: "Combinar (0 nuevos; conservar 1 existentes)",
    })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", {
      name: "Combinar (0 nuevos; conservar 1 existentes)",
    }));

    expect(new LocalStorageTournamentRepository(false).findAll()[0]).toEqual(tournament);
    expect(screen.getByRole("status")).toHaveTextContent("0 nuevos; 1 con identificador existente");
  });

  it("blocks merging universe metadata collisions but leaves explicit replacement available", async () => {
    const user = userEvent.setup();
    localStorage.setItem("cancha.tournaments", JSON.stringify([tournament]));
    const localUniverses = {
      version: 1 as const,
      activeUniverseId: "career",
      universes: [{ id: "career", name: "Partida local" }],
      assignments: { [tournament.id]: "career" },
    };
    const incomingUniverses = {
      ...localUniverses,
      universes: [{ id: "career", name: "Partida del archivo" }],
      assignments: { "backup-tournament": "career" },
    };
    localStorage.setItem("cancha.sportsUniverses", JSON.stringify(localUniverses));
    const backupText = JSON.stringify(createTournamentBackup(
      [{ ...tournament, id: "backup-tournament" }],
      undefined,
      [],
      incomingUniverses,
    ));
    await renderApplication(<App />);
    await user.click(await screen.findByRole("button", { name: "Mis torneos" }));
    await user.click(screen.getByRole("button", { name: /^Centro de guardado y recuperación$/ }));
    await user.click(screen.getByRole("button", { name: "Restaurar respaldo" }));
    await user.upload(
      screen.getByLabelText("Archivo JSON de respaldo"),
      createJsonFile("universos-conflictivos.json", backupText),
    );

    const dialog = await screen.findByRole("dialog", { name: "Restaurar respaldo" });
    expect(dialog).toHaveTextContent("Combinación bloqueada por identidades de universos");
    expect(within(dialog).queryByRole("button", { name: /^Combinar/ })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Reemplazar biblioteca" })).toBeEnabled();
    expect(localStorage.getItem("cancha.tournaments")).toBe(JSON.stringify([tournament]));
    expect(localStorage.getItem("cancha.sportsUniverses")).toBe(JSON.stringify(localUniverses));
  });

  it("shows recovery warnings while retaining valid tournaments beside corrupt saved records", async () => {
    const saved = JSON.stringify([tournament, { id: "broken", name: "Registro dañado" }]);
    localStorage.setItem("cancha.tournaments", saved);
    localStorage.setItem("cancha.activeTournamentId", tournament.id);
    await renderApplication(<App />);

    expect(await screen.findByRole("heading", { name: "Liga Uno" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Se omitió un campeonato guardado");
    expect(localStorage.getItem("cancha.tournaments")).toBe(saved);
    expect(new LocalStorageTournamentRepository(false).findAll().map(({ id }) => id))
      .toEqual([tournament.id]);
  });

  it("exports duplicate-ID data exactly before replacing it with a valid external backup", async () => {
    const duplicate = { ...tournament, id: "duplicate", name: "Primera copia" };
    const original = JSON.stringify([duplicate, { ...duplicate, name: "Segunda copia" }]);
    localStorage.setItem("cancha.tournaments", original);
    const user = userEvent.setup();
    await renderApplication(<App />);

    expect(await screen.findByRole("heading", { name: "No hay torneos disponibles" }))
      .toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Aún no tienes torneos guardados" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("identificador duplicado");
    await user.click(screen.getByRole("button", { name: /^Centro de guardado y recuperación$/ }));
    await user.click(screen.getByRole("button", { name: "Exportar datos originales para recuperación" }));
    expect(exportedFileName).toBe("cancha-recuperacion-original.json");
    expect(await readBlob(exportedBlob!)).toBe(original);
    expect(screen.getByRole("status")).toHaveTextContent("no está validado como respaldo restaurable");

    const backup = createTournamentBackup([tournament], () => new Date("2026-10-15T12:00:00.000Z"));
    await user.click(screen.getByRole("button", { name: "Restaurar respaldo" }));
    await user.upload(
      screen.getByLabelText("Archivo JSON de respaldo"),
      createJsonFile("externo.json", JSON.stringify(backup)),
    );
    const confirmation = await screen.findByRole("dialog", { name: "Restaurar respaldo" });
    await user.click(within(confirmation).getByRole("button", { name: "Reemplazar biblioteca" }));

    expect(await screen.findByRole("heading", { name: "Liga Uno" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mis torneos" }));
    expect(await screen.findByRole("listitem", { name: /Liga Uno/ })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(new LocalStorageTournamentRepository(false).findAll().map(({ id }) => id)).toEqual([tournament.id]);
  });

  it("exports exact original text for structurally invalid records", async () => {
    const original = JSON.stringify([tournament, { id: "broken", name: "Roto", teams: "no-es-lista" }]);
    localStorage.setItem("cancha.tournaments", original);
    const user = userEvent.setup();
    await renderApplication(<App />);

    await user.click(await screen.findByRole("button", { name: "Mis torneos" }));
    await user.click(screen.getByRole("button", { name: /^Centro de guardado y recuperación$/ }));
    expect(await screen.findByRole("button", { name: "Exportar datos originales para recuperación" }))
      .toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Exportar datos originales para recuperación" }));

    expect(exportedFileName).toBe("cancha-recuperacion-original.json");
    expect(await readBlob(exportedBlob!)).toBe(original);
    expect(screen.getByRole("status")).toHaveTextContent("no está validado como respaldo restaurable");
  });

  it("shows an error instead of claiming recovery export succeeded when storage cannot be read", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("private storage error");
    });
    const user = userEvent.setup();
    await renderApplication(<App />);

    await user.click(await screen.findByRole("button", { name: /^Centro de guardado y recuperación$/ }));
    await user.click(await screen.findByRole("button", { name: "Exportar datos originales para recuperación" }));

    expect(screen.getAllByRole("alert").some((alert) =>
      alert.textContent?.includes("No se pudieron leer los campeonatos guardados del navegador."),
    )).toBe(true);
    expect(screen.queryByText(/Se exportó el contenido original/)).not.toBeInTheDocument();
    expect(exportedBlob).toBeNull();
  });

  it("shows a download error instead of claiming recovery export succeeded", async () => {
    localStorage.setItem("cancha.tournaments", JSON.stringify([
      tournament,
      { id: "broken", name: "Roto", teams: "no-es-lista" },
    ]));
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      throw new Error("No se pudo iniciar la descarga.");
    });
    const user = userEvent.setup();
    await renderApplication(<App />);

    await user.click(await screen.findByRole("button", { name: "Mis torneos" }));
    await user.click(screen.getByRole("button", { name: /^Centro de guardado y recuperación$/ }));
    await user.click(screen.getByRole("button", { name: "Exportar datos originales para recuperación" }));

    expect(screen.getByText("No se pudo iniciar la descarga.")).toBeInTheDocument();
    expect(screen.queryByText(/Se exportó el contenido original/)).not.toBeInTheDocument();
  });
});

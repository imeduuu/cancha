// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SportsUniverseLibrary } from "@cancha/core/domain/entities/sports-universe";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import { SportsUniverseDashboard } from "./sports-universe-dashboard";

const tournament: Tournament = {
  id: "league-dashboard-2026",
  competitionId: "league-dashboard",
  name: "Liga del panel",
  season: 2026,
  teams: [{ id: "one", name: "Club Uno" }, { id: "two", name: "Club Dos" }],
  legs: 1,
  tieBreakers: ["goalDifference"],
  createdAt: "2026-01-01T00:00:00.000Z",
  matchdays: [{
    number: 3,
    leg: 1,
    fixtures: [{ id: "game", homeTeamId: "one", awayTeamId: "two" }],
  }],
};

const universeLibrary: SportsUniverseLibrary = {
  version: 1,
  activeUniverseId: "dashboard",
  universes: [{ id: "dashboard", name: "Partida de prueba" }],
  assignments: { [tournament.id]: "dashboard" },
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("cancha.tournaments", JSON.stringify([tournament]));
});

afterEach(cleanup);

describe("sports universe dashboard", () => {
  it("shows a clear empty state for an empty universe", () => {
    render(
      <SportsUniverseDashboard
        tournaments={[]}
        activity={[]}
        universeLibrary={universeLibrary}
        onOpen={vi.fn()}
        onCalendar={vi.fn()}
        onAlerts={vi.fn()}
        onPlanning={vi.fn()}
        onQualification={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Partida de prueba" })).toBeInTheDocument();
    expect(screen.getByText("Este universo todavía no contiene competiciones.")).toBeInTheDocument();
    expect(screen.getByText("No hay actividad atribuible a este universo.")).toBeInTheDocument();
  });

  it("opens the existing calendar flow from a read-only dashboard action", () => {
    const onCalendar = vi.fn();
    render(
      <SportsUniverseDashboard
        tournaments={[tournament]}
        activity={[]}
        universeLibrary={universeLibrary}
        onOpen={vi.fn()}
        onCalendar={onCalendar}
        onAlerts={vi.fn()}
        onPlanning={vi.fn()}
        onQualification={vi.fn()}
      />,
    );
    const card = screen.getByRole("article", { name: "Competición Liga del panel 2026" });
    expect(within(card).getByText("Liga del panel · 2026")).toBeInTheDocument();
    expect(within(card).getByText(/0 disputados · 1 pendientes/)).toBeInTheDocument();
    expect(screen.getByText(/Jornada 3 · Liga del panel: Club Uno vs\. Club Dos/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Abrir calendario" })[0]);
    fireEvent.click(within(screen.getByText(/Completar o revisar partidos/).closest("li")!)
      .getByRole("button", { name: "Abrir flujo" }));
    expect(onCalendar).toHaveBeenCalledTimes(2);
    expect(onCalendar).toHaveBeenCalledWith(tournament);
    expect(localStorage.getItem("cancha.tournaments")).toBe(JSON.stringify([tournament]));
  });
});

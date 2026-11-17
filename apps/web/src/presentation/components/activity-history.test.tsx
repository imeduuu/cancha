// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityEvent } from "@cancha/core/domain/entities/activity-event";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import { ActivityHistory } from "./activity-history";

const tournament: Tournament = {
  id: "cup-2026",
  competitionId: "cup",
  name: "Copa",
  season: 2026,
  teams: [],
  legs: 1,
  tieBreakers: [],
  matchdays: [{
    number: 1,
    leg: 1,
    fixtures: [{ id: "final", homeTeamId: "home", awayTeamId: "away" }],
  }],
  createdAt: "2026-01-01T00:00:00.000Z",
};

const events: ActivityEvent[] = [
  {
    id: "older",
    occurredAt: "2026-10-13T20:00:00.000Z",
    action: "match-result-updated",
    tournamentId: "cup-2026",
    competitionId: "cup",
    tournamentName: "Copa",
    season: 2026,
    entityId: "final",
    entityType: "match",
    summary: "Resultado guardado",
    before: null,
    after: { homeGoals: 2, awayGoals: 1 },
  },
  {
    id: "newer",
    occurredAt: "2026-10-14T20:00:00.000Z",
    action: "match-schedule-updated",
    tournamentId: "cup-2026",
    competitionId: "cup",
    tournamentName: "Copa",
    season: 2026,
    entityId: "final",
    entityType: "match",
    summary: "Fecha y hora actualizadas",
    before: null,
    after: { date: "2026-10-20", time: "20:00" },
  },
];

afterEach(cleanup);

function renderHistory(focusFixtureId?: string) {
  const onOpenMatch = vi.fn();
  render(
    <ActivityHistory
      events={events}
      tournaments={[tournament]}
      focusTournamentId="cup-2026"
      focusFixtureId={focusFixtureId}
      onClose={vi.fn()}
      onOpenTournament={vi.fn()}
      onOpenMatch={onOpenMatch}
    />,
  );
  return { onOpenMatch };
}

describe("ActivityHistory", () => {
  it("orders newest first and filters by summary and action", () => {
    renderHistory();
    const entries = screen.getAllByRole("listitem");
    expect(entries[0]).toHaveTextContent("Fecha y hora actualizadas");
    expect(entries[1]).toHaveTextContent("Resultado guardado");
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar en el historial" }), {
      target: { value: "Resultado" },
    });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar en el historial" }), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Filtrar historial por tipo" }), {
      target: { value: "match-result-updated" },
    });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    fireEvent.change(screen.getByRole("combobox", { name: "Filtrar historial por tipo" }), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-10-13" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Resultado guardado")).toBeInTheDocument();
  });

  it("opens the related match and scopes activity to the requested fixture", () => {
    const { onOpenMatch } = renderHistory("final");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Abrir partido" })[0]);
    expect(onOpenMatch).toHaveBeenCalledWith(tournament, "final");
  });

  it("shows an empty state when there are no activity events", () => {
    render(
      <ActivityHistory
        events={[]}
        tournaments={[tournament]}
        onClose={vi.fn()}
        onOpenTournament={vi.fn()}
        onOpenMatch={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Todavía no hay actividad registrada");
  });

  it("does not link a deletion snapshot to a tournament reusing the same ID", () => {
    render(
      <ActivityHistory
        events={[{
          ...events[0],
          id: "deleted-event",
          action: "tournament-deleted",
          entityType: "tournament",
          summary: "Competición eliminada",
        }]}
        tournaments={[tournament]}
        onClose={vi.fn()}
        onOpenTournament={vi.fn()}
        onOpenMatch={vi.fn()}
      />,
    );
    expect(screen.getByText("Competición eliminada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Abrir temporada" })).not.toBeInTheDocument();
  });
});

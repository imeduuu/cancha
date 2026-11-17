import {continentalLeague} from "@cancha/core/test-utils/continental-qualification-fixtures";
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import { TournamentStatisticsPanel } from "./tournament-statistics-panel";

afterEach(cleanup);

describe("TournamentStatisticsPanel", () => {
  it("explains when invalid match details are excluded from individual statistics", () => {
    const tournament: Tournament = {
      id: "season",
      name: "Temporada",
      teams: [{ id: "a", name: "Alfa" }, { id: "b", name: "Bravo" }],
      legs: 1,
      tieBreakers: [],
      matchdays: [{
        number: 1,
        leg: 1,
        fixtures: [{
          id: "match",
          homeTeamId: "a",
          awayTeamId: "b",
          result: { homeGoals: 1, awayGoals: 0 },
          events: [{
            id: "invalid-card",
            type: "yellow-card",
            teamId: "a",
            playerId: "missing-player",
            playerName: "Jugador",
          }],
        }],
      }],
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    render(
      <TournamentStatisticsPanel
        tournament={tournament}
        tournaments={[tournament]}
        onSelectTournament={vi.fn()}
        onSaveTournament={vi.fn()}
        onSaveRegulations={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert"))
      .toHaveTextContent("detalles individuales de 1 partido(s)");
    expect(screen.getByText("Partidos con detalles inválidos")).toBeInTheDocument();
    expect(screen.getByText("Partidos jugados").parentElement?.querySelector("strong"))
      .toHaveTextContent("1");
  });
});

it("keeps the existing champion highlight pending when published coverage is partial",()=>{
 const t={...continentalLeague(),importCoverage:"partial" as const};
 const {container}=render(<TournamentStatisticsPanel tournament={t} tournaments={[t]} onSelectTournament={vi.fn()} onSaveTournament={vi.fn()} onSaveRegulations={vi.fn()}/>);
 expect(container.querySelector(".statistics-highlights")!).toHaveTextContent("Aún no determinado");
});

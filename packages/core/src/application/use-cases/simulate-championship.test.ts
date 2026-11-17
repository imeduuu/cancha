import { describe, expect, it, vi } from "vitest";
import type { Tournament } from "../../domain/entities/tournament";
import type { TournamentRepository } from "../ports/tournament-repository";
import { simulateChampionship } from "./simulate-championship";

describe("simulateChampionship with cup brackets", () => {
  it("simulates generated knockout stages through the final", () => {
    const tournament: Tournament = {
      id: "afa-copa-argentina-2026",
      name: "Copa Argentina 2026",
      teams: [],
      legs: 1,
      tieBreakers: [],
      matchdays: [{
        number: 1,
        leg: 1,
        phaseName: "Copa Argentina · 32avos de Final",
        fixtures: Array.from({ length: 4 }, (_, index) => ({
          id: `round-1-${index}`,
          homeTeamId: `team-${index * 2}`,
          awayTeamId: `team-${index * 2 + 1}`,
          knockoutResolution: "penalties" as const,
        })),
      }],
      createdAt: "2026-01-01T00:00:00.000Z",
      competitionType: "cup",
      knockoutStages: [
        { name: "Copa Argentina · 32avos de Final", legs: 1 },
        { name: "Copa Argentina · Cuartos de Final", legs: 1 },
        { name: "Copa Argentina · Final", legs: 1 },
      ],
    };
    const save = vi.fn();
    const repository: TournamentRepository = {
      save,
      saveWithActivity: vi.fn((value: Tournament) => save(value)),
      recordActivity: vi.fn(),
      findAll: () => [],
    };

    const result = simulateChampionship(
      tournament,
      "pendingOnly",
      repository,
      () => 0.5,
    );

    expect(result.simulatedCount).toBe(7);
    expect(result.tournament.matchdays.map(({ phaseName, fixtures }) => [
      phaseName,
      fixtures.length,
      fixtures.every((fixture) => fixture.result !== undefined),
    ])).toEqual([
      ["Copa Argentina · 32avos de Final", 4, true],
      ["Copa Argentina · Cuartos de Final", 2, true],
      ["Copa Argentina · Final", 1, true],
    ]);
  });
});

import { describe, expect, it, vi } from "vitest";
import type { Tournament } from "../../domain/entities/tournament";
import type { TournamentRepository } from "../ports/tournament-repository";
import { simulateFixtures } from "./simulate-fixtures";

const tournament: Tournament = {
  id: "tournament-1",
  name: "Torneo de prueba",
  teams: [
    { id: "team-1", name: "Equipo 1" },
    { id: "team-2", name: "Equipo 2" },
  ],
  legs: 2,
  tieBreakers: ["goalDifference"],
  createdAt: "2026-01-01T00:00:00.000Z",
  matchdays: [
    {
      number: 1,
      leg: 1,
      fixtures: [
        { id: "match-1", homeTeamId: "team-1", awayTeamId: "team-2" },
        { id: "match-2", homeTeamId: "team-2", awayTeamId: "team-1" },
      ],
    },
    {
      number: 1,
      leg: 2,
      fixtures: [
        {
          id: "match-3",
          homeTeamId: "team-1",
          awayTeamId: "team-2",
          result: { homeGoals: 3, awayGoals: 2 },
        },
      ],
    },
  ],
};

function createRepository(): TournamentRepository {
  const save = vi.fn();
  return {
    save,
    saveWithActivity: vi.fn((value: Tournament) => save(value)),
    recordActivity: vi.fn(),
    findAll: vi.fn(() => []),
  };
}

function randomWithPenaltyDeciderAfterTwentyRounds(): () => number {
  let draw = 0;
  return () => {
    const value = draw === 55 ? 0.9 : 0;
    draw += 1;
    return value;
  };
}

describe("simulateFixtures", () => {
  it("simulates every selected match, leaving other fixtures unchanged", () => {
    const repository = createRepository();
    const result = simulateFixtures(
      tournament,
      ["match-1"],
      "pendingOnly",
      repository,
      () => 0,
    );

    expect(result.simulatedCount).toBe(1);
    expect(result.tournament.matchdays[0].fixtures[0].result).toEqual({
      homeGoals: 0,
      awayGoals: 0,
    });
    expect(result.tournament.matchdays[0].fixtures[1].result).toBeUndefined();
    expect(repository.save).toHaveBeenCalledOnce();
  });

  it("skips existing results when pending-only mode is selected", () => {
    const repository = createRepository();
    const result = simulateFixtures(
      tournament,
      ["match-3"],
      "pendingOnly",
      repository,
      () => 0,
    );

    expect(result.simulatedCount).toBe(0);
    expect(result.tournament).toBe(tournament);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("overwrites existing results when overwrite mode is selected", () => {
    const repository = createRepository();
    const result = simulateFixtures(
      tournament,
      ["match-3"],
      "overwrite",
      repository,
      () => 0,
    );

    expect(result.simulatedCount).toBe(1);
    expect(result.tournament.matchdays[1].fixtures[0].result).toEqual({
      homeGoals: 0,
      awayGoals: 0,
    });
  });

  it("rejects matches outside the tournament", () => {
    expect(() => simulateFixtures(
      tournament,
      ["unknown-match"],
      "overwrite",
      createRepository(),
    )).toThrow("La selección contiene un partido que no pertenece al campeonato.");
  });

  it("resolves knockout draws with extra time and penalties when still tied", () => {
    const knockoutTournament: Tournament = {
      ...tournament,
      matchdays: [{
        number: 1,
        leg: 1,
        fixtures: [{
          id: "final",
          homeTeamId: "team-1",
          awayTeamId: "team-2",
          knockoutResolution: "extra-time-then-penalties",
        }],
      }],
    };
    const result = simulateFixtures(
      knockoutTournament,
      ["final"],
      "pendingOnly",
      createRepository(),
      randomWithPenaltyDeciderAfterTwentyRounds(),
    );
    const fixture = result.tournament.matchdays[0].fixtures[0];

    expect(fixture.result?.homeGoals).toBe(fixture.result?.awayGoals);
    expect(fixture.result?.extraTime).toBeDefined();
    expect(fixture.result?.penalties?.homeGoals)
      .not.toBe(fixture.result?.penalties?.awayGoals);
  });

  it("continues sudden death after twenty tied rounds without adding a fabricated goal", () => {
    const knockoutTournament: Tournament = {
      ...tournament,
      matchdays: [{
        number: 1,
        leg: 1,
        fixtures: [{
          id: "final",
          homeTeamId: "team-1",
          awayTeamId: "team-2",
          knockoutResolution: "extra-time-then-penalties",
        }],
      }],
    };
    let draw = 0;
    const result = simulateFixtures(
      knockoutTournament,
      ["final"],
      "pendingOnly",
      createRepository(),
      () => {
        const value = draw === 55 ? 0.9 : 0;
        draw += 1;
        return value;
      },
    );
    const penalties = result.tournament.matchdays[0].fixtures[0].result?.penalties;

    expect(draw).toBe(56);
    expect(penalties).toEqual({ homeGoals: 26, awayGoals: 25 });
  });

  it("simulates penalties only when a return-leg aggregate is tied", () => {
    const twoLegTournament: Tournament = {
      ...tournament,
      matchdays: [
        {
          number: 1,
          leg: 1,
          phaseName: "Copa Chile · Octavos de final · Ida",
          fixtures: [{
            id: "first-leg",
            homeTeamId: "team-1",
            awayTeamId: "team-2",
            result: { homeGoals: 1, awayGoals: 0 },
          }],
        },
        {
          number: 1,
          leg: 2,
          phaseName: "Copa Chile · Octavos de final · Vuelta",
          fixtures: [{
            id: "return-leg",
            homeTeamId: "team-2",
            awayTeamId: "team-1",
            knockoutResolution: "aggregate-then-penalties",
          }],
        },
      ],
    };
    const randomValues = [
      0.5,
      0.3,
      0,
      ...Array.from({ length: 50 }, () => 0),
      0,
      0.9,
    ];
    let randomIndex = 0;
    const result = simulateFixtures(
      twoLegTournament,
      ["return-leg"],
      "pendingOnly",
      createRepository(),
      () => randomValues[randomIndex++] ?? 0,
    );

    expect(result.tournament.matchdays[1].fixtures[0].result).toMatchObject({
      homeGoals: 1,
      awayGoals: 0,
    });
    expect(result.tournament.matchdays[1].fixtures[0].result?.penalties?.homeGoals)
      .not.toBe(result.tournament.matchdays[1].fixtures[0].result?.penalties?.awayGoals);
  });

  it("does not simulate a penalty shootout when the return-leg aggregate has a winner", () => {
    const twoLegTournament: Tournament = {
      ...tournament,
      matchdays: [
        {
          number: 1,
          leg: 1,
          phaseName: "Copa Chile · Octavos de final · Ida",
          fixtures: [{
            id: "first-leg",
            homeTeamId: "team-1",
            awayTeamId: "team-2",
            result: { homeGoals: 1, awayGoals: 0 },
          }],
        },
        {
          number: 1,
          leg: 2,
          phaseName: "Copa Chile · Octavos de final · Vuelta",
          fixtures: [{
            id: "return-leg",
            homeTeamId: "team-2",
            awayTeamId: "team-1",
            knockoutResolution: "aggregate-then-penalties",
          }],
        },
      ],
    };
    const result = simulateFixtures(
      twoLegTournament,
      ["return-leg"],
      "pendingOnly",
      createRepository(),
      () => 0,
    );

    expect(result.tournament.matchdays[1].fixtures[0].result).toEqual({
      homeGoals: 0,
      awayGoals: 0,
    });
  });
});

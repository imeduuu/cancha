import { describe, expect, it, vi } from "vitest";
import type { Tournament } from "../../domain/entities/tournament";
import type { TournamentRepository } from "../ports/tournament-repository";
import { updateMatchResult } from "./update-match-result";

const tournament: Tournament = {
  id: "tournament-1",
  name: "Torneo de prueba",
  teams: [
    { id: "team-1", name: "Equipo 1" },
    { id: "team-2", name: "Equipo 2" },
  ],
  legs: 1,
  tieBreakers: ["goalDifference"],
  createdAt: "2026-01-01T00:00:00.000Z",
  matchdays: [{
    number: 1,
    leg: 1,
    fixtures: [{ id: "match-1", homeTeamId: "team-1", awayTeamId: "team-2" }],
  }],
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

describe("updateMatchResult", () => {
  it("saves manual scores from 0 to 99 without restricting the scoreline", () => {
    const repository = createRepository();
    const result = updateMatchResult(
      tournament,
      "match-1",
      { homeGoals: 99, awayGoals: 0 },
      repository,
    );

    expect(result.matchdays[0].fixtures[0].result).toEqual({
      homeGoals: 99,
      awayGoals: 0,
    });
    expect(repository.save).toHaveBeenCalledWith(result);
  });

  it.each([
    { homeGoals: -1, awayGoals: 0 },
    { homeGoals: 100, awayGoals: 0 },
    { homeGoals: 1.5, awayGoals: 0 },
  ])("rejects invalid scores: %o", (score) => {
    expect(() => updateMatchResult(
      tournament,
      "match-1",
      score,
      createRepository(),
    )).toThrow("Cada resultado debe ser un entero entre 0 y 99.");
  });

  it("rejects an unknown match", () => {
    const repository = createRepository();

    expect(() => updateMatchResult(
      tournament,
      "unknown-match",
      { homeGoals: 0, awayGoals: 0 },
      repository,
    )).toThrow("No se encontró el partido que quieres actualizar.");
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("stores extra time and a penalty shootout for a knockout draw", () => {
    const knockoutTournament: Tournament = {
      ...tournament,
      matchdays: [{
        ...tournament.matchdays[0],
        fixtures: [{
          ...tournament.matchdays[0].fixtures[0],
          knockoutResolution: "extra-time-then-penalties",
        }],
      }],
    };
    const result = updateMatchResult(
      knockoutTournament,
      "match-1",
      {
        homeGoals: 1,
        awayGoals: 1,
        extraTime: { homeGoals: 0, awayGoals: 0 },
        penalties: { homeGoals: 4, awayGoals: 3 },
      },
      createRepository(),
    );

    expect(result.matchdays[0].fixtures[0].result?.penalties).toEqual({
      homeGoals: 4,
      awayGoals: 3,
    });
  });

  it("rejects a tied knockout score without its configured decision", () => {
    const knockoutTournament: Tournament = {
      ...tournament,
      matchdays: [{
        ...tournament.matchdays[0],
        fixtures: [{
          ...tournament.matchdays[0].fixtures[0],
          knockoutResolution: "penalties",
        }],
      }],
    };

    expect(() => updateMatchResult(
      knockoutTournament,
      "match-1",
      { homeGoals: 1, awayGoals: 1 },
      createRepository(),
    )).toThrow("Cada resultado debe ser un entero entre 0 y 99.");
  });

  it("does not persist an identical result when resolution is inferred from the fixture", () => {
    const existingResult = { homeGoals: 1, awayGoals: 0 };
    const knockoutTournament: Tournament = {
      ...tournament,
      matchdays: [{
        ...tournament.matchdays[0],
        fixtures: [{
          ...tournament.matchdays[0].fixtures[0],
          knockoutResolution: "extra-time-then-penalties",
          result: existingResult,
        }],
      }],
    };
    const repository = createRepository();

    const updated = updateMatchResult(
      knockoutTournament,
      "match-1",
      existingResult,
      repository,
    );

    expect(updated).toBe(knockoutTournament);
    expect(repository.saveWithActivity).not.toHaveBeenCalled();
  });

  it("validates penalties against the aggregate score after the return leg", () => {
    const twoLegTournament: Tournament = {
      ...tournament,
      teams: [
        { id: "team-1", name: "Equipo 1" },
        { id: "team-2", name: "Equipo 2" },
      ],
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
    const result = updateMatchResult(
      twoLegTournament,
      "return-leg",
      {
        homeGoals: 1,
        awayGoals: 0,
        penalties: { homeGoals: 4, awayGoals: 3 },
      },
      createRepository(),
    );

    expect(result.matchdays[1].fixtures[0].result).toMatchObject({
      homeGoals: 1,
      awayGoals: 0,
      penalties: { homeGoals: 4, awayGoals: 3 },
    });
    expect(() => updateMatchResult(
      twoLegTournament,
      "return-leg",
      {
        homeGoals: 0,
        awayGoals: 0,
        penalties: { homeGoals: 4, awayGoals: 3 },
      },
      createRepository(),
    )).toThrow("Cada resultado debe ser un entero entre 0 y 99.");
  });
});

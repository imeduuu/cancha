import { describe, expect, it } from "vitest";
import type { MatchRegulations, Tournament } from "../entities/tournament";
import {
  createPendingRegulationsForSeason,
  getMatchRegulationWarnings,
  validateMatchRegulations,
  validateTournamentMatchRegulations,
} from "./match-regulations";
import { validateFixtureDetailsWithWarnings } from "./match-details";

const completeRules: MatchRegulations = {
  schemaVersion: 1,
  season: 2026,
  verification: "verified",
  sourceUrl: "https://example.invalid/rules",
  notes: "Regla documentada por el usuario",
  lineup: { requiredStarters: 11, maxSubstitutes: 9 },
  substitutions: { maxCount: 5, maxWindows: 3 },
  timing: {
    regulationMinutes: 90,
    halfMinutes: 45,
    addedTimeAllowed: true,
    extraTimeAllowed: true,
    extraTimeMinutes: 30,
    penaltyShootoutAllowed: true,
  },
  cards: { yellowCardsForSuspension: 5, redCardSuspensionMatches: 1 },
  eligibility: { activeRegistrationRequired: true, minimumAge: 16, maximumAge: 40 },
};

function makeTournament(matchRegulations?: MatchRegulations): Tournament {
  return {
    id: "season-2026",
    competitionId: "competition",
    name: "Competición 2026",
    season: 2026,
    teams: [{ id: "a", name: "Alfa" }, { id: "b", name: "Bravo" }],
    legs: 1,
    tieBreakers: ["goalDifference"],
    matchdays: [{
      number: 1,
      leg: 1,
      fixtures: [{
        id: "match",
        homeTeamId: "a",
        awayTeamId: "b",
        lineups: {
          home: { starters: [], substitutes: [], status: "incomplete" },
          away: { starters: [], substitutes: [], status: "incomplete" },
        },
      }],
    }],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...(matchRegulations ? { matchRegulations } : {}),
  };
}

describe("match regulations", () => {
  it("accepts a complete configuration and sparse optional rules", () => {
    expect(validateMatchRegulations(completeRules)).toBeUndefined();
    expect(validateMatchRegulations({
      schemaVersion: 1, season: 2026, verification: "pending",
    })).toBeUndefined();
  });

  it("distinguishes zero from an absent limit and validates consistency", () => {
    expect(validateMatchRegulations({
      schemaVersion: 1,
      season: 2026,
      verification: "pending",
      substitutions: { maxCount: 0 },
    })).toBeUndefined();
    expect(validateMatchRegulations({
      schemaVersion: 1,
      season: 2026,
      verification: "pending",
      timing: { regulationMinutes: 90, halfMinutes: 40 },
    })).toContain("se contradicen");
    expect(validateMatchRegulations({
      schemaVersion: 1,
      season: 2026,
      verification: "pending",
      eligibility: { minimumAge: 23, maximumAge: 18 },
    })).toContain("edad mínima");
    expect(validateMatchRegulations({
      schemaVersion: 1, season: 2026, verification: "verified",
    })).toContain("sin una fuente u observación");
  });

  it("warns about lineup and substitution infractions but leaves the data intact", () => {
    const regulations: MatchRegulations = {
      ...completeRules,
      verification: "provisional",
      lineup: { requiredStarters: 1, maxSubstitutes: 0 },
      substitutions: { maxCount: 0, maxWindows: 0 },
    };
    const tournament: Tournament = {
      ...makeTournament(regulations),
      players: [
        { id: "a1", firstName: "A", lastName: "Uno" },
        { id: "a2", firstName: "A", lastName: "Dos" },
        { id: "b1", firstName: "B", lastName: "Uno" },
      ],
      playerRegistrations: [
        { playerId: "a1", teamId: "a" },
        { playerId: "a2", teamId: "a" },
        { playerId: "b1", teamId: "b" },
      ],
      matchdays: [{
        number: 1,
        leg: 1,
        fixtures: [{
          id: "match",
          homeTeamId: "a",
          awayTeamId: "b",
          lineups: {
            home: { starters: ["a1"], substitutes: ["a2"], status: "complete" },
            away: { starters: ["b1"], substitutes: [], status: "complete" },
          },
          substitutions: [{
            id: "s1", teamId: "a", playerOutId: "a1", playerInId: "a2", window: 1,
          }],
        }],
      }],
    };
    const fixture = tournament.matchdays[0].fixtures[0];
    const validation = validateFixtureDetailsWithWarnings(tournament, fixture);
    expect(validation.errors).toEqual([]);
    expect(validation.regulatoryStatus).toBe("unverified");
    expect(validation.warnings.join(" ")).toContain("provisional");
    expect(validation.warnings.join(" ")).toContain("suplentes convocados");
    expect(validation.warnings.join(" ")).toContain("máximo configurado por equipo es 0");
    expect(fixture.substitutions).toHaveLength(1);
  });

  it("does not enforce absent limits and surfaces contradictions with the legacy lineup setting", () => {
    const tournament = {
      ...makeTournament({ schemaVersion: 1, season: 2026, verification: "verified" }),
      lineupRules: { startersPerTeam: 9 },
      matchRegulations: {
        schemaVersion: 1 as const,
        season: 2026,
        verification: "verified" as const,
        lineup: { requiredStarters: 11 },
      },
    };
    const fixture = tournament.matchdays[0].fixtures[0];
    const validation = validateFixtureDetailsWithWarnings(tournament, fixture);
    expect(validation.regulatoryStatus).toBe("conflict");
    expect(validation.warnings.join(" ")).toContain("Conflicto");
    expect(getMatchRegulationWarnings(makeTournament({
      schemaVersion: 1, season: 2026, verification: "verified",
    }), fixture)).toEqual([]);
  });

  it("keeps historical match data when a new starter requirement changes its lineup status", () => {
    const tournament: Tournament = {
      ...makeTournament({
        schemaVersion: 1,
        season: 2026,
        verification: "pending",
        lineup: { requiredStarters: 2 },
      }),
      players: [
        { id: "a1", firstName: "A", lastName: "Uno" },
        { id: "b1", firstName: "B", lastName: "Uno" },
      ],
      playerRegistrations: [
        { playerId: "a1", teamId: "a" },
        { playerId: "b1", teamId: "b" },
      ],
      matchdays: [{
        number: 1,
        leg: 1,
        fixtures: [{
          id: "match",
          homeTeamId: "a",
          awayTeamId: "b",
          result: { homeGoals: 1, awayGoals: 0 },
          lineups: {
            home: { starters: ["a1"], substitutes: [], status: "complete" },
            away: { starters: ["b1"], substitutes: [], status: "complete" },
          },
        }],
      }],
    };
    const fixture = tournament.matchdays[0].fixtures[0];
    const validation = validateFixtureDetailsWithWarnings(tournament, fixture);

    expect(validation.errors).toEqual([]);
    expect(validation.warnings.join(" ")).toContain("requiere 2");
    expect(validation.warnings.join(" ")).toContain("no coincide con la cantidad de titulares");
    expect(validation.regulatoryStatus).toBe("unverified");
    expect(fixture.result).toEqual({ homeGoals: 1, awayGoals: 0 });
    expect(fixture.lineups?.home.starters).toEqual(["a1"]);
  });

  it("requires an explicitly identified matching season and copies rules only as a pending draft", () => {
    expect(validateTournamentMatchRegulations(makeTournament(completeRules))).toBeUndefined();
    expect(validateTournamentMatchRegulations({
      ...makeTournament(completeRules),
      season: undefined,
      competitionRules: undefined,
    })).toContain("temporada explícitamente identificada");
    const draft = createPendingRegulationsForSeason(completeRules, 2027);
    expect(draft).toMatchObject({ season: 2027, verification: "pending" });
    expect(draft.lineup).toEqual(completeRules.lineup);
    expect(draft.lineup).not.toBe(completeRules.lineup);
    expect(draft.timing).not.toBe(completeRules.timing);
    expect(draft.cards).not.toBe(completeRules.cards);
  });

  it("does not use cards from pending or invalid earlier fixtures for cumulative warnings", () => {
    const regulations: MatchRegulations = {
      schemaVersion: 1,
      season: 2026,
      verification: "pending",
      cards: { yellowCardsForSuspension: 2 },
    };
    const previousFixture = {
      id: "previous",
      homeTeamId: "a",
      awayTeamId: "b",
      events: [{
        id: "previous-card",
        type: "yellow-card" as const,
        teamId: "a",
        playerId: "player-a",
        playerName: "Jugador A",
      }],
    };
    const currentFixture = {
      id: "current",
      homeTeamId: "a",
      awayTeamId: "b",
      events: [{
        id: "current-card",
        type: "yellow-card" as const,
        teamId: "a",
        playerId: "player-a",
        playerName: "Jugador A",
      }],
    };
    const base = {
      ...makeTournament(regulations),
      players: [{ id: "player-a", firstName: "Jugador", lastName: "A" }],
      playerRegistrations: [{ playerId: "player-a", teamId: "a" }],
      matchdays: [
        { number: 1, leg: 1, fixtures: [previousFixture] },
        { number: 2, leg: 1, fixtures: [currentFixture] },
      ],
    } satisfies Tournament;
    expect(getMatchRegulationWarnings(base, currentFixture)
      .some((warning) => warning.includes("alcanza 2"))).toBe(false);

    const completedPrevious: Tournament = {
      ...base,
      matchdays: [
        {
          ...base.matchdays[0],
          fixtures: [{
            ...previousFixture,
            result: { homeGoals: 0, awayGoals: 0 },
          }],
        },
        base.matchdays[1],
      ],
    };
    expect(getMatchRegulationWarnings(completedPrevious, currentFixture)
      .some((warning) => warning.includes("alcanza 2"))).toBe(true);

    const invalidPrevious: Tournament = {
      ...completedPrevious,
      matchdays: [
        {
          ...completedPrevious.matchdays[0],
          fixtures: [{
            ...previousFixture,
            result: { homeGoals: 100, awayGoals: 0 },
          }],
        },
        completedPrevious.matchdays[1],
      ],
    };
    expect(getMatchRegulationWarnings(invalidPrevious, currentFixture)
      .some((warning) => warning.includes("alcanza 2"))).toBe(false);
  });
});

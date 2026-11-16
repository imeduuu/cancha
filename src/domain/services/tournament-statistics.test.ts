import { describe, expect, it } from "vitest";
import type { MatchResult, Tournament } from "../entities/tournament";
import type { TournamentRepository } from "../../application/ports/tournament-repository";
import { updateMatchGoalScorers } from "../../application/use-cases/update-match-goal-scorers";
import { calculateTournamentStatistics } from "./tournament-statistics";

const teams: Tournament["teams"] = [
  { id: "a", name: "Alfa", groupName: "Grupo A" },
  { id: "b", name: "Bravo", groupName: "Grupo A" },
  { id: "c", name: "Charlie", groupName: "Grupo B" },
  { id: "d", name: "Delta", groupName: "Grupo B" },
];

function tournament(
  fixtures: Tournament["matchdays"][number]["fixtures"],
  overrides: Partial<Tournament> = {},
): Tournament {
  return {
    id: "stats-test",
    name: "Torneo estadísticas",
    teams,
    legs: 1,
    tieBreakers: ["goalDifference", "goalsFor"],
    matchdays: [{ number: 1, leg: 1, fixtures }],
    createdAt: "2026-01-01T00:00:00.000Z",
    format: "round-robin",
    ...overrides,
  };
}

describe("calculateTournamentStatistics", () => {
  it("reports a tournament without played matches without treating pending games as draws", () => {
    const stats = calculateTournamentStatistics(tournament([
      { id: "ab", homeTeamId: "a", awayTeamId: "b" },
      { id: "cd", homeTeamId: "c", awayTeamId: "d" },
    ]));

    expect(stats).toMatchObject({
      played: 0,
      pending: 2,
      notPlayed: 0,
      draws: 0,
      totalGoals: 0,
      progressPercent: 0,
    });
    expect(stats.championTeamId).toBeUndefined();
    expect(stats.standings.every(({ played, points }) => played === 0 && points === 0)).toBe(true);
  });

  it("counts played, pending, home wins, draws, away wins, goals and averages", () => {
    const stats = calculateTournamentStatistics(tournament([
      { id: "ab", homeTeamId: "a", awayTeamId: "b", result: { homeGoals: 2, awayGoals: 0 } },
      { id: "cd", homeTeamId: "c", awayTeamId: "d", result: { homeGoals: 1, awayGoals: 1 } },
      { id: "ac", homeTeamId: "a", awayTeamId: "c", result: { homeGoals: 0, awayGoals: 3 } },
      { id: "bd", homeTeamId: "b", awayTeamId: "d" },
    ]));

    expect(stats).toMatchObject({
      played: 3,
      pending: 1,
      homeWins: 1,
      draws: 1,
      awayWins: 1,
      totalGoals: 7,
      averageGoals: 7 / 3,
      progressPercent: 75,
    });
    expect(stats.standings.find(({ teamId }) => teamId === "a")).toMatchObject({
      played: 2,
      wins: 1,
      goalsFor: 2,
      goalsAgainst: 3,
      goalDifference: -1,
      points: 3,
    });
  });

  it("confirms a champion only for a complete league with a unique points leader", () => {
    const leagueTeams = teams.slice(0, 3).map(({ id, name }) => ({ id, name }));
    const stats = calculateTournamentStatistics(tournament([
      { id: "ab", homeTeamId: "a", awayTeamId: "b", result: { homeGoals: 2, awayGoals: 0 } },
      { id: "ac", homeTeamId: "a", awayTeamId: "c", result: { homeGoals: 1, awayGoals: 0 } },
      { id: "bc", homeTeamId: "b", awayTeamId: "c", result: { homeGoals: 2, awayGoals: 0 } },
    ], { teams: leagueTeams }));
    expect(stats.championTeamId).toBe("a");
    expect(stats.progressLabel).toBe("Partidos programados completos");
  });

  it("uses configured tie-breakers to confirm a complete league champion", () => {
    const leagueTeams = teams.slice(0, 3).map(({ id, name }) => ({ id, name }));
    const stats = calculateTournamentStatistics(tournament([
      { id: "ab", homeTeamId: "a", awayTeamId: "b", result: { homeGoals: 1, awayGoals: 0 } },
      { id: "ac", homeTeamId: "a", awayTeamId: "c", result: { homeGoals: 0, awayGoals: 2 } },
      { id: "bc", homeTeamId: "b", awayTeamId: "c", result: { homeGoals: 1, awayGoals: 0 } },
    ], { teams: leagueTeams }));
    expect(stats.standings.map(({ points }) => points)).toEqual([3, 3, 3]);
    expect(stats.championTeamId).toBe("c");
  });

  it("does not classify invalid or incomplete results as played", () => {
    const incomplete = { homeGoals: 1 } as MatchResult;
    const stats = calculateTournamentStatistics(tournament([
      { id: "valid", homeTeamId: "a", awayTeamId: "b", result: { homeGoals: 1, awayGoals: 0 } },
      { id: "invalid", homeTeamId: "c", awayTeamId: "d", result: { homeGoals: 100, awayGoals: 2 } },
      { id: "incomplete", homeTeamId: "a", awayTeamId: "c", result: incomplete },
    ]));
    expect(stats).toMatchObject({ played: 1, incomplete: 2, homeWins: 1, draws: 0, totalGoals: 1 });
    expect(stats.progressLabel).toBe("Hay resultados incompletos o inválidos");
    expect(stats.standings.find(({ teamId }) => teamId === "d")?.played).toBe(0);
  });

  it("excludes structurally invalid match details from individual and scorer statistics", () => {
    const stats = calculateTournamentStatistics(tournament([{
      id: "ab",
      homeTeamId: "a",
      awayTeamId: "b",
      result: { homeGoals: 1, awayGoals: 0 },
      goalScorers: [{ teamId: "a", playerName: "Autor registrado" }],
      events: [{
        id: "invalid-card",
        type: "yellow-card",
        teamId: "a",
        playerId: "unregistered-player",
        playerName: "Jugador sin referencia",
      }],
    }]));

    expect(stats).toMatchObject({ played: 1, invalidDetails: 1 });
    expect(stats.standings.find(({ teamId }) => teamId === "a")?.played).toBe(1);
    expect(stats.topScorers).toEqual([]);
    expect(stats.individualStatistics).toEqual([]);
  });

  it("filters by phase and group without including inter-group matches", () => {
    const staged = tournament([
      { id: "a-b", homeTeamId: "a", awayTeamId: "b", result: { homeGoals: 1, awayGoals: 0 } },
      { id: "a-c", homeTeamId: "a", awayTeamId: "c", result: { homeGoals: 5, awayGoals: 0 } },
      { id: "c-d", homeTeamId: "c", awayTeamId: "d", result: { homeGoals: 0, awayGoals: 0 } },
    ], {
      format: "staged",
      matchdays: [
        {
          number: 1,
          leg: 1,
          phaseName: "Fase de grupos",
          fixtures: [
            { id: "a-b", homeTeamId: "a", awayTeamId: "b", result: { homeGoals: 1, awayGoals: 0 } },
            { id: "a-c", homeTeamId: "a", awayTeamId: "c", result: { homeGoals: 5, awayGoals: 0 } },
          ],
        },
        {
          number: 1,
          leg: 2,
          phaseName: "Final",
          fixtures: [{ id: "final", homeTeamId: "c", awayTeamId: "d" }],
        },
      ],
      knockoutStages: [{ name: "Final", legs: 1 }],
    });
    const stats = calculateTournamentStatistics(staged, {
      phaseName: "Fase de grupos",
      groupName: "Grupo A",
    });
    expect(stats.played).toBe(1);
    expect(stats.totalGoals).toBe(1);
    expect(stats.standings.map(({ teamId }) => teamId).sort()).toEqual(["a", "b"]);
    expect(stats.championTeamId).toBeUndefined();
  });

  it("keeps zero goals against as the defensive best and handles historical tournaments", () => {
    const historical = tournament([
      { id: "ab", homeTeamId: "a", awayTeamId: "b", result: { homeGoals: 0, awayGoals: 0 } },
    ], { format: undefined, competitionType: undefined });
    const stats = calculateTournamentStatistics(historical);
    expect(stats.standings.find(({ teamId }) => teamId === "a")).toMatchObject({
      goalsAgainst: 0,
      draws: 1,
      points: 1,
    });
    expect(stats.championTeamId).toBeUndefined();
    expect(stats.scorerDataAvailable).toBe(false);
    expect(stats.topScorers).toEqual([]);
  });

  it("confirms a resolved cup final but not an unspecified staged format", () => {
    const final = tournament([
      {
        id: "final",
        homeTeamId: "a",
        awayTeamId: "b",
        knockoutResolution: "penalties",
        result: {
          homeGoals: 1,
          awayGoals: 1,
          penalties: { homeGoals: 4, awayGoals: 3 },
        },
      },
    ], {
      format: "staged",
      competitionType: "cup",
      knockoutStages: [{ name: "Final", legs: 1 }],
      matchdays: [{
        number: 1,
        leg: 1,
        phaseName: "Final",
        fixtures: [{
          id: "final",
          homeTeamId: "a",
          awayTeamId: "b",
          knockoutResolution: "penalties",
          result: {
            homeGoals: 1,
            awayGoals: 1,
            penalties: { homeGoals: 4, awayGoals: 3 },
          },
        }],
      }],
    });
    expect(calculateTournamentStatistics(final).championTeamId).toBe("a");
    expect(calculateTournamentStatistics({
      ...final,
      knockoutStages: undefined,
    }).championTeamId).toBeUndefined();
  });

  it("records and edits scorers without changing scores and rejects nonparticipants", () => {
    const saved: Tournament[] = [];
    const repository: TournamentRepository = {
      save: (value) => saved.push(value),
      saveWithActivity: (value) => { saved.push(value); },
      recordActivity: () => undefined,
      findAll: () => saved,
    };
    const original = tournament([{
      id: "ab",
      homeTeamId: "a",
      awayTeamId: "b",
      result: { homeGoals: 2, awayGoals: 0 },
    }]);
    const updated = updateMatchGoalScorers(original, "ab", [{
      teamId: "a",
      playerName: "Jugador Alfa",
      minute: 15,
      type: "regular",
    }], repository);
    expect(updated.matchdays[0].fixtures[0].result).toEqual({ homeGoals: 2, awayGoals: 0 });
    expect(calculateTournamentStatistics(updated).topScorers).toMatchObject([
      { playerName: "Jugador Alfa", teamId: "a", goals: 1 },
    ]);
    expect(() => updateMatchGoalScorers(updated, "ab", [{
      teamId: "c",
      playerName: "No participante",
    }], repository)).toThrow("no participó");
  });

  it("does not credit an own-goal to its author in the individual goals ranking", () => {
    const stats = calculateTournamentStatistics(tournament([{
      id: "ab",
      homeTeamId: "a",
      awayTeamId: "b",
      result: { homeGoals: 2, awayGoals: 0 },
      goalScorers: [
        { teamId: "a", playerName: "Autor normal", type: "regular" },
        { teamId: "b", playerName: "Autor de autogol", type: "own-goal" },
      ],
    }]));
    expect(stats.topScorerRecordCount).toBe(2);
    expect(stats.topScorers.map(({ playerName }) => playerName)).toEqual(["Autor normal"]);
  });
});

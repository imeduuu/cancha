import { describe, expect, it } from "vitest";
import type { Tournament } from "../entities/tournament";
import type { TournamentRepository } from "../../application/ports/tournament-repository";
import { createTournamentSeason } from "../../application/use-cases/create-tournament-season";
import { setTournamentArchived } from "../../application/use-cases/set-tournament-archived";
import {
  canStartNewSeason,
  compareTournamentSeasons,
  getFinalStandings,
  getTournamentCompletionStatus,
} from "./tournament-history";
import { generateRoundRobinSchedule } from "./round-robin-scheduler";

function makeTournament(
  season: number | undefined,
  idSuffix: string,
  result: { homeGoals: number; awayGoals: number } = { homeGoals: 2, awayGoals: 0 },
): Tournament {
  const teams = [
    { id: "club-a", name: "Club A" },
    { id: "club-b", name: "Club B" },
  ];
  const matchdays = generateRoundRobinSchedule(teams, 1).map((matchday) => ({
    ...matchday,
    fixtures: matchday.fixtures.map((fixture) => ({
      ...fixture,
      id: `fixture-${idSuffix}`,
      result,
      goalScorers: [{ teamId: fixture.homeTeamId, playerName: "Goleador" }],
    })),
  }));
  return {
    id: `competition-${idSuffix}`,
    competitionId: "competition",
    name: `Competición ${season ?? ""}`,
    teams,
    legs: 1,
    tieBreakers: ["goalDifference", "goalsFor"],
    pointsSystem: { win: 3, draw: 1, loss: 0 },
    matchdays,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...(season ? { season } : {}),
    format: "round-robin",
    competitionType: "league",
    competitionRules: {
      season: season ?? 2026,
      points: { win: 3, draw: 1, loss: 0 },
      tieBreakers: ["goalDifference", "goalsFor"],
      verification: { standings: "verified", placements: "provisional" },
      placementsNote: "Regla vieja",
      internationalQualification: {
        verification: "provisional",
        slots: [{ destination: "Copa", position: 1 }],
      },
      relegationAverage: {
        verification: "provisional",
        seasons: [2024, 2025],
        relegatedCount: 1,
      },
    },
  };
}

function repository(initial: Tournament[] = []) {
  const tournaments = [...initial];
  const port: TournamentRepository = {
    save: (saved) => {
      const existingIndex = tournaments.findIndex(({ id }) => id === saved.id);
      if (existingIndex >= 0) tournaments.splice(existingIndex, 1);
      tournaments.push(saved);
    },
    saveWithActivity: (saved) => {
      const existingIndex = tournaments.findIndex(({ id }) => id === saved.id);
      if (existingIndex >= 0) tournaments.splice(existingIndex, 1);
      tournaments.push(saved);
    },
    recordActivity: () => undefined,
    findAll: () => [...tournaments],
  };
  return { port, tournaments };
}

describe("tournament season history", () => {
  it("creates a new compatible season with new tournament and fixture IDs, without touching the old results", () => {
    const basePrevious = makeTournament(2025, "2025");
    const previous: Tournament = {
      ...basePrevious,
      lineupRules: { startersPerTeam: 9 },
      matchRegulations: {
        schemaVersion: 1,
        season: 2025,
        verification: "verified",
        lineup: { requiredStarters: 9, maxSubstitutes: 7 },
        substitutions: { maxCount: 5 },
      },
      matchdays: basePrevious.matchdays.map((matchday) => ({
        ...matchday,
        fixtures: matchday.fixtures.map((fixture) => ({
          ...fixture,
          schedule: { date: "2025-08-10", time: "17:00", venue: "Estadio anterior" },
          lineups: {
            home: { starters: [], substitutes: [], status: "incomplete" },
            away: { starters: [], substitutes: [], status: "incomplete" },
          },
          substitutions: [],
          events: [{ id: "goal-event", type: "goal", teamId: fixture.homeTeamId, playerName: "Goleador" }],
        })),
      })),
    };
    const { port, tournaments } = repository([previous]);
    let id = 0;
    const next = createTournamentSeason(
      previous,
      2026,
      port,
      () => `generated-${++id}`,
      () => new Date("2026-01-01T00:00:00.000Z"),
    );
    expect(next).toMatchObject({
      competitionId: "competition",
      season: 2026,
      format: "round-robin",
      pointsSystem: previous.pointsSystem,
      tieBreakers: previous.tieBreakers,
      archived: false,
    });
    expect(next.id).not.toBe(previous.id);
    expect(next.matchdays[0].fixtures[0].id).not.toBe(previous.matchdays[0].fixtures[0].id);
    expect(next.matchdays[0].fixtures[0]).not.toHaveProperty("result");
    expect(next.matchdays[0].fixtures[0]).not.toHaveProperty("goalScorers");
    expect(next.matchdays[0].fixtures[0]).not.toHaveProperty("schedule");
    expect(next.teams).toEqual(previous.teams);
    expect(next.lineupRules).toEqual({ startersPerTeam: 9 });
    expect(next.matchRegulations).toMatchObject({
      schemaVersion: 1,
      season: 2026,
      verification: "pending",
      lineup: { requiredStarters: 9, maxSubstitutes: 7 },
      substitutions: { maxCount: 5 },
    });
    expect(next.matchdays[0].fixtures[0]).not.toHaveProperty("lineups");
    expect(next.matchdays[0].fixtures[0]).not.toHaveProperty("events");
    expect(next.competitionRules).toMatchObject({
      season: 2026,
      verification: { standings: "pending", placements: "pending" },
    });
    expect(next.competitionRules?.internationalQualification).toBeUndefined();
    expect(next.competitionRules?.relegationAverage).toBeUndefined();
    expect(next.competitionRules?.placementsNote).toContain("pendientes de verificar");
    expect(tournaments[0]).toBe(previous);
    expect(tournaments[0].matchdays[0].fixtures[0].result).toEqual({ homeGoals: 2, awayGoals: 0 });
    expect(tournaments).toHaveLength(2);
  });

  it("refuses an existing competition-season and formats that require a fresh review", () => {
    const source = makeTournament(2025, "2025");
    expect(() => createTournamentSeason(source, 2026, repository([
      source,
      { ...source, id: "competition-2026", season: 2026 },
    ]).port)).toThrow("Ya existe una temporada 2026");
    expect(canStartNewSeason({ ...source, format: "staged" })).toBe(false);
    expect(() => createTournamentSeason(
      { ...source, competitionType: "cup" },
      2026,
      repository().port,
    )).toThrow("requiere revisar la configuración");
  });

  it("archives and restores a tournament without changing match data", () => {
    const source = makeTournament(2025, "2025");
    const store = repository();
    const archived = setTournamentArchived(source, true, store.port);
    expect(archived.archived).toBe(true);
    expect(setTournamentArchived(archived, false, store.port).archived).toBe(false);
    expect(source.matchdays).toEqual(archived.matchdays);
  });

  it("reports champions and final standings only for complete valid schedules", () => {
    const completed = makeTournament(2025, "2025");
    expect(getTournamentCompletionStatus(completed)).toBe("Finalizado");
    expect(getFinalStandings(completed)?.[0].teamId)
      .toBe(completed.matchdays[0].fixtures[0].homeTeamId);
    const incomplete = {
      ...completed,
      matchdays: completed.matchdays.map((matchday) => ({
        ...matchday,
        fixtures: matchday.fixtures.map((fixture) => ({
          ...fixture,
          result: { homeGoals: 100, awayGoals: 0 },
        })),
      })),
    };
    expect(getTournamentCompletionStatus(incomplete)).toBe("Incompleto");
    expect(getFinalStandings(incomplete)).toBeUndefined();
  });

  it("compares compatible complete seasons by stable ID and marks name-only matches as uncertain", () => {
    const previous = makeTournament(2025, "old");
    const current = makeTournament(2026, "new", { homeGoals: 1, awayGoals: 0 });
    const byStableId = compareTournamentSeasons(current, previous);
    expect(byStableId.compatible).toBe(true);
    expect(byStableId.teams[0].identity).toBe("stable-id");
    expect(byStableId.teams[0].current?.points).toBe(3);
    expect(byStableId.teams[0].previous?.goalDifference).toBe(2);

    const changedIds = {
      ...current,
      teams: current.teams.map((team) => ({ ...team, id: `new-${team.id}` })),
      matchdays: current.matchdays.map((matchday) => ({
        ...matchday,
        fixtures: matchday.fixtures.map((fixture) => ({
          ...fixture,
          homeTeamId: `new-${fixture.homeTeamId}`,
          awayTeamId: `new-${fixture.awayTeamId}`,
        })),
      })),
    };
    const byName = compareTournamentSeasons(changedIds, previous);
    expect(byName.teams[0].identity).toBe("possible-name-match");
  });

  it("warns on incompatible scoring and preserves historical records without explicit season IDs", () => {
    const previous = makeTournament(undefined, "legacy");
    const current = makeTournament(2026, "new");
    expect(getTournamentCompletionStatus(previous)).toBe("Finalizado");
    expect(previous.season).toBeUndefined();
    expect(compareTournamentSeasons(current, {
      ...previous,
      season: 2025,
      competitionRules: { ...previous.competitionRules!, season: 2025, points: { win: 2, draw: 1, loss: 0 } },
      pointsSystem: { win: 2, draw: 1, loss: 0 },
    })).toMatchObject({
      compatible: false,
      warning: "Los formatos o sistemas de puntos difieren; revisa la configuración antes de comparar.",
    });
    expect(compareTournamentSeasons(current, previous).warning)
      .toContain("dos temporadas distintas");
  });
});

it("keeps a completed league provisional when its standings rules are explicitly pending",()=>{
 const verified=makeTournament(2026,"audit");
 const pending={...verified,competitionRules:{...verified.competitionRules!,verification:{standings:"pending" as const,placements:"verified" as const}}};
 expect(getTournamentCompletionStatus(pending)).not.toBe("Finalizado");expect(getFinalStandings(pending)).toBeUndefined();
 // Independent cup slots may remain provisional without invalidating a verified league table.
 expect(getTournamentCompletionStatus(verified)).toBe("Finalizado");
});

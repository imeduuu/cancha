import { describe, expect, it } from "vitest";
import type { ActivityEvent } from "../../domain/entities/activity-event";
import type { SportsUniverseLibrary } from "../../domain/entities/sports-universe";
import type { Tournament } from "../../domain/entities/tournament";
import { projectSportsUniverseDashboard } from "./sports-universe-dashboard";

const teams = [
  { id: "club-a", name: "Club A" },
  { id: "club-b", name: "Club B" },
];

function tournament(id: string, name: string, season = 2026): Tournament {
  return {
    id,
    competitionId: id,
    name,
    season,
    teams,
    legs: 1,
    tieBreakers: ["goalDifference", "goalsFor"],
    pointsSystem: { win: 3, draw: 1, loss: 0 },
    createdAt: "2026-01-01T00:00:00.000Z",
    matchdays: [{
      number: 2,
      leg: 1,
      fixtures: [{ id: `${id}-fixture`, homeTeamId: "club-a", awayTeamId: "club-b" }],
    }],
  };
}

function library(
  activeUniverseId: string | null,
  assignments: Record<string, string> = {},
): SportsUniverseLibrary {
  return {
    version: 1,
    activeUniverseId,
    universes: [
      { id: "universe-a", name: "Universo A", description: "Escenario principal" },
      { id: "universe-b", name: "Universo B" },
    ],
    assignments,
  };
}

describe("sports universe dashboard projection", () => {
  it("shows a readable empty universe without creating data", () => {
    const empty = projectSportsUniverseDashboard([], [], library("universe-a"));
    expect(empty.universeName).toBe("Universo A");
    expect(empty.description).toBe("Escenario principal");
    expect(empty.counts).toEqual({
      competitions: 0,
      seasons: 0,
      inProgress: 0,
      completed: 0,
      prepared: 0,
      configurationPending: 0,
    });
    expect(empty.actions).toEqual([]);
    expect(empty.recentActivity).toEqual([]);
  });

  it("counts and presents only competitions assigned to the active universe", () => {
    const local = tournament("league-a-2026", "Liga A");
    const foreign = tournament("league-b-2026", "Liga B");
    const dashboard = projectSportsUniverseDashboard(
      [local, foreign],
      [],
      library("universe-a", {
        [local.id]: "universe-a",
        [foreign.id]: "universe-b",
      }),
    );
    expect(dashboard.counts.seasons).toBe(1);
    expect(dashboard.competitions.map(({ tournament: item }) => item.id)).toEqual([local.id]);
    expect(dashboard.competitions[0].competition).toBe("Liga A");
  });

  it("counts grouped competitions separately from their individual seasons", () => {
    const first = tournament("league-2025", "Liga única", 2025);
    const second = {
      ...tournament("league-2026", "Liga única", 2026),
      competitionId: first.competitionId,
    };
    const dashboard = projectSportsUniverseDashboard([first, second], [], library(null));
    expect(dashboard.counts).toMatchObject({
      competitions: 1,
      seasons: 2,
      inProgress: 1,
      completed: 0,
    });
  });

  it("preserves undated fixtures by their recorded round and sorts only real dates", () => {
    const undated = tournament("undated-2026", "Sin fechas");
    const dated = {
      ...tournament("dated-2026", "Con fecha"),
      matchdays: [{
        number: 5,
        leg: 1,
        fixtures: [{
          id: "dated-fixture",
          homeTeamId: "club-a",
          awayTeamId: "club-b",
          schedule: { date: "2026-11-02" },
        }],
      }],
    };
    const dashboard = projectSportsUniverseDashboard(
      [undated, dated],
      [],
      library(null),
    );
    expect(dashboard.datedFixtures.map(({ date }) => date)).toEqual(["2026-11-02"]);
    expect(dashboard.undatedFixtures).toMatchObject([{
      matchdayLabel: "Jornada 2",
      homeTeam: "Club A",
      awayTeam: "Club B",
    }]);
  });

  it("distinguishes provisional tables, pending placements, and prepared seasons", () => {
    const prepared = {
      ...tournament("prepared-2026", "Temporada preparada"),
      seasonPreparation: {
        schemaVersion: 1 as const,
        sourceTournamentIds: [],
        plannedParticipants: ["club-a", "club-b"],
        calendarReviews: [],
      },
      competitionRules: {
        season: 2026,
        verification: { standings: "provisional" as const, placements: "pending" as const },
      },
      matchdays: [{
        number: 1,
        leg: 1,
        fixtures: [{
          id: "played",
          homeTeamId: "club-a",
          awayTeamId: "club-b",
          result: { homeGoals: 2, awayGoals: 0 },
        }],
      }],
    };
    const dashboard = projectSportsUniverseDashboard(
      [prepared],
      [],
      library("universe-a", { [prepared.id]: "universe-a" }),
    );
    expect(dashboard.counts.prepared).toBe(1);
    expect(dashboard.competitions[0].tableStatus).toBe("Tabla provisional");
    expect(dashboard.competitions[0].placementStatus).toBe("Pendiente de verificación");
    expect(dashboard.competitions[0].topPositions[0]).toEqual({ name: "Club A", points: 3 });
  });

  it("labels final positions verified only when the season and both rule checks are verified", () => {
    const completed: Tournament = {
      ...tournament("completed-2026", "Liga completa"),
      competitionRules: {
        season: 2026,
        verification: { standings: "verified", placements: "verified" },
      },
      matchdays: [{
        number: 1,
        leg: 1,
        fixtures: [{
          id: "final",
          homeTeamId: "club-a",
          awayTeamId: "club-b",
          result: { homeGoals: 2, awayGoals: 0 },
        }],
      }],
    };
    const dashboard = projectSportsUniverseDashboard(
      [completed],
      [],
      library("universe-a", { [completed.id]: "universe-a" }),
    );
    expect(dashboard.competitions[0].status).toBe("Finalizado");
    expect(dashboard.competitions[0].tableStatus).toBe("Posiciones verificadas según reglamento");
    expect(dashboard.counts.completed).toBe(1);
  });

  it("does not attribute activity or club identities by matching names or local IDs", () => {
    const first = tournament("first-2026", "Liga igual");
    const second = tournament("second-2026", "Liga igual");
    const events: ActivityEvent[] = [
      {
        id: "first-event",
        occurredAt: "2026-10-01T12:00:00.000Z",
        action: "matches-simulated",
        tournamentId: first.id,
        universeId: "universe-a",
        tournamentName: "Liga igual",
        summary: "Actividad A",
      },
      {
        id: "second-event",
        occurredAt: "2026-10-02T12:00:00.000Z",
        action: "matches-simulated",
        tournamentId: second.id,
        universeId: "universe-b",
        tournamentName: "Liga igual",
        summary: "Actividad B",
      },
      {
        id: "misattributed-event",
        occurredAt: "2026-10-04T12:00:00.000Z",
        action: "matches-simulated",
        tournamentId: second.id,
        universeId: "universe-a",
        tournamentName: "Liga igual",
        summary: "No mezclar el universo del torneo",
      },
      {
        id: "misattributed-legacy-season",
        occurredAt: "2026-10-05T12:00:00.000Z",
        action: "season-created",
        tournamentId: second.id,
        tournamentName: "Liga igual",
        summary: "No atribuir una temporada cuyo origen está en otro universo",
        after: { tournamentIds: [first.id] },
      },
      {
        id: "ambiguous-legacy-event",
        occurredAt: "2026-10-03T12:00:00.000Z",
        action: "matches-simulated",
        tournamentId: "missing-local-id",
        tournamentName: "Liga igual",
        summary: "No atribuir por nombre",
      },
    ];
    const dashboard = projectSportsUniverseDashboard(
      [first, second],
      events,
      library("universe-a", {
        [first.id]: "universe-a",
        [second.id]: "universe-b",
      }),
    );
    expect(dashboard.recentActivity.map(({ id }) => id)).toEqual(["first-event"]);
    expect(dashboard.competitions).toHaveLength(1);
    expect(dashboard.competitions[0].tournament.teams.map(({ id }) => id))
      .toEqual(["club-a", "club-b"]);
  });

  it("keeps older libraries available as unassigned without assigning their tournaments", () => {
    const legacy = tournament("legacy-2025", "Liga antigua", 2025);
    const oldLibrary: SportsUniverseLibrary = {
      version: 1,
      activeUniverseId: null,
      universes: [],
      assignments: {},
    };
    const dashboard = projectSportsUniverseDashboard([legacy], [], oldLibrary);
    expect(dashboard.universeName).toBe("Biblioteca anterior · sin asignar");
    expect(dashboard.competitions.map(({ tournament: item }) => item.id)).toEqual([legacy.id]);
    expect(oldLibrary.assignments).toEqual({});
  });
});

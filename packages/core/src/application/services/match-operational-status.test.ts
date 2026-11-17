import { describe, expect, it } from "vitest";
import type { Tournament } from "../../domain/entities/tournament";
import type { ActivityEvent } from "../../domain/entities/activity-event";
import { updateFixtureOperationalState } from "../use-cases/update-fixture-operational-state";
import { advanceTournamentProgress } from "../use-cases/advance-tournament-progress";
import { updateFixtureSchedule } from "../use-cases/update-fixture-schedule";
import type { TournamentRepository } from "../ports/tournament-repository";
import {
  getAllowedOperationalTransitions,
  getOperationalMatchStatus,
  validateOperationalTransition,
} from "../../domain/services/match-operational-status";
import { getCompletedStageWinners } from "../../domain/services/official-cup-progression";
import { getCompetitionAlerts } from "../../domain/services/competition-alerts";
import { calculateTournamentStatistics } from "../../domain/services/tournament-statistics";
import { simulateFixtures } from "../use-cases/simulate-fixtures";

function makeTournament(): Tournament {
  return {
    id: "cup-test",
    name: "Copa de prueba",
    season: 2026,
    teams: [{ id: "home", name: "Local" }, { id: "away", name: "Visita" }],
    legs: 1,
    tieBreakers: [],
    pointsSystem: { win: 3, draw: 1, loss: 0 },
    competitionType: "cup",
    format: "staged",
    knockoutStages: [{ name: "Final", legs: 1 }],
    matchdays: [{
      number: 1,
      leg: 1,
      phaseName: "Final",
      fixtures: [{
        id: "final",
        homeTeamId: "home",
        awayTeamId: "away",
        schedule: { date: "2026-10-15", time: "20:00" },
        result: { homeGoals: 1, awayGoals: 0 },
        events: [{ id: "goal-one", type: "goal", teamId: "home", playerName: "Jugador" }],
      }],
    }],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function fixtureOf(tournament: Tournament) {
  return tournament.matchdays[0].fixtures[0];
}

function createRepository(): TournamentRepository & { saved: Tournament[]; activity: ActivityEvent[] } {
  const repository: TournamentRepository & { saved: Tournament[]; activity: ActivityEvent[] } = {
    saved: [],
    activity: [],
    save(tournament) {
      this.saved.push(tournament);
    },
    saveWithActivity(tournament, event) {
      this.save(tournament);
      this.activity.push(event);
    },
    recordActivity() {},
    findAll() {
      return [...this.saved];
    },
  };
  return repository;
}

function makeTwoRoundCup(): Tournament {
  return {
    id: "cup-two-rounds",
    name: "Copa de dos rondas",
    teams: ["a", "b", "c", "d"].map((id) => ({ id, name: id.toUpperCase() })),
    legs: 2,
    tieBreakers: [],
    competitionType: "cup",
    knockoutStages: [
      { name: "Semifinales", legs: 1 },
      { name: "Final", legs: 1 },
    ],
    matchdays: [
      {
        number: 1,
        leg: 1,
        phaseName: "Semifinales",
        fixtures: [
          {
            id: "semi-a",
            homeTeamId: "a",
            awayTeamId: "b",
            result: { homeGoals: 1, awayGoals: 0 },
          },
          {
            id: "semi-c",
            homeTeamId: "c",
            awayTeamId: "d",
            result: { homeGoals: 1, awayGoals: 0 },
          },
        ],
      },
      {
        number: 1,
        leg: 2,
        phaseName: "Final",
        fixtures: [],
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("operational match statuses", () => {
  it("infers a legacy status without inventing postponement or cancellation", () => {
    const tournament = makeTournament();
    const fixture = fixtureOf(tournament);
    expect(getOperationalMatchStatus(fixture)).toBe("finished");
    expect(getOperationalMatchStatus({
      id: "old-pending",
      homeTeamId: "home",
      awayTeamId: "away",
    })).toBe("unscheduled");
  });

  it("allows only defined transitions and requires complete programming before scheduling", () => {
    const tournament = makeTournament();
    const matchday = tournament.matchdays[0];
    const fixture = { ...fixtureOf(tournament), result: undefined, schedule: undefined };
    expect(getAllowedOperationalTransitions("unscheduled")).toEqual(["scheduled"]);
    expect(validateOperationalTransition(tournament, matchday, fixture, "scheduled"))
      .toContain("fecha y hora completas");
    expect(validateOperationalTransition(tournament, matchday, fixture, "cancelled"))
      .toContain("No se permite");
  });

  it("requires confirmation to postpone a result-bearing match and preserves its sporting data", () => {
    const tournament = makeTournament();
    const fixture = fixtureOf(tournament);
    const repository = createRepository();
    expect(() => updateFixtureOperationalState(
      tournament, fixture.id, "postponed", "Revisión arbitral", repository,
      () => new Date("2026-10-14T18:00:00.000Z"),
    )).toThrow("Confirma");
    expect(repository.saved).toHaveLength(0);

    const updated = updateFixtureOperationalState(
      tournament, fixture.id, "postponed", "Revisión arbitral", repository,
      () => new Date("2026-10-14T18:00:00.000Z"), true,
    );
    expect(fixtureOf(updated).result).toEqual(fixture.result);
    expect(fixtureOf(updated).events).toEqual(fixture.events);
    expect(fixtureOf(updated).operationalState).toEqual({
      status: "postponed",
      updatedAt: "2026-10-14T18:00:00.000Z",
      note: "Revisión arbitral",
    });
    expect(calculateTournamentStatistics(updated).played).toBe(0);
    expect(calculateTournamentStatistics(updated).pending).toBe(1);
    expect(getCompetitionAlerts(updated, new Date("2026-10-14T12:00:00.000Z"))
      .some(({ type }) => type === "postponed-match")).toBe(true);
  });

  it("reconciles a generated final when a semifinal result stops counting", () => {
    const tournament = makeTwoRoundCup();
    const generated = advanceTournamentProgress(tournament);
    const final = generated.matchdays.find(({ phaseName }) => phaseName === "Final");
    if (!final?.fixtures[0]) throw new Error("No se generó la final de prueba.");
    const finalWithData: Tournament = {
      ...generated,
      matchdays: generated.matchdays.map((matchday) => matchday !== final
        ? matchday
        : {
          ...matchday,
          fixtures: [{
            ...final.fixtures[0],
            result: { homeGoals: 2, awayGoals: 1 },
            events: [{ id: "final-goal", type: "goal", teamId: final.fixtures[0].homeTeamId, playerName: "Jugador" }],
            lineups: {
              home: { starters: [], substitutes: [], status: "incomplete" },
              away: { starters: [], substitutes: [], status: "incomplete" },
            },
          }],
        }),
    };
    const repository = createRepository();
    const updated = updateFixtureOperationalState(
      finalWithData,
      "semi-a",
      "suspended",
      "Partido suspendido",
      repository,
      () => new Date("2026-06-01T12:00:00.000Z"),
      true,
    );

    expect(fixtureOf(updated).result).toEqual({ homeGoals: 1, awayGoals: 0 });
    expect(fixtureOf(updated).operationalState?.status).toBe("suspended");
    const reconciledFinal = updated.matchdays.find(({ phaseName }) => phaseName === "Final");
    expect(reconciledFinal?.fixtures).toEqual([]);
    expect(repository.saved).toEqual([updated]);
    expect(repository.activity).toHaveLength(1);
  });

  it("generates the next round when a valid in-progress match is finalized", () => {
    const tournament = makeTwoRoundCup();
    const inProgress: Tournament = {
      ...tournament,
      matchdays: tournament.matchdays.map((matchday) => ({
        ...matchday,
        fixtures: matchday.fixtures.map((fixture) => fixture.id === "semi-a"
          ? {
            ...fixture,
            operationalState: {
              status: "in-progress" as const,
              updatedAt: "2026-06-01T10:00:00.000Z",
            },
          }
          : fixture),
      })),
    };
    const updated = updateFixtureOperationalState(
      inProgress,
      "semi-a",
      "finished",
      "",
      createRepository(),
      () => new Date("2026-06-01T12:00:00.000Z"),
    );

    const final = updated.matchdays.find(({ phaseName }) => phaseName === "Final");
    expect(final?.fixtures).toHaveLength(1);
    expect(final?.fixtures[0]).toMatchObject({ homeTeamId: "a", awayTeamId: "c" });
  });

  it("does not mutate or persist a partial tournament when coordinated saving fails", () => {
    const tournament = makeTwoRoundCup();
    const repository: TournamentRepository = {
      save: () => { throw new Error("save must not be called"); },
      saveWithActivity: () => { throw new Error("storage failed"); },
      findAll: () => [],
    };

    expect(() => updateFixtureOperationalState(
      tournament,
      "semi-a",
      "suspended",
      "Partido suspendido",
      repository,
      () => new Date("2026-06-01T12:00:00.000Z"),
      true,
    )).toThrow("storage failed");
    expect(tournament.matchdays[0].fixtures[0].operationalState).toBeUndefined();
    expect(tournament.matchdays.find(({ phaseName }) => phaseName === "Final")?.fixtures)
      .toEqual([]);
  });

  it("suspends and resumes a match without duplicating its saved events", () => {
    const tournament = makeTournament();
    const fixture = fixtureOf(tournament);
    const repository = createRepository();
    const suspended = updateFixtureOperationalState(
      tournament, fixture.id, "suspended", "", repository, () => new Date(), true,
    );
    expect(getCompetitionAlerts(suspended).some(({ type }) => type === "suspended-match")).toBe(true);
    const resumed = updateFixtureOperationalState(
      suspended, fixture.id, "in-progress", "", repository, () => new Date(), true,
    );
    expect(fixtureOf(resumed).events).toEqual(fixture.events);
    expect(fixtureOf(resumed).events).toHaveLength(1);
    expect(calculateTournamentStatistics(resumed).played).toBe(0);
  });

  it("does not give cancelled fixtures a result or advance the knockout stage", () => {
    const tournament = makeTournament();
    const matchday = tournament.matchdays[0];
    const withoutResult: Tournament = {
      ...tournament,
      matchdays: [{
        ...matchday,
        fixtures: [{
          ...fixtureOf(tournament),
          result: undefined,
          events: undefined,
          operationalState: {
            status: "cancelled",
            updatedAt: "2026-10-14T18:00:00.000Z",
          },
        }],
      }],
    };
    expect(fixtureOf(withoutResult).result).toBeUndefined();
    expect(getCompletedStageWinners(withoutResult.matchdays, withoutResult.knockoutStages![0]))
      .toBeUndefined();
    expect(calculateTournamentStatistics(withoutResult).cancelled).toBe(1);
    expect(calculateTournamentStatistics(withoutResult).played).toBe(0);
    expect(getCompetitionAlerts(withoutResult).some(({ type }) => type === "cancelled-match")).toBe(true);
    expect(() => simulateFixtures(withoutResult, ["final"], "pendingOnly", createRepository()))
      .toThrow("No se puede simular");
  });

  it("requires a valid recorded result to finalize, and only then resolves the knockout", () => {
    const tournament = makeTournament();
    const fixture = { ...fixtureOf(tournament), result: undefined, operationalState: {
      status: "in-progress" as const,
      updatedAt: "2026-10-14T18:00:00.000Z",
    } };
    const inProgress = {
      ...tournament,
      matchdays: [{ ...tournament.matchdays[0], fixtures: [fixture] }],
    };
    expect(validateOperationalTransition(inProgress, inProgress.matchdays[0], fixture, "finished"))
      .toContain("resultado deportivo válido");
    const resultReadyFixture = { ...fixture, result: { homeGoals: 1, awayGoals: 0 } };
    const resultReady = {
      ...inProgress,
      matchdays: [{ ...inProgress.matchdays[0], fixtures: [resultReadyFixture] }],
    };
    expect(validateOperationalTransition(
      resultReady,
      resultReady.matchdays[0],
      resultReadyFixture,
      "finished",
    )).toBeUndefined();
    const completedFixture = {
      ...resultReadyFixture,
      operationalState: { status: "finished" as const, updatedAt: "2026-10-14T18:01:00.000Z" },
    };
    const repository = createRepository();
    const completed = updateFixtureOperationalState(
      resultReady, fixture.id, "finished", "", repository,
      () => new Date("2026-10-14T18:01:00.000Z"),
    );
    expect(fixtureOf(completed)).toEqual(completedFixture);
    expect(getCompletedStageWinners(completed.matchdays, completed.knockoutStages![0]))
      .toEqual(["home"]);
  });

  it("reprograms a postponed match independently without changing its saved result", () => {
    const tournament = makeTournament();
    const postponed = {
      ...fixtureOf(tournament),
      operationalState: {
        status: "postponed" as const,
        updatedAt: "2026-10-14T18:00:00.000Z",
        note: "Aplazado",
      },
    };
    const postponedTournament = {
      ...tournament,
      matchdays: [{ ...tournament.matchdays[0], fixtures: [postponed] }],
    };
    const updated = updateFixtureSchedule(
      postponedTournament,
      postponed.id,
      { date: "2026-10-25", time: "20:30" },
      createRepository(),
    );
    expect(fixtureOf(updated).result).toEqual(postponed.result);
    expect(getOperationalMatchStatus(fixtureOf(updated))).toBe("postponed");
  });

  it("shows final-without-result as unresolved and isolates updates to the supplied season", () => {
    const tournament = makeTournament();
    const fixture = { ...fixtureOf(tournament), result: undefined, operationalState: {
      status: "finished" as const,
      updatedAt: "2026-10-14T18:00:00.000Z",
    } };
    const finishedMissingResult = {
      ...tournament,
      matchdays: [{ ...tournament.matchdays[0], fixtures: [fixture] }],
    };
    expect(getCompetitionAlerts(finishedMissingResult)
      .some(({ type, priority }) => type === "operational-result-mismatch" && priority === "critical"))
      .toBe(true);

    const repository = createRepository();
    const updated = updateFixtureOperationalState(
      tournament, "final", "suspended", "", repository, () => new Date(), true,
    );
    const otherSeason = { ...tournament, id: "cup-test-2025", season: 2025 };
    expect(repository.saved).toEqual([updated]);
    expect(fixtureOf(otherSeason).operationalState).toBeUndefined();
  });
});

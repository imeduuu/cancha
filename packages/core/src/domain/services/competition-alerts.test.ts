import { describe, expect, it } from "vitest";
import type { Tournament } from "../entities/tournament";
import { countCompetitionAlerts, getCompetitionAlerts } from "./competition-alerts";

function makeTournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: "competition-2026",
    name: "Liga de prueba",
    season: 2026,
    teams: [
      { id: "club-a", name: "Club A" },
      { id: "club-b", name: "Club B" },
    ],
    legs: 1,
    tieBreakers: ["goalDifference", "goalsFor"],
    pointsSystem: { win: 3, draw: 1, loss: 0 },
    matchdays: [{
      number: 1,
      leg: 1,
      fixtures: [{
        id: "match-a",
        homeTeamId: "club-a",
        awayTeamId: "club-b",
      }],
    }],
    createdAt: "2026-01-01T00:00:00.000Z",
    format: "round-robin",
    competitionType: "league",
    ...overrides,
  };
}

function alertsFor(tournament: Tournament, now = new Date(2026, 5, 1, 10, 0)) {
  return getCompetitionAlerts(tournament, now);
}

describe("competition alerts", () => {
  it("detects future pending fixtures and incomplete schedules without inventing dates", () => {
    const tournament = makeTournament({
      matchdays: [{
        number: 1,
        leg: 1,
        fixtures: [
          { id: "future", homeTeamId: "club-a", awayTeamId: "club-b", schedule: { date: "2026-06-02", time: "18:30" } },
          { id: "unassigned", homeTeamId: "club-b", awayTeamId: "club-a" },
        ],
      }],
    });
    const alerts = alertsFor(tournament);
    expect(alerts.find(({ fixtureId }) => fixtureId === "future")?.type).toBe("upcoming-match");
    expect(alerts.find(({ fixtureId }) => fixtureId === "unassigned")?.type).toBe("incomplete-schedule");
    expect(alerts.some(({ description }) => description.includes("2026-06-01"))).toBe(false);
  });

  it("flags a past scheduled pending fixture for review without calling it overdue", () => {
    const alerts = alertsFor(makeTournament({
      matchdays: [{
        number: 1,
        leg: 1,
        fixtures: [{
          id: "past",
          homeTeamId: "club-a",
          awayTeamId: "club-b",
          schedule: { date: "2026-05-31", time: "19:00" },
        }],
      }],
    }));
    const alert = alerts.find(({ type }) => type === "past-pending-match");
    expect(alert?.description).toContain("no consta si fue aplazado, suspendido o no disputado");
    expect(alert?.description).toContain("no se marca automáticamente como atrasado");
    expect(alert?.description).not.toContain("se considera oficialmente atrasado");
  });

  it("reports incomplete jornadas and invalid results without counting them as played", () => {
    const alerts = alertsFor(makeTournament({
      matchdays: [{
        number: 1,
        leg: 1,
        fixtures: [
          { id: "invalid", homeTeamId: "club-a", awayTeamId: "club-b", result: { homeGoals: -1, awayGoals: 0 } },
          { id: "pending", homeTeamId: "club-b", awayTeamId: "club-a" },
        ],
      }],
    }));
    expect(alerts.some(({ type, fixtureId }) => type === "invalid-match" && fixtureId === "invalid")).toBe(true);
    expect(alerts.some(({ type }) => type === "incomplete-matchday")).toBe(true);
    expect(countCompetitionAlerts(alerts).critical).toBe(1);
  });

  it("reports provisional regulations as informative and describes conditional rules", () => {
    const alerts = alertsFor(makeTournament({
      matchRegulations: { schemaVersion: 1, season: 2026, verification: "pending" },
      competitionRules: {
        season: 2026,
        points: { win: 3, draw: 1, loss: 0 },
        tieBreakers: ["goalDifference"],
        verification: { standings: "verified", placements: "verified" },
        conditionalPlacements: [{ description: "Clasificación a copa", status: "provisional" }],
      },
    }));
    const ruleAlert = alerts.find(({ type }) => type === "regulations-review");
    expect(ruleAlert?.priority).toBe("informative");
    expect(ruleAlert?.description).toContain("clasificaciones condicionales");
  });

  it("flags invalid individual detail records and invalid schedules separately", () => {
    const alerts = alertsFor(makeTournament({
      matchdays: [{
        number: 1,
        leg: 1,
        fixtures: [{
          id: "bad-details",
          homeTeamId: "club-a",
          awayTeamId: "club-b",
          goalScorers: [{ teamId: "foreign-team", playerName: "No participante" }],
          schedule: { date: "2026-02-30", time: "25:00" },
        }],
      }],
    }));
    expect(alerts.find(({ type }) => type === "invalid-individual-data")?.description)
      .toContain("estadísticas");
    expect(alerts.find(({ type }) => type === "invalid-schedule")?.description)
      .toContain("No afecta ni modifica el resultado deportivo");
  });

  it("reports unresolved configured knockout stages but does not alert empty future stages", () => {
    const alerts = alertsFor(makeTournament({
      competitionType: "cup",
      format: "staged",
      knockoutStages: [
        { name: "Final", legs: 1 },
        { name: "Semifinal", legs: 1 },
      ],
      matchdays: [{
        number: 1,
        leg: 1,
        phaseName: "Final",
        fixtures: [{ id: "final", homeTeamId: "club-a", awayTeamId: "club-b" }],
      }],
    }));
    expect(alerts.filter(({ type }) => type === "knockout-pending")).toHaveLength(1);
    expect(alerts.some(({ title }) => title.includes("campeón confirmado"))).toBe(false);
  });

  it("deduplicates each cause and removes the alert when its pending fixture is corrected", () => {
    const tournament = makeTournament({
      matchdays: [{
        number: 1,
        leg: 1,
        fixtures: [
          { id: "one", homeTeamId: "club-a", awayTeamId: "club-b" },
          { id: "two", homeTeamId: "club-b", awayTeamId: "club-a" },
        ],
      }],
    });
    const initial = alertsFor(tournament);
    expect(new Set(initial.map(({ id }) => id)).size).toBe(initial.length);
    expect(initial.filter(({ type }) => type === "incomplete-matchday")).toHaveLength(1);
    const corrected = {
      ...tournament,
      matchdays: tournament.matchdays.map((matchday) => ({
        ...matchday,
        fixtures: matchday.fixtures.map((fixture) => ({
          ...fixture,
          result: { homeGoals: 1, awayGoals: 0 },
        })),
      })),
    };
    expect(alertsFor(corrected).some(({ fixtureId }) => fixtureId === "one")).toBe(false);
  });

  it("keeps alerts isolated by competition and season and supports historical data without schedules or rules", () => {
    const historical = makeTournament({ id: "historical", season: 1998, matchdays: [] });
    const independent = makeTournament({
      id: "other-competition",
      season: 2026,
      matchdays: [{
        number: 1,
        leg: 1,
        fixtures: [{ id: "other-match", homeTeamId: "club-a", awayTeamId: "club-b" }],
      }],
    });
    expect(alertsFor(historical).some(({ fixtureId }) => fixtureId !== undefined)).toBe(false);
    const otherAlerts = alertsFor(independent);
    expect(otherAlerts.every(({ id }) => id.startsWith("other-competition:"))).toBe(true);
  });
});

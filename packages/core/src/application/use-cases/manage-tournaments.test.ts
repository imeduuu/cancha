import { describe, expect, it, vi } from "vitest";
import type { Tournament } from "../../domain/entities/tournament";
import type { TournamentRepository } from "../ports/tournament-repository";
import {
  duplicateTournament,
  renameTournament,
} from "./manage-tournaments";
import { isOperationalStateSimulationBlocked } from "../../domain/services/match-operational-status";

const original: Tournament = {
  id: "official-league",
  name: "Liga de Prueba 2026",
  teams: [
    { id: "team-a", name: "Club A" },
    { id: "team-b", name: "Club B" },
  ],
  legs: 1,
  tieBreakers: ["goalDifference"],
  matchdays: [{
    number: 1,
    leg: 1,
    fixtures: [{
      id: "fixture-1",
      homeTeamId: "team-a",
      awayTeamId: "team-b",
      schedule: { date: "2026-10-14", time: "19:00", venue: "Cancha" },
      result: {
        homeGoals: 1,
        awayGoals: 1,
        extraTime: { homeGoals: 0, awayGoals: 0 },
        penalties: { homeGoals: 4, awayGoals: 3 },
      },
    }],
  }],
  createdAt: "2026-01-01T00:00:00.000Z",
  pointsSystem: { win: 3, draw: 1, loss: 0 },
  competitionRules: {
    season: 2026,
    points: { win: 3, draw: 1, loss: 0 },
    tieBreakers: ["goalDifference"],
    verification: { standings: "pending", placements: "provisional" },
    sourceUrls: ["https://example.test/rules"],
    internationalQualification: {
      verification: "pending",
      slots: [{ destination: "conmebol-libertadores", position: 2 }],
      cupChampions: [{ sourceTournamentId: "cup-2026", destination: "conmebol-libertadores" }],
      reallocation: "next-eligible-position",
    },
    relegationAverage: {
      verification: "pending",
      seasons: [2024, 2025, 2026],
      relegatedCount: 1,
      tieBreakers: ["goalDifference"],
    },
    conditionalPlacements: [{
      status: "pending",
      description: "Cupos sujetos a campeones de copa",
    }],
  },
  sourceUrl: "https://example.test/league",
  competitionType: "league",
  placementRules: { championPlaces: 1, libertadoresPlaces: { from: 2, to: 3 } },
  knockoutStages: [{ name: "Final", legs: 1 }],
};

function createRepository(existing: Tournament[] = [original]): TournamentRepository {
  let tournaments = [...existing];
  const save = vi.fn((tournament: Tournament) => {
    tournaments = [
      tournament,
      ...tournaments.filter(({ id }) => id !== tournament.id),
    ];
  });
  return {
    findAll: vi.fn(() => tournaments),
    save,
    saveWithActivity: vi.fn((tournament: Tournament) => save(tournament)),
    recordActivity: vi.fn(),
  };
}

describe("tournament library use cases", () => {
  it("duplicates with a unique identifier and deep-copies all results when requested", () => {
    const timestamp = "2026-10-13T00:00:00.000Z";
    const copyId = `copy-${original.id}-${Date.parse(timestamp)}`;
    const existing = { ...original, id: copyId };
    const repository = createRepository([original, existing]);
    const duplicate = duplicateTournament(
      original,
      "copy",
      repository,
      () => new Date(timestamp),
    );

    expect(duplicate.id).toBe(`${copyId}-2`);
    expect(duplicate.name).toBe("Liga de Prueba 2026 (copia)");
    expect(duplicate.matchdays[0].fixtures[0].result).toEqual(original.matchdays[0].fixtures[0].result);
    expect(duplicate.matchdays[0].fixtures[0].result).not.toBe(original.matchdays[0].fixtures[0].result);
    expect(duplicate.matchdays[0].fixtures[0].result?.penalties)
      .not.toBe(original.matchdays[0].fixtures[0].result?.penalties);
    expect(duplicate.teams).not.toBe(original.teams);
    expect(duplicate.matchdays[0].fixtures[0].schedule)
      .toEqual(original.matchdays[0].fixtures[0].schedule);
    expect(duplicate.matchdays[0].fixtures[0].schedule)
      .not.toBe(original.matchdays[0].fixtures[0].schedule);
    expect(duplicate.placementRules?.libertadoresPlaces)
      .not.toBe(original.placementRules?.libertadoresPlaces);
    expect(duplicate.knockoutStages).not.toBe(original.knockoutStages);
    expect(duplicate.pointsSystem).not.toBe(original.pointsSystem);
    expect(duplicate.competitionRules).not.toBe(original.competitionRules);
    expect(duplicate.competitionRules?.verification)
      .not.toBe(original.competitionRules?.verification);
    expect(duplicate.competitionRules?.conditionalPlacements)
      .not.toBe(original.competitionRules?.conditionalPlacements);
    expect(duplicate.competitionRules?.conditionalPlacements?.[0])
      .not.toBe(original.competitionRules?.conditionalPlacements?.[0]);
    expect(duplicate.competitionRules?.sourceUrls)
      .not.toBe(original.competitionRules?.sourceUrls);
    expect(duplicate.competitionRules?.internationalQualification)
      .not.toBe(original.competitionRules?.internationalQualification);
    expect(duplicate.competitionRules?.internationalQualification?.slots)
      .not.toBe(original.competitionRules?.internationalQualification?.slots);
    expect(duplicate.competitionRules?.internationalQualification?.cupChampions)
      .not.toBe(original.competitionRules?.internationalQualification?.cupChampions);
    expect(duplicate.competitionRules?.relegationAverage)
      .not.toBe(original.competitionRules?.relegationAverage);
    expect(duplicate.competitionRules?.relegationAverage?.seasons)
      .not.toBe(original.competitionRules?.relegationAverage?.seasons);
    expect(repository.save).toHaveBeenCalledWith(duplicate);
    expect(original.matchdays[0].fixtures[0].result?.homeGoals).toBe(1);
  });

  it("duplicates with results removed by defaulting the caller to explicit reset mode", () => {
    const repository = createRepository();
    const duplicate = duplicateTournament(
      original,
      "reset",
      repository,
      () => new Date("2026-10-13T00:00:00.000Z"),
    );

    expect(duplicate.matchdays[0].fixtures[0]).not.toHaveProperty("result");
    expect(duplicate.matchdays[0].fixtures[0].schedule)
      .toEqual(original.matchdays[0].fixtures[0].schedule);
    expect(original.matchdays[0].fixtures[0].result?.penalties?.homeGoals).toBe(4);
  });

  it("resets operational and match-specific data, and deep-copies it in copy mode", () => {
    const fixture = {
      ...original.matchdays[0].fixtures[0],
      goalScorers: [{ teamId: "team-a", playerName: "Jugador", minute: 12 }],
      lineups: {
        home: { starters: ["player-a"], substitutes: [], status: "incomplete" as const },
        away: { starters: [], substitutes: ["player-b"], status: "incomplete" as const },
      },
      substitutions: [{
        id: "sub-1",
        teamId: "team-a",
        playerOutId: "player-a",
        playerInId: "player-c",
      }],
      events: [{
        id: "event-1",
        type: "goal" as const,
        teamId: "team-a",
        playerName: "Jugador",
        minute: 12,
      }],
      eventsCoverage: "complete" as const,
      operationalState: {
        status: "finished" as const,
        updatedAt: "2026-10-14T19:00:00.000Z",
      },
    };
    const source: Tournament = {
      ...original,
      matchdays: [{ ...original.matchdays[0], fixtures: [fixture] }],
    };
    const repository = createRepository([source]);
    const copied = duplicateTournament(source, "copy", repository);
    const copiedFixture = copied.matchdays[0].fixtures[0];

    expect(copiedFixture.lineups).not.toBe(fixture.lineups);
    expect(copiedFixture.lineups?.home.starters).not.toBe(fixture.lineups.home.starters);
    expect(copiedFixture.substitutions).not.toBe(fixture.substitutions);
    expect(copiedFixture.events).not.toBe(fixture.events);
    expect(copiedFixture.eventsCoverage).toBe("complete");
    expect(copiedFixture.operationalState).not.toBe(fixture.operationalState);

    const reset = duplicateTournament(source, "reset", repository);
    const resetFixture = reset.matchdays[0].fixtures[0];
    expect(resetFixture).not.toHaveProperty("result");
    expect(resetFixture).not.toHaveProperty("goalScorers");
    expect(resetFixture).not.toHaveProperty("lineups");
    expect(resetFixture).not.toHaveProperty("substitutions");
    expect(resetFixture).not.toHaveProperty("events");
    expect(resetFixture.eventsCoverage).not.toBe("complete");
    expect(resetFixture).not.toHaveProperty("operationalState");
    expect(resetFixture.schedule).toEqual(fixture.schedule);
    expect(isOperationalStateSimulationBlocked(resetFixture)).toBe(false);
  });

  it("renames while preserving the identifier, schedule, rules and results", () => {
    const repository = createRepository();
    const renamed = renameTournament(original, "  Mi liga  ", repository);

    expect(renamed).toMatchObject({
      id: original.id,
      name: "Mi liga",
      teams: original.teams,
      matchdays: original.matchdays,
      tieBreakers: original.tieBreakers,
      sourceUrl: original.sourceUrl,
    });
    expect(repository.save).toHaveBeenCalledWith(renamed);
  });

  it.each(["   ", "N".repeat(81)])("rejects invalid tournament names: %s", (name) => {
    const repository = createRepository();
    expect(() => renameTournament(original, name, repository)).toThrow();
    expect(repository.save).not.toHaveBeenCalled();
  });
});

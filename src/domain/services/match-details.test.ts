import { describe, expect, it } from "vitest";
import type { Fixture, MatchLineups, Tournament } from "../entities/tournament";
import { validateFixtureDetails } from "./match-details";
import { calculateTournamentStatistics } from "./tournament-statistics";
import { updateFixtureDetails } from "../../application/use-cases/update-fixture-details";
import type { TournamentRepository } from "../../application/ports/tournament-repository";

const players = [
  { id: "a1", firstName: "Ana", lastName: "Uno" },
  { id: "a2", firstName: "Ana", lastName: "Dos" },
  { id: "b1", firstName: "Beto", lastName: "Uno" },
  { id: "b2", firstName: "Beto", lastName: "Dos" },
];

function createLineup(starter: string, substitute: string): MatchLineups["home"] {
  return { starters: [starter], substitutes: [substitute], status: "complete" };
}

const lineups: MatchLineups = {
  home: createLineup("a1", "a2"),
  away: createLineup("b1", "b2"),
};

const fixture: Fixture = {
  id: "match",
  homeTeamId: "a",
  awayTeamId: "b",
  result: { homeGoals: 1, awayGoals: 0 },
  lineups,
};

const tournament: Tournament = {
  id: "season",
  name: "Temporada",
  teams: [{ id: "a", name: "Alfa" }, { id: "b", name: "Bravo" }],
  legs: 1,
  tieBreakers: ["goalDifference"],
  matchdays: [{ number: 1, leg: 1, fixtures: [fixture] }],
  createdAt: "2026-01-01T00:00:00.000Z",
  lineupRules: { startersPerTeam: 1 },
  players,
  playerRegistrations: [
    { playerId: "a1", teamId: "a" }, { playerId: "a2", teamId: "a" },
    { playerId: "b1", teamId: "b" }, { playerId: "b2", teamId: "b" },
  ],
};

describe("match details", () => {
  it("accepts incomplete lineups but never calls them complete", () => {
    const updated: MatchLineups = {
      home: { starters: [], substitutes: [], status: "incomplete" },
      away: lineups.away,
    };
    expect(validateFixtureDetails(tournament, { ...fixture, lineups: updated })).toBeUndefined();
    expect(validateFixtureDetails(tournament, {
      ...fixture,
      lineups: { ...updated, home: { ...updated.home, status: "complete" } },
    })).toContain("estado de alineación");
  });

  it("rejects repeated players and players belonging to the other team", () => {
    expect(validateFixtureDetails(tournament, {
      ...fixture,
      lineups: {
        ...lineups,
        home: { ...lineups.home, substitutes: ["a1"] },
      },
    })).toContain("duplicados");
    expect(validateFixtureDetails(tournament, {
      ...fixture,
      lineups: {
        ...lineups,
        home: createLineup("b1", "a2"),
      },
    })).toContain("no pertenece");
  });

  it("validates substitutions against the evolving on-field and bench players", () => {
    const valid = {
      id: "sub-1", teamId: "a", playerOutId: "a1", playerInId: "a2", minute: 60,
    };
    expect(validateFixtureDetails(tournament, { ...fixture, substitutions: [valid] })).toBeUndefined();
    expect(validateFixtureDetails(tournament, {
      ...fixture,
      substitutions: [valid, { ...valid, id: "sub-2", playerOutId: "a1", playerInId: "a2" }],
    })).toContain("no está en el campo");
    expect(validateFixtureDetails(tournament, {
      ...fixture,
      substitutions: [{ ...valid, teamId: "unknown" }],
    })).toContain("uno de los equipos");
  });

  it("validates goals, own-goal beneficiaries and player-team references", () => {
    expect(validateFixtureDetails(tournament, {
      ...fixture,
      events: [{
        id: "goal", type: "own-goal", teamId: "a", playerId: "a1",
        playerName: "Ana Uno", benefitedTeamId: "b",
      }],
    })).toBeUndefined();
    expect(validateFixtureDetails(tournament, {
      ...fixture,
      events: [{
        id: "goal", type: "own-goal", teamId: "a", playerId: "a1",
        playerName: "Ana Uno", benefitedTeamId: "a",
      }],
    })).toContain("equipo rival");
    expect(validateFixtureDetails(tournament, {
      ...fixture,
      events: [{
        id: "card", type: "yellow-card", teamId: "a", playerId: "b1",
        playerName: "Beto Uno",
      }],
    })).toContain("no pertenece a ese equipo");
  });

  it("updates event records without changing the score and derives individual data only from records", () => {
    const save = (_value: Tournament) => undefined;
    const repository: TournamentRepository = {
      save,
      saveWithActivity: (value) => save(value),
      recordActivity: () => undefined,
      findAll: () => [tournament],
    };
    const updated = updateFixtureDetails(tournament, "match", {
      substitutions: [{
        id: "sub", teamId: "a", playerOutId: "a1", playerInId: "a2", minute: 70,
      }],
      events: [
        { id: "goal", type: "goal", teamId: "a", playerId: "a1", playerName: "Ana Uno", minute: 20 },
        {
          id: "own-goal", type: "own-goal", teamId: "b", playerId: "b2",
          playerName: "Beto Dos", benefitedTeamId: "a",
        },
        { id: "card", type: "yellow-card", teamId: "b", playerId: "b1", playerName: "Beto Uno" },
      ],
    }, repository);
    const updatedFixture = updated.matchdays[0].fixtures[0];
    expect(updatedFixture.result).toEqual({ homeGoals: 1, awayGoals: 0 });
    expect(updatedFixture.goalScorers?.[0]).toMatchObject({ eventId: "goal", playerId: "a1" });

    const stats = calculateTournamentStatistics(updated);
    expect(stats.individualStatistics).toEqual(expect.arrayContaining([
      expect.objectContaining({ playerId: "a1", starts: 1, goals: 1 }),
      expect.objectContaining({ playerId: "a2", substituteAppearances: 1 }),
      expect.objectContaining({ playerId: "b1", yellowCards: 1 }),
      expect.objectContaining({ playerId: "b2", ownGoals: 1, goals: 0 }),
    ]));
    expect(stats.individualStatistics.find(({ playerId }) => playerId === "a2"))
      .not.toHaveProperty("minutesPlayed");
  });

  it("removing a goal event also removes its linked scorer without changing the result", () => {
    const save = (_value: Tournament) => undefined;
    const repository: TournamentRepository = {
      save,
      saveWithActivity: (value) => save(value),
      recordActivity: () => undefined,
      findAll: () => [tournament],
    };
    const withGoal = updateFixtureDetails(tournament, "match", {
      events: [{
        id: "goal", type: "goal", teamId: "a", playerId: "a1", playerName: "Ana Uno",
      }],
    }, repository);
    const withoutGoal = updateFixtureDetails(withGoal, "match", { events: [] }, repository);
    const updatedFixture = withoutGoal.matchdays[0].fixtures[0];
    expect(updatedFixture.result).toEqual({ homeGoals: 1, awayGoals: 0 });
    expect(updatedFixture.goalScorers).toEqual([]);
    expect(calculateTournamentStatistics(withoutGoal).individualStatistics)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ playerId: "a1", goals: 0, starts: 1 }),
      ]));
    expect(withoutGoal.matchdays[0].fixtures[0].eventsCoverage).toBe("unverified");
  });

  it("keeps legacy event lists unverified and only marks them complete by explicit request", () => {
    const save = (_value: Tournament) => undefined;
    const repository: TournamentRepository = {
      save,
      saveWithActivity: (value) => save(value),
      recordActivity: () => undefined,
      findAll: () => [tournament],
    };
    const oldFixture: Fixture = { ...fixture, events: [] };
    const oldTournament = {
      ...tournament,
      matchdays: [{ ...tournament.matchdays[0], fixtures: [oldFixture] }],
    };
    const verified = updateFixtureDetails(oldTournament, "match", {
      eventsCoverage: "complete",
    }, repository);
    expect(verified.matchdays[0].fixtures[0].eventsCoverage).toBe("complete");
    const edited = updateFixtureDetails(verified, "match", { events: [] }, repository);
    expect(edited.matchdays[0].fixtures[0].eventsCoverage).toBe("unverified");
  });

  it("preserves old matches that have no lineup or event fields", () => {
    expect(validateFixtureDetails(tournament, {
      id: "old-match", homeTeamId: "a", awayTeamId: "b",
    })).toBeUndefined();
  });
});

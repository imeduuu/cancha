import { describe, expect, it } from "vitest";
import type { Tournament } from "../entities/tournament";
import {
  calculateStandings,
  hasUniqueStandingsLeader,
  getUnresolvedStandingsTieDetails,
  getUnresolvedStandingsTieGroups,
} from "./standings";

function createTournament(
  teams: Tournament["teams"],
  fixtures: Tournament["matchdays"][number]["fixtures"],
  tieBreakers: Tournament["tieBreakers"],
): Tournament {
  return {
    id: "tournament-test",
    name: "Torneo de prueba",
    teams,
    legs: 1,
    tieBreakers,
    createdAt: "2026-01-01T00:00:00.000Z",
    matchdays: [{ number: 1, leg: 1, fixtures }],
  };
}

const fourTeams = [
  { id: "a", name: "Alfa" },
  { id: "b", name: "Bravo" },
  { id: "c", name: "Charlie" },
  { id: "d", name: "Delta" },
];

const copaTieBreakers = [
  "goalDifference", "wins", "goalsFor", "awayGoals", "redCards", "yellowCards", "competitionNumber",
] as const;

function createCopaLigaTournament(
  fixtures: Tournament["matchdays"][number]["fixtures"],
  options: { readonly teams?: Tournament["teams"]; readonly id?: string; readonly season?: number } = {},
): Tournament {
  const teams = options.teams ?? [
    { id: "a", name: "Alfa", competitionNumber: 1 },
    { id: "b", name: "Bravo", competitionNumber: 2 },
    { id: "c", name: "Charlie", competitionNumber: 3 },
    { id: "d", name: "Delta", competitionNumber: 4 },
  ];
  return {
    id: options.id ?? "anfp-copa-de-la-liga-2026",
    name: "Copa de la Liga 2026",
    season: options.season ?? 2026,
    competitionType: "cup",
    teams,
    legs: 1,
    tieBreakers: ["goalDifference", "goalsFor", "wins"],
    competitionRules: {
      season: 2026,
      verification: { standings: "verified", placements: "pending" },
      tieBreakers: [...copaTieBreakers],
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    matchdays: [{ number: 1, leg: 1, phaseName: "Copa de la Liga · Grupo A", fixtures }],
  };
}

const sameBaselineStatsFixtures: Tournament["matchdays"][number]["fixtures"] = [
  { id: "a-c", homeTeamId: "a", awayTeamId: "c", result: { homeGoals: 1, awayGoals: 0 }, events: [], eventsCoverage: "complete" },
  { id: "d-a", homeTeamId: "d", awayTeamId: "a", result: { homeGoals: 1, awayGoals: 0 }, events: [], eventsCoverage: "complete" },
  { id: "b-c", homeTeamId: "b", awayTeamId: "c", result: { homeGoals: 1, awayGoals: 0 }, events: [], eventsCoverage: "complete" },
  { id: "d-b", homeTeamId: "d", awayTeamId: "b", result: { homeGoals: 1, awayGoals: 0 }, events: [], eventsCoverage: "complete" },
];

describe("calculateStandings", () => {
  it("applies Copa de la Liga criteria in official order and reaches each next criterion on a tie", () => {
    const goalDifference = createCopaLigaTournament([
      { id: "a-x", homeTeamId: "a", awayTeamId: "c", result: { homeGoals: 2, awayGoals: 0 } },
      { id: "b-y", homeTeamId: "b", awayTeamId: "d", result: { homeGoals: 1, awayGoals: 0 } },
    ]);
    expect(calculateStandings(goalDifference).slice(0, 2).map(({ teamId }) => teamId)).toEqual(["a", "b"]);

    const wins = createCopaLigaTournament([
      { id: "a-x", homeTeamId: "a", awayTeamId: "c", result: { homeGoals: 1, awayGoals: 0 } },
      { id: "a-y", homeTeamId: "a", awayTeamId: "d", result: { homeGoals: 0, awayGoals: 1 } },
      { id: "b-x", homeTeamId: "b", awayTeamId: "c", result: { homeGoals: 0, awayGoals: 0 } },
      { id: "b-y", homeTeamId: "b", awayTeamId: "d", result: { homeGoals: 0, awayGoals: 0 } },
      { id: "b-e", homeTeamId: "b", awayTeamId: "e", result: { homeGoals: 0, awayGoals: 0 } },
    ], { teams: [
      { id: "a", name: "Alfa", competitionNumber: 1 },
      { id: "b", name: "Bravo", competitionNumber: 2 },
      { id: "c", name: "Charlie", competitionNumber: 3 },
      { id: "d", name: "Delta", competitionNumber: 4 },
      { id: "e", name: "Echo", competitionNumber: 5 },
    ] });
    expect(calculateStandings(wins).filter(({ teamId }) => teamId === "a" || teamId === "b")
      .map(({ teamId }) => teamId)).toEqual(["a", "b"]);

    const goalsFor = createCopaLigaTournament([
      { id: "a-x", homeTeamId: "a", awayTeamId: "c", result: { homeGoals: 2, awayGoals: 1 } },
      { id: "a-y", homeTeamId: "d", awayTeamId: "a", result: { homeGoals: 1, awayGoals: 0 } },
      { id: "b-x", homeTeamId: "b", awayTeamId: "c", result: { homeGoals: 1, awayGoals: 0 } },
      { id: "b-y", homeTeamId: "d", awayTeamId: "b", result: { homeGoals: 1, awayGoals: 0 } },
    ]);
    expect(calculateStandings(goalsFor).filter(({ teamId }) => teamId === "a" || teamId === "b")
      .map(({ teamId }) => teamId)).toEqual(["a", "b"]);
  });

  it("uses away goals with the recorded home and away sides after earlier criteria tie", () => {
    const tournament = createCopaLigaTournament([
      { id: "a-c", homeTeamId: "a", awayTeamId: "c", result: { homeGoals: 2, awayGoals: 0 } },
      { id: "d-a", homeTeamId: "d", awayTeamId: "a", result: { homeGoals: 2, awayGoals: 0 } },
      { id: "c-b", homeTeamId: "c", awayTeamId: "b", result: { homeGoals: 0, awayGoals: 2 } },
      { id: "b-d", homeTeamId: "b", awayTeamId: "d", result: { homeGoals: 0, awayGoals: 2 } },
    ]);
    expect(calculateStandings(tournament).filter(({ teamId }) => teamId === "a" || teamId === "b")
      .map(({ teamId }) => teamId)).toEqual(["b", "a"]);
  });

  it("uses red and yellow cards only from complete event lists, then official team numbering", () => {
    const redCardFixtures = sameBaselineStatsFixtures.map((fixture) => ({
      ...fixture,
      events: fixture.id === "a-c" ? [
        { id: "a-red", type: "red-card" as const, teamId: "a", playerName: "Jugador" },
      ] : [],
    }));
    expect(calculateStandings(createCopaLigaTournament(redCardFixtures))
      .filter(({ teamId }) => teamId === "a" || teamId === "b").map(({ teamId }) => teamId))
      .toEqual(["b", "a"]);

    const yellowCardFixtures = sameBaselineStatsFixtures.map((fixture) => ({
      ...fixture,
      events: fixture.id === "a-c" ? [
        { id: "a-yellow", type: "yellow-card" as const, teamId: "a", playerName: "Jugador" },
      ] : fixture.id === "b-c" || fixture.id === "d-b" ? [
        { id: `b-yellow-${fixture.id}`, type: "yellow-card" as const, teamId: "b", playerName: "Jugador" },
      ] : [],
    }));
    expect(calculateStandings(createCopaLigaTournament(yellowCardFixtures))
      .filter(({ teamId }) => teamId === "a" || teamId === "b").map(({ teamId }) => teamId))
      .toEqual(["a", "b"]);

    expect(calculateStandings(createCopaLigaTournament(sameBaselineStatsFixtures))
      .filter(({ teamId }) => teamId === "a" || teamId === "b").map(({ teamId }) => teamId))
      .toEqual(["a", "b"]);
  });

  it("does not count card events from a result invalidated by an operational state", () => {
    const tournament = createCopaLigaTournament([
      ...sameBaselineStatsFixtures,
      {
        id: "suspended-a",
        homeTeamId: "a",
        awayTeamId: "c",
        result: { homeGoals: 0, awayGoals: 0 },
        operationalState: { status: "suspended", updatedAt: "2026-06-01T00:00:00.000Z" },
        events: [{ id: "stale-red", type: "red-card", teamId: "a", playerName: "Jugador" }],
        eventsCoverage: "complete",
      },
    ]);
    expect(calculateStandings(tournament).filter(({ teamId }) => teamId === "a" || teamId === "b")
      .map(({ teamId }) => teamId)).toEqual(["a", "b"]);
  });

  it("keeps a tie unresolved with a useful reason when any relevant event list is unverified", () => {
    const tournament = createCopaLigaTournament(sameBaselineStatsFixtures.map((fixture) => ({
      ...fixture,
      result: { homeGoals: 0, awayGoals: 0 },
      ...(fixture.id === "a-c" ? { eventsCoverage: "unverified" as const } : {}),
    })));
    const standings = calculateStandings(tournament);
    const tieDetails = getUnresolvedStandingsTieDetails(tournament, standings);
    expect(getUnresolvedStandingsTieGroups(tournament, standings)
      .some((group) => group.some(({ teamId }) => teamId === "a")
        && group.some(({ teamId }) => teamId === "b"))).toBe(true);
    expect(tieDetails).toEqual(expect.arrayContaining([
      expect.objectContaining({
        criterion: "redCards",
        reason: expect.stringContaining("a-c"),
        fixtureIds: ["a-c"],
      }),
    ]));
    expect(hasUniqueStandingsLeader(tournament, standings)).toBe(false);
  });

  it("treats legacy event arrays without a coverage marker as unverified", () => {
    const legacyFixtures = sameBaselineStatsFixtures.map((fixture) => {
      if (fixture.id !== "a-c") return fixture;
      const { eventsCoverage: _coverage, ...legacyFixture } = fixture;
      return legacyFixture;
    });
    const tournament = createCopaLigaTournament(legacyFixtures);
    const standings = calculateStandings(tournament);
    expect(getUnresolvedStandingsTieDetails(tournament, standings)[0]).toMatchObject({
      criterion: "redCards",
      fixtureIds: ["a-c"],
    });
  });

  it("uses the official number only after cards and leaves missing or duplicate numbers unresolved", () => {
    const numbered = createCopaLigaTournament(sameBaselineStatsFixtures, {
      teams: [
        { id: "a", name: "Zulu", competitionNumber: 1 },
        { id: "b", name: "Alpha", competitionNumber: 2 },
        { id: "c", name: "Charlie", competitionNumber: 3 },
        { id: "d", name: "Delta", competitionNumber: 4 },
      ],
    });
    expect(calculateStandings(numbered).filter(({ teamId }) => teamId === "a" || teamId === "b")
      .map(({ teamId }) => teamId)).toEqual(["a", "b"]);
    for (const teams of [
      numbered.teams.map(({ id, name, competitionNumber }) => ({ id, name,
        ...(id === "a" ? {} : { competitionNumber }) })),
      numbered.teams.map((team) => ({ ...team, competitionNumber: team.id === "b" ? 1 : team.competitionNumber })),
    ]) {
      const invalid = { ...numbered, teams };
      expect(getUnresolvedStandingsTieDetails(invalid, calculateStandings(invalid))[0]?.criterion)
        .toBe("competitionNumber");
    }
  });

  it("does not apply Copa-specific tie-breakers to other competitions", () => {
    const tournament = createCopaLigaTournament([
      { id: "a-c", homeTeamId: "a", awayTeamId: "c", result: { homeGoals: 2, awayGoals: 0 } },
      { id: "d-a", homeTeamId: "d", awayTeamId: "a", result: { homeGoals: 2, awayGoals: 0 } },
      { id: "c-b", homeTeamId: "c", awayTeamId: "b", result: { homeGoals: 0, awayGoals: 2 } },
      { id: "b-d", homeTeamId: "b", awayTeamId: "d", result: { homeGoals: 0, awayGoals: 2 } },
    ], { id: "another-cup-2026" });
    expect(calculateStandings(tournament).filter(({ teamId }) => teamId === "a" || teamId === "b")
      .map(({ teamId }) => teamId)).toEqual(["a", "b"]);
  });
  it("awards 3 points for a win, 1 for a draw, and ignores unplayed matches", () => {
    const tournament = createTournament(
      fourTeams.slice(0, 3),
      [
        {
          id: "match-1",
          homeTeamId: "a",
          awayTeamId: "b",
          result: { homeGoals: 2, awayGoals: 0 },
        },
        {
          id: "match-2",
          homeTeamId: "a",
          awayTeamId: "c",
          result: { homeGoals: 1, awayGoals: 1 },
        },
        { id: "match-3", homeTeamId: "b", awayTeamId: "c" },
      ],
      ["goalDifference"],
    );

    const standings = calculateStandings(tournament);

    expect(standings.map(({ teamName, points }) => [teamName, points])).toEqual([
      ["Alfa", 4],
      ["Charlie", 1],
      ["Bravo", 0],
    ]);
    expect(standings[0]).toMatchObject({
      played: 2,
      wins: 1,
      draws: 1,
      losses: 0,
      goalsFor: 3,
      goalsAgainst: 1,
      goalDifference: 2,
    });
    expect(standings[1].played).toBe(1);
    expect(standings[2].played).toBe(1);
  });

  it("applies configured tie-breakers in their configured order", () => {
    const tournament = createTournament(
      fourTeams.slice(0, 2),
      [
        {
          id: "match-1",
          homeTeamId: "a",
          awayTeamId: "b",
          result: { homeGoals: 1, awayGoals: 0 },
        },
        {
          id: "match-2",
          homeTeamId: "b",
          awayTeamId: "a",
          result: { homeGoals: 2, awayGoals: 0 },
        },
      ],
      ["goalDifference", "wins"],
    );

    expect(calculateStandings(tournament).map((team) => team.teamId)).toEqual(["b", "a"]);
  });

  it("uses configured head-to-head criteria in their configured order", () => {
    const tournament = {
      ...createTournament(
        fourTeams,
        [
          { id: "a-b", homeTeamId: "a", awayTeamId: "b", result: { homeGoals: 0, awayGoals: 1 } },
          { id: "a-c", homeTeamId: "a", awayTeamId: "c", result: { homeGoals: 4, awayGoals: 0 } },
          { id: "b-c", homeTeamId: "c", awayTeamId: "b", result: { homeGoals: 4, awayGoals: 0 } },
          { id: "a-d", homeTeamId: "d", awayTeamId: "a", result: { homeGoals: 1, awayGoals: 0 } },
          { id: "b-d", homeTeamId: "b", awayTeamId: "d", result: { homeGoals: 1, awayGoals: 0 } },
        ],
        ["goalDifference"],
      ),
      tieBreakers: ["headToHeadPoints", "headToHeadGoalDifference"],
    } satisfies Tournament;
    expect(calculateStandings(tournament).map(({ teamId }) => teamId)).toEqual(["b", "d", "a", "c"]);
  });

  it("recalculates a head-to-head mini-table for the subset still tied after a previous criterion", () => {
    const tournament = createTournament(
      fourTeams,
      [
        { id: "a-b", homeTeamId: "a", awayTeamId: "b", result: { homeGoals: 1, awayGoals: 0 } },
        { id: "a-c", homeTeamId: "a", awayTeamId: "c", result: { homeGoals: 1, awayGoals: 0 } },
        { id: "b-c", homeTeamId: "b", awayTeamId: "c", result: { homeGoals: 2, awayGoals: 0 } },
        { id: "c-d", homeTeamId: "c", awayTeamId: "d", result: { homeGoals: 5, awayGoals: 0 } },
        { id: "d-b", homeTeamId: "d", awayTeamId: "b", result: { homeGoals: 1, awayGoals: 0 } },
      ],
      ["headToHeadPoints", "headToHeadGoalDifference"],
    );
    const standings = calculateStandings(tournament);

    expect(standings.map(({ teamId }) => teamId)).toEqual(["a", "c", "b", "d"]);
  });

  it("uses the tournament's configured points per result", () => {
    const tournament = {
      ...createTournament(
        fourTeams.slice(0, 2),
        [{ id: "match-1", homeTeamId: "a", awayTeamId: "b", result: { homeGoals: 1, awayGoals: 0 } }],
        [],
      ),
      pointsSystem: { win: 5, draw: 2, loss: 0 },
    } satisfies Tournament;

    expect(calculateStandings(tournament).map(({ teamId, points }) => [teamId, points]))
      .toEqual([["a", 5], ["b", 0]]);
  });

  it("uses the configured points system in head-to-head tie-breakers", () => {
    const tournament = {
      ...createTournament(
        fourTeams.slice(0, 3),
        [
          { id: "a-b", homeTeamId: "a", awayTeamId: "b", result: { homeGoals: 0, awayGoals: 1 } },
          { id: "a-c", homeTeamId: "a", awayTeamId: "c", result: { homeGoals: 3, awayGoals: 0 } },
          { id: "c-b", homeTeamId: "c", awayTeamId: "b", result: { homeGoals: 1, awayGoals: 0 } },
        ],
        ["headToHeadPoints", "goalDifference"],
      ),
      pointsSystem: { win: 0, draw: 0, loss: 0 },
    } satisfies Tournament;

    expect(calculateStandings(tournament).map(({ teamId }) => teamId)).toEqual(["a", "b", "c"]);
  });

  it("uses goals scored after goal difference remains tied", () => {
    const tournament = createTournament(
      fourTeams,
      [
        { id: "a-c", homeTeamId: "a", awayTeamId: "c", result: { homeGoals: 3, awayGoals: 0 } },
        { id: "d-a", homeTeamId: "d", awayTeamId: "a", result: { homeGoals: 1, awayGoals: 0 } },
        { id: "b-d", homeTeamId: "b", awayTeamId: "d", result: { homeGoals: 5, awayGoals: 0 } },
        { id: "c-b", homeTeamId: "c", awayTeamId: "b", result: { homeGoals: 3, awayGoals: 0 } },
      ],
      ["goalDifference", "goalsFor"],
    );

    expect(calculateStandings(tournament).slice(0, 2).map(({ teamId }) => teamId))
      .toEqual(["b", "a"]);
  });

  it("preserves the classic points system for historical tournaments without rule metadata", () => {
    const tournament = createTournament(
      fourTeams.slice(0, 2),
      [{ id: "legacy", homeTeamId: "a", awayTeamId: "b", result: { homeGoals: 1, awayGoals: 0 } }],
      [],
    );
    expect(calculateStandings(tournament).map(({ points }) => points)).toEqual([3, 0]);
  });

  it("uses head-to-head results among teams currently tied on points", () => {
    const tournament = createTournament(
      fourTeams,
      [
        {
          id: "match-1",
          homeTeamId: "a",
          awayTeamId: "b",
          result: { homeGoals: 1, awayGoals: 0 },
        },
        {
          id: "match-2",
          homeTeamId: "b",
          awayTeamId: "c",
          result: { homeGoals: 1, awayGoals: 0 },
        },
        {
          id: "match-3",
          homeTeamId: "d",
          awayTeamId: "a",
          result: { homeGoals: 1, awayGoals: 0 },
        },
      ],
      ["headToHead", "wins"],
    );

    const standings = calculateStandings(tournament);
    expect(standings.slice(0, 3).map((team) => team.teamId)).toEqual(["d", "a", "b"]);
    expect(standings[0].points).toBe(3);
    expect(standings[1].points).toBe(3);
    expect(standings[2].points).toBe(3);
  });

  it("reorders standings as soon as a result is added", () => {
    const before = createTournament(
      fourTeams.slice(0, 2),
      [{ id: "match-1", homeTeamId: "a", awayTeamId: "b" }],
      ["goalDifference"],
    );
    const after = {
      ...before,
      matchdays: [{
        ...before.matchdays[0],
        fixtures: [{
          ...before.matchdays[0].fixtures[0],
          result: { homeGoals: 0, awayGoals: 1 },
        }],
      }],
    };

    expect(calculateStandings(before).map((team) => team.teamId)).toEqual(["a", "b"]);
    expect(calculateStandings(after).map((team) => team.teamId)).toEqual(["b", "a"]);
  });

  it("counts interzonal results for a selected zone without adding the other zone's teams", () => {
    const tournament = createTournament(
      [
        { id: "a", name: "Zona A" },
        { id: "b", name: "Zona B" },
      ],
      [{
        id: "interzonal",
        homeTeamId: "a",
        awayTeamId: "b",
        result: { homeGoals: 2, awayGoals: 1 },
      }],
      ["goalDifference"],
    );
    const standings = calculateStandings({
      ...tournament,
      teams: [tournament.teams[0]],
    });

    expect(standings).toEqual([expect.objectContaining({
      teamId: "a",
      played: 1,
      wins: 1,
      points: 3,
      goalsFor: 2,
      goalsAgainst: 1,
    })]);
  });
});

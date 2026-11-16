import { describe, expect, it } from "vitest";
import type { CompetitionRulesConfiguration, Tournament } from "../entities/tournament";
import { calculateStandings } from "./standings";
import { calculateInternationalQualifications } from "./international-qualification";

function league(scores: readonly (readonly [number, number])[] = [[4, 0], [3, 0], [2, 0]]): Tournament {
  const teams = ["a", "b", "c", "d"].map((id) => ({ id, name: `Equipo ${id}` }));
  return {
    id: "league-2026",
    name: "Liga 2026",
    season: 2026,
    teams,
    legs: 1,
    tieBreakers: ["goalDifference", "goalsFor"],
    createdAt: "2026-01-01T00:00:00.000Z",
    matchdays: [{
      number: 1,
      leg: 1,
      fixtures: scores.map(([homeGoals, awayGoals], index) => ({
        id: `fixture-${index}`,
        homeTeamId: teams[index].id,
        awayTeamId: teams[index + 1].id,
        result: { homeGoals, awayGoals },
      })),
    }],
  };
}

function leagueWithMatches(
  matches: readonly { home: string; away: string; homeGoals: number; awayGoals: number }[],
  tieBreakers: Tournament["tieBreakers"] = ["goalDifference", "goalsFor", "wins"],
  teamNames: Readonly<Record<string, string>> = {},
): Tournament {
  const teams = ["a", "b", "c", "d"].map((id) => ({
    id,
    name: teamNames[id] ?? `Equipo ${id}`,
  }));
  return {
    id: "league-2026",
    name: "Liga 2026",
    season: 2026,
    teams,
    legs: 1,
    tieBreakers,
    createdAt: "2026-01-01T00:00:00.000Z",
    matchdays: [{
      number: 1,
      leg: 1,
      fixtures: matches.map((match, index) => ({
        id: `fixture-${index}`,
        homeTeamId: match.home,
        awayTeamId: match.away,
        result: { homeGoals: match.homeGoals, awayGoals: match.awayGoals },
      })),
    }],
  };
}

const tiedBoundaryLeague = (teamNames?: Readonly<Record<string, string>>) => leagueWithMatches([
  { home: "a", away: "b", homeGoals: 1, awayGoals: 0 },
  { home: "a", away: "c", homeGoals: 1, awayGoals: 0 },
  { home: "b", away: "c", homeGoals: 0, awayGoals: 0 },
], undefined, teamNames);

function completedCup(champion = "a"): Tournament {
  return {
    id: "cup-2026",
    name: "Copa 2026",
    season: 2026,
    teams: [{ id: "a", name: "Equipo a" }, { id: "b", name: "Equipo b" }],
    legs: 1,
    tieBreakers: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    competitionType: "cup",
    knockoutStages: [{ name: "Copa · Final", legs: 1 }],
    matchdays: [{
      number: 1,
      leg: 1,
      phaseName: "Copa · Final",
      fixtures: [{
        id: "final",
        homeTeamId: champion,
        awayTeamId: champion === "a" ? "b" : "a",
        knockoutResolution: "penalties",
        result: { homeGoals: 1, awayGoals: 0 },
      }],
    }],
  };
}

const verifiedRules: NonNullable<CompetitionRulesConfiguration["internationalQualification"]> = {
  verification: "verified",
  slots: [
    { destination: "conmebol-libertadores", position: 1 },
    { destination: "conmebol-sudamericana", position: 2 },
  ],
};

describe("calculateInternationalQualifications", () => {
  it("assigns configured positional slots after the league is complete", () => {
    const tournament = league();
    const result = calculateInternationalQualifications(
      calculateStandings(tournament),
      tournament,
      [],
      verifiedRules,
      "verified",
    );
    expect(result.qualifications.map(({ teamId, destination, status }) => [
      teamId, destination, status,
    ])).toEqual([
      ["a", "conmebol-libertadores", "confirmed"],
      ["b", "conmebol-sudamericana", "confirmed"],
    ]);
  });

  it("confirms a boundary place when configured sporting tie-breakers resolve the tie", () => {
    const tournament = leagueWithMatches([
      { home: "a", away: "b", homeGoals: 1, awayGoals: 1 },
      { home: "a", away: "c", homeGoals: 1, awayGoals: 0 },
      { home: "b", away: "c", homeGoals: 2, awayGoals: 0 },
    ]);
    const result = calculateInternationalQualifications(
      calculateStandings(tournament), tournament, [],
      { verification: "verified", slots: [{ destination: "libertadores", position: 1 }] },
      "verified",
    );
    expect(result.qualifications).toMatchObject([{ teamId: "b", status: "confirmed" }]);
    expect(result.pendingReasons).toHaveLength(0);
  });

  it("leaves an allocation pending when an unresolved tie crosses its last place", () => {
    const tournament = tiedBoundaryLeague();
    const result = calculateInternationalQualifications(
      calculateStandings(tournament), tournament, [],
      {
        verification: "verified",
        slots: [
          { destination: "libertadores", position: 1 },
          { destination: "libertadores", position: 2 },
        ],
      },
      "verified",
    );

    expect(result.qualifications).toMatchObject([
      { teamId: "a", destination: "libertadores", status: "confirmed" },
    ]);
    expect(result.qualifications.some(({ teamId }) => teamId === "b" || teamId === "c")).toBe(false);
    expect(result.pendingReasons.join(" ")).toContain("empate irresuelto");
  });

  it("does not block a determined place when the unresolved tie is below it", () => {
    const tournament = tiedBoundaryLeague();
    const result = calculateInternationalQualifications(
      calculateStandings(tournament), tournament, [],
      { verification: "verified", slots: [{ destination: "libertadores", position: 1 }] },
      "verified",
    );

    expect(result.qualifications).toMatchObject([
      { teamId: "a", destination: "libertadores", status: "confirmed" },
    ]);
    expect(result.pendingReasons).toHaveLength(0);
  });

  it("keeps a reallocated slot pending if skipping a cup champion moves it into an unresolved tie", () => {
    const tournament = tiedBoundaryLeague();
    const result = calculateInternationalQualifications(
      calculateStandings(tournament), tournament, [completedCup("a")],
      {
        verification: "verified",
        slots: [{ destination: "libertadores", position: 1 }],
        cupChampions: [{ sourceTournamentId: "cup-2026", destination: "libertadores" }],
        reallocation: "next-eligible-position",
      },
      "verified",
    );

    expect(result.qualifications).toMatchObject([
      { teamId: "a", destination: "libertadores", source: "Copa 2026" },
    ]);
    expect(result.qualifications.some(({ teamId }) => teamId === "b" || teamId === "c")).toBe(false);
    expect(result.pendingReasons.join(" ")).toContain("empate irresuelto");
  });

  it("does not change confirmed allocations when tied teams' names change", () => {
    const calculate = (tournament: Tournament) => calculateInternationalQualifications(
      calculateStandings(tournament), tournament, [],
      {
        verification: "verified",
        slots: [
          { destination: "libertadores", position: 1 },
          { destination: "libertadores", position: 2 },
        ],
      },
      "verified",
    );
    const first = calculate(tiedBoundaryLeague());
    const renamed = calculate(tiedBoundaryLeague({ b: "Zeta", c: "Alfa" }));

    expect(renamed.qualifications).toEqual(first.qualifications);
    expect(renamed.pendingReasons).toHaveLength(1);
    expect(first.pendingReasons).toHaveLength(1);
  });

  it("does not duplicate a cup champion already qualified by league position", () => {
    const tournament = league();
    const rules = {
      ...verifiedRules,
      slots: [{ destination: "libertadores", position: 1 }],
      cupChampions: [{ sourceTournamentId: "cup-2026", destination: "libertadores" }],
      reallocation: "none" as const,
    };
    const result = calculateInternationalQualifications(
      calculateStandings(tournament),
      tournament,
      [completedCup()],
      rules,
      "verified",
    );
    expect(result.qualifications.filter(({ teamId }) => teamId === "a")).toHaveLength(1);
    expect(result.qualifications[0]).toMatchObject({
      teamId: "a",
      source: "Copa 2026",
      status: "confirmed",
    });
  });

  it("keeps a cup qualification pending when the source edition belongs to another season", () => {
    const tournament = league();
    const result = calculateInternationalQualifications(
      calculateStandings(tournament), tournament, [{ ...completedCup(), season: 2025 }],
      {
        verification: "verified",
        slots: [
          { destination: "libertadores", position: 1 },
          { destination: "sudamericana", position: 2 },
        ],
        cupChampions: [{ sourceTournamentId: "cup-2026", destination: "libertadores" }],
      },
      "verified",
    );

    expect(result.qualifications).toMatchObject([
      { teamId: "a", destination: "libertadores", status: "pending" },
      { teamId: "b", destination: "sudamericana", status: "confirmed" },
    ]);
    expect(result.qualifications.some(({ source }) => source === "Copa 2026")).toBe(false);
    expect(result.pendingReasons.join(" ")).toContain("temporada 2025");
    expect(result.pendingReasons.join(" ")).toContain("temporada 2026");
  });

  it("keeps a cup qualification pending when the league or cup season cannot be verified", () => {
    const tournament = { ...league(), season: undefined };
    const result = calculateInternationalQualifications(
      calculateStandings(tournament), tournament, [completedCup()],
      {
        verification: "verified",
        slots: [],
        cupChampions: [{ sourceTournamentId: "cup-2026", destination: "libertadores" }],
      },
      "verified",
    );

    expect(result.qualifications).toEqual([]);
    expect(result.pendingReasons.join(" ")).toContain("No se puede verificar la temporada");
  });

  it("keeps a cup qualification pending when the cup has no season", () => {
    const tournament = league();
    const result = calculateInternationalQualifications(
      calculateStandings(tournament), tournament, [{ ...completedCup(), season: undefined }],
      {
        verification: "verified",
        slots: [],
        cupChampions: [{ sourceTournamentId: "cup-2026", destination: "libertadores" }],
      },
      "verified",
    );

    expect(result.qualifications).toEqual([]);
    expect(result.pendingReasons.join(" ")).toContain("No se puede verificar la temporada");
  });

  it("keeps a cup qualification pending when the configured source tournament is missing", () => {
    const tournament = league();
    const result = calculateInternationalQualifications(
      calculateStandings(tournament), tournament, [],
      {
        verification: "verified",
        slots: [],
        cupChampions: [{ sourceTournamentId: "missing-cup-2026", destination: "libertadores" }],
      },
      "verified",
    );

    expect(result.qualifications).toEqual([]);
    expect(result.pendingReasons.join(" ")).toContain("missing-cup-2026");
  });

  it("moves the league slot forward only when next-position reallocation is configured", () => {
    const tournament = league();
    const result = calculateInternationalQualifications(
      calculateStandings(tournament),
      tournament,
      [completedCup()],
      {
        verification: "verified",
        slots: [
          { destination: "libertadores", position: 1 },
          { destination: "libertadores", position: 2 },
        ],
        cupChampions: [{ sourceTournamentId: "cup-2026", destination: "libertadores" }],
        reallocation: "next-eligible-position",
      },
      "verified",
    );
    expect(result.qualifications.map(({ teamId }) => teamId)).toEqual(["a", "b", "c"]);
    expect(new Set(result.qualifications.map(({ teamId, destination }) =>
      `${teamId}:${destination}`,
    )).size).toBe(3);
  });

  it("does not give a team duplicate destinations without an explicit reallocation rule", () => {
    const tournament = league();
    const result = calculateInternationalQualifications(
      calculateStandings(tournament),
      tournament,
      [completedCup()],
      {
        verification: "verified",
        slots: [{ destination: "sudamericana", position: 1 }],
        cupChampions: [{ sourceTournamentId: "cup-2026", destination: "libertadores" }],
        reallocation: "none",
      },
      "verified",
    );
    expect(result.qualifications.map(({ teamId }) => teamId)).toEqual(["a"]);
    expect(result.pendingReasons.join(" ")).toContain("ya tiene otro cupo");
  });

  it("keeps affected places pending while a configured cup has no resolved champion", () => {
    const tournament = league();
    const cup = completedCup();
    const unfinishedCup: Tournament = {
      ...cup,
      matchdays: [{
        ...cup.matchdays[0],
        fixtures: [{ ...cup.matchdays[0].fixtures[0], result: undefined }],
      }],
    };
    const result = calculateInternationalQualifications(
      calculateStandings(tournament),
      tournament,
      [unfinishedCup],
      {
        ...verifiedRules,
        cupChampions: [{ sourceTournamentId: "cup-2026", destination: "conmebol-libertadores" }],
        reallocation: "next-eligible-position",
      },
      "verified",
    );
    expect(result.qualifications[0].status).toBe("pending");
    expect(result.pendingReasons.join(" ")).toContain("resolver");
  });

  it("does not claim verified qualification when rules are pending or the league is unfinished", () => {
    const unfinished = league([[1, 0]]);
    const result = calculateInternationalQualifications(
      calculateStandings(unfinished),
      unfinished,
      [],
      { ...verifiedRules, verification: "pending" },
      "pending",
    );
    expect(result.qualifications.every(({ status }) => status === "pending")).toBe(true);
    expect(result.pendingReasons.length).toBeGreaterThan(0);
  });

  it("keeps league slots provisional when a preserved score is no longer final", () => {
    const completed = league();
    const tournament: Tournament = {
      ...completed,
      matchdays: completed.matchdays.map((matchday) => ({
        ...matchday,
        fixtures: matchday.fixtures.map((fixture, index) => index === 0
          ? { ...fixture, operationalState: { status: "postponed" as const, updatedAt: "2026-06-01T00:00:00.000Z" } }
          : fixture),
      })),
    };
    const result = calculateInternationalQualifications(
      calculateStandings(tournament), tournament, [], verifiedRules, "verified",
    );

    expect(result.qualifications.every(({ status }) => status === "provisional")).toBe(true);
    expect(result.pendingReasons.join(" ")).toContain("partidos sin resultado");
  });

  it("recalculates allocations after a league result changes", () => {
    const before = league([[1, 0], [1, 0], [1, 0]]);
    const after: Tournament = {
      ...before,
      matchdays: [{
        ...before.matchdays[0],
        fixtures: before.matchdays[0].fixtures.map((fixture, index) =>
          index === 0
            ? { ...fixture, result: { homeGoals: 0, awayGoals: 5 } }
            : fixture,
        ),
      }],
    };
    const calculate = (tournament: Tournament) => calculateInternationalQualifications(
      calculateStandings(tournament),
      tournament,
      [],
      verifiedRules,
      "verified",
    ).qualifications;
    expect(calculate(before)[0].teamId).not.toBe(calculate(after)[0].teamId);
  });
});

describe("audit: uncertain league data",()=>{
 it("does not confirm international places while standings rules are pending",()=>{
   const tournament={...league(),competitionRules:{season:2026,verification:{standings:"pending" as const,placements:"verified" as const}}};
   const result=calculateInternationalQualifications(calculateStandings(tournament),tournament,[],verifiedRules,"verified");
   expect(result.qualifications.some(q=>q.status==="confirmed")).toBe(false);
 });
 it.each(["partial","unknown"] as const)("does not confirm places from a calendar with %s coverage",coverage=>{
   const tournament={...league(),importCoverage:coverage};
   const result=calculateInternationalQualifications(calculateStandings(tournament),tournament,[],verifiedRules,"verified");
   expect(result.qualifications.some(q=>q.status==="confirmed")).toBe(false);
 });
});

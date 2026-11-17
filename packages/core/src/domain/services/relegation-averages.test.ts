import { describe, expect, it } from "vitest";
import type { RelegationAverageConfiguration, Tournament } from "../entities/tournament";
import { calculateRelegationAverages } from "./relegation-averages";
import { calculateStandings } from "./standings";
import { classifyPosition } from "./placement-classification";

function season(
  year: number,
  matches: readonly {
    readonly home: string;
    readonly away: string;
    readonly homeGoals: number;
    readonly awayGoals: number;
  }[],
): Tournament {
  const ids = [...new Set(matches.flatMap(({ home, away }) => [home, away]))];
  const teams = ids.map((id) => ({ id, name: id.toLocaleUpperCase("es") }));
  return {
    id: `league-${year}`,
    name: `Liga ${year}`,
    teams,
    legs: 1,
    tieBreakers: [],
    competitionRules: {
      season: year,
      verification: { standings: "verified", placements: "pending" },
    },
    createdAt: `${year}-01-01T00:00:00.000Z`,
    matchdays: [{
      number: 1,
      leg: 1,
      fixtures: matches.map(({ home, away, homeGoals, awayGoals }, index) => ({
        id: `${year}-${index}`,
        homeTeamId: home,
        awayTeamId: away,
        result: { homeGoals, awayGoals },
      })),
    }],
  };
}

const config = (
  seasons: readonly number[],
  overrides: Partial<RelegationAverageConfiguration> = {},
): RelegationAverageConfiguration => ({
  verification: "verified",
  seasons,
  relegatedCount: 1,
  ...overrides,
});

describe("calculateRelegationAverages", () => {
  it("calculates total games and points over all configured seasons", () => {
    const first = season(2024, [{ home: "a", away: "b", homeGoals: 2, awayGoals: 0 }]);
    const second = season(2025, [{ home: "a", away: "b", homeGoals: 1, awayGoals: 1 }]);
    const result = calculateRelegationAverages(
      second,
      [first],
      config([2024, 2025]),
    );
    expect(result.standings.find(({ teamId }) => teamId === "a")).toMatchObject({
      points: 4,
      played: 2,
      average: 2,
      completeHistory: true,
      status: "confirmed",
    });
  });

  it("does not count or confirm a tournament whose season conflicts with its rules season", () => {
    const inconsistent: Tournament = {
      ...season(2026, [{ home: "a", away: "b", homeGoals: 2, awayGoals: 0 }]),
      season: 2026,
      competitionRules: {
        season: 2025,
        verification: { standings: "verified", placements: "verified" },
      },
    };
    const result = calculateRelegationAverages(inconsistent, [], config([2025, 2026]));

    expect(result.standings.find(({ teamId }) => teamId === "a")).toMatchObject({
      played: 0,
      points: 0,
      status: "provisional",
    });
    expect(result.pendingReasons.join(" ")).toContain("incompatibles");
    expect(result.pendingReasons.join(" ")).toContain("league-2026");
  });

  it("excludes preserved non-final scores from averages, head-to-head and completeness", () => {
    const completed = season(2026, [
      { home: "a", away: "b", homeGoals: 2, awayGoals: 0 },
      { home: "b", away: "a", homeGoals: 0, awayGoals: 0 },
    ]);
    const matchdays = completed.matchdays.map((matchday) => ({
      ...matchday,
      fixtures: matchday.fixtures.map((fixture, index) => index === 0
        ? { ...fixture, operationalState: { status: "cancelled" as const, updatedAt: "2026-06-01T00:00:00.000Z" } }
        : fixture),
    }));
    const interrupted = { ...completed, matchdays };
    const result = calculateRelegationAverages(
      interrupted,
      [],
      config([2026], { tieBreakers: ["headToHead"] }),
    );

    expect(interrupted.matchdays[0].fixtures[0].result).toEqual({ homeGoals: 2, awayGoals: 0 });
    expect(result.standings.find(({ teamId }) => teamId === "a")).toMatchObject({
      played: 1,
      points: 1,
      status: "provisional",
    });
    expect(result.standings[0].rank).toBe(result.standings[1].rank);
    expect(result.pendingReasons.join(" ")).toContain("partidos sin resultado");
  });

  it("uses actual matches for a recently promoted club and labels its missing history provisional", () => {
    const first = season(2024, [{ home: "old", away: "opponent", homeGoals: 0, awayGoals: 1 }]);
    const second = season(2025, [{ home: "new", away: "opponent", homeGoals: 1, awayGoals: 0 }]);
    const result = calculateRelegationAverages(
      second,
      [first],
      config([2024, 2025]),
    );
    expect(result.standings.find(({ teamId }) => teamId === "new")).toMatchObject({
      played: 1,
      average: 3,
      completeHistory: false,
      status: "provisional",
    });
  });

  it("does not invent a tiebreaker for equal averages and flags an unresolved relegation boundary", () => {
    const tournament = season(2026, [
      { home: "a", away: "b", homeGoals: 1, awayGoals: 0 },
      { home: "b", away: "a", homeGoals: 1, awayGoals: 0 },
    ]);
    const result = calculateRelegationAverages(tournament, [], config([2026]));
    expect(result.standings[0].rank).toBe(result.standings[1].rank);
    expect(result.standings.every(({ tiedAtBoundary, status }) =>
      tiedAtBoundary && status === "provisional",
    )).toBe(true);
    expect(result.pendingReasons.join(" ")).toContain("empate");
  });

  it("applies only the configured average tie-breaker order", () => {
    const tournament = season(2026, [
      { home: "a", away: "b", homeGoals: 3, awayGoals: 0 },
      { home: "b", away: "a", homeGoals: 1, awayGoals: 0 },
    ]);
    const result = calculateRelegationAverages(
      tournament,
      [],
      config([2026], { tieBreakers: ["goalDifference"] }),
    );
    expect(result.standings[0].teamId).toBe("a");
    expect(result.standings[0].rank).toBe(1);
    expect(result.standings[1].rank).toBe(2);
  });

  it("keeps average-based relegation distinct from the current annual-table bottom", () => {
    const previous = season(2024, [
      { home: "a", away: "b", homeGoals: 1, awayGoals: 0 },
      { home: "c", away: "b", homeGoals: 1, awayGoals: 0 },
      { home: "a", away: "c", homeGoals: 0, awayGoals: 0 },
    ]);
    const current = season(2025, [
      { home: "b", away: "a", homeGoals: 1, awayGoals: 0 },
      { home: "c", away: "b", homeGoals: 1, awayGoals: 0 },
      { home: "c", away: "a", homeGoals: 1, awayGoals: 0 },
    ]);
    const averageResult = calculateRelegationAverages(
      current,
      [previous],
      config([2024, 2025]),
    );
    const annualStandings = calculateStandings(current);
    const annualBottom = annualStandings[annualStandings.length - 1]?.teamId;
    const averageRelegated = averageResult.standings.find(({ relegation }) => relegation)?.teamId;

    expect(annualBottom).toBe("a");
    expect(classifyPosition(3, 3, { relegationPlaces: 1 })).toBe("relegation");
    expect(averageRelegated).toBe("b");
  });

  it("keeps placements pending when the average format is not verified", () => {
    const tournament = season(2026, [{ home: "a", away: "b", homeGoals: 1, awayGoals: 0 }]);
    const result = calculateRelegationAverages(
      tournament,
      [],
      config([2026], { verification: "pending" }),
    );
    expect(result.standings.every(({ status }) => status === "pending")).toBe(true);
    expect(result.pendingReasons[0]).toContain("no está verificado");
  });

  it("recalculates after editing a stored result and reports missing seasons", () => {
    const before = season(2025, [{ home: "a", away: "b", homeGoals: 1, awayGoals: 0 }]);
    const after: Tournament = {
      ...before,
      matchdays: [{
        ...before.matchdays[0],
        fixtures: [{
          ...before.matchdays[0].fixtures[0],
          result: { homeGoals: 0, awayGoals: 1 },
        }],
      }],
    };
    const rules = config([2024, 2025]);
    const previous = calculateRelegationAverages(before, [], rules);
    const updated = calculateRelegationAverages(after, [], rules);
    expect(previous.standings[0].teamId).not.toBe(updated.standings[0].teamId);
    expect(updated.pendingReasons.join(" ")).toContain("2024");
  });
});

describe("audit: incomplete average histories",()=>{
 it.each(["partial","unknown"] as const)("keeps averages provisional with %s historical coverage",coverage=>{
   const current={...season(2026,[{home:"a",away:"b",homeGoals:1,awayGoals:0}]),importCoverage:coverage};
   expect(calculateRelegationAverages(current,[],config([2026])).standings.some(row=>row.status==="confirmed")).toBe(false);
 });
 it("does not select an arbitrary duplicate historical season",()=>{
   const first=season(2025,[{home:"a",away:"b",homeGoals:1,awayGoals:0}]);
   const current=season(2026,[{home:"a",away:"b",homeGoals:1,awayGoals:0}]);
   const duplicate={...first,id:"duplicate-2025",competitionId:"league"};
   expect(calculateRelegationAverages(current,[first,duplicate],config([2025,2026])).standings.some(row=>row.status==="confirmed")).toBe(false);
 });
});

it("does not mix average histories from another competition with the same club names",()=>{
 const previous=season(2025,[{home:"a",away:"b",homeGoals:1,awayGoals:0}]);
 const foreign={...previous,id:"another-league-2025",competitionId:"another-league",matchdays:previous.matchdays.map(d=>({...d,fixtures:d.fixtures.map(f=>({...f,result:{homeGoals:0,awayGoals:8}}))}))};
 const current=season(2026,[{home:"a",away:"b",homeGoals:1,awayGoals:0}]);
 const result=calculateRelegationAverages(current,[previous,foreign],config([2025,2026]));
 expect(result.standings.find(row=>row.teamId==="a")).toMatchObject({points:6,played:2,average:3});
});

it("uses the same Argentina regular-season scope as the annual transition",()=>{
 const source=season(2026,[{home:"a",away:"b",homeGoals:1,awayGoals:0}]);
 const t: Tournament={...source,id:"arg-liga-profesional-2026",competitionId:"arg-liga-profesional",matchdays:[
 {...source.matchdays[0],phaseName:"Torneo Apertura · Fase regular"},
 {...source.matchdays[0],number:2,phaseName:"Torneo Apertura · Final",fixtures:source.matchdays[0].fixtures.map(f=>({...f,id:"final",result:{homeGoals:0,awayGoals:8}}))}]};
 expect(calculateRelegationAverages(t,[],config([2026])).standings.find(row=>row.teamId==="a")).toMatchObject({points:3,played:1,average:3});
});

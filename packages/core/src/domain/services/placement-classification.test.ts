import { describe, expect, it } from "vitest";
import type { Tournament } from "../entities/tournament";
import {
  classifyPosition,
  getPlayoffPlacementStatuses,
} from "./placement-classification";
import { chileanPrimera2026PlacementRules } from "./chilean-primera-placement-rules";

describe("classifyPosition", () => {
  it("marks the champion, the Segunda B playoff positions, and the relegation places", () => {
    const rules = {
      championPlaces: 1,
      playoffPlaces: { from: 2, to: 8 },
      relegationPlaces: 2,
    };

    expect(classifyPosition(1, 16, rules)).toBe("champion");
    expect(classifyPosition(2, 16, rules)).toBe("playoff");
    expect(classifyPosition(8, 16, rules)).toBe("playoff");
    expect(classifyPosition(9, 16, rules)).toBeUndefined();
    expect(classifyPosition(15, 16, rules)).toBe("relegation");
    expect(classifyPosition(16, 16, rules)).toBe("relegation");
  });

  describe("getPlayoffPlacementStatuses", () => {
    it("distinguishes provisional places from mathematically secured places", () => {
      const standings = [
        { teamId: "a", teamName: "A", points: 30 },
        { teamId: "b", teamName: "B", points: 24 },
        { teamId: "c", teamName: "C", points: 22 },
      ].map((standing) => ({
        ...standing,
        played: 10,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
      }));
      const pendingFixture = {
        id: "pending",
        homeTeamId: "c",
        awayTeamId: "a",
      };
      const tournament: Tournament = {
        id: "league",
        name: "Liga",
        teams: ["a", "b", "c"].map((id) => ({ id, name: id.toUpperCase() })),
        legs: 1,
        tieBreakers: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        matchdays: [{ number: 1, leg: 1, fixtures: [pendingFixture] }],
      };
      const rules = { playoffPlaces: { from: 2, to: 2 } };
      expect(getPlayoffPlacementStatuses(standings, [pendingFixture], rules, tournament).get("b"))
        .toBe("provisional");
      expect(getPlayoffPlacementStatuses(standings, [], rules, tournament).get("b"))
        .toBe("confirmed");
    });

    it("counts a preserved non-final score as a remaining fixture", () => {
      const standings = ["a", "b", "c"].map((teamId, index) => ({
        teamId,
        teamName: teamId.toUpperCase(),
        played: 10,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        goalDifference: 0,
        points: [30, 24, 22][index],
      }));
      const fixture = {
        id: "preserved-score",
        homeTeamId: "c",
        awayTeamId: "a",
        result: { homeGoals: 1, awayGoals: 0 },
        operationalState: { status: "suspended" as const, updatedAt: "2026-06-01T00:00:00.000Z" },
      };
      const tournament: Tournament = {
        id: "league-2026",
        name: "Liga 2026",
        teams: standings.map(({ teamId, teamName }) => ({ id: teamId, name: teamName })),
        legs: 1,
        tieBreakers: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        matchdays: [{ number: 1, leg: 1, fixtures: [fixture] }],
      };

      const statuses = getPlayoffPlacementStatuses(
        standings,
        [fixture],
        { playoffPlaces: { from: 2, to: 2 } },
        tournament,
      );
      expect(statuses.get("b")).toBe("provisional");
    });
  });

  it("does not mark relegation in the promotion zone", () => {
    const rules = { championPlaces: 1 };

    expect(classifyPosition(1, 7, rules)).toBe("champion");
    expect(classifyPosition(7, 7, rules)).toBeUndefined();
  });

  it("marks relegation relative to the selected zone table", () => {
    expect(classifyPosition(7, 7, { relegationPlaces: 1 })).toBe("relegation");
    expect(classifyPosition(6, 7, { relegationPlaces: 1 })).toBeUndefined();
  });

  it("does not classify positions from invalid relegation-place rules", () => {
    for (const relegationPlaces of [-1, 1.5, 5]) {
      expect(classifyPosition(1, 4, { relegationPlaces })).toBeUndefined();
      expect(classifyPosition(4, 4, { relegationPlaces })).toBeUndefined();
    }
    expect(classifyPosition(1, 4, { relegationPlaces: 0 })).toBeUndefined();
    expect(classifyPosition(1, 4, { relegationPlaces: 4 })).toBe("relegation");
  });

  it("marks the Third A promotion and relegation playoff places separately", () => {
    const rules = {
      championPlaces: 1,
      playoffPlaces: { from: 2, to: 5 },
      relegationPlayoffPlaces: { from: 11, to: 12 },
      relegationPlaces: 2,
    };

    expect(classifyPosition(1, 14, rules)).toBe("champion");
    expect(classifyPosition(2, 14, rules)).toBe("playoff");
    expect(classifyPosition(5, 14, rules)).toBe("playoff");
    expect(classifyPosition(10, 14, rules)).toBeUndefined();
    expect(classifyPosition(11, 14, rules)).toBe("relegation-playoff");
    expect(classifyPosition(12, 14, rules)).toBe("relegation-playoff");
    expect(classifyPosition(13, 14, rules)).toBe("relegation");
    expect(classifyPosition(14, 14, rules)).toBe("relegation");
  });

  it("marks the Third B direct promotion, promotion playoff and relegation places", () => {
    const rules = {
      championPlaces: 1,
      playoffPlaces: { from: 2, to: 3 },
      relegationPlaces: 2,
    };

    expect(classifyPosition(1, 14, rules)).toBe("champion");
    expect(classifyPosition(2, 14, rules)).toBe("playoff");
    expect(classifyPosition(3, 14, rules)).toBe("playoff");
    expect(classifyPosition(4, 14, rules)).toBeUndefined();
    expect(classifyPosition(13, 14, rules)).toBe("relegation");
    expect(classifyPosition(14, 14, rules)).toBe("relegation");
  });

  it("marks the Argentine annual champion, continental places and relegation", () => {
    const rules = {
      championPlaces: 1,
      libertadoresPlaces: { from: 2, to: 2 },
      libertadoresQualifyingPlaces: { from: 3, to: 3 },
      sudamericanaPlaces: { from: 4, to: 9 },
      relegationPlaces: 1,
    };

    expect(classifyPosition(1, 30, rules)).toBe("champion");
    expect(classifyPosition(2, 30, rules)).toBe("libertadores");
    expect(classifyPosition(3, 30, rules)).toBe("libertadores-qualifying");
    expect(classifyPosition(9, 30, rules)).toBe("sudamericana");
    expect(classifyPosition(10, 30, rules)).toBeUndefined();
    expect(classifyPosition(30, 30, rules)).toBe("relegation");
  });

  it("marks Chilean Primera continental places and relegation", () => {
    const rules = {
      championPlaces: 1,
      libertadoresPlaces: { from: 1, to: 2 },
      libertadoresQualifyingPlaces: { from: 3, to: 3 },
      sudamericanaPlaces: { from: 4, to: 6 },
      relegationPlaces: 2,
    };

    expect(classifyPosition(1, 16, rules)).toBe("champion");
    expect(classifyPosition(2, 16, rules)).toBe("libertadores");
    expect(classifyPosition(3, 16, rules)).toBe("libertadores-qualifying");
    expect(classifyPosition(4, 16, rules)).toBe("sudamericana");
    expect(classifyPosition(6, 16, rules)).toBe("sudamericana");
    expect(classifyPosition(7, 16, rules)).toBeUndefined();
    expect(classifyPosition(15, 16, rules)).toBe("relegation");
    expect(classifyPosition(16, 16, rules)).toBe("relegation");
  });
});

it("does not confirm a playoff place while its table rules are explicitly pending",()=>{
 const t: Tournament={id:"audit",name:"Audit",season:2026,teams:[{id:"a",name:"A"},{id:"b",name:"B"}],legs:1,tieBreakers:[],createdAt:"2026-01-01T00:00:00Z",matchdays:[],competitionRules:{season:2026,verification:{standings:"pending",placements:"verified"}}};
 const table=t.teams.map((team,index)=>({teamId:team.id,teamName:team.name,played:1,wins:1-index,draws:0,losses:index,goalsFor:1-index,goalsAgainst:index,goalDifference:1-index*2,points:3*(1-index)}));
 const statuses=getPlayoffPlacementStatuses(table,[],{playoffPlaces:{from:1,to:1}},t);
 expect(statuses.get("a")).toBe("provisional");
 expect(statuses.has("b")).toBe(false);
});

describe("getPlayoffPlacementStatuses with unverified annual rules", () => {
  const teams = Array.from({ length: 16 }, (_, index) => ({ id: `t${index + 1}`, name: `Club ${index + 1}` }));
  const table = teams.map((team, index) => ({
    teamId: team.id, teamName: team.name, played: 30, wins: 16 - index, draws: 0, losses: index + 14,
    goalsFor: 30, goalsAgainst: 30, goalDifference: 0, points: 3 * (16 - index),
  }));
  const tournament = (id: string): Tournament => ({
    id, name: id, season: 2026, teams, legs: 2, tieBreakers: [], createdAt: "2026-01-01T00:00:00Z", matchdays: [],
    competitionRules: { season: 2026, verification: { standings: "pending", placements: "provisional" } },
  });

  it("does not mark any Liga de Primera 2026 team, because that league has no playoff places", () => {
    const statuses = getPlayoffPlacementStatuses(
      table, [], chileanPrimera2026PlacementRules, tournament("anfp-liga-primera-2026"),
    );
    expect(statuses.size).toBe(0);
  });

  it("marks only the 2nd–8th Primera B places as provisional", () => {
    const statuses = getPlayoffPlacementStatuses(
      table,
      [],
      { championPlaces: 1, playoffPlaces: { from: 2, to: 8 }, relegationPlaces: 1 },
      tournament("anfp-liga-de-ascenso-2026"),
    );
    expect([...statuses.keys()]).toEqual(["t2", "t3", "t4", "t5", "t6", "t7", "t8"]);
    expect([...statuses.values()].every((status) => status === "provisional")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import type { Fixture, Matchday, Tournament } from "../entities/tournament";
import { getAggregateScoreBeforeFixture } from "./aggregate-knockout-score";
import { isValidFixtureResult } from "./match-result-validation";

describe("getAggregateScoreBeforeFixture", () => {
  it("does not use an invalid or operationally unfinished first-leg result", () => {
    const firstLeg: Fixture = {
      id: "first-leg",
      homeTeamId: "home",
      awayTeamId: "away",
      result: { homeGoals: 0, awayGoals: 0 },
      operationalState: {
        status: "suspended",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    };
    const returnLeg: Fixture = {
      id: "return-leg",
      homeTeamId: "away",
      awayTeamId: "home",
    };
    const matchdays: Matchday[] = [
      {
        number: 1,
        leg: 1,
        phaseName: "Semifinal · Ida",
        fixtures: [firstLeg],
      },
      {
        number: 2,
        leg: 2,
        phaseName: "Semifinal · Vuelta",
        fixtures: [returnLeg],
      },
    ];

    expect(getAggregateScoreBeforeFixture(matchdays, matchdays[1], returnLeg))
      .toBeUndefined();
    const legacyMatchdays: Matchday[] = [
      { ...matchdays[0], fixtures: [{ ...firstLeg, operationalState: undefined }] },
      matchdays[1],
    ];
    expect(getAggregateScoreBeforeFixture(legacyMatchdays, legacyMatchdays[1], returnLeg, new Map([
      ["first-leg", { homeGoals: 100, awayGoals: 0 }],
    ]))).toBeUndefined();
  });

  it("does not validate a penalty shootout against a suspended first leg", () => {
    const tournament: Tournament = {
      id: "two-leg-cup",
      name: "Two-leg cup",
      teams: [{ id: "home", name: "Home" }, { id: "away", name: "Away" }],
      legs: 2,
      tieBreakers: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      matchdays: [
        {
          number: 1,
          leg: 1,
          phaseName: "Semifinal · Ida",
          fixtures: [{
            id: "first-leg",
            homeTeamId: "home",
            awayTeamId: "away",
            result: { homeGoals: 0, awayGoals: 0 },
            operationalState: {
              status: "suspended",
              updatedAt: "2026-06-01T00:00:00.000Z",
            },
          }],
        },
        {
          number: 2,
          leg: 2,
          phaseName: "Semifinal · Vuelta",
          fixtures: [{
            id: "return-leg",
            homeTeamId: "away",
            awayTeamId: "home",
            knockoutResolution: "aggregate-then-penalties",
            result: {
              homeGoals: 0,
              awayGoals: 0,
              penalties: { homeGoals: 4, awayGoals: 3 },
            },
          }],
        },
      ],
    };

    expect(isValidFixtureResult(
      tournament,
      tournament.matchdays[1],
      tournament.matchdays[1].fixtures[0],
    )).toBe(false);
  });
});

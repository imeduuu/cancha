import { describe, expect, it } from "vitest";
import type { Matchday, Tournament } from "../entities/tournament";
import { advanceOfficialCupProgression } from "./official-cup-progression";
import { simulateFixtures } from "../../application/use-cases/simulate-fixtures";

function createTournament(matchdays: readonly Matchday[]): Tournament {
  return {
    id: "anfp-copa-chile-2026",
    name: "Copa Chile 2026",
    teams: [],
    legs: 2,
    tieBreakers: [],
    matchdays,
    createdAt: "2026-01-01T00:00:00.000Z",
    competitionType: "cup",
    knockoutStages: [
      { name: "Copa Chile · Cuartos de final", legs: 2 },
      { name: "Copa Chile · Semifinales", legs: 2 },
      { name: "Copa Chile · Final", legs: 1 },
    ],
  };
}

describe("advanceOfficialCupProgression", () => {
  it("shows future cup stages and creates the semifinalists from aggregate scores and penalties", () => {
    const tournament = advanceOfficialCupProgression(createTournament([
      {
        number: 1,
        leg: 1,
        phaseName: "Copa Chile · Cuartos de final · Ida",
        fixtures: [
          {
            id: "qf-a-first",
            homeTeamId: "team-a",
            awayTeamId: "team-b",
            result: { homeGoals: 1, awayGoals: 0 },
          },
          {
            id: "qf-c-first",
            homeTeamId: "team-c",
            awayTeamId: "team-d",
            result: { homeGoals: 1, awayGoals: 0 },
          },
        ],
      },
      {
        number: 1,
        leg: 2,
        phaseName: "Copa Chile · Cuartos de final · Vuelta",
        fixtures: [
          {
            id: "qf-a-return",
            homeTeamId: "team-b",
            awayTeamId: "team-a",
            knockoutResolution: "aggregate-then-penalties",
            result: {
              homeGoals: 1,
              awayGoals: 0,
              penalties: { homeGoals: 4, awayGoals: 3 },
            },
          },
          {
            id: "qf-c-return",
            homeTeamId: "team-d",
            awayTeamId: "team-c",
            knockoutResolution: "aggregate-then-penalties",
            result: { homeGoals: 0, awayGoals: 0 },
          },
        ],
      },
    ]));

    expect(tournament.matchdays.map(({ phaseName, fixtures }) => [
      phaseName,
      fixtures.length,
    ])).toEqual([
      ["Copa Chile · Cuartos de final · Ida", 2],
      ["Copa Chile · Cuartos de final · Vuelta", 2],
      ["Copa Chile · Semifinales · Ida", 1],
      ["Copa Chile · Semifinales · Vuelta", 1],
      ["Copa Chile · Final", 0],
    ]);
    expect(tournament.matchdays[2].fixtures[0]).toMatchObject({
      homeTeamId: "team-b",
      awayTeamId: "team-c",
    });
    expect(tournament.matchdays[3].fixtures[0]).toMatchObject({
      homeTeamId: "team-c",
      awayTeamId: "team-b",
      knockoutResolution: "aggregate-then-penalties",
    });
  });

  it("does not advance a two-leg stage until both legs are complete", () => {
    const tournament = advanceOfficialCupProgression(createTournament([{
      number: 1,
      leg: 1,
      phaseName: "Copa Chile · Cuartos de final · Ida",
      fixtures: [{
        id: "pending-return",
        homeTeamId: "team-a",
        awayTeamId: "team-b",
        result: { homeGoals: 1, awayGoals: 0 },
      }],
    }]));

    expect(tournament.matchdays.find(
      ({ phaseName }) => phaseName === "Copa Chile · Semifinales · Ida",
    )?.fixtures).toEqual([]);
    expect(tournament.matchdays.find(
      ({ phaseName }) => phaseName === "Copa Chile · Final",
    )?.fixtures).toEqual([]);
  });

  it("creates a one-match final after a tied aggregate is decided on penalties", () => {
    const tournament = advanceOfficialCupProgression(createTournament([
      {
        number: 1,
        leg: 1,
        phaseName: "Copa Chile · Cuartos de final · Ida",
        fixtures: [
          {
            id: "qf-first",
            homeTeamId: "team-a",
            awayTeamId: "team-b",
            result: { homeGoals: 1, awayGoals: 0 },
          },
          {
            id: "qf-second-first",
            homeTeamId: "team-c",
            awayTeamId: "team-d",
            result: { homeGoals: 1, awayGoals: 0 },
          },
          {
            id: "qf-third-first",
            homeTeamId: "team-e",
            awayTeamId: "team-f",
            result: { homeGoals: 1, awayGoals: 0 },
          },
          {
            id: "qf-fourth-first",
            homeTeamId: "team-g",
            awayTeamId: "team-h",
            result: { homeGoals: 1, awayGoals: 0 },
          },
        ],
      },
      {
        number: 1,
        leg: 2,
        phaseName: "Copa Chile · Cuartos de final · Vuelta",
        fixtures: [
          {
            id: "qf-return",
            homeTeamId: "team-b",
            awayTeamId: "team-a",
            knockoutResolution: "aggregate-then-penalties",
            result: {
              homeGoals: 1,
              awayGoals: 0,
              penalties: { homeGoals: 3, awayGoals: 4 },
            },
          },
          {
            id: "qf-second-return",
            homeTeamId: "team-d",
            awayTeamId: "team-c",
            knockoutResolution: "aggregate-then-penalties",
            result: { homeGoals: 0, awayGoals: 0 },
          },
          {
            id: "qf-third-return",
            homeTeamId: "team-f",
            awayTeamId: "team-e",
            knockoutResolution: "aggregate-then-penalties",
            result: { homeGoals: 0, awayGoals: 0 },
          },
          {
            id: "qf-fourth-return",
            homeTeamId: "team-h",
            awayTeamId: "team-g",
            knockoutResolution: "aggregate-then-penalties",
            result: { homeGoals: 0, awayGoals: 0 },
          },
        ],
      },
    ]));
    const semifinalFirstLeg = tournament.matchdays.find(
      ({ phaseName }) => phaseName === "Copa Chile · Semifinales · Ida",
    );
    const semifinalReturnLeg = tournament.matchdays.find(
      ({ phaseName }) => phaseName === "Copa Chile · Semifinales · Vuelta",
    );
    if (!semifinalFirstLeg || !semifinalReturnLeg) {
      throw new Error("Faltaron las semifinales generadas.");
    }

    const completedSemiTournament = {
      ...tournament,
      matchdays: tournament.matchdays.map((matchday) => {
        if (matchday === semifinalFirstLeg) {
          return {
            ...matchday,
            fixtures: matchday.fixtures.map((fixture) => ({
              ...fixture,
              result: { homeGoals: 0, awayGoals: 1 },
            })),
          };
        }
        if (matchday === semifinalReturnLeg) {
          return {
            ...matchday,
            fixtures: matchday.fixtures.map((fixture) => ({
              ...fixture,
              result: {
                homeGoals: 0,
                awayGoals: 1,
                penalties: { homeGoals: 4, awayGoals: 2 },
              },
            })),
          };
        }
        return matchday;
      }),
    };

    const finalTournament = advanceOfficialCupProgression(completedSemiTournament);
    expect(finalTournament.matchdays.find(
      ({ phaseName }) => phaseName === "Copa Chile · Final",
    )?.fixtures).toHaveLength(1);
    expect(finalTournament.matchdays.find(
      ({ phaseName }) => phaseName === "Copa Chile · Final",
    )?.fixtures[0].knockoutResolution).toBe("penalties");
  });

  it("rebuilds dependent cup rounds after overwriting an earlier result and keeps valid matches", () => {
    const teams = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const firstLegFixtures = Array.from({ length: 4 }, (_, index) => ({
      id: `qf-${index + 1}-ida`,
      homeTeamId: teams[index * 2],
      awayTeamId: teams[index * 2 + 1],
      result: { homeGoals: 0, awayGoals: 0 },
    }));
    const returnLegFixtures = Array.from({ length: 4 }, (_, index) => ({
      id: `qf-${index + 1}-vuelta`,
      homeTeamId: teams[index * 2 + 1],
      awayTeamId: teams[index * 2],
      knockoutResolution: "aggregate-then-penalties" as const,
      result: { homeGoals: 1, awayGoals: 0 },
    }));
    const initial = advanceOfficialCupProgression(createTournament([
      {
        number: 1,
        leg: 1,
        phaseName: "Copa Chile · Cuartos de final · Ida",
        fixtures: firstLegFixtures,
      },
      {
        number: 1,
        leg: 2,
        phaseName: "Copa Chile · Cuartos de final · Vuelta",
        fixtures: returnLegFixtures,
      },
    ]));
    const withCompletedSemifinals = advanceOfficialCupProgression({
      ...initial,
      matchdays: initial.matchdays.map((matchday) => ({
        ...matchday,
        fixtures: matchday.fixtures.map((fixture) =>
          matchday.phaseName?.endsWith("Semifinales · Ida")
            ? { ...fixture, result: { homeGoals: 1, awayGoals: 0 } }
            : matchday.phaseName?.endsWith("Semifinales · Vuelta")
              ? { ...fixture, result: { homeGoals: 0, awayGoals: 0 } }
              : fixture,
        ),
      })),
    });
    const withCompletedFinal = {
      ...withCompletedSemifinals,
      matchdays: withCompletedSemifinals.matchdays.map((matchday) =>
        matchday.phaseName === "Copa Chile · Final"
          ? {
            ...matchday,
            fixtures: matchday.fixtures.map((fixture) => ({
              ...fixture,
              result: { homeGoals: 2, awayGoals: 0 },
            })),
          }
          : matchday,
      ),
    };

    const overwritten = simulateFixtures(
      withCompletedFinal,
      ["qf-1-vuelta"],
      "overwrite",
      {
        save: () => undefined,
        saveWithActivity: () => undefined,
        recordActivity: () => undefined,
        findAll: () => [],
      },
      (() => {
        const values = [0.1, 0.5, 0.2];
        let index = 0;
        return () => values[index++] ?? 0.5;
      })(),
    );
    const rebuilt = advanceOfficialCupProgression(overwritten.tournament);
    const semifinals = rebuilt.matchdays.filter(({ phaseName }) =>
      phaseName?.startsWith("Copa Chile · Semifinales"),
    );
    const final = rebuilt.matchdays.find(
      ({ phaseName }) => phaseName === "Copa Chile · Final",
    );

    expect(semifinals[0].fixtures[0]).toMatchObject({
      homeTeamId: "a",
      awayTeamId: "d",
    });
    expect(semifinals[0].fixtures[0].result).toBeUndefined();
    expect(semifinals[0].fixtures[1].result).toEqual({ homeGoals: 1, awayGoals: 0 });
    expect(semifinals[1].fixtures[0].result).toBeUndefined();
    expect(semifinals[1].fixtures[1].result).toEqual({ homeGoals: 0, awayGoals: 0 });
    expect(final?.fixtures).toEqual([]);
    expect(rebuilt.matchdays.flatMap(({ fixtures }) => fixtures)
      .every((fixture) => fixture.homeTeamId !== fixture.awayTeamId)).toBe(true);
  });

  it("removes an obsolete return-leg penalty result when the edited first leg breaks the aggregate tie", () => {
    const tournament = createTournament([
      {
        number: 1,
        leg: 1,
        phaseName: "Copa Chile · Cuartos de final · Ida",
        fixtures: [{
          id: "first-leg",
          homeTeamId: "team-a",
          awayTeamId: "team-b",
          result: { homeGoals: 1, awayGoals: 0 },
        }],
      },
      {
        number: 1,
        leg: 2,
        phaseName: "Copa Chile · Cuartos de final · Vuelta",
        fixtures: [{
          id: "return-leg",
          homeTeamId: "team-b",
          awayTeamId: "team-a",
          knockoutResolution: "aggregate-then-penalties",
          result: {
            homeGoals: 1,
            awayGoals: 0,
            penalties: { homeGoals: 4, awayGoals: 3 },
          },
        }],
      },
    ]);
    const edited = {
      ...tournament,
      matchdays: tournament.matchdays.map((matchday) =>
        matchday.phaseName?.endsWith(" · Ida")
          ? {
            ...matchday,
            fixtures: matchday.fixtures.map((fixture) => ({
              ...fixture,
              result: { homeGoals: 2, awayGoals: 0 },
            })),
          }
          : matchday,
      ),
    };

    const advanced = advanceOfficialCupProgression(edited);
    const returnFixture = advanced.matchdays.find(({ phaseName }) =>
      phaseName?.endsWith(" · Vuelta"),
    )?.fixtures[0];

    expect(returnFixture?.result).toEqual({ homeGoals: 1, awayGoals: 0 });
    expect(advanced.matchdays.find(({ phaseName }) =>
      phaseName === "Copa Chile · Semifinales · Ida",
    )?.fixtures).toHaveLength(0);
  });
});

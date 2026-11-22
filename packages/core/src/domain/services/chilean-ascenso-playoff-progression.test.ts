import { describe, expect, it } from "vitest";
import type { Fixture, Matchday, Tournament } from "../entities/tournament";
import { generateRoundRobinSchedule } from "./round-robin-scheduler";
import {
  advanceChileanAscensoPlayoff,
  chileanAscensoRegularMatchdays,
} from "./chilean-ascenso-playoff-progression";

function createFinishedAscenso(): Tournament {
  const teams = Array.from({ length: 16 }, (_, index) => ({
    id: `team-${String(index + 1).padStart(2, "0")}`,
    name: `Equipo ${String(index + 1).padStart(2, "0")}`,
  }));
  return {
    id: "anfp-liga-de-ascenso-2026",
    name: "Liga de Ascenso 2026",
    teams,
    legs: 2,
    tieBreakers: [],
    matchdays: generateRoundRobinSchedule(teams, 2).map((day) => ({
      ...day,
      fixtures: day.fixtures.map((fixture) => ({
        ...fixture,
        result: { homeGoals: 0, awayGoals: 0 },
      })),
    })),
    createdAt: "2026-01-01T00:00:00.000Z",
    format: "round-robin",
    placementRules: { championPlaces: 1, playoffPlaces: { from: 2, to: 8 } },
  };
}

function updateFixture(
  matchdays: readonly Matchday[],
  fixtureId: string,
  result: Fixture["result"],
): Matchday[] {
  return matchdays.map((day) => ({
    ...day,
    fixtures: day.fixtures.map((fixture) =>
      fixture.id === fixtureId ? { ...fixture, result } : fixture,
    ),
  }));
}

function setStageResults(matchdays: readonly Matchday[], stage: string): Matchday[] {
  const first = matchdays.find(({ phaseName }) =>
    phaseName === `Liguilla de Ascenso · ${stage} · Ida`,
  );
  const second = matchdays.find(({ phaseName }) =>
    phaseName === `Liguilla de Ascenso · ${stage} · Vuelta`,
  );
  if (!first || !second) throw new Error(`Falta la etapa ${stage}.`);

  let updated = [...matchdays];
  for (const fixture of first.fixtures) {
    updated = updateFixture(updated, fixture.id, { homeGoals: 1, awayGoals: 0 });
  }
  for (const fixture of second.fixtures) {
    updated = updateFixture(
      updated,
      fixture.id,
      stage === "Cuartos de final" && fixture.id.endsWith("-1-vuelta")
        ? { homeGoals: 1, awayGoals: 0, penalties: { homeGoals: 4, awayGoals: 3 } }
        : { homeGoals: 0, awayGoals: 1 },
    );
  }
  return updated;
}

describe("advanceChileanAscensoPlayoff", () => {
  it("waits for the full league and builds the documented seven-team bracket", () => {
    const complete = createFinishedAscenso();
    const pending = {
      ...complete,
      matchdays: updateFixture(
        complete.matchdays,
        complete.matchdays[0].fixtures[0].id,
        undefined,
      ),
    };
    expect(advanceChileanAscensoPlayoff(pending)).toBe(pending);

    const advanced = advanceChileanAscensoPlayoff(complete);
    const stages = advanced.matchdays.filter(({ phaseName }) =>
      phaseName?.startsWith("Liguilla de Ascenso"),
    );
    expect(advanced.format).toBe("staged");
    expect(stages.map(({ phaseName, fixtures }) => [phaseName, fixtures.length])).toEqual([
      ["Liguilla de Ascenso · Cuartos de final · Ida", 3],
      ["Liguilla de Ascenso · Cuartos de final · Vuelta", 3],
      ["Liguilla de Ascenso · Semifinal · Ida", 0],
      ["Liguilla de Ascenso · Semifinal · Vuelta", 0],
      ["Liguilla de Ascenso · Final · Ida", 0],
      ["Liguilla de Ascenso · Final · Vuelta", 0],
    ]);
    expect(stages[0].fixtures.map(({ homeTeamId, awayTeamId }) =>
      [homeTeamId, awayTeamId],
    )).toEqual([
      ["team-03", "team-08"],
      ["team-04", "team-07"],
      ["team-05", "team-06"],
    ]);
    expect(stages[1].fixtures.every((fixture) =>
      fixture.knockoutResolution === "aggregate-then-penalties",
    )).toBe(true);
    expect(advanced.matchdays.filter(({ phaseName }) => phaseName === "Fase regular"))
      .toHaveLength(30);
  });

  it("preserves ANFP's published Liguilla and excludes it from the regular standings", () => {
    const base = createFinishedAscenso();
    const official: Tournament = {
      ...base,
      knockoutStages: [{ name: "Liguilla Ascenso", legs: 2, advanceWinners: false }],
      matchdays: [
        ...base.matchdays,
        {
          number: 1,
          leg: 1,
          phaseName: "Liguilla Ascenso · Ida",
          fixtures: [{ id: "official-2026-63078", homeTeamId: "team-03", awayTeamId: "team-08" }],
        },
        {
          number: 1,
          leg: 2,
          phaseName: "Liguilla Ascenso · Vuelta",
          fixtures: [{ id: "official-2026-63083", homeTeamId: "team-08", awayTeamId: "team-03" }],
        },
      ],
    };

    expect(chileanAscensoRegularMatchdays(official)).toHaveLength(30);
    expect(advanceChileanAscensoPlayoff(official)).toBe(official);
    expect(official.matchdays.flatMap(({ fixtures }) => fixtures).map(({ id }) => id))
      .toContain("official-2026-63078");
  });

  it("does not complete the league from a preserved postponed score", () => {
    const complete = createFinishedAscenso();
    const fixtureId = complete.matchdays[0].fixtures[0].id;
    const postponed: Tournament = {
      ...complete,
      matchdays: complete.matchdays.map((matchday, matchdayIndex) =>
        matchdayIndex !== 0 ? matchday : {
          ...matchday,
          fixtures: matchday.fixtures.map((fixture, fixtureIndex) => fixtureIndex !== 0
            ? fixture
            : {
              ...fixture,
              operationalState: { status: "postponed", updatedAt: "2026-06-01T00:00:00.000Z" },
            }),
        }),
    };

    expect(postponed.matchdays[0].fixtures[0].id).toBe(fixtureId);
    expect(advanceChileanAscensoPlayoff(postponed)).toBe(postponed);
  });

  it("advances on aggregate and penalties, clearing only results invalidated by a changed winner", () => {
    let tournament = advanceChileanAscensoPlayoff(createFinishedAscenso());
    tournament = advanceChileanAscensoPlayoff({
      ...tournament,
      matchdays: setStageResults(tournament.matchdays, "Cuartos de final"),
    });
    expect(tournament.matchdays.find(({ phaseName }) =>
      phaseName === "Liguilla de Ascenso · Semifinal · Ida",
    )?.fixtures).toHaveLength(2);

    tournament = advanceChileanAscensoPlayoff({
      ...tournament,
      matchdays: setStageResults(tournament.matchdays, "Semifinal"),
    });
    expect(tournament.matchdays.find(({ phaseName }) =>
      phaseName === "Liguilla de Ascenso · Final · Ida",
    )?.fixtures).toHaveLength(1);

    const changedReturn = tournament.matchdays
      .find(({ phaseName }) => phaseName === "Liguilla de Ascenso · Cuartos de final · Vuelta")
      ?.fixtures.find(({ id }) => id.endsWith("-1-vuelta"));
    if (!changedReturn?.result) throw new Error("Falta el resultado de la llave.");
    tournament = advanceChileanAscensoPlayoff({
      ...tournament,
      matchdays: updateFixture(tournament.matchdays, changedReturn.id, {
        ...changedReturn.result,
        penalties: { homeGoals: 3, awayGoals: 4 },
      }),
    });

    const semifinalLegs = tournament.matchdays.filter(({ phaseName }) =>
      phaseName === "Liguilla de Ascenso · Semifinal · Ida"
      || phaseName === "Liguilla de Ascenso · Semifinal · Vuelta",
    );
    expect(semifinalLegs[0].fixtures[0].awayTeamId).toBe("team-03");
    expect(semifinalLegs[0].fixtures[0].result).toBeUndefined();
    expect(semifinalLegs[1].fixtures[0].result).toBeUndefined();
    expect(semifinalLegs[0].fixtures[1].result).toMatchObject({
      homeGoals: 1,
      awayGoals: 0,
    });
    expect(tournament.matchdays.find(({ phaseName }) =>
      phaseName === "Liguilla de Ascenso · Final · Ida",
    )?.fixtures).toHaveLength(0);
    expect(tournament.matchdays.find(({ phaseName }) =>
      phaseName === "Liguilla de Ascenso · Cuartos de final · Ida",
    )?.fixtures[1].result).toMatchObject({ homeGoals: 1, awayGoals: 0 });
  });

  it("does not use a suspended preserved return-leg score to advance a winner", () => {
    const seeded = advanceChileanAscensoPlayoff(createFinishedAscenso());
    const withResults = advanceChileanAscensoPlayoff({
      ...seeded,
      matchdays: setStageResults(seeded.matchdays, "Cuartos de final"),
    });
    const suspended = {
      ...withResults,
      matchdays: withResults.matchdays.map((matchday) =>
        matchday.phaseName?.includes("Cuartos de final")
        && matchday.phaseName.includes("Vuelta")
          ? {
          ...matchday,
          fixtures: matchday.fixtures.map((fixture, index) => index !== 0
            ? fixture
            : {
              ...fixture,
              operationalState: { status: "suspended" as const, updatedAt: "2026-06-01T00:00:00.000Z" },
            }),
          }
          : matchday),
    };
    const suspendedReturn = suspended.matchdays.flatMap(({ fixtures }) => fixtures)
      .find(({ id }) => id.endsWith("-Cuartos de final-1-vuelta"));
    expect(suspendedReturn?.operationalState?.status).toBe("suspended");
    const preservedResult = suspendedReturn?.result;

    const advanced = advanceChileanAscensoPlayoff(suspended);
    const semifinalFixtures = advanced.matchdays
      .filter(({ phaseName }) => phaseName?.includes("Semifinal"))
      .flatMap(({ fixtures }) => fixtures);
    expect(semifinalFixtures).toHaveLength(2);
    expect(advanced.matchdays.flatMap(({ fixtures }) => fixtures)
      .find(({ id }) => id.endsWith("-Cuartos de final-1-vuelta"))?.result)
      .toEqual(preservedResult);
  });
});

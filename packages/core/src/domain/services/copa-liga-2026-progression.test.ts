import { describe, expect, it } from "vitest";
import type { Fixture, Matchday, Tournament } from "../entities/tournament";
import { getCompletedStageWinners, advanceOfficialCupProgression } from "./official-cup-progression";

function createCopaLiga(): Tournament {
  const groups = ["A", "B", "C", "D"];
  const leaders = ["A1", "B1", "C1", "D1"];
  const leaderNumbers = [4, 1, 10, 16];
  const availableNumbers = Array.from({ length: 16 }, (_, index) => index + 1)
    .filter((number) => !leaderNumbers.includes(number));
  let nextNumber = 0;
  const teams = groups.flatMap((group, groupIndex) => [0, 1, 2, 3].map((index) => {
    const id = `${group}${index + 1}`;
    const competitionNumber = index === 0 ? leaderNumbers[groupIndex] : availableNumbers[nextNumber++];
    return { id, name: id, groupName: `Grupo ${group}`, competitionNumber };
  }));
  const matchdays: Matchday[] = groups.map((group) => {
    const ids = [1, 2, 3, 4].map((index) => `${group}${index}`);
    const fixtures: Fixture[] = [];
    for (let first = 0; first < ids.length; first += 1) {
      for (let second = first + 1; second < ids.length; second += 1) {
        const winner = leaders.includes(ids[first]) ? ids[first]
          : leaders.includes(ids[second]) ? ids[second] : undefined;
        fixtures.push({
          id: `${ids[first]}-${ids[second]}-ida`,
          homeTeamId: ids[first],
          awayTeamId: ids[second],
          result: winner
            ? { homeGoals: winner === ids[first] ? 1 : 0, awayGoals: winner === ids[second] ? 1 : 0 }
            : { homeGoals: 0, awayGoals: 0 },
          events: [],
          eventsCoverage: "complete",
        }, {
          id: `${ids[first]}-${ids[second]}-vuelta`,
          homeTeamId: ids[second],
          awayTeamId: ids[first],
          result: winner
            ? { homeGoals: winner === ids[second] ? 1 : 0, awayGoals: winner === ids[first] ? 1 : 0 }
            : { homeGoals: 0, awayGoals: 0 },
          events: [],
          eventsCoverage: "complete",
        });
      }
    }
    return { number: 1, leg: 1, phaseName: `Copa de la Liga · Grupo ${group}`, fixtures };
  });
  matchdays.push(
    { number: 1, leg: 2, phaseName: "Copa de la Liga · Semifinales · Ida", fixtures: [] },
    { number: 1, leg: 3, phaseName: "Copa de la Liga · Semifinales · Vuelta", fixtures: [] },
    { number: 1, leg: 4, phaseName: "Copa de la Liga · Final", fixtures: [] },
  );
  return {
    id: "anfp-copa-de-la-liga-2026",
    name: "Copa de la Liga 2026",
    season: 2026,
    teams,
    legs: 4,
    tieBreakers: ["goalDifference", "wins", "goalsFor", "awayGoals", "redCards", "yellowCards", "competitionNumber"],
    createdAt: "2026-01-01T00:00:00.000Z",
    competitionType: "cup",
    knockoutStages: [
      { name: "Copa de la Liga · Semifinales", legs: 2 },
      { name: "Copa de la Liga · Final", legs: 1 },
    ],
    matchdays,
  };
}

function resolveSemiSeries(
  tournament: Tournament,
  firstResult: Fixture["result"],
  returnResult: Fixture["result"],
  returnStatus?: "postponed",
): Tournament {
  return {
    ...tournament,
    matchdays: tournament.matchdays.map((day) => {
      if (day.phaseName === "Copa de la Liga · Semifinales · Ida") {
        return { ...day, fixtures: day.fixtures.map((fixture) => ({
          ...fixture,
          result: fixture.homeTeamId === "D1" ? firstResult : { homeGoals: 0, awayGoals: 1 },
        })) };
      }
      if (day.phaseName === "Copa de la Liga · Semifinales · Vuelta") {
        return { ...day, fixtures: day.fixtures.map((fixture) => ({
          ...fixture,
          result: fixture.homeTeamId === "B1" ? returnResult : { homeGoals: 1, awayGoals: 0 },
          ...(returnStatus && fixture.homeTeamId === "B1"
            ? { operationalState: { status: returnStatus, updatedAt: "2026-10-01T00:00:00.000Z" } }
            : {}),
        })) };
      }
      return day;
    }),
  };
}

function copaLigaFinal(tournament: Tournament): Fixture | undefined {
  return tournament.matchdays.find((day) => day.phaseName === "Copa de la Liga · Final")?.fixtures[0];
}

describe("Copa de la Liga 2026 progression", () => {
  it("does not seed semifinals with incomplete or provisional group tables", () => {
    const initial = createCopaLiga();
    const incomplete = {
      ...initial,
      matchdays: initial.matchdays.map((day) => day.phaseName?.includes("Grupo A")
        ? { ...day, fixtures: day.fixtures.slice(1) }
        : day),
    };
    expect(advanceOfficialCupProgression(incomplete).matchdays.find((day) =>
      day.phaseName === "Copa de la Liga · Semifinales · Ida")?.fixtures).toEqual([]);

    const provisional = {
      ...initial,
      matchdays: initial.matchdays.map((day) => day.phaseName?.includes("Grupo A")
        ? { ...day, fixtures: day.fixtures.map((fixture) => ({
          ...fixture,
          result: { homeGoals: 0, awayGoals: 0 },
          ...(fixture.id.includes("ida") ? { eventsCoverage: "unverified" as const } : {}),
        })) }
        : day),
    };
    expect(advanceOfficialCupProgression(provisional).matchdays.find((day) =>
      day.phaseName === "Copa de la Liga · Semifinales · Ida")?.fixtures).toEqual([]);
  });

  it("pairs four settled group winners by official number and hosts the return leg at the better-ranked club", () => {
    const advanced = advanceOfficialCupProgression(createCopaLiga());
    expect(advanced.matchdays.find((day) => day.phaseName === "Copa de la Liga · Semifinales · Ida")?.fixtures)
      .toMatchObject([
        { homeTeamId: "D1", awayTeamId: "B1" },
        { homeTeamId: "C1", awayTeamId: "A1" },
      ]);
    expect(advanced.matchdays.find((day) => day.phaseName === "Copa de la Liga · Semifinales · Vuelta")?.fixtures)
      .toMatchObject([
        { homeTeamId: "B1", awayTeamId: "D1", knockoutResolution: "aggregate-then-penalties" },
        { homeTeamId: "A1", awayTeamId: "C1", knockoutResolution: "aggregate-then-penalties" },
      ]);
  });

  it("uses points first when each team wins one leg, then the aggregate goal difference", () => {
    const seeded = advanceOfficialCupProgression(createCopaLiga());
    const advanced = advanceOfficialCupProgression(resolveSemiSeries(
      seeded,
      { homeGoals: 0, awayGoals: 2 }, // B1 gana la ida.
      { homeGoals: 0, awayGoals: 1 }, // D1 gana la vuelta.
    ));
    expect(copaLigaFinal(advanced)).toMatchObject({ homeTeamId: "B1", awayTeamId: "A1" });
  });

  it("advances a team that wins both legs on points", () => {
    const seeded = advanceOfficialCupProgression(createCopaLiga());
    const advanced = advanceOfficialCupProgression(resolveSemiSeries(
      seeded,
      { homeGoals: 0, awayGoals: 1 },
      { homeGoals: 2, awayGoals: 0 },
    ));
    expect(copaLigaFinal(advanced)?.homeTeamId).toBe("B1");
  });

  it("uses penalties only when points and aggregate goal difference are level", () => {
    const seeded = advanceOfficialCupProgression(createCopaLiga());
    const noPenaltyResult = advanceOfficialCupProgression(resolveSemiSeries(
      seeded,
      { homeGoals: 0, awayGoals: 1 },
      { homeGoals: 0, awayGoals: 1 },
    ));
    expect(copaLigaFinal(noPenaltyResult)).toBeUndefined();

    const withPenalties = advanceOfficialCupProgression(resolveSemiSeries(
      seeded,
      { homeGoals: 0, awayGoals: 1 },
      { homeGoals: 0, awayGoals: 1, penalties: { homeGoals: 4, awayGoals: 3 } },
    ));
    expect(copaLigaFinal(withPenalties)).toMatchObject({ homeTeamId: "B1", awayTeamId: "A1" });
  });

  it("does not determine a winner when a leg has no valid result or is postponed", () => {
    const seeded = advanceOfficialCupProgression(createCopaLiga());
    const missingResult = advanceOfficialCupProgression(resolveSemiSeries(
      seeded,
      { homeGoals: 0, awayGoals: 2 },
      undefined,
    ));
    expect(copaLigaFinal(missingResult)).toBeUndefined();
    const postponed = advanceOfficialCupProgression(resolveSemiSeries(
      seeded,
      { homeGoals: 0, awayGoals: 2 },
      { homeGoals: 0, awayGoals: 1 },
      "postponed",
    ));
    expect(copaLigaFinal(postponed)).toBeUndefined();
  });

  it("preserves a postponed pending final and recalculates idempotently without replacing valid fixture data", () => {
    const seeded = advanceOfficialCupProgression(createCopaLiga());
    const withPostponedFinal = {
      ...seeded,
      matchdays: seeded.matchdays.map((day) => day.phaseName === "Copa de la Liga · Final"
        ? { ...day, fixtures: [{
          id: "official-final",
          homeTeamId: "B1",
          awayTeamId: "A1",
          operationalState: { status: "postponed" as const, updatedAt: "2026-10-01T00:00:00.000Z" },
        }] }
        : day),
    };
    const advanced = advanceOfficialCupProgression(withPostponedFinal);
    const final = advanced.matchdays.find((day) => day.phaseName === "Copa de la Liga · Final")?.fixtures[0];
    expect(final).toMatchObject({ id: "official-final", operationalState: { status: "postponed" } });
    expect(getCompletedStageWinners(advanced.matchdays, { name: "Copa de la Liga · Final", legs: 1 })).toBeUndefined();
    expect(advanceOfficialCupProgression(advanced)).toEqual(advanced);
  });

  it("does not replace recorded semi-final scores when the published participants conflict with seeding", () => {
    const seeded = advanceOfficialCupProgression(createCopaLiga());
    const conflicted = {
      ...seeded,
      matchdays: seeded.matchdays.map((day) => day.phaseName?.endsWith("Semifinales · Ida")
        ? {
          ...day,
          fixtures: day.fixtures.map((fixture, index) => index === 0
            ? { ...fixture, homeTeamId: "A1", awayTeamId: "B1", result: { homeGoals: 3, awayGoals: 1 } }
            : fixture),
        }
        : day),
    };
    expect(advanceOfficialCupProgression(conflicted).matchdays.find((day) =>
      day.phaseName?.endsWith("Semifinales · Ida"))?.fixtures[0])
      .toEqual(conflicted.matchdays.find((day) => day.phaseName?.endsWith("Semifinales · Ida"))?.fixtures[0]);
  });

  it("does not change progression for other official cups", () => {
    const copaChile = { ...createCopaLiga(), id: "anfp-copa-chile-2026" };
    const advanced = advanceOfficialCupProgression(copaChile);
    expect(advanced.matchdays.find((day) => day.phaseName === "Copa de la Liga · Semifinales · Ida")?.fixtures)
      .toEqual([]);
  });
});

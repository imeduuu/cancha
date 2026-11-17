import { describe, expect, it } from "vitest";
import type { Matchday, Tournament } from "../../domain/entities/tournament";
import { calculateStandings } from "../../domain/services/standings";
import { advanceArgentinaClausuraPlayoffs, advanceArgentinaPlayoffs } from "../../domain/services/argentina-clausura-playoffs";
import { simulateArgentinaHalf } from "../use-cases/simulate-argentina-half";
import { simulateChampionship } from "../use-cases/simulate-championship";
import { updateMatchResult } from "../use-cases/update-match-result";
import type { TournamentRepository } from "../ports/tournament-repository";

function createCompletedClausura(): Tournament {
  const teams = Array.from({ length: 30 }, (_, index) => ({
    id: `team-${index + 1}`,
    name: `Equipo ${index + 1}`,
    groupName: index < 15 ? "Zona A" : "Zona B",
  }));
  const fixtures: Matchday["fixtures"][number][] = [];
  const zoneA = teams.slice(0, 15);
  const zoneB = teams.slice(15);
  for (const group of [zoneA, zoneB]) {
    for (let first = 0; first < group.length; first += 1) {
      for (let second = first + 1; second < group.length; second += 1) {
        fixtures.push({
          id: `intra-${group[first].id}-${group[second].id}`,
          homeTeamId: group[first].id,
          awayTeamId: group[second].id,
          result: { homeGoals: 1, awayGoals: 0 },
        });
      }
    }
  }
  for (const [index, team] of zoneA.entries()) {
    for (const offset of [0, 1]) {
      fixtures.push({
        id: `inter-${index}-${offset}`,
        homeTeamId: team.id,
        awayTeamId: zoneB[(index + offset) % zoneB.length].id,
        result: { homeGoals: 1, awayGoals: 0 },
      });
    }
  }

  const fixturesByDate = Array.from({ length: 16 }, () => [] as typeof fixtures);
  fixtures.forEach((fixture, index) => fixturesByDate[index % 16].push(fixture));
  const matchdays = fixturesByDate.map((dateFixtures, index) => ({
    number: index + 1,
    leg: 1,
    phaseName: "Torneo Clausura · Fase regular",
    fixtures: dateFixtures,
  }));
  return {
    id: "arg-liga-profesional-2026",
    name: "Liga Profesional Argentina 2026",
    teams,
    legs: 1,
    tieBreakers: ["goalDifference"],
    createdAt: "2026-01-01T00:00:00.000Z",
    format: "staged",
    matchdays,
  };
}

function createRepository(): TournamentRepository {
  const save = (_tournament: Tournament) => undefined;
  return {
    save,
    saveWithActivity: (tournament) => save(tournament),
    recordActivity: () => undefined,
    findAll: () => [],
  };
}

function createSeededRandom() {
  let seed = 123456789;
  return () => {
    seed = (1664525 * seed + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

describe("advanceArgentinaClausuraPlayoffs", () => {
  it("creates cross-zone round-of-16 matches after the regular season is complete", () => {
    const tournament = createCompletedClausura();
    const advanced = advanceArgentinaClausuraPlayoffs(tournament);
    const zoneA = calculateStandings({
      ...tournament,
      teams: tournament.teams.filter((team) => team.groupName === "Zona A"),
    }).slice(0, 8);
    const zoneB = calculateStandings({
      ...tournament,
      teams: tournament.teams.filter((team) => team.groupName === "Zona B"),
    }).slice(0, 8);
    const roundOf16 = advanced.matchdays[advanced.matchdays.length - 1];

    expect(roundOf16).toMatchObject({
      phaseName: "Torneo Clausura · Octavos de final",
      leg: 2,
      fixtures: expect.arrayContaining([
        expect.objectContaining({
          homeTeamId: zoneA[0].teamId,
          awayTeamId: zoneB[7].teamId,
          knockoutResolution: "extra-time-then-penalties",
        }),
        expect.objectContaining({
          homeTeamId: zoneA[1].teamId,
          awayTeamId: zoneB[6].teamId,
        }),
      ]),
    });
    expect(roundOf16?.fixtures).toHaveLength(8);
    expect(advanced.legs).toBe(2);
  });

  it("does not create playoffs while any regular-season match is pending", () => {
    const tournament = createCompletedClausura();
    const matchdays = tournament.matchdays.map((matchday, index) =>
      index === 0
        ? {
          ...matchday,
          fixtures: matchday.fixtures.map((fixture, fixtureIndex) =>
            fixtureIndex === 0 ? { ...fixture, result: undefined } : fixture,
          ),
        }
        : matchday,
    );

    const incompleteTournament = { ...tournament, matchdays };
    expect(advanceArgentinaClausuraPlayoffs(incompleteTournament)).toBe(incompleteTournament);
  });

  it("does not create playoffs when a regular-season pairing is repeated", () => {
    const tournament = createCompletedClausura();
    const firstFixture = tournament.matchdays[0].fixtures[0];
    const matchdays = tournament.matchdays.map((matchday, index) => index === 1
      ? {
        ...matchday,
        fixtures: matchday.fixtures.map((fixture, fixtureIndex) => fixtureIndex === 0
          ? {
            ...fixture,
            homeTeamId: firstFixture.homeTeamId,
            awayTeamId: firstFixture.awayTeamId,
          }
          : fixture),
      }
      : matchday);

    const invalid = { ...tournament, matchdays };
    const advanced = advanceArgentinaClausuraPlayoffs(invalid);
    expect(advanced.matchdays.some(({ phaseName }) =>
      phaseName === "Torneo Clausura · Octavos de final",
    )).toBe(false);
  });

  it("does not seed playoffs from a preserved score whose match is suspended", () => {
    const tournament = createCompletedClausura();
    const original = tournament.matchdays[0].fixtures[0];
    const incompleteTournament: Tournament = {
      ...tournament,
      matchdays: tournament.matchdays.map((matchday, matchdayIndex) =>
        matchdayIndex !== 0 ? matchday : {
          ...matchday,
          fixtures: matchday.fixtures.map((fixture, fixtureIndex) => fixtureIndex === 0
            ? { ...fixture, operationalState: { status: "postponed", updatedAt: "2026-06-01T00:00:00.000Z" } }
            : fixture),
        }),
    };

    expect(advanceArgentinaClausuraPlayoffs(incompleteTournament)).toBe(incompleteTournament);
    expect(incompleteTournament.matchdays[0].fixtures[0].result).toEqual(original.result);
    expect(incompleteTournament.matchdays.some(({ phaseName }) =>
      phaseName === "Torneo Clausura Â· Octavos de final",
    )).toBe(false);
  });

  it("clears seeded rounds when a regular-season result becomes postponed", () => {
    const tournament = advanceArgentinaClausuraPlayoffs(createCompletedClausura());
    const regular = tournament.matchdays[0];
    const knockout = tournament.matchdays.find(({ phaseName }) =>
      phaseName?.includes("Octavos de final"),
    );
    if (!knockout?.fixtures.length) throw new Error("Faltó el cuadro generado para la regresión.");
    const withKnockoutResults: Tournament = {
      ...tournament,
      matchdays: tournament.matchdays.map((matchday) => matchday !== knockout
        ? matchday
        : {
          ...matchday,
          fixtures: matchday.fixtures.map((fixture) => ({
            ...fixture,
            result: { homeGoals: 1, awayGoals: 0 },
            events: [{ id: `goal-${fixture.id}`, type: "goal", teamId: fixture.homeTeamId, playerName: "Jugador" }],
          })),
        }),
    };
    const postponed: Tournament = {
      ...withKnockoutResults,
      matchdays: withKnockoutResults.matchdays.map((matchday) => matchday !== regular
        ? matchday
        : {
          ...matchday,
          fixtures: matchday.fixtures.map((fixture, index) => index !== 0
            ? fixture
            : {
              ...fixture,
              operationalState: { status: "postponed", updatedAt: "2026-06-01T00:00:00.000Z" },
            }),
        }),
    };

    const reconciled = advanceArgentinaClausuraPlayoffs(postponed);
    expect(reconciled.matchdays[0].fixtures[0].result).toEqual(regular.fixtures[0].result);
    expect(reconciled.matchdays[0].fixtures[0].operationalState?.status).toBe("postponed");
    expect(reconciled.matchdays.find(({ phaseName }) => phaseName?.includes("Octavos de final"))
      ?.fixtures).toEqual([]);
  });

  it("does not advance a preserved suspended knockout result as a winner", () => {
    const seeded = advanceArgentinaClausuraPlayoffs(createCompletedClausura());
    const octavos = seeded.matchdays[seeded.matchdays.length - 1];
    if (!octavos) throw new Error("Faltó la ronda de octavos para la regresión.");
    const withRoundResults: Tournament = {
      ...seeded,
      matchdays: seeded.matchdays.map((matchday) => matchday !== octavos
        ? matchday
        : {
          ...matchday,
          fixtures: matchday.fixtures.map((fixture) => ({
            ...fixture,
            result: { homeGoals: 1, awayGoals: 0 },
          })),
        }),
    };
    const withQuarterfinals = advanceArgentinaClausuraPlayoffs(withRoundResults);
    const invalidated = {
      ...withQuarterfinals,
      matchdays: withQuarterfinals.matchdays.map((matchday) => matchday !== octavos
        ? matchday
        : {
          ...matchday,
          fixtures: matchday.fixtures.map((fixture, index) => index === 0
            ? { ...fixture, operationalState: { status: "suspended" as const, updatedAt: "2026-06-01T00:00:00.000Z" } }
            : fixture),
        }),
    };

    const rebuilt = advanceArgentinaClausuraPlayoffs(invalidated);
    const quarterfinals = rebuilt.matchdays.find(({ phaseName }) =>
      phaseName?.includes("Cuartos de final"),
    );
    expect(octavos.fixtures[0].result).toBeUndefined();
    expect(invalidated.matchdays.find(({ phaseName }) =>
      phaseName?.includes("Octavos de final"),
    )?.fixtures[0].result).toBeDefined();
    expect(quarterfinals?.fixtures.some(({ result }) => result !== undefined)).toBe(false);
  });

  it("simulates the full Clausura path through its single-match final", () => {
    const result = simulateChampionship(
      createCompletedClausura(),
      "pendingOnly",
      createRepository(),
      createSeededRandom(),
    );

    expect(result.simulatedCount).toBe(15);
    expect(result.tournament.matchdays.map((matchday) => matchday.phaseName)).toContain(
      "Torneo Clausura · Final",
    );
    expect(result.tournament.matchdays.slice(-4).map((matchday) => [
      matchday.phaseName,
      matchday.fixtures.length,
      matchday.fixtures.every((fixture) => fixture.result !== undefined),
    ])).toEqual([
      ["Torneo Clausura · Octavos de final", 8, true],
      ["Torneo Clausura · Cuartos de final", 4, true],
      ["Torneo Clausura · Semifinales", 2, true],
      ["Torneo Clausura · Final", 1, true],
    ]);
  });

  it("keeps the league-only choice from simulating newly created playoffs", () => {
    const result = simulateArgentinaHalf(
      createCompletedClausura(),
      "Clausura",
      false,
      "overwrite",
      createRepository(),
      () => 0,
    );
    const roundOf16 = result.tournament.matchdays.find((matchday) =>
      matchday.phaseName === "Torneo Clausura · Octavos de final",
    );

    expect(result.simulatedCount).toBe(240);
    expect(roundOf16?.fixtures.every((fixture) => fixture.result === undefined)).toBe(true);
  });

  it("can generate and simulate the full Apertura bracket", () => {
    const tournament = {
      ...createCompletedClausura(),
      matchdays: createCompletedClausura().matchdays.map((matchday) => ({
        ...matchday,
        phaseName: "Torneo Apertura · Fase regular",
      })),
    };
    const advanced = advanceArgentinaPlayoffs(tournament, "Apertura");
    const result = simulateArgentinaHalf(
      advanced,
      "Apertura",
      true,
      "pendingOnly",
      createRepository(),
      createSeededRandom(),
    );

    expect(result.simulatedCount).toBe(15);
    expect(result.tournament.matchdays.map((matchday) => matchday.phaseName)).toContain(
      "Torneo Apertura · Final",
    );
    expect(result.tournament.matchdays.slice(-4).every((matchday) =>
      matchday.fixtures.every((fixture) => fixture.result !== undefined),
    )).toBe(true);
  });

  it("reconciles Argentina playoffs after an overwritten winner and removes obsolete later results", () => {
    const repository = createRepository();
    const completed = simulateChampionship(
      createCompletedClausura(),
      "pendingOnly",
      repository,
      createSeededRandom(),
    ).tournament;
    const editedFixture = completed.matchdays.find((matchday) =>
      matchday.phaseName === "Torneo Clausura · Octavos de final",
    )?.fixtures[0];
    if (!editedFixture) throw new Error("Faltó el partido de octavos para la regresión.");
    const edited = updateMatchResult(
      completed,
      editedFixture.id,
      { homeGoals: 0, awayGoals: 1 },
      repository,
    );
    const rebuilt = advanceArgentinaClausuraPlayoffs(edited);
    const quarterfinals = rebuilt.matchdays.find((matchday) =>
      matchday.phaseName === "Torneo Clausura · Cuartos de final",
    );
    const semifinals = rebuilt.matchdays.find((matchday) =>
      matchday.phaseName === "Torneo Clausura · Semifinales",
    );
    const final = rebuilt.matchdays.find((matchday) =>
      matchday.phaseName === "Torneo Clausura · Final",
    );

    expect(() => advanceArgentinaClausuraPlayoffs(edited)).not.toThrow();
    expect(quarterfinals?.fixtures[0].result).toBeUndefined();
    expect(quarterfinals?.fixtures[1].result).toBeDefined();
    expect(semifinals?.fixtures).toHaveLength(1);
    expect(semifinals?.fixtures[0].result).toBeDefined();
    expect(final?.fixtures).toEqual([]);
    for (const matchday of [quarterfinals, semifinals]) {
      const teamIds = matchday?.fixtures.flatMap((fixture) => [
        fixture.homeTeamId,
        fixture.awayTeamId,
      ]) ?? [];
      expect(new Set(teamIds).size).toBe(teamIds.length);
    }
  });
});

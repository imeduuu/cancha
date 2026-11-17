import { describe, expect, it } from "vitest";
import type { Matchday, Tournament } from "../../domain/entities/tournament";
import type { ActivityEvent } from "../../domain/entities/activity-event";
import type { TournamentRepository } from "../ports/tournament-repository";
import { updateFixtureOperationalState } from "../use-cases/update-fixture-operational-state";
import { advanceContinentalCupProgression } from "../../domain/services/continental-cup-progression";
import { validateTournamentIntegrity } from "../../domain/services/tournament-integrity";

function createGroupPhase(cupId: string, cupName: string, prefix: string) {
  const teams = Array.from({ length: 8 }, (_, groupIndex) =>
    Array.from({ length: 4 }, (_, teamIndex) => ({
      id: `${prefix}-${groupIndex}-${teamIndex}`,
      name: `${prefix} ${groupIndex + 1}.${teamIndex + 1}`,
      groupName: `Group ${String.fromCharCode(65 + groupIndex)}`,
    })),
  ).flat();
  const fixturesByLegAndRound = Array.from({ length: 6 }, () => [] as Matchday["fixtures"][number][]);
  for (let groupIndex = 0; groupIndex < 8; groupIndex += 1) {
    const group = teams.filter((team) => team.groupName === `Group ${String.fromCharCode(65 + groupIndex)}`);
    const rounds = [
      [[0, 1], [2, 3]],
      [[0, 2], [1, 3]],
      [[0, 3], [1, 2]],
    ] as const;
    rounds.forEach((pairs, roundIndex) => pairs.forEach(([homeIndex, awayIndex]) => {
      const home = group[homeIndex];
      const away = group[awayIndex];
      fixturesByLegAndRound[roundIndex].push({
        id: `${cupId}-group-${home.id}-${away.id}-first`,
        homeTeamId: home.id,
        awayTeamId: away.id,
        result: { homeGoals: 2, awayGoals: 0 },
      });
      fixturesByLegAndRound[roundIndex + 3].push({
        id: `${cupId}-group-${away.id}-${home.id}-return`,
        homeTeamId: away.id,
        awayTeamId: home.id,
        result: { homeGoals: 2, awayGoals: 0 },
      });
    }));
  }
  const matchdays = fixturesByLegAndRound.map((fixtures, index) => ({
    number: (index % 3) + 1,
    leg: index < 3 ? 1 : 2,
    phaseName: `${cupName} · Fase de grupos`,
    fixtures,
  } satisfies Matchday));
  return {
    teams,
    matchdays,
  };
}

function createCup(id: string, name: string, prefix: string): Tournament {
  const groupPhase = createGroupPhase(id, name, prefix);
  const stageNames = id === "conmebol-libertadores-2026"
    ? ["Fase previa 1", "Fase previa 2", "Fase previa 3", "Octavos de final", "Cuartos de final", "Semifinales", "Final"]
    : ["Primera fase", "Playoff de octavos", "Octavos de final", "Cuartos de final", "Semifinales", "Final"];
  const stages = stageNames.map((stageName) => ({
    name: `${name} · ${stageName}`,
    legs: stageName === "Final" ? 1 as const : 2 as const,
    ...(stageName === "Fase previa 3" || stageName === "Primera fase" || stageName === "Playoff de octavos"
      ? { advanceWinners: false }
      : {}),
  }));
  const knockoutMatchdays = stages.flatMap((stage) =>
    stage.legs === 1
      ? [{ number: 1, leg: 1, phaseName: stage.name, fixtures: [] }]
      : [
        { number: 1, leg: 1, phaseName: `${stage.name} · Ida`, fixtures: [] },
        { number: 1, leg: 2, phaseName: `${stage.name} · Vuelta`, fixtures: [] },
      ],
  );
  return {
    id,
    name: `${name} 2026`,
    teams: groupPhase.teams,
    legs: knockoutMatchdays.length + 1,
    format: "staged",
    tieBreakers: ["goalDifference", "goalsFor", "wins", "headToHead"],
    matchdays: [...groupPhase.matchdays, ...knockoutMatchdays],
    createdAt: "2026-01-01T00:00:00.000Z",
    competitionType: "cup",
    knockoutStages: stages,
  };
}

function getTournament(tournaments: readonly Tournament[], id: string): Tournament {
  const tournament = tournaments.find((candidate) => candidate.id === id);
  if (!tournament) throw new Error(`No se encontró ${id}.`);
  return tournament;
}

describe("advanceContinentalCupProgression", () => {
  it("waits for all group results and then generates the continental qualifying ties", () => {
    const libertadores = createCup("conmebol-libertadores-2026", "Copa Libertadores", "lib");
    const sudamericana = createCup("conmebol-sudamericana-2026", "Copa Sudamericana", "suda");
    const incomplete = {
      ...libertadores,
      matchdays: libertadores.matchdays.map((matchday, index) =>
        index === 0
          ? {
            ...matchday,
            fixtures: matchday.fixtures.map((fixture, index) =>
              index === 0 ? { ...fixture, result: undefined } : fixture,
            ),
          }
          : matchday,
      ),
    };
    const waiting = advanceContinentalCupProgression([incomplete, sudamericana]);
    expect(getTournament(waiting, incomplete.id).matchdays.find(
      ({ phaseName }) => phaseName?.endsWith("Octavos de final · Ida"),
    )?.fixtures).toEqual([]);

    const advanced = advanceContinentalCupProgression([libertadores, sudamericana]);
    const libFirstLeg = getTournament(advanced, libertadores.id).matchdays.find(
      ({ phaseName }) => phaseName?.endsWith("Octavos de final · Ida"),
    )?.fixtures ?? [];
    const sudaFirstLeg = getTournament(advanced, sudamericana.id).matchdays.find(
      ({ phaseName }) => phaseName?.endsWith("Playoff de octavos · Ida"),
    )?.fixtures ?? [];

    expect(libFirstLeg).toHaveLength(8);
    expect(sudaFirstLeg).toHaveLength(8);
    expect(libFirstLeg.every((fixture) =>
      libertadores.teams.find((team) => team.id === fixture.homeTeamId)?.groupName
        !== libertadores.teams.find((team) => team.id === fixture.awayTeamId)?.groupName,
    )).toBe(true);
    expect(sudaFirstLeg.every((fixture) =>
      fixture.homeTeamId.startsWith("lib-") && fixture.awayTeamId.startsWith("suda-"),
    )).toBe(true);
    expect(getTournament(advanced, sudamericana.id).matchdays.find(
      ({ phaseName }) => phaseName?.endsWith("Playoff de octavos · Vuelta"),
    )?.fixtures.every((fixture) => fixture.knockoutResolution === "aggregate-then-penalties"))
      .toBe(true);
    expect(JSON.stringify(advanceContinentalCupProgression(advanced))).toBe(JSON.stringify(advanced));
  });

  it("does not complete group standings from a preserved non-final score", () => {
    const libertadores = createCup("conmebol-libertadores-2026", "Copa Libertadores", "lib");
    const firstFixture = libertadores.matchdays[0].fixtures[0];
    const incomplete: Tournament = {
      ...libertadores,
      matchdays: libertadores.matchdays.map((matchday, matchdayIndex) =>
        matchdayIndex !== 0 ? matchday : {
          ...matchday,
          fixtures: matchday.fixtures.map((fixture, fixtureIndex) => fixtureIndex === 0
            ? { ...fixture, operationalState: { status: "suspended", updatedAt: "2026-06-01T00:00:00.000Z" } }
            : fixture),
        }),
    };

    const advanced = advanceContinentalCupProgression([incomplete]);
    const current = getTournament(advanced, libertadores.id);
    expect(current.matchdays[0].fixtures[0].result).toEqual(firstFixture.result);
    expect(current).toEqual(incomplete);
  });

  it("removes previously generated continental ties when a group result becomes non-final", () => {
    const libertadores = createCup("conmebol-libertadores-2026", "Copa Libertadores", "lib");
    const sudamericana = createCup("conmebol-sudamericana-2026", "Copa Sudamericana", "suda");
    const generated = advanceContinentalCupProgression([libertadores, sudamericana]);
    const lib = getTournament(generated, libertadores.id);
    const suda = getTournament(generated, sudamericana.id);
    const invalidatedLib: Tournament = {
      ...lib,
      matchdays: lib.matchdays.map((matchday, dayIndex) => dayIndex !== 0
        ? matchday
        : {
          ...matchday,
          fixtures: matchday.fixtures.map((fixture, fixtureIndex) => fixtureIndex !== 0
            ? fixture
            : {
              ...fixture,
              operationalState: { status: "postponed", updatedAt: "2026-06-01T00:00:00.000Z" },
            }),
        }),
    };

    const reconciled = advanceContinentalCupProgression([invalidatedLib, suda]);
    const currentLib = getTournament(reconciled, libertadores.id);
    const currentSuda = getTournament(reconciled, sudamericana.id);
    expect(currentLib.matchdays[0].fixtures[0].result).toEqual(lib.matchdays[0].fixtures[0].result);
    expect(currentLib.matchdays.find(({ phaseName }) => phaseName?.includes("Octavos de final")
      && phaseName.includes("Ida"))?.fixtures).toEqual([]);
    expect(currentSuda.matchdays.find(({ phaseName }) => phaseName?.includes("Playoff de octavos")
      && phaseName.includes("Ida"))?.fixtures).toEqual([]);
  });

  it("saves related continental cup reconciliation together with the operational update", () => {
    const libertadores = createCup("conmebol-libertadores-2026", "Copa Libertadores", "lib");
    const sudamericana = createCup("conmebol-sudamericana-2026", "Copa Sudamericana", "suda");
    let stored = advanceContinentalCupProgression([libertadores, sudamericana]);
    let savedBatch: readonly Tournament[] = [];
    let activity: ActivityEvent | undefined;
    const repository: TournamentRepository = {
      save: (tournament) => {
        stored = stored.map((candidate) => candidate.id === tournament.id ? tournament : candidate);
      },
      saveWithActivity: (tournament) => {
        stored = stored.map((candidate) => candidate.id === tournament.id ? tournament : candidate);
      },
      saveManyWithActivity: (tournaments, event) => {
        savedBatch = tournaments;
        activity = event;
        stored = stored.map((candidate) =>
          tournaments.find(({ id }) => id === candidate.id) ?? candidate,
        );
      },
      findAll: () => stored,
    };
    const lib = getTournament(stored, libertadores.id);
    const sourceFixture = lib.matchdays[0].fixtures[0];
    const updated = updateFixtureOperationalState(
      lib,
      sourceFixture.id,
      "suspended",
      "Encuentro interrumpido",
      repository,
      () => new Date("2026-06-01T12:00:00.000Z"),
      true,
    );

    const savedLib = getTournament(stored, libertadores.id);
    const savedSuda = getTournament(stored, sudamericana.id);
    expect(savedLib.matchdays[0].fixtures[0].result).toEqual(sourceFixture.result);
    expect(savedLib.matchdays.find(({ phaseName }) => phaseName?.includes("Octavos de final")
      && phaseName.includes("Ida"))?.fixtures).toEqual([]);
    expect(savedSuda.matchdays.find(({ phaseName }) => phaseName?.includes("Playoff de octavos")
      && phaseName.includes("Ida"))?.fixtures).toEqual([]);
    expect(savedBatch.map(({ id }) => id)).toContain(sudamericana.id);
    expect(activity?.action).toBe("match-operational-state-updated");
    expect(updated.id).toBe(libertadores.id);
  });

  it("sends playoff winners to Sudamericana octavos and keeps group winners home in the return leg", () => {
    const libertadores = createCup("conmebol-libertadores-2026", "Copa Libertadores", "lib");
    const sudamericana = createCup("conmebol-sudamericana-2026", "Copa Sudamericana", "suda");
    const initiallyAdvanced = advanceContinentalCupProgression([libertadores, sudamericana]);
    const sudaAfterPlayoffs = getTournament(initiallyAdvanced, sudamericana.id);
    const matchdays = sudaAfterPlayoffs.matchdays.map((matchday) => {
      if (matchday.phaseName?.endsWith("Playoff de octavos · Ida")) {
        return {
          ...matchday,
          fixtures: matchday.fixtures.map((fixture) => ({
            ...fixture,
            result: { homeGoals: 1, awayGoals: 0 },
          })),
        };
      }
      if (matchday.phaseName?.endsWith("Playoff de octavos · Vuelta")) {
        return {
          ...matchday,
          fixtures: matchday.fixtures.map((fixture) => ({
            ...fixture,
            result: { homeGoals: 0, awayGoals: 0 },
          })),
        };
      }
      return matchday;
    });
    const advanced = advanceContinentalCupProgression([
      getTournament(initiallyAdvanced, libertadores.id),
      { ...sudaAfterPlayoffs, matchdays },
    ]);
    const suda = getTournament(advanced, sudamericana.id);
    const firstLeg = suda.matchdays.find(
      ({ phaseName }) => phaseName?.endsWith("Octavos de final · Ida"),
    )?.fixtures ?? [];
    const returnLeg = suda.matchdays.find(
      ({ phaseName }) => phaseName?.endsWith("Octavos de final · Vuelta"),
    )?.fixtures ?? [];

    expect(firstLeg).toHaveLength(8);
    expect(returnLeg).toHaveLength(8);
    expect(returnLeg.every((fixture) =>
      suda.teams.find((team) => team.id === fixture.homeTeamId)?.groupName !== undefined,
    )).toBe(true);
    expect(returnLeg.every((fixture) =>
      fixture.knockoutResolution === "aggregate-then-penalties",
    )).toBe(true);
  });

  it("rebuilds generated ties and removes downstream results when group standings change", () => {
    const libertadores = createCup("conmebol-libertadores-2026", "Copa Libertadores", "lib");
    const sudamericana = createCup("conmebol-sudamericana-2026", "Copa Sudamericana", "suda");
    const initiallyAdvanced = advanceContinentalCupProgression([libertadores, sudamericana]);
    const advancedLibertadores = getTournament(initiallyAdvanced, libertadores.id);
    const changedGroupResults = advancedLibertadores.matchdays.map((matchday) =>
      matchday.phaseName?.endsWith("Fase de grupos")
        ? {
          ...matchday,
          fixtures: matchday.fixtures.map((fixture) => {
            if (
              fixture.homeTeamId !== "lib-0-3"
              && fixture.awayTeamId !== "lib-0-3"
            ) {
              return fixture;
            }
            return fixture.homeTeamId === "lib-0-3"
              ? { ...fixture, result: { homeGoals: 4, awayGoals: 0 } }
              : { ...fixture, result: { homeGoals: 0, awayGoals: 4 } };
          }),
        }
        : matchday,
    );
    const withStaleKnockoutResult = {
      ...advancedLibertadores,
      matchdays: changedGroupResults.map((matchday) =>
        matchday.phaseName?.endsWith("Cuartos de final · Ida")
          ? {
            ...matchday,
            fixtures: [{
              id: `${libertadores.id}-cup-stage-5-1-1`,
              homeTeamId: "lib-0-0",
              awayTeamId: "lib-1-0",
              result: { homeGoals: 1, awayGoals: 0 },
            }],
          }
          : matchday,
      ),
    };
    const advanced = advanceContinentalCupProgression([
      withStaleKnockoutResult,
      getTournament(initiallyAdvanced, sudamericana.id),
    ]);
    const currentLibertadores = getTournament(advanced, libertadores.id);
    const octavos = currentLibertadores.matchdays.find(
      ({ phaseName }) => phaseName?.endsWith("Octavos de final · Ida"),
    )?.fixtures ?? [];

    expect(octavos.some((fixture) => fixture.awayTeamId === "lib-0-3")).toBe(true);
    expect(currentLibertadores.matchdays.find(
      ({ phaseName }) => phaseName?.endsWith("Cuartos de final · Ida"),
    )?.fixtures).toEqual([]);
  });

  it("does not generate continental ties when group fixtures repeat one pairing and omit another", () => {
    const libertadores = createCup("conmebol-libertadores-2026", "Copa Libertadores", "lib");
    const group = libertadores.teams.filter((team) => team.groupName === "Group A");
    const pairings = [
      [0, 1], [2, 3], [0, 1], [2, 3], [0, 1], [2, 3],
      [0, 2], [1, 3], [0, 3], [1, 2], [0, 3], [1, 2],
    ] as const;
    let pairingIndex = 0;
    const invalid: Tournament = {
      ...libertadores,
      matchdays: libertadores.matchdays.map((matchday) => ({
        ...matchday,
        fixtures: matchday.phaseName?.includes("Fase de grupos")
          ? matchday.fixtures.map((fixture) => {
            if (!group.some((team) => team.id === fixture.homeTeamId)) return fixture;
            const [homeIndex, awayIndex] = pairings[pairingIndex++];
            return {
              ...fixture,
              homeTeamId: group[homeIndex].id,
              awayTeamId: group[awayIndex].id,
            };
          })
          : matchday.fixtures,
      })),
    };

    expect(pairingIndex).toBe(12);
    expect(validateTournamentIntegrity(invalid).join(" ")).toContain("aparece 3 veces");
    const advanced = advanceContinentalCupProgression([invalid]);
    expect(getTournament(advanced, invalid.id).matchdays.find(
      ({ phaseName }) => phaseName?.endsWith("Octavos de final · Ida"),
    )?.fixtures).toEqual([]);
  });

  it("rejects a group pairing played twice with the same home team", () => {
    const libertadores = createCup("conmebol-libertadores-2026", "Copa Libertadores", "lib");
    const matchdays = libertadores.matchdays.map((matchday) => {
      if (!matchday.phaseName?.includes("Fase de grupos")) return matchday;
      return {
        ...matchday,
        fixtures: matchday.fixtures.map((fixture) =>
          fixture.homeTeamId === "lib-0-1" && fixture.awayTeamId === "lib-0-0"
            ? { ...fixture, homeTeamId: "lib-0-0", awayTeamId: "lib-0-1" }
            : fixture,
        ),
      };
    });
    const invalid = { ...libertadores, matchdays };
    expect(validateTournamentIntegrity(invalid).join(" ")).toContain("mismo equipo como local");
    expect(getTournament(advanceContinentalCupProgression([invalid]), invalid.id)
      .matchdays.find(({ phaseName }) => phaseName?.endsWith("Octavos de final · Ida"))?.fixtures)
      .toEqual([]);
  });

  it("does not impose the continental double round-robin rule on other staged formats", () => {
    const tournament = createCup("custom-staged-cup", "Copa Personalizada", "custom");
    const oneLegGroupStage = {
      ...tournament,
      matchdays: tournament.matchdays.slice(0, 3).map((matchday) => ({
        ...matchday,
        phaseName: "Copa Personalizada · Fase de grupos",
      })),
    };
    expect(validateTournamentIntegrity(oneLegGroupStage)).toEqual([]);
  });
});


it("registers Libertadores entrants before persisting Sudamericana playoffs and keeps group membership intact", () => {
  const lib = createCup("conmebol-libertadores-2026", "Copa Libertadores", "lib");
  const suda = createCup("conmebol-sudamericana-2026", "Copa Sudamericana", "suda");
  const progressed = advanceContinentalCupProgression([lib, suda]);
  const result = getTournament(progressed, suda.id);
  expect(result.teams.filter(team => team.groupName)).toEqual(suda.teams);
  const imported = result.teams.filter(team => !team.groupName);
  expect(imported).toHaveLength(8);
  expect(imported.every(team => lib.teams.some(original => original.id === team.id && original.name === team.name))).toBe(true);
  expect(validateTournamentIntegrity(result)).toEqual([]);
  expect(suda.teams).toHaveLength(32);
  expect(advanceContinentalCupProgression(progressed)).toEqual(progressed);
});

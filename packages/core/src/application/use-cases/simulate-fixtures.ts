import { DomainError } from "../../domain/domain-error.js";
import type { Tournament } from "../../domain/entities/tournament";
import {
  simulateExtraTimeResult,
  simulateMatchResult,
} from "../../domain/services/match-simulator";
import { getAggregateScoreBeforeFixture } from "../../domain/services/aggregate-knockout-score";
import type { TournamentRepository } from "../ports/tournament-repository";
import { advanceTournamentProgress } from "./advance-tournament-progress";
import {
  getOperationalMatchStatus,
  isOperationalStateSimulationBlocked,
} from "../../domain/services/match-operational-status";
import { createActivityEvent, saveWithActivity } from "../services/activity-log";

export type SimulationMode = "pendingOnly" | "overwrite";

export interface SimulateFixturesResult {
  readonly tournament: Tournament;
  readonly simulatedCount: number;
}

export function simulateFixtures(
  tournament: Tournament,
  fixtureIds: readonly string[],
  mode: SimulationMode,
  repository: TournamentRepository,
  random: () => number = Math.random,
): SimulateFixturesResult {
  if (mode !== "pendingOnly" && mode !== "overwrite") {
    throw new DomainError("Elige si se simulan solo pendientes o se sobrescriben los resultados.");
  }

  if (new Set(fixtureIds).size !== fixtureIds.length) {
    throw new DomainError("La selección contiene partidos duplicados.");
  }

  const selectedIds = new Set(fixtureIds);
  const knownFixtures = tournament.matchdays.flatMap((matchday) => matchday.fixtures);
  const knownFixtureIds = new Set(knownFixtures.map((fixture) => fixture.id));
  if (fixtureIds.some((fixtureId) => !knownFixtureIds.has(fixtureId))) {
    throw new DomainError("La selección contiene un partido que no pertenece al campeonato.");
  }
  const blockedFixture = knownFixtures.find((fixture) =>
    selectedIds.has(fixture.id)
    && isOperationalStateSimulationBlocked(fixture));
  if (blockedFixture) {
    throw new DomainError(`No se puede simular el partido "${blockedFixture.id}" mientras está ${getOperationalMatchStatus(blockedFixture)}.`);
  }

  let simulatedCount = 0;
  const resultsByFixtureId = new Map(
    knownFixtures.map((fixture) => [fixture.id, fixture.result] as const),
  );
  const matchdays = tournament.matchdays.map((matchday) => ({
    ...matchday,
    fixtures: matchday.fixtures.map((fixture) => {
      if (!selectedIds.has(fixture.id) || (mode === "pendingOnly" && fixture.result)) {
        return fixture;
      }

      simulatedCount += 1;
      let result = simulateMatchResult(fixture, random);
      if (fixture.knockoutResolution === "aggregate-then-penalties") {
        const aggregateScore = getAggregateScoreBeforeFixture(
          tournament.matchdays,
          matchday,
          fixture,
          resultsByFixtureId,
        );
        if (
          aggregateScore
          && aggregateScore.homeGoals + result.homeGoals
            === aggregateScore.awayGoals + result.awayGoals
        ) {
          result = { ...result, penalties: simulatePenaltyShootout(random) };
        }
      } else if (fixture.knockoutResolution && result.homeGoals === result.awayGoals) {
        if (fixture.knockoutResolution === "extra-time-then-penalties") {
          const extraTime = simulateExtraTimeResult(random);
          result = { ...result, extraTime };
        }
        const homeAfterExtraTime = result.homeGoals + (result.extraTime?.homeGoals ?? 0);
        const awayAfterExtraTime = result.awayGoals + (result.extraTime?.awayGoals ?? 0);
        if (homeAfterExtraTime === awayAfterExtraTime) {
          result = { ...result, penalties: simulatePenaltyShootout(random) };
        }
      }
      resultsByFixtureId.set(fixture.id, result);
      return { ...fixture, result,
        ...(fixture.operationalState
          ? { operationalState: { ...fixture.operationalState, status: "finished" as const, updatedAt: new Date().toISOString() } }
          : {}),
      };
    }),
  }));

  if (simulatedCount === 0) {
    return { tournament, simulatedCount };
  }

  const updatedTournament = advanceTournamentProgress({ ...tournament, matchdays });
  const updatedResults = new Map(updatedTournament.matchdays
    .flatMap(({ fixtures }) => fixtures)
    .filter((fixture) => selectedIds.has(fixture.id))
    .map((fixture) => [fixture.id, fixture.result] as const));
  saveWithActivity(repository, updatedTournament, createActivityEvent(tournament, {
    action: "matches-simulated",
    entityType: "tournament",
    summary: `Se simularon ${simulatedCount} ${simulatedCount === 1 ? "partido" : "partidos"} en "${tournament.name}".`,
    before: Object.fromEntries(knownFixtures
      .filter((fixture) => selectedIds.has(fixture.id))
      .map((fixture) => [fixture.id, fixture.result ?? null])),
    after: Object.fromEntries(updatedResults),
  }));
  return { tournament: updatedTournament, simulatedCount };
}

function simulatePenaltyShootout(random: () => number) {
  let homeGoals = 0;
  let awayGoals = 0;
  for (let kick = 0; kick < 5; kick += 1) {
    if (penaltyIsScored(random)) homeGoals += 1;
    if (penaltyIsScored(random)) awayGoals += 1;
  }
  while (homeGoals === awayGoals) {
    if (penaltyIsScored(random)) homeGoals += 1;
    if (penaltyIsScored(random)) awayGoals += 1;
  }
  return { homeGoals, awayGoals };
}

function penaltyIsScored(random: () => number): boolean {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new DomainError("La fuente aleatoria debe entregar valores entre 0 y 1.");
  }
  return value < 0.75;
}

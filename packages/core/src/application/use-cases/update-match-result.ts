import { DomainError } from "../../domain/domain-error.js";
import type {
  KnockoutResolution,
  Tournament,
  MatchResult,
} from "../../domain/entities/tournament";
import { isValidKnockoutResult } from "../../domain/services/match-result-validation";
import { getAggregateScoreBeforeFixture } from "../../domain/services/aggregate-knockout-score";
import type { TournamentRepository } from "../ports/tournament-repository";
import { advanceTournamentProgress } from "./advance-tournament-progress";
import { createActivityEvent, saveWithActivity } from "../services/activity-log";

import { secondDivisionKind } from "../../domain/services/second-division-rules";

export function updateMatchResult(
  tournament: Tournament,
  fixtureId: string,
  result: MatchResult,
  repository: TournamentRepository,
  knockoutResolution?: KnockoutResolution | null,
): Tournament {
  const targetFixture = tournament.matchdays
    .flatMap((matchday) => matchday.fixtures)
    .find((fixture) => fixture.id === fixtureId);
  if (!targetFixture) {
    throw new DomainError("No se encontró el partido que quieres actualizar.");
  }
  const fixtureResolution = knockoutResolution === undefined
    ? targetFixture.knockoutResolution
    : knockoutResolution ?? undefined;
  if (secondDivisionKind(tournament) && fixtureResolution !== targetFixture.knockoutResolution)
    throw new DomainError("La regla de desempate de esta competición está fijada por su reglamento 2026.");
  const previousValue = {
    result: targetFixture.result ?? null,
    knockoutResolution: targetFixture.knockoutResolution ?? null,
  };
  const nextValue = {
    result,
    knockoutResolution: fixtureResolution ?? null,
  };
  if (JSON.stringify(previousValue) === JSON.stringify(nextValue)) return tournament;
  const targetMatchday = tournament.matchdays.find((matchday) =>
    matchday.fixtures.some((fixture) => fixture.id === fixtureId),
  );
  const aggregateScore = targetMatchday
    ? getAggregateScoreBeforeFixture(tournament.matchdays, targetMatchday, targetFixture)
    : undefined;
  if (fixtureResolution === "aggregate-then-penalties" && !aggregateScore) {
    throw new DomainError("Guarda primero el resultado de ida para validar el global de la vuelta.");
  }
  if (!isValidKnockoutResult(result, fixtureResolution, aggregateScore)) {
    throw new DomainError("Cada resultado debe ser un entero entre 0 y 99.");
  }

  let found = false;
  const matchdays = tournament.matchdays.map((matchday) => ({
    ...matchday,
    fixtures: matchday.fixtures.map((fixture) => {
      if (fixture.id !== fixtureId) {
        return fixture;
      }

      found = true;
      return {
        ...fixture,
        ...(knockoutResolution !== undefined
          ? { knockoutResolution: fixtureResolution }
          : {}),
        result,
      };
    }),
  }));

  if (!found) {
    throw new DomainError("No se encontró el partido que quieres actualizar.");
  }

  const updatedTournament = advanceTournamentProgress({ ...tournament, matchdays });
  saveWithActivity(repository, updatedTournament, createActivityEvent(tournament, {
    action: "match-result-updated",
    entityId: fixtureId,
    entityType: "match",
    summary: `Se actualizó el resultado del partido ${fixtureId}.`,
    before: previousValue,
    after: nextValue,
  }));
  return updatedTournament;
}

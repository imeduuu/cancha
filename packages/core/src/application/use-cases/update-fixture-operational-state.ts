import { DomainError } from "../../domain/domain-error.js";
import type {
  MatchOperationalState,
  OperationalMatchStatus,
  Tournament,
} from "../../domain/entities/tournament";
import {
  getOperationalMatchStatus,
  validateOperationalTransition,
} from "../../domain/services/match-operational-status";
import { advanceContinentalCupProgression } from "../../domain/services/continental-cup-progression";
import type { TournamentRepository } from "../ports/tournament-repository";
import { createActivityEvent, saveWithActivity } from "../services/activity-log";
import { advanceTournamentProgress } from "./advance-tournament-progress";

export function updateFixtureOperationalState(
  tournament: Tournament,
  fixtureId: string,
  status: OperationalMatchStatus,
  note: string,
  repository: TournamentRepository,
  now: () => Date = () => new Date(),
  confirmedAmbiguousResult = false,
): Tournament {
  const matchday = tournament.matchdays.find(({ fixtures }) =>
    fixtures.some(({ id }) => id === fixtureId));
  const fixture = matchday?.fixtures.find(({ id }) => id === fixtureId);
  if (!matchday || !fixture) throw new DomainError("No se encontró el partido que quieres actualizar.");
  if (note.trim().length > 500) {
    throw new DomainError("La observación operativa no puede superar los 500 caracteres.");
  }
  const issue = validateOperationalTransition(
    tournament,
    matchday,
    fixture,
    status,
    confirmedAmbiguousResult,
  );
  if (issue) throw new DomainError(issue);
  if (fixture.operationalState?.status === status
    && (fixture.operationalState.note ?? "") === note.trim()) return tournament;
  const updatedAt = now().toISOString();
  if (!Number.isFinite(Date.parse(updatedAt))) {
    throw new DomainError("La fecha de modificación del estado no es válida.");
  }
  const operationalState: MatchOperationalState = {
    status,
    updatedAt,
    ...(note.trim() ? { note: note.trim() } : {}),
  };
  const changedTournament: Tournament = {
    ...tournament,
    matchdays: tournament.matchdays.map((candidate) => ({
      ...candidate,
      fixtures: candidate.fixtures.map((candidateFixture) =>
        candidateFixture.id === fixtureId
          ? { ...candidateFixture, operationalState }
          : candidateFixture),
    })),
  };
  const progressedTournament = advanceTournamentProgress(changedTournament);
  const originalTournaments = tournament.id.startsWith("conmebol-")
    ? repository.findAll()
    : [tournament];
  const tournamentsForProgression = originalTournaments.some(({ id }) => id === tournament.id)
    ? originalTournaments.map((candidate) => candidate.id === tournament.id
      ? progressedTournament
      : candidate)
    : [progressedTournament, ...originalTournaments];
  const progressedTournaments = tournament.id.startsWith("conmebol-")
    ? advanceContinentalCupProgression(tournamentsForProgression)
    : tournamentsForProgression;
  const updatedTournament = progressedTournaments.find(({ id }) => id === tournament.id)
    ?? progressedTournament;
  const changedTournaments = progressedTournaments.filter((candidate) => {
    const previous = originalTournaments.find(({ id }) => id === candidate.id)
      ?? (candidate.id === tournament.id ? tournament : undefined);
    return !previous || JSON.stringify(previous) !== JSON.stringify(candidate);
  });
  const event = createActivityEvent(tournament, {
    action: "match-operational-state-updated",
    entityId: fixtureId,
    entityType: "match",
    summary: `Estado del partido ${fixtureId}: ${getOperationalMatchStatus(fixture)} → ${status}.`,
    before: getOperationalMatchStatus(fixture),
    after: status,
    note,
  }, now);
  if (changedTournaments.length > 1) {
    if (!repository.saveManyWithActivity) {
      throw new DomainError(
        "No se guardaron los cambios: el repositorio no garantiza una escritura coordinada para los torneos relacionados.",
      );
    }
    repository.saveManyWithActivity(changedTournaments, event);
  } else {
    saveWithActivity(repository, updatedTournament, event);
  }
  return updatedTournament;
}

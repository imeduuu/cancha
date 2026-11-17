import type { TournamentRepository } from "../ports/tournament-repository";
import { createActivityEvent, recordActivity } from "../services/activity-log";
import { evaluateSeasonClosure } from "../services/season-closure";
import type { SeasonClosureRecord } from "../../domain/entities/season-closure";

export interface SeasonClosureReview {
  readonly tournamentId: string;
  readonly universeId: string | null;
  readonly evaluation: ReturnType<typeof evaluateSeasonClosure>;
}
const reviews = new WeakMap<SeasonClosureReview, {content: string; library: string}>();
const snapshot = (repository: TournamentRepository) => JSON.stringify([repository.findAll(), repository.findActivity?.() ?? []]);

export function reviewSeasonClosure(id: string, universeId: string | null, repository: TournamentRepository): SeasonClosureReview {
  const tournaments = repository.findAll(), activity = repository.findActivity?.() ?? [];
  const tournament = tournaments.find(t => t.id === id);
  if (!tournament) throw new Error("La temporada no está disponible en el universo activo.");
  const library = JSON.stringify([tournaments, activity]);
  const review = {tournamentId: id, universeId, evaluation: evaluateSeasonClosure(tournament, tournaments, activity, universeId)};
  if (library !== snapshot(repository)) throw new Error("La biblioteca cambió durante la revisión. Revisa nuevamente el cierre.");
  reviews.set(review, {content: JSON.stringify(review), library});
  return review;
}

/** Called synchronously inside the application's existing global write command. */
export function confirmSeasonClosure(review: SeasonClosureReview, universeId: string | null, repository: TournamentRepository, confirmed: boolean) {
  if (!confirmed) throw new Error("Se requiere confirmación explícita del cierre deportivo.");
  const token = reviews.get(review);
  if (!token || token.content !== JSON.stringify(review)) throw new Error("La revisión está alterada, consumida o no fue emitida por este Centro.");
  if (universeId !== review.universeId) throw new Error("El universo activo cambió. Revisa nuevamente el cierre.");
  if (token.library !== snapshot(repository)) throw new Error("La biblioteca cambió. La revisión de cierre está obsoleta.");
  const current = reviewSeasonClosure(review.tournamentId, universeId, repository).evaluation;
  if (!current.canConfirm) throw new Error(current.confirmed ? "El cierre ya está confirmado para estos fundamentos." : current.blockers.join(" "));
  if (!repository.recordActivity || !repository.findActivity) throw new Error("El repositorio no permite registrar el cierre con su historial.");
  const championTeamId = current.honours.awards.find(award => award.label === "Campeón")?.teamId;
  if (!championTeamId) throw new Error("El servicio deportivo no acredita un campeón para cerrar esta edición.");
  const after: SeasonClosureRecord = {schemaVersion: 1, universeId, foundation: current.foundation, championTeamId};
  const event = createActivityEvent(current.tournament, {action: "season-closure-confirmed", entityType: "season",
    summary: "Se confirmó la revisión del cierre deportivo local. No certifica resultados oficiales ni crea la próxima edición.", after});
  recordActivity(repository, event);
  reviews.delete(review);
  return event;
}

import { createArgentinaChampionsTrophy, argentinaChampionsTrophyId } from "../../domain/services/argentina-champions-trophy";
import type { Tournament } from "../../domain/entities/tournament";
import type { TournamentRepository } from "../ports/tournament-repository";
import { createActivityEvent, saveWithActivity } from "./activity-log";

/** Creates or reconciles the derived trophy after source results change. */
export function synchronizeArgentinaChampionsTrophy(source: Tournament, repository: TournamentRepository): void {
  const next = createArgentinaChampionsTrophy(source);
  if (!next) return;
  const existing = repository.findAll().find(tournament => tournament.id === argentinaChampionsTrophyId);
  if (!existing) {
    saveWithActivity(repository, next, createActivityEvent(next, {
      action: "season-created", entityType: "season",
      summary: "Se creó el Trofeo de Campeones 2026 tras resolverse el Clausura.",
      before: { sourceTournamentId: source.id }, after: { tournamentIds: [next.id], sourceTournamentIds: [source.id] },
    }));
    return;
  }
  const currentFixture = existing.matchdays.flatMap(day => day.fixtures)[0];
  const nextFixture = next.matchdays[0].fixtures[0];
  if (currentFixture?.homeTeamId === nextFixture.homeTeamId && currentFixture.awayTeamId === nextFixture.awayTeamId) return;
  saveWithActivity(repository, next, createActivityEvent(existing, {
    action: "match-result-updated", entityType: "tournament",
    summary: "Se actualizaron los participantes del Trofeo de Campeones según los resultados vigentes de Apertura y Clausura.",
    before: { homeTeamId: currentFixture?.homeTeamId, awayTeamId: currentFixture?.awayTeamId },
    after: { homeTeamId: nextFixture.homeTeamId, awayTeamId: nextFixture.awayTeamId },
  }));
}

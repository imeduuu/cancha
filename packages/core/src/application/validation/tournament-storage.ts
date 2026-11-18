import type { Tournament } from "../../domain/entities/tournament";
import { validateFixtureDetails } from "../../domain/services/match-details";
import { validateTournamentMatchRegulations } from "../../domain/services/match-regulations";
import { validateTournamentPlayerData } from "../../domain/services/player-roster";
import { validateTournamentIntegrity } from "../../domain/services/tournament-integrity";

/**
 * Validación que debe superar un torneo antes de persistirse: integridad deportiva,
 * jugadores, reglamento de partidos y detalles de cada partido, en ese orden.
 * Devuelve el primer problema o undefined. Son las mismas comprobaciones que
 * aplica el adaptador de localStorage al guardar.
 */
export function getTournamentStorageIssue(tournament: Tournament): string | undefined {
  const integrityIssue = validateTournamentIntegrity(tournament)[0];
  if (integrityIssue) return integrityIssue;
  const playerIssue = validateTournamentPlayerData(tournament);
  if (playerIssue) return playerIssue;
  const regulationsIssue = validateTournamentMatchRegulations(tournament);
  if (regulationsIssue) return regulationsIssue;
  for (const matchday of tournament.matchdays) {
    for (const fixture of matchday.fixtures) {
      const detailIssue = validateFixtureDetails(tournament, fixture);
      if (detailIssue) return detailIssue;
    }
  }
  return undefined;
}

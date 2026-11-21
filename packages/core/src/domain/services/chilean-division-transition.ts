import type { Tournament } from "../entities/tournament";
import { calculateStandings } from "./standings";
import { isValidFixtureResult } from "./match-result-validation";
import { getTournamentCompetitionId, hasCompleteRoundRobinSchedule } from "./tournament-history";
import { getChileanAscensoOutcome, tieCrossesCut } from "./chilean-division-outcome";
import { isChileanAscenso } from "./chilean-ascenso-playoff-progression";
import type { DivisionTransition } from "./division-season-transition";

const identity = (t: Tournament) => t.competitionId ?? getTournamentCompetitionId(t.id) ?? t.id;

export function isChileanPrimera(t: Tournament): boolean {
  return identity(t) === "anfp-liga-primera" && t.season === 2026;
}

/** Chile 2026 → 2027: Primera's last places go down; Ascenso's champion and Liguilla winner go up; Ascenso's last goes to Segunda. */
export function getChileanDivisionTransition(primera: Tournament, ascenso: Tournament): DivisionTransition {
  const outcome = getChileanAscensoOutcome(ascenso);
  const pending = [...outcome.pending];
  const result = (upperRelegated: readonly string[] = []): DivisionTransition => ({
    promoted: outcome.promoted, upperRelegated, lowerRelegated: outcome.relegated, pending: [...new Set(pending)],
  });
  if (!isChileanPrimera(primera) || !isChileanAscenso(ascenso) || primera.season !== ascenso.season) {
    pending.push("Selecciona la Liga de Primera y la Liga de Ascenso de Chile de la misma temporada 2026."); return result();
  }
  if (!primera.matchdays.length || primera.matchdays.some(day => day.fixtures.some(fixture =>
    !isValidFixtureResult(primera, day, fixture))) || !hasCompleteRoundRobinSchedule(primera)) {
    pending.push("La Liga de Primera tiene partidos pendientes o un calendario incompleto."); return result();
  }
  const table = calculateStandings(primera);
  const places = primera.placementRules?.relegationPlaces ?? 2;
  if (tieCrossesCut(primera, table, table.length - places)) {
    pending.push("Desempate por el descenso de la Liga de Primera pendiente."); return result();
  }
  return result(table.slice(table.length - places).map(row => row.teamId));
}

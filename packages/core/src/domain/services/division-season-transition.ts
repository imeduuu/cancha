import type { Tournament } from "../entities/tournament";
import { calculateStandings, getUnresolvedStandingsTieGroups } from "./standings";
import { isValidFixtureResult } from "./match-result-validation";
import { getDivisionOutcome } from "./second-division-progression";
import { secondDivisionKind } from "./second-division-rules";
import { normalizeTeamName } from "./team-name";
import { argentinaHalves, getArgentinaHalfFinalWinner } from "./argentina-half-champions";
import { isChileanAscenso } from "./chilean-ascenso-playoff-progression";
import { getChileanDivisionTransition } from "./chilean-division-transition";

export interface DivisionTransition {
  readonly promoted: readonly string[];
  readonly upperRelegated: readonly string[];
  readonly lowerRelegated: readonly string[];
  readonly pending: readonly string[];
}

export function getDivisionTransition(upper: Tournament, lower: Tournament,
  history: readonly Tournament[]): DivisionTransition {
  if (isChileanAscenso(lower)) return getChileanDivisionTransition(upper, lower);
  const kind = secondDivisionKind(lower);
  const expectedUpper = kind === "brasil" ? "brasileirao-serie-a" : "arg-liga-profesional";
  const outcome = getDivisionOutcome(lower);
  const pending = [...outcome.pending];
  const result = (upperRelegated: readonly string[] = []): DivisionTransition => ({
    promoted: outcome.promoted, upperRelegated,
    lowerRelegated: outcome.relegated.map(row => row.teamId), pending: [...new Set(pending)],
  });
  if (!kind || (upper.competitionId ?? upper.id.replace(/-2026$/, "")) !== expectedUpper
    || upper.season !== lower.season || lower.season !== 2026) {
    pending.push("Selecciona Primera y Segunda del mismo país y temporada 2026."); return result();
  }
  if (!upper.matchdays.length || upper.matchdays.some(day => day.fixtures.some(fixture =>
    !isValidFixtureResult(upper, day, fixture)))) {
    pending.push("La Primera División tiene partidos o fases pendientes."); return result();
  }
  if (kind === "brasil") {
    const regular: Tournament = { ...upper };
    const table = calculateStandings(regular);
    if (table.length !== 20 || table.some(row => row.played !== 38)) {
      pending.push("El calendario de Primera no acredita toda la fase regular."); return result();
    }
    // Use the REC Série A rules only for this transition, preserving existing tournament settings.
    const verified = { ...regular, competitionRules: undefined,
      tieBreakers: ["wins", "goalDifference", "goalsFor", "headToHeadGoalDifference", "redCards", "yellowCards"] as const };
    const standings = calculateStandings(verified);
    const ties = getUnresolvedStandingsTieGroups(verified, standings);
    if (ties.some(group => group.some(row => standings.findIndex(item => item.teamId === row.teamId) < 16)
      && group.some(row => standings.findIndex(item => item.teamId === row.teamId) >= 16))) {
      pending.push("Desempate de descenso de Série A pendiente."); return result();
    }
    return result(standings.slice(16).map(row => row.teamId));
  }
  for (const half of argentinaHalves) {
    if (!getArgentinaHalfFinalWinner(upper, half)) pending.push(`Final del ${half} pendiente.`);
  }
  const relegations = getArgentinaRelegations(upper, history);
  pending.push(...relegations.pending);
  return relegations.relegated.length ? result(relegations.relegated) : result();
}

export interface ArgentinaRelegations {
  /** [peor promedio, último de la tabla anual sin el anterior] (art. 93 del Estatuto AFA). */
  readonly relegated: readonly string[];
  readonly pending: readonly string[];
}

/** LPF 2026 relegations: worst three-season average plus last of the annual table (regular phases only). */
export function getArgentinaRelegations(upper: Tournament, history: readonly Tournament[]): ArgentinaRelegations {
  const expectedUpper = "arg-liga-profesional";
  const pending: string[] = [];
  const none = (): ArgentinaRelegations => ({ relegated: [], pending: [...new Set(pending)] });
  const regular: Tournament = { ...upper, matchdays: upper.matchdays.filter(day => day.phaseName?.endsWith("Fase regular")) };
  const table = calculateStandings(regular);
  if (table.length !== 30 || table.some(row => row.played !== 32)) {
    pending.push("El calendario de Primera no acredita toda la fase regular."); return none();
  }
  const seasons = [2024, 2025, 2026];
  const seasonal: Tournament[] = [];
  for (const season of seasons) {
    const candidates = season === 2026 ? [regular] : history.filter(item =>
      item.competitionId === expectedUpper && item.season === season);
    if (candidates.length !== 1 || (season !== 2026 && candidates[0].importCoverage !== "complete")) {
      pending.push(`Falta una temporada ${season} de Primera con cobertura completa verificada para promedios.`); continue;
    }
    const item = candidates[0];
    if (!item.matchdays.length || item.matchdays.some(day => day.fixtures.some(fixture =>
      !isValidFixtureResult(item, day, fixture)))) {
      pending.push(`Hay resultados históricos pendientes en ${season}.`); continue;
    }
    seasonal.push({ ...item, matchdays: item.matchdays.filter(day => !day.phaseName
      || /Fase regular|Brasileirão/.test(day.phaseName)) });
  }
  if (seasonal.length !== 3) return none();
  const averages = upper.teams.map(team => {
    let points = 0, played = 0;
    for (const item of seasonal) {
      const matches = item.teams.filter(candidate => normalizeTeamName(candidate.averageIdentity ?? candidate.name)
        === normalizeTeamName(team.averageIdentity ?? team.name));
      if (matches.length > 1) pending.push(`Identidad histórica ambigua: ${team.name}.`);
      const row = calculateStandings(item).find(row => row.teamId === matches[0]?.id);
      if (row) { points += row.points; played += row.played; }
    }
    return { teamId: team.id, points, played };
  }).sort((a, b) => a.points * b.played - b.points * a.played);
  if (averages.some(row => row.played === 0)
    || averages[0].points * averages[1].played === averages[1].points * averages[0].played) {
    pending.push("Desempate por promedios pendiente (art. 111 AFA)."); return none();
  }
  const first = averages[0].teamId;
  const annual = table.filter(row => row.teamId !== first).sort((a, b) => a.points - b.points);
  if (annual[0].points === annual[1].points) {
    pending.push("Desempate por descenso de la tabla anual pendiente (art. 111 AFA)."); return none();
  }
  return { relegated: [first, annual[0].teamId], pending: [...new Set(pending)] };
}

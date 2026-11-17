import type { Tournament } from "../entities/tournament";
import { calculateStandings, getUnresolvedStandingsTieGroups } from "./standings";
import { isValidFixtureResult } from "./match-result-validation";
import { getDivisionOutcome } from "./second-division-progression";
import { secondDivisionKind } from "./second-division-rules";
import { normalizeTeamName } from "./team-name";

export interface DivisionTransition {
  readonly promoted: readonly string[];
  readonly upperRelegated: readonly string[];
  readonly lowerRelegated: readonly string[];
  readonly pending: readonly string[];
}

export function getDivisionTransition(upper: Tournament, lower: Tournament,
  history: readonly Tournament[]): DivisionTransition {
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
  const regular: Tournament = { ...upper, matchdays: upper.matchdays.filter(day => kind === "brasil"
    || day.phaseName?.endsWith("Fase regular")) };
  const table = calculateStandings(regular);
  if (table.length !== (kind === "brasil" ? 20 : 30)
    || table.some(row => row.played !== (kind === "brasil" ? 38 : 32))) {
    pending.push("El calendario de Primera no acredita toda la fase regular."); return result();
  }
  if (kind === "brasil") {
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
  for (const half of ["Apertura", "Clausura"]) {
    const final = upper.matchdays.find(day => day.phaseName === `Torneo ${half} · Final`);
    const score = final?.fixtures[0]?.result;
    const decisive = score && (score.homeGoals + (score.extraTime?.homeGoals ?? 0)
      !== score.awayGoals + (score.extraTime?.awayGoals ?? 0)
      || (score.penalties && score.penalties.homeGoals !== score.penalties.awayGoals));
    if (final?.fixtures.length !== 1 || !isValidFixtureResult(upper, final, final.fixtures[0]) || !decisive)
      pending.push(`Final del ${half} pendiente.`);
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
  if (seasonal.length !== 3) return result();
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
    pending.push("Desempate por promedios pendiente (art. 111 AFA)."); return result();
  }
  const first = averages[0].teamId;
  const annual = table.filter(row => row.teamId !== first).sort((a, b) => a.points - b.points);
  if (annual[0].points === annual[1].points) {
    pending.push("Desempate por descenso de la tabla anual pendiente (art. 111 AFA)."); return result();
  }
  return result([first, annual[0].teamId]);
}

import type { Tournament } from "../entities/tournament";
import { calculateStandings, hasUniqueStandingsLeader, type TeamStanding } from "./standings";
import { isValidFixtureResult } from "./match-result-validation";
import { argentinaHalves, getArgentinaHalfFinalWinner } from "./argentina-half-champions";

const identity = (t: Tournament) => t.competitionId ?? t.id.replace(/-(?:19|20)\d{2}$/, "");

/** LPF 2026: one tournament with Apertura and Clausura (zones and playoffs). */
export function isArgentinaAnnualLeague(t: Tournament): boolean {
  return identity(t) === "arg-liga-profesional" && t.season === 2026
    && t.matchdays.some(day => day.phaseName === "Torneo Apertura · Fase regular");
}

/**
 * Tabla General de Posiciones 2026 (art. 24.1): only the zone phases of both halves, no playoffs.
 * Art. 24.3 a-b: goal difference, then goals for. Fair Play (c) and the draw (d) are not computed.
 */
export function argentinaGeneralTableTournament(t: Tournament): Tournament {
  return { ...t, competitionRules: undefined, tieBreakers: ["goalDifference", "goalsFor"],
    matchdays: t.matchdays.filter(day => day.phaseName?.endsWith("Fase regular")) };
}

export function getArgentinaGeneralTable(t: Tournament): readonly TeamStanding[] {
  return calculateStandings(argentinaGeneralTableTournament(t));
}

export interface ArgentinaLeagueChampion {
  /** «Campeón de Liga 2026» (art. 24.2). */
  readonly champion?: string;
  readonly pending: readonly string[];
}

/** Requires the whole season played (both halves and their finals) and a unique leader of the Tabla General. */
export function getArgentinaLeagueChampion(t: Tournament): ArgentinaLeagueChampion {
  if (!isArgentinaAnnualLeague(t)) return { pending: ["La temporada no es la Liga Profesional 2026."] };
  const pending: string[] = [];
  if (t.matchdays.some(day => day.fixtures.length === 0 || day.fixtures.some(fixture => !isValidFixtureResult(t, day, fixture))))
    pending.push("La temporada tiene partidos o fases pendientes.");
  for (const half of argentinaHalves)
    if (!getArgentinaHalfFinalWinner(t, half)) pending.push(`Final del ${half} pendiente.`);
  if (pending.length) return { pending };
  const general = argentinaGeneralTableTournament(t), table = calculateStandings(general);
  if (!hasUniqueStandingsLeader(general, table))
    return { pending: ["Empate en el primer puesto de la Tabla General tras diferencia de gol y goles a favor: se define por Fair Play o sorteo (art. 24.3 c-d), que la app no calcula."] };
  return { champion: table[0].teamId, pending: [] };
}

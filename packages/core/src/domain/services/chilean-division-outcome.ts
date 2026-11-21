import type { Tournament } from "../entities/tournament";
import { calculateStandings, getUnresolvedStandingsTieGroups, type TeamStanding } from "./standings";
import { chileanAscensoRegularMatchdays, getChileanAscensoPlayoffWinner, isChileanAscenso } from "./chilean-ascenso-playoff-progression";
import { isValidFixtureResult } from "./match-result-validation";

export interface ChileanAscensoOutcome {
  /** 1.º de la fase regular: asciende directamente. */
  readonly champion?: string;
  /** Ganador de la Liguilla (2.º–8.º): segundo ascenso. */
  readonly playoffWinner?: string;
  readonly promoted: readonly string[];
  /** Últimos de la fase regular según placementRules.relegationPlaces: bajan a Segunda. */
  readonly relegated: readonly string[];
  readonly pending: readonly string[];
  readonly complete: boolean;
}

/** True when an unresolved tie spans positions `cut` and `cut + 1` (1-based). */
export function tieCrossesCut(tournament: Tournament, table: readonly TeamStanding[], cut: number): boolean {
  if (cut <= 0 || cut >= table.length) return false;
  return getUnresolvedStandingsTieGroups(tournament, table).some(group => {
    const positions = group.map(row => table.findIndex(item => item.teamId === row.teamId) + 1);
    return positions.some(p => p <= cut) && positions.some(p => p > cut);
  });
}

/** Sporting outcome of the Chilean Liga de Ascenso 2026: champion, Liguilla winner and relegations. */
export function getChileanAscensoOutcome(tournament: Tournament): ChileanAscensoOutcome {
  const pending: string[] = [];
  const empty = (reason: string): ChileanAscensoOutcome =>
    ({ promoted: [], relegated: [], pending: [reason], complete: false });
  if (!isChileanAscenso(tournament)) return empty("La temporada no es la Liga de Ascenso de Chile con Liguilla configurada.");
  const regular: Tournament = { ...tournament, matchdays: [...chileanAscensoRegularMatchdays(tournament)] };
  const regularComplete = regular.matchdays.length > 0 && regular.matchdays.every(day =>
    day.fixtures.length > 0 && day.fixtures.every(fixture => isValidFixtureResult(regular, day, fixture)));
  if (!regularComplete) return empty("La fase regular de la Liga de Ascenso tiene partidos pendientes.");
  const table = calculateStandings(regular);
  let champion: string | undefined = table[0]?.teamId;
  if (tieCrossesCut(regular, table, 1)) {
    champion = undefined;
    pending.push("Desempate por el primer puesto de la Liga de Ascenso pendiente.");
  }
  const playoffWinner = getChileanAscensoPlayoffWinner(tournament);
  if (!playoffWinner) pending.push("Final de la Liguilla de Ascenso pendiente.");
  const places = tournament.placementRules?.relegationPlaces ?? 0;
  let relegated = places > 0 ? table.slice(table.length - places).map(row => row.teamId) : [];
  if (places > 0 && tieCrossesCut(regular, table, table.length - places)) {
    relegated = [];
    pending.push("Desempate por el descenso de la Liga de Ascenso pendiente.");
  }
  const promoted = [champion, playoffWinner].filter((id): id is string => !!id);
  return { ...(champion ? { champion } : {}), ...(playoffWinner ? { playoffWinner } : {}),
    promoted, relegated, pending, complete: pending.length === 0 };
}

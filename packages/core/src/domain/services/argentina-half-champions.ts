import type { Tournament } from "../entities/tournament";
import { isValidFixtureResult } from "./match-result-validation";

export const argentinaHalves = ["Apertura", "Clausura"] as const;
export type ArgentinaHalf = typeof argentinaHalves[number];

/** Winner of "Torneo <half> · Final": a single valid fixture decided in regular time, extra time or penalties. */
export function getArgentinaHalfFinalWinner(tournament: Tournament, half: ArgentinaHalf): string | undefined {
  const final = tournament.matchdays.find(day => day.phaseName === `Torneo ${half} · Final`);
  const fixture = final?.fixtures.length === 1 ? final.fixtures[0] : undefined;
  const score = fixture?.result;
  if (!final || !fixture || !score || !isValidFixtureResult(tournament, final, fixture)) return undefined;
  const home = score.homeGoals + (score.extraTime?.homeGoals ?? 0);
  const away = score.awayGoals + (score.extraTime?.awayGoals ?? 0);
  if (home !== away) return home > away ? fixture.homeTeamId : fixture.awayTeamId;
  if (score.penalties && score.penalties.homeGoals !== score.penalties.awayGoals)
    return score.penalties.homeGoals > score.penalties.awayGoals ? fixture.homeTeamId : fixture.awayTeamId;
  return undefined;
}

/** Half champions of the Argentine annual league; only tournaments that register those finals have them. */
export function getArgentinaHalfChampions(tournament: Tournament): Partial<Record<ArgentinaHalf, string>> {
  const result: Partial<Record<ArgentinaHalf, string>> = {};
  for (const half of argentinaHalves) {
    const winner = getArgentinaHalfFinalWinner(tournament, half);
    if (winner) result[half] = winner;
  }
  return result;
}

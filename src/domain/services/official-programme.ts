import type { Tournament } from "../entities/tournament";
import type { OfficialProgramme, OfficialResolutionContext } from "../entities/official-resolution";
import { calculateStandings, getUnresolvedStandingsTieGroups } from "./standings";
import { currentResolution, sameParticipants } from "./official-resolution-core";

export function programmeStandings(tournament: Tournament, participantIds: readonly string[], programme: OfficialProgramme) {
  const mini: Tournament = {
    id: "official-tiebreak", name: "Desempate registrado", createdAt: tournament.createdAt,
    teams: tournament.teams.filter(team => participantIds.includes(team.id)), legs: 1,
    tieBreakers: ["goalDifference", "goalsFor"], pointsSystem: { win: 3, draw: 1, loss: 0 },
    matchdays: programme.matches.map((match, index) => ({ number: index + 1, leg: 1, fixtures: [{
      id: match.id, homeTeamId: match.homeTeamId, awayTeamId: match.awayTeamId,
      ...(match.result ? { result: match.result } : {}),
    }] })),
  };
  const standings = calculateStandings(mini);
  return { standings, unresolved: getUnresolvedStandingsTieGroups(mini, standings) };
}
export function programmeOrder(tournament: Tournament, context: OfficialResolutionContext): readonly string[] | undefined {
  const resolution = currentResolution(tournament, context);
  if (resolution?.verification !== "verified" || !resolution.programme) return undefined;
  const programme = resolution.programme;
  if (programme.matches.length !== programme.expectedMatches || programme.matches.some(match => !match.result || !match.resultSource)) return undefined;
  if (new Set(programme.matches.flatMap(match => [match.homeTeamId, match.awayTeamId])).size !== context.participantIds.length) return undefined;
  if (programme.format === "afa-decision") return programme.conclusion?.orderedTeamIds;
  const { standings, unresolved } = programmeStandings(tournament, context.participantIds, programme);
  if (programmeConclusionIssue(tournament, context, programme)) return undefined;
  if (!unresolved.length) return standings.map(row => row.teamId);
  const conclusion = programme.conclusion?.orderedTeamIds;
  if (!conclusion || !sameParticipants(conclusion, context.participantIds)) return undefined;
  return conclusion;
}

export function programmeConclusionIssue(tournament: Tournament, context: OfficialResolutionContext, programme: OfficialProgramme): string | undefined {
  if (!programme.conclusion || programme.format !== "round-robin" || programme.matches.length !== programme.expectedMatches
    || programme.matches.some(match => !match.result)) return undefined;
  const { standings, unresolved } = programmeStandings(tournament, context.participantIds, programme);
  const order = programme.conclusion.orderedTeamIds;
  for (let i = 0; i < standings.length; i++) for (let j = i + 1; j < standings.length; j++) {
    const a = standings[i].teamId, b = standings[j].teamId;
    if (!unresolved.some(group => group.some(row => row.teamId === a) && group.some(row => row.teamId === b))
      && order.indexOf(a) > order.indexOf(b)) return "La conclusión no puede invertir posiciones ya resueltas por puntos, diferencia de goles o goles a favor.";
  }
  return undefined;
}

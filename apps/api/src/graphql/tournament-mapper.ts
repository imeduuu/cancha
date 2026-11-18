import type { ActivityEvent } from "@cancha/core/domain/entities/activity-event";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import { calculateStandingsWithResolution } from "@cancha/core/domain/services/standings";
import { seasonOverview } from "@cancha/core/application/services/competition-center";
import type {
  ActivityEventModel,
  MatchdayModel,
  TournamentModel,
  TournamentSummaryModel,
} from "./models.js";

// Sólo traduce el modelo de core a los tipos GraphQL: los cálculos deportivos
// (tabla, partidos jugados, estado) los hace core.

export function toTournamentSummary(
  tournament: Tournament,
  version: number,
  activity: readonly ActivityEvent[],
): TournamentSummaryModel {
  const overview = seasonOverview(tournament, activity);
  return {
    id: tournament.id,
    name: tournament.name,
    version,
    competitionId: tournament.competitionId,
    season: tournament.season,
    format: tournament.format,
    archived: tournament.archived ?? false,
    teamCount: tournament.teams.length,
    playedMatches: overview.played,
    totalMatches: overview.total,
    status: overview.status,
  };
}

export function toTournamentModel(
  tournament: Tournament,
  version: number,
  activity: readonly ActivityEvent[],
): TournamentModel {
  const teamNames = new Map(tournament.teams.map(team => [team.id, team.name]));
  const { standings, unresolvedTies } = calculateStandingsWithResolution(tournament);
  const matchdays: MatchdayModel[] = tournament.matchdays.map((matchday, index) => ({
    index,
    number: matchday.number,
    leg: matchday.leg,
    phaseName: matchday.phaseName,
    fixtures: matchday.fixtures.map(fixture => ({
      id: fixture.id,
      homeTeamId: fixture.homeTeamId,
      homeTeamName: teamNames.get(fixture.homeTeamId) ?? fixture.homeTeamId,
      awayTeamId: fixture.awayTeamId,
      awayTeamName: teamNames.get(fixture.awayTeamId) ?? fixture.awayTeamId,
      result: fixture.result,
    })),
  }));
  return {
    ...toTournamentSummary(tournament, version, activity),
    matchdays,
    standings: standings.map((standing, index) => ({ position: index + 1, ...standing })),
    unresolvedTies: unresolvedTies.length,
    document: tournament,
  };
}

export function toActivityEventModel(event: ActivityEvent): ActivityEventModel {
  return {
    id: event.id,
    occurredAt: event.occurredAt,
    action: event.action,
    tournamentId: event.tournamentId,
    tournamentName: event.tournamentName,
    season: event.season,
    entityType: event.entityType,
    entityId: event.entityId,
    summary: event.summary,
    note: event.note,
    outcome: event.outcome,
    imported: event.imported ?? false,
    before: event.before,
    after: event.after,
  };
}

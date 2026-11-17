import type { Tournament } from "../../domain/entities/tournament";
import type { OfficialLeagueSeason } from "../ports/official-league-source";
import type { TournamentRepository } from "../ports/tournament-repository";
import { importOfficialSeason } from "./import-official-tournament";
import { normalizeTeamName } from "../../domain/services/team-name";
import { seasonCompetition } from "../../domain/services/season-preparation";
import { validateTournamentIntegrity } from "../../domain/services/tournament-integrity";
import { createActivityEvent, saveWithActivity } from "../services/activity-log";

const reviewed = new WeakMap<CalendarReview, string>();

export interface CalendarReview {
  readonly before: string;
  readonly imported: Tournament;
  readonly missing: readonly string[];
  readonly added: readonly string[];
}
export async function reviewPlannedSeasonCalendar(tournament: Tournament, season: OfficialLeagueSeason, incidentRepository?: TournamentRepository, coordinate: <T>(action: () => T) => T | Promise<T> = action => action()): Promise<CalendarReview> {
  const competition = seasonCompetition(tournament);
  if (!competition || !tournament.season || tournament.season <= 2026
    || season.season !== tournament.season || season.id !== `${competition}-${tournament.season}`)
    throw new Error("El calendario no corresponde a la competición y al año seleccionados.");
  if (!season.teams?.length) throw new Error("Se necesita la nómina publicada para comparar participantes.");
  if (new URL(season.sourceUrl).protocol !== "https:") throw new Error("La fuente debe usar HTTPS.");
  const staging: TournamentRepository = { findAll: () => [], save: () => {}, saveWithActivity: () => {},
    findActivity: incidentRepository?.findActivity ? () => incidentRepository.findActivity!() : undefined,
    recordActivity: incidentRepository?.recordActivity ? event => incidentRepository.recordActivity!(event) : undefined };
  const imported = await coordinate(() => importOfficialSeason(season, staging));
  const expected = new Set(tournament.teams.map(team => normalizeTeamName(team.name)));
  const published = new Set(imported.teams.map(team => normalizeTeamName(team.name)));
  const review = { before: JSON.stringify(tournament), imported,
    missing: tournament.teams.filter(team => !published.has(normalizeTeamName(team.name))).map(team => team.name),
    added: imported.teams.filter(team => !expected.has(normalizeTeamName(team.name))).map(team => team.name) };
  reviewed.set(review, JSON.stringify(review));
  return review;
}
export function confirmPlannedSeasonCalendar(tournament: Tournament, review: CalendarReview,
  repository: TournamentRepository, discrepancyReason = "", now: () => Date = () => new Date()): Tournament {
  if (reviewed.get(review) !== JSON.stringify(review)) throw new Error("La revisión fue modificada; consulta nuevamente el calendario.");
  const current = repository.findAll().find(item => item.id === tournament.id);
  if (JSON.stringify(current) !== review.before || JSON.stringify(tournament) !== review.before)
    throw new Error("La temporada cambió; consulta y revisa el calendario nuevamente.");
  if ((review.missing.length || review.added.length) && !discrepancyReason.trim())
    throw new Error("Confirma las diferencias y registra su justificación documental.");
  const imported = review.imported;
  if (imported.season !== tournament.season || seasonCompetition(imported) !== seasonCompetition(tournament))
    throw new Error("El calendario no corresponde a esta temporada.");
  const teams = imported.teams.map(team => {
    const old = tournament.teams.find(t => normalizeTeamName(t.name) === normalizeTeamName(team.name));
    return old ? { ...old, groupName: team.groupName, competitionNumber: team.competitionNumber } : { ...team, id: crypto.randomUUID() };
  });
  const ids = new Map(imported.teams.map((team,index) => [team.id, teams[index].id]));
  const matchdays = imported.matchdays.map(day => ({ ...day, fixtures: day.fixtures.map(fixture => {
    const homeTeamId = ids.get(fixture.homeTeamId)!, awayTeamId = ids.get(fixture.awayTeamId)!;
    const old = tournament.matchdays.flatMap(d => d.fixtures).find(f => f.id === fixture.id && f.homeTeamId === homeTeamId && f.awayTeamId === awayTeamId);
    return { ...fixture, homeTeamId, awayTeamId, ...(old ? { ...old, schedule: fixture.schedule,
      operationalState: old.result || (old.operationalState && ["in-progress", "postponed", "suspended", "cancelled"].includes(old.operationalState.status))
        ? old.operationalState : fixture.operationalState } : {}) };
  }) }));
  for (const old of tournament.matchdays.flatMap(day => day.fixtures)) {
    const replacement = matchdays.flatMap(day => day.fixtures).find(f => f.id === old.id);
    if (replacement && (replacement.homeTeamId !== old.homeTeamId || replacement.awayTeamId !== old.awayTeamId))
      throw new Error("El proveedor cambió los participantes de un partido existente; requiere revisión manual.");
  }
  const competition = seasonCompetition(tournament)!;
  const peers = repository.findAll().filter(item => item.id !== tournament.id && item.season === tournament.season
    && seasonCompetition(item) && (seasonCompetition(item)!.startsWith("arg-") === competition.startsWith("arg-"))
    && seasonCompetition(item) !== competition);
  if (peers.some(peer => peer.teams.some(team => teams.some(candidate => normalizeTeamName(candidate.averageIdentity ?? candidate.name) === normalizeTeamName(team.averageIdentity ?? team.name)))))
    throw new Error("Un participante publicado ya está en la otra división del mismo país y año. Revisa ambas nóminas.");
  const importedIds = new Set(matchdays.flatMap(day => day.fixtures.map(f => f.id)));
  // Never discard an existing fixture, result, registration, or historical decision implicitly.
  if (tournament.matchdays.some(day => day.fixtures.some(f => !importedIds.has(f.id))))
    throw new Error("El proveedor omitió partidos existentes. Se conserva la temporada; requiere revisión manual.");
  const activeIds = new Set(teams.map(t => t.id));
  if (tournament.playerRegistrations?.some(r => !activeIds.has(r.teamId)) || tournament.officialResolutions?.length)
    throw new Error("La temporada contiene inscripciones o resoluciones que requieren conservar sus participantes.");
  const next: Tournament = { ...tournament, teams, matchdays, sourceUrl: imported.sourceUrl, sourceName: imported.sourceName,
    calendarProvenance: "official-import",
    importCoverage: imported.importCoverage, legs: imported.legs, seasonPreparation: {
      schemaVersion: 1, sourceTournamentIds: tournament.seasonPreparation?.sourceTournamentIds ?? [],
      plannedParticipants: tournament.seasonPreparation?.plannedParticipants ?? tournament.teams.map(t => t.name),
      calendarReviews: [...(tournament.seasonPreparation?.calendarReviews ?? []), { at: now().toISOString(), sourceUrl: imported.sourceUrl!,
        publishedParticipants: teams.map(t => t.name), missing: review.missing, added: review.added,
        ...(discrepancyReason.trim() ? { discrepancyReason: discrepancyReason.trim() } : {}) }] } };
  const issues = validateTournamentIntegrity(next);
  if (issues.length) throw new Error(issues[0]);
  saveWithActivity(repository, next, createActivityEvent(next, { action: "tournament-imported", entityType: "season",
    summary: "Se incorporó el calendario publicado después de revisar los participantes.",
    before: { participants: tournament.teams }, after: { participants: teams, missing: review.missing, added: review.added }, note: discrepancyReason }, now));
  return next;
}

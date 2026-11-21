import type { Tournament } from "../../domain/entities/tournament";
import type { TournamentRepository } from "../ports/tournament-repository";
import { generateRoundRobinSchedule } from "../../domain/services/round-robin-scheduler";
import { chileanAscensoRegularMatchdays, isChileanAscenso } from "../../domain/services/chilean-ascenso-playoff-progression";
import { isChileanPrimera } from "../../domain/services/chilean-division-transition";
import { getTournamentCompetitionId } from "../../domain/services/tournament-history";
import { validateTournamentIntegrity } from "../../domain/services/tournament-integrity";
import { createActivityEvent, saveWithActivity } from "../services/activity-log";

const DEFAULT_ROUNDS = 2;
const chileanIdentities = new Set(["anfp-liga-primera", "anfp-liga-de-ascenso"]);
const identity = (t: Tournament) => t.competitionId ?? getTournamentCompetitionId(t.id) ?? t.id;

/** Round-robin rounds of a previous season's regular phase (the Liguilla is excluded). */
export function regularRounds(source: Tournament | undefined): number {
  if (!source || source.teams.length < 2) return DEFAULT_ROUNDS;
  const regular = isChileanAscenso(source) ? chileanAscensoRegularMatchdays(source) : source.matchdays.filter(day => !day.phaseName);
  const fixtures = regular.reduce((count, day) => count + day.fixtures.length, 0);
  const pairs = source.teams.length * (source.teams.length - 1) / 2;
  const rounds = fixtures / pairs;
  return Number.isInteger(rounds) && rounds >= 1 && rounds <= 20 ? rounds : DEFAULT_ROUNDS;
}

/**
 * Pure: adds a local round-robin calendar (no dates) to a season without fixtures.
 * It is never an official fixture: provenance is "local-generated", as in the calendar programming center.
 */
export function withGeneratedCalendar(t: Tournament, rounds: number, createId: () => string): Tournament {
  if (t.matchdays.some(day => day.fixtures.length)) throw new Error("La temporada ya tiene partidos; no se reemplaza su calendario.");
  const matchdays = generateRoundRobinSchedule(t.teams, rounds).map(day => ({...day,
    fixtures: day.fixtures.map(fixture => ({...fixture, id: createId(), calendarProvenance: "local-generated" as const}))}));
  const next: Tournament = {...t, format: "round-robin", legs: rounds, matchdays,
    calendarProvenance: "local-generated", sourceName: "Calendario local generado por usuario"};
  const issues = validateTournamentIntegrity(next);
  if (issues.length) throw new Error(issues[0]);
  return next;
}

/** A planned Chilean season (Primera or Ascenso) still without fixtures. */
export function canGenerateSeasonCalendar(t: Tournament): boolean {
  return chileanIdentities.has(identity(t)) && !!t.seasonPreparation && t.teams.length >= 2
    && t.matchdays.every(day => day.fixtures.length === 0);
}

/** Rounds taken from the season it was planned from (same competition), or 2 when unavailable. */
export function plannedSeasonRounds(t: Tournament, tournaments: readonly Tournament[]): number {
  const origin = t.seasonPreparation?.sourceTournamentIds.map(id => tournaments.find(item => item.id === id))
    .find(item => item && (identity(t) === "anfp-liga-de-ascenso" ? isChileanAscenso(item) : isChileanPrimera(item)));
  return regularRounds(origin);
}

/** «Generar calendario» for a planned season created before calendars were generated automatically. */
export function generateSeasonCalendar(id: string, repository: TournamentRepository,
  createId: () => string = () => crypto.randomUUID(), now: () => Date = () => new Date()): Tournament {
  const tournaments = repository.findAll(), current = tournaments.find(t => t.id === id);
  if (!current) throw new Error("La temporada no está disponible.");
  if (!canGenerateSeasonCalendar(current))
    throw new Error("Solo se genera el calendario de una temporada planificada de Primera o Ascenso de Chile que aún no tiene partidos.");
  const rounds = plannedSeasonRounds(current, tournaments);
  const used = new Set(tournaments.flatMap(t => t.matchdays.flatMap(day => day.fixtures.map(f => f.id))));
  const uniqueId = () => { for (let i = 0; i < 100; i++) { const value = createId(); if (value.trim() && !used.has(value)) { used.add(value); return value; } }
    throw new Error("No se pudo crear un identificador único."); };
  const next = withGeneratedCalendar(current, rounds, uniqueId);
  saveWithActivity(repository, next, createActivityEvent(current, {
    action: "calendar-programmed", entityType: "season",
    summary: `Se generó un calendario local todos contra todos (${rounds} ruedas). No es un fixture oficial.`,
    before: { matchdays: current.matchdays.length },
    after: { provenance: "local-generated", matchdays: next.matchdays.length,
      fixtures: next.matchdays.reduce((count, day) => count + day.fixtures.length, 0) },
  }, now));
  return next;
}

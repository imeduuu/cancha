import { DomainError } from "../../domain/domain-error.js";
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
const zonedIdentities = new Set(["arg-liga-profesional", "arg-primera-nacional"]);
const brazilianIdentities = new Set(["brasileirao-serie-a", "brasileirao-serie-b"]);
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
  if (t.matchdays.some(day => day.fixtures.length)) throw new DomainError("La temporada ya tiene partidos; no se reemplaza su calendario.");
  const matchdays = generateRoundRobinSchedule(t.teams, rounds).map(day => ({...day,
    fixtures: day.fixtures.map(fixture => ({...fixture, id: createId(), calendarProvenance: "local-generated" as const}))}));
  const next: Tournament = {...t, format: "round-robin", legs: rounds, matchdays,
    calendarProvenance: "local-generated", sourceName: "Calendario local generado por usuario"};
  const issues = validateTournamentIntegrity(next);
  if (issues.length) throw new DomainError(issues[0]);
  return next;
}

/** A supported planned season with an explicit format and no fixtures yet. */
export function canGenerateSeasonCalendar(t: Tournament): boolean {
  const id = identity(t);
  const supportedFormat = chileanIdentities.has(id) || brazilianIdentities.has(id)
    || zonedIdentities.has(id) && t.teams.every(team => !!team.groupName?.trim())
      && new Set(t.teams.map(team => team.groupName?.trim()).filter(Boolean)).size === 2;
  return supportedFormat && !!t.seasonPreparation && t.teams.length >= 2
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
  if (!current) throw new DomainError("La temporada no está disponible.");
  if (!canGenerateSeasonCalendar(current))
    throw new DomainError("Esta temporada no tiene un formato compatible registrado o ya contiene partidos.");
  const idIdentity = identity(current);
  const grouped = zonedIdentities.has(idIdentity);
  const rounds = grouped ? 2 : brazilianIdentities.has(idIdentity) ? 2 : plannedSeasonRounds(current, tournaments);
  const used = new Set(tournaments.flatMap(t => t.matchdays.flatMap(day => day.fixtures.map(f => f.id))));
  const uniqueId = () => { for (let i = 0; i < 100; i++) { const value = createId(); if (value.trim() && !used.has(value)) { used.add(value); return value; } }
    throw new DomainError("No se pudo crear un identificador único."); };
  let next: Tournament;
  if (grouped) {
    const groups = [...new Set(current.teams.map(team => team.groupName).filter((name): name is string => !!name))].sort();
    const groupTeams = groups.map(group => current.teams.filter(team => team.groupName === group));
    if (groupTeams[0].length !== groupTeams[1].length || groupTeams[0].length < 2)
      throw new DomainError("Las dos zonas deben tener la misma cantidad de equipos para generar los cruces interzonales.");
    const roundsPerLeg = groupTeams[0].length % 2 === 0 ? groupTeams[0].length - 1 : groupTeams[0].length;
    const roundsPerSeason = roundsPerLeg + 1;
    const byRound = new Map<number, import("../../domain/entities/tournament").Fixture[]>();
    for (const group of groups) {
      const teams = current.teams.filter(team => team.groupName === group);
      for (const day of generateRoundRobinSchedule(teams, rounds)) {
        const number = (day.leg - 1) * roundsPerSeason + day.number - (day.leg - 1) * roundsPerLeg;
        const fixtures = byRound.get(number) ?? [];
        fixtures.push(...day.fixtures.map(fixture => ({ ...fixture, id: uniqueId(), calendarProvenance: "local-generated" as const })));
        byRound.set(number, fixtures);
      }
    }
    for (let leg = 1; leg <= rounds; leg += 1) {
      const number = leg * roundsPerSeason;
      byRound.set(number, groupTeams[0].map((team, index) => ({ id: uniqueId(),
        homeTeamId: leg % 2 === 1 ? team.id : groupTeams[1][index].id,
        awayTeamId: leg % 2 === 1 ? groupTeams[1][index].id : team.id,
        calendarProvenance: "local-generated" as const })));
    }
    const matchdays = [...byRound].sort(([a], [b]) => a - b)
      .map(([number, fixtures]) => ({ number, leg: Math.floor((number - 1) / roundsPerSeason) + 1, fixtures }));
    next = { ...current, format: "round-robin", legs: rounds, matchdays, calendarProvenance: "local-generated", sourceName: "Calendario local generado por usuario" };
    const issues = validateTournamentIntegrity(next);
    if (issues.length) throw new DomainError(issues[0]);
  } else {
    next = withGeneratedCalendar(current, rounds, uniqueId);
  }
  saveWithActivity(repository, next, createActivityEvent(current, {
    action: "calendar-programmed", entityType: "season",
    summary: `Se generó un calendario local ${grouped ? "por zonas" : "todos contra todos"} (${rounds} ruedas). No es un fixture oficial.`,
    before: { matchdays: current.matchdays.length },
    after: { provenance: "local-generated", matchdays: next.matchdays.length,
      fixtures: next.matchdays.reduce((count, day) => count + day.fixtures.length, 0) },
  }, now));
  return next;
}

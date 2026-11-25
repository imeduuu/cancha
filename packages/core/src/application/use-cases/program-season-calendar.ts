import { DomainError } from "../../domain/domain-error.js";
import type { CalendarProvenance, Matchday, Tournament } from "../../domain/entities/tournament";
import { validateTournamentIntegrity } from "../../domain/services/tournament-integrity";
import { generateRoundRobinSchedule } from "../../domain/services/round-robin-scheduler";
import { MAX_TOURNAMENT_LEGS } from "../../domain/value-objects/tournament-limits";
import { normalizeTeamName } from "../../domain/services/team-name";
import type { TournamentRepository } from "../ports/tournament-repository";
import { createActivityEvent, saveWithActivity } from "../services/activity-log";

const proposals = new WeakMap<CalendarProgrammingProposal, string>();

export interface CalendarProgrammingProposal {
  readonly tournamentId: string;
  readonly universeId: string | null;
  readonly before: string;
  readonly proposed: Tournament;
  readonly dependencies: string;
  readonly kind: Extract<CalendarProvenance, "local-generated" | "manual">;
  readonly warnings: readonly string[];
}

export interface ManualFixtureInput {
  readonly id: string;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
}

export interface ManualMatchdayInput {
  readonly number: number;
  readonly leg: number;
  readonly phaseName?: string;
  readonly fixtures: readonly ManualFixtureInput[];
}

export function getCalendarProgrammingBlockers(
  tournament: Tournament,
  availableTournaments?: readonly Tournament[],
): string[] {
  const blockers: string[] = [];
  if (!tournament.seasonPreparation) blockers.push("La temporada no está marcada como una preparación de temporada.");
  if (tournament.teams.length < 2) blockers.push("Se requieren al menos dos participantes.");
  if (tournament.teams.some((team) => typeof team.id !== "string" || !team.id.trim()
    || typeof team.name !== "string" || !team.name.trim())
    || new Set(tournament.teams.map((team) => team.id)).size !== tournament.teams.length
    || new Set(tournament.teams.map((team) => normalizeTeamName(team.name))).size !== tournament.teams.length) {
    blockers.push("Las identidades de participantes están incompletas o duplicadas.");
  }
  if (availableTournaments) {
    const availableIds = new Set(availableTournaments.map(({ id }) => id));
    const missing = (tournament.seasonPreparation?.sourceTournamentIds ?? [])
      .filter((id) => !availableIds.has(id));
    if (missing.length) blockers.push(`Dependencias de preparación no disponibles en el universo activo: ${missing.join(", ")}.`);
  }
  const rules = tournament.competitionRules;
  if (!rules || rules.season !== tournament.season) {
    blockers.push("Falta registrar el reglamento de la temporada seleccionada.");
  } else if (rules.verification.standings !== "verified" || rules.verification.placements !== "verified"
    || !rules.sourceUrls?.length || !rules.standingsNote?.trim() || !rules.placementsNote?.trim()) {
    blockers.push("El reglamento anual y sus fuentes todavía no están completamente verificados.");
  }
  if (tournament.matchRegulations
    && (tournament.matchRegulations.season !== tournament.season
      || tournament.matchRegulations.verification !== "verified")) {
    blockers.push("El reglamento de partidos está pendiente o no corresponde a esta temporada.");
  }
  return blockers;
}

export function previewGeneratedCalendar(
  tournament: Tournament,
  universeId: string | null,
  legs: number,
  createId: () => string = () => crypto.randomUUID(),
  availableTournaments?: readonly Tournament[],
): CalendarProgrammingProposal {
  const blockers = getCalendarProgrammingBlockers(tournament, availableTournaments);
  if (blockers.length) throw new DomainError(blockers.join(" "));
  if (!Number.isSafeInteger(legs) || legs < 1 || legs > MAX_TOURNAMENT_LEGS) {
    throw new DomainError(`El número de ruedas debe ser un entero entre 1 y ${MAX_TOURNAMENT_LEGS}.`);
  }
  if (tournament.competitionType === "cup") {
    throw new DomainError("Las copas requieren reglas de admisión y etapas específicas; el generador de todos contra todos no es compatible.");
  }
  if (tournament.teams.some((team) => team.groupName)) {
    throw new DomainError("El generador general de todos contra todos no conserva grupos. Este formato requiere un generador específico.");
  }
  const existingFixtures = tournament.matchdays.flatMap((day) => day.fixtures);
  if (existingFixtures.length > 0) {
    if (existingFixtures.some((fixture) => fixture.result
      || fixture.goalScorers?.length
      || fixture.events?.length
      || fixture.lineups
      || fixture.substitutions?.length
      || fixture.operationalState && fixture.operationalState.status !== "unscheduled")) {
      throw new DomainError("El calendario existente contiene resultados o actividad deportiva. No se permite reemplazarlo.");
    }
    throw new DomainError("Ya existe un calendario. Usa la programación manual para agregar partidos sin reemplazarlo.");
  }
  const days = generateRoundRobinSchedule(tournament.teams, legs)
    .map((day) => ({
      ...day,
      fixtures: day.fixtures.map((fixture) => ({
        ...fixture,
        id: createId(),
        calendarProvenance: "local-generated" as const,
      })),
    }));
  const proposed = {
    ...tournament,
    format: "round-robin" as const,
    legs,
    matchdays: days,
    calendarProvenance: "local-generated" as const,
  };
  validateProposal(proposed);
  return createProposal(tournament, proposed, universeId, "local-generated", availableTournaments, [
    "Calendario local generado; no es una publicación oficial.",
    "Las fechas y horarios no se asignaron.",
  ]);
}

export function previewManualCalendar(
  tournament: Tournament,
  universeId: string | null,
  matchdays: readonly ManualMatchdayInput[],
  createId: () => string = () => crypto.randomUUID(),
  availableTournaments?: readonly Tournament[],
  reuseEmptyStageDays = false,
): CalendarProgrammingProposal {
  const blockers = getCalendarProgrammingBlockers(tournament, availableTournaments);
  if (blockers.length) throw new DomainError(blockers.join(" "));
  if (tournament.format !== "round-robin" && tournament.format !== "staged") {
    throw new DomainError("Formato no reconocido. Registra el formato deportivo antes de programar partidos.");
  }
  if (tournament.format === "staged" && !tournament.knockoutStages?.length) {
    throw new DomainError("El formato por etapas no tiene etapas registradas para validar los cruces.");
  }
  if (!matchdays.length || matchdays.some((day) =>
    !Number.isSafeInteger(day.number) || day.number < 1
      || !Number.isSafeInteger(day.leg) || day.leg < 1 || day.leg > tournament.legs
      || !day.fixtures.length)) {
    throw new DomainError("Cada jornada manual debe tener número, rueda/fase y al menos un encuentro.");
  }
  const additions: Matchday[] = matchdays.map((day) => ({
    ...day,
    fixtures: day.fixtures.map((fixture) => ({
      ...fixture,
      id: fixture.id.trim() || createId(),
      calendarProvenance: "manual" as const,
    })),
  }));
  const consumed = new Set<typeof additions[number]>();
  const existingDays = tournament.matchdays.map(day => {
    if (!reuseEmptyStageDays || day.fixtures.length) return day;
    const matches = additions.filter(addition => addition.number === day.number && addition.leg === day.leg && addition.phaseName === day.phaseName);
    if (matches.length !== 1 || consumed.has(matches[0])) return day;
    consumed.add(matches[0]);
    return {...day, fixtures: matches[0].fixtures};
  });
  const proposed: Tournament = {
    ...tournament,
    matchdays: [...existingDays, ...additions.filter(day => !consumed.has(day))],
    calendarProvenance: "manual",
  };
  validateProposal(proposed);
  return createProposal(tournament, proposed, universeId, "manual", availableTournaments, [
    "Programación local registrada manualmente; no es una publicación oficial.",
    "Las fechas, horarios y sedes permanecen opcionales.",
  ]);
}

export function confirmCalendarProgramming(
  proposal: CalendarProgrammingProposal,
  tournament: Tournament,
  repository: TournamentRepository,
  currentUniverseId: string | null,
): Tournament {
  if (proposals.get(proposal) !== JSON.stringify(proposal)) {
    throw new DomainError("La propuesta fue modificada. Genera una nueva vista previa.");
  }
  if (proposal.universeId !== currentUniverseId) {
    throw new DomainError("El universo activo cambió. Revisa nuevamente la propuesta.");
  }
  const current = repository.findAll().find((item) => item.id === proposal.tournamentId);
  if (proposal.tournamentId !== tournament.id
    || proposal.before !== JSON.stringify(tournament)
    || proposal.before !== JSON.stringify(current)) {
    throw new DomainError("La temporada o sus dependencias cambiaron. Revisa nuevamente la propuesta.");
  }
  if (getCalendarProgrammingBlockers(tournament, repository.findAll()).length) {
    throw new DomainError("El reglamento o los participantes ya no cumplen las condiciones de programación.");
  }
  if (proposal.dependencies !== dependencySnapshot(tournament, repository.findAll())) {
    throw new DomainError("Las dependencias de la temporada cambiaron. Revisa nuevamente la propuesta.");
  }
  validateProposal(proposal.proposed);
  const hasExistingFixtures = tournament.matchdays.some((day) => day.fixtures.length > 0);
  const next = {
    ...proposal.proposed,
    calendarProvenance: hasExistingFixtures
      ? tournament.calendarProvenance ?? proposal.kind
      : proposal.kind,
    ...(!hasExistingFixtures ? proposal.kind === "local-generated"
      ? { sourceName: "Calendario local generado por usuario", sourceUrl: undefined }
      : { sourceName: "Calendario local registrado manualmente", sourceUrl: undefined } : {}),
  };
  saveWithActivity(repository, next, createActivityEvent(tournament, {
    action: "calendar-programmed",
    entityType: "season",
    summary: proposal.kind === "local-generated"
      ? "Se confirmó un calendario local generado por el usuario."
      : "Se confirmaron encuentros registrados manualmente.",
    before: { matchdays: tournament.matchdays.length },
    after: {
      provenance: proposal.kind,
      matchdays: next.matchdays.length,
      fixtures: next.matchdays.reduce((count, day) => count + day.fixtures.length, 0),
    },
  }));
  proposals.delete(proposal);
  return next;
}

function createProposal(
  before: Tournament,
  proposed: Tournament,
  universeId: string | null,
  kind: CalendarProgrammingProposal["kind"],
  availableTournaments: readonly Tournament[] | undefined,
  warnings: readonly string[],
): CalendarProgrammingProposal {
  const proposal = {
    tournamentId: before.id,
    universeId,
    before: JSON.stringify(before),
    proposed,
    dependencies: dependencySnapshot(before, availableTournaments ?? []),
    kind,
    warnings,
  };
  proposals.set(proposal, JSON.stringify(proposal));
  return proposal;
}

function dependencySnapshot(
  tournament: Tournament,
  availableTournaments: readonly Tournament[],
): string {
  const sourceIds = new Set(tournament.seasonPreparation?.sourceTournamentIds ?? []);
  return JSON.stringify(availableTournaments
    .filter(({ id }) => sourceIds.has(id))
    .sort((first, second) => first.id.localeCompare(second.id)));
}

function validateProposal(tournament: Tournament): void {
  const issues = validateTournamentIntegrity(tournament);
  if (issues.length) throw new DomainError(issues[0]);
}

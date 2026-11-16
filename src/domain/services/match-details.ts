import type {
  Fixture,
  MatchEvent,
  MatchLineups,
  MatchSubstitution,
  TeamLineup,
  Tournament,
} from "../entities/tournament";
import { getMatchRegulationConflict, getMatchRegulationWarnings } from "./match-regulations";
import { validateGoalScorers } from "./goal-scorers";
import { validateMatchSchedule } from "./match-scheduling";

export interface FixtureDetailsUpdate {
  readonly lineups?: MatchLineups;
  readonly substitutions?: readonly MatchSubstitution[];
  readonly events?: readonly MatchEvent[];
  readonly eventsCoverage?: "unverified" | "complete";
}

export function getExpectedStarters(tournament: Tournament): number {
  const regulationsConflict = getMatchRegulationConflict(tournament);
  if (!regulationsConflict && tournament.matchRegulations?.lineup?.requiredStarters !== undefined) {
    return tournament.matchRegulations.lineup.requiredStarters;
  }
  return tournament.lineupRules?.startersPerTeam ?? 11;
}

export function getLineupStatus(
  lineup: Pick<TeamLineup, "starters">,
  expectedStarters: number,
): "incomplete" | "complete" {
  return lineup.starters.length === expectedStarters ? "complete" : "incomplete";
}

export function validateFixtureDetails(
  tournament: Tournament,
  fixture: Fixture,
): string | undefined {
  if (fixture.eventsCoverage !== undefined
    && fixture.eventsCoverage !== "unverified" && fixture.eventsCoverage !== "complete") {
    return "La cobertura de eventos debe ser completa o no verificada.";
  }
  if (fixture.schedule !== undefined) {
    const scheduleIssue = validateMatchSchedule(fixture.schedule);
    if (scheduleIssue) return scheduleIssue;
  }
  const playersById = new Map((tournament.players ?? []).map((player) => [player.id, player]));
  const registrations = tournament.playerRegistrations ?? [];
  const registrationExists = (playerId: string, teamId: string) =>
    registrations.some((registration) => registration.playerId === playerId
      && registration.teamId === teamId);
  const expected = getExpectedStarters(tournament);
  const teamLineups: Array<{ teamId: string; lineup: TeamLineup }> = [];
  if (fixture.lineups) {
    teamLineups.push(
      { teamId: fixture.homeTeamId, lineup: fixture.lineups.home },
      { teamId: fixture.awayTeamId, lineup: fixture.lineups.away },
    );
    for (const { teamId, lineup } of teamLineups) {
      if (!tournament.matchRegulations && lineup.status !== getLineupStatus(lineup, expected)) {
        return `El estado de alineación debe ser ${getLineupStatus(lineup, expected)} para ${teamId}.`;
      }
      if (!tournament.matchRegulations && lineup.starters.length > expected) {
        return `La alineación de ${teamId} no puede superar los ${expected} titulares configurados.`;
      }
      if (lineup.starters.length > 30 || lineup.substitutes.length > 30) {
        return `La alineación de ${teamId} excede el máximo estructural permitido.`;
      }
      const allIds = [...lineup.starters, ...lineup.substitutes];
      if (new Set(allIds).size !== allIds.length) {
        return `Hay jugadores duplicados entre titulares y suplentes de ${teamId}.`;
      }
      if (lineup.captainPlayerId && !lineup.starters.includes(lineup.captainPlayerId)) {
        return `El capitán de ${teamId} debe estar entre los titulares.`;
      }
      if (lineup.formation !== undefined && lineup.formation.length > 20) {
        return "El esquema táctico no puede superar los 20 caracteres.";
      }
      for (const playerId of allIds) {
        if (!playersById.has(playerId) || !registrationExists(playerId, teamId)) {
          return `El jugador "${playerId}" no pertenece a la plantilla de ${teamId} en este torneo y temporada.`;
        }
      }
    }
  }

  const substitutions = fixture.substitutions ?? [];
  if (substitutions.length > 0 && !fixture.lineups) {
    return "Para validar sustituciones primero registra las alineaciones del partido.";
  }
  const substitutionIds = new Set<string>();
  for (const { teamId, lineup } of teamLineups) {
    const teamSubs = substitutions.filter((substitution) => substitution.teamId === teamId);
    const onField = new Set(lineup.starters);
    const availableSubs = new Set(lineup.substitutes);
    const usedSubs = new Set<string>();
    for (const substitution of teamSubs) {
      if (substitutionIds.has(substitution.id) || !substitution.id.trim()) {
        return "Los identificadores de sustitución deben ser únicos y no vacíos.";
      }
      substitutionIds.add(substitution.id);
      if (substitution.minute !== undefined
        && (!Number.isSafeInteger(substitution.minute)
          || substitution.minute < 1 || substitution.minute > 180)) {
        return "El minuto de una sustitución debe estar entre 1 y 180.";
      }
      if (substitution.window !== undefined
        && (!Number.isSafeInteger(substitution.window)
          || substitution.window < 1 || substitution.window > 30)) {
        return "La ventana de una sustitución debe ser un entero positivo.";
      }
      if (!onField.has(substitution.playerOutId)) {
        return `El jugador que sale (${substitution.playerOutId}) no está en el campo.`;
      }
      if (!availableSubs.has(substitution.playerInId)
        || usedSubs.has(substitution.playerInId)
        || onField.has(substitution.playerInId)) {
        return `El jugador que entra (${substitution.playerInId}) no está disponible como suplente.`;
      }
      onField.delete(substitution.playerOutId);
      onField.add(substitution.playerInId);
      usedSubs.add(substitution.playerInId);
    }
  }
  if (substitutions.some((substitution) =>
    substitution.teamId !== fixture.homeTeamId && substitution.teamId !== fixture.awayTeamId)) {
    return "La sustitución debe pertenecer a uno de los equipos del partido.";
  }

  const eventIds = new Set<string>();
  const eventsById = new Map<string, MatchEvent>();
  for (const event of fixture.events ?? []) {
    if (!event.id.trim() || eventIds.has(event.id)) return "Los IDs de eventos deben ser únicos y no vacíos.";
    eventIds.add(event.id);
    eventsById.set(event.id, event);
    if (event.teamId !== fixture.homeTeamId && event.teamId !== fixture.awayTeamId) {
      return "El evento debe estar asociado a uno de los equipos participantes.";
    }
    if (!event.playerName.trim()) return "Cada evento debe incluir el nombre del jugador relacionado.";
    if (event.minute !== undefined
      && (!Number.isSafeInteger(event.minute) || event.minute < 1 || event.minute > 180)) {
      return "El minuto de un evento debe ser un entero entre 1 y 180.";
    }
    if (event.period !== undefined
      && event.period !== "regulation" && event.period !== "extra-time" && event.period !== "penalties") {
      return "El período del evento no es válido.";
    }
    if (event.type === "own-goal") {
      if (!event.benefitedTeamId
        || (event.benefitedTeamId !== fixture.homeTeamId
          && event.benefitedTeamId !== fixture.awayTeamId)
        || event.benefitedTeamId === event.teamId) {
        return "Un autogol debe indicar como beneficiado al equipo rival.";
      }
    } else if (event.benefitedTeamId !== undefined) {
      return "Solo un autogol puede tener un equipo beneficiado.";
    }
    if (event.playerId) {
      if (!playersById.has(event.playerId) || !registrationExists(event.playerId, event.teamId)) {
        return `El jugador del evento "${event.playerId}" no pertenece a ese equipo en esta temporada.`;
      }
    }
  }
  const scorerEventIds = new Set<string>();
  const scorerIssue = validateGoalScorers(fixture.goalScorers ?? [], fixture);
  if (scorerIssue) return scorerIssue;
  for (const scorer of fixture.goalScorers ?? []) {
    if (scorer.playerId && (!playersById.has(scorer.playerId)
      || !registrationExists(scorer.playerId, scorer.teamId))) {
      return `El autor de gol "${scorer.playerId}" no pertenece a ese equipo en esta temporada.`;
    }
    if (!scorer.eventId) continue;
    const event = eventsById.get(scorer.eventId);
    if (scorerEventIds.has(scorer.eventId)
      || !event
      || (event.type !== "goal" && event.type !== "own-goal")
      || event.teamId !== scorer.teamId
      || event.playerId !== scorer.playerId
      || event.type !== (scorer.type === "own-goal" ? "own-goal" : "goal")) {
      return "Los autores de goles vinculados deben coincidir con un evento de gol único del partido.";
    }
    scorerEventIds.add(scorer.eventId);
  }
  return undefined;
}

export interface FixtureDetailsValidation {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly regulatoryStatus:
    | "not-configured" | "unverified" | "conflict" | "warning" | "incomplete" | "compliant";
}

export function validateFixtureDetailsWithWarnings(
  tournament: Tournament,
  fixture: Fixture,
): FixtureDetailsValidation {
  const error = validateFixtureDetails(tournament, fixture);
  const conflict = getMatchRegulationConflict(tournament);
  const regulations = tournament.matchRegulations;
  const warnings = getMatchRegulationWarnings(tournament, fixture);
  if (regulations?.eligibility?.activeRegistrationRequired) {
    const registrations = tournament.playerRegistrations ?? [];
    const lineups = fixture.lineups
      ? [fixture.lineups.home, fixture.lineups.away]
      : [];
    const ineligible = lineups.flatMap((lineup) => [
      ...lineup.starters,
      ...lineup.substitutes,
    ]).some((playerId) => !registrations.some((registration) =>
      registration.playerId === playerId
      && registration.status !== "released"));
    if (ineligible) warnings.push("Hay jugadores sin inscripción activa según el criterio configurado.");
  }
  if (regulations && !fixture.lineups) {
    warnings.push("No hay alineaciones registradas; no es posible confirmar su validez reglamentaria.");
  } else if (regulations && fixture.lineups
    && (fixture.lineups.home.status !== "complete" || fixture.lineups.away.status !== "complete")) {
    warnings.push("Hay alineaciones incompletas; no es posible confirmar su validez reglamentaria.");
  }
  if (regulations && fixture.lineups) {
    for (const [teamId, lineup] of [
      [fixture.homeTeamId, fixture.lineups.home],
      [fixture.awayTeamId, fixture.lineups.away],
    ] as const) {
      if (lineup.status !== getLineupStatus(lineup, getExpectedStarters(tournament))) {
        warnings.push(`El estado de la alineación de ${teamId} no coincide con la cantidad de titulares exigida por la configuración actual.`);
      }
    }
  }
  const regulatoryStatus = !regulations
    ? "not-configured"
    : conflict
      ? "conflict"
      : regulations.verification !== "verified"
        ? "unverified"
        : regulations.lineup?.requiredStarters === undefined || !fixture.lineups
          || fixture.lineups.home.status !== "complete"
          || fixture.lineups.away.status !== "complete"
          ? "incomplete"
          : warnings.length > 0 ? "warning" : "compliant";
  return {
    errors: error ? [error] : [],
    warnings: [...new Set(warnings)],
    regulatoryStatus,
  };
}

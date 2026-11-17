import type { Fixture, MatchEvent, MatchRegulations, Tournament } from "../entities/tournament";
import { isValidFixtureResult } from "./match-result-validation";

export function validateMatchRegulations(value: unknown): string | undefined {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || !Number.isSafeInteger(value.season)
    || Number(value.season) < 1
    || !isVerificationStatus(value.verification)) {
    return "La estructura o versión del reglamento no es válida.";
  }
  if (value.sourceUrl !== undefined && !isOptionalText(value.sourceUrl)) {
    return "La fuente del reglamento debe ser un texto válido.";
  }
  if (value.notes !== undefined && !isOptionalText(value.notes)) {
    return "Las observaciones del reglamento deben ser texto.";
  }
  if (value.verification === "verified"
    && !isNonEmptyText(value.sourceUrl)
    && !isNonEmptyText(value.notes)) {
    return "Un reglamento no puede marcarse como verificado sin una fuente u observación que documente la verificación.";
  }
  if (value.lineup !== undefined) {
    if (!isRecord(value.lineup)
      || !isOptionalInteger(value.lineup.requiredStarters, 1, 30)
      || !isOptionalInteger(value.lineup.maxSubstitutes, 0, 30)) {
      return "La configuración de titulares o suplentes no es válida.";
    }
  }
  if (value.substitutions !== undefined) {
    if (!isRecord(value.substitutions)
      || !isOptionalInteger(value.substitutions.maxCount, 0, 30)
      || !isOptionalInteger(value.substitutions.maxWindows, 0, 30)) {
      return "La configuración de sustituciones no es válida.";
    }
  }
  if (value.timing !== undefined) {
    if (!isRecord(value.timing)
      || !isOptionalInteger(value.timing.regulationMinutes, 1, 180)
      || !isOptionalInteger(value.timing.halfMinutes, 1, 90)
      || !isOptionalBoolean(value.timing.addedTimeAllowed)
      || !isOptionalBoolean(value.timing.extraTimeAllowed)
      || !isOptionalInteger(value.timing.extraTimeMinutes, 0, 60)
      || !isOptionalBoolean(value.timing.penaltyShootoutAllowed)) {
      return "La configuración de duración del partido no es válida.";
    }
    if (value.timing.regulationMinutes !== undefined
      && value.timing.halfMinutes !== undefined
      && Number(value.timing.halfMinutes) * 2 !== Number(value.timing.regulationMinutes)) {
      return "La duración total y la duración de cada tiempo se contradicen.";
    }
    if (value.timing.extraTimeAllowed === false && value.timing.extraTimeMinutes !== undefined
      && Number(value.timing.extraTimeMinutes) > 0) {
      return "Se configuró duración de prórroga, pero la prórroga figura como no permitida.";
    }
  }
  if (value.cards !== undefined) {
    if (!isRecord(value.cards)
      || !isOptionalInteger(value.cards.yellowCardsForSuspension, 1, 30)
      || !isOptionalInteger(value.cards.redCardSuspensionMatches, 0, 30)) {
      return "La configuración de tarjetas no es válida.";
    }
  }
  if (value.eligibility !== undefined) {
    if (!isRecord(value.eligibility)
      || !isOptionalBoolean(value.eligibility.activeRegistrationRequired)
      || !isOptionalInteger(value.eligibility.minimumAge, 0, 100)
      || !isOptionalInteger(value.eligibility.maximumAge, 0, 100)) {
      return "La configuración de elegibilidad no es válida.";
    }
    if (value.eligibility.minimumAge !== undefined
      && value.eligibility.maximumAge !== undefined
      && Number(value.eligibility.minimumAge) > Number(value.eligibility.maximumAge)) {
      return "La edad mínima no puede superar la edad máxima.";
    }
  }
  return undefined;
}

export function validateTournamentMatchRegulations(tournament: Tournament): string | undefined {
  const regulations = tournament.matchRegulations;
  if (!regulations) return undefined;
  const issue = validateMatchRegulations(regulations);
  if (issue) return issue;
  const tournamentSeason = tournament.season ?? tournament.competitionRules?.season;
  if (tournamentSeason === undefined || regulations.season !== tournamentSeason) {
    return "El reglamento debe corresponder a una temporada explícitamente identificada en el torneo.";
  }
  return undefined;
}

export function getMatchRegulationConflict(tournament: Tournament): string | undefined {
  const configuredStarters = tournament.matchRegulations?.lineup?.requiredStarters;
  const legacyStarters = tournament.lineupRules?.startersPerTeam;
  if (configuredStarters !== undefined && legacyStarters !== undefined
    && configuredStarters !== legacyStarters) {
    return `Conflicto: el reglamento indica ${configuredStarters} titulares y la regla histórica indica ${legacyStarters}.`;
  }
  return undefined;
}

export function getMatchRegulationWarnings(
  tournament: Tournament,
  fixture: Tournament["matchdays"][number]["fixtures"][number],
): string[] {
  const regulations = tournament.matchRegulations;
  if (!regulations) return [];
  const warnings: string[] = [];
  const conflict = getMatchRegulationConflict(tournament);
  if (conflict) {
    warnings.push(`${conflict} No se declara conformidad reglamentaria.`);
    return warnings;
  }
  if (regulations.verification !== "verified") {
    warnings.push(`Reglamento ${regulations.verification}: la conformidad del partido no puede confirmarse.`);
  }
  const lineup = regulations.lineup;
  if (fixture.lineups && lineup?.requiredStarters !== undefined) {
    for (const [teamName, teamLineup] of [
      ["local", fixture.lineups.home],
      ["visitante", fixture.lineups.away],
    ] as const) {
      if (teamLineup.starters.length !== lineup.requiredStarters) {
        warnings.push(`La alineación ${teamName} tiene ${teamLineup.starters.length} titulares; el reglamento requiere ${lineup.requiredStarters}.`);
      }
    }
  }
  if (fixture.lineups && lineup?.maxSubstitutes !== undefined) {
    for (const [teamName, teamLineup] of [
      ["local", fixture.lineups.home],
      ["visitante", fixture.lineups.away],
    ] as const) {
      if (teamLineup.substitutes.length > lineup.maxSubstitutes) {
        warnings.push(`La alineación ${teamName} supera el máximo de ${lineup.maxSubstitutes} suplentes convocados.`);
      }
    }
  }
  const substitutionRules = regulations.substitutions;
  const substitutions = fixture.substitutions ?? [];
  if (substitutionRules?.maxCount !== undefined) {
    for (const teamId of [fixture.homeTeamId, fixture.awayTeamId]) {
      const teamSubstitutionCount = substitutions.filter(({ teamId: id }) => id === teamId).length;
      if (teamSubstitutionCount > substitutionRules.maxCount) {
        warnings.push(`${teamId} tiene ${teamSubstitutionCount} sustituciones; el máximo configurado por equipo es ${substitutionRules.maxCount}.`);
      }
    }
  }
  if (substitutionRules?.maxWindows !== undefined) {
    for (const teamId of [fixture.homeTeamId, fixture.awayTeamId]) {
      const teamSubs = substitutions.filter(({ teamId: id }) => id === teamId);
      const windows = new Set(teamSubs.map(({ window }) => window).filter(
        (window): window is number => window !== undefined,
      ));
      if (teamSubs.some(({ window }) => window === undefined)) {
        warnings.push(`No se puede validar el límite de ventanas para ${teamId}: faltan ventanas en algunos cambios.`);
      } else if (windows.size > substitutionRules.maxWindows) {
        warnings.push(`${teamId} supera el máximo de ${substitutionRules.maxWindows} ventanas de sustitución.`);
      }
    }
  }
  const timing = regulations.timing;
  if (fixture.result?.extraTime && timing?.extraTimeAllowed === false) {
    warnings.push("El resultado registra prórroga, aunque el reglamento configurado no la permite.");
  }
  if ((fixture.result?.penalties || fixture.knockoutResolution === "penalties"
    || fixture.knockoutResolution === "extra-time-then-penalties")
    && timing?.penaltyShootoutAllowed === false) {
    warnings.push("El partido registra una definición por penales, aunque el reglamento configurado no la permite.");
  }
  if (fixture.result?.extraTime && timing?.extraTimeAllowed === true
    && timing.extraTimeMinutes === undefined) {
    warnings.push("Hay prórroga, pero su duración no está configurada.");
  }
  for (const event of fixture.events ?? []) {
    if (event.period === "extra-time" && timing?.extraTimeAllowed === false) {
      warnings.push("Hay eventos de prórroga, aunque el reglamento configurado no la permite.");
      break;
    }
    if (event.period === "penalties" && timing?.penaltyShootoutAllowed === false) {
      warnings.push("Hay eventos de penales, aunque el reglamento configurado no los permite.");
      break;
    }
    const maximumMinute = event.period === "extra-time"
      ? (timing?.regulationMinutes ?? 90) + (timing?.extraTimeMinutes ?? 30)
      : event.period === "regulation" ? timing?.regulationMinutes : undefined;
    if (event.minute !== undefined && maximumMinute !== undefined && event.minute > maximumMinute) {
      warnings.push(`El minuto ${event.minute} de un evento supera la duración configurada para su período.`);
    }
  }
  if (regulations.eligibility?.minimumAge !== undefined
    || regulations.eligibility?.maximumAge !== undefined) {
    warnings.push("No se puede verificar la edad de elegibilidad: el partido no tiene una fecha de disputa registrada.");
  }
  const cards = regulations.cards;
  const hasCardEvents = tournament.matchdays.some(({ fixtures }) => fixtures.some((match) =>
    (match.events ?? []).some((event) => isValidCardEventReference(tournament, match, event))));
  if ((cards?.yellowCardsForSuspension !== undefined
    || cards?.redCardSuspensionMatches !== undefined) && !hasCardEvents) {
    warnings.push("No hay eventos de tarjetas válidos registrados; no se pueden verificar suspensiones.");
  }
  if (cards?.yellowCardsForSuspension !== undefined) {
    const yellowCounts = new Map<string, number>();
    const currentMatchdayIndex = tournament.matchdays.findIndex(({ fixtures }) =>
      fixtures.some(({ id }) => id === fixture.id));
    for (const matchday of tournament.matchdays.slice(0, Math.max(0, currentMatchdayIndex))) {
      for (const match of matchday.fixtures) {
        if (!match.result || !isValidFixtureResult(tournament, matchday, match)) continue;
        const events = match.events ?? [];
        const duplicateEventIds = findDuplicateEventIds(events);
        for (const event of events) {
          if (event.type !== "yellow-card"
            || duplicateEventIds.has(event.id)
            || !isValidCardEventReference(tournament, match, event)) continue;
          yellowCounts.set(event.playerId, (yellowCounts.get(event.playerId) ?? 0) + 1);
        }
      }
    }
    const events = fixture.events ?? [];
    const duplicateEventIds = findDuplicateEventIds(events);
    for (const event of events) {
      if (event.type === "yellow-card"
        && !duplicateEventIds.has(event.id)
        && isValidCardEventReference(tournament, fixture, event)) {
        const total = (yellowCounts.get(event.playerId) ?? 0) + 1;
        if (total >= cards.yellowCardsForSuspension) {
          warnings.push(`El jugador ${event.playerName} alcanza ${total} amarillas; revisar posible suspensión.`);
        }
        yellowCounts.set(event.playerId, total);
      }
      if (event.type === "red-card"
        && !duplicateEventIds.has(event.id)
        && isValidCardEventReference(tournament, fixture, event)
        && cards.redCardSuspensionMatches !== undefined) {
        warnings.push(`Revisar la suspensión de ${event.playerName} por ${cards.redCardSuspensionMatches} partido(s), según la regla configurada.`);
      }
    }
  } else if (cards?.redCardSuspensionMatches !== undefined) {
    const events = fixture.events ?? [];
    const duplicateEventIds = findDuplicateEventIds(events);
    for (const event of events) {
      if (event.type === "red-card"
        && !duplicateEventIds.has(event.id)
        && isValidCardEventReference(tournament, fixture, event)) {
        warnings.push(`Revisar la suspensión de ${event.playerName} por ${cards.redCardSuspensionMatches} partido(s), según la regla configurada.`);
      }
    }
  }
  return [...new Set(warnings)];
}

function isValidCardEventReference(
  tournament: Tournament,
  fixture: Fixture,
  event: MatchEvent,
): event is MatchEvent & { readonly playerId: string } {
  if ((event.type !== "yellow-card" && event.type !== "red-card")
    || !event.playerId
    || !event.id.trim()
    || !event.playerName.trim()
    || (event.teamId !== fixture.homeTeamId && event.teamId !== fixture.awayTeamId)
    || !(tournament.players ?? []).some(({ id }) => id === event.playerId)) {
    return false;
  }
  return (tournament.playerRegistrations ?? []).some((registration) =>
    registration.playerId === event.playerId && registration.teamId === event.teamId);
}

function findDuplicateEventIds(events: readonly MatchEvent[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const event of events) {
    if (seen.has(event.id)) duplicates.add(event.id);
    seen.add(event.id);
  }
  return duplicates;
}

export function createPendingRegulationsForSeason(
  regulations: MatchRegulations,
  season: number,
): MatchRegulations {
  return {
    ...regulations,
    ...(regulations.lineup ? { lineup: { ...regulations.lineup } } : {}),
    ...(regulations.substitutions ? { substitutions: { ...regulations.substitutions } } : {}),
    ...(regulations.timing ? { timing: { ...regulations.timing } } : {}),
    ...(regulations.cards ? { cards: { ...regulations.cards } } : {}),
    ...(regulations.eligibility ? { eligibility: { ...regulations.eligibility } } : {}),
    season,
    verification: "pending",
    notes: regulations.notes
      ? `${regulations.notes} Copiado como borrador pendiente de revisión para la temporada ${season}.`
      : `Copiado como borrador pendiente de revisión para la temporada ${season}.`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isVerificationStatus(value: unknown): boolean {
  return value === "verified" || value === "provisional" || value === "pending";
}

function isOptionalText(value: unknown): boolean {
  return typeof value === "string";
}

function isNonEmptyText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function isOptionalInteger(value: unknown, minimum: number, maximum: number): boolean {
  return value === undefined
    || (Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum);
}

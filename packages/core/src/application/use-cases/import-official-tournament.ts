import { DomainError } from "../../domain/domain-error.js";
import { mergeContinentalPlanHistory } from "../../domain/services/continental-plan";
import { applySourceCorrections, recordSourceRejection, listSourceIncidents } from "../services/source-incidents";
import type {
  MatchResult,
  Tournament,
} from "../../domain/entities/tournament";
import { normalizeTeamName } from "../../domain/services/team-name";
import { isValidMatchResult } from "../../domain/services/match-result-validation";
import { validateTournamentIntegrity } from "../../domain/services/tournament-integrity";
import { advanceTournamentProgress } from "./advance-tournament-progress";
import { applyCompetitionRulesConfiguration } from "../../domain/services/competition-rules";
import { getTournamentCompetitionId } from "../../domain/services/tournament-history";
import { validateFixturePairings } from "../../domain/services/fixture-pairing-validation";
import type {
  OfficialLeagueId,
  OfficialLeagueSource,
  OfficialLeagueSeason,
  OfficialLeagueZone,
  OfficialMatch,
} from "../ports/official-league-source";
import type { TournamentRepository } from "../ports/tournament-repository";
import { createActivityEvent, saveWithActivity } from "../services/activity-log";

import { secondDivisionKind } from "../../domain/services/second-division-rules";

const officialTieBreakers = [
  "goalDifference",
  "goalsFor",
  "wins",
  "headToHead",
] as const;

export type ImportConflictResolution = "copy" | "update-preserving-results" | "replace";

function validateOfficialSeason(season: OfficialLeagueSeason): void {
  if (!season || typeof season !== "object") {
    throw new DomainError("La fuente oficial no devolvió una temporada válida.");
  }
  if (typeof season.id !== "string" || typeof season.name !== "string") {
    throw new DomainError("La fuente oficial no publicó el identificador y nombre del torneo.");
  }
  if (!season.id.trim()) throw new DomainError("La fuente oficial no publicó un identificador de torneo.");
  if (!season.name.trim()) throw new DomainError("La fuente oficial no publicó el nombre del torneo.");
  if (!Number.isSafeInteger(season.season) || season.season < 1) {
    throw new DomainError("La fuente oficial publicó una temporada inválida.");
  }
  const idSeason = /-(19|20)\d{2}$/.exec(season.id)?.[0].slice(1);
  if (idSeason && Number(idSeason) !== season.season) {
    throw new DomainError(
      `La temporada del identificador (${idSeason}) no coincide con la temporada publicada (${season.season}).`,
    );
  }
  if (typeof season.sourceUrl !== "string" || !season.sourceUrl.trim()) {
    throw new DomainError("La fuente oficial no publicó la dirección de origen.");
  }
  if (
    season.coverage !== undefined
    && season.coverage !== "complete"
    && season.coverage !== "partial"
    && season.coverage !== "unknown"
  ) {
    throw new DomainError("La fuente oficial publicó un estado de cobertura inválido.");
  }
  if (season.teams !== undefined && !Array.isArray(season.teams)) {
    throw new DomainError("La fuente oficial publicó una lista de equipos inválida.");
  }
  if (!Array.isArray(season.matchdays) || season.matchdays.length === 0) {
    throw new DomainError(`La temporada oficial "${season.name}" no contiene fechas para importar.`);
  }

  const officialTeamNames = new Set<string>();
  const competitionNumbers = new Set<number>();
  for (const [index, team] of (season.teams ?? []).entries()) {
    if (!team || typeof team.name !== "string" || !team.name.trim()) {
      throw new DomainError(`Equipo oficial ${index + 1}: el nombre no es válido.`);
    }
    const normalizedName = officialTeamKey(team.name, team.externalId);
    if (officialTeamNames.has(normalizedName)) {
      throw new DomainError(`La fuente oficial repitió el equipo "${team.name}".`);
    }
    officialTeamNames.add(normalizedName);
    if (team.competitionNumber !== undefined) {
      if (!Number.isSafeInteger(team.competitionNumber) || team.competitionNumber < 1) {
        throw new DomainError(`Equipo oficial ${team.name}: la numeración de competición no es válida.`);
      }
      if (competitionNumbers.has(team.competitionNumber)) {
        throw new DomainError(`La fuente oficial repitió la numeración ${team.competitionNumber}.`);
      }
      competitionNumbers.add(team.competitionNumber);
    }
    if (team.groupName !== undefined
      && (typeof team.groupName !== "string" || !team.groupName.trim())) {
      throw new DomainError(`Equipo oficial ${team.name}: el grupo no es válido.`);
    }
  }
  if (season.id === "anfp-copa-de-la-liga-2026") {
    if ((season.teams ?? []).length !== 16
      || competitionNumbers.size !== 16
      || [...competitionNumbers].some((number) => number > 16)) {
      throw new DomainError(
        "La Copa de la Liga 2026 debe conservar los números oficiales únicos del 1 al 16.",
      );
    }
  }

  const matchIds = new Set<string>();
  const matchdayKeys = new Set<string>();
  for (const [matchdayIndex, matchday] of season.matchdays.entries()) {
    if (!matchday || !Array.isArray(matchday.matches)) {
      throw new DomainError(`Fecha ${matchdayIndex + 1}: el formato publicado no es válido.`);
    }
    const path = `Fecha ${matchday.number || matchdayIndex + 1}`;
    if (!Number.isSafeInteger(matchday.number) || matchday.number < 1) {
      throw new DomainError(`${path}: la fuente oficial publicó un número de fecha inválido.`);
    }
    if (matchday.phaseName !== undefined && !matchday.phaseName.trim()) {
      throw new DomainError(`${path}: la fuente oficial publicó un nombre de fase vacío.`);
    }
    if (matchday.matches.length === 0) {
      throw new DomainError(`${path}: la fuente oficial no publicó partidos.`);
    }
    const matchdayKey = `${matchday.phaseName ?? ""}|${matchday.number}`;
    if (matchdayKeys.has(matchdayKey)) {
      throw new DomainError(`${path}: la jornada/ronda está duplicada en la misma fase.`);
    }
    matchdayKeys.add(matchdayKey);
    const scheduledTeams = new Set<string>();
    const matchPairs = new Set<string>();
    for (const match of matchday.matches) {
      if (!match || typeof match.id !== "string" || !match.id.trim()) {
        throw new DomainError(`${path}: la fuente oficial publicó un partido sin identificador.`);
      }
      if (matchIds.has(match.id)) {
        throw new DomainError(`${path}: la fuente oficial repitió el identificador del partido ${match.id}.`);
      }
      matchIds.add(match.id);

      if (typeof match.homeTeamName !== "string" || typeof match.awayTeamName !== "string") {
        throw new DomainError(`El partido oficial ${match.id} no publicó ambos equipos.`);
      }
      const homeName = officialTeamKey(match.homeTeamName, match.homeTeamExternalId);
      const awayName = officialTeamKey(match.awayTeamName, match.awayTeamExternalId);
      if (!homeName) throw new DomainError(`El partido oficial ${match.id} no tiene equipo local.`);
      if (!awayName) throw new DomainError(`El partido oficial ${match.id} no tiene equipo visitante.`);
      if (homeName === awayName) {
        throw new DomainError(`El partido oficial ${match.id} enfrenta a un equipo consigo mismo.`);
      }
      if (scheduledTeams.has(homeName) || scheduledTeams.has(awayName)) {
        throw new DomainError(`${path}: un equipo aparece en más de un partido.`);
      }
      scheduledTeams.add(homeName);
      scheduledTeams.add(awayName);
      const pair = [homeName, awayName].sort().join("|");
      if (matchPairs.has(pair)) {
        throw new DomainError(`${path}: el cruce entre ${match.homeTeamName} y ${match.awayTeamName} está duplicado.`);
      }
      matchPairs.add(pair);

      if ((match.homeGoals === undefined) !== (match.awayGoals === undefined)) {
        throw new DomainError(`El marcador oficial del partido ${match.id} está incompleto.`);
      }
      if (
        match.homeGoals === undefined
        && (match.extraTime !== undefined || match.penalties !== undefined)
      ) {
        throw new DomainError(`El partido oficial ${match.id} contiene definición sin marcador principal.`);
      }
      if (match.homeGoals !== undefined && match.awayGoals !== undefined) {
        const result = {
          homeGoals: match.homeGoals,
          awayGoals: match.awayGoals,
          ...(match.extraTime ? { extraTime: match.extraTime } : {}),
          ...(match.penalties ? { penalties: match.penalties } : {}),
        };
        if (!isValidMatchResult(result)) {
          throw new DomainError(`El partido oficial ${match.id} contiene un marcador fuera del rango permitido (0 a 99).`);
        }
      }
      if (
        match.knockoutResolution !== undefined
        && match.knockoutResolution !== "penalties"
        && match.knockoutResolution !== "extra-time-then-penalties"
        && match.knockoutResolution !== "aggregate-then-penalties"
      ) {
        throw new DomainError(`El partido oficial ${match.id} contiene una regla de desempate desconocida.`);
      }
      if (
        (match.homeGroupName !== undefined && !match.homeGroupName.trim())
        || (match.awayGroupName !== undefined && !match.awayGroupName.trim())
      ) {
        throw new DomainError(`El partido oficial ${match.id} contiene un grupo vacío.`);
      }
    }
  }

  const pairingsMatchdays = season.matchdays.map((matchday) => ({
    number: matchday.number,
    phaseName: matchday.phaseName,
    fixtures: matchday.matches.map((match: OfficialMatch) => ({
      id: match.id,
      homeTeamId: officialTeamKey(match.homeTeamName, match.homeTeamExternalId),
      awayTeamId: officialTeamKey(match.awayTeamName, match.awayTeamExternalId),
      homeTeamName: match.homeTeamName,
      awayTeamName: match.awayTeamName,
    })),
  }));
  const teamCount = new Set([
    ...(season.teams ?? []).map((team) => officialTeamKey(team.name, team.externalId)),
    ...season.matchdays.flatMap((matchday) => matchday.matches.flatMap((match: OfficialMatch) => [
      officialTeamKey(match.homeTeamName, match.homeTeamExternalId),
      officialTeamKey(match.awayTeamName, match.awayTeamExternalId),
    ])),
  ]).size;
  const roundsPerLeg = teamCount % 2 === 0 ? teamCount - 1 : teamCount;
  const roundRobinLegs = season.format !== "staged"
    && season.matchdays.some((matchday) => matchday.number > roundsPerLeg)
    ? 2
    : 1;
  const regularArgentinaPhases = season.id === "arg-liga-profesional-2026"
    ? season.matchdays
      .map(({ phaseName }) => phaseName)
      .filter((phaseName): phaseName is string =>
        Boolean(phaseName && /^torneo (apertura|clausura) · fase regular$/i.test(phaseName)),
      )
    : [];
  const pairingIssues = validateFixturePairings(pairingsMatchdays, {
    format: season.format,
    legs: season.format !== "staged" ? roundRobinLegs : undefined,
    knockoutStages: season.knockoutStages,
    singleMeetingPhaseNames: regularArgentinaPhases,
  });
  if (pairingIssues.length > 0) {
    throw new DomainError(`La fuente oficial publicó un calendario inválido: ${pairingIssues[0]}`);
  }
}

function createTeamId(teamName: string): string {
  const slug = normalizeTeamName(teamName)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) {
    throw new DomainError("No se pudo generar un identificador para un equipo oficial.");
  }
  return `official-${slug}`;
}

function officialTeamKey(name: string, externalId?: string): string {
  return externalId ? `external:${externalId}` : normalizeTeamName(name);
}

export async function importOfficialTournament(
  source: OfficialLeagueSource,
  repository: TournamentRepository,
  now: () => Date = () => new Date(),
  league: OfficialLeagueId = "primera",
  zone?: OfficialLeagueZone,
  options: {
    readonly seasonData?: OfficialLeagueSeason;
    readonly conflictResolution?: ImportConflictResolution;
  } = {},
): Promise<Tournament> {
  const publishedSeason = options.seasonData ?? await source.fetchSeason(league, zone);
  return importOfficialSeason(publishedSeason, repository, now, options, league);
}

// Fetching stays outside the synchronous coordinated sporting command.
export function importOfficialSeason(
  publishedSeason: OfficialLeagueSeason,
  repository: TournamentRepository,
  now: () => Date = () => new Date(),
  options: { readonly conflictResolution?: ImportConflictResolution } = {},
  league: OfficialLeagueId = "primera",
): Tournament {
  let season = publishedSeason;
  try {
    season = applySourceCorrections(repository, publishedSeason);
    validateOfficialSeason(season);
  } catch (error) {
    recordSourceRejection(repository, publishedSeason, error instanceof Error ? error.message : String(error));
    throw error;
  }
  const existing = repository.findAll().find(({ id }) => id === season.id);
  if (existing && !options.conflictResolution) {
    throw new DomainError(
      `La temporada ${season.season} ya existe. Elige crear una copia, actualizar conservando resultados existentes o reemplazar los datos.`,
    );
  }
  const teamNames = new Map<string, string>();
  const externalIdsByKey = new Map<string, string>();
  const teamGroups = new Map<string, string>();
  const teamCompetitionNumbers = new Map<string, number>();

  for (const team of season.teams ?? []) {
    const normalizedName = officialTeamKey(team.name, team.externalId);
    if (!normalizedName) throw new DomainError("La fuente oficial contiene un equipo sin nombre.");
    if (teamNames.has(normalizedName)) {
      throw new DomainError(`La fuente oficial repitió el equipo "${team.name}".`);
    }
    teamNames.set(normalizedName, team.name.trim());
    if (team.externalId) externalIdsByKey.set(normalizedName, team.externalId);
    if (team.competitionNumber !== undefined) {
      teamCompetitionNumbers.set(normalizedName, team.competitionNumber);
    }
    if (team.groupName !== undefined) {
      if (!team.groupName.trim()) {
        throw new DomainError(`La fuente oficial asignó un grupo vacío a ${team.name}.`);
      }
      teamGroups.set(normalizedName, team.groupName.trim());
    }
  }

  for (const matchday of season.matchdays) {
    for (const match of matchday.matches) {
      if (officialTeamKey(match.homeTeamName, match.homeTeamExternalId) === officialTeamKey(match.awayTeamName, match.awayTeamExternalId)) {
        throw new DomainError(`El partido oficial ${match.id} enfrenta a un equipo consigo mismo.`);
      }

      for (const [teamName, externalId] of [[match.homeTeamName, match.homeTeamExternalId], [match.awayTeamName, match.awayTeamExternalId]] as const) {
        const normalizedName = officialTeamKey(teamName, externalId);
        if (!normalizedName) {
          throw new DomainError("La fuente oficial contiene un equipo sin nombre.");
        }
        if (!teamNames.has(normalizedName)) {
          if (season.teams) {
            throw new DomainError(
              `El partido oficial ${match.id} referencia al equipo "${teamName}", que no pertenece a la lista de equipos de la temporada.`,
            );
          }
          teamNames.set(normalizedName, teamName.trim());
          if (externalId) externalIdsByKey.set(normalizedName, externalId);
        }
      }
      for (const [teamName, groupName, externalId] of [
        [match.homeTeamName, match.homeGroupName, match.homeTeamExternalId],
        [match.awayTeamName, match.awayGroupName, match.awayTeamExternalId],
      ] as const) {
        if (!groupName) continue;
        const normalizedName = officialTeamKey(teamName, externalId);
        const previousGroup = teamGroups.get(normalizedName);
        if (previousGroup && previousGroup !== groupName) {
          throw new DomainError(`La fuente oficial asigna a ${teamName} a más de una zona.`);
        }
        teamGroups.set(normalizedName, groupName);
      }
    }
  }

  if (teamNames.size < 2) {
    throw new DomainError("La temporada oficial no contiene suficientes equipos para importar.");
  }

  const teams = [...teamNames.entries()].map(([key, name]) => ({
    ...(existing && options.conflictResolution === "update-preserving-results"
      ? (() => { const externalId = externalIdsByKey.get(key); const previous = existing.teams.find(team => externalId
          ? team.id === `official-cbf-${externalId}` || team.id.endsWith(`-cbf-${externalId}`)
          : team.id === createTeamId(name));
          return previous ? { averageIdentity: previous.averageIdentity, afaAffiliation: previous.afaAffiliation, affiliationSourceUrl: previous.affiliationSourceUrl } : {}; })()
      : {}),
    id: (() => {
      const externalId = externalIdsByKey.get(key);
      const stableId = externalId ? `official-cbf-${externalId}` : createTeamId(name);
      // Keep identities from older imports whose display name carried “(CBF id)”.
      return externalId
        ? existing?.teams.find(team => team.id === stableId || team.id.endsWith(`-cbf-${externalId}`))?.id ?? stableId
        : stableId;
    })(),
    name,
    ...(teamGroups.has(key)
      ? { groupName: teamGroups.get(key) }
      : {}),
    ...(teamCompetitionNumbers.has(key)
      ? { competitionNumber: teamCompetitionNumbers.get(key) }
      : {}),
  }));
  const teamsByIdentity = new Map(
    [...teamNames.keys()].map((key, index) => [key, teams[index]] as const),
  );
  const roundsPerLeg = teams.length % 2 === 0 ? teams.length - 1 : teams.length;
  const normalizedMatchdays = season.matchdays.map((matchday) => {
    const phaseName = matchday.phaseName;
    const stage = season.knockoutStages?.find((candidate) =>
      phaseName?.toLocaleLowerCase("es").startsWith(candidate.name.toLocaleLowerCase("es")),
    );
    if (
      stage?.legs === 2
      && phaseName
      && phaseName.toLocaleLowerCase("es") === stage.name.toLocaleLowerCase("es")
    ) {
      if (matchday.number !== 1 && matchday.number !== 2) {
        throw new DomainError(`La fase oficial ${phaseName} tiene una ida o vuelta inválida.`);
      }
      return {
        ...matchday,
        phaseName: `${stage.name} · ${matchday.number === 1 ? "Ida" : "Vuelta"}`,
      };
    }
    return matchday;
  });
  const phases = [...new Set(normalizedMatchdays.map((matchday) => matchday.phaseName).filter(
    (phaseName): phaseName is string => Boolean(phaseName),
  ))];
  const phaseIndexes = new Map(phases.map((phaseName, index) => [phaseName, index + 1]));
  const timestamp = now().toISOString();
  const matchdays = normalizedMatchdays.map((matchday) => ({
    number: matchday.number,
    leg: matchday.phaseName
      ? phaseIndexes.get(matchday.phaseName) ?? 1
      : Math.floor((matchday.number - 1) / roundsPerLeg) + 1,
    ...(matchday.phaseName ? { phaseName: matchday.phaseName } : {}),
    fixtures: matchday.matches.map((match) => {
      const homeTeam = teamsByIdentity.get(officialTeamKey(match.homeTeamName, match.homeTeamExternalId));
      const awayTeam = teamsByIdentity.get(officialTeamKey(match.awayTeamName, match.awayTeamExternalId));
      if (!homeTeam || !awayTeam) {
        throw new DomainError(`No se pudieron asociar los equipos del partido oficial ${match.id}.`);
      }
      if (homeTeam.id === awayTeam.id) {
        throw new DomainError(`El partido oficial ${match.id} enfrenta a un equipo consigo mismo.`);
      }
      const stage = season.knockoutStages?.find((candidate) =>
        matchday.phaseName?.toLocaleLowerCase("es")
          .startsWith(candidate.name.toLocaleLowerCase("es")),
      );
      const isTwoLegReturn = stage?.legs === 2
        && matchday.phaseName?.toLocaleLowerCase("es").endsWith(" · vuelta");

      const hasHomeGoals = match.homeGoals !== undefined;
      const hasAwayGoals = match.awayGoals !== undefined;
      if (hasHomeGoals !== hasAwayGoals) {
        throw new DomainError(`El marcador oficial del partido ${match.id} está incompleto.`);
      }

      let result: MatchResult | undefined;
      if (match.homeGoals !== undefined && match.awayGoals !== undefined) {
        result = {
          homeGoals: match.homeGoals,
          awayGoals: match.awayGoals,
          ...(match.extraTime ? { extraTime: match.extraTime } : {}),
          ...(match.penalties ? { penalties: match.penalties } : {}),
        };
      }

      return {
        id: `official-${season.season}-${match.id}`,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        calendarProvenance: "official-import" as const,
        ...(match.operationalStatus
          ? { operationalState: { status: match.operationalStatus, updatedAt: timestamp } }
          : {}),
        ...(match.schedule ? { schedule: { ...match.schedule, provenance: "official-import" as const } } : {}),
        ...((match.knockoutResolution
          ?? (stage?.legs === 1
            ? "penalties"
            : isTwoLegReturn ? "aggregate-then-penalties" : undefined))
          ? {
            knockoutResolution: match.knockoutResolution
              ?? (stage?.legs === 1
                ? "penalties"
                : isTwoLegReturn ? "aggregate-then-penalties" : undefined),
          }
          : {}),
        ...(result ? { result } : {}),
      };
    }),
  }));
  const maxLeg = Math.max(...matchdays.map((matchday) => matchday.leg));
  let tournamentId = season.id;
  let tournamentName = `${season.name} ${season.season}`;
  if (existing && options.conflictResolution === "copy") {
    const existingIds = new Set(repository.findAll().map(({ id }) => id));
    const baseId = `${season.id}-copy-${Date.parse(timestamp)}`;
    tournamentId = baseId;
    let suffix = 2;
    while (existingIds.has(tournamentId)) {
      tournamentId = `${baseId}-${suffix}`;
      suffix += 1;
    }
    tournamentName = `${tournamentName} (copia)`;
  }
  const preserving = existing && options.conflictResolution === "update-preserving-results" ? existing : undefined;
  if (preserving) {
    const publishedFixtures = new Map(matchdays.flatMap(day => day.fixtures).map(f => [f.id, f]));
    for (const day of preserving.matchdays) for (const previous of day.fixtures) {
      // Locally generated promotion rounds are retained and reconciled below.
      if (secondDivisionKind(preserving) && day.phaseName !== "Fase regular") continue;
      const candidate = publishedFixtures.get(previous.id);
      const hasLocalData = previous.result || previous.lineups || previous.substitutions || previous.goalScorers
        || previous.events || previous.eventsCoverage || previous.operationalState || previous.schedule;
      if (hasLocalData && (!candidate || candidate.homeTeamId !== previous.homeTeamId || candidate.awayTeamId !== previous.awayTeamId))
        throw new DomainError("La fuente omitió o cambió un partido con datos locales. No se actualizó para conservarlos; revisa la fuente o elige un reemplazo explícito.");
    }
    if (preserving.playerRegistrations?.some(registration => !teams.some(team => team.id === registration.teamId)))
      throw new DomainError("La fuente excluye clubes con inscripciones locales. No se actualizó para conservarlas.");
  }
  const importedMatchdays = matchdays.map((matchday) => ({
    ...matchday,
    fixtures: matchday.fixtures.map((fixture) => {
      if (!existing || options.conflictResolution !== "update-preserving-results") return fixture;
      const previous = existing.matchdays
        .flatMap(({ fixtures }) => fixtures)
        .find((candidate) =>
          candidate.id === fixture.id
          && candidate.homeTeamId === fixture.homeTeamId
          && candidate.awayTeamId === fixture.awayTeamId,
        );
      return previous
        ? {
          ...fixture,
          ...(previous.result ? { result: previous.result } : {}),
          ...(previous.result || (previous.operationalState && ["in-progress", "postponed", "suspended", "cancelled"].includes(previous.operationalState.status))
            ? { operationalState: previous.operationalState ?? { status: "finished" as const, updatedAt: timestamp } } : {}),
          ...(previous.lineups ? { lineups: previous.lineups } : {}),
          ...(previous.substitutions ? { substitutions: previous.substitutions } : {}),
          ...(previous.goalScorers ? { goalScorers: previous.goalScorers } : {}),
          ...(previous.events ? { events: previous.events } : {}),
          ...(previous.eventsCoverage !== undefined
            ? { eventsCoverage: previous.eventsCoverage }
            : {}),
          ...(!fixture.schedule && previous.schedule ? { schedule: previous.schedule } : {}),
        }
        : fixture;
    }),
  }));
  const tournament: Tournament = {
    ...applyCompetitionRulesConfiguration({
    id: season.id,
    competitionId: getTournamentCompetitionId(season.id),
    name: `${season.name} ${season.season}`,
    teams,
    legs: maxLeg,
    tieBreakers: [...officialTieBreakers],
    matchdays: importedMatchdays,
    createdAt: existing && options.conflictResolution !== "copy"
      ? existing.createdAt
      : timestamp,
    season: season.season,
    importCoverage: season.coverage ?? "unknown",
    calendarProvenance: "official-import",
    sourceUrl: season.sourceUrl,
    ...(season.sourceName ? { sourceName: season.sourceName } : {}),
    ...(season.format ? { format: season.format } : {}),
    ...(season.zoneName ? { zoneName: season.zoneName } : {}),
    ...(season.competitionType ? { competitionType: season.competitionType } : {}),
    ...(season.knockoutStages ? { knockoutStages: season.knockoutStages } : {}),
    ...(season.rulesNote && (!season.placementRules || league === "argentina-nacional" || league === "brasil-serie-b")
      ? { rulesNote: season.rulesNote }
      : {}),
    ...(season.placementRules
      ? {
        placementRules: {
          ...season.placementRules,
          ...(season.rulesNote ? { note: season.rulesNote } : {}),
        },
      }
      : {}),
    }),
    ...(preserving ? {
      ...(preserving.players ? { players: preserving.players } : {}),
      ...(preserving.playerRegistrations ? { playerRegistrations: preserving.playerRegistrations } : {}),
      ...(preserving.lineupRules ? { lineupRules: preserving.lineupRules } : {}),
      ...(preserving.matchRegulations ? { matchRegulations: preserving.matchRegulations } : {}),
      ...(preserving.seasonPreparation ? { seasonPreparation: preserving.seasonPreparation } : {}),
      ...(preserving.competitionRules ? { competitionRules: preserving.competitionRules } : {}),
      ...(preserving.pointsSystem ? { pointsSystem: preserving.pointsSystem } : {}),
      tieBreakers: preserving.tieBreakers,
      ...(preserving.archived !== undefined ? { archived: preserving.archived } : {}),
    } : {}),
    id: tournamentId,
    name: tournamentName,
    ...(existing?.nationalCupPlanning && options.conflictResolution !== "copy" ? {nationalCupPlanning:existing.nationalCupPlanning} : {}),
    ...(existing?.continentalPlans && options.conflictResolution !== "copy" ? { continentalPlans: mergeContinentalPlanHistory(existing.continentalPlans,undefined) } : {}),
    ...(existing?.officialResolutions && options.conflictResolution !== "copy" ? { officialResolutions: existing.officialResolutions.map(record =>
      record.participantIds.some(id => !teams.some(team => team.id === id)) && !record.invalidation
        ? { ...record, invalidation: { at: timestamp, reason: "La fuente cambió los participantes de la competición; se conserva el antecedente oficial." } } : record) } : {}),
  };

  if (tournament.competitionRules && tournament.competitionRules.season !== season.season) {
    throw new DomainError(
      `No se pudo importar "${tournament.name}": las reglas configuradas para ${tournament.competitionRules.season} no corresponden a la temporada ${season.season}.`,
    );
  }
  const integrityIssues = validateTournamentIntegrity(tournament);
  if (integrityIssues.length > 0) {
    const reason = `No se pudo importar "${tournament.name}": ${integrityIssues[0]}`;
    recordSourceRejection(repository, publishedSeason, reason);
    throw new DomainError(reason);
  }
  const retainedPlayoffs = existing && options.conflictResolution === "update-preserving-results"
    && secondDivisionKind(tournament)
    ? existing.matchdays.filter(day => day.phaseName !== "Fase regular") : [];
  const importedTournament = advanceTournamentProgress(retainedPlayoffs.length
    ? { ...tournament, legs: Math.max(tournament.legs, existing!.legs), matchdays: [...tournament.matchdays, ...retainedPlayoffs] }
    : tournament);
  const progressedIssues = validateTournamentIntegrity(importedTournament);
  if (progressedIssues.length > 0) {
    const reason = `No se pudo importar "${tournament.name}": ${progressedIssues[0]}`;
    recordSourceRejection(repository, publishedSeason, reason);
    throw new DomainError(reason);
  }
  saveWithActivity(repository, importedTournament, createActivityEvent(importedTournament, {
    action: "tournament-imported",
    entityType: "tournament",
    summary: `Se importó la competición "${importedTournament.name}" desde ${season.sourceName ?? "el proveedor consultado"}.`,
    after: { source: season.sourceName ?? "external-provider", sourceUrl: season.sourceUrl, season: importedTournament.season ?? null,
      ...(season !== publishedSeason ? { sourceIncidentRevisions: listSourceIncidents(repository)
        .filter(i => i.status === "verified" && i.competitionId === season.id && i.season === season.season)
        .map(i => ({ id: i.id, revision: i.revision })) } : {}) },
  }));
  return importedTournament;
}

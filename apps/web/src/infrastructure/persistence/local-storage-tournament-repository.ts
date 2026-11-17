import type { LibraryWriteLease } from "@cancha/core/application/ports/library-write-lease";
import { assertLibraryWriteLease, libraryStorageSnapshot, sportingStorageKeys, withLibraryWriteLock } from "./library-write-lock";
import { isOfficialResolution } from "@cancha/core/domain/services/official-resolution-validation";
import type {
  MatchResult,
  Tournament,
  TournamentPlacementRules,
} from "@cancha/core/domain/entities/tournament";
import { isActivityEvent, type ActivityEvent } from "@cancha/core/domain/entities/activity-event";
import { createActivityEvent } from "@cancha/core/application/services/activity-log";
import type { TournamentLibraryRepository } from "@cancha/core/application/ports/tournament-repository";
import type { Fixture, Matchday } from "@cancha/core/domain/entities/tournament";
import { tieBreakerOptions } from "@cancha/core/domain/value-objects/tie-breaker";
import {
  isValidKnockoutResult,
  isValidMatchResult,
} from "@cancha/core/domain/services/match-result-validation";
import { getArgentina2026TeamGroup } from "@cancha/core/domain/services/argentina-2026-team-groups";
import { advanceOfficialCupProgression } from "@cancha/core/domain/services/official-cup-progression";
import { validateTournamentIntegrity } from "@cancha/core/domain/services/tournament-integrity";
import { isValidGoalScorer } from "@cancha/core/domain/services/goal-scorers";
import { validateTournamentPlayerData } from "@cancha/core/domain/services/player-roster";
import { validateFixtureDetails } from "@cancha/core/domain/services/match-details";
import { applyCompetitionRulesConfiguration } from "@cancha/core/domain/services/competition-rules";
import { validateMatchRegulations, validateTournamentMatchRegulations } from "@cancha/core/domain/services/match-regulations";
import type { SportsUniverseLibrary } from "@cancha/core/domain/entities/sports-universe";
import {
  emptySportsUniverseLibrary,
  mergeSportsUniverseLibraries,
  tournamentsInUniverse,
  validateSportsUniverseLibrary,
  validateSportsUniverseRelations,
} from "@cancha/core/application/services/sports-universes";

const storageKey = "cancha.tournaments";
const activityStorageKey = "cancha.activity";
const recoveryStorageKey = "cancha.recovery";
const activeTournamentKey = "cancha.activeTournamentId";
const sportsUniversesStorageKey = "cancha.sportsUniverses";
const corruptedTournamentWarning = "Se omitió un campeonato guardado por contener datos inválidos.";
const officialPlacementRules: Readonly<Record<string, TournamentPlacementRules>> = {
  "arg-liga-profesional-2026": {
    championPlaces: 1,
    libertadoresPlaces: { from: 2, to: 2 },
    libertadoresQualifyingPlaces: { from: 3, to: 3 },
    sudamericanaPlaces: { from: 4, to: 9 },
    relegationPlaces: 1,
    note: "Descienden el último por promedios de las últimas tres temporadas y el último de la tabla anual. Si es el mismo club, también desciende el penúltimo anual. Esta tabla no calcula promedios. Las plazas internacionales mostradas son las posiciones base de la tabla anual; pueden correrse por campeones de Apertura, Clausura o Copa Argentina y la app aún no calcula esos corrimientos.",
  },
  "anfp-liga-primera-2026": {
    championPlaces: 1,
    relegationPlaces: 2,
  },
  "anfp-liga-de-ascenso-2026": {
    championPlaces: 1,
    playoffPlaces: { from: 2, to: 8 },
    relegationPlaces: 1,
  },
  "anfp-liga-segunda-ascenso-2026": {
    championPlaces: 1,
  },
  "anfp-liga-segunda-descenso-2026": {
    relegationPlaces: 2,
  },
  "anfa-tercera-a-2026": {
    championPlaces: 1,
    playoffPlaces: { from: 2, to: 5 },
    relegationPlayoffPlaces: { from: 11, to: 12 },
    relegationPlaces: 2,
  },
  "anfa-tercera-b-norte-2026": {
    championPlaces: 1,
    playoffPlaces: { from: 2, to: 3 },
    relegationPlaces: 2,
  },
  "anfa-tercera-b-sur-2026": {
    championPlaces: 1,
    playoffPlaces: { from: 2, to: 3 },
    relegationPlaces: 2,
  },
};

const officialSourceNames: Readonly<Record<string, string>> = {
  "anfp-liga-primera-2026": "Campeonato Chileno",
  "anfp-liga-de-ascenso-2026": "Campeonato Chileno",
  "anfp-liga-segunda-ascenso-2026": "Campeonato Chileno",
  "anfp-liga-segunda-descenso-2026": "Campeonato Chileno",
  "anfa-tercera-a-2026": "ANFA Tercera División",
  "anfa-tercera-b-norte-2026": "ANFA Tercera División",
  "anfa-tercera-b-sur-2026": "ANFA Tercera División",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findDuplicateTournamentIds(tournaments: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const tournament of tournaments) {
    if (!isRecord(tournament) || typeof tournament.id !== "string") continue;
    if (seen.has(tournament.id)) duplicates.add(tournament.id);
    else seen.add(tournament.id);
  }
  return [...duplicates];
}

function isQuotaExceeded(error: unknown): boolean {
  return typeof DOMException !== "undefined" && error instanceof DOMException
    ? error.name === "QuotaExceededError"
    : isRecord(error) && (
      error.name === "QuotaExceededError"
      || error.name === "NS_ERROR_DOM_QUOTA_REACHED"
      || error.code === 22
      || error.code === 1014
    );
}

function isStoredScore(value: unknown): value is { homeGoals: number; awayGoals: number } {
  return isRecord(value)
    && typeof value.homeGoals === "number"
    && typeof value.awayGoals === "number";
}

function isStoredResult(value: unknown, resolution: unknown): boolean {
  if (!isRecord(value)
    || typeof value.homeGoals !== "number"
    || typeof value.awayGoals !== "number") {
    return false;
  }
  let result: MatchResult = {
    homeGoals: value.homeGoals,
    awayGoals: value.awayGoals,
  };
  if (
    (value.extraTime !== undefined && !isStoredScore(value.extraTime))
    || (value.penalties !== undefined && !isStoredScore(value.penalties))
  ) {
    return false;
  }
  if (value.extraTime) result = { ...result, extraTime: value.extraTime };
  if (value.penalties) result = { ...result, penalties: value.penalties };
  const checkedResolution = resolution === "penalties" || resolution === "extra-time-then-penalties"
    || resolution === "aggregate-then-penalties" ? resolution : undefined;
  if (checkedResolution === "aggregate-then-penalties") {
    return isValidMatchResult(result)
      && result.extraTime === undefined
      && (result.penalties === undefined
        || result.penalties.homeGoals !== result.penalties.awayGoals);
  }
  return isValidKnockoutResult(
    result,
    checkedResolution,
  ) || (
    checkedResolution === "extra-time-then-penalties"
    && result.homeGoals === result.awayGoals
    && result.extraTime === undefined
    && result.penalties !== undefined
    && isValidKnockoutResult(result, "penalties")
  );
}

function isRulesVerificationStatus(value: unknown): boolean {
  return value === "verified" || value === "provisional" || value === "pending";
}

function isValidPointsSystem(value: unknown): boolean {
  return isRecord(value)
    && [value.win, value.draw, value.loss].every((points) =>
      typeof points === "number" && Number.isSafeInteger(points) && points >= 0,
    );
}

function isCompetitionRulesConfiguration(value: unknown): boolean {
  return isRecord(value)
    && Number.isSafeInteger(value.season)
    && (value.points === undefined || isValidPointsSystem(value.points))
    && (value.tieBreakers === undefined
      || (Array.isArray(value.tieBreakers)
        && value.tieBreakers.every((tieBreaker) =>
          tieBreakerOptions.some((option) => option.value === tieBreaker),
        )))
    && isRecord(value.verification)
    && isRulesVerificationStatus(value.verification.standings)
    && isRulesVerificationStatus(value.verification.placements)
    && (value.internationalQualification === undefined
      || (isRecord(value.internationalQualification)
        && isRulesVerificationStatus(value.internationalQualification.verification)
        && Array.isArray(value.internationalQualification.slots)
        && value.internationalQualification.slots.every((slot) =>
          isRecord(slot)
          && typeof slot.destination === "string"
          && Number.isSafeInteger(slot.position)
          && Number(slot.position) > 0,
        )
        && (value.internationalQualification.reallocation === undefined
          || value.internationalQualification.reallocation === "none"
          || value.internationalQualification.reallocation === "next-eligible-position")
        && (value.internationalQualification.cupChampions === undefined
          || (Array.isArray(value.internationalQualification.cupChampions)
            && value.internationalQualification.cupChampions.every((champion) =>
              isRecord(champion)
              && typeof champion.sourceTournamentId === "string"
              && typeof champion.destination === "string",
            )))))
    && (value.relegationAverage === undefined
      || (isRecord(value.relegationAverage)
        && isRulesVerificationStatus(value.relegationAverage.verification)
        && Array.isArray(value.relegationAverage.seasons)
        && value.relegationAverage.seasons.length > 0
        && value.relegationAverage.seasons.every((season) =>
          Number.isSafeInteger(season),
        )
        && Number.isSafeInteger(value.relegationAverage.relegatedCount)
        && Number(value.relegationAverage.relegatedCount) >= 0
        && (value.relegationAverage.tieBreakers === undefined
          || (Array.isArray(value.relegationAverage.tieBreakers)
            && value.relegationAverage.tieBreakers.every((tieBreaker) =>
              tieBreakerOptions.some((option) => option.value === tieBreaker),
            )))))
    && (value.sourceUrls === undefined
      || (Array.isArray(value.sourceUrls)
        && value.sourceUrls.every((url) => typeof url === "string")))
    && (value.standingsNote === undefined || typeof value.standingsNote === "string")
    && (value.placementsNote === undefined || typeof value.placementsNote === "string")
    && (value.conditionalPlacements === undefined
      || (Array.isArray(value.conditionalPlacements)
        && value.conditionalPlacements.every((condition) =>
          isRecord(condition)
          && isRulesVerificationStatus(condition.status)
          && typeof condition.description === "string"
          && (condition.sourceUrl === undefined || typeof condition.sourceUrl === "string"),
        )));
}

function isPlacementRules(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const validCount = (count: unknown) =>
    count === undefined
    || (typeof count === "number" && Number.isSafeInteger(count) && count >= 0);
  const validPositionRange = (range: unknown) =>
    range === undefined
    || (isRecord(range)
      && typeof range.from === "number"
      && typeof range.to === "number"
      && Number.isSafeInteger(range.from)
      && Number.isSafeInteger(range.to)
      && range.from >= 1
      && range.to >= range.from);
  return validCount(value.championPlaces)
    && validCount(value.relegationPlaces)
    && (value.note === undefined || typeof value.note === "string")
    && validPositionRange(value.libertadoresPlaces)
    && validPositionRange(value.libertadoresQualifyingPlaces)
    && validPositionRange(value.sudamericanaPlaces)
    && validPositionRange(value.playoffPlaces)
    && validPositionRange(value.relegationPlayoffPlaces);
}

function isKnockoutResolution(value: unknown): boolean {
  return value === undefined
    || value === "penalties"
    || value === "extra-time-then-penalties"
    || value === "aggregate-then-penalties";
}

function isStoredLineup(value: unknown): boolean {
  return isRecord(value)
    && Array.isArray(value.starters)
    && value.starters.every((playerId) => typeof playerId === "string" && playerId.trim() !== "")
    && Array.isArray(value.substitutes)
    && value.substitutes.every((playerId) => typeof playerId === "string" && playerId.trim() !== "")
    && (value.captainPlayerId === undefined
      || (typeof value.captainPlayerId === "string" && value.captainPlayerId.trim() !== ""))
    && (value.formation === undefined || typeof value.formation === "string")
    && (value.status === "incomplete" || value.status === "complete");
}

function isStoredMatchDetails(value: Record<string, unknown>): boolean {
  return (value.lineups === undefined
      || (isRecord(value.lineups)
        && isStoredLineup(value.lineups.home)
        && isStoredLineup(value.lineups.away)))
    && (value.substitutions === undefined
      || (Array.isArray(value.substitutions) && value.substitutions.every((substitution) =>
        isRecord(substitution)
        && typeof substitution.id === "string" && substitution.id.trim() !== ""
        && typeof substitution.teamId === "string" && substitution.teamId.trim() !== ""
        && typeof substitution.playerOutId === "string" && substitution.playerOutId.trim() !== ""
        && typeof substitution.playerInId === "string" && substitution.playerInId.trim() !== ""
        && (substitution.window === undefined
          || (Number.isSafeInteger(substitution.window)
            && Number(substitution.window) >= 1 && Number(substitution.window) <= 30))
        && (substitution.minute === undefined
          || (Number.isSafeInteger(substitution.minute)
            && Number(substitution.minute) >= 1 && Number(substitution.minute) <= 180)))))
    && (value.events === undefined
      || (Array.isArray(value.events) && value.events.every((event) =>
        isRecord(event)
        && typeof event.id === "string" && event.id.trim() !== ""
        && (event.type === "goal" || event.type === "own-goal"
          || event.type === "yellow-card" || event.type === "red-card")
        && typeof event.teamId === "string" && event.teamId.trim() !== ""
        && typeof event.playerName === "string" && event.playerName.trim() !== ""
        && (event.playerId === undefined
          || (typeof event.playerId === "string" && event.playerId.trim() !== ""))
        && (event.minute === undefined
          || (Number.isSafeInteger(event.minute)
            && Number(event.minute) >= 1 && Number(event.minute) <= 180))
        && (event.period === undefined || event.period === "regulation"
          || event.period === "extra-time" || event.period === "penalties")
        && (event.benefitedTeamId === undefined
          || (typeof event.benefitedTeamId === "string" && event.benefitedTeamId.trim() !== "")))));
}

function isValidStoredFixture(value: unknown): boolean {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || typeof value.homeTeamId !== "string"
    || typeof value.awayTeamId !== "string"
    || !isKnockoutResolution(value.knockoutResolution)) {
    return false;
  }
  return (value.goalScorers === undefined
      || (Array.isArray(value.goalScorers) && value.goalScorers.every(isValidGoalScorer)))
    && isStoredMatchDetails(value)
    && (value.calendarProvenance === undefined
      || value.calendarProvenance === "official-import"
      || value.calendarProvenance === "local-generated"
      || value.calendarProvenance === "manual")
    && (value.eventsCoverage === undefined
      || value.eventsCoverage === "unverified" || value.eventsCoverage === "complete")
    && (value.schedule === undefined || (isRecord(value.schedule)
      && (value.schedule.provenance === undefined
        || value.schedule.provenance === "official-import"
        || value.schedule.provenance === "local-generated"
        || value.schedule.provenance === "manual")))
    && (value.result === undefined || isStoredResult(value.result, value.knockoutResolution));
}

function isTournament(value: unknown): value is Tournament {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.id === "string"
    && typeof value.name === "string"
    && typeof value.createdAt === "string"
    && (value.competitionId === undefined
      || (typeof value.competitionId === "string" && value.competitionId.trim().length > 0))
    && (value.archived === undefined || typeof value.archived === "boolean")
    && (value.season === undefined
      || (Number.isSafeInteger(value.season) && Number(value.season) > 0))
    && (value.importCoverage === undefined
      || value.importCoverage === "complete"
      || value.importCoverage === "partial"
      || value.importCoverage === "unknown")
    && (value.calendarProvenance === undefined
      || value.calendarProvenance === "official-import"
      || value.calendarProvenance === "local-generated"
      || value.calendarProvenance === "manual")
    && (value.sourceUrl === undefined || typeof value.sourceUrl === "string")
    && (value.sourceName === undefined || typeof value.sourceName === "string")
    && (value.format === undefined || value.format === "round-robin" || value.format === "staged")
    && (value.zoneName === undefined || typeof value.zoneName === "string")
    && (value.rulesNote === undefined || typeof value.rulesNote === "string")
    && (value.placementRules === undefined || isPlacementRules(value.placementRules))
    && (value.pointsSystem === undefined || isValidPointsSystem(value.pointsSystem))
    && (value.competitionRules === undefined
      || isCompetitionRulesConfiguration(value.competitionRules))
    && (value.matchRegulations === undefined
      || (validateMatchRegulations(value.matchRegulations) === undefined
        && isRecord(value.matchRegulations)
        && Number(value.matchRegulations.season) === Number(value.season ?? (
          isRecord(value.competitionRules) ? value.competitionRules.season : undefined
        ))))
    && (value.competitionType === undefined
      || value.competitionType === "league"
      || value.competitionType === "cup")
    && (value.knockoutStages === undefined
      || (Array.isArray(value.knockoutStages)
        && value.knockoutStages.every((stage) =>
          isRecord(stage)
          && typeof stage.name === "string"
          && (stage.legs === 1 || stage.legs === 2)
          && (stage.advanceWinners === undefined || typeof stage.advanceWinners === "boolean"),
        )))
    && (value.players === undefined
      || (Array.isArray(value.players) && value.players.every((player) =>
        isRecord(player)
        && typeof player.id === "string" && player.id.trim().length > 0
        && typeof player.firstName === "string" && player.firstName.trim().length > 0
        && typeof player.lastName === "string" && player.lastName.trim().length > 0
        && (player.birthDate === undefined || typeof player.birthDate === "string")
        && (player.nationality === undefined || typeof player.nationality === "string")
        && (player.usualPosition === undefined || typeof player.usualPosition === "string"))))
    && (value.playerRegistrations === undefined
      || (Array.isArray(value.playerRegistrations) && value.playerRegistrations.every((entry) =>
        isRecord(entry)
        && typeof entry.playerId === "string" && entry.playerId.trim().length > 0
        && typeof entry.teamId === "string" && entry.teamId.trim().length > 0
        && (entry.shirtNumber === undefined
          || (Number.isSafeInteger(entry.shirtNumber)
            && Number(entry.shirtNumber) >= 1 && Number(entry.shirtNumber) <= 99))
        && (entry.status === undefined || entry.status === "active" || entry.status === "released"))))
    && (value.lineupRules === undefined
      || (isRecord(value.lineupRules)
        && Number.isSafeInteger(value.lineupRules.startersPerTeam)
        && Number(value.lineupRules.startersPerTeam) >= 1
        && Number(value.lineupRules.startersPerTeam) <= 30))
    && Number.isInteger(value.legs)
    && Array.isArray(value.teams)
    && value.teams.every((team) =>
      isRecord(team)
      && typeof team.id === "string"
      && typeof team.name === "string"
      && (team.afaAffiliation === undefined || team.afaAffiliation === "direct" || team.afaAffiliation === "indirect")
      && (team.affiliationSourceUrl === undefined || typeof team.affiliationSourceUrl === "string")
      && (team.groupName === undefined || typeof team.groupName === "string")
      && (team.averageIdentity === undefined || typeof team.averageIdentity === "string")
      && (team.competitionNumber === undefined
        || (Number.isSafeInteger(team.competitionNumber) && Number(team.competitionNumber) > 0)),
    )
    && Array.isArray(value.tieBreakers)
    && value.tieBreakers.every((tieBreaker) =>
      tieBreakerOptions.some((option) => option.value === tieBreaker),
    )
    && (value.officialResolutions === undefined || (Array.isArray(value.officialResolutions) && value.officialResolutions.every(isOfficialResolution)))
    && Array.isArray(value.matchdays)
    && value.matchdays.every((matchday) =>
      isRecord(matchday)
      && Number.isInteger(matchday.number)
      && Number.isInteger(matchday.leg)
      && (matchday.phaseName === undefined || typeof matchday.phaseName === "string")
      && Array.isArray(matchday.fixtures)
      && matchday.fixtures.every(isValidStoredFixture),
    );
}

function migrateCopaChileKnockoutMatchday(matchday: Matchday): Matchday[] | undefined {
  const phaseName = matchday.phaseName;
  if (
    !phaseName?.startsWith("Copa Chile ·")
    || phaseName.includes("Grupo")
    || / · (Ida|Vuelta|Partido único)$/.test(phaseName)
  ) {
    return undefined;
  }

  const ties = new Map<string, Fixture[]>();
  for (const fixture of matchday.fixtures) {
    const tieKey = [fixture.homeTeamId, fixture.awayTeamId].sort().join("|");
    const fixtures = ties.get(tieKey) ?? [];
    fixtures.push(fixture);
    ties.set(tieKey, fixtures);
  }
  if ([...ties.values()].some((fixtures) => fixtures.length > 2)) {
    return undefined;
  }

  const firstLegFixtures: Fixture[] = [];
  const returnLegFixtures: Fixture[] = [];
  const singleFixtures: Fixture[] = [];
  for (const fixtures of ties.values()) {
    if (fixtures.length === 2) {
      firstLegFixtures.push(fixtures[0]);
      returnLegFixtures.push({
        ...fixtures[1],
        knockoutResolution: "aggregate-then-penalties",
      });
    } else if (fixtures.length === 1) {
      singleFixtures.push(fixtures[0]);
    }
  }

  const migrated: Matchday[] = [];
  if (firstLegFixtures.length > 0) {
    migrated.push(
      { ...matchday, phaseName: `${phaseName} · Ida`, fixtures: firstLegFixtures },
      { ...matchday, phaseName: `${phaseName} · Vuelta`, fixtures: returnLegFixtures },
    );
  }
  if (singleFixtures.length > 0) {
    migrated.push({
      ...matchday,
      phaseName: `${phaseName} · Partido único`,
      fixtures: singleFixtures,
    });
  }
  return migrated.length > 0 ? migrated : undefined;
}

function getLegacyCupStages(tournament: Tournament, matchdays: readonly Matchday[]) {
  if (tournament.id === "anfp-copa-chile-2026") {
    return [
      { name: "Copa Chile · Octavos de final", legs: 2 as const },
      { name: "Copa Chile · Cuartos de final", legs: 2 as const },
      { name: "Copa Chile · Semifinales", legs: 2 as const },
      { name: "Copa Chile · Final", legs: 1 as const },
    ];
  }
  if (tournament.id.startsWith("afa-copa-argentina-")) {
    const stages = [...new Set(matchdays
      .map((matchday) => matchday.phaseName)
      .filter((phaseName): phaseName is string => Boolean(phaseName)))].map((name) => ({
      name,
      legs: 1 as const,
    }));
    if (!stages.some((stage) => stage.name.toLocaleLowerCase("es").endsWith("· final"))) {
      stages.push({ name: "Copa Argentina · Final", legs: 1 });
    }
    return stages;
  }
  if (tournament.id.startsWith("cbf-copa-do-brasil-")) {
    const stageNames = [...new Set(matchdays
      .map((matchday) => matchday.phaseName)
      .filter((phaseName): phaseName is string => Boolean(phaseName)))];
    const stages = stageNames.map((name) => {
      const normalizedName = name.toLocaleLowerCase("pt-BR");
      const legs = /5ª fase|oitavas|quartas|semifinais|· final/.test(normalizedName) ? 2 : 1;
      return { name, legs: legs as 1 | 2 };
    });
    if (!stages.some((stage) => stage.name.toLocaleLowerCase("pt-BR").endsWith("· final"))) {
      stages.push({ name: "Copa do Brasil · Final", legs: 2 });
    }
    return stages;
  }
  return undefined;
}

function migrateInvalidCopaDoBrasilPenaltyResults(value: unknown): unknown {
  if (
    !isRecord(value)
    || typeof value.id !== "string"
    || !value.id.startsWith("cbf-copa-do-brasil-")
    || !Array.isArray(value.matchdays)
  ) {
    return value;
  }

  return {
    ...value,
    matchdays: value.matchdays.map((matchday) => {
      if (!isRecord(matchday) || !Array.isArray(matchday.fixtures)) return matchday;
      return {
        ...matchday,
        fixtures: matchday.fixtures.map((fixture) => {
          if (
            !isRecord(fixture)
            || fixture.knockoutResolution !== "penalties"
            || !isRecord(fixture.result)
            || typeof fixture.result.homeGoals !== "number"
            || typeof fixture.result.awayGoals !== "number"
            || fixture.result.homeGoals === fixture.result.awayGoals
            || fixture.result.penalties === undefined
          ) {
            return fixture;
          }

          const { penalties: _penalties, ...result } = fixture.result;
          return { ...fixture, result };
        }),
      };
    }),
  };
}

function migrateContinentalFirstLegResolutions(value: unknown): unknown {
  if (
    !isRecord(value)
    || (value.id !== "conmebol-libertadores-2026" && value.id !== "conmebol-sudamericana-2026")
    || !Array.isArray(value.matchdays)
  ) {
    return value;
  }

  return {
    ...value,
    matchdays: value.matchdays.map((matchday) => {
      if (
        !isRecord(matchday)
        || typeof matchday.phaseName !== "string"
        || !matchday.phaseName.endsWith(" · Ida")
        || !Array.isArray(matchday.fixtures)
      ) {
        return matchday;
      }
      return {
        ...matchday,
        fixtures: matchday.fixtures.map((fixture) => {
          if (!isRecord(fixture) || fixture.knockoutResolution !== "penalties") {
            return fixture;
          }
          const { knockoutResolution: _knockoutResolution, ...migratedFixture } = fixture;
          return migratedFixture;
        }),
      };
    }),
  };
}

function applyCurrentOfficialPlacementRules(tournament: Tournament): Tournament {
  const placementRules = officialPlacementRules[tournament.id];
  const sourceName = officialSourceNames[tournament.id];
  const teams = tournament.id === "arg-liga-profesional-2026"
    ? tournament.teams.map((team) => ({
      ...team,
      ...(team.groupName ? {} : {
        groupName: getArgentina2026TeamGroup(team.name),
      }),
    }))
    : tournament.teams;
  const matchdays = tournament.id === "arg-liga-profesional-2026"
    ? tournament.matchdays.map((matchday) => ({
      ...matchday,
      fixtures: matchday.fixtures.map((fixture) => {
        const result = fixture.result;
        return fixture.knockoutResolution === "extra-time-then-penalties"
        && result !== undefined
        && result.homeGoals === result.awayGoals
        && result.penalties !== undefined
        && result.extraTime === undefined
          ? { ...fixture, knockoutResolution: "penalties" as const }
          : fixture;
      }),
    }))
    : tournament.id === "anfp-copa-chile-2026"
      ? tournament.matchdays.flatMap((matchday) =>
          migrateCopaChileKnockoutMatchday(matchday) ?? [matchday],
      )
      : tournament.matchdays;
  const phaseIndexes = new Map(
    [...new Set(matchdays.map((matchday) => matchday.phaseName).filter(
      (phaseName): phaseName is string => Boolean(phaseName),
    ))].map((phaseName, index) => [phaseName, index + 1]),
  );
  const indexedMatchdays = tournament.id === "anfp-copa-chile-2026"
    ? matchdays.map((matchday) => ({
      ...matchday,
      ...(matchday.phaseName
      ? { leg: phaseIndexes.get(matchday.phaseName) ?? matchday.leg }
      : {}),
    }))
    : matchdays;
  const legacyCupStages = getLegacyCupStages(tournament, indexedMatchdays);
  const effectiveCupStages = tournament.knockoutStages ?? legacyCupStages;
  const normalizedCupMatchdays = effectiveCupStages
    ? indexedMatchdays.map((matchday) => {
      const phaseName = matchday.phaseName;
      const stage = effectiveCupStages.find((candidate) =>
        phaseName?.toLocaleLowerCase("es").startsWith(candidate.name.toLocaleLowerCase("es")),
      );
      const exactStageName = stage && phaseName
        && phaseName.toLocaleLowerCase("es") === stage.name.toLocaleLowerCase("es");
      const normalizedPhaseName = exactStageName && stage.legs === 2
        ? `${stage.name} · ${matchday.number === 1 ? "Ida" : "Vuelta"}`
        : phaseName;
      const isReturnLeg = stage?.legs === 2
        && normalizedPhaseName?.toLocaleLowerCase("es").endsWith(" · vuelta");
      if (!stage) return matchday;
      return {
        ...matchday,
        ...(normalizedPhaseName ? { phaseName: normalizedPhaseName } : {}),
        fixtures: matchday.fixtures.map((fixture) => ({
          ...fixture,
          ...(!fixture.knockoutResolution
            ? {
              knockoutResolution: stage.legs === 1
                ? "penalties" as const
                : isReturnLeg ? "aggregate-then-penalties" as const : undefined,
            }
            : {}),
        })),
      };
    })
    : indexedMatchdays;
  const preparedTournament: Tournament = {
    ...tournament,
    teams,
    matchdays: normalizedCupMatchdays,
    ...(legacyCupStages
      ? { competitionType: "cup" as const, knockoutStages: effectiveCupStages }
      : {}),
    ...(tournament.id === "anfp-copa-chile-2026"
      ? {
        rulesNote: "Fase de grupos por zonas, octavos, cuartos y semifinales a ida y vuelta; la final se juega a partido único. Los empates en las eliminatorias se definen por penales cuando corresponde.",
      }
      : {}),
    ...(placementRules ? { placementRules } : {}),
    ...(tournament.sourceName || !sourceName ? {} : { sourceName }),
  };
  const configuredTournament = applyCompetitionRulesConfiguration(preparedTournament);
  return configuredTournament.competitionType === "cup"
    ? advanceOfficialCupProgression(configuredTournament)
    : configuredTournament;
}

function getFixtureDetailsIssue(tournament: Tournament): string | undefined {
  for (const matchday of tournament.matchdays) {
    for (const fixture of matchday.fixtures) {
      const issue = validateFixtureDetails(tournament, fixture);
      if (issue) return issue;
    }
  }
  return undefined;
}

function getMatchRegulationsIssue(tournament: Tournament): string | undefined {
  return validateTournamentMatchRegulations(tournament);
}

export class LocalStorageTournamentRepository implements TournamentLibraryRepository {
  private writeLease = false;
  private writeFailure: unknown;
  constructor(private readonly requireWriteCoordination = true) {}

  snapshot(): string { return libraryStorageSnapshot(); }

  async coordinate<T>(expected: string, action: () => T): Promise<T> {
    return withLibraryWriteLock(lease => this.commitUnderLibraryLock(expected, action, lease));
  }

  // Only for callbacks already executing under the shared lock (checkpoint restore).
  commitUnderLibraryLock<T>(expected: string, action: () => T, lease?: LibraryWriteLease): T {
    assertLibraryWriteLease(lease);
    if (this.writeLease) throw new Error("Ya hay una escritura en curso.");
    if (this.snapshot() !== expected) throw new Error("La biblioteca cambió en otra pestaña. Conservamos tus borradores. Actualiza la vista y revisa nuevamente antes de guardar.");
    const previous = sportingStorageKeys.map(key => localStorage.getItem(key));
    const active = localStorage.getItem("cancha.activeTournamentId");
    this.writeLease = true;
    this.writeFailure = undefined;
    try {
      const result = action();
      if (result instanceof Promise) {
        void result.catch(() => {});
        throw new Error("La escritura deportiva debe terminar sincrónicamente dentro del bloqueo.");
      }
      if (this.writeFailure) throw this.writeFailure;
      return result;
    }
    catch (error) {
      try {
        sportingStorageKeys.forEach((key, index) => {
          if (localStorage.getItem(key) !== previous[index]) this.restoreStorageValue(key, previous[index]);
        });
        if (localStorage.getItem("cancha.activeTournamentId") !== active) this.restoreStorageValue("cancha.activeTournamentId", active);
      } catch {
        throw new Error("Falló la escritura y no se pudo recuperar completamente el estado anterior. No continúes editando: descarga los datos y revisa Recuperación local.");
      }
      throw error;
    } finally { this.writeLease = false; }
  }

  private writeError(message: string): Error {
    const error = new Error(message);
    if (this.writeLease) this.writeFailure = error;
    return error;
  }

  private assertWriteLease(): void {
    if (this.requireWriteCoordination && !this.writeLease)
      throw new Error("Esta operación requiere una escritura coordinada. Actualiza la vista y vuelve a intentarlo.");
  }

  importTournaments(
    tournaments: readonly Tournament[],
    mode: "merge" | "replace",
    restoredActivity: readonly ActivityEvent[] = [],
    skipRecoveryCopy = false,
    restoredUniverses?: SportsUniverseLibrary,
  ): { added: number; skipped: number } {
    this.assertWriteLease();
    const incomingIds = new Set<string>();
    for (const tournament of tournaments) {
      if (!isTournament(tournament)) {
        throw new Error("No se importó el respaldo: la estructura de uno de los torneos no es válida.");
      }
      const issues = validateTournamentIntegrity(tournament);
      if (issues.length > 0) {
        throw new Error(`No se importó "${tournament.name || tournament.id}": ${issues[0]}`);
      }
      const playerIssue = validateTournamentPlayerData(tournament);
      if (playerIssue) throw new Error(`No se importó "${tournament.name}": ${playerIssue}`);
      const regulationsIssue = getMatchRegulationsIssue(tournament);
      if (regulationsIssue) throw new Error(`No se importó "${tournament.name}": ${regulationsIssue}`);
      const detailIssue = getFixtureDetailsIssue(tournament);
      if (detailIssue) throw new Error(`No se importó "${tournament.name}": ${detailIssue}`);
      if (incomingIds.has(tournament.id)) {
        throw new Error(`No se importó el respaldo: el identificador "${tournament.id}" está duplicado.`);
      }
      incomingIds.add(tournament.id);
    }
    if (!restoredActivity.every(isActivityEvent)) {
      throw new Error("No se importó el respaldo: el historial contiene eventos inválidos.");
    }

    const previousSerialized = this.readSerializedTournaments();
    const previousSerializedActivity = this.readSerializedActivity();
    const previousSerializedUniverses = this.readSerializedSportsUniverses();
    const previousActiveId = this.getActiveTournamentId();
    const existing: Tournament[] = [];
    const existingIds = new Set<string>();
    if (mode === "merge" && previousSerialized) {
      for (const value of this.parseStoredTournaments(previousSerialized)) {
        const migratedValue = migrateContinentalFirstLegResolutions(
          migrateInvalidCopaDoBrasilPenaltyResults(value),
        );
        if (!isTournament(migratedValue)) {
          throw new Error("No se modificó el almacenamiento: hay un torneo existente con datos dañados.");
        }
        const tournament = applyCurrentOfficialPlacementRules(migratedValue);
        const issues = validateTournamentIntegrity(tournament);
        if (issues.length > 0) {
          throw new Error(`No se modificó el almacenamiento: "${tournament.name}" tiene datos dañados. ${issues[0]}`);
        }
        const playerIssue = validateTournamentPlayerData(tournament);
        if (playerIssue) {
          throw new Error(`No se modificó el almacenamiento: "${tournament.name}" tiene datos dañados. ${playerIssue}`);
        }
        const regulationsIssue = getMatchRegulationsIssue(tournament);
        if (regulationsIssue) {
          throw new Error(`No se modificó el almacenamiento: "${tournament.name}" tiene un reglamento inválido. ${regulationsIssue}`);
        }
        const detailIssue = getFixtureDetailsIssue(tournament);
        if (detailIssue) {
          throw new Error(`No se modificó el almacenamiento: "${tournament.name}" tiene datos dañados. ${detailIssue}`);
        }
        if (existingIds.has(tournament.id)) {
          throw new Error(`No se modificó el almacenamiento: el identificador "${tournament.id}" está repetido.`);
        }
        existingIds.add(tournament.id);
        existing.push(tournament);
      }
    }
    const imported = mode === "replace"
      ? [...tournaments]
      : tournaments.filter(({ id }) => !existingIds.has(id));
    const skipped = mode === "replace" ? 0 : tournaments.length - imported.length;
    const nextTournaments = mode === "replace" ? imported : [...imported, ...existing];
    const resultingTournamentIds = new Set(nextTournaments.map(({ id }) => id));
    const universeCandidate = mode === "replace"
      ? validateSportsUniverseLibrary(
        restoredUniverses ?? emptySportsUniverseLibrary(),
        resultingTournamentIds,
      )
      : mergeSportsUniverseLibraries(
        this.getSportsUniverseLibrary(),
        restoredUniverses,
        new Set(imported.map(({ id }) => id)),
        resultingTournamentIds,
      );
    const existingActivity = mode === "merge" ? this.findActivity() : [];
    const event = {
      id: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      action: "library-restored" as const,
      tournamentId: imported[0]?.id ?? "library",
      ...(imported[0]?.competitionId ? { competitionId: imported[0].competitionId } : {}),
      tournamentName: imported[0]?.name ?? "Biblioteca",
      ...(imported[0]?.season !== undefined ? { season: imported[0].season } : {}),
      entityType: "tournament" as const,
      summary: `Se restauró un respaldo (${mode}) con ${imported.length} competiciones agregadas.`,
      after: { mode, added: imported.length, skipped },
    } satisfies ActivityEvent;
    const nextActivity = [...existingActivity];
    for (const importedEvent of restoredActivity) {
      if (!nextActivity.some(({ id }) => id === importedEvent.id)) {
        nextActivity.push({ ...importedEvent, imported: true });
      }
    }
    if (!nextActivity.some(({ id }) => id === event.id)) nextActivity.push(event);
    const nextUniverses = validateSportsUniverseRelations(
      universeCandidate,
      nextTournaments,
      nextActivity,
    );
    const serializedUniverses = JSON.stringify(nextUniverses);
    const currentActiveId = mode === "merge" ? this.getActiveTournamentId() : null;
    const scopedNextTournaments = tournamentsInUniverse(nextTournaments, nextUniverses);
    const nextActiveId = mode === "merge"
      && currentActiveId
      && scopedNextTournaments.some(({ id }) => id === currentActiveId)
      ? currentActiveId
      : scopedNextTournaments[0]?.id ?? null;
    const previousRecovery = this.readSerializedRecoverySnapshot();
    const recoverySnapshot = mode === "replace" && !skipRecoveryCopy
      ? this.createRecoverySnapshot(
        previousSerialized,
        previousSerializedActivity,
        JSON.stringify(nextTournaments),
        JSON.stringify(nextActivity),
        nextActiveId,
        previousSerializedUniverses,
        serializedUniverses,
      )
      : null;
    try {
      if (recoverySnapshot) this.writeRecoverySnapshot(recoverySnapshot);
      this.writeStoredTournaments(nextTournaments);
      this.setActiveTournamentId(nextActiveId);
      this.writeActivityEvents(nextActivity);
      this.writeStoredSportsUniverses(serializedUniverses);
    } catch (error) {
      this.restoreStorageValue(storageKey, previousSerialized);
      this.restoreStorageValue(activityStorageKey, previousSerializedActivity);
      this.restoreStorageValue(recoveryStorageKey, previousRecovery);
      this.restoreStorageValue(sportsUniversesStorageKey, previousSerializedUniverses);
      this.setActiveTournamentId(previousActiveId);
      throw error;
    }
    return { added: imported.length, skipped };
  }

  hasRecoverableSnapshot(): boolean {
    return this.getRecoverySnapshotStatus().available;
  }

  getRecoverySnapshotStatus(): { available: boolean; warning?: string } {
    try {
      return { available: this.readRecoverySnapshot() !== null };
    } catch (error) {
      return {
        available: false,
        warning: error instanceof Error
          ? error.message
          : "La copia local no se pudo validar y no se ofrece como recuperable.",
      };
    }
  }

  readRawTournamentDataForRecovery(): string {
    const serialized = this.readSerializedTournaments();
    if (serialized === null) {
      throw new Error("No hay contenido original de torneos guardado para exportar.");
    }
    return serialized;
  }

  restoreRecoverySnapshot(): { added: number; skipped: number } {
    this.assertWriteLease();
    const snapshot = this.readRecoverySnapshot();
    if (!snapshot) {
      throw new Error("No hay una copia recuperable vigente para restaurar.");
    }
    const currentTournaments = this.readSerializedTournaments() ?? "[]";
    const currentActivity = this.readSerializedActivity() ?? "[]";
    if (
      currentTournaments !== snapshot.replacedWith.tournaments
      || currentActivity !== snapshot.replacedWith.activity
      || this.getActiveTournamentId() !== snapshot.replacedWith.activeTournamentId
    ) {
      throw new Error(
        "La copia recuperable ya no corresponde al estado actual y no se restauró para evitar perder cambios posteriores.",
      );
    }
    return this.importTournaments(
      snapshot.tournaments,
      "replace",
      snapshot.activity,
      true,
      snapshot.universes,
    );
  }

  save(tournament: Tournament): void {
    this.assertWriteLease();
    const issues = validateTournamentIntegrity(tournament);
    if (issues.length > 0) {
      throw new Error(`No se guardó "${tournament.name || tournament.id}": ${issues[0]}`);
    }
    const playerIssue = validateTournamentPlayerData(tournament);
    if (playerIssue) {
      throw new Error(`No se guardó "${tournament.name || tournament.id}": ${playerIssue}`);
    }
    const regulationsIssue = getMatchRegulationsIssue(tournament);
    if (regulationsIssue) {
      throw new Error(`No se guardó "${tournament.name || tournament.id}": ${regulationsIssue}`);
    }
    const detailIssue = getFixtureDetailsIssue(tournament);
    if (detailIssue) {
      throw new Error(`No se guardó "${tournament.name || tournament.id}": ${detailIssue}`);
    }

    const rawTournaments = this.readStoredTournaments();
    const duplicateIds = findDuplicateTournamentIds(rawTournaments);
    if (duplicateIds.length > 0) {
      throw new Error(
        `No se guardó "${tournament.name || tournament.id}": el almacenamiento contiene identificadores de torneo duplicados (${duplicateIds.map((id) => `"${id}"`).join(", ")}). Restaura una biblioteca válida antes de guardar.`,
      );
    }
    const validTournaments: unknown[] = [];
    for (const value of rawTournaments) {
      const migratedValue = migrateContinentalFirstLegResolutions(
        migrateInvalidCopaDoBrasilPenaltyResults(value),
      );
      if (!isTournament(migratedValue)) {
        const id = isRecord(value) && typeof value.id === "string" ? value.id : "sin identificador";
        const name = isRecord(value) && typeof value.name === "string" ? value.name : id;
        if (id === tournament.id) {
          throw new Error(`No se guardó "${tournament.name}": ya existe un registro dañado con ese identificador.`);
        }
        validTournaments.push(value);
        console.warn(`${corruptedTournamentWarning} "${name}".`);
        continue;
      }
      const tournamentIssues = validateTournamentIntegrity(
        applyCurrentOfficialPlacementRules(migratedValue),
      );
      if (tournamentIssues.length > 0) {
        if (migratedValue.id === tournament.id) {
          throw new Error(`No se guardó "${tournament.name}": ya existe un registro dañado con ese identificador.`);
        }
        const playerIssue = validateTournamentPlayerData(migratedValue);
        if (playerIssue) {
          if (migratedValue.id === tournament.id) {
            throw new Error(`No se guardó "${tournament.name}": el registro existente tiene datos dañados. ${playerIssue}`);
          }
          validTournaments.push(value);
          console.warn(`${corruptedTournamentWarning} "${migratedValue.name}". ${playerIssue}`);
          continue;
        }
        validTournaments.push(value);
        console.warn(
          `${corruptedTournamentWarning} "${migratedValue.name}". ${tournamentIssues[0]}`,
        );
        continue;
      }
      const detailIssue = getFixtureDetailsIssue(migratedValue);
      if (detailIssue) {
        if (migratedValue.id === tournament.id) {
          throw new Error(`No se guardó "${tournament.name}": el registro existente tiene detalles de partidos dañados. ${detailIssue}`);
        }
        validTournaments.push(value);
        console.warn(`${corruptedTournamentWarning} "${migratedValue.name}". ${detailIssue}`);
        continue;
      }
      const regulationsIssue = getMatchRegulationsIssue(migratedValue);
      if (regulationsIssue) {
        if (migratedValue.id === tournament.id) {
          throw new Error(`No se guardó "${tournament.name}": el reglamento existente está dañado. ${regulationsIssue}`);
        }
        validTournaments.push(value);
        console.warn(`${corruptedTournamentWarning} "${migratedValue.name}". ${regulationsIssue}`);
        continue;
      }
      if (migratedValue.id !== tournament.id) validTournaments.push(migratedValue);
    }

    this.writeStoredTournaments([tournament, ...validTournaments]);
  }

  saveWithActivity(tournament: Tournament, event: ActivityEvent): void {
    this.assertWriteLease();
    this.saveManyWithActivity([tournament], event);
  }

  saveManyWithActivity(tournaments: readonly Tournament[], event: ActivityEvent): void {
    this.assertWriteLease();
    if (tournaments.length === 0) {
      throw new Error("No se guardaron los cambios: no hay torneos para actualizar.");
    }
    if (new Set(tournaments.map(({ id }) => id)).size !== tournaments.length) {
      throw new Error("No se guardaron los cambios: la selección contiene torneos duplicados.");
    }
    const previousTournaments = this.readSerializedTournaments();
    const previousActivity = this.readSerializedActivity();
    try {
      for (const tournament of tournaments) this.save(tournament);
      this.writeActivityEvents(this.withUniqueActivityEvent(event));
    } catch (error) {
      this.restoreStorageValue(storageKey, previousTournaments);
      this.restoreStorageValue(activityStorageKey, previousActivity);
      throw error;
    }
  }

  recordActivity(event: ActivityEvent): void {
    this.assertWriteLease();
    this.writeActivityEvents(this.withUniqueActivityEvent(event));
  }

  findActivity(): ActivityEvent[] {
    const serialized = this.readSerializedActivity();
    if (!serialized) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized);
    } catch {
      throw new Error("El historial de actividad está dañado y no se pudo interpretar.");
    }
    if (!Array.isArray(parsed) || !parsed.every(isActivityEvent)) {
      throw new Error("El historial de actividad contiene registros inválidos.");
    }
    return parsed;
  }

  findAll(): Tournament[] {
    return this.findAllWithRecoveryReport().tournaments;
  }

  findAllWithRecoveryReport(): { tournaments: Tournament[]; warnings: string[] } {
    const serialized = this.readSerializedTournaments();
    if (!serialized) return { tournaments: [], warnings: [] };
    const parsed = this.parseStoredTournaments(serialized);
    const valid: Tournament[] = [];
    const warnings: string[] = [];
    let hasInvalidRecords = false;
    const duplicateIds = new Set(findDuplicateTournamentIds(parsed));
    if (duplicateIds.size > 0) {
      hasInvalidRecords = true;
      for (const id of duplicateIds) {
        const warning = `Se omitieron los torneos con el identificador duplicado "${id}". El almacenamiento original se conservó; restaura una biblioteca válida antes de guardar.`;
        warnings.push(warning);
        console.warn(warning);
      }
    }

    for (const value of parsed) {
      const migratedValue = migrateContinentalFirstLegResolutions(
        migrateInvalidCopaDoBrasilPenaltyResults(value),
      );
      if (!isTournament(migratedValue)) {
        hasInvalidRecords = true;
        const id = isRecord(value) && typeof value.id === "string" ? value.id : "sin identificador";
        const name = isRecord(value) && typeof value.name === "string" ? value.name : id;
        const warning = `${corruptedTournamentWarning} "${name}". El formato de los datos no es válido.`;
        warnings.push(warning);
        console.warn(warning);
        continue;
      }
      const tournament = applyCurrentOfficialPlacementRules(migratedValue);
      const issues = validateTournamentIntegrity(tournament);
      if (issues.length > 0) {
        hasInvalidRecords = true;
        const warning = `${corruptedTournamentWarning} "${tournament.name}". ${issues[0]}`;
        warnings.push(warning);
        console.warn(warning);
        continue;
      }
      const playerIssue = validateTournamentPlayerData(tournament);
      if (playerIssue) {
        hasInvalidRecords = true;
        const warning = `${corruptedTournamentWarning} "${tournament.name}". ${playerIssue}`;
        warnings.push(warning);
        console.warn(warning);
        continue;
      }
      const regulationsIssue = getMatchRegulationsIssue(tournament);
      if (regulationsIssue) {
        hasInvalidRecords = true;
        const warning = `${corruptedTournamentWarning} "${tournament.name}". ${regulationsIssue}`;
        warnings.push(warning);
        console.warn(warning);
        continue;
      }
      const detailIssue = getFixtureDetailsIssue(tournament);
      if (detailIssue) {
        hasInvalidRecords = true;
        const warning = `${corruptedTournamentWarning} "${tournament.name}". ${detailIssue}`;
        warnings.push(warning);
        console.warn(warning);
        continue;
      }
      if (duplicateIds.has(tournament.id)) continue;
      valid.push(tournament);
    }

    if (!hasInvalidRecords && JSON.stringify(valid) !== serialized
      && (!this.requireWriteCoordination || this.writeLease)) {
      this.writeStoredTournaments(valid);
    }
    return { tournaments: valid, warnings };
  }

  deleteById(id: string): void {
    this.assertWriteLease();
    const rawTournaments = this.readStoredTournaments();
    const matching = rawTournaments.filter(
      (value) => isRecord(value) && value.id === id,
    );
    if (matching.length === 0) {
      throw new Error("No se encontró el campeonato que quieres eliminar.");
    }
    if (matching.length > 1) {
      throw new Error("No se eliminó el campeonato porque hay varios registros con ese identificador.");
    }
    const value = matching[0];
    const migratedValue = migrateContinentalFirstLegResolutions(
      migrateInvalidCopaDoBrasilPenaltyResults(value),
    );
    if (!isTournament(migratedValue)
      || validateTournamentIntegrity(applyCurrentOfficialPlacementRules(migratedValue)).length > 0
      || validateTournamentPlayerData(migratedValue) !== undefined
      || getMatchRegulationsIssue(migratedValue) !== undefined
      || getFixtureDetailsIssue(migratedValue) !== undefined) {
      throw new Error("No se eliminó el campeonato porque sus datos guardados están dañados.");
    }
    const previousTournaments = this.readSerializedTournaments();
    const previousActivity = this.readSerializedActivity();
    const previousUniverses = this.readSerializedSportsUniverses();
    const library = this.getSportsUniverseLibrary();
    const assignments = { ...library.assignments };
    delete assignments[id];
    const updatedUniverses = { ...library, assignments };
    const event = {
      ...createActivityEvent(migratedValue, {
      action: "tournament-deleted",
      entityType: "tournament",
      summary: `Se eliminó la competición "${migratedValue.name}".`,
      before: { archived: migratedValue.archived ?? false },
      }),
      ...(library.assignments[id] ? { universeId: library.assignments[id] } : {}),
    };
    try {
      this.writeStoredTournaments(rawTournaments.filter((candidate) => candidate !== value));
      this.writeActivityEvents(this.withUniqueActivityEvent(event));
      this.writeStoredSportsUniverses(JSON.stringify(updatedUniverses));
    } catch (error) {
      this.restoreStorageValue(storageKey, previousTournaments);
      this.restoreStorageValue(activityStorageKey, previousActivity);
      this.restoreStorageValue(sportsUniversesStorageKey, previousUniverses);
      throw error;
    }
  }

  getActiveTournamentId(): string | null {
    try {
      return localStorage.getItem(activeTournamentKey) || null;
    } catch {
      throw new Error("No se pudo recuperar el campeonato activo del navegador.");
    }
  }

  setActiveTournamentId(id: string | null): void {
    try {
      localStorage.setItem(activeTournamentKey, id ?? "");
    } catch {
      throw new Error("No se pudo guardar la selección del campeonato activo.");
    }
  }

  getSportsUniverseLibrary(): SportsUniverseLibrary {
    const serialized = this.readSerializedSportsUniverses();
    if (serialized === null) return emptySportsUniverseLibrary();
    let value: unknown;
    try {
      value = JSON.parse(serialized);
    } catch {
      throw new Error("Los universos deportivos guardados están dañados y no se pudieron interpretar.");
    }
    return validateSportsUniverseRelations(
      value,
      this.findAll(),
      this.findActivity(),
    );
  }

  setSportsUniverseLibrary(library: SportsUniverseLibrary): void {
    this.assertWriteLease();
    const previousLibrary = this.getSportsUniverseLibrary();
    const currentTournaments = this.findAll();
    const validated = validateSportsUniverseRelations(
      library,
      currentTournaments,
      this.findActivity(),
    );
    const changedTournamentIds = new Set([
      ...Object.keys(previousLibrary.assignments),
      ...Object.keys(validated.assignments),
    ].filter((id) =>
      (previousLibrary.assignments[id] ?? null) !== (validated.assignments[id] ?? null),
    ));
    const remainingUniverseIds = new Set(validated.universes.map(({ id }) => id));
    const removedUniverseIds = new Set(previousLibrary.universes
      .map(({ id }) => id)
      .filter((id) => !remainingUniverseIds.has(id)));
    if (changedTournamentIds.size === 0 && removedUniverseIds.size === 0) {
      this.writeStoredSportsUniverses(JSON.stringify(validated));
      return;
    }

    const previousActivity = this.readSerializedActivity();
    const previousUniverses = this.readSerializedSportsUniverses();
    const events = this.findActivity();
    if(events.some(event=>(event.action==="association-recorded" || event.action==="club-affiliation-recorded") && isRecord(event.after) && typeof event.after.universeId==="string" && removedUniverseIds.has(event.after.universeId)))throw new Error("No se eliminó el universo: conserva asociaciones o afiliaciones históricas. No se trasladan automáticamente a otra partida.");
    const updatedEvents = events.map((event) => {
      // Metadata retains its declared universe even when a tournament is moved.
      if(event.action==="association-recorded" || event.action==="club-affiliation-recorded")return event;
      const after = event.after;
      const referencedIds = [event.tournamentId];
      if (event.action === "season-created" && isRecord(after)
        && Array.isArray(after.tournamentIds)) {
        referencedIds.push(...after.tournamentIds.filter(
          (id): id is string => typeof id === "string",
        ));
      }
      const affectedId = referencedIds.find((id) => changedTournamentIds.has(id));
      const removesOldUniverse = !!event.universeId && removedUniverseIds.has(event.universeId);
      if (!affectedId && !removesOldUniverse) return event;
      const newUniverseId = affectedId ? validated.assignments[affectedId] : undefined;
      const { universeId: _oldUniverseId, ...unassignedEvent } = event;
      return newUniverseId ? { ...unassignedEvent, universeId: newUniverseId } : unassignedEvent;
    });
    try {
      if (JSON.stringify(updatedEvents) !== JSON.stringify(events)) {
        this.writeActivityEvents(updatedEvents);
      }
      this.writeStoredSportsUniverses(JSON.stringify(validated));
    } catch (error) {
      this.restoreStorageValue(activityStorageKey, previousActivity);
      this.restoreStorageValue(sportsUniversesStorageKey, previousUniverses);
      throw error;
    }
  }

  private createRecoverySnapshot(
    serializedTournaments: string | null,
    serializedActivity: string | null,
    replacementTournaments: string,
    replacementActivity: string,
    replacementActiveTournamentId: string | null,
    serializedUniverses: string | null,
    replacementUniverses: string,
  ): string | null {
    if (!serializedTournaments) return null;

    let tournaments: unknown[];
    let activity: unknown;
    try {
      tournaments = this.parseStoredTournaments(serializedTournaments);
      activity = serializedActivity ? JSON.parse(serializedActivity) : [];
    } catch {
      return null;
    }
    if (!tournaments.every(isTournament) || findDuplicateTournamentIds(tournaments).length > 0
      || !Array.isArray(activity)
      || !activity.every(isActivityEvent)) return null;
    for (const tournament of tournaments) {
      if (
        validateTournamentIntegrity(tournament).length > 0
        || validateTournamentPlayerData(tournament)
        || getMatchRegulationsIssue(tournament)
        || getFixtureDetailsIssue(tournament)
      ) return null;
    }

    return JSON.stringify({
      version: 1,
      createdAt: new Date().toISOString(),
      tournaments,
      activity,
      replacedWith: {
        tournaments: replacementTournaments,
        activity: replacementActivity,
        activeTournamentId: replacementActiveTournamentId,
        universes: replacementUniverses,
      },
      universes: serializedUniverses,
    });
  }

  private readRecoverySnapshot(): {
    readonly tournaments: Tournament[];
    readonly activity: ActivityEvent[];
    readonly universes: SportsUniverseLibrary;
    readonly replacedWith: {
      readonly tournaments: string;
      readonly activity: string;
      readonly activeTournamentId: string | null;
      readonly universes: string | null;
    };
  } | null {
    const serialized = this.readSerializedRecoverySnapshot();
    if (!serialized) return null;
    let value: unknown;
    try {
      value = JSON.parse(serialized);
    } catch {
      throw new Error("La copia de recuperación está dañada y no se pudo interpretar.");
    }
    const replacedWith = isRecord(value) ? value.replacedWith : undefined;
    if (!isRecord(value) || value.version !== 1
      || !Array.isArray(value.tournaments) || !value.tournaments.every(isTournament)
      || !Array.isArray(value.activity) || !value.activity.every(isActivityEvent)
      || !isRecord(replacedWith)
      || typeof replacedWith.tournaments !== "string"
      || typeof replacedWith.activity !== "string"
      || (replacedWith.universes !== undefined
        && replacedWith.universes !== null
        && typeof replacedWith.universes !== "string")
      || (replacedWith.activeTournamentId !== null
        && typeof replacedWith.activeTournamentId !== "string")) {
      throw new Error("La copia de recuperación contiene datos inválidos y no se puede restaurar.");
    }
    const duplicateIds = findDuplicateTournamentIds(value.tournaments);
    if (duplicateIds.length > 0) {
      throw new Error(
        `La copia local no se puede restaurar porque contiene identificadores duplicados: ${duplicateIds.map((id) => `"${id}"`).join(", ")}.`,
      );
    }
    for (const tournament of value.tournaments) {
      if (
        validateTournamentIntegrity(tournament).length > 0
        || validateTournamentPlayerData(tournament)
        || getMatchRegulationsIssue(tournament)
        || getFixtureDetailsIssue(tournament)
      ) {
        throw new Error("La copia de recuperación no superó la validación y no se puede restaurar.");
      }
    }
    const currentTournaments = this.readSerializedTournaments() ?? "[]";
    const currentActivity = this.readSerializedActivity() ?? "[]";
    const expectedTournaments = replacedWith.tournaments;
    const expectedActivity = replacedWith.activity;
    const expectedActiveTournamentId = replacedWith.activeTournamentId;
    const expectedUniverses = typeof replacedWith.universes === "string"
      ? replacedWith.universes
      : null;
    if (currentTournaments !== expectedTournaments
      || currentActivity !== expectedActivity
      || this.getActiveTournamentId() !== expectedActiveTournamentId
      || this.readSerializedSportsUniverses() !== expectedUniverses) return null;
    let universeSnapshot: unknown;
    try {
      universeSnapshot = value.universes === null || value.universes === undefined
        ? emptySportsUniverseLibrary()
        : JSON.parse(String(value.universes));
    } catch {
      throw new Error("La copia de recuperación contiene universos dañados y no se puede restaurar.");
    }
    const universes = validateSportsUniverseLibrary(
      universeSnapshot,
      new Set(value.tournaments.map((tournament) => (tournament as Tournament).id)),
    );
    return {
      tournaments: value.tournaments,
      activity: value.activity,
      universes,
      replacedWith: {
        tournaments: expectedTournaments,
        activity: expectedActivity,
        activeTournamentId: expectedActiveTournamentId,
        universes: expectedUniverses,
      },
    };
  }

  private readStoredTournaments(): unknown[] {
    const serialized = this.readSerializedTournaments();
    return serialized ? this.parseStoredTournaments(serialized) : [];
  }

  private readSerializedTournaments(): string | null {
    try {
      return localStorage.getItem(storageKey);
    } catch {
      throw new Error("No se pudieron leer los campeonatos guardados del navegador.");
    }
  }

  private readSerializedActivity(): string | null {
    try {
      return localStorage.getItem(activityStorageKey);
    } catch {
      throw new Error("No se pudo leer el historial de actividad del navegador.");
    }
  }

  private readSerializedRecoverySnapshot(): string | null {
    try {
      return localStorage.getItem(recoveryStorageKey);
    } catch {
      throw new Error("No se pudo consultar la copia de recuperación del navegador.");
    }
  }

  private readSerializedSportsUniverses(): string | null {
    try {
      return localStorage.getItem(sportsUniversesStorageKey);
    } catch {
      throw new Error("No se pudieron leer los universos deportivos del navegador.");
    }
  }

  private withUniqueActivityEvent(event: ActivityEvent): ActivityEvent[] {
    if (!isActivityEvent(event)) {
      throw new Error("No se pudo guardar un evento de actividad inválido.");
    }
    const events = this.findActivity();
    const universeId = event.universeId
      ?? this.getSportsUniverseLibrary().assignments[event.tournamentId];
    const attributed = universeId ? { ...event, universeId } : event;
    return events.some(({ id }) => id === attributed.id) ? events : [...events, attributed];
  }

  private writeActivityEvents(events: readonly ActivityEvent[]): void {
    this.assertWriteLease();
    try {
      localStorage.setItem(activityStorageKey, JSON.stringify(events));
    } catch (error) {
      if (isQuotaExceeded(error)) {
        throw this.writeError(
          "No se pudo guardar el historial porque el almacenamiento del navegador está lleno. Libera espacio o exporta un respaldo y vuelve a intentarlo.",
        );
      }
      throw this.writeError("No se pudo guardar el historial de actividad en el navegador.");
    }
  }

  private writeRecoverySnapshot(snapshot: string): void {
    this.assertWriteLease();
    try {
      localStorage.setItem(recoveryStorageKey, snapshot);
    } catch (error) {
      if (isQuotaExceeded(error)) {
        throw this.writeError(
          "No hay espacio suficiente para crear una copia de recuperación. No se reemplazó la biblioteca; exporta un respaldo y libera espacio antes de intentarlo.",
        );
      }
      throw this.writeError(
        "No se pudo crear la copia de recuperación antes de reemplazar la biblioteca; no se modificaron los campeonatos.",
      );
    }
  }

  private restoreStorageValue(key: string, value: string | null): void {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      throw new Error("Falló la restauración y no se pudo revertir completamente el almacenamiento local.");
    }
  }

  private parseStoredTournaments(serialized: string): unknown[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized);
    } catch {
      throw new Error("Los datos guardados están dañados y no se pudieron interpretar.");
    }
    if (!Array.isArray(parsed)) {
      throw new Error("Los campeonatos guardados tienen un formato inválido.");
    }
    return parsed;
  }

  private writeStoredTournaments(tournaments: readonly unknown[]): void {
    this.assertWriteLease();
    try {
      localStorage.setItem(storageKey, JSON.stringify(tournaments));
    } catch (error) {
      if (isQuotaExceeded(error)) {
        throw this.writeError(
          "No se pudieron guardar los cambios porque el almacenamiento del navegador está lleno. Libera espacio o exporta un respaldo y vuelve a intentarlo.",
        );
      }
      throw this.writeError("No se pudieron guardar los cambios del campeonato en el navegador.");
    }
  }

  private writeStoredSportsUniverses(serialized: string): void {
    this.assertWriteLease();
    try {
      localStorage.setItem(sportsUniversesStorageKey, serialized);
    } catch (error) {
      if (isQuotaExceeded(error)) {
        throw this.writeError("No se pudieron guardar los universos deportivos porque el almacenamiento está lleno.");
      }
      throw this.writeError("No se pudieron guardar los universos deportivos en el navegador.");
    }
  }

}

import { DomainError } from "../../domain/domain-error.js";
import { isOfficialResolution } from "../../domain/services/official-resolution-validation";
import type {
  CompetitionRulesConfiguration,
  Fixture,
  KnockoutStage,
  Matchday,
  MatchScore,
  MatchResult,
  MatchEvent,
  MatchLineups,
  MatchSubstitution,
  MatchSchedule,
  MatchRegulations,
  MatchOperationalState,
  OperationalMatchStatus,
  Player,
  PlayerRegistration,
  PointsSystem,
  Tournament,
  TournamentPlacementRules,
} from "../../domain/entities/tournament";
import { isActivityEvent, type ActivityEvent } from "../../domain/entities/activity-event";
import type { SportsUniverseLibrary } from "../../domain/entities/sports-universe";
import { validateSportsUniverseRelations } from "./sports-universes";
import type { TieBreaker } from "../../domain/value-objects/tie-breaker";
import { tieBreakerOptions } from "../../domain/value-objects/tie-breaker";
import { validateTournamentIntegrity } from "../../domain/services/tournament-integrity";
import { isValidMatchResult } from "../../domain/services/match-result-validation";
import { isValidGoalScorer } from "../../domain/services/goal-scorers";
import { validateTournamentPlayerData } from "../../domain/services/player-roster";
import { validateFixtureDetails } from "../../domain/services/match-details";
import { validateMatchRegulations } from "../../domain/services/match-regulations";
import { validateMatchSchedule } from "../../domain/services/match-scheduling";

const tournamentFormat = "cancha-tournament";
const backupFormat = "cancha-backup";
const currentVersion = 7;

export type TournamentArchiveEnvelope = {
  readonly format: typeof tournamentFormat;
  readonly version: 7;
  readonly exportedAt: string;
  readonly tournament: Tournament;
};

export type TournamentBackupEnvelope = {
  readonly format: typeof backupFormat;
  readonly version: 7;
  readonly exportedAt: string;
  readonly tournaments: readonly Tournament[];
  readonly activity: readonly ActivityEvent[];
  readonly extensions?: {
    readonly sportsUniverses: SportsUniverseLibrary;
  };
};

export interface ParsedTournamentBackup {
  readonly version: number;
  readonly exportedAt?: string;
  readonly tournaments: Tournament[];
  readonly activity: ActivityEvent[];
  readonly universes?: SportsUniverseLibrary;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPointsSystem(value: unknown): value is PointsSystem {
  return isRecord(value)
    && [value.win, value.draw, value.loss].every((points) =>
      typeof points === "number" && Number.isSafeInteger(points) && points >= 0);
}

function isTieBreakers(value: unknown): value is readonly TieBreaker[] {
  return Array.isArray(value)
    && value.every((tieBreaker) =>
      tieBreakerOptions.some((option) => option.value === tieBreaker));
}

function isVerification(value: unknown): value is "verified" | "provisional" | "pending" {
  return value === "verified" || value === "provisional" || value === "pending";
}

function isCompetitionRules(value: unknown): value is CompetitionRulesConfiguration {
  if (!isRecord(value) || !Number.isSafeInteger(value.season)
    || !isRecord(value.verification)
    || !isVerification(value.verification.standings)
    || !isVerification(value.verification.placements)) return false;

  if (value.points !== undefined && !isPointsSystem(value.points)) return false;
  if (value.tieBreakers !== undefined && !isTieBreakers(value.tieBreakers)) return false;
  if (value.sourceUrls !== undefined
    && (!Array.isArray(value.sourceUrls) || !value.sourceUrls.every(isNonEmptyString))) return false;
  if (value.standingsNote !== undefined && typeof value.standingsNote !== "string") return false;
  if (value.placementsNote !== undefined && typeof value.placementsNote !== "string") return false;
  if (value.conditionalPlacements !== undefined) {
    if (!Array.isArray(value.conditionalPlacements) || !value.conditionalPlacements.every((item) =>
      isRecord(item) && isVerification(item.status) && isNonEmptyString(item.description)
      && (item.sourceUrl === undefined || typeof item.sourceUrl === "string"))) return false;
  }

  if (value.internationalQualification !== undefined) {
    const config = value.internationalQualification;
    if (!isRecord(config) || !isVerification(config.verification)
      || !Array.isArray(config.slots) || !config.slots.every((slot) =>
        isRecord(slot) && isNonEmptyString(slot.destination)
        && Number.isSafeInteger(slot.position) && Number(slot.position) > 0)) return false;
    if (config.reallocation !== undefined
      && config.reallocation !== "none"
      && config.reallocation !== "next-eligible-position") return false;
    if (config.cupChampions !== undefined
      && (!Array.isArray(config.cupChampions) || !config.cupChampions.every((champion) =>
        isRecord(champion) && isNonEmptyString(champion.sourceTournamentId)
        && isNonEmptyString(champion.destination)))) return false;
  }
  if (value.relegationAverage !== undefined) {
    const config = value.relegationAverage;
    if (!isRecord(config) || !isVerification(config.verification)
      || !Array.isArray(config.seasons) || config.seasons.length === 0
      || !config.seasons.every((season) => Number.isSafeInteger(season))
      || !Number.isSafeInteger(config.relegatedCount) || Number(config.relegatedCount) < 1
      || (config.tieBreakers !== undefined && !isTieBreakers(config.tieBreakers))) return false;
  }
  return true;
}

function isPlacementRules(value: unknown): value is TournamentPlacementRules {
  if (!isRecord(value)) return false;
  const countKeys = ["championPlaces"] as const;
  for (const key of countKeys) {
    if (value[key] !== undefined
      && (!Number.isSafeInteger(value[key]) || Number(value[key]) < 0)) return false;
  }
  if (value.relegationPlaces !== undefined && typeof value.relegationPlaces !== "number") return false;
  const rangeKeys = [
    "libertadoresPlaces",
    "libertadoresQualifyingPlaces",
    "sudamericanaPlaces",
    "playoffPlaces",
    "relegationPlayoffPlaces",
  ] as const;
  for (const key of rangeKeys) {
    const range = value[key];
    if (range !== undefined && (!isRecord(range)
      || !Number.isSafeInteger(range.from) || !Number.isSafeInteger(range.to)
      || Number(range.from) < 1 || Number(range.to) < Number(range.from))) return false;
  }
  return value.note === undefined || typeof value.note === "string";
}

function isMatchResult(value: unknown): value is MatchResult {
  if (!isRecord(value)
    || typeof value.homeGoals !== "number"
    || typeof value.awayGoals !== "number") return false;
  const scoreIsValid = (score: unknown): score is MatchScore => isRecord(score)
    && typeof score.homeGoals === "number"
    && typeof score.awayGoals === "number"
    && Number.isSafeInteger(score.homeGoals) && Number(score.homeGoals) >= 0 && Number(score.homeGoals) <= 99
    && Number.isSafeInteger(score.awayGoals) && Number(score.awayGoals) >= 0 && Number(score.awayGoals) <= 99;
  if ((value.extraTime !== undefined && !scoreIsValid(value.extraTime))
    || (value.penalties !== undefined && !scoreIsValid(value.penalties))) return false;
  const result: MatchResult = {
    homeGoals: value.homeGoals,
    awayGoals: value.awayGoals,
    ...(value.extraTime !== undefined ? { extraTime: value.extraTime } : {}),
    ...(value.penalties !== undefined ? { penalties: value.penalties } : {}),
  };
  return isValidMatchResult(result);
}

function isTeamLineup(value: unknown): boolean {
  return isRecord(value)
    && Array.isArray(value.starters) && value.starters.every(isNonEmptyString)
    && Array.isArray(value.substitutes) && value.substitutes.every(isNonEmptyString)
    && (value.captainPlayerId === undefined || isNonEmptyString(value.captainPlayerId))
    && (value.formation === undefined || typeof value.formation === "string")
    && (value.status === "incomplete" || value.status === "complete");
}

function isMatchLineups(value: unknown): value is MatchLineups {
  return isRecord(value) && isTeamLineup(value.home) && isTeamLineup(value.away);
}

function isMatchEvent(value: unknown): value is MatchEvent {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && (value.type === "goal" || value.type === "own-goal"
      || value.type === "yellow-card" || value.type === "red-card")
    && isNonEmptyString(value.teamId)
    && isNonEmptyString(value.playerName)
    && (value.playerId === undefined || isNonEmptyString(value.playerId))
    && (value.minute === undefined
      || (Number.isSafeInteger(value.minute) && Number(value.minute) >= 1 && Number(value.minute) <= 180))
    && (value.benefitedTeamId === undefined || isNonEmptyString(value.benefitedTeamId))
    && (value.period === undefined || value.period === "regulation"
      || value.period === "extra-time" || value.period === "penalties");
}

function isMatchSubstitution(value: unknown): value is MatchSubstitution {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.teamId)
    && isNonEmptyString(value.playerOutId)
    && isNonEmptyString(value.playerInId)
    && (value.window === undefined
      || (Number.isSafeInteger(value.window) && Number(value.window) >= 1 && Number(value.window) <= 30))
    && (value.minute === undefined
      || (Number.isSafeInteger(value.minute) && Number(value.minute) >= 1 && Number(value.minute) <= 180));
}

function isFixture(value: unknown): value is Fixture {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.homeTeamId)
    && isNonEmptyString(value.awayTeamId)
    && (value.knockoutResolution === undefined
      || value.knockoutResolution === "penalties"
      || value.knockoutResolution === "extra-time-then-penalties"
      || value.knockoutResolution === "aggregate-then-penalties")
    && (value.goalScorers === undefined
      || (Array.isArray(value.goalScorers) && value.goalScorers.every(isValidGoalScorer)))
    && (value.lineups === undefined || isMatchLineups(value.lineups))
    && (value.substitutions === undefined
      || (Array.isArray(value.substitutions) && value.substitutions.every(isMatchSubstitution)))
    && (value.events === undefined
      || (Array.isArray(value.events) && value.events.every(isMatchEvent)))
    && (value.eventsCoverage === undefined
      || value.eventsCoverage === "unverified" || value.eventsCoverage === "complete")
    && (value.schedule === undefined || isMatchSchedule(value.schedule))
    && (value.operationalState === undefined || isMatchOperationalState(value.operationalState))
    && (value.result === undefined || isMatchResult(value.result));
}

function isMatchSchedule(value: unknown): value is MatchSchedule {
  return isRecord(value) && validateMatchSchedule(value) === undefined;
}

function isOperationalStatus(value: unknown): value is OperationalMatchStatus {
  return value === "unscheduled"
    || value === "scheduled"
    || value === "in-progress"
    || value === "finished"
    || value === "postponed"
    || value === "suspended"
    || value === "cancelled";
}

function isMatchOperationalState(value: unknown): value is MatchOperationalState {
  return isRecord(value)
    && isOperationalStatus(value.status)
    && typeof value.updatedAt === "string"
    && Number.isFinite(Date.parse(value.updatedAt))
    && (value.note === undefined
      || typeof value.note === "string" && value.note.trim().length > 0 && value.note.length <= 500);
}

function isMatchday(value: unknown): value is Matchday {
  return isRecord(value)
    && Number.isSafeInteger(value.number)
    && Number.isSafeInteger(value.leg)
    && (value.phaseName === undefined || typeof value.phaseName === "string")
    && Array.isArray(value.fixtures)
    && value.fixtures.every(isFixture);
}

function isKnockoutStage(value: unknown): value is KnockoutStage {
  return isRecord(value)
    && isNonEmptyString(value.name)
    && (value.legs === 1 || value.legs === 2)
    && (value.advanceWinners === undefined || typeof value.advanceWinners === "boolean");
}

function isPlayer(value: unknown): value is Player {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.firstName)
    && isNonEmptyString(value.lastName)
    && (value.birthDate === undefined || typeof value.birthDate === "string")
    && (value.nationality === undefined || typeof value.nationality === "string")
    && (value.usualPosition === undefined || typeof value.usualPosition === "string");
}

function isPlayerRegistration(value: unknown): value is PlayerRegistration {
  return isRecord(value)
    && isNonEmptyString(value.playerId)
    && isNonEmptyString(value.teamId)
    && (value.shirtNumber === undefined
      || (Number.isSafeInteger(value.shirtNumber)
        && Number(value.shirtNumber) >= 1 && Number(value.shirtNumber) <= 99))
    && (value.status === undefined || value.status === "active" || value.status === "released");
}

function isTournamentShape(value: unknown): value is Tournament {
  if (!isRecord(value)
    || !isNonEmptyString(value.id)
    || typeof value.name !== "string"
    || !Array.isArray(value.teams)
    || !value.teams.every((team) => isRecord(team)
      && isNonEmptyString(team.id)
      && typeof team.name === "string"
      && (team.afaAffiliation === undefined || team.afaAffiliation === "direct" || team.afaAffiliation === "indirect")
      && (team.affiliationSourceUrl === undefined || typeof team.affiliationSourceUrl === "string")
      && (team.groupName === undefined || typeof team.groupName === "string")
      && (team.averageIdentity === undefined || typeof team.averageIdentity === "string")
      && (team.competitionNumber === undefined
        || (Number.isSafeInteger(team.competitionNumber) && Number(team.competitionNumber) > 0)))
    || !Number.isSafeInteger(value.legs)
    || !isTieBreakers(value.tieBreakers)
    || !Array.isArray(value.matchdays)
    || !value.matchdays.every(isMatchday)
    || (value.officialResolutions !== undefined && (!Array.isArray(value.officialResolutions) || !value.officialResolutions.every(isOfficialResolution)))
    || (value.players !== undefined && (!Array.isArray(value.players) || !value.players.every(isPlayer)))
    || (value.playerRegistrations !== undefined
      && (!Array.isArray(value.playerRegistrations)
        || !value.playerRegistrations.every(isPlayerRegistration)))
    || typeof value.createdAt !== "string") return false;
  if (value.lineupRules !== undefined
    && (!isRecord(value.lineupRules)
      || !Number.isSafeInteger(value.lineupRules.startersPerTeam)
      || Number(value.lineupRules.startersPerTeam) < 1
      || Number(value.lineupRules.startersPerTeam) > 30)) return false;
  if (value.matchRegulations !== undefined
    && validateMatchRegulations(value.matchRegulations) !== undefined) return false;

  return (value.season === undefined
      || (Number.isSafeInteger(value.season) && Number(value.season) > 0))
    && (value.competitionId === undefined
      || (typeof value.competitionId === "string" && value.competitionId.trim().length > 0))
    && (value.archived === undefined || typeof value.archived === "boolean")
    && (value.importCoverage === undefined
      || value.importCoverage === "complete"
      || value.importCoverage === "partial"
      || value.importCoverage === "unknown")
    && (value.calendarProvenance === undefined
      || value.calendarProvenance === "official-import"
      || value.calendarProvenance === "local-generated"
      || value.calendarProvenance === "manual")
    && (value.pointsSystem === undefined || isPointsSystem(value.pointsSystem))
    && (value.sourceUrl === undefined || typeof value.sourceUrl === "string")
    && (value.sourceName === undefined || typeof value.sourceName === "string")
    && (value.format === undefined || value.format === "round-robin" || value.format === "staged")
    && (value.zoneName === undefined || typeof value.zoneName === "string")
    && (value.rulesNote === undefined || typeof value.rulesNote === "string")
    && (value.placementRules === undefined || isPlacementRules(value.placementRules))
    && (value.competitionRules === undefined || isCompetitionRules(value.competitionRules))
    && (value.matchRegulations === undefined || isRecord(value.matchRegulations)
      && Number(value.matchRegulations.season) === Number(value.season ?? (
        isRecord(value.competitionRules) ? value.competitionRules.season : undefined
      )))
    && (value.competitionType === undefined
      || value.competitionType === "league" || value.competitionType === "cup")
    && (value.knockoutStages === undefined
      || (Array.isArray(value.knockoutStages) && value.knockoutStages.every(isKnockoutStage)));
}

function validateTournament(value: unknown, index?: number): Tournament {
  const position = index === undefined ? "" : `El torneo ${index + 1}: `;
  if (!isTournamentShape(value)) {
    throw new DomainError(`${position}la estructura del torneo no es válida.`);
  }
  const integrityIssues = validateTournamentIntegrity(value);
  if (integrityIssues.length > 0) {
    throw new DomainError(`${position}${integrityIssues[0]}`);
  }
  const playerIssue = validateTournamentPlayerData(value);
  if (playerIssue) throw new DomainError(`${position}${playerIssue}`);
  for (const fixture of value.matchdays.flatMap(({ fixtures }) => fixtures)) {
    const detailIssue = validateFixtureDetails(value, fixture);
    if (detailIssue) throw new DomainError(`${position}${detailIssue}`);
  }
  return tournamentSnapshot(value);
}

function tournamentSnapshot(tournament: Tournament): Tournament {
  return {
    id: tournament.id,
    ...(tournament.nationalCupPlanning !== undefined ? {nationalCupPlanning: JSON.parse(JSON.stringify(tournament.nationalCupPlanning)) as Tournament["nationalCupPlanning"]} : {}),
    ...(tournament.continentalPlans !== undefined ? { continentalPlans: JSON.parse(JSON.stringify(tournament.continentalPlans)) as Tournament["continentalPlans"] } : {}),
    ...(tournament.seasonPreparation !== undefined ? { seasonPreparation: JSON.parse(JSON.stringify(tournament.seasonPreparation)) as Tournament["seasonPreparation"] } : {}),
    ...(tournament.officialResolutions !== undefined ? { officialResolutions: JSON.parse(JSON.stringify(tournament.officialResolutions)) as Tournament["officialResolutions"] } : {}),
    ...(tournament.competitionId !== undefined ? { competitionId: tournament.competitionId } : {}),
    name: tournament.name,
    teams: tournament.teams.map((team) => ({
      id: team.id,
      name: team.name,
      ...(team.afaAffiliation !== undefined ? { afaAffiliation: team.afaAffiliation } : {}),
      ...(team.affiliationSourceUrl !== undefined ? { affiliationSourceUrl: team.affiliationSourceUrl } : {}),
      ...(team.groupName !== undefined ? { groupName: team.groupName } : {}),
      ...(team.averageIdentity !== undefined ? { averageIdentity: team.averageIdentity } : {}),
      ...(team.competitionNumber !== undefined ? { competitionNumber: team.competitionNumber } : {}),
    })),
    legs: tournament.legs,
    tieBreakers: [...tournament.tieBreakers],
    ...(tournament.pointsSystem
      ? {
        pointsSystem: {
          win: tournament.pointsSystem.win,
          draw: tournament.pointsSystem.draw,
          loss: tournament.pointsSystem.loss,
        },
      }
      : {}),
    matchdays: tournament.matchdays.map((matchday) => ({
      number: matchday.number,
      leg: matchday.leg,
      ...(matchday.phaseName !== undefined ? { phaseName: matchday.phaseName } : {}),
      fixtures: matchday.fixtures.map((fixture) => ({
        id: fixture.id,
        homeTeamId: fixture.homeTeamId,
        awayTeamId: fixture.awayTeamId,
        ...(fixture.calendarProvenance !== undefined
          ? { calendarProvenance: fixture.calendarProvenance }
          : {}),
        ...(fixture.knockoutResolution !== undefined
          ? { knockoutResolution: fixture.knockoutResolution }
          : {}),
        ...(fixture.goalScorers !== undefined
          ? { goalScorers: fixture.goalScorers.map((scorer) => ({ ...scorer })) }
          : {}),
        ...(fixture.lineups
          ? {
            lineups: {
              home: { ...fixture.lineups.home,
                starters: [...fixture.lineups.home.starters],
                substitutes: [...fixture.lineups.home.substitutes] },
              away: { ...fixture.lineups.away,
                starters: [...fixture.lineups.away.starters],
                substitutes: [...fixture.lineups.away.substitutes] },
            },
          }
          : {}),
        ...(fixture.substitutions
          ? { substitutions: fixture.substitutions.map((substitution) => ({ ...substitution })) }
          : {}),
        ...(fixture.events ? { events: fixture.events.map((event) => ({ ...event })) } : {}),
        ...(fixture.eventsCoverage !== undefined ? { eventsCoverage: fixture.eventsCoverage } : {}),
        ...(fixture.schedule ? { schedule: { ...fixture.schedule } } : {}),
        ...(fixture.operationalState
          ? { operationalState: { ...fixture.operationalState } }
          : {}),
        ...(fixture.result
          ? {
            result: {
              homeGoals: fixture.result.homeGoals,
              awayGoals: fixture.result.awayGoals,
              ...(fixture.result.extraTime ? { extraTime: { ...fixture.result.extraTime } } : {}),
              ...(fixture.result.penalties ? { penalties: { ...fixture.result.penalties } } : {}),
            },
          }
          : {}),
      })),
    })),
    createdAt: tournament.createdAt,
    ...(tournament.season !== undefined ? { season: tournament.season } : {}),
    ...(tournament.archived !== undefined ? { archived: tournament.archived } : {}),
    ...(tournament.importCoverage !== undefined
      ? { importCoverage: tournament.importCoverage }
      : {}),
    ...(tournament.calendarProvenance !== undefined
      ? { calendarProvenance: tournament.calendarProvenance }
      : {}),
    ...(tournament.sourceUrl !== undefined ? { sourceUrl: tournament.sourceUrl } : {}),
    ...(tournament.sourceName !== undefined ? { sourceName: tournament.sourceName } : {}),
    ...(tournament.format !== undefined ? { format: tournament.format } : {}),
    ...(tournament.zoneName !== undefined ? { zoneName: tournament.zoneName } : {}),
    ...(tournament.rulesNote !== undefined ? { rulesNote: tournament.rulesNote } : {}),
    ...(tournament.placementRules
      ? {
        placementRules: {
          ...(tournament.placementRules.championPlaces !== undefined
            ? { championPlaces: tournament.placementRules.championPlaces }
            : {}),
          ...(tournament.placementRules.libertadoresPlaces
            ? {
              libertadoresPlaces: {
                from: tournament.placementRules.libertadoresPlaces.from,
                to: tournament.placementRules.libertadoresPlaces.to,
              },
            }
            : {}),
          ...(tournament.placementRules.libertadoresQualifyingPlaces
            ? {
              libertadoresQualifyingPlaces: {
                from: tournament.placementRules.libertadoresQualifyingPlaces.from,
                to: tournament.placementRules.libertadoresQualifyingPlaces.to,
              },
            }
            : {}),
          ...(tournament.placementRules.sudamericanaPlaces
            ? {
              sudamericanaPlaces: {
                from: tournament.placementRules.sudamericanaPlaces.from,
                to: tournament.placementRules.sudamericanaPlaces.to,
              },
            }
            : {}),
          ...(tournament.placementRules.playoffPlaces
            ? {
              playoffPlaces: {
                from: tournament.placementRules.playoffPlaces.from,
                to: tournament.placementRules.playoffPlaces.to,
              },
            }
            : {}),
          ...(tournament.placementRules.relegationPlayoffPlaces
            ? {
              relegationPlayoffPlaces: {
                from: tournament.placementRules.relegationPlayoffPlaces.from,
                to: tournament.placementRules.relegationPlayoffPlaces.to,
              },
            }
            : {}),
          ...(tournament.placementRules.relegationPlaces !== undefined
            ? { relegationPlaces: tournament.placementRules.relegationPlaces }
            : {}),
          ...(tournament.placementRules.note !== undefined
            ? { note: tournament.placementRules.note }
            : {}),
        },
      }
      : {}),
    ...(tournament.competitionRules
      ? {
        competitionRules: {
          season: tournament.competitionRules.season,
          ...(tournament.competitionRules.points
            ? { points: { ...tournament.competitionRules.points } }
            : {}),
          ...(tournament.competitionRules.tieBreakers
            ? { tieBreakers: [...tournament.competitionRules.tieBreakers] }
            : {}),
          ...(tournament.competitionRules.conditionalPlacements
            ? {
              conditionalPlacements: tournament.competitionRules.conditionalPlacements.map(
                ({ status, description, sourceUrl }) => ({
                  status,
                  description,
                  ...(sourceUrl !== undefined ? { sourceUrl } : {}),
                }),
              ),
            }
            : {}),
          verification: {
            standings: tournament.competitionRules.verification.standings,
            placements: tournament.competitionRules.verification.placements,
          },
          ...(tournament.competitionRules.sourceUrls
            ? { sourceUrls: [...tournament.competitionRules.sourceUrls] }
            : {}),
          ...(tournament.competitionRules.standingsNote !== undefined
            ? { standingsNote: tournament.competitionRules.standingsNote }
            : {}),
          ...(tournament.competitionRules.placementsNote !== undefined
            ? { placementsNote: tournament.competitionRules.placementsNote }
            : {}),
          ...(tournament.competitionRules.internationalQualification
            ? {
              internationalQualification: {
                verification: tournament.competitionRules.internationalQualification.verification,
                slots: tournament.competitionRules.internationalQualification.slots.map((slot) => ({
                  destination: slot.destination,
                  position: slot.position,
                })),
                ...(tournament.competitionRules.internationalQualification.cupChampions
                  ? {
                    cupChampions:
                      tournament.competitionRules.internationalQualification.cupChampions.map(
                        (champion) => ({
                          sourceTournamentId: champion.sourceTournamentId,
                          destination: champion.destination,
                        }),
                      ),
                  }
                  : {}),
                ...(tournament.competitionRules.internationalQualification.reallocation
                  ? {
                    reallocation:
                      tournament.competitionRules.internationalQualification.reallocation,
                  }
                  : {}),
              },
            }
            : {}),
          ...(tournament.competitionRules.relegationAverage
            ? {
              relegationAverage: {
                verification: tournament.competitionRules.relegationAverage.verification,
                seasons: [...tournament.competitionRules.relegationAverage.seasons],
                relegatedCount: tournament.competitionRules.relegationAverage.relegatedCount,
                ...(tournament.competitionRules.relegationAverage.tieBreakers
                  ? {
                    tieBreakers: [
                      ...tournament.competitionRules.relegationAverage.tieBreakers,
                    ],
                  }
                  : {}),
              },
            }
            : {}),
        },
      }
      : {}),
    ...(tournament.competitionType !== undefined
      ? { competitionType: tournament.competitionType }
      : {}),
    ...(tournament.knockoutStages
      ? {
        knockoutStages: tournament.knockoutStages.map((stage) => ({
          name: stage.name,
          legs: stage.legs,
          ...(stage.advanceWinners !== undefined
            ? { advanceWinners: stage.advanceWinners }
            : {}),
        })),
      }
      : {}),
    ...(tournament.players
      ? {
        players: tournament.players.map((player) => ({
          id: player.id,
          firstName: player.firstName,
          lastName: player.lastName,
          ...(player.birthDate !== undefined ? { birthDate: player.birthDate } : {}),
          ...(player.nationality !== undefined ? { nationality: player.nationality } : {}),
          ...(player.usualPosition !== undefined ? { usualPosition: player.usualPosition } : {}),
        })),
      }
      : {}),
    ...(tournament.playerRegistrations
      ? {
        playerRegistrations: tournament.playerRegistrations.map((registration) => ({
          playerId: registration.playerId,
          teamId: registration.teamId,
          ...(registration.shirtNumber !== undefined
            ? { shirtNumber: registration.shirtNumber }
            : {}),
          ...(registration.status !== undefined ? { status: registration.status } : {}),
        })),
      }
      : {}),
    ...(tournament.lineupRules ? { lineupRules: { ...tournament.lineupRules } } : {}),
    ...(tournament.matchRegulations
      ? { matchRegulations: copyMatchRegulations(tournament.matchRegulations) }
      : {}),
  };
}

function copyMatchRegulations(regulations: MatchRegulations): MatchRegulations {
  return {
    ...regulations,
    ...(regulations.lineup ? { lineup: { ...regulations.lineup } } : {}),
    ...(regulations.substitutions ? { substitutions: { ...regulations.substitutions } } : {}),
    ...(regulations.timing ? { timing: { ...regulations.timing } } : {}),
    ...(regulations.cards ? { cards: { ...regulations.cards } } : {}),
    ...(regulations.eligibility ? { eligibility: { ...regulations.eligibility } } : {}),
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DomainError("El archivo no contiene JSON válido.");
  }
}

function readEnvelopeVersion(value: Record<string, unknown>, expectedFormat: string): number {
  if (value.format !== expectedFormat && value.format !== undefined) {
    throw new DomainError("El archivo corresponde a otro tipo de documento.");
  }
  if (value.version === undefined) return 0;
  if (!Number.isSafeInteger(value.version) || Number(value.version) < 0) {
    throw new DomainError("La versión del archivo no es válida.");
  }
  const version = Number(value.version);
  if (version > currentVersion) {
    throw new DomainError(`La versión ${version} del archivo no es compatible con esta aplicación.`);
  }
  return version;
}

function validateExportTimestamp(value: Record<string, unknown>, version: number): void {
  if (version === currentVersion
    && (typeof value.exportedAt !== "string" || !Number.isFinite(Date.parse(value.exportedAt)))) {
    throw new DomainError("El archivo no contiene una fecha de exportación válida.");
  }
}

function validateUniqueTournamentIds(tournaments: readonly Tournament[]): void {
  const ids = new Set<string>();
  for (const tournament of tournaments) {
    if (ids.has(tournament.id)) {
      throw new DomainError(`El archivo repite el identificador de torneo "${tournament.id}".`);
    }
    ids.add(tournament.id);
  }
}

export function createTournamentArchive(
  tournament: Tournament,
  now: () => Date = () => new Date(),
): TournamentArchiveEnvelope {
  const snapshot = validateTournament(tournament);
  return {
    format: tournamentFormat,
    version: currentVersion,
    exportedAt: now().toISOString(),
    tournament: snapshot,
  };
}

export function parseTournamentArchive(text: string): Tournament {
  const value = parseJson(text);
  if (!isRecord(value)) {
    throw new DomainError("El archivo no tiene la estructura de un torneo exportado.");
  }
  const version = readEnvelopeVersion(value, tournamentFormat);
  const tournament = value.tournament ?? (value.format === undefined ? value : undefined);
  validateExportTimestamp(value, version);
  if (version >= 1 && value.format !== tournamentFormat) {
    throw new DomainError("El archivo no tiene el formato de torneo esperado.");
  }
  if (version === 0 && value.format !== undefined && value.format !== tournamentFormat) {
    throw new DomainError("No se puede migrar con seguridad este archivo antiguo.");
  }
  return validateTournament(tournament);
}

export function createTournamentBackup(
  tournaments: readonly Tournament[],
  now: () => Date = () => new Date(),
  activity: readonly ActivityEvent[] = [],
  universes?: SportsUniverseLibrary,
): TournamentBackupEnvelope {
  const validated = tournaments.map((tournament, index) => validateTournament(tournament, index));
  validateUniqueTournamentIds(validated);
  if (!activity.every(isActivityEvent)) {
    throw new DomainError("El historial del respaldo contiene eventos inválidos.");
  }
  const validatedUniverses = universes
    ? validateSportsUniverseRelations(universes, validated, activity)
    : undefined;
  return {
    format: backupFormat,
    version: currentVersion,
    exportedAt: now().toISOString(),
    tournaments: validated,
    activity: activity.map((event) => ({ ...event })),
    ...(validatedUniverses ? { extensions: { sportsUniverses: validatedUniverses } } : {}),
  };
}

export function parseTournamentBackup(text: string): Tournament[] {
  return parseTournamentBackupWithActivity(text).tournaments;
}

export function parseTournamentBackupWithActivity(text: string): ParsedTournamentBackup {
  const value = parseJson(text);
  if (!isRecord(value)) {
    throw new DomainError("El archivo no tiene la estructura de un respaldo.");
  }
  const version = readEnvelopeVersion(value, backupFormat);
  validateExportTimestamp(value, version);
  if (version >= 1 && value.format !== backupFormat) {
    throw new DomainError("El archivo no tiene el formato de respaldo esperado.");
  }
  if (version === 0 && value.format !== undefined && value.format !== backupFormat) {
    throw new DomainError("No se puede migrar con seguridad este respaldo antiguo.");
  }
  if (!Array.isArray(value.tournaments)) {
    throw new DomainError("El respaldo no contiene una lista de torneos válida.");
  }
  const tournaments = value.tournaments.map((tournament, index) => validateTournament(tournament, index));
  validateUniqueTournamentIds(tournaments);
  const activity = version >= 7
    ? value.activity
    : [];
  if (!Array.isArray(activity) || !activity.every(isActivityEvent)) {
    throw new DomainError("El historial del respaldo contiene eventos inválidos.");
  }
  if (value.extensions !== undefined && !isRecord(value.extensions)) {
    throw new DomainError("Las extensiones del respaldo tienen un formato inválido.");
  }
  const rawUniverses = isRecord(value.extensions)
    ? value.extensions.sportsUniverses
    : undefined;
  const universes = rawUniverses === undefined
    ? undefined
    : validateSportsUniverseRelations(
      rawUniverses,
      tournaments,
      activity,
    );
  return {
    version,
    ...(typeof value.exportedAt === "string" ? { exportedAt: value.exportedAt } : {}),
    tournaments,
    activity: activity.map((event) => ({ ...event, imported: true })),
    ...(universes ? { universes } : {}),
  };
}

export function cloneTournamentWithNewIds(
  tournament: Tournament,
  createId: () => string = () => crypto.randomUUID(),
): Tournament {
  const snapshot = validateTournament(tournament);
  const teamIds = new Map(snapshot.teams.map((team) => [team.id, createId()]));
  const id = createId();
  const resolutionIds = new Map((snapshot.officialResolutions ?? []).map(record => [record.id, createId()]));
  const remapTeam = (teamId: string) => teamIds.get(teamId) ?? teamId;
  return {
    ...snapshot,
    ...(snapshot.nationalCupPlanning ? {nationalCupPlanning:{...snapshot.nationalCupPlanning,requiresReview:true}} : {}),
    id,
    ...(snapshot.competitionId ? { competitionId: id } : {}),
    name: `${snapshot.name} (copia)`.slice(0, 80),
    ...(snapshot.continentalPlans ? { continentalPlans: snapshot.continentalPlans.map(plan => ({ ...plan, id: createId(), requiresReview: true, entries: plan.entries.map(entry => ({ ...entry, ...(entry.targetTeamId ? { targetTeamId: remapTeam(entry.targetTeamId) } : {}) })) })) } : {}),
    ...(snapshot.officialResolutions ? { officialResolutions: snapshot.officialResolutions.map(record => ({
      ...record, id: resolutionIds.get(record.id)!, participantIds: record.participantIds.map(remapTeam),
      participantNames: record.participantNames.map(item => ({ ...item, teamId: remapTeam(item.teamId) })),
      ...(record.orderedTeamIds ? { orderedTeamIds: record.orderedTeamIds.map(remapTeam) } : {}),
      ...(record.supersededBy ? { supersededBy: resolutionIds.get(record.supersededBy)! } : {}),
      invalidation: record.invalidation ?? { at: new Date().toISOString(), reason: "Copia con nuevos identificadores: requiere revisar las dependencias oficiales." },
      ...(record.programme ? { programme: { ...record.programme,
        matches: record.programme.matches.map(match => ({ ...match, id: createId(), homeTeamId: remapTeam(match.homeTeamId), awayTeamId: remapTeam(match.awayTeamId) })),
        ...(record.programme.conclusion ? { conclusion: { ...record.programme.conclusion,
          orderedTeamIds: record.programme.conclusion.orderedTeamIds.map(remapTeam) } } : {}),
      } } : {}),
    })) } : {}),
    teams: snapshot.teams.map((team) => ({
      ...team,
      id: teamIds.get(team.id) ?? createId(),
    })),
    matchdays: snapshot.matchdays.map((matchday) => ({
      ...matchday,
      fixtures: matchday.fixtures.map((fixture) => ({
        ...fixture,
        id: createId(),
        homeTeamId: teamIds.get(fixture.homeTeamId) ?? fixture.homeTeamId,
        awayTeamId: teamIds.get(fixture.awayTeamId) ?? fixture.awayTeamId,
        ...(fixture.goalScorers
          ? {
            goalScorers: fixture.goalScorers.map((scorer) => ({
              ...scorer,
              teamId: teamIds.get(scorer.teamId) ?? scorer.teamId,
            })),
          }
          : {}),
        ...(fixture.substitutions
          ? {
            substitutions: fixture.substitutions.map((substitution) => ({
              ...substitution,
              teamId: teamIds.get(substitution.teamId) ?? substitution.teamId,
            })),
          }
          : {}),
        ...(fixture.events
          ? {
            events: fixture.events.map((event) => ({
              ...event,
              teamId: teamIds.get(event.teamId) ?? event.teamId,
              ...(event.benefitedTeamId
                ? { benefitedTeamId: teamIds.get(event.benefitedTeamId) ?? event.benefitedTeamId }
                : {}),
            })),
          }
          : {}),
      })),
    })),
    ...(snapshot.playerRegistrations
      ? {
        playerRegistrations: snapshot.playerRegistrations.map((registration) => ({
          ...registration,
          teamId: teamIds.get(registration.teamId) ?? registration.teamId,
        })),
      }
      : {}),
  };
}

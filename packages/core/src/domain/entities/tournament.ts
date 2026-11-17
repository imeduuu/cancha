import type { ContinentalPlan } from "./continental-plan";
import type { OfficialResolution } from "./official-resolution";
import type { Team } from "./team";
import type { TieBreaker } from "../value-objects/tie-breaker";

export type TournamentFormat = "round-robin" | "staged";
export type CompetitionType = "league" | "cup";
export type RulesVerificationStatus = "verified" | "provisional" | "pending";
export type ImportCoverage = "complete" | "partial" | "unknown";
export type CalendarProvenance = "official-import" | "local-generated" | "manual";

export interface MatchRegulations {
  readonly schemaVersion: 1;
  readonly season: number;
  readonly verification: RulesVerificationStatus;
  readonly sourceUrl?: string;
  readonly notes?: string;
  readonly lineup?: {
    readonly requiredStarters?: number;
    readonly maxSubstitutes?: number;
  };
  readonly substitutions?: {
    readonly maxCount?: number;
    readonly maxWindows?: number;
  };
  readonly timing?: {
    readonly regulationMinutes?: number;
    readonly halfMinutes?: number;
    readonly addedTimeAllowed?: boolean;
    readonly extraTimeAllowed?: boolean;
    readonly extraTimeMinutes?: number;
    readonly penaltyShootoutAllowed?: boolean;
  };
  readonly cards?: {
    readonly yellowCardsForSuspension?: number;
    readonly redCardSuspensionMatches?: number;
  };
  readonly eligibility?: {
    readonly activeRegistrationRequired?: boolean;
    readonly minimumAge?: number;
    readonly maximumAge?: number;
  };
}

export interface PointsSystem {
  readonly win: number;
  readonly draw: number;
  readonly loss: number;
}

export interface CompetitionRulesConfiguration {
  readonly season: number;
  readonly points?: PointsSystem;
  readonly tieBreakers?: readonly TieBreaker[];
  readonly conditionalPlacements?: readonly {
    readonly status: RulesVerificationStatus;
    readonly description: string;
    readonly sourceUrl?: string;
  }[];
  readonly verification: {
    readonly standings: RulesVerificationStatus;
    readonly placements: RulesVerificationStatus;
  };
  readonly sourceUrls?: readonly string[];
  readonly standingsNote?: string;
  readonly placementsNote?: string;
  readonly internationalQualification?: InternationalQualificationConfiguration;
  readonly relegationAverage?: RelegationAverageConfiguration;
}

export interface InternationalQualificationConfiguration {
  readonly verification: RulesVerificationStatus;
  readonly slots: readonly {
    readonly destination: string;
    readonly position: number;
  }[];
  readonly cupChampions?: readonly {
    readonly sourceTournamentId: string;
    readonly destination: string;
  }[];
  readonly reallocation?: "none" | "next-eligible-position";
}

export interface RelegationAverageConfiguration {
  readonly verification: RulesVerificationStatus;
  readonly seasons: readonly number[];
  readonly relegatedCount: number;
  readonly tieBreakers?: readonly TieBreaker[];
}

export interface KnockoutStage {
  readonly name: string;
  readonly legs: 1 | 2;
  readonly advanceWinners?: boolean;
}

export interface TournamentPlacementRules {
  readonly championPlaces?: number;
  readonly libertadoresPlaces?: {
    readonly from: number;
    readonly to: number;
  };
  readonly libertadoresQualifyingPlaces?: {
    readonly from: number;
    readonly to: number;
  };
  readonly sudamericanaPlaces?: {
    readonly from: number;
    readonly to: number;
  };
  readonly playoffPlaces?: {
    readonly from: number;
    readonly to: number;
  };
  readonly relegationPlayoffPlaces?: {
    readonly from: number;
    readonly to: number;
  };
  readonly relegationPlaces?: number;
  readonly note?: string;
}

export type KnockoutResolution =
  | "penalties"
  | "extra-time-then-penalties"
  | "aggregate-then-penalties";

export interface MatchScore {
  readonly homeGoals: number;
  readonly awayGoals: number;
}

export type GoalType = "regular" | "penalty" | "own-goal";

export interface Player {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly birthDate?: string;
  readonly nationality?: string;
  readonly usualPosition?: string;
}

export interface PlayerRegistration {
  readonly playerId: string;
  readonly teamId: string;
  readonly shirtNumber?: number;
  readonly status?: "active" | "released";
}

export interface GoalScorer {
  readonly teamId: string;
  readonly playerName: string;
  readonly playerId?: string;
  readonly minute?: number;
  readonly type?: GoalType;
  readonly eventId?: string;
}

export type MatchEventType = "goal" | "own-goal" | "yellow-card" | "red-card";

export interface MatchEvent {
  readonly id: string;
  readonly type: MatchEventType;
  readonly teamId: string;
  readonly playerId?: string;
  readonly playerName: string;
  readonly minute?: number;
  readonly benefitedTeamId?: string;
  readonly period?: MatchEventPeriod;
}

export interface TeamLineup {
  readonly starters: readonly string[];
  readonly substitutes: readonly string[];
  readonly captainPlayerId?: string;
  readonly formation?: string;
  readonly status: "incomplete" | "complete";
}

export interface MatchLineups {
  readonly home: TeamLineup;
  readonly away: TeamLineup;
}

export interface MatchSubstitution {
  readonly id: string;
  readonly teamId: string;
  readonly playerOutId: string;
  readonly playerInId: string;
  readonly minute?: number;
  readonly window?: number;
}

export type MatchEventPeriod = "regulation" | "extra-time" | "penalties";

export interface MatchSchedule {
  readonly date?: string;
  readonly time?: string;
  /** Published UTC offset (Z or ±HH:mm); absent means the source gave no timezone. */
  readonly utcOffset?: string;
  readonly venue?: string;
  readonly logisticsNotes?: string;
  readonly provenance?: CalendarProvenance;
}

export type OperationalMatchStatus =
  | "unscheduled"
  | "scheduled"
  | "in-progress"
  | "finished"
  | "postponed"
  | "suspended"
  | "cancelled";

export interface MatchOperationalState {
  readonly status: OperationalMatchStatus;
  readonly updatedAt: string;
  readonly note?: string;
}

export interface Fixture {
  readonly id: string;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly calendarProvenance?: CalendarProvenance;
  readonly knockoutResolution?: KnockoutResolution;
  readonly result?: MatchResult;
  readonly goalScorers?: readonly GoalScorer[];
  readonly lineups?: MatchLineups;
  readonly substitutions?: readonly MatchSubstitution[];
  readonly events?: readonly MatchEvent[];
  /** Missing means the event list has not been verified. */
  readonly eventsCoverage?: "unverified" | "complete";
  readonly schedule?: MatchSchedule;
  readonly operationalState?: MatchOperationalState;
}

export interface MatchResult extends MatchScore {
  readonly extraTime?: MatchScore;
  readonly penalties?: MatchScore;
}

export interface Matchday {
  readonly number: number;
  readonly leg: number;
  readonly phaseName?: string;
  readonly fixtures: readonly Fixture[];
}

export interface SeasonPreparation {
  readonly schemaVersion: 1;
  readonly sourceTournamentIds: readonly string[];
  readonly plannedParticipants: readonly string[];
  readonly calendarReviews: readonly {
    readonly at: string;
    readonly sourceUrl: string;
    readonly publishedParticipants: readonly string[];
    readonly missing: readonly string[];
    readonly added: readonly string[];
    readonly discrepancyReason?: string;
  }[];
}

export interface Tournament {
  readonly nationalCupPlanning?: import("./national-cup-planning").NationalCupPlanning;
  readonly continentalPlans?: readonly ContinentalPlan[];
  readonly seasonPreparation?: SeasonPreparation;
  readonly officialResolutions?: readonly OfficialResolution[];
  readonly id: string;
  readonly competitionId?: string;
  readonly name: string;
  readonly teams: readonly Team[];
  readonly legs: number;
  readonly tieBreakers: readonly TieBreaker[];
  readonly pointsSystem?: PointsSystem;
  readonly matchdays: readonly Matchday[];
  readonly createdAt: string;
  readonly season?: number;
  readonly archived?: boolean;
  readonly importCoverage?: ImportCoverage;
  readonly calendarProvenance?: CalendarProvenance;
  readonly sourceUrl?: string;
  readonly sourceName?: string;
  readonly format?: TournamentFormat;
  readonly zoneName?: string;
  readonly rulesNote?: string;
  readonly placementRules?: TournamentPlacementRules;
  readonly competitionRules?: CompetitionRulesConfiguration;
  readonly competitionType?: CompetitionType;
  readonly knockoutStages?: readonly KnockoutStage[];
  readonly players?: readonly Player[];
  readonly playerRegistrations?: readonly PlayerRegistration[];
  readonly lineupRules?: {
    readonly startersPerTeam: number;
  };
  readonly matchRegulations?: MatchRegulations;
}

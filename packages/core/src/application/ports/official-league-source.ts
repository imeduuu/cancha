import type {
  TournamentFormat,
  KnockoutResolution,
  TournamentPlacementRules,
  CompetitionType,
  KnockoutStage,
  OperationalMatchStatus,
  MatchSchedule,
} from "../../domain/entities/tournament";

export interface OfficialMatch {
  readonly id: string;
  readonly homeTeamName: string;
  readonly awayTeamName: string;
  readonly homeGoals?: number;
  readonly awayGoals?: number;
  readonly homeGroupName?: string;
  readonly awayGroupName?: string;
  readonly knockoutResolution?: KnockoutResolution;
  readonly extraTime?: { readonly homeGoals: number; readonly awayGoals: number };
  readonly penalties?: { readonly homeGoals: number; readonly awayGoals: number };
  readonly operationalStatus?: OperationalMatchStatus;
  readonly schedule?: MatchSchedule;
}

export interface OfficialMatchday {
  readonly number: number;
  readonly phaseName?: string;
  readonly matches: readonly OfficialMatch[];
}

export type OfficialLeagueId =
  | "argentina-nacional"
  | "brasil-serie-b"
  | "argentina-primera"
  | "copa-argentina"
  | "copa-brasil"
  | "copa-chile"
  | "copa-liga"
  | "libertadores"
  | "sudamericana"
  | "brasil-primera"
  | "primera"
  | "primera-b"
  | "segunda"
  | "tercera-a"
  | "tercera-b";
export type OfficialLeagueZone = "ascenso" | "descenso" | "norte" | "sur";

export interface OfficialLeagueSeason {
  readonly id: string;
  readonly name: string;
  readonly season: number;
  readonly coverage?: "complete" | "partial" | "unknown";
  readonly sourceUrl: string;
  readonly sourceName?: string;
  readonly teams?: readonly {
    readonly name: string;
    readonly groupName?: string;
    readonly competitionNumber?: number;
  }[];
  readonly format?: TournamentFormat;
  readonly zoneName?: string;
  readonly placementRules?: TournamentPlacementRules;
  readonly competitionType?: CompetitionType;
  readonly knockoutStages?: readonly KnockoutStage[];
  readonly rulesNote?: string;
  readonly matchdays: readonly OfficialMatchday[];
}

export interface OfficialLeagueSource {
  fetchSeason(
    league: OfficialLeagueId,
    zone?: OfficialLeagueZone,
    options?: OfficialLeagueFetchOptions,
  ): Promise<OfficialLeagueSeason>;
}

export interface OfficialLeagueFetchOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: { readonly current: number; readonly total: number; readonly label: string }) => void;
}

export interface PublishedSeasonSource {
  fetchPublishedSeason(league: OfficialLeagueId, year: number): Promise<OfficialLeagueSeason>;
}

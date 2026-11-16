export type ContinentalCup = "libertadores" | "sudamericana";
export interface ContinentalEntry {
  readonly sourceTournamentId: string;
  readonly originTournamentId: string;
  readonly sourceTournamentName: string;
  readonly originTournamentName: string;
  readonly sourceCompetitionId?: string;
  readonly sourceSeason: number;
  readonly sourceTeamId: string;
  readonly teamName: string;
  readonly clubIdentity: string;
  readonly destination: string;
  readonly status: "confirmed" | "provisional" | "pending";
  readonly scenario: "local" | "provider" | "unknown";
  readonly targetTeamId?: string;
}
/** Documentary snapshots, never instructions for sporting progression. */
export interface ContinentalPlan {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly at: string;
  readonly cup: ContinentalCup;
  readonly edition: number;
  readonly qualifyingSeason: number;
  readonly sourceTournamentIds: readonly string[];
  readonly dependencies: readonly { readonly tournamentId: string; readonly snapshot: string }[];
  readonly entries: readonly ContinentalEntry[];
  readonly sourceUrl: string;
  readonly note: string;
  readonly pendingReasons?: readonly string[];
  readonly mode: "incorporated" | "review";
  readonly requiresReview?: boolean;
}

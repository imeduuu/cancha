import type { MatchResult, KnockoutResolution, RulesVerificationStatus } from "./tournament";

export type OfficialResolutionScope = "brasil-table" | "argentina-seeding" | "argentina-relegation";
export interface OfficialReference {
  readonly url: string;
  readonly reference: string;
}
export interface OfficialDecisionMatch {
  readonly id: string;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
  readonly date?: string;
  readonly venue?: string;
  readonly neutral: boolean;
  readonly knockoutResolution?: Exclude<KnockoutResolution, "aggregate-then-penalties">;
  readonly result?: MatchResult;
  readonly resultSource?: OfficialReference;
}
export interface OfficialProgramme {
  readonly format: "round-robin" | "afa-decision";
  readonly description: string;
  readonly expectedMatches: number;
  readonly matches: readonly OfficialDecisionMatch[];
  /** A separately sourced AFA conclusion, only needed for nonstandard formats or remaining ties. */
  readonly conclusion?: { readonly orderedTeamIds: readonly string[]; readonly source: OfficialReference };
}
export interface OfficialResolution {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly scope: OfficialResolutionScope;
  readonly key: string;
  readonly participantIds: readonly string[];
  readonly participantNames: readonly { readonly teamId: string; readonly name: string }[];
  readonly dependencySnapshot: string;
  readonly verification: RulesVerificationStatus;
  readonly source: OfficialReference;
  readonly recordedAt: string;
  readonly orderedTeamIds?: readonly string[];
  readonly programme?: OfficialProgramme;
  readonly invalidation?: { readonly at: string; readonly reason: string };
  readonly supersededBy?: string;
}
export interface OfficialResolutionContext {
  readonly scope: OfficialResolutionScope;
  readonly key: string;
  readonly title: string;
  readonly participantIds: readonly string[];
  readonly dependencySnapshot: string;
}

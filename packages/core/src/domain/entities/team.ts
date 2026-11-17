export interface Team {
  readonly id: string;
  readonly name: string;
  readonly afaAffiliation?: "direct" | "indirect";
  readonly affiliationSourceUrl?: string;
  readonly groupName?: string;
  readonly averageIdentity?: string;
  /** Official competition numbering, when defined for this tournament edition. */
  readonly competitionNumber?: number;
}

export interface SportsUniverse {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
}

export interface SportsUniverseLibrary {
  readonly version: 1;
  readonly activeUniverseId: string | null;
  readonly universes: readonly SportsUniverse[];
  readonly assignments: Readonly<Record<string, string>>;
}

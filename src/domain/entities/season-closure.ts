/** A local review confirmation, never an external certification or editing lock. */
export interface SeasonClosureRecord {
  readonly schemaVersion: 1;
  readonly universeId: string | null;
  readonly foundation: string;
  readonly championTeamId: string;
}

export function isSeasonClosureRecord(value: unknown): value is SeasonClosureRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1
    && (record.universeId === null || typeof record.universeId === "string" && record.universeId.length > 0)
    && typeof record.foundation === "string" && record.foundation.length > 0
    && typeof record.championTeamId === "string" && record.championTeamId.length > 0;
}

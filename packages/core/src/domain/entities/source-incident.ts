/** Immutable revisions are stored as optional activity payloads in JSON v7. */
export interface SourceMatchSnapshot {
  readonly round: number;
  readonly phase?: string;
  readonly published: string;
  readonly matchId: string;
}
export interface SourceCorrection {
  readonly original: SourceMatchSnapshot;
  readonly replacement: { readonly homeTeamName: string; readonly awayTeamName: string;
    readonly homeGoals?: number; readonly awayGoals?: number };
  readonly documentUrl: string;
  readonly reference: string;
  readonly confirmed: true;
}
export interface SourceIncident {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly revision: number;
  readonly competitionId: string;
  readonly competitionName: string;
  readonly season: number;
  readonly provider: string;
  readonly sourceUrl: string;
  readonly type: "repeated-home" | "invalid-source-data";
  readonly reason: string;
  readonly detectedAt: string;
  readonly status: "pending" | "provisional" | "verified" | "stale" | "provider-corrected" | "revoked";
  readonly origin: "automatic" | "manual";
  readonly matches: readonly SourceMatchSnapshot[];
  readonly corrections: readonly SourceCorrection[];
  readonly reviewNote?: string;
}
export function canonicalSourceValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalSourceValue).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalSourceValue(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): value is string { return typeof value === "string" && !!value.trim(); }
export function isDocumentUrl(value: unknown): value is string {
  try { const url = new URL(String(value)); return url.protocol === "https:" && !url.username && !url.password; }
  catch { return false; }
}
export function isSourceMatchSnapshot(value: unknown): value is SourceMatchSnapshot {
  if (!object(value) || !Number.isSafeInteger(value.round) || Number(value.round) < 1
    || !text(value.matchId) || (value.phase !== undefined && !text(value.phase)) || !text(value.published)) return false;
  try { const match = JSON.parse(value.published); return object(match) && match.id === value.matchId
    && text(match.homeTeamName) && text(match.awayTeamName); } catch { return false; }
}
export function isSourceCorrection(value: unknown): value is SourceCorrection {
  if (!object(value) || !isSourceMatchSnapshot(value.original) || !object(value.replacement)
    || !isDocumentUrl(value.documentUrl) || !text(value.reference) || value.confirmed !== true) return false;
  const r = value.replacement;
  return Object.keys(r).every(k => ["homeTeamName", "awayTeamName", "homeGoals", "awayGoals"].includes(k))
    && text(r.homeTeamName) && text(r.awayTeamName) && r.homeTeamName !== r.awayTeamName
    && ((r.homeGoals === undefined && r.awayGoals === undefined)
      || [r.homeGoals, r.awayGoals].every(n => Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= 99));
}
export function isSourceIncident(value: unknown): value is SourceIncident {
  return object(value) && value.schemaVersion === 1 && text(value.id) && Number.isSafeInteger(value.revision)
    && Number(value.revision) >= 1 && text(value.competitionId) && text(value.competitionName)
    && Number.isSafeInteger(value.season) && Number(value.season) > 0 && text(value.provider)
    && isDocumentUrl(value.sourceUrl) && ["repeated-home", "invalid-source-data"].includes(String(value.type))
    && text(value.reason) && text(value.detectedAt) && Number.isFinite(Date.parse(value.detectedAt))
    && ["pending", "provisional", "verified", "stale", "provider-corrected", "revoked"].includes(String(value.status))
    && ["automatic", "manual"].includes(String(value.origin))
    && Array.isArray(value.matches) && value.matches.every(isSourceMatchSnapshot)
    && Array.isArray(value.corrections) && value.corrections.every(isSourceCorrection)
    && new Set(value.corrections.map(c => c.original.matchId)).size === value.corrections.length
    && value.corrections.every(c => (value.matches as SourceMatchSnapshot[]).some((m: SourceMatchSnapshot) => canonicalSourceValue(m) === canonicalSourceValue(c.original)))
    && (value.status !== "verified" || (value.origin === "manual" && value.corrections.length > 0))
    && (value.reviewNote === undefined || text(value.reviewNote));
}

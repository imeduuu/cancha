import type { Tournament } from "../entities/tournament";
import type { OfficialReference, OfficialResolution, OfficialResolutionContext, OfficialResolutionScope } from "../entities/official-resolution";
import { secondDivisionKind } from "./second-division-rules";

export function makeResolutionContext(tournament: Tournament, scope: OfficialResolutionScope, key: string,
  title: string, participantIds: readonly string[], metrics: unknown): OfficialResolutionContext {
  const ids = [...participantIds].sort();
  const dependencies = tournament.matchdays.filter(day => day.phaseName === "Fase regular")
    .flatMap(day => day.fixtures).filter(f => ids.includes(f.homeTeamId) || ids.includes(f.awayTeamId))
    .map(f => ({ id: f.id, home: f.homeTeamId, away: f.awayTeamId, result: f.result ?? null,
      status: f.operationalState?.status ?? (f.result ? "finished" : f.schedule?.date && f.schedule.time ? "scheduled" : "unscheduled"),
      ...(scope === "brasil-table" ? { coverage: f.eventsCoverage ?? null,
        cards: (f.events ?? []).filter(e => e.type === "red-card" || e.type === "yellow-card")
          .map(e => ({ teamId: e.teamId, type: e.type })).sort((a, b) => `${a.teamId}${a.type}`.localeCompare(`${b.teamId}${b.type}`)) } : {}),
    })).sort((a, b) => a.id.localeCompare(b.id));
  return { scope, key, title, participantIds: ids, dependencySnapshot: JSON.stringify({
    season: tournament.season, competition: tournament.competitionId ?? tournament.id.replace(/-2026$/, ""),
    scope, key, metrics, teams: tournament.teams.filter(team => ids.includes(team.id))
      .map(team => ({ id: team.id, group: team.groupName ?? null })).sort((a, b) => a.id.localeCompare(b.id)),
    points: tournament.pointsSystem ?? tournament.competitionRules?.points ?? { win: 3, draw: 1, loss: 0 },
    tieBreakers: tournament.competitionRules?.tieBreakers ?? tournament.tieBreakers, dependencies,
  }) };
}
export function sameParticipants(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && new Set(a).size === a.length && a.every(id => b.includes(id));
}
export function currentResolution(tournament: Tournament, context: OfficialResolutionContext): OfficialResolution | undefined {
  return [...(tournament.officialResolutions ?? [])].reverse().find(record => !record.invalidation && !record.supersededBy
    && record.scope === context.scope && record.key === context.key
    && sameParticipants(record.participantIds, context.participantIds)
    && record.dependencySnapshot === context.dependencySnapshot);
}
export function verifiedDrawOrder(tournament: Tournament, context: OfficialResolutionContext): readonly string[] | undefined {
  const record = currentResolution(tournament, context);
  return record?.verification === "verified" && record.orderedTeamIds
    && sameParticipants(record.orderedTeamIds, context.participantIds) ? record.orderedTeamIds : undefined;
}
export function isOfficialReference(value: unknown, country: "argentina" | "brasil"): value is OfficialReference {
  if (!value || typeof value !== "object") return false;
  const ref = value as OfficialReference;
  if (typeof ref.reference !== "string" || !ref.reference.trim() || ref.reference.length > 1000 || typeof ref.url !== "string") return false;
  try {
    const url = new URL(ref.url);
    return url.protocol === "https:" && (country === "argentina"
      ? url.hostname === "afa.com.ar" || url.hostname.endsWith(".afa.com.ar")
      : url.hostname === "cbf.com.br" || url.hostname.endsWith(".cbf.com.br") || url.hostname === "stcbfsiteprdimgbrs.blob.core.windows.net");
  } catch { return false; }
}
export function resolutionCountry(tournament: Tournament): "argentina" | "brasil" | undefined {
  return secondDivisionKind(tournament);
}

export function multipleRelegationContext(tournament: Tournament,
  rows: readonly { readonly teamId: string; readonly points: number }[]): OfficialResolutionContext | undefined {
  if (secondDivisionKind(tournament) !== "argentina" || rows.length !== 18 || rows[15].points !== rows[16].points) return undefined;
  const tied = rows.filter(row => row.points === rows[16].points);
  if (tied.length <= 2) return undefined;
  const zone = tournament.zoneName ?? tournament.teams.find(team => team.id === rows[0].teamId)?.groupName;
  if (zone !== "Zona A" && zone !== "Zona B") return undefined;
  return makeResolutionContext(tournament, "argentina-relegation", zone, `Desempate múltiple de descenso · ${zone}`,
    tied.map(row => row.teamId), [...tied].sort((a, b) => a.teamId.localeCompare(b.teamId)));
}

import { canonicalSourceValue, isSourceIncident, isSourceCorrection,
  type SourceIncident, type SourceCorrection, type SourceMatchSnapshot } from "../../domain/entities/source-incident";
import { normalizeTeamName } from "../../domain/services/team-name";
import type { OfficialLeagueSeason, OfficialMatch } from "../ports/official-league-source";
import type { TournamentRepository } from "../ports/tournament-repository";
import { createActivityEvent, recordActivity } from "./activity-log";

export function listSourceIncidents(repository: TournamentRepository): SourceIncident[] {
  const latest = new Map<string, SourceIncident>();
  for (const event of repository.findActivity?.() ?? []) {
    if (event.action !== "source-incident-reviewed" || !isSourceIncident(event.after)) continue;
    const old = latest.get(event.after.id);
    if (!old || old.revision < event.after.revision) latest.set(event.after.id, event.after);
    else if (old.revision === event.after.revision && canonicalSourceValue(old) !== canonicalSourceValue(event.after)) {
      throw new Error("El historial contiene revisiones contradictorias de una incidencia.");
    }
  }
  return [...latest.values()];
}
function append(repository: TournamentRepository, incident: SourceIncident): SourceIncident {
  if (!isSourceIncident(incident)) throw new Error("La incidencia o su documentación no es válida.");
  recordActivity(repository, createActivityEvent({ id: incident.competitionId,
    name: incident.competitionName, season: incident.season }, {
    action: "source-incident-reviewed", entityId: incident.id, entityType: "tournament",
    summary: `Incidencia de ${incident.provider}: ${incident.status}. ${incident.reason}`,
    after: structuredClone(incident),
  }));
  return incident;
}
function snapshots(season: OfficialLeagueSeason): SourceMatchSnapshot[] {
  return season.matchdays.flatMap(day => day.matches.map(match => ({ round: day.number,
    ...(day.phaseName ? { phase: day.phaseName } : {}), matchId: match.id, published: canonicalSourceValue(match) })));
}
export function recordSourceRejection(repository: TournamentRepository, season: OfficialLeagueSeason, reason: string): void {
  // A minimal repository used for a dry run can omit activity; never bypass sports validation.
  if (!repository.recordActivity || !repository.findActivity) return;
  if (!season?.id || !Number.isSafeInteger(season.season) || !Array.isArray(season.matchdays)) return;
  let matches: SourceMatchSnapshot[];
  try { matches = snapshots(season); } catch { return; }
  const repeated = matches.filter((match, i, all) => {
    const m = JSON.parse(match.published);
    return all.some((other, j) => {
      if (i === j || match.phase !== other.phase) return false;
      const o = JSON.parse(other.published);
      if (![m.homeTeamName, m.awayTeamName, o.homeTeamName, o.awayTeamName].every(n => typeof n === "string")) return false;
      return normalizeTeamName(m.homeTeamName ?? "") === normalizeTeamName(o.homeTeamName ?? "")
        && normalizeTeamName(m.awayTeamName ?? "") === normalizeTeamName(o.awayTeamName ?? "");
    });
  });
  if (repeated.length) matches = repeated;
  const incident: SourceIncident = { schemaVersion: 1, id: crypto.randomUUID(), revision: 1,
    competitionId: season.id, competitionName: season.name, season: season.season,
    provider: season.sourceName ?? "Proveedor externo", sourceUrl: season.sourceUrl,
    type: repeated.length ? "repeated-home" : "invalid-source-data", reason,
    detectedAt: new Date().toISOString(), status: "pending", origin: "automatic", matches, corrections: [] };
  if (!isSourceIncident(incident)) return; // Malformed provider envelopes cannot become trusted corrections.
  const existing = listSourceIncidents(repository).some(old => old.competitionId === incident.competitionId
    && old.season === incident.season && old.sourceUrl === incident.sourceUrl && old.provider === incident.provider
    && !["stale", "provider-corrected", "revoked"].includes(old.status)
    && old.reason === reason && canonicalSourceValue(old.matches) === canonicalSourceValue(matches));
  if (!existing) append(repository, incident);
}
export function reviewSourceIncident(repository: TournamentRepository, id: string, revision: number,
  corrections: readonly SourceCorrection[], verified: boolean, confirmed: boolean, note: string): SourceIncident {
  const old = listSourceIncidents(repository).find(item => item.id === id);
  if (!old || old.revision !== revision) throw new Error("La incidencia cambió. Revisa la versión actual.");
  if (!confirmed || !note.trim() || !corrections.length || !corrections.every(isSourceCorrection)) {
    throw new Error("Se requiere confirmación explícita, motivo y documentación HTTPS para cada corrección.");
  }
  if (old.status === "stale" || old.status === "provider-corrected") {
    throw new Error("La fuente cambió: vuelve a consultar e importa su registro actual antes de corregirlo.");
  }
  return append(repository, { ...old, revision: old.revision + 1, corrections: structuredClone(corrections),
    status: verified ? "verified" : "provisional", origin: "manual", reviewNote: note.trim() });
}
export function revokeSourceIncident(repository: TournamentRepository, id: string, revision: number, note: string): void {
  const old = listSourceIncidents(repository).find(item => item.id === id);
  if (!old || old.revision !== revision || !note.trim()) throw new Error("Revisa la incidencia e indica el motivo de revocación.");
  append(repository, { ...old, revision: old.revision + 1, status: "revoked", origin: "manual", reviewNote: note.trim() });
}
function corrected(match: OfficialMatch, correction: SourceCorrection): OfficialMatch {
  const { homeGoals: _home, awayGoals: _away, ...rest } = match;
  return { ...rest, ...correction.replacement };
}
/** Returns a new envelope. Never mutates provider data or stored tournaments. */
export function applySourceCorrections(repository: TournamentRepository, original: OfficialLeagueSeason): OfficialLeagueSeason {
  const candidates = listSourceIncidents(repository).filter(i => i.status === "verified"
    && i.competitionId === original?.id && i.season === original?.season);
  if (!candidates.length) return original;
  const current = snapshots(original);
  const applicable: SourceCorrection[] = [];
  for (const incident of candidates) {
    if (incident.sourceUrl !== original.sourceUrl || incident.provider !== (original.sourceName ?? "Proveedor externo")) {
      append(repository, { ...incident, revision: incident.revision + 1, status: "stale", origin: "automatic",
        reviewNote: "Cambió el proveedor o la URL de publicación. Se requiere una nueva revisión." });
      continue;
    }
    const states = incident.corrections.map(c => {
      const m = current.find(m => m.matchId === c.original.matchId);
      if (!m || m.round !== c.original.round || m.phase !== c.original.phase) return "changed";
      if (m.published === c.original.published) return "original";
      return m.published === canonicalSourceValue(corrected(JSON.parse(c.original.published), c)) ? "corrected" : "changed";
    });
    if (states.some(s => s !== "original")) {
      append(repository, { ...incident, revision: incident.revision + 1,
        status: states.every(s => s === "corrected") ? "provider-corrected" : "stale",
        origin: "automatic", reviewNote: "La publicación cambió. La revisión anterior dejó de aplicarse." });
      continue;
    }
    for (const c of incident.corrections) {
      const prior = applicable.find(p => p.original.matchId === c.original.matchId);
      if (prior && canonicalSourceValue(prior.replacement) !== canonicalSourceValue(c.replacement)) {
        throw new Error("Hay correcciones verificadas contradictorias para el mismo encuentro. Revoca una antes de importar.");
      }
      if (!prior) applicable.push(c);
    }
  }
  if (!applicable.length) return original;
  return { ...original, matchdays: original.matchdays.map(day => ({ ...day, matches: day.matches.map(match => {
    const correction = applicable.find(c => c.original.matchId === match.id);
    return correction ? corrected(match, correction) : match;
  }) })) };
}

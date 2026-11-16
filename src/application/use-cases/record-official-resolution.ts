import type { Tournament, RulesVerificationStatus } from "../../domain/entities/tournament";
import type { OfficialProgramme, OfficialReference, OfficialResolutionContext } from "../../domain/entities/official-resolution";
import type { TournamentRepository } from "../ports/tournament-repository";
import { advanceSecondDivision, getOfficialResolutionContexts } from "../../domain/services/second-division-progression";
import { currentResolution, sameParticipants } from "../../domain/services/official-resolution-core";
import { isOfficialResolution } from "../../domain/services/official-resolution-validation";
import { programmeConclusionIssue } from "../../domain/services/official-programme";
import { validateTournamentIntegrity } from "../../domain/services/tournament-integrity";
import { createActivityEvent, saveWithActivity } from "../services/activity-log";

export interface RecordOfficialResolutionInput {
  readonly context: OfficialResolutionContext;
  readonly verification: RulesVerificationStatus;
  readonly source: OfficialReference;
  readonly orderedTeamIds?: readonly string[];
  readonly programme?: OfficialProgramme;
  readonly verifiedByUser: boolean;
}
export function recordOfficialResolution(tournament: Tournament, input: RecordOfficialResolutionInput,
  repository: TournamentRepository, now: () => Date = () => new Date(), createId: () => string = () => crypto.randomUUID(),
  options: {readonly advanceProgression?: boolean} = {}): Tournament {
  const stored = repository.findAll().find(item => item.id === tournament.id);
  if (!stored || JSON.stringify(stored) !== JSON.stringify(tournament)) throw new Error("El torneo cambió; vuelve a consultar los desempates antes de guardar.");
  const context = getOfficialResolutionContexts(tournament).find(context => context.scope === input.context.scope
    && context.key === input.context.key && context.dependencySnapshot === input.context.dependencySnapshot
    && sameParticipants(context.participantIds, input.context.participantIds));
  if (!context) throw new Error("El desempate ya no corresponde a los participantes o criterios actuales.");
  if (input.verification === "verified" && !input.verifiedByUser)
    throw new Error("Confirma que contrastaste los datos con la fuente oficial antes de verificarlos.");
  const id = createId();
  if (!id.trim() || tournament.officialResolutions?.some(record => record.id === id)) throw new Error("El identificador de resolución no es único.");
  const resolution = {
    schemaVersion: 1 as const, id, scope: context.scope, key: context.key, participantIds: [...context.participantIds],
    participantNames: context.participantIds.map(teamId => ({ teamId, name: tournament.teams.find(team => team.id === teamId)!.name })),
    dependencySnapshot: context.dependencySnapshot, verification: input.verification, source: { ...input.source }, recordedAt: now().toISOString(),
    ...(input.orderedTeamIds ? { orderedTeamIds: [...input.orderedTeamIds] } : {}),
    ...(input.programme ? { programme: JSON.parse(JSON.stringify(input.programme)) as OfficialProgramme } : {}),
  };
  if (!isOfficialResolution(resolution)) throw new Error("Revisa los participantes, el orden, la fuente oficial y los partidos del desempate.");
  if (resolution.programme) {
    const issue = programmeConclusionIssue(tournament, context, resolution.programme);
    if (issue) throw new Error(issue);
  }
  const previous = currentResolution(tournament, context);
  const records = (tournament.officialResolutions ?? []).map(record => record.id === previous?.id ? { ...record, supersededBy: id } : record);
  const registered = { ...tournament, officialResolutions: [...records, resolution] };
  const next = options.advanceProgression === false ? registered : advanceSecondDivision(registered);
  const issues = validateTournamentIntegrity(next);
  if (issues.length) throw new Error(issues[0]);
  saveWithActivity(repository, next, createActivityEvent(tournament, {
    action: "official-resolution-recorded", entityType: "tournament", entityId: id,
    summary: `Se registró ${context.title} (${input.verification === "verified" ? "verificado por el usuario" : input.verification === "provisional" ? "provisional" : "pendiente"}).`,
    before: previous ?? null, after: resolution,
  }, now));
  return next;
}
export function revokeOfficialResolution(tournament: Tournament, resolutionId: string, reason: string,
  repository: TournamentRepository, now: () => Date = () => new Date()): Tournament {
  const stored = repository.findAll().find(item => item.id === tournament.id);
  if (!stored || JSON.stringify(stored) !== JSON.stringify(tournament)) throw new Error("El torneo cambió; vuelve a consultar sus resoluciones.");
  const record = tournament.officialResolutions?.find(item => item.id === resolutionId);
  if (!record || record.invalidation || record.supersededBy) throw new Error("Selecciona una resolución vigente.");
  if (!reason.trim()) throw new Error("Indica por qué se revoca la resolución.");
  const next = advanceSecondDivision({ ...tournament, officialResolutions: tournament.officialResolutions!.map(item =>
    item.id === resolutionId ? { ...item, invalidation: { at: now().toISOString(), reason: reason.trim() } } : item) });
  saveWithActivity(repository, next, createActivityEvent(tournament, { action: "official-resolution-revoked", entityType: "tournament",
    entityId: resolutionId, summary: "Se revocó una resolución oficial sin eliminar su historial.", before: record, after: { reason: reason.trim() } }, now));
  return next;
}

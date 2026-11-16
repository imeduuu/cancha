import type { Tournament } from "../../domain/entities/tournament";
import type { TournamentRepository } from "../ports/tournament-repository";
import { secondDivisionKind } from "../../domain/services/second-division-rules";
import { validateTournamentIntegrity } from "../../domain/services/tournament-integrity";
import { createActivityEvent, saveWithActivity } from "../services/activity-log";

export function updateTeamAffiliation(tournament: Tournament, teamId: string,
  affiliation: "direct" | "indirect", sourceUrl: string, repository: TournamentRepository): Tournament {
  if (secondDivisionKind(tournament) !== "argentina" || !tournament.teams.some(team => team.id === teamId))
    throw new Error("Selecciona un club de Primera Nacional.");
  let url: URL;
  try { url = new URL(sourceUrl); } catch { throw new Error("Registra una fuente AFA de la afiliación."); }
  if (url.protocol !== "https:" || !(url.hostname === "afa.com.ar" || url.hostname.endsWith(".afa.com.ar")))
    throw new Error("La fuente de afiliación debe ser una página HTTPS de AFA.");
  const next = { ...tournament, teams: tournament.teams.map(team => team.id === teamId
    ? { ...team, afaAffiliation: affiliation, affiliationSourceUrl: url.href } : team) };
  const issues = validateTournamentIntegrity(next);
  if (issues.length) throw new Error(issues[0]);
  saveWithActivity(repository, next, createActivityEvent(next, { action: "roster-updated", entityType: "tournament",
    summary: "Se registró la afiliación AFA de un club para determinar su destino de descenso.",
    before: tournament.teams.find(team => team.id === teamId), after: next.teams.find(team => team.id === teamId) }));
  return next;
}

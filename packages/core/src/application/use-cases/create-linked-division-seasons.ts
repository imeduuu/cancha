import type { Tournament } from "../../domain/entities/tournament";
import type { Team } from "../../domain/entities/team";
import type { TournamentRepository } from "../ports/tournament-repository";
import { getDivisionTransition } from "../../domain/services/division-season-transition";
import { validateTournamentIntegrity } from "../../domain/services/tournament-integrity";
import { normalizeTeamName } from "../../domain/services/team-name";
import { createActivityEvent } from "../services/activity-log";

/** Creates roster planning snapshots; the future draw/calendar and rules stay pending. */
export function createLinkedDivisionSeasons(upper: Tournament, lower: Tournament,
  incoming: readonly Team[], sourceUrl: string, repository: TournamentRepository,
  createId: () => string = () => crypto.randomUUID(), now: () => Date = () => new Date()): readonly Tournament[] {
  const stored = repository.findAll();
  const currentUpper = stored.find(item => item.id === upper.id);
  const currentLower = stored.find(item => item.id === lower.id);
  if (JSON.stringify(currentUpper) !== JSON.stringify(upper) || JSON.stringify(currentLower) !== JSON.stringify(lower))
    throw new Error("Los torneos cambiaron; vuelve a revisar los movimientos antes de crear temporadas.");
  const transition = getDivisionTransition(upper, lower, stored);
  if (transition.pending.length) throw new Error(transition.pending.join(" "));
  if (incoming.length !== transition.lowerRelegated.length)
    throw new Error(`Registra los ${transition.lowerRelegated.length} ascendidos desde las categorías inferiores.`);
  let url: URL;
  try { url = new URL(sourceUrl); } catch { throw new Error("Registra la fuente de los ascendidos desde categorías inferiores."); }
  if (url.protocol !== "https:") throw new Error("La fuente debe usar HTTPS.");
  if (!repository.saveManyWithActivity) throw new Error("El repositorio no permite guardar ambas temporadas con historial coordinado.");
  const season = upper.season! + 1;
  const ids = new Set(stored.flatMap(item => [item.id, ...item.teams.map(team => team.id),
    ...item.matchdays.flatMap(day => day.fixtures.map(fixture => fixture.id))]));
  const uniqueId = () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const id = createId(); if (id.trim() && !ids.has(id)) { ids.add(id); return id; }
    }
    throw new Error("No se pudo crear un identificador único.");
  };
  const up = lower.teams.filter(team => transition.promoted.includes(team.id));
  const down = upper.teams.filter(team => transition.upperRelegated.includes(team.id));
  const upperTeams = [...upper.teams.filter(team => !transition.upperRelegated.includes(team.id)), ...up];
  const lowerTeams = [...lower.teams.filter(team => !transition.promoted.includes(team.id)
    && !transition.lowerRelegated.includes(team.id)), ...down, ...incoming];
  const create = (source: Tournament, teams: readonly Team[]): Tournament => {
    const competitionId = source.competitionId ?? source.id.replace(/-2026$/, "");
    if (stored.some(item => item.competitionId === competitionId && item.season === season))
      throw new Error(`Ya existe una temporada ${season} de esta competición.`);
    const names = teams.map(team => normalizeTeamName(team.name));
    if (new Set(names).size !== teams.length || names.some(name => !name))
      throw new Error("Los participantes de la nueva temporada contienen nombres vacíos o duplicados.");
    const next: Tournament = {
      id: uniqueId(), competitionId, season, name: `${source.name.replace(/\s+\d{4}$/, "")} ${season}`,
      teams: teams.map(({ groupName: _group, competitionNumber: _number, ...team }) => ({ ...team, id: uniqueId() })),
      seasonPreparation: { schemaVersion: 1, sourceTournamentIds: [upper.id, lower.id], plannedParticipants: teams.map(team => team.name), calendarReviews: [] },
      legs: 1, tieBreakers: [], matchdays: [], createdAt: now().toISOString(),
      format: "staged", competitionType: "league", importCoverage: "unknown",
      rulesNote: `Planificación local: participantes actualizados desde ${source.name}. Calendario, zonas y reglamento ${season} pendientes; no es un fixture oficial. Ascendidos inferiores registrados por el usuario: ${url.href}`,
      competitionRules: { season, verification: { standings: "pending", placements: "pending" },
        standingsNote: "Reglamento y calendario pendientes de verificar para la nueva temporada.",
        placementsNote: "No se heredan automáticamente ascensos ni descensos de 2026." },
    };
    const issues = validateTournamentIntegrity(next);
    if (issues.length) throw new Error(issues[0]);
    return next;
  };
  const next = [create(upper, upperTeams), create(lower, lowerTeams)];
  const identities = next.flatMap(item => item.teams.map(team => normalizeTeamName(team.averageIdentity ?? team.name)));
  if (new Set(identities).size !== identities.length) throw new Error("Un club no puede participar en ambas divisiones de la nueva temporada.");
  repository.saveManyWithActivity(next, createActivityEvent(next[0], {
    action: "season-created", entityType: "season", summary: `Se planificaron ambas divisiones para ${season}, conservando las temporadas anteriores.`,
    before: { upperId: upper.id, lowerId: lower.id }, after: { tournamentIds: next.map(item => item.id), ...transition },
  }, now));
  return next;
}

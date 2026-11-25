import { DomainError } from "../../domain/domain-error.js";
import type { Tournament } from "../../domain/entities/tournament";
import type { Team } from "../../domain/entities/team";
import type { TournamentRepository } from "../ports/tournament-repository";
import { getDivisionTransition } from "../../domain/services/division-season-transition";
import { validateTournamentIntegrity } from "../../domain/services/tournament-integrity";
import { normalizeTeamName } from "../../domain/services/team-name";
import { createActivityEvent } from "../services/activity-log";
import { isChileanAscenso } from "../../domain/services/chilean-ascenso-playoff-progression";
import { regularRounds, withGeneratedCalendar } from "./generate-season-calendar";

/** Creates roster planning snapshots; the future draw/calendar and rules stay pending. */
export function createLinkedDivisionSeasons(upper: Tournament, lower: Tournament,
  incoming: readonly Team[], sourceUrl: string, repository: TournamentRepository,
  createId: () => string = () => crypto.randomUUID(), now: () => Date = () => new Date(),
  options: { readonly simulated?: boolean } = {}): readonly Tournament[] {
  const stored = repository.findAll();
  const currentUpper = stored.find(item => item.id === upper.id);
  const currentLower = stored.find(item => item.id === lower.id);
  if (JSON.stringify(currentUpper) !== JSON.stringify(upper) || JSON.stringify(currentLower) !== JSON.stringify(lower))
    throw new DomainError("Los torneos cambiaron; vuelve a revisar los movimientos antes de crear temporadas.");
  const transition = getDivisionTransition(upper, lower, stored);
  if (transition.pending.length) throw new DomainError(transition.pending.join(" "));
  if (incoming.length !== transition.lowerRelegated.length)
    throw new DomainError(`Registra los ${transition.lowerRelegated.length} ascendidos desde las categorías inferiores.`);
  // A simulated scenario (confirmed simulated closures) may omit the external reference of user-provided clubs.
  let url: URL | undefined;
  if (sourceUrl.trim() || !options.simulated) {
    try { url = new URL(sourceUrl); } catch { throw new DomainError("Registra la fuente de los ascendidos desde categorías inferiores."); }
    if (url.protocol !== "https:") throw new DomainError("La fuente debe usar HTTPS.");
  }
  const chile = isChileanAscenso(lower);
  if (!repository.saveManyWithActivity) throw new DomainError("El repositorio no permite guardar ambas temporadas con historial coordinado.");
  const season = upper.season! + 1;
  const ids = new Set(stored.flatMap(item => [item.id, ...item.teams.map(team => team.id),
    ...item.matchdays.flatMap(day => day.fixtures.map(fixture => fixture.id))]));
  const uniqueId = () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const id = createId(); if (id.trim() && !ids.has(id)) { ids.add(id); return id; }
    }
    throw new DomainError("No se pudo crear un identificador único.");
  };
  const up = lower.teams.filter(team => transition.promoted.includes(team.id));
  const down = upper.teams.filter(team => transition.upperRelegated.includes(team.id));
  const upperTeams = [...upper.teams.filter(team => !transition.upperRelegated.includes(team.id)), ...up];
  const lowerTeams = [...lower.teams.filter(team => !transition.promoted.includes(team.id)
    && !transition.lowerRelegated.includes(team.id)), ...down, ...incoming];
  const create = (source: Tournament, teams: readonly Team[]): Tournament => {
    const competitionId = source.competitionId ?? source.id.replace(/-2026$/, "");
    if (stored.some(item => item.competitionId === competitionId && item.season === season))
      throw new DomainError(`Ya existe una temporada ${season} de esta competición.`);
    const names = teams.map(team => normalizeTeamName(team.name));
    if (new Set(names).size !== teams.length || names.some(name => !name))
      throw new DomainError("Los participantes de la nueva temporada contienen nombres vacíos o duplicados.");
    const next: Tournament = {
      id: uniqueId(), competitionId, season, name: `${source.name.replace(/\s+\d{4}$/, "")} ${season}`,
      teams: teams.map(({ groupName: _group, competitionNumber: _number, ...team }) => ({ ...team, id: uniqueId() })),
      seasonPreparation: { schemaVersion: 1, sourceTournamentIds: [upper.id, lower.id], plannedParticipants: teams.map(team => team.name), calendarReviews: [] },
      // Chile keeps its tie-breakers: without criteria every points tie would block the 2027 closure.
      legs: 1, tieBreakers: chile ? source.tieBreakers : [], matchdays: [], createdAt: now().toISOString(),
      format: "staged", competitionType: "league", importCoverage: "unknown",
      // Chile keeps its single-table format: the placement zones carry over to the next season.
      ...(chile && source.placementRules ? { placementRules: source.placementRules } : {}),
      rulesNote: `Planificación local: participantes actualizados desde ${source.name}. ${chile ? `Calendario local generado (todos contra todos, ${regularRounds(source)} ruedas, sin fechas); reglamento ${season} pendiente; no es un fixture oficial.` : `Calendario, zonas y reglamento ${season} pendientes; no es un fixture oficial.`} ${url ? `Ascendidos inferiores registrados por el usuario: ${url.href}` : "Escenario simulado: ascendidos inferiores aportados por el usuario, sin referencia externa."}`,
      competitionRules: { season, verification: { standings: "pending", placements: "pending" },
        standingsNote: "Reglamento y calendario pendientes de verificar para la nueva temporada.",
        placementsNote: "No se heredan automáticamente ascensos ni descensos de 2026." },
    };
    const issues = validateTournamentIntegrity(next);
    if (issues.length) throw new DomainError(issues[0]);
    // Chile: a local round-robin calendar with the same rounds as the source's regular phase, ready to simulate.
    return chile ? withGeneratedCalendar(next, regularRounds(source), uniqueId) : next;
  };
  const next = [create(upper, upperTeams), create(lower, lowerTeams)];
  const identities = next.flatMap(item => item.teams.map(team => normalizeTeamName(team.averageIdentity ?? team.name)));
  if (new Set(identities).size !== identities.length) throw new DomainError("Un club no puede participar en ambas divisiones de la nueva temporada.");
  repository.saveManyWithActivity(next, createActivityEvent(next[0], {
    action: "season-created", entityType: "season", summary: `Se planificaron ambas divisiones para ${season}, conservando las temporadas anteriores.`,
    before: { upperId: upper.id, lowerId: lower.id }, after: { tournamentIds: next.map(item => item.id), ...transition,
      ...(chile ? { calendar: { provenance: "local-generated", matchdays: next.map(item => item.matchdays.length),
        fixtures: next.map(item => item.matchdays.reduce((count, day) => count + day.fixtures.length, 0)) } } : {}) },
  }, now));
  return next;
}

import { DomainError } from "../../domain/domain-error.js";
import type { Tournament } from "../../domain/entities/tournament";
import type { TournamentRepository } from "../ports/tournament-repository";
import { simulateFixtures } from "./simulate-fixtures";
import { validateTournamentIntegrity } from "../../domain/services/tournament-integrity";
import { getCompetitionAlerts } from "../../domain/services/competition-alerts";
import { isOperationalStateSimulationBlocked } from "../../domain/services/match-operational-status";
import { projectSeasonProgression } from "../services/season-progression";
import { advanceTournamentProgress } from "./advance-tournament-progress";
import type { ActivityEvent } from "../../domain/entities/activity-event";

export type SeasonSimulationScope =
  | { kind: "matchday"; index: number }
  | { kind: "leg"; leg: number }
  | { kind: "phase"; name: string }
  | { kind: "competition" };

export interface SeasonSimulationPreview {
  readonly tournamentId: string;
  readonly universeId: string | null;
  readonly scope: SeasonSimulationScope;
  readonly fixtureIds: readonly string[];
  readonly preservedIds: readonly string[];
  readonly matchdays: readonly string[];
  readonly blockers: readonly string[];
}
const reviews = new WeakMap<SeasonSimulationPreview, string>();
function snapshot(tournaments: readonly Tournament[], repository: TournamentRepository) {
  return JSON.stringify([tournaments, repository.findActivity?.() ?? []]);
}

/** Read-only review. No random source, progression or persistence is invoked here. */
export function previewSeasonSimulation(
  tournamentId: string, scope: SeasonSimulationScope, universeId: string | null,
  repository: TournamentRepository,
): SeasonSimulationPreview {
  const tournaments = repository.findAll();
  const t = tournaments.find(item => item.id === tournamentId);
  if (!t) throw new DomainError("La temporada no está disponible en el universo activo.");
  const blockers = validateTournamentIntegrity(t);
  if (t.archived) blockers.push("La temporada está archivada.");
  if (!t.format && !t.competitionType) blockers.push("Registra el formato de la competición antes de simular.");
  const rules = t.competitionRules;
  if (!rules || rules.season !== t.season || rules.verification.standings !== "verified"
    || rules.verification.placements !== "verified") blockers.push("Revisa y verifica el reglamento de la temporada.");
  if (t.matchRegulations && (t.matchRegulations.verification !== "verified" || t.matchRegulations.season !== t.season))
    blockers.push("El reglamento de partidos está pendiente.");
  if (t.nationalCupPlanning?.requiresReview) blockers.push("La planificación nacional requiere revisión documental expresa.");
  for (const plan of t.continentalPlans ?? []) {
    if (plan.mode === "incorporated" && (plan.pendingReasons?.length || plan.entries.some(e => e.status !== "confirmed")))
      blockers.push("La planificación continental tiene clasificaciones o decisiones documentales pendientes.");
  }
  for (const review of t.nationalCupPlanning?.reviews ?? []) {
    if (review.mode === "incorporated" && (review.regulation.verification !== "verified"
      || review.participants.some(p => p.status !== "confirmed")))
      blockers.push("La admisión nacional tiene participantes o reglamentos pendientes.");
  }
  if (!t.matchdays.some(d => d.fixtures.length)) blockers.push("La temporada no tiene calendario.");
  const selected = t.matchdays.filter((d, index) => scope.kind === "competition"
    || scope.kind === "matchday" && index === scope.index
    || scope.kind === "leg" && d.leg === scope.leg
    || scope.kind === "phase" && d.phaseName === scope.name);
  if (!selected.length) blockers.push("El alcance no corresponde a una etapa registrada.");
  const staged = t.format === "staged" || t.competitionType === "cup" || Boolean(t.knockoutStages?.length)
    || t.matchdays.some(d => d.phaseName) || t.teams.some(team => team.groupName);
  if (staged && (scope.kind === "competition" || scope.kind === "leg"))
    blockers.push("Este formato requiere avanzar por jornada o fase registrada; no permite completar toda la competición o rueda.");
  if (t.competitionType === "cup" && !t.knockoutStages?.length) blockers.push("Faltan etapas y reglas de eliminatorias verificadas.");
  const first = t.matchdays.findIndex(d => selected.includes(d));
  if (staged && t.matchdays.slice(0, first).some(d => d.fixtures.some(f => !f.result)))
    blockers.push("Completa la etapa anterior antes de avanzar.");
  if (staged && new Set(selected.map(d => d.phaseName)).size > 1)
    blockers.push("Selecciona una sola fase compatible.");
  for (const a of getCompetitionAlerts(t)) {
    if (["invalid-match", "calendar-incomplete", "regulations-review", "operational-result-mismatch"].includes(a.type))
      blockers.push(a.description);
  }
  const progression = projectSeasonProgression([t.id], tournaments, repository.findActivity?.() ?? []).rows[0];
  blockers.push(...progression.reasons.filter(reason => /dependencia|desempate|decisi|sorteo|participante/i.test(reason)));
  for (const id of t.seasonPreparation?.sourceTournamentIds ?? [])
    if (!tournaments.some(source => source.id === id)) blockers.push(`Dependencia no disponible: ${id}.`);
  const fixtures = selected.flatMap(d => d.fixtures);
  if (fixtures.some(f => !f.result && isOperationalStateSimulationBlocked(f)))
    blockers.push("Hay partidos con estado operativo bloqueado; revísalos en el calendario.");
  const preview: SeasonSimulationPreview = {
    tournamentId, universeId, scope, fixtureIds: fixtures.filter(f => !f.result).map(f => f.id),
    preservedIds: fixtures.filter(f => f.result).map(f => f.id),
    matchdays: selected.map(d => `${d.phaseName ?? `Rueda ${d.leg}`} · Jornada ${d.number}`),
    blockers: [...new Set(blockers)],
  };
  reviews.set(preview, JSON.stringify([preview, snapshot(tournaments, repository)]));
  return preview;
}

export function confirmSeasonSimulation(
  preview: SeasonSimulationPreview, universeId: string | null, repository: TournamentRepository,
  confirmed: boolean, random: () => number = Math.random,
) {
  if (!confirmed) throw new DomainError("Se requiere confirmación explícita.");
  if (preview.universeId !== universeId) throw new DomainError("El universo activo cambió. Revisa nuevamente la simulación.");
  const tournaments = repository.findAll();
  if (reviews.get(preview) !== JSON.stringify([preview, snapshot(tournaments, repository)]))
    throw new DomainError("La confirmación está obsoleta. Genera una nueva vista previa.");
  const current = previewSeasonSimulation(preview.tournamentId, preview.scope, universeId, repository);
  if (current.blockers.length) throw new DomainError(current.blockers.join(" "));
  if (!current.fixtureIds.length) throw new DomainError("No hay partidos pendientes en este alcance.");
  const tournament = tournaments.find(t => t.id === preview.tournamentId)!;
  if (!repository.saveWithActivity) throw new DomainError("El repositorio no garantiza el guardado con actividad.");
  // Stage the existing use cases in memory so cross-cup updates are validated and committed together.
  const staged = new Map(tournaments.map(t => [t.id, t]));
  const events: ActivityEvent[] = [];
  const stagingRepository: TournamentRepository = {
    findAll: () => [...staged.values()],
    save: updated => { staged.set(updated.id, updated); },
    saveWithActivity: (updated, event) => { staged.set(updated.id, updated); events.push(event); },
  };
  const result = simulateFixtures(tournament, current.fixtureIds, "pendingOnly", stagingRepository, random);
  const advanced = advanceTournamentProgress(result.tournament, stagingRepository);
  stagingRepository.save(advanced);
  if (staged.size !== tournaments.length || [...staged.keys()].some(id => !tournaments.some(t => t.id === id)))
    throw new DomainError("La simulación no puede crear nuevas temporadas.");
  const changed = tournaments.flatMap(original => {
    const updated = staged.get(original.id)!;
    if (JSON.stringify(original) === JSON.stringify(updated)) return [];
    const fixtures = new Map(updated.matchdays.flatMap(d => d.fixtures).map(f => [f.id, f]));
    if (original.matchdays.flatMap(d => d.fixtures).some(f => f.result
      && JSON.stringify(fixtures.get(f.id)) !== JSON.stringify(f)))
      throw new DomainError("La progresión afectaría partidos con resultados existentes. Revisa las dependencias antes de simular.");
    const issues = validateTournamentIntegrity(updated);
    if (issues.length) throw new DomainError(issues.join(" "));
    return [updated];
  });
  if (reviews.get(preview) !== JSON.stringify([preview, snapshot(repository.findAll(), repository)]))
    throw new DomainError("La confirmación está obsoleta. Genera una nueva vista previa.");
  const simulationEvent = events[0];
  if (!simulationEvent || !changed.length) throw new DomainError("No se pudo preparar el registro de actividad.");
  if (changed.length > 1) {
    if (!repository.saveManyWithActivity) throw new DomainError("La progresión requiere guardado conjunto con actividad.");
    repository.saveManyWithActivity(changed, {...simulationEvent,
      note: `Progresión deportiva coordinada: ${changed.map(t => t.name).join(", ")}.`,
    });
  } else repository.saveWithActivity(changed[0], simulationEvent);
  reviews.delete(preview);
  return {...result, tournament: advanced};
}

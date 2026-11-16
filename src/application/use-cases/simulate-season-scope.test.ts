import { describe, it, expect, vi, afterEach } from "vitest";
import type { Tournament } from "../../domain/entities/tournament";
import type { ActivityEvent } from "../../domain/entities/activity-event";
import { previewSeasonSimulation, confirmSeasonSimulation, type SeasonSimulationScope } from "./simulate-season-scope";
import { generateRoundRobinSchedule } from "../../domain/services/round-robin-scheduler";
import { calculateTournamentStatistics } from "../../domain/services/tournament-statistics";
import { projectSportsUniverseDashboard } from "../services/sports-universe-dashboard";
import { createTournamentBackup, parseTournamentBackup } from "../services/tournament-archive";
import { matchResultOrigin } from "../services/match-result-origin";
import { LocalStorageTournamentRepository } from "../../infrastructure/persistence/local-storage-tournament-repository";
import { createScopedTournamentRepository } from "../services/sports-universes";
import { continentalCup } from "../../test-utils/journey-competition-fixtures";

function setup() {
  const teams = ["A", "B", "C", "D"].map(id => ({id, name: `Club ${id}`}));
  let t: Tournament = {id: "local", name: "Liga", season: 2026, format: "round-robin", teams, legs: 2,
    tieBreakers: ["goalDifference", "goalsFor"], createdAt: "2026-01-01T00:00:00Z",
    competitionRules: {season: 2026, verification: {standings: "verified", placements: "verified"}},
    matchdays: generateRoundRobinSchedule(teams, 2)};
  const events: ActivityEvent[] = [];
  const repo = {findAll: () => [t], findActivity: () => events, save: vi.fn((next: Tournament) => {t = next;}),
    saveWithActivity: vi.fn((next: Tournament, event: ActivityEvent) => {t = next;events.push(event);})};
  return {repo, events, get: () => t, set: (next: Tournament) => {t = next;}};
}

afterEach(() => vi.unstubAllGlobals());

describe("Centro de simulación", () => {
  it.each<{scope: SeasonSimulationScope; count: number}>([
    {scope: {kind: "matchday", index: 0}, count: 2},
    {scope: {kind: "leg", leg: 1}, count: 6},
    {scope: {kind: "competition"}, count: 12},
  ])("simula el alcance $scope.kind y recalcula estadísticas", ({scope, count}) => {
    const s = setup();
    const preview = previewSeasonSimulation(s.get().id, scope, null, s.repo);
    expect(preview.blockers).toEqual([]);
    expect(s.repo.saveWithActivity).not.toHaveBeenCalled();
    const result = confirmSeasonSimulation(preview, null, s.repo, true, () => 0.3);
    expect(result.simulatedCount).toBe(count);
    expect(calculateTournamentStatistics(result.tournament).played).toBe(count);
    expect(s.events[0].action).toBe("matches-simulated");
    expect(matchResultOrigin(result.tournament, preview.fixtureIds[0], s.events)).toBe("Resultado simulado localmente");
  });
  it("simula una fase registrada sin saltar a otras", () => {
    const s = setup();
    s.set({...s.get(), format: "staged", matchdays: s.get().matchdays.map(d => ({...d, phaseName: d.leg === 1 ? "Inicial" : "Final"}))});
    const p = previewSeasonSimulation("local", {kind: "phase", name: "Inicial"}, null, s.repo);
    expect(p.blockers).toEqual([]);
    expect(confirmSeasonSimulation(p, null, s.repo, true, () => 0.3).simulatedCount).toBe(6);
    expect(s.get().matchdays.filter(d => d.phaseName === "Final").every(d => d.fixtures.every(f => !f.result))).toBe(true);
  });
  it("finaliza los partidos programados para que sus estadísticas se contabilicen", () => {
    const s = setup();s.set({...s.get(), matchdays: s.get().matchdays.map(d => ({...d, fixtures: d.fixtures.map(f => ({...f,
      operationalState: {status: "scheduled" as const, updatedAt: "2026-01-01T00:00:00Z"}}))}))});
    const p = previewSeasonSimulation("local", {kind: "matchday", index: 0}, null, s.repo);
    expect(p.blockers).toEqual([]);
    const result = confirmSeasonSimulation(p, null, s.repo, true, () => 0.3);
    expect(calculateTournamentStatistics(result.tournament).played).toBe(2);
    expect(result.tournament.matchdays[0].fixtures.every(f => f.operationalState?.status === "finished")).toBe(true);
  });
  it("conserva resultados importados y manuales, sin escrituras ni azar en la revisión", () => {
    const s = setup();
    const t = s.get();
    const result = {homeGoals: 4, awayGoals: 1};
    s.set({...t, sourceUrl: "https://example.org/official", matchdays: t.matchdays.map((d,i) => i ? d : {...d, fixtures: d.fixtures.map(f => ({...f, result}))})});
    const random = vi.spyOn(Math, "random");
    const p = previewSeasonSimulation("local", {kind: "leg", leg: 1}, null, s.repo);
    expect(random).not.toHaveBeenCalled(); random.mockRestore();
    expect(s.repo.save).not.toHaveBeenCalled();
    expect(s.repo.saveWithActivity).not.toHaveBeenCalled();
    expect(p.preservedIds).toHaveLength(2);
    const updated = confirmSeasonSimulation(p, null, s.repo, true, () => 0.3).tournament;
    expect(updated.matchdays[0]).toEqual(s.get().matchdays[0]);
    expect(updated.matchdays[0].fixtures.every(f => f.result === result)).toBe(true);
    expect(matchResultOrigin(updated, p.preservedIds[0], s.events)).toContain("importado");
    expect(matchResultOrigin(updated, p.preservedIds[0], [{...s.events[0], action: "match-result-updated", entityId: p.preservedIds[0]}])).toBe("Resultado manual");
  });
  it("rechaza confirmaciones obsoletas, manipuladas y cambios de universo", () => {
    const s = setup();const p = previewSeasonSimulation("local", {kind: "matchday", index: 0}, "a", s.repo);
    expect(() => confirmSeasonSimulation(p, "b", s.repo, true)).toThrow(/universo/);
    expect(() => confirmSeasonSimulation({...p}, "a", s.repo, true)).toThrow(/obsoleta/);
    expect(() => confirmSeasonSimulation(p, "a", s.repo, false)).toThrow(/explícita/);
    s.set({...s.get(), name: "Cambio"});
    expect(() => confirmSeasonSimulation(p, "a", s.repo, true)).toThrow(/obsoleta/);
    expect(s.repo.saveWithActivity).not.toHaveBeenCalled();
  });
  it("bloquea calendario ausente, reglas pendientes y participantes desconocidos", () => {
    const s = setup(); const t = s.get();
    s.set({...t, matchdays: []});expect(previewSeasonSimulation("local", {kind: "competition"}, null, s.repo).blockers.join()).toContain("calendario");
    s.set({...t, competitionRules: undefined});expect(previewSeasonSimulation("local", {kind: "competition"}, null, s.repo).blockers.join()).toContain("reglamento");
    s.set({...t, teams: t.teams.slice(1)});expect(previewSeasonSimulation("local", {kind: "competition"}, null, s.repo).blockers.length).toBeGreaterThan(0);
    s.set({...t, nationalCupPlanning: {schemaVersion: 1, requiresReview: true, regulations: [], reviews: []}});
    expect(previewSeasonSimulation("local", {kind: "competition"}, null, s.repo).blockers.join()).toContain("documental");
  });
  it("bloquea estados suspendidos y dependencias ausentes sin guardar", () => {
    const s = setup();const t = s.get();
    s.set({...t, seasonPreparation: {schemaVersion: 1, sourceTournamentIds: ["missing"], plannedParticipants: t.teams.map(team => team.name), calendarReviews: []}});
    expect(previewSeasonSimulation("local", {kind: "matchday", index: 0}, null, s.repo).blockers.join()).toContain("Dependencia");
    s.set({...t, matchdays: t.matchdays.map(d => ({...d, fixtures: d.fixtures.map(f => ({...f,
      operationalState: {status: "suspended" as const, updatedAt: "2026-01-01T00:00:00Z"}}))}))});
    const p = previewSeasonSimulation("local", {kind: "matchday", index: 0}, null, s.repo);
    expect(p.blockers.join()).toContain("estado operativo");
    const random = vi.fn(() => 0.3);
    expect(() => confirmSeasonSimulation(p, null, s.repo, true, random)).toThrow();
    expect(random).not.toHaveBeenCalled();expect(s.repo.saveWithActivity).not.toHaveBeenCalled();
  });
  it("bloquea eliminatorias posteriores y simulación completa por etapas", () => {
    const s = setup();s.set({...s.get(), format: "staged", competitionType: "cup", knockoutStages: [{name: "Final", legs: 1}], matchdays: s.get().matchdays.map(d => ({...d, phaseName: d.leg === 1 ? "Inicial" : "Final"}))});
    expect(previewSeasonSimulation("local", {kind: "phase", name: "Final"}, null, s.repo).blockers.join()).toContain("etapa anterior");
    expect(previewSeasonSimulation("local", {kind: "competition"}, null, s.repo).blockers.join()).toContain("formato");
  });
  it("reconoce desempates pendientes sin decidirlos", () => {
    const s = setup();const p = previewSeasonSimulation("local", {kind: "competition"}, null, s.repo);
    confirmSeasonSimulation(p, null, s.repo, true, () => 0.3);
    const review = previewSeasonSimulation("local", {kind: "competition"}, null, s.repo);
    expect(review.blockers.join()).toMatch(/desempate/i);
  });
  it("actualiza dashboard y persiste resultados y actividad en JSON v7", () => {
    const s = setup();const storage = new Map<string,string>();
    vi.stubGlobal("localStorage", {getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string,value: string) => {storage.set(key,value);}, removeItem: (key: string) => {storage.delete(key);}});
    const repo = new LocalStorageTournamentRepository(false);
    repo.save(s.get());const p = previewSeasonSimulation("local", {kind: "matchday", index: 0}, null, repo);
    confirmSeasonSimulation(p, null, repo, true, () => 0.3);
    const saved = repo.findAll(); expect(calculateTournamentStatistics(saved[0]).played).toBe(2);
    const dashboard = projectSportsUniverseDashboard(saved, repo.findActivity(), {version: 1, activeUniverseId: null, universes: [], assignments: {}});
    expect(JSON.stringify(dashboard)).toContain('"played":2');
    const backup = createTournamentBackup(saved, () => new Date(), repo.findActivity());
    expect(backup.version).toBe(7);expect(backup.activity?.[0].action).toBe("matches-simulated");
    expect(parseTournamentBackup(JSON.stringify(backup))).toEqual(saved);
    let active: string | null = null;
    const scoped = createScopedTournamentRepository(repo, null, () => ({version: 1, activeUniverseId: active, universes: [], assignments: {}}));
    const review = previewSeasonSimulation("local", {kind: "matchday", index: 1}, null, scoped);
    active = "other";
    expect(() => confirmSeasonSimulation(review, active, scoped, true)).toThrow(/universo/);
  });
  it("coordina ambas copas continentales en una escritura sin simular los nuevos cruces", () => {
    const configure = (t: Tournament): Tournament => ({...t,
      competitionRules: {season: 2026, verification: {standings: "verified", placements: "verified"}},
    });
    let lib = configure(continentalCup("libertadores"));
    lib = {...lib, matchdays: lib.matchdays.map((d,i) => i ? d : {...d, fixtures: d.fixtures.map((f,j) => j ? f : {...f, result: undefined})})};
    const suda = configure(continentalCup("sudamericana"));
    let data = [lib, suda];
    const saveManyWithActivity = vi.fn((updated: readonly Tournament[]) => {data = data.map(t => updated.find(next => next.id === t.id) ?? t);});
    const repo = {findAll: () => data, save: vi.fn(), saveWithActivity: vi.fn(), saveManyWithActivity};
    const p = previewSeasonSimulation(lib.id, {kind: "matchday", index: 0}, null, repo);
    expect(p.blockers).toEqual([]);
    expect(() => confirmSeasonSimulation(p, null, {...repo, saveManyWithActivity: undefined}, true, () => 0.3)).toThrow(/guardado conjunto/);
    expect(data).toEqual([lib, suda]);expect(repo.save).not.toHaveBeenCalled();
    expect(repo.saveWithActivity).not.toHaveBeenCalled();expect(saveManyWithActivity).not.toHaveBeenCalled();
    const result = confirmSeasonSimulation(p, null, repo, true, () => 0.3);
    expect(result.simulatedCount).toBe(1);
    expect(saveManyWithActivity).toHaveBeenCalledOnce();expect(repo.saveWithActivity).not.toHaveBeenCalled();
    expect(data).toHaveLength(2);
    const playoff = data[1].matchdays.find(d => d.phaseName?.endsWith("Playoff de octavos · Ida"))!;
    expect(playoff.fixtures).toHaveLength(8);expect(playoff.fixtures.every(f => !f.result)).toBe(true);
    expect(data[1].matchdays[0]).toEqual(suda.matchdays[0]);
  });
});

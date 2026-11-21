import { describe, expect, it } from "vitest";
import type { ActivityEvent } from "../../domain/entities/activity-event";
import type { Tournament } from "../../domain/entities/tournament";
import { generateRoundRobinSchedule } from "../../domain/services/round-robin-scheduler";
import { chileanPrimera2026PlacementRules } from "../../domain/services/chilean-primera-placement-rules";
import { getArgentinaLeagueChampion } from "../../domain/services/argentina-league-champion";
import { getChileanAscensoOutcome } from "../../domain/services/chilean-division-outcome";
import { getDivisionTransition } from "../../domain/services/division-season-transition";
import { getTournamentCompletionStatus } from "../../domain/services/tournament-history";
import { argentinaUpper } from "../../test-utils/journey-competition-fixtures";
import { closureMemory } from "../../test-utils/season-closure-fixtures";
import { simulateChampionship } from "../use-cases/simulate-championship";
import { seasonHonours } from "./club-honours";
import { evaluateSeasonClosure } from "./season-closure";
import { projectSeasonPlanning } from "./season-planning";
import { confirmSeasonClosure, reviewSeasonClosure } from "../use-cases/confirm-season-closure";
import { confirmSeasonPlanning, reviewSeasonPlanning } from "../use-cases/plan-season";

const pendingRules = {season: 2026, verification: {standings: "pending" as const, placements: "provisional" as const}};
const simulation = (t: Tournament): ActivityEvent => ({id: `sim-${t.id}`, action: "matches-simulated", tournamentId: t.id,
  tournamentName: t.name, summary: "Simulación de prueba", occurredAt: t.createdAt});
/** Lower index always wins 2-0: a strict, tie-free table in index order. */
function orderedLeague(id: string, competitionId: string, prefix: string): Tournament {
  const teams = Array.from({length: 16}, (_, i) => ({id: `${prefix}${i}`, name: `${prefix.toUpperCase()} Club ${i}`}));
  const index = (teamId: string) => Number(teamId.slice(prefix.length));
  return {id, competitionId, name: `${competitionId} 2026`, season: 2026, createdAt: "2026-01-01T00:00:00.000Z",
    teams, legs: 2, tieBreakers: ["goalDifference", "goalsFor"], format: "round-robin", competitionType: "league",
    importCoverage: "unknown", competitionRules: pendingRules,
    matchdays: generateRoundRobinSchedule(teams, 2).map(day => ({...day, fixtures: day.fixtures.map(f => ({...f,
      result: index(f.homeTeamId) < index(f.awayTeamId) ? {homeGoals: 2, awayGoals: 0} : {homeGoals: 0, awayGoals: 2}}))}))};
}
const primera = (): Tournament => ({...orderedLeague("anfp-liga-primera-2026", "anfp-liga-primera", "p"),
  placementRules: chileanPrimera2026PlacementRules});
/** Regular phase decided; the Liguilla is generated and simulated by the existing use case. */
function simulatedAscenso() {
  const base: Tournament = {...orderedLeague("anfp-liga-de-ascenso-2026", "anfp-liga-de-ascenso", "a"),
    placementRules: {championPlaces: 1, playoffPlaces: {from: 2, to: 8}, relegationPlaces: 1}};
  const memory = closureMemory([base]);
  let seed = 7;
  const random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const t = simulateChampionship(base, "pendingOnly", memory.repository, random).tournament;
  return {t, memory};
}

describe("Liga Profesional 2026: Campeón de Liga (art. 24)", () => {
  it("the Tabla General leader is the season champion, next to both half champions", () => {
    const t = {...argentinaUpper(), competitionRules: pendingRules}, h = seasonHonours(t, [simulation(t)]);
    expect(getArgentinaLeagueChampion(t)).toEqual({champion: "u0", pending: []});
    expect(getTournamentCompletionStatus(t, "sporting")).toBe("Finalizado");
    expect(h.awards).toContainEqual({teamId: "u0", label: "Campeón", tier: "simulated", title: "Campeón de Liga"});
    expect(h.awards.filter(a => a.label.startsWith("Campeón del ")).map(a => a.label)).toEqual(["Campeón del Apertura", "Campeón del Clausura"]);
  });

  it("a simulated LPF closes; missing average history is a warning, not a blocker", () => {
    const t = {...argentinaUpper(), competitionRules: pendingRules};
    const view = evaluateSeasonClosure(t, [t], [simulation(t)], null);
    expect(view.blockers).toEqual([]);expect(view.canConfirm).toBe(true);
    expect(view.tables[0].label).toBe("Tabla General 2026");
    expect(view.warnings.join(" ")).toContain("Descensos de la Liga Profesional");
  });

  it("an imported LPF with pending rules stays blocked", () => {
    const t = {...argentinaUpper(), competitionRules: pendingRules};
    expect(evaluateSeasonClosure(t, [t], [], null).canConfirm).toBe(false);
  });

  it("a first-place tie after goal difference and goals for stays pending (Fair Play or draw)", () => {
    const t = argentinaUpper(), drawn = {...t, matchdays: t.matchdays.map(d => d.phaseName?.endsWith("Fase regular")
      ? {...d, fixtures: d.fixtures.map(f => ({...f, result: {homeGoals: 1, awayGoals: 1}}))} : d)};
    const result = getArgentinaLeagueChampion(drawn);
    expect(result.champion).toBeUndefined();expect(result.pending.join(" ")).toContain("art. 24.3");
  });

  it("an unplayed half final means no season champion yet", () => {
    const t = argentinaUpper(), open = {...t, matchdays: t.matchdays.map(d => d.phaseName === "Torneo Clausura · Final"
      ? {...d, fixtures: d.fixtures.map(f => ({...f, result: undefined}))} : d)};
    expect(getArgentinaLeagueChampion(open).pending).toContain("Final del Clausura pendiente.");
  });
});

describe("Liga de Ascenso (Chile): champion, Liguilla and relegation", () => {
  it("the leader is champion, the Liguilla winner also goes up and the last goes down", () => {
    const {t} = simulatedAscenso(), outcome = getChileanAscensoOutcome(t);
    expect(outcome.pending).toEqual([]);
    expect(outcome.champion).toBe("a0");
    expect(outcome.playoffWinner).toBeDefined();expect(["a0", "a8", "a15"]).not.toContain(outcome.playoffWinner);
    expect(outcome.relegated).toEqual(["a15"]);
    expect(getTournamentCompletionStatus(t, "sporting")).toBe("Finalizado");
  });

  it("a simulated Ascenso closes with both promotions and its relegation", () => {
    const {t, memory} = simulatedAscenso(), activity = memory.state.activity;
    const view = evaluateSeasonClosure(t, memory.state.tournaments, activity, null);
    expect(view.blockers).toEqual([]);expect(view.canConfirm).toBe(true);
    expect(view.honours.awards.map(a => a.label)).toEqual(["Campeón", "Ascenso por Liguilla"]);
    expect(view.division?.promoted).toHaveLength(2);
    expect(view.relegated).toEqual([{teamId: "a15", destination: "Desciende a Segunda División (simulado)"}]);
  });
});

describe("Chile transition Primera ↔ Liga de Ascenso", () => {
  it("15.º and 16.º go down, champion and Liguilla winner go up, Ascenso's last goes to Segunda", () => {
    const {t: ascenso} = simulatedAscenso(), outcome = getChileanAscensoOutcome(ascenso);
    const transition = getDivisionTransition(primera(), ascenso, []);
    expect(transition).toEqual({promoted: ["a0", outcome.playoffWinner], upperRelegated: ["p14", "p15"],
      lowerRelegated: ["a15"], pending: []});
  });

  it("a tie across Primera's relegation cut stays pending", () => {
    const {t: ascenso} = simulatedAscenso(), p = primera();
    // 14.º and 15.º draw both meetings: equal points, goal difference and goals for.
    const tied = {...p, matchdays: p.matchdays.map(d => ({...d, fixtures: d.fixtures.map(f =>
      [f.homeTeamId, f.awayTeamId].sort().join() === "p13,p14" ? {...f, result: {homeGoals: 0, awayGoals: 0}} : f)}))};
    const transition = getDivisionTransition(tied, ascenso, []);
    expect(transition.upperRelegated).toEqual([]);
    expect(transition.pending).toContain("Desempate por el descenso de la Liga de Primera pendiente.");
  });

  it("an unrelated pair is rejected with an explicit message", () => {
    const {t: ascenso} = simulatedAscenso();
    expect(getDivisionTransition({...primera(), competitionId: "otra-liga"}, ascenso, []).pending)
      .toContain("Selecciona la Liga de Primera y la Liga de Ascenso de Chile de la misma temporada 2026.");
  });
});

describe("planning Chile 2027 from confirmed simulated closures", () => {
  function library(withPrimeraSimulation = true) {
    const {t: ascenso, memory} = simulatedAscenso(), p = primera();
    memory.state.tournaments = [p, ascenso];
    if (withPrimeraSimulation) memory.state.activity = [...memory.state.activity, simulation(p)];
    const repository = {...memory.repository, saveManyWithActivity: (items: readonly Tournament[], event: ActivityEvent) => {
      items.forEach(item => memory.repository.save(item));memory.repository.recordActivity!(event);
    }};
    return {memory, repository, primera: p, ascenso};
  }
  const input = (p: Tournament, a: Tournament) => ({mode: "divisions" as const, sourceId: p.id, partnerId: a.id, targetSeason: 2027,
    incoming: [{id: "incoming-0", name: "Club de Segunda"}], universeId: null});
  const close = (id: string, repository: ReturnType<typeof library>["repository"]) =>
    confirmSeasonClosure(reviewSeasonClosure(id, null, repository), null, repository, true);

  it("requires both closures to be confirmed first", () => {
    const {memory, primera: p, ascenso} = library();
    const plan = projectSeasonPlanning(input(p, ascenso), memory.state.tournaments, memory.state.activity);
    expect(plan.canReview).toBe(false);
    expect(plan.blockers.filter(b => b.startsWith("Confirma el cierre"))).toHaveLength(2);
  });

  it("creates Primera and Ascenso 2027 with the computed movements and no HTTPS reference", () => {
    const {memory, repository, primera: p, ascenso} = library();
    close(p.id, repository);close(ascenso.id, repository);
    const plan = projectSeasonPlanning(input(p, ascenso), memory.state.tournaments, memory.state.activity);
    expect(plan.blockers).toEqual([]);expect(plan.simulatedSources).toBe(true);
    expect(plan.states).not.toContain("Pendiente de reglamento");
    const winner = getChileanAscensoOutcome(ascenso).playoffWinner!;
    const created = confirmSeasonPlanning(reviewSeasonPlanning(input(p, ascenso), repository), repository, true);
    const names = (t: Tournament) => t.teams.map(team => team.name).sort();
    const nameOf = (t: Tournament, id: string) => t.teams.find(team => team.id === id)!.name;
    const [upper, lower] = created;
    expect(upper.season).toBe(2027);expect(upper.teams).toHaveLength(16);expect(lower.teams).toHaveLength(16);
    expect(names(upper)).toEqual(expect.arrayContaining([nameOf(ascenso, "a0"), nameOf(ascenso, winner)]));
    expect(names(upper)).not.toEqual(expect.arrayContaining([nameOf(p, "p14")]));
    expect(names(lower)).toEqual(expect.arrayContaining([nameOf(p, "p14"), nameOf(p, "p15"), "Club de Segunda"]));
    expect(names(lower)).not.toContain(nameOf(ascenso, "a15"));
    expect(upper.placementRules).toEqual(chileanPrimera2026PlacementRules);
    expect(upper.rulesNote).toContain("Escenario simulado");
  });

  it("an imported (not simulated) Primera keeps its closure blocked, so planning stays blocked", () => {
    const {memory, repository, primera: p, ascenso} = library(false);
    expect(() => close(p.id, repository)).toThrow();
    expect(projectSeasonPlanning(input(p, ascenso), memory.state.tournaments, memory.state.activity).canReview).toBe(false);
  });
});

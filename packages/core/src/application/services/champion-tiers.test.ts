import { describe, expect, it } from "vitest";
import type { ActivityEvent } from "../../domain/entities/activity-event";
import type { Tournament } from "../../domain/entities/tournament";
import { isSeasonClosureRecord } from "../../domain/entities/season-closure";
import { calculateTournamentStatistics, getSportingChampion } from "../../domain/services/tournament-statistics";
import { classifyContinentalPosition } from "../../domain/services/placement-classification";
import { getArgentinaHalfChampions } from "../../domain/services/argentina-half-champions";
import { calculateInternationalQualifications } from "../../domain/services/international-qualification";
import { calculateStandings } from "../../domain/services/standings";
import { closureLeague, closureMemory } from "../../test-utils/season-closure-fixtures";
import { seasonHonours } from "./club-honours";
import { evaluateSeasonClosure } from "./season-closure";
import { confirmSeasonClosure, reviewSeasonClosure } from "../use-cases/confirm-season-closure";

/** Primera-like league: pending annual rules, undeclared coverage, champion inside the Libertadores range. */
function primeraLike(): Tournament {
  const t = closureLeague("primera-like");
  return {...t, importCoverage: "unknown",
    competitionRules: {season: 2026, verification: {standings: "pending", placements: "provisional"}},
    placementRules: {championPlaces: 1, libertadoresPlaces: {from: 1, to: 2}, sudamericanaPlaces: {from: 3, to: 3}, relegationPlaces: 1}};
}
const simulation = (t: Tournament): ActivityEvent => ({id: `sim-${t.id}`, action: "matches-simulated", tournamentId: t.id,
  tournamentName: t.name, summary: "Simulación de prueba", occurredAt: t.createdAt});

describe("champion tiers: verified, calculated and simulated", () => {
  it("the sporting champion ignores pending rules while the verified champion stays strict", () => {
    const t = primeraLike(), stats = calculateTournamentStatistics(t);
    expect(stats.championTeamId).toBeUndefined();
    expect(stats.sportingChampionTeamId).toBe(t.teams[0].id);
    expect(getSportingChampion(t)).toBe(t.teams[0].id);
  });

  it("a simulated league with a unique leader declares a simulated, unofficial champion", () => {
    const t = primeraLike(), h = seasonHonours(t, [simulation(t)]);
    expect(h.complete).toBe(false);
    expect(h.tier).toBe("simulated");
    expect(h.sportingReasons).toEqual([]);
    expect(h.awards).toContainEqual({teamId: t.teams[0].id, label: "Campeón", tier: "simulated"});
  });

  it("the same imported league without local activity is only calculated", () => {
    const t = primeraLike(), h = seasonHonours(t);
    expect(h.tier).toBe("calculated");
    expect(h.awards.find(a => a.label === "Campeón")?.tier).toBe("calculated");
  });

  it("a points tie for first never produces a champion in any tier", () => {
    const t = primeraLike(), drawn = {...t, matchdays: t.matchdays.map(d => ({...d, fixtures: d.fixtures.map(f => ({...f, result: {homeGoals: 0, awayGoals: 0}}))}))};
    expect(getSportingChampion(drawn)).toBeUndefined();
    const h = seasonHonours(drawn, [simulation(drawn)]);
    expect(h.awards).toEqual([]);expect(h.tier).toBeUndefined();
  });

  it("a partially covered league is a sporting gap, not an accreditation notice", () => {
    const t = {...primeraLike(), importCoverage: "partial" as const};
    expect(seasonHonours(t, [simulation(t)]).awards).toEqual([]);
  });
});

describe("simulated season closure", () => {
  it("can be confirmed with table relegations and the champion in Libertadores", () => {
    const t = primeraLike(), activity = [simulation(t)];
    const view = evaluateSeasonClosure(t, [t], activity, null);
    expect(view.closureTier).toBe("simulated");
    expect(view.blockers).toEqual([]);
    expect(view.canConfirm).toBe(true);
    expect(view.warnings.join(" ")).toContain("Cierre simulado");
    expect(view.tables[0].label).toBe("Clasificación final (simulada)");
    expect(view.relegated).toEqual([{teamId: t.teams[3].id, destination: "Descenso por tabla (simulado)"}]);
    const libertadores = view.international?.entries.filter(e => e.destination === "libertadores").map(e => e.sourceTeamId);
    expect(libertadores).toEqual([t.teams[0].id, t.teams[1].id]);
    expect(view.nextSeasonPending).not.toContain("La liga todavía tiene partidos sin resultado.");
  });

  it("records the simulated tier and stays confirmed only for that tier", () => {
    const t = primeraLike(), memory = closureMemory([t], [simulation(t)]);
    const event = confirmSeasonClosure(reviewSeasonClosure(t.id, null, memory.repository), null, memory.repository, true);
    expect(isSeasonClosureRecord(event.after) && event.after.tier).toBe("simulated");
    expect(event.summary).toContain("simulado");
    const after = evaluateSeasonClosure(t, memory.state.tournaments, memory.state.activity, null);
    expect(after.confirmed).toBe(true);expect(after.state).toBe("Cierre confirmado");
  });

  it("an imported (calculated) season with pending rules still cannot be confirmed", () => {
    const t = primeraLike(), view = evaluateSeasonClosure(t, [t], [], null);
    expect(view.closureTier).toBe("calculated");
    expect(view.canConfirm).toBe(false);
    expect(view.blockers).toContain("Verifica el reglamento anual de tabla y decisiones deportivas para esta edición.");
  });
});

describe("Argentine half champions", () => {
  it("each decided half final yields its own champion", () => {
    const t = closureLeague("lpf-like"), [a, b] = t.teams;
    const lpf: Tournament = {...t, format: "staged", competitionType: undefined,
      competitionRules: {season: 2026, verification: {standings: "pending", placements: "provisional"}},
      matchdays: [...t.matchdays.map(d => ({...d, phaseName: "Torneo Apertura · Fase regular"})),
        {number: 99, leg: 1, phaseName: "Torneo Apertura · Final", fixtures: [{id: "apertura-final", homeTeamId: a.id, awayTeamId: b.id,
          knockoutResolution: "penalties", result: {homeGoals: 1, awayGoals: 1, penalties: {homeGoals: 3, awayGoals: 4}}}]},
        {number: 100, leg: 1, phaseName: "Torneo Clausura · Final", fixtures: [{id: "clausura-final", homeTeamId: a.id, awayTeamId: b.id}]}]};
    expect(getArgentinaHalfChampions(lpf)).toEqual({Apertura: b.id});
    const h = seasonHonours(lpf, [simulation(lpf)]);
    expect(h.awards).toEqual([{teamId: b.id, label: "Campeón del Apertura", tier: "simulated"}]);
    expect(h.tier).toBe("simulated");
  });
});

describe("cups whose clubs enter in later rounds", () => {
  const cup = (): Tournament => {
    const base = closureLeague("entry-cup");
    const teams = [...base.teams, {id: "entry-cup-4", name: "Épsilon"}], [a, b, c, d, e] = teams;
    const ko = (id: string, home: string, away: string, homeGoals: number) =>
      ({id, homeTeamId: home, awayTeamId: away, knockoutResolution: "penalties" as const, result: {homeGoals, awayGoals: 0}});
    return {...base, teams, competitionType: "cup", format: "staged", tieBreakers: [], importCoverage: "unknown",
      competitionRules: {season: 2026, verification: {standings: "pending", placements: "provisional"}},
      knockoutStages: [{name: "Fase previa", legs: 1}, {name: "Semifinal", legs: 1}, {name: "Final", legs: 1}],
      matchdays: [
        {number: 1, leg: 1, phaseName: "Fase previa", fixtures: [ko("pre", d.id, e.id, 1)]},
        {number: 2, leg: 1, phaseName: "Semifinal", fixtures: [ko("sa", a.id, b.id, 2), ko("sb", c.id, d.id, 1)]},
        {number: 3, leg: 1, phaseName: "Final", fixtures: [ko("final", a.id, c.id, 1)]},
      ]};
  };

  it("accepts new entrants and declares the final winner", () => {
    const t = cup(), h = seasonHonours(t, [simulation(t)]);
    expect(h.sportingReasons).toEqual([]);
    expect(h.awards).toContainEqual({teamId: t.teams[0].id, label: "Campeón", tier: "simulated"});
  });

  it("still rejects an eliminated club reappearing in the next round", () => {
    const t = cup(), e = t.teams[4].id;
    const bad = {...t, matchdays: t.matchdays.map(day => day.phaseName !== "Semifinal" ? day
      : {...day, fixtures: day.fixtures.map(f => f.id === "sb" ? {...f, awayTeamId: e} : f)})};
    expect(seasonHonours(bad, [simulation(bad)]).awards.find(a => a.label === "Campeón")).toBeUndefined();
  });
});

describe("continental slots and coverage messages", () => {
  it("the champion zone does not hide a Libertadores slot", () => {
    const rules = {championPlaces: 1, libertadoresPlaces: {from: 1, to: 2}, sudamericanaPlaces: {from: 3, to: 4}};
    expect([1, 2, 3, 4, 5].map(p => classifyContinentalPosition(p, rules)))
      .toEqual(["libertadores", "libertadores", "sudamericana", "sudamericana", undefined]);
  });

  it("undeclared coverage does not claim that results are missing", () => {
    const t = primeraLike(), standings = calculateStandings(t);
    const result = calculateInternationalQualifications(standings, t, [t],
      {verification: "provisional", slots: [{destination: "libertadores", position: 1}]}, "provisional");
    expect(result.pendingReasons).toContain("La cobertura del calendario es parcial o no está acreditada como completa.");
    expect(result.pendingReasons).not.toContain("La liga todavía tiene partidos sin resultado.");
  });
});

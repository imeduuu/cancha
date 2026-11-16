import { describe, it, expect, vi } from "vitest";
import type { Tournament } from "../entities/tournament";
import { divisionFixture } from "./second-division-test-fixtures";
import { advanceSecondDivision, getDivisionOutcome, divisionZoneTournaments, hasCompleteDivisionLeague } from "./second-division-progression";
import { calculateStandings, getUnresolvedStandingsTieGroups, hasUniqueStandingsLeader } from "./standings";
import { validateTournamentIntegrity } from "./tournament-integrity";
import { createLinkedDivisionSeasons } from "../../application/use-cases/create-linked-division-seasons";
import { updateMatchResult } from "../../application/use-cases/update-match-result";
import { generateRoundRobinSchedule } from "./round-robin-scheduler";
import { simulateChampionship } from "../../application/use-cases/simulate-championship";
import { simulateFixtures } from "../../application/use-cases/simulate-fixtures";
import { calculateTournamentStatistics } from "./tournament-statistics";
import { getDivisionTransition } from "./division-season-transition";

function fill(t: Tournament, phase: string, draw = false): Tournament {
  return advanceSecondDivision({ ...t, matchdays: t.matchdays.map(day => day.phaseName === phase ? { ...day,
    fixtures: day.fixtures.map(f => ({ ...f, result: draw ? { homeGoals: 0, awayGoals: 0 }
      : { homeGoals: 1, awayGoals: 0 } })) } : day) });
}
function completeBrazil(): Tournament {
  return fill(fill(advanceSecondDivision(divisionFixture("brasil")), "Playoffs de ascenso · Ida", true), "Playoffs de ascenso · Vuelta", true);
}
function repo(tournaments: Tournament[] = []) {
  return { save: vi.fn(), findAll: () => tournaments,
    saveWithActivity: vi.fn(), saveManyWithActivity: vi.fn() };
}

describe("2026 second division progression", () => {
  it("counts interzonal matches in each zone, without adding playoff points", () => {
    const tournament = advanceSecondDivision(divisionFixture("argentina"));
    const zones = divisionZoneTournaments(tournament).map(zone => calculateStandings(zone));
    expect(zones.map(table => table.length)).toEqual([18, 18]);
    expect(zones.flat().every(row => row.played === 36)).toBe(true);
    expect(zones[0][0].points - zones[1][0].points).toBe(6);
    expect(validateTournamentIntegrity(tournament)).toEqual([]);
  });
  it("requires all directed regular fixtures and ignores empty coverage claims", () => {
    const t = divisionFixture("brasil");
    expect(hasCompleteDivisionLeague(t)).toBe(true);
    expect(hasCompleteDivisionLeague({ ...t, importCoverage: "complete", matchdays: t.matchdays.slice(1) })).toBe(false);
    const missing = advanceSecondDivision({ ...t, matchdays: t.matchdays.slice(1) });
    expect(missing.matchdays.find(day => day.phaseName === "Playoffs de ascenso · Ida")?.fixtures).toEqual([]);
  });
  it("creates the seven Argentine crosses and a neutral final with extra time", () => {
    const t = advanceSecondDivision(divisionFixture("argentina"));
    const first = t.matchdays.find(day => day.phaseName === "Reducido · Primera fase")!;
    expect(first.fixtures.map(f => [f.homeTeamId, f.awayTeamId])).toEqual([
      ["t1", "t25"], ["t19", "t7"], ["t2", "t24"], ["t20", "t6"],
      ["t3", "t23"], ["t21", "t5"], ["t4", "t22"],
    ]);
    expect(first.fixtures.every(f => !f.knockoutResolution)).toBe(true);
    const final = t.matchdays.find(day => day.phaseName === "Final por el primer ascenso")!.fixtures[0];
    expect(final.knockoutResolution).toBe("extra-time-then-penalties");
    expect(final.schedule?.logisticsNotes).toContain("neutral");
  });
  it("adds the first-final loser as top seed and applies advantage through the semifinals", () => {
    let t = advanceSecondDivision(divisionFixture("argentina"));
    t = fill(t, "Final por el primer ascenso");
    t = fill(t, "Reducido · Primera fase", true);
    const quarters = t.matchdays.find(day => day.phaseName === "Reducido · Cuartos de final · Vuelta")!;
    expect(quarters.fixtures).toHaveLength(4);
    expect(quarters.fixtures[0].homeTeamId).toBe("t18");
    t = fill(fill(t, "Reducido · Cuartos de final · Ida", true), "Reducido · Cuartos de final · Vuelta", true);
    expect(t.matchdays.find(day => day.phaseName === "Reducido · Semifinales · Vuelta")!.fixtures[0].homeTeamId).toBe("t18");
    t = fill(fill(t, "Reducido · Semifinales · Ida", true), "Reducido · Semifinales · Vuelta", true);
    const final = t.matchdays.find(day => day.phaseName === "Reducido · Final · Vuelta")!;
    expect(final.fixtures).toHaveLength(1);
    expect(final.fixtures[0].knockoutResolution).toBe("aggregate-then-penalties");
    expect(getDivisionOutcome(t).promoted).toEqual(["t0"]);
    t = fill(t, "Reducido · Final · Ida", true);
    expect(t.matchdays.find(day => day.phaseName === "Reducido · Final · Ida")!.fixtures[0]?.result).toEqual({ homeGoals: 0, awayGoals: 0 });
    const f = t.matchdays.find(day => day.phaseName === "Reducido · Final · Vuelta")!.fixtures[0];
    expect(t.matchdays.filter(day => day.fixtures.some(item => item.id === f.id)).map(day => day.phaseName)).toEqual(["Reducido · Final · Vuelta"]);
    t = updateMatchResult(t, f.id, { homeGoals: 0, awayGoals: 0, penalties: { homeGoals: 3, awayGoals: 4 } }, repo());
    expect(getDivisionOutcome(t).promoted).toEqual(["t0", f.awayTeamId]);
    expect(getDivisionOutcome(t).relegated).toHaveLength(4);
    expect(getDivisionOutcome(t).complete).toBe(true);
    expect(validateTournamentIntegrity(t)).toEqual([]);
  });
  it("creates only the two Brazilian playoff ties; drawn aggregates favor third and fourth", () => {
    const t = completeBrazil();
    expect(t.matchdays.filter(day => day.phaseName !== "Fase regular")).toHaveLength(2);
    const first = t.matchdays.find(day => day.phaseName === "Playoffs de ascenso · Ida")!;
    expect(first.fixtures.map(f => [f.homeTeamId, f.awayTeamId])).toEqual([["t5", "t2"], ["t4", "t3"]]);
    expect(getDivisionOutcome(t).promoted).toEqual(["t0", "t1", "t2", "t3"]);
    expect(getDivisionOutcome(t).relegated.map(row => row.teamId)).toEqual(["t16", "t17", "t18", "t19"]);
    expect(getDivisionOutcome(t).complete).toBe(true);
    expect(validateTournamentIntegrity(t)).toEqual([]);
  });
  it("allows an upset and cleans the next phase when the first-final loser changes", () => {
    let t = fill(fill(advanceSecondDivision(divisionFixture("argentina")), "Final por el primer ascenso"), "Reducido · Primera fase");
    t = fill(t, "Reducido · Cuartos de final · Ida");
    const final = t.matchdays.find(day => day.phaseName === "Final por el primer ascenso")!.fixtures[0];
    t = updateMatchResult(t, final.id, { homeGoals: 0, awayGoals: 1 }, repo());
    const quarter = t.matchdays.find(day => day.phaseName === "Reducido · Cuartos de final · Ida")!.fixtures[0];
    expect(quarter.awayTeamId).toBe("t0");
    expect(quarter.result).toBeUndefined();
    const b = advanceSecondDivision(divisionFixture("brasil"));
    const u = fill(fill(b, "Playoffs de ascenso · Ida", true), "Playoffs de ascenso · Vuelta");
    const ret = u.matchdays.find(day => day.phaseName === "Playoffs de ascenso · Vuelta")!.fixtures[0];
    const upset = updateMatchResult(u, ret.id, { homeGoals: 0, awayGoals: 2 }, repo());
    expect(getDivisionOutcome(upset).promoted).toContain("t5");
  });
  it("does not invent discipline data, lot outcomes or pending regular results", () => {
    const source = divisionFixture("brasil");
    const tied = advanceSecondDivision({ ...source, matchdays: source.matchdays.map(day => ({ ...day,
      fixtures: day.fixtures.map(f => ({ ...f, result: { homeGoals: 0, awayGoals: 0 } })) })) });
    expect(getUnresolvedStandingsTieGroups(tied, calculateStandings(tied))).not.toEqual([]);
    expect(getDivisionOutcome(tied).complete).toBe(false);
    expect(tied.matchdays.find(day => day.phaseName === "Playoffs de ascenso · Ida")!.fixtures).toEqual([]);
  });
  it("requires the neutral relegation playoff even if goal criteria order the tied clubs", () => {
    const source = divisionFixture("argentina");
    let t = advanceSecondDivision({ ...source, matchdays: source.matchdays.map(day => ({ ...day,
      fixtures: day.fixtures.map(f => f.homeTeamId === "t15" && f.awayTeamId === "t16"
        ? { ...f, result: { homeGoals: 0, awayGoals: 2 } } : f) })) });
    const playoff = t.matchdays.find(day => day.phaseName === "Desempate descenso · Zona A")!;
    expect(playoff.fixtures).toHaveLength(1);
    expect(playoff.fixtures[0].knockoutResolution).toBe("extra-time-then-penalties");
    expect(getDivisionOutcome(t).pending.join()).toContain("Desempate de descenso pendiente");
    t = fill(t, "Desempate descenso · Zona A");
    expect(getDivisionOutcome(t).relegated).toHaveLength(4);
    expect(validateTournamentIntegrity(t)).toEqual([]);
  });
  it("leaves a cross-zone official draw pending instead of deciding it alphabetically", () => {
    const source = divisionFixture("argentina");
    const t = advanceSecondDivision({ ...source, matchdays: source.matchdays.map(day => day.number >= 35
      ? { ...day, fixtures: day.fixtures.map(f => ({ ...f, result: { homeGoals: 0, awayGoals: 0 } })) } : day) });
    expect(t.matchdays.find(day => day.phaseName === "Reducido · Primera fase")!.fixtures).toHaveLength(6);
    expect(getDivisionOutcome(t).complete).toBe(false);
  });
  it("removes downstream playoff data when a regular result becomes suspended", () => {
    const t = completeBrazil();
    const suspended = advanceSecondDivision({ ...t, matchdays: t.matchdays.map((day, index) => index === 0
      ? { ...day, fixtures: day.fixtures.map((f, i) => i === 0
        ? { ...f, operationalState: { status: "suspended", updatedAt: "2026-10-16T00:00:00Z" } } : f) } : day) });
    expect(suspended.matchdays.find(day => day.phaseName === "Playoffs de ascenso · Vuelta")!.fixtures).toEqual([]);
    expect(getDivisionOutcome(suspended).complete).toBe(false);
  });
  it("finalizes simulated scheduled games and keeps playoff points out of league statistics", () => {
    const source = divisionFixture("brasil");
    const target = source.matchdays[0].fixtures[0];
    const t = { ...source, matchdays: source.matchdays.map((day, index) => index === 0
      ? { ...day, fixtures: day.fixtures.map((f, i) => i === 0
        ? { ...f, result: undefined, operationalState: { status: "scheduled" as const, updatedAt: "2026-01-01T00:00:00Z" } } : f) } : day) };
    const simulated = simulateFixtures(t, [target.id], "pendingOnly", repo(), () => 0).tournament;
    expect(simulated.matchdays[0].fixtures[0].operationalState?.status).toBe("finished");
    expect(hasCompleteDivisionLeague(simulated)).toBe(true);
    expect(calculateTournamentStatistics(completeBrazil()).standings.every(row => row.played === 38)).toBe(true);
    const argentina = advanceSecondDivision(divisionFixture("argentina"));
    expect(calculateTournamentStatistics(argentina, { groupName: "Zona A" }).standings.every(row => row.played === 36)).toBe(true);
  });
  it.each(["argentina", "brasil"] as const)("simulates all successive %s promotion rounds without touching real regular scores", kind => {
    const source = advanceSecondDivision(divisionFixture(kind));
    const regularBefore = JSON.stringify(source.matchdays.filter(day => day.phaseName === "Fase regular"));
    let seed = 42;
    const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; };
    const result = simulateChampionship(source, "pendingOnly", repo(), random);
    expect(getDivisionOutcome(result.tournament).complete).toBe(true);
    expect(result.simulatedCount).toBe(kind === "argentina" ? 22 : 4);
    expect(JSON.stringify(result.tournament.matchdays.filter(day => day.phaseName === "Fase regular"))).toBe(regularBefore);
    expect(validateTournamentIntegrity(result.tournament)).toEqual([]);
  });
  it("does not use a two-club head-to-head to declare a leader in a three-club Brazilian tie", () => {
    const source = divisionFixture("brasil");
    const t = { ...source, teams: source.teams.slice(0, 3), matchdays: [
      ["t0", "t1"], ["t1", "t2"], ["t2", "t0"],
    ].map(([homeTeamId, awayTeamId], index) => ({ number: index + 1, leg: 1, phaseName: "Fase regular",
      fixtures: [{ id: `cycle-${index}`, homeTeamId, awayTeamId, eventsCoverage: "complete" as const,
        result: { homeGoals: 1, awayGoals: 0 } }] })) };
    const standings = calculateStandings(t);
    expect(standings.every(row => row.points === 3)).toBe(true);
    expect(hasUniqueStandingsLeader(t, standings)).toBe(false);
  });
  it("protects phase-specific resolution against manual override", () => {
    const t = advanceSecondDivision(divisionFixture("brasil"));
    const f = t.matchdays.find(day => day.phaseName === "Playoffs de ascenso · Vuelta")!.fixtures[0];
    expect(() => updateMatchResult(t, f.id, { homeGoals: 1, awayGoals: 1, penalties: { homeGoals: 4, awayGoals: 3 } }, repo(), "penalties"))
      .toThrow("reglamento 2026");
  });
  it("does not change other tournaments or apply the 2026 rules to another year", () => {
    const t = divisionFixture("brasil");
    const other = { ...t, id: "other", competitionId: "other" };
    expect(advanceSecondDivision(other)).toBe(other);
    const future = { ...t, season: 2027 };
    expect(advanceSecondDivision(future)).toBe(future);
  });
});

describe("linked division seasons", () => {
  function upper(): Tournament {
    const t = divisionFixture("brasil");
    return { ...t, id: "brasileirao-serie-a-2026", competitionId: "brasileirao-serie-a", name: "Série A 2026",
      teams: t.teams.map(team => ({ ...team, id: `u${team.id}`, name: `Upper ${team.name}` })),
      matchdays: t.matchdays.map(day => ({ ...day, phaseName: "Brasileirão Série A", fixtures: day.fixtures.map(f => ({
        ...f, id: `u${f.id}`, homeTeamId: `u${f.homeTeamId}`, awayTeamId: `u${f.awayTeamId}`,
      })) })) };
  }
  it("previews four exchanges and saves both new rosters without mutating history", () => {
    const low = completeBrazil(), high = upper(), repository = repo([high, low]);
    expect(getDivisionTransition(high, low, repository.findAll()).pending).toEqual([]);
    const before = JSON.stringify([high, low]);
    const next = createLinkedDivisionSeasons(high, low, Array.from({ length: 4 }, (_, i) => ({ id: `c${i}`, name: `Test Série C ${i}` })),
      "https://www.cbf.com.br/", repository);
    expect(next.map(t => t.teams.length)).toEqual([20, 20]);
    expect(next.every(t => t.season === 2027 && t.matchdays.length === 0)).toBe(true);
    expect(next[0].teams.map(t => t.name)).toContain("Test Club 2");
    expect(next[1].teams.map(t => t.name)).toContain("Upper Test Club 16");
    expect(next[0].competitionRules?.verification.placements).toBe("pending");
    expect(next.every(t => t.tieBreakers.length === 0 && !t.officialResolutions)).toBe(true);
    expect(next[0].seasonPreparation?.sourceTournamentIds).toEqual([high.id, low.id]);
    expect(next[0].seasonPreparation?.plannedParticipants).toEqual(next[0].teams.map(t => t.name));
    expect(JSON.stringify([high, low])).toBe(before);
    expect(repository.saveManyWithActivity).toHaveBeenCalledOnce();
  });
  it("requires Argentina historical seasons and excludes the average relegation from the annual selection", () => {
    let low = advanceSecondDivision(divisionFixture("argentina"));
    low = fill(fill(low, "Final por el primer ascenso"), "Reducido · Primera fase");
    for (const stage of ["Cuartos de final", "Semifinales", "Final"]) {
      low = fill(fill(low, `Reducido · ${stage} · Ida`, true), `Reducido · ${stage} · Vuelta`);
    }
    expect(getDivisionOutcome(low).complete).toBe(true);
    const teams = Array.from({ length: 30 }, (_, i) => ({ id: `u${i}`, name: `Upper Club ${i}` }));
    const regular = generateRoundRobinSchedule(teams, 2).slice(0, 32).map((day, index) => ({ ...day,
      phaseName: `Torneo ${index < 16 ? "Apertura" : "Clausura"} · Fase regular`,
      fixtures: day.fixtures.map(f => ({ ...f, result: Number(f.homeTeamId.slice(1)) < Number(f.awayTeamId.slice(1))
        ? { homeGoals: 2, awayGoals: 0 } : { homeGoals: 0, awayGoals: 2 } })),
    }));
    const high: Tournament = { id: "arg-liga-profesional-2026", competitionId: "arg-liga-profesional", name: "LPF 2026",
      season: 2026, teams, createdAt: "2026-01-01T00:00:00Z", legs: 2, tieBreakers: ["goalDifference"],
      matchdays: [...regular, ...["Apertura", "Clausura"].map((half, index) => ({ number: 33 + index, leg: 2,
        phaseName: `Torneo ${half} · Final`, fixtures: [{ id: `final-${half}`, homeTeamId: "u0", awayTeamId: "u1",
          result: { homeGoals: 1, awayGoals: 0 } }] }))] };
    expect(getDivisionTransition(high, low, []).pending.join()).toContain("2024");
    const histories = [2024, 2025].map(season => ({ ...high, id: `arg-liga-profesional-${season}`, season,
      importCoverage: "complete" as const, matchdays: regular }));
    const transition = getDivisionTransition(high, low, histories);
    expect(transition.pending).toEqual([]);
    expect(new Set(transition.upperRelegated).size).toBe(2);
    expect(transition.upperRelegated[0]).toBe("u29");
    const tied = { ...high, matchdays: high.matchdays.map(day => ({ ...day,
      fixtures: day.fixtures.map(f => ({ ...f, result: { homeGoals: 0, awayGoals: 0 } })) })) };
    expect(getDivisionTransition(tied, low, histories).pending.length).toBeGreaterThan(0);
  });
  it("blocks pending playoffs, wrong divisions, missing entrants and stale snapshots", () => {
    const high = upper(), low = divisionFixture("brasil");
    const repository = repo([high, low]);
    expect(() => createLinkedDivisionSeasons(high, low, [], "https://www.cbf.com.br", repository)).toThrow("Playoffs");
    expect(getDivisionTransition({ ...high, season: 2025 }, low, []).pending.join()).toContain("2026");
    const done = completeBrazil();
    expect(() => createLinkedDivisionSeasons(high, done, [], "https://www.cbf.com.br", repo([high, done]))).toThrow("4 ascendidos");
    expect(() => createLinkedDivisionSeasons(high, done, [], "https://www.cbf.com.br", repo([]))).toThrow("cambiaron");
    expect(repository.saveManyWithActivity).not.toHaveBeenCalled();
  });
});

it("does not confirm promotions or relegations with explicitly pending 2026 rules",()=>{
 const t=completeBrazil();const uncertain={...t,competitionRules:{...t.competitionRules!,verification:{standings:"pending" as const,placements:"pending" as const}}};
 const outcome=getDivisionOutcome(uncertain);
 expect(outcome.complete).toBe(false);expect(outcome.promoted).toEqual([]);expect(outcome.relegated).toEqual([]);
 expect(calculateTournamentStatistics(uncertain).championTeamId).toBeUndefined();
});

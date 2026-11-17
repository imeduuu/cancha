import { describe, it, expect } from "vitest";
import type { Tournament } from "../../domain/entities/tournament";
import { divisionFixture } from "../../domain/services/second-division-test-fixtures";
import { advanceSecondDivision, getOfficialResolutionContexts, getDivisionOutcome, divisionZoneTournaments } from "../../domain/services/second-division-progression";
import { recordOfficialResolution, revokeOfficialResolution } from "../use-cases/record-official-resolution";
import { calculateStandings, getUnresolvedStandingsTieGroups } from "../../domain/services/standings";
import { updateMatchResult } from "../use-cases/update-match-result";
import { simulateChampionship } from "../use-cases/simulate-championship";
import { importOfficialTournament } from "../use-cases/import-official-tournament";
import type { OfficialLeagueSeason } from "../ports/official-league-source";
import { getDivisionTransition } from "../../domain/services/division-season-transition";
import { generateRoundRobinSchedule } from "../../domain/services/round-robin-scheduler";
import { programmeOrder } from "../../domain/services/official-programme";
import { validateTournamentIntegrity } from "../../domain/services/tournament-integrity";
import { updateFixtureDetails } from "../use-cases/update-fixture-details";

import { afa, cbf, memoryRepository, seedTie, multipleTie, programme } from "../../test-utils/official-resolution-fixtures";

function fill(t: Tournament, phase: string): Tournament {
  return advanceSecondDivision({ ...t, matchdays: t.matchdays.map(day => day.phaseName === phase
    ? { ...day, fixtures: day.fixtures.map(f => ({ ...f, result: { homeGoals: 1, awayGoals: 0 } })) } : day) });
}
describe("official draws", () => {
  it("lists the fifth-placed clubs without fabricating a result and applies only the verified order", () => {
    const t = seedTie(), repository = memoryRepository(t);
    const context = getOfficialResolutionContexts(t).find(c => c.scope === "argentina-seeding")!;
    expect(context.participantIds).toEqual(["t22", "t4"]);
    expect(t.matchdays.find(day => day.phaseName === "Reducido · Primera fase")!.fixtures).toHaveLength(6);
    const provisional = recordOfficialResolution(t, { context, verification: "provisional", source: afa,
      orderedTeamIds: ["t22", "t4"], verifiedByUser: false }, repository);
    expect(provisional.matchdays.find(day => day.phaseName === "Reducido · Primera fase")!.fixtures).toHaveLength(6);
    const verified = recordOfficialResolution(provisional, { context, verification: "verified", source: afa,
      orderedTeamIds: ["t22", "t4"], verifiedByUser: true }, repository);
    const last = verified.matchdays.find(day => day.phaseName === "Reducido · Primera fase")!.fixtures[6];
    expect(last.homeTeamId).toBe("t22"); expect(last.awayTeamId).toBe("t4"); expect(last.result).toBeUndefined();
    expect(verified.officialResolutions).toHaveLength(2);
    expect(verified.officialResolutions![0].supersededBy).toBe(verified.officialResolutions![1].id);
    expect(validateTournamentIntegrity(verified)).toEqual([]);
  });
  it("rejects foreign, duplicate or incomplete orders, unofficial sources and unconfirmed verification", () => {
    const t = seedTie(), repository = memoryRepository(t), context = getOfficialResolutionContexts(t)[0];
    const input = { context, verification: "verified" as const, source: afa, orderedTeamIds: ["t22", "t4"], verifiedByUser: true };
    for (const order of [["t22"], ["t22", "t22"], ["t22", "t8"]])
      expect(() => recordOfficialResolution(t, { ...input, orderedTeamIds: order }, repository)).toThrow();
    expect(() => recordOfficialResolution(t, { ...input, source: { ...afa, url: "https://afa.com.ar.example.com" } }, repository)).toThrow();
    expect(() => recordOfficialResolution(t, { ...input, verifiedByUser: false }, repository)).toThrow("Confirma");
    expect(repository.saveWithActivity).not.toHaveBeenCalled();
  });
  it("invalidates changed participants and never reactivates the old record automatically", () => {
    const t = seedTie(), repository = memoryRepository(t), context = getOfficialResolutionContexts(t)[0];
    let next = recordOfficialResolution(t, { context, verification: "verified", source: afa, orderedTeamIds: ["t22", "t4"], verifiedByUser: true }, repository);
    const fixture = next.matchdays.find(day => day.number === 35)!.fixtures.find(f => f.homeTeamId === "t4")!;
    next = updateMatchResult(next, fixture.id, { homeGoals: 1, awayGoals: 0 }, repository);
    expect(next.officialResolutions![0].invalidation).toBeDefined();
    expect(next.officialResolutions![0].source).toEqual(afa);
    next = updateMatchResult(next, fixture.id, { homeGoals: 0, awayGoals: 0 }, repository);
    expect(next.matchdays.find(day => day.phaseName === "Reducido · Primera fase")!.fixtures).toHaveLength(6);
    expect(repository.saveWithActivity.mock.calls.some(call => JSON.stringify(call[1]).includes("invalidatedOfficialResolutions"))).toBe(true);
  });
  it("preserves an applicable draw after an unrelated match changes", () => {
    const t = seedTie(), repository = memoryRepository(t), context = getOfficialResolutionContexts(t)[0];
    const next = recordOfficialResolution(t, { context, verification: "verified", source: afa, orderedTeamIds: ["t22", "t4"], verifiedByUser: true }, repository);
    const fixture = next.matchdays.flatMap(day => day.fixtures).find(f => f.homeTeamId === "t0" && f.awayTeamId === "t1")!;
    const updated = updateMatchResult(next, fixture.id, { homeGoals: 3, awayGoals: 0 }, repository);
    expect(updated.officialResolutions![0].invalidation).toBeUndefined();
    expect(updated.officialResolutions![0].id).toBe(next.officialResolutions![0].id);
  });
  it("registers independent ordering draws for the next Reducido round, preserving the privileged top seed", () => {
    let t = seedTie(); const repository = memoryRepository(t);
    const fifths = getOfficialResolutionContexts(t)[0];
    t = recordOfficialResolution(t, { context: fifths, verification: "verified", source: afa, orderedTeamIds: ["t22", "t4"], verifiedByUser: true }, repository);
    t = fill(fill(t, "Final por el primer ascenso"), "Reducido · Primera fase"); repository.save(t);
    const quarters = getOfficialResolutionContexts(t).filter(c => c.key === "Reducido · Cuartos de final");
    expect(quarters).toHaveLength(3);
    for (const context of quarters) t = recordOfficialResolution(t, { context, verification: "verified", source: afa,
      orderedTeamIds: [...context.participantIds].reverse(), verifiedByUser: true }, repository);
    const returns = t.matchdays.find(day => day.phaseName === "Reducido · Cuartos de final · Vuelta")!;
    expect(returns.fixtures).toHaveLength(4);
    expect(returns.fixtures[0].homeTeamId).toBe("t18");
    expect(returns.fixtures.every(f => !f.result)).toBe(true);
    expect(validateTournamentIntegrity(t)).toEqual([]);
  });
  it("retains official records on reimport and invalidates changed sporting dependencies on replacement", async () => {
    const t = seedTie();
    const byId = new Map(t.teams.map(team => [team.id, team]));
    const season: OfficialLeagueSeason = { id: t.id, name: "Primera Nacional", season: 2026, sourceUrl: afa.url,
      format: "staged", competitionType: "league", teams: t.teams.map(team => ({ name: team.name, groupName: team.groupName })),
      matchdays: t.matchdays.filter(day => day.phaseName === "Fase regular").map(day => ({ number: day.number, phaseName: day.phaseName,
        matches: day.fixtures.map(f => ({ id: f.id, homeTeamName: byId.get(f.homeTeamId)!.name, awayTeamName: byId.get(f.awayTeamId)!.name,
          homeGoals: f.result!.homeGoals, awayGoals: f.result!.awayGoals })) })) };
    const source = { fetchSeason: async () => season };
    const repository = memoryRepository(t);
    let next = await importOfficialTournament(source, repository, undefined, "argentina-nacional", undefined,
      { seasonData: season, conflictResolution: "replace" });
    const context = getOfficialResolutionContexts(next)[0];
    next = recordOfficialResolution(next, { context, verification: "verified", source: afa,
      orderedTeamIds: [...context.participantIds].reverse(), verifiedByUser: true }, repository);
    next = await importOfficialTournament(source, repository, undefined, "argentina-nacional", undefined,
      { seasonData: season, conflictResolution: "update-preserving-results" });
    expect(next.officialResolutions![0].invalidation).toBeUndefined();
    const changed = { ...season, matchdays: season.matchdays.map(day => day.number === 35
      ? { ...day, matches: day.matches.map(f => f.homeTeamName === "Test Club 4" ? { ...f, homeGoals: 2, awayGoals: 0 } : f) } : day) };
    const replaced = await importOfficialTournament(source, repository, undefined, "argentina-nacional", undefined,
      { seasonData: changed, conflictResolution: "replace" });
    expect(replaced.officialResolutions![0].invalidation).toBeDefined();
    expect(replaced.officialResolutions![0].source).toEqual(afa);
  });
  it("revokes without deleting and blocks stale editor submissions", () => {
    const t = seedTie(), repository = memoryRepository(t), context = getOfficialResolutionContexts(t)[0];
    const input = { context, verification: "verified" as const, source: afa, orderedTeamIds: ["t22", "t4"], verifiedByUser: true };
    const next = recordOfficialResolution(t, input, repository);
    expect(() => recordOfficialResolution(t, input, repository)).toThrow("cambió");
    const revoked = revokeOfficialResolution(next, next.officialResolutions![0].id, "Acta rectificada", repository);
    expect(revoked.officialResolutions).toHaveLength(1);
    expect(revoked.officialResolutions![0].invalidation?.reason).toBe("Acta rectificada");
    expect(revoked.matchdays.find(day => day.phaseName === "Reducido · Primera fase")!.fixtures).toHaveLength(6);
  });
  it("does not bypass missing cards and applies a Brazilian draw to all final table consumers", () => {
    const source = divisionFixture("brasil");
    const raw = { ...source, matchdays: source.matchdays.map(day => ({ ...day, fixtures: day.fixtures.map(f => ({ ...f, result: { homeGoals: 0, awayGoals: 0 } })) })) };
    expect(getOfficialResolutionContexts(raw)).toEqual([]);
    const t = advanceSecondDivision({ ...raw, matchdays: raw.matchdays.map(day => ({ ...day, fixtures: day.fixtures.map(f => ({ ...f, eventsCoverage: "complete" as const })) })) });
    const context = getOfficialResolutionContexts(t)[0], repository = memoryRepository(t);
    expect(context.scope).toBe("brasil-table");
    const order = [...context.participantIds].reverse();
    const next = recordOfficialResolution(t, { context, verification: "verified", source: cbf, orderedTeamIds: order, verifiedByUser: true }, repository);
    const regular = { ...next, matchdays: next.matchdays.filter(day => day.phaseName === "Fase regular") };
    expect(calculateStandings(regular).map(row => row.teamId)).toEqual(order);
    expect(getUnresolvedStandingsTieGroups(regular, calculateStandings(regular))).toEqual([]);
    expect(getDivisionOutcome(next).relegated.map(row => row.teamId)).toEqual(order.slice(-4));
    const fixture = regular.matchdays[0].fixtures[0];
    const invalid = updateFixtureDetails(next, fixture.id, { eventsCoverage: "unverified" }, repository);
    expect(invalid.officialResolutions![0].invalidation).toBeDefined();
    expect(getDivisionOutcome(invalid).complete).toBe(false);
  });
});
describe("official AFA multiple relegation playoffs", () => {
  it("never generates a mini-tournament and keeps incomplete official programmes blocked", () => {
    const t = multipleTie(), context = getOfficialResolutionContexts(t).find(c => c.scope === "argentina-relegation")!;
    expect(context.participantIds).toEqual(["t15", "t16", "t17"]);
    expect(t.matchdays.find(day => day.phaseName === "Desempate descenso · Zona A")!.fixtures).toEqual([]);
    const repository = memoryRepository(t);
    const next = recordOfficialResolution(t, { context, verification: "verified", source: afa,
      programme: { ...programme(), matches: programme().matches.slice(0, 1) }, verifiedByUser: true }, repository);
    expect(programmeOrder(next, context)).toBeUndefined();
    expect(getDivisionOutcome(next).pending.join()).toContain("Desempate de descenso pendiente");
    expect(next.officialResolutions![0].programme!.matches).toHaveLength(1);
  });
  it("uses only sourced actual results, reorders the tied zone and confirms its descents", () => {
    const t = multipleTie(), repository = memoryRepository(t), context = getOfficialResolutionContexts(t).find(c => c.scope === "argentina-relegation")!;
    const next = recordOfficialResolution(t, { context, verification: "verified", source: afa, programme: programme(), verifiedByUser: true }, repository);
    expect(programmeOrder(next, context)).toEqual(["t17", "t16", "t15"]);
    const zone = divisionZoneTournaments(next)[0];
    expect(calculateStandings(zone).slice(-3).map(row => row.teamId)).toEqual(["t17", "t16", "t15"]);
    const down = getDivisionOutcome(next).relegated.map(row => row.teamId);
    expect(down).toContain("t15"); expect(down).toContain("t16"); expect(down).not.toContain("t17");
    expect(validateTournamentIntegrity(next)).toEqual([]);
  });
  it("requires a sourced AFA conclusion for other formats and rejects results without sources", () => {
    const t = multipleTie(), repository = memoryRepository(t), context = getOfficialResolutionContexts(t).find(c => c.scope === "argentina-relegation")!;
    const input = { context, verification: "verified" as const, source: afa, verifiedByUser: true };
    const custom = { ...programme(), format: "afa-decision" as const };
    const pending = recordOfficialResolution(t, { ...input, programme: custom }, repository);
    expect(programmeOrder(pending, context)).toBeUndefined();
    const next = recordOfficialResolution(pending, { ...input, programme: { ...custom,
      conclusion: { orderedTeamIds: ["t17", "t16", "t15"], source: afa } } }, repository);
    expect(programmeOrder(next, context)).toEqual(["t17", "t16", "t15"]);
    expect(() => recordOfficialResolution(next, { ...input, programme: { ...programme(), matches: programme().matches.map(match => ({ ...match, resultSource: undefined })) } }, repository)).toThrow();
    expect(() => recordOfficialResolution(next, { ...input, programme: { ...programme(), conclusion: { orderedTeamIds: ["t15", "t16", "t17"], source: afa } } }, repository)).toThrow("invertir");
  });
  it("does not use a relegation decision to resolve top-eight qualification in a large overlapping points tie", () => {
    const source = divisionFixture("argentina");
    const t = advanceSecondDivision({ ...source, matchdays: source.matchdays.map(day => ({ ...day, fixtures: day.fixtures.map(f => {
      const a = source.teams.find(team => team.id === f.homeTeamId)!, b = source.teams.find(team => team.id === f.awayTeamId)!;
      return a.groupName === "Zona A" && b.groupName === "Zona A"
        ? { ...f, result: { homeGoals: 1, awayGoals: 0 } }
        : a.groupName !== b.groupName ? { ...f, result: { homeGoals: 0, awayGoals: 0 } } : f;
    }) })) });
    const context = getOfficialResolutionContexts(t).find(c => c.scope === "argentina-relegation")!;
    expect(context.participantIds).toHaveLength(18);
    const order = [...context.participantIds].reverse();
    const matches = Array.from({ length: 9 }, (_, index) => ({ id: `published-${index}`,
      homeTeamId: order[index * 2], awayTeamId: order[index * 2 + 1], neutral: true,
      result: { homeGoals: 1, awayGoals: 0 }, resultSource: afa }));
    const repository = memoryRepository(t);
    const next = recordOfficialResolution(t, { context, verification: "verified", source: afa, verifiedByUser: true,
      programme: { format: "afa-decision", description: "Disposición AFA sintética solo para descenso", expectedMatches: 9, matches,
        conclusion: { orderedTeamIds: order, source: afa } } }, repository);
    expect(getDivisionOutcome(next).relegated).toHaveLength(4);
    expect(next.matchdays.find(day => day.phaseName === "Final por el primer ascenso")!.fixtures).toHaveLength(0);
    const zone = divisionZoneTournaments(next)[0];
    expect(getUnresolvedStandingsTieGroups(zone, calculateStandings(zone)).some(group => group.length === 18)).toBe(true);
    expect(getDivisionOutcome(next).complete).toBe(false);
  });
  it("invalidates the programme when the regular tie changes, preserving all its matches", () => {
    const t = multipleTie(), repository = memoryRepository(t), context = getOfficialResolutionContexts(t).find(c => c.scope === "argentina-relegation")!;
    const next = recordOfficialResolution(t, { context, verification: "verified", source: afa, programme: programme(), verifiedByUser: true }, repository);
    const fixture = next.matchdays.find(day => day.number === 35)!.fixtures.find(f => f.homeTeamId === "t15")!;
    const invalid = updateMatchResult(next, fixture.id, { homeGoals: 0, awayGoals: 2 }, repository);
    expect(invalid.officialResolutions![0].invalidation).toBeDefined();
    expect(invalid.officialResolutions![0].programme).toEqual(programme());
  });
  it("keeps the official programme pending when the rest of the championship is simulated", () => {
    const t = multipleTie(), repository = memoryRepository(t), context = getOfficialResolutionContexts(t).find(c => c.scope === "argentina-relegation")!;
    const next = recordOfficialResolution(t, { context, verification: "verified", source: afa, verifiedByUser: true,
      programme: { ...programme(), matches: programme().matches.map(({ result: _result, resultSource: _source, ...match }) => match) } }, repository);
    let seed = 42;
    const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; };
    const simulated = simulateChampionship(next, "pendingOnly", repository, random).tournament;
    expect(simulated.officialResolutions![0].programme!.matches.every(match => !match.result)).toBe(true);
    expect(getDivisionOutcome(simulated).complete).toBe(false);
  });
  it("allows completing the season only after the official decision, without generating any official result", () => {
    let t = multipleTie();
    for (const phase of ["Final por el primer ascenso", "Reducido · Primera fase", "Reducido · Cuartos de final · Ida", "Reducido · Cuartos de final · Vuelta", "Reducido · Semifinales · Ida", "Reducido · Semifinales · Vuelta"]) t = fill(t, phase);
    t = advanceSecondDivision({ ...t, matchdays: t.matchdays.map(day => day.phaseName === "Reducido · Final · Ida"
      ? { ...day, fixtures: day.fixtures.map(f => ({ ...f, result: { homeGoals: 0, awayGoals: 0 } })) } : day) });
    t = fill(t, "Reducido · Final · Vuelta");
    expect(getDivisionOutcome(t).complete).toBe(false);
    const context = getOfficialResolutionContexts(t).find(c => c.scope === "argentina-relegation")!, repository = memoryRepository(t);
    const next = recordOfficialResolution(t, { context, verification: "verified", source: afa, programme: programme(), verifiedByUser: true }, repository);
    expect(getDivisionOutcome(next).complete).toBe(true);
    expect(next.matchdays).toEqual(t.matchdays);
    const teams = Array.from({ length: 30 }, (_, i) => ({ id: `u${i}`, name: `Upper Club ${i}` }));
    const regular = generateRoundRobinSchedule(teams, 2).slice(0, 32).map((day, index) => ({ ...day,
      phaseName: `Torneo ${index < 16 ? "Apertura" : "Clausura"} · Fase regular`, fixtures: day.fixtures.map(f => ({ ...f,
        result: Number(f.homeTeamId.slice(1)) < Number(f.awayTeamId.slice(1)) ? { homeGoals: 2, awayGoals: 0 } : { homeGoals: 0, awayGoals: 2 } })) }));
    const high: Tournament = { id: "arg-liga-profesional-2026", competitionId: "arg-liga-profesional", name: "Primera", season: 2026,
      createdAt: "2026-01-01T00:00:00Z", legs: 2, tieBreakers: ["goalDifference"], teams,
      matchdays: [...regular, ...["Apertura", "Clausura"].map((half, index) => ({ number: 33 + index, leg: 2,
        phaseName: `Torneo ${half} · Final`, fixtures: [{ id: `final-${half}`, homeTeamId: "u0", awayTeamId: "u1", result: { homeGoals: 1, awayGoals: 0 } }] }))] };
    const history = [2024, 2025].map(season => ({ ...high, id: `arg-liga-profesional-${season}`, season, importCoverage: "complete" as const, matchdays: regular }));
    expect(getDivisionTransition(high, t, history).pending.join()).toContain("Desempate de descenso");
    const transition = getDivisionTransition(high, next, history);
    expect(transition.pending).toEqual([]);
    expect(transition.lowerRelegated).toContain("t15");
    expect(transition.lowerRelegated).not.toContain("t17");
  });
});

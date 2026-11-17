import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateSeasonClosure } from "./season-closure";
import { confirmSeasonClosure, reviewSeasonClosure } from "../use-cases/confirm-season-closure";
import { closureLeague, closureCup, closureMemory } from "../../test-utils/season-closure-fixtures";
import { seasonHonours } from "./club-honours";
import { calculateStandings } from "../../domain/services/standings";
import { divisionFixture } from "../../domain/services/second-division-test-fixtures";
import { simulateChampionship } from "../use-cases/simulate-championship";
import { createTournamentBackup, parseTournamentBackupWithActivity } from "./tournament-archive";
import { updateMatchResult } from "../use-cases/update-match-result";
import { isActivityEvent } from "../../domain/entities/activity-event";
import type { Tournament } from "../../domain/entities/tournament";
import { continentalSourceSnapshot } from "./continental-projection";

afterEach(() => vi.restoreAllMocks());
const evaluate = (t: Tournament, others: Tournament[] = []) => evaluateSeasonClosure(t, [t,...others], [], null);

describe("season closure aggregation and confirmation", () => {
  it("a completely played league uses the existing champion and final table", () => {
    const t = closureLeague(), view = evaluate(t);
    expect(view.state).toBe("Lista para revisión final");expect(view.blockers).toEqual([]);
    expect(view.honours.awards).toEqual(seasonHonours(t).awards);
    expect(view.tables[0].rows).toEqual(calculateStandings(t));
    expect(view.international?.entries.every(entry => entry.status === "confirmed")).toBe(true);
  });
  it("registered pending games and completed phases remain distinct", () => {
    const t = closureLeague(), pending = {...t, matchdays: t.matchdays.map((day, index) => index ? day : {...day, fixtures: day.fixtures.map(f => ({...f, result: undefined}))})};
    const view = evaluate(pending);
    expect(view.state).toBe("Temporada en disputa");expect(view.canConfirm).toBe(false);
    expect(view.matchdays.some(p => p.complete)).toBe(true);expect(view.matchdays.some(p => !p.complete)).toBe(true);
    expect(view.phases.every(p=>!p.complete)).toBe(true);
  });
  it("a cup final supplies champion and runner-up without inventing a league table", () => {
    const t = closureCup(), view = evaluate(t);
    expect(view.canConfirm).toBe(true);expect(view.tables).toEqual([]);
    expect(view.honours.awards.find(a => a.label === "Campeón")?.teamId).toBe(t.teams[0].id);
    expect(view.honours.awards.find(a => a.label === "Subcampeón")?.teamId).toBe(t.teams[2].id);
  });
  it("an unfinished knockout and a missing registered final cannot close", () => {
    const t = closureCup();
    expect(evaluate({...t, matchdays: t.matchdays.slice(0,1)}).canConfirm).toBe(false);
    expect(evaluate({...t, matchdays: t.matchdays.map(day => ({...day, fixtures: day.fixtures.map(f => ({...f, result: undefined}))}))}).canConfirm).toBe(false);
  });
  it("no calendar, empty phases and incomplete round-robin schedules never mean finished", () => {
    const t = closureLeague();
    for (const matchdays of [[], [{number: 1, leg: 1, fixtures: []}], t.matchdays.slice(0,1)])
      expect(evaluate({...t, matchdays}).canConfirm).toBe(false);
    expect(evaluate({...t, matchdays: []}).state).toBe("Sin calendario");
    expect(evaluate({...t, matchdays:t.matchdays.map(day=>({...day,fixtures:day.fixtures.map(f=>({...f,result:undefined}))}))}).state).toBe("Partidos pendientes");
  });
  it.each([undefined, {season: 2025, verification: {standings: "verified", placements: "verified"}}, {season: 2026, verification: {standings: "pending", placements: "pending"}}] as const)("requires coherent, verified annual rules: %j", competitionRules => {
    expect(evaluate({...closureLeague(), competitionRules}).canConfirm).toBe(false);
  });
  it("checks registered match regulations, integrity and operational states", () => {
    const t = closureLeague();
    expect(evaluate({...t, matchRegulations: {schemaVersion: 1, season: 2026, verification: "pending"}}).canConfirm).toBe(false);
    expect(evaluate({...t, teams: [t.teams[0],t.teams[0],...t.teams.slice(2)]}).canConfirm).toBe(false);
    const changed = {...t, matchdays: t.matchdays.map(day => ({...day, fixtures: day.fixtures.map(f => ({...f, operationalState: {status: "suspended" as const, updatedAt: t.createdAt}}))}))};
    expect(evaluate(changed).canConfirm).toBe(false);
  });
  it("does not invent a champion for unknown staged formats or resolve ties", () => {
    const t = closureLeague();
    expect(evaluate({...t, format: "staged"}).canConfirm).toBe(false);
    const tied = {...t, matchdays: t.matchdays.map(day => ({...day, fixtures: day.fixtures.map(f => ({...f, result: {homeGoals: 0, awayGoals: 0}}))}))};
    expect(evaluate(tied).honours.awards).toEqual([]);expect(evaluate(tied).canConfirm).toBe(false);
  });
  it("uses the division outcome for resolved promotions and flags pending playoffs", () => {
    const source = divisionFixture("brasil"), memory = closureMemory([source]);
    expect(evaluate(source).canConfirm).toBe(false);
    const completed = simulateChampionship(source, "pendingOnly", memory.repository, () => .5).tournament;
    const view = evaluate(completed);
    expect(view.division?.complete).toBe(true);expect(view.division?.promoted).toHaveLength(4);
    expect(view.division?.relegated).toHaveLength(4);expect(view.canConfirm).toBe(true);
  });
  it("reports missing relegation history as an own-competition blocker", () => {
    const t = closureLeague();
    const view = evaluate({...t, competitionRules: {...t.competitionRules!, relegationAverage: {verification: "verified", seasons: [2025,2026], relegatedCount: 1}}});
    expect(view.canConfirm).toBe(false);expect(view.averages?.pendingReasons.length).toBeGreaterThan(0);
  });
  it("table relegations come from configured places and unresolved promotions block", () => {
    const t = closureLeague(), configured = {...t, placementRules: {relegationPlaces: 1}};
    expect(evaluate(configured).relegated.map(r => r.teamId)).toEqual([t.teams[3].id]);
    expect(evaluate({...configured, placementRules: {relegationPlayoffPlaces: {from: 3,to: 4}}}).canConfirm).toBe(false);
  });
  it("provisional international access does not block an independently completed league", () => {
    const t = closureLeague(), view = evaluate({...t, competitionRules: {...t.competitionRules!, internationalQualification: {...t.competitionRules!.internationalQualification!, verification: "provisional"}}});
    expect(view.international?.entries.some(e => e.status === "provisional")).toBe(true);
    expect(view.nextSeasonPending.length).toBeGreaterThan(0);expect(view.canConfirm).toBe(true);
  });
  it("an unfinished referenced cup affects next-edition access rather than the league title", () => {
    const t = closureLeague(), cup = closureCup();
    const configured = {...t, competitionRules: {...t.competitionRules!, internationalQualification: {verification: "verified" as const, slots: [], cupChampions: [{sourceTournamentId: cup.id, destination: "conmebol-libertadores"}]}}};
    const pending = {...cup, matchdays: []};
    const view = evaluate(configured,[pending]);
    expect(view.canConfirm).toBe(true);expect(view.nextSeasonPending.length).toBeGreaterThan(0);
    expect(evaluate(configured,[cup]).international?.entries.some(e => e.originTournamentId === cup.id && e.status === "confirmed")).toBe(true);
  });
  it("review consumes no randomness, changes no input and performs no writes", () => {
    const {state,repository} = closureMemory(), before = JSON.stringify(state);
    const random = vi.spyOn(Math,"random");reviewSeasonClosure(state.tournaments[0].id,null,repository);
    expect(JSON.stringify(state)).toBe(before);expect(random).not.toHaveBeenCalled();
  });
  it("only explicit confirmation appends activity and preserves every result and archive state", () => {
    const {state,repository} = closureMemory(), t = state.tournaments[0], before = JSON.stringify(t);
    const review = reviewSeasonClosure(t.id,null,repository);
    expect(() => confirmSeasonClosure(review,null,repository,false)).toThrow(/explícita/);
    expect(state.writes).toBe(0);
    const event = confirmSeasonClosure(review,null,repository,true);
    expect(event.action).toBe("season-closure-confirmed");expect(isActivityEvent(event)).toBe(true);
    expect(state.writes).toBe(1);expect(JSON.stringify(state.tournaments[0])).toBe(before);
    expect(evaluateSeasonClosure(t,state.tournaments,state.activity,null).state).toBe("Cierre confirmado");
  });
  it("a copied, altered, consumed or independently duplicated review cannot confirm twice", () => {
    const {state,repository} = closureMemory(), t = state.tournaments[0];
    const a = reviewSeasonClosure(t.id,null,repository), b = reviewSeasonClosure(t.id,null,repository);
    expect(() => confirmSeasonClosure({...a},null,repository,true)).toThrow();
    confirmSeasonClosure(a,null,repository,true);
    expect(() => confirmSeasonClosure(a,null,repository,true)).toThrow();
    expect(() => confirmSeasonClosure(b,null,repository,true)).toThrow();
    expect(() => confirmSeasonClosure(reviewSeasonClosure(t.id,null,repository),null,repository,true)).toThrow(/ya está confirmado/);
    expect(state.activity).toHaveLength(1);
  });
  it("a different universe and a stale library are rejected before activity", () => {
    const {state,repository} = closureMemory(), t = state.tournaments[0], review = reviewSeasonClosure(t.id,"one",repository);
    expect(() => confirmSeasonClosure(review,"two",repository,true)).toThrow(/universo/);
    state.tournaments = [{...t,name:"Cambio externo"}];
    expect(() => confirmSeasonClosure(review,"one",repository,true)).toThrow(/obsoleta/);expect(state.activity).toEqual([]);
  });
  it("later results, regulations and operational decisions invalidate without removing history", () => {
    const {state,repository} = closureMemory(), t = state.tournaments[0];
    confirmSeasonClosure(reviewSeasonClosure(t.id,null,repository),null,repository,true);
    for (const updated of [{...t, competitionRules: {...t.competitionRules!, verification: {standings:"pending" as const,placements:"pending" as const}}}, {...t, name:"Nueva revisión"}]) {
      expect(evaluateSeasonClosure(updated,[updated],state.activity,null).state).toBe("Cierre desactualizado");
    }
    updateMatchResult(t,t.matchdays[0].fixtures[0].id,{homeGoals: 5,awayGoals: 0},repository);
    expect(evaluateSeasonClosure(state.tournaments[0],state.tournaments,state.activity,null).confirmed).toBe(false);
    expect(state.activity.filter(e => e.action === "season-closure-confirmed")).toHaveLength(1);
  });
  it("reverting scores still requires a new review because the sporting activity changed", () => {
    const {state,repository} = closureMemory(), t = state.tournaments[0], f = t.matchdays[0].fixtures[0];
    confirmSeasonClosure(reviewSeasonClosure(t.id,null,repository),null,repository,true);
    updateMatchResult(t,f.id,{homeGoals: 8,awayGoals: 0},repository);
    updateMatchResult(state.tournaments[0],f.id,f.result!,repository);
    expect(evaluateSeasonClosure(state.tournaments[0],state.tournaments,state.activity,null).state).toBe("Cierre desactualizado");
  });
  it("unrelated seasons and external qualification updates do not stale a confirmed own closure", () => {
    const t = closureLeague(), other = closureLeague("unrelated"), {state,repository} = closureMemory([t,other]);
    confirmSeasonClosure(reviewSeasonClosure(t.id,null,repository),null,repository,true);
    state.tournaments = [t,{...other,name:"Otro torneo modificado"}];
    expect(evaluateSeasonClosure(t,state.tournaments,state.activity,null).confirmed).toBe(true);
  });
  it("independent cup results update access without invalidating the league's own closure", () => {
    const source = closureLeague(), cup = closureCup();
    const t = {...source, competitionRules: {...source.competitionRules!, internationalQualification: {verification: "verified" as const, slots: [], cupChampions: [{sourceTournamentId: cup.id,destination: "conmebol-libertadores"}]}}};
    const {state,repository} = closureMemory([t,{...cup,matchdays: []}]);
    confirmSeasonClosure(reviewSeasonClosure(t.id,null,repository),null,repository,true);
    state.tournaments = [t,cup];
    const current = evaluateSeasonClosure(t,state.tournaments,state.activity,null);
    expect(current.confirmed).toBe(true);expect(current.international?.entries.some(e => e.status === "confirmed")).toBe(true);
  });
  it("a dependency of the current edition invalidates its previous closure", () => {
    const parent = closureLeague(), cup = closureCup();
    const t: Tournament = {...cup, competitionId: "conmebol-libertadores", continentalPlans: [{schemaVersion:1,id:"admission",at:cup.createdAt,cup:"libertadores",edition:2026,qualifyingSeason:2026,
      sourceTournamentIds:[parent.id],dependencies:[{tournamentId:parent.id,snapshot:continentalSourceSnapshot(parent.id,[parent],[])}],entries:[],sourceUrl:"https://example.test/admission",note:"Synthetic admission review",mode:"review"}]};
    const {state,repository} = closureMemory([t,parent]);
    expect(evaluateSeasonClosure(t,state.tournaments,[],null).blockers).toEqual([]);
    confirmSeasonClosure(reviewSeasonClosure(t.id,null,repository),null,repository,true);
    const updated = {...parent, matchdays: parent.matchdays.map((day,index) => index ? day : {...day,fixtures: day.fixtures.map(f => ({...f,result:{homeGoals:4,awayGoals:1}}))})};
    state.tournaments = [t,updated];
    expect(evaluateSeasonClosure(t,state.tournaments,state.activity,null).state).toBe("Cierre desactualizado");
    expect(state.activity).toHaveLength(1);
  });
  it("a changed library during the preview cannot be bound to an older evaluation", () => {
    const t = closureLeague();let reads = 0;
    expect(() => reviewSeasonClosure(t.id,null,{findAll: () => ++reads === 1 ? [t] : [{...t,name:"Concurrent change"}],save:()=>{} })).toThrow(/durante la revisión/);
  });
  it("JSON v7 roundtrips confirmation history, imported markers and historical backups without closure", () => {
    const {state,repository} = closureMemory(), t = state.tournaments[0];
    expect(parseTournamentBackupWithActivity(JSON.stringify(createTournamentBackup([t]))).activity).toEqual([]);
    confirmSeasonClosure(reviewSeasonClosure(t.id,null,repository),null,repository,true);
    const backup = createTournamentBackup(state.tournaments,undefined,state.activity);
    expect(backup.version).toBe(7);
    const restored = parseTournamentBackupWithActivity(JSON.stringify(backup));
    expect(evaluateSeasonClosure(restored.tournaments[0],restored.tournaments,restored.activity,null).confirmed).toBe(true);
    expect(isActivityEvent({...state.activity[0],after:{schemaVersion:1}})).toBe(false);
  });
});

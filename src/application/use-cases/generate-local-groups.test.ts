// @vitest-environment jsdom
import {beforeEach,expect,it,vi} from "vitest";
import {generatorScenario} from "../../test-utils/group-generator-fixtures";
import {generateLocalGroups,reviewGeneratedLocalGroups} from "./generate-local-groups";
import {groupDistributionIdentity,searchGroupDistribution} from "../services/constraint-group-generator";
import {confirmStageDraw,reviewStageDraw,reviewDrawCalendar,confirmDrawCalendar} from "./prepare-stage-draw";
import {inspectDrawPreparation} from "../services/draw-and-bracket";
import {validateDrawConfiguration,validateManualDrawConfiguration} from "../services/draw-configuration";
import {isStageDrawRecord} from "../../domain/entities/stage-draw";
import {isActivityEvent} from "../../domain/entities/activity-event";
import {createTournamentBackup,parseTournamentBackupWithActivity} from "../services/tournament-archive";
import {LocalStorageTournamentRepository} from "../../infrastructure/persistence/local-storage-tournament-repository";
import {installTestWebLocks} from "../../test-utils/web-locks";
import {withLibraryWriteLock} from "../../infrastructure/persistence/library-write-lock";
import {simulateFixtures} from "./simulate-fixtures";
import type {GroupSearchOptions} from "../services/constraint-group-generator";
import * as solver from "../services/constraint-group-generator";

beforeEach(()=>{localStorage.clear();installTestWebLocks();vi.restoreAllMocks();});
const deterministic:GroupSearchOptions={now:()=>0,cooperate:()=>Promise.resolve()};
async function proposal(s:ReturnType<typeof generatorScenario>,seed=s.input.seed){
  const result=await generateLocalGroups({...s.input,seed},s.repository,deterministic);
  expect(result.state,result.reasons.join(" ")).toBe("Viable");return result.proposal!;
}
it("finds and fully validates a feasible configuration, capacities and exact pot quotas without writes",async()=>{
  const s=generatorScenario(16,4),before=JSON.stringify(s.state),p=await proposal(s);
  expect(p.groups).toHaveLength(4);expect(p.groups.every(g=>g.teamIds.length===4)).toBe(true);
  expect(validateManualDrawConfiguration(s.configuration,p.groups)).toEqual([]);expect(new Set(p.groups.flatMap(g=>g.teamIds)).size).toBe(16);expect(JSON.stringify(s.state)).toBe(before);
});
it("proves an impossible odd incompatibility cycle after exhaustive search",async()=>{
  const s=generatorScenario();s.configuration.restrictions=[[0,1],[1,2],[2,0]].map((pair,i)=>({id:`pair-${i}`,type:"incompatible",teamIds:pair.map(j=>s.ids[j])}));
  expect(validateDrawConfiguration(s.configuration,s.t,[s.t],s.state.activity,null).state).toBe("Válida");
  const r=await generateLocalGroups(s.input,s.repository,deterministic);expect(r.state).toBe("Imposible");expect(r.proposal).toBeUndefined();expect(r.stats.nodes).toBeGreaterThan(0);
});
it.each([{maxNodes:0},{maxChecks:0},{maxTimeMs:0}])("returns undetermined for an exhausted budget %j, never impossible",async budget=>{
  const s=generatorScenario(),r=await generateLocalGroups(s.input,s.repository,{...deterministic,...budget});expect(r.state).toBe("No determinado");expect(r.proposal).toBeUndefined();expect(r.reasons.join()).toMatch(/agotado/);
});
it("treats structural contradictions as invalid before starting any search",async()=>{const s=generatorScenario();s.configuration.restrictions.push({id:"bad",type:"group-size",group:"G1",min:3,max:2});const r=await generateLocalGroups(s.input,s.repository,deterministic);expect(r.state).toBe("Configuración inválida");expect(r.stats.nodes).toBe(0);});
it("respects explicit incompatibilities and ordinal fixed slots",async()=>{const s=generatorScenario(8,2);s.configuration.restrictions.push({id:"fixed",type:"fixed-position",teamId:s.ids[0],group:"G2",position:3},{id:"separate",type:"incompatible",teamIds:[s.ids[0],s.ids[2]]});const p=await proposal(s);expect(p.groups.find(g=>g.name==="G2")!.teamIds[2]).toBe(s.ids[0]);expect(p.groups.find(g=>g.teamIds.includes(s.ids[2]))!.name).toBe("G1");});
it.each(["duplicate","absent","incomplete","unsupported","association"])("rejects %s configuration without searching",async kind=>{
  const s=generatorScenario();
  if(kind==="duplicate")s.configuration.pots[1].teamIds[0]=s.ids[0];
  if(kind==="absent")s.configuration.participantIds.pop();
  if(kind==="incomplete")s.configuration.pots[0].teamIds.pop();
  if(kind==="unsupported")s.configuration.restrictions.push({id:"unsupported",type:"unsupported",description:"Condición no representada"});
  if(kind==="association")s.configuration.restrictions.push({id:"association",type:"association",description:"Asociación no acreditada"});
  const r=await generateLocalGroups(s.input,s.repository,deterministic);expect(r.state).toBe("Configuración inválida");expect(r.stats.nodes).toBe(0);
});
it("uses only explicit seed restrictions, never the first team or champion ordering",async()=>{const s=generatorScenario();s.configuration.seeding={basis:"Identificación explícita sin privilegios adicionales",teamIds:[s.ids[3]]};const p=await proposal(s);expect(validateManualDrawConfiguration(s.configuration,p.groups)).toEqual([]);s.configuration.restrictions.push({id:"seed-slot",type:"fixed-position",teamId:s.ids[3],group:"G1",position:2});expect((await proposal(s)).groups.find(g=>g.name==="G1")!.teamIds[1]).toBe(s.ids[3]);});
it("reproduces the same ordered proposal for the same configuration and seed",async()=>{const s=generatorScenario(16,4),a=await proposal(s,"explicit"),b=await proposal(s,"explicit");expect(a.groups).toEqual(b.groups);expect(a.stats).toEqual(b.stats);});
it("can generate different proposals with explicit different seeds without claiming uniformity",async()=>{const s=generatorScenario(8,2),identities=new Set<string>();for(let i=0;i<8;i++)identities.add(groupDistributionIdentity((await proposal(s,`seed-${i}`)).groups));expect(identities.size).toBeGreaterThan(1);});
it("handles a unique solution honestly: other seeds may return the same distribution",async()=>{const s=generatorScenario();s.configuration.restrictions=s.ids.map((id,i)=>({id:`fixed-${i}`,type:"fixed-position",teamId:id,group:i<2?"G1":"G2",position:i%2+1}));expect(groupDistributionIdentity((await proposal(s,"a")).groups,true)).toBe(groupDistributionIdentity((await proposal(s,"b")).groups,true));});
it("does not take the current team/display order as an identity or ordinal position",async()=>{const s=generatorScenario(),p=await proposal(s);const reordered={...s.configuration,participantIds:[...s.ids].reverse()};const registered=inspectDrawPreparation(s.t,[s.t],s.state.activity,null).groups;const r=await searchGroupDistribution(reordered,[...registered].reverse(),s.input.seed,deterministic);expect(r.groups).toEqual(p.groups);});
it("reviews and confirms exactly the generated groups and metadata without invoking the solver or randomness",async()=>{
  const s=generatorScenario(),p=await proposal(s),before=JSON.stringify(s.state),r=reviewGeneratedLocalGroups(p,s.repository,null);expect(JSON.stringify(s.state)).toBe(before);
  const search=vi.spyOn(solver,"searchGroupDistribution").mockRejectedValue(new Error("No search during confirmation"));
  vi.spyOn(Math,"random").mockImplementation(()=>{throw new Error("No random during confirmation");});
  const event=confirmStageDraw(r,s.repository,null,true).event;expect(isActivityEvent(event)).toBe(true);
  expect(search).not.toHaveBeenCalled();
  expect(r.record.mode).toBe("generated");expect(r.record.generation).toEqual({method:"constraint-groups-v1",seed:s.input.seed});expect(r.record.configurationRevision).toBe(1);
  expect(s.state.tournaments[0].teams.every(team=>p.groups.find(g=>g.name===team.groupName)?.teamIds.includes(team.id))).toBe(true);expect(s.state.tournaments[0].matchdays).toEqual([]);expect(s.state.activity[0].action).toBe("draw-configuration-recorded");
});
it("rejects tampered or cloned proposals, stale reviews and universe changes",async()=>{const s=generatorScenario(),p=await proposal(s);expect(()=>reviewGeneratedLocalGroups({...p},s.repository,null)).toThrow(/obsoleta/);expect(()=>reviewGeneratedLocalGroups(p,s.repository,"other")).toThrow(/universo/);const r=reviewGeneratedLocalGroups(p,s.repository,null);s.state.tournaments=[{...s.t,name:"Cambiada"}];expect(()=>reviewGeneratedLocalGroups(p,s.repository,null)).toThrow(/obsoleta/);expect(()=>confirmStageDraw(r,s.repository,null,true)).toThrow(/cambi/);});
it("serializes two concurrent tab confirmations under the existing Web Lock",async()=>{const s=generatorScenario(),a=reviewGeneratedLocalGroups(await proposal(s,"a"),s.repository,null),b=reviewGeneratedLocalGroups(await proposal(s,"b"),s.repository,null);const settled=await Promise.allSettled([withLibraryWriteLock(()=>confirmStageDraw(a,s.repository,null,true)),withLibraryWriteLock(()=>confirmStageDraw(b,s.repository,null,true))]);expect(settled.map(r=>r.status)).toEqual(["fulfilled","rejected"]);expect(s.state.activity.filter(e=>e.action==="stage-draw-confirmed")).toHaveLength(1);});
it("blocks a previous draw even if its foundation is stale",async()=>{const s=generatorScenario();confirmStageDraw(reviewGeneratedLocalGroups(await proposal(s),s.repository,null),s.repository,null,true);s.state.tournaments=[{...s.state.tournaments[0],name:"Alterada"}];expect((await generateLocalGroups(s.input,s.repository,deterministic)).state).toBe("Configuración inválida");});
it("blocks played or scheduled competition and preserves every fixture field and prior activity",async()=>{const s=generatorScenario();s.state.tournaments=[{...s.t,matchdays:[{number:1,leg:1,fixtures:[{id:"old",homeTeamId:s.ids[0],awayTeamId:s.ids[1],result:{homeGoals:2,awayGoals:0},schedule:{date:"2026-11-11",time:"20:00"}}]}]}];const before=JSON.stringify(s.state);expect((await generateLocalGroups(s.input,s.repository,deterministic)).state).toBe("Configuración inválida");expect(JSON.stringify(s.state)).toBe(before);});
it("rejects provisional documentation and outdated dependencies without search",async()=>{const s=generatorScenario();s.configuration.mode="documented";s.configuration.source={url:"https://example.org/rules",reference:"Referencia sintética"};expect((await generateLocalGroups(s.input,s.repository,deterministic)).state).toBe("Configuración inválida");s.configuration.verification="verified";expect((await generateLocalGroups(s.input,s.repository,deterministic)).state).toBe("Viable");s.state.tournaments=[{...s.t,seasonPreparation:{...s.t.seasonPreparation!,sourceTournamentIds:["missing"]}}];expect((await generateLocalGroups(s.input,s.repository,deterministic)).state).toBe("Configuración inválida");});
it("keeps documented configuration provenance while recording a generated local result",async()=>{const s=generatorScenario();s.configuration.mode="documented";s.configuration.verification="verified";s.configuration.source={url:"https://example.org/rules",reference:"Referencia sintética"};const r=reviewGeneratedLocalGroups(await proposal(s),s.repository,null);expect(r.record.source?.verification).toBe("verified");expect(r.record.mode).toBe("generated");});
it("exports and restores generated provenance in v7, then uses the existing calendar and simulation",async()=>{
  const s=generatorScenario(),p=await proposal(s),{event}=confirmStageDraw(reviewGeneratedLocalGroups(p,s.repository,null),s.repository,null,true);
  const backup=createTournamentBackup(s.state.tournaments,undefined,s.state.activity);expect(backup.version).toBe(7);const restored=parseTournamentBackupWithActivity(JSON.stringify(backup));
  expect((restored.activity.find(e=>e.action==="stage-draw-confirmed")!.after as {generation:unknown}).generation).toEqual({method:"constraint-groups-v1",seed:s.input.seed});
  const repo=new LocalStorageTournamentRepository(false);repo.importTournaments(restored.tournaments,"replace",restored.activity);
  const calendar=reviewDrawCalendar(s.t.id,event.id,null,repo),next=confirmDrawCalendar(calendar,repo,null,true);expect(next.matchdays.flatMap(d=>d.fixtures)).toHaveLength(2);expect(next.matchdays.flatMap(d=>d.fixtures).every(f=>!f.result)).toBe(true);
  const simulated=simulateFixtures(next,next.matchdays.flatMap(d=>d.fixtures).map(f=>f.id),"pendingOnly",repo,()=>0.5).tournament;
  expect(simulated.matchdays.flatMap(d=>d.fixtures).every(f=>!!f.result)).toBe(true);expect(simulated.teams.map(team=>team.groupName)).toEqual(next.teams.map(team=>team.groupName));
});
it("does not accept forged generation metadata or an unlinked configuration",async()=>{const s=generatorScenario(),p=await proposal(s),r=reviewGeneratedLocalGroups(p,s.repository,null);expect(isStageDrawRecord({...r.record,generation:{method:"unknown",seed:"x"}})).toBe(false);expect(isStageDrawRecord({...r.record,configurationRevision:undefined})).toBe(false);expect(()=>reviewStageDraw({...s.input,mode:"generated",groups:p.groups,generation:{method:"constraint-groups-v1",seed:"x"}},s.repository)).toThrow(/revisión/);});
it("supports cancellation without writing, and yields work in bounded batches",async()=>{const s=generatorScenario(64,8),controller=new AbortController(),before=JSON.stringify(s.state);let batches=0;const r=await generateLocalGroups(s.input,s.repository,{...deterministic,signal:controller.signal,cooperate:async()=>{batches++;controller.abort();}});expect(batches).toBe(1);expect(r.state).toBe("No determinado");expect(JSON.stringify(s.state)).toBe(before);});
it("rejects a library change during asynchronous generation",async()=>{const s=generatorScenario(64,8);const r=await generateLocalGroups(s.input,s.repository,{...deterministic,cooperate:async()=>{s.state.tournaments=[{...s.t,name:"Changed during search"}];}});expect(r.state).toBe("Configuración inválida");expect(r.reasons.join()).toMatch(/cambió/);expect(s.state.activity).toHaveLength(1);});
it("bounds large instances as undetermined without claiming impossibility",async()=>{const s=generatorScenario(128,16),r=await generateLocalGroups(s.input,s.repository,deterministic);expect(r.state).toBe("No determinado");expect(r.stats.nodes).toBe(0);});
it.each([[8,2],[32,8],[64,8],[96,16]])("terminates controlled performance fixture %i participants / %i groups",async(n,g)=>{const s=generatorScenario(n,g),r=await generateLocalGroups(s.input,s.repository,{...deterministic,maxNodes:10_000,maxChecks:500_000});expect(r.state).toBe("Viable");expect(r.stats.nodes).toBeLessThanOrEqual(n+1);expect(r.stats.checks).toBeLessThanOrEqual(500_000);});
it("measures clock exhaustion without a fragile real-time assertion",async()=>{const s=generatorScenario(32,4);let clock=0;const r=await generateLocalGroups(s.input,s.repository,{now:()=>clock++,maxTimeMs:4});expect(r.state).toBe("No determinado");expect(r.reasons.join()).toMatch(/tiempo/);});
it("rejects empty seeds and invalid search budgets",async()=>{const s=generatorScenario();expect((await generateLocalGroups({...s.input,seed:""},s.repository,deterministic)).state).toBe("Configuración inválida");expect((await generateLocalGroups(s.input,s.repository,{maxNodes:-1})).state).toBe("Configuración inválida");});
it("does not infer missing formats or enable continental formats and knockout stages",async()=>{
  const s=generatorScenario();s.state.tournaments=[{...s.t,format:undefined}];let r=await generateLocalGroups(s.input,s.repository,deterministic);expect(r.reasons.join()).toMatch(/formato y el tipo/);expect(r.stats.nodes).toBe(0);
  s.state.tournaments=[{...s.t,competitionId:"conmebol-libertadores"}];r=await generateLocalGroups(s.input,s.repository,deterministic);expect(r.reasons.join()).toMatch(/servicio específico/);expect(r.stats.nodes).toBe(0);
  s.state.tournaments=[s.t];r=await generateLocalGroups({...s.input,stage:"Final"},s.repository,deterministic);expect(r.reasons.join()).toMatch(/solo admite grupos/);expect(r.stats.nodes).toBe(0);
});

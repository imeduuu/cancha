import { describe,it,expect } from "vitest";
import type { Tournament } from "../../domain/entities/tournament";
import type { ActivityEvent } from "../../domain/entities/activity-event";
import type { TournamentRepository } from "../ports/tournament-repository";
import { continentalLeague } from "../../test-utils/continental-qualification-fixtures";
import { nationalContinentalProjection,continentalProjection,continentalPlanState,entryKey,continentalRosterDifferences } from "../services/continental-projection";
import { reviewContinentalEdition,confirmContinentalEdition,type ContinentalPreparationInput } from "./prepare-continental-edition";
import { createTournamentBackup,parseTournamentBackup,createTournamentArchive,parseTournamentArchive,cloneTournamentWithNewIds } from "../services/tournament-archive";
import { importTournamentArchive } from "./import-tournament-archive";
const league=continentalLeague();
const event: ActivityEvent={id:"sim",occurredAt:league.createdAt,action:"matches-simulated",tournamentId:league.id,tournamentName:league.name,summary:"Simulación sintética"};
function repository(initial: Tournament[]=[league]) {
 const tournaments=[...initial],activity:ActivityEvent[]=[];
 const repo: TournamentRepository={findAll:()=>tournaments,findActivity:()=>activity,save(t){const i=tournaments.findIndex(x=>x.id===t.id);if(i>=0)tournaments[i]=t;else tournaments.push(t);},
 saveWithActivity(t,e){repo.save(t);activity.push(e);},recordActivity(e){activity.push(e);}};
 return {repo,tournaments,activity};
}
const input=(source=league):ContinentalPreparationInput=>({cup:"libertadores",edition:2027,qualifyingSeason:2026,sourceIds:[source.id],
 selectedKeys:continentalProjection([source.id],2026,"libertadores",[source],[]).entries.map(entryKey),sourceUrl:"https://www.conmebol.com/documento-sintetico",note:"Relación 2026 a 2027 documentada para la prueba; escenario local."});
function create(initial=[league]) {const memory=repository(initial);const review=reviewContinentalEdition(input(initial[0]),memory.repo);const cup=confirmContinentalEdition(review,memory.repo,true);return {...memory,cup};}
describe("international edition linkage",()=>{
 it("reuses verified positional allocation and preserves its origin",()=>{
  const p=nationalContinentalProjection(league,[league],[]);expect(p.entries[0]).toMatchObject({teamName:"Alfa",status:"confirmed",sourceTournamentId:league.id,originTournamentId:league.id,sourceSeason:2026,scenario:"provider"});
 });
 it("keeps provisional and pending regulations separate",()=>{
  for(const status of ["provisional","pending"] as const){const t={...league,competitionRules:{...league.competitionRules!,internationalQualification:{...league.competitionRules!.internationalQualification!,verification:status}}};
   expect(nationalContinentalProjection(t,[t],[]).entries[0].status).toBe(status);}
 });
 it("does not confirm base positions or conditional future qualifications",()=>{
  const base={...league,competitionRules:undefined,placementRules:{libertadoresPlaces:{from:1,to:1}}};expect(nationalContinentalProjection(base,[base],[]).entries[0].status).toBe("provisional");
  const t={...league,competitionRules:{...league.competitionRules!,conditionalPlacements:[{status:"pending" as const,description:"Falta un campeón"}]}};expect(nationalContinentalProjection(t,[t],[]).entries.every(e=>e.status==="pending")).toBe(true);
 });
 it("does not use alphabetical fallback to assign an unresolved base place",()=>{
  const tied={...league,competitionRules:undefined,placementRules:{libertadoresPlaces:{from:1,to:1}},matchdays:league.matchdays.map(d=>({...d,fixtures:d.fixtures.map(f=>({...f,result:{homeGoals:0,awayGoals:0}}))}))};
  const projection=nationalContinentalProjection(tied,[tied],[]);expect(projection.entries).toHaveLength(0);expect(projection.reasons.some(r=>r.includes("empate irresuelto"))).toBe(true);
 });
 it("retains simulation provenance from league or the originating cup",()=>{
  expect(nationalContinentalProjection(league,[league],[event]).entries[0].scenario).toBe("local");
 });
 it("identifies an archived import copied as a local scenario from its recorded decision",()=>{
  const copied={...event,action:"tournament-imported" as const,after:{decision:"copy",sourceTournamentId:"original"}};
  expect(nationalContinentalProjection(league,[league],[copied]).entries[0].scenario).toBe("local");
 });
 it("does not infer eligibility for unknown destinations or combine zones",()=>{
  const grouped={...league,teams:league.teams.map((t,i)=>({...t,groupName:String(i%2)}))};expect(nationalContinentalProjection(grouped,[grouped],[]).entries).toHaveLength(0);
  const unknown={...league,competitionRules:{...league.competitionRules!,internationalQualification:{verification:"verified" as const,slots:[{destination:"otra copa parecida",position:1}]}}};expect(nationalContinentalProjection(unknown,[unknown],[]).entries).toHaveLength(0);
 });
 it("reuses cup-champion reallocation and records the exact cup ID",()=>{
  const cup:Tournament={...league,id:"domestic-cup",name:"Copa nacional",competitionId:"domestic",competitionType:"cup",knockoutStages:[{name:"Final",legs:1}],matchdays:[{number:1,leg:1,phaseName:"Final",fixtures:[{id:"final",homeTeamId:league.teams[0].id,awayTeamId:league.teams[1].id,result:{homeGoals:1,awayGoals:0}}]}]};
  const t={...league,competitionRules:{...league.competitionRules!,internationalQualification:{verification:"verified" as const,slots:[{destination:"libertadores",position:1}],cupChampions:[{sourceTournamentId:cup.id,destination:"libertadores"}],reallocation:"next-eligible-position" as const}}};
  const result=nationalContinentalProjection(t,[t,cup],[{...event,tournamentId:cup.id}]);
  expect(result.entries.map(e=>e.teamName)).toEqual(["Alfa","Beta"]);expect(result.entries[0]).toMatchObject({originTournamentId:cup.id,scenario:"local"});
 });
 it("keeps missing cup dependencies pending and refuses to incorporate them",()=>{
  const t={...league,competitionRules:{...league.competitionRules!,internationalQualification:{...league.competitionRules!.internationalQualification!,cupChampions:[{sourceTournamentId:"missing-cup",destination:"conmebol-libertadores"}]}}};
  const memory=repository([t]);expect(()=>reviewContinentalEdition(input(t),memory.repo)).toThrow("pendientes");
 });
 it("detects conflicting club identities across selected sources without merging",()=>{
  const other=continentalLeague("another-2026");const result=continentalProjection([league.id,other.id],2026,"libertadores",[league,other],[]);expect(result.conflicts).toHaveLength(4);
  const memory=repository([league,other]);expect(()=>reviewContinentalEdition({...input(),sourceIds:[league.id,other.id],selectedKeys:result.entries.map(entryKey)},memory.repo)).toThrow("conflictos");
 });
 it.each([2025,2027])("rejects an incompatible source season %i",season=>{
  const memory=repository();expect(()=>reviewContinentalEdition({...input(),qualifyingSeason:season},memory.repo)).toThrow("temporada");
 });
 it("requires documentation, explicit confirmation and an unchanged reviewed selection",()=>{
  const memory=repository();expect(()=>reviewContinentalEdition({...input(),note:""},memory.repo)).toThrow("referencia");
  const review=reviewContinentalEdition(input(),memory.repo);expect(()=>confirmContinentalEdition(review,memory.repo,false)).toThrow("confirma");
  expect(memory.tournaments).toHaveLength(1);(review.input.selectedKeys as string[]).push("forged");expect(()=>confirmContinentalEdition(review,memory.repo,true)).toThrow("modificar");
 });
 it("checks sources again immediately before confirming",()=>{
  const memory=repository();const review=reviewContinentalEdition(input(),memory.repo);memory.repo.save({...league,importCoverage:"partial"});expect(()=>confirmContinentalEdition(review,memory.repo,true)).toThrow("cambiaron");expect(memory.tournaments).toHaveLength(1);
 });
 it("creates only an explicitly selected local roster, with pending annual rules and no fixture",()=>{
  const result=create();expect(result.cup.teams.map(t=>t.name)).toEqual(["Alfa"]);expect(result.cup.matchdays).toEqual([]);expect(result.cup.knockoutStages).toBeUndefined();expect(result.cup.competitionRules?.verification.placements).toBe("pending");
  expect(result.activity[0].action).toBe("season-created");expect(result.cup.continentalPlans![0].mode).toBe("incorporated");
 });
 it("recalculates national projections and marks saved provenance stale without changing the cup",()=>{
  const result=create(),before=JSON.stringify(result.cup);const plan=result.cup.continentalPlans![0];expect(continentalPlanState(plan,result.repo.findAll(),result.activity)).toContain("vigentes");
  result.repo.save({...league,matchdays:league.matchdays.map(d=>({...d,fixtures:d.fixtures.map(f=>({...f,result:{homeGoals:0,awayGoals:0}}))}))});
  expect(continentalPlanState(plan,result.repo.findAll(),result.activity)).toContain("Desactualizada");expect(JSON.stringify(result.repo.findAll().find(t=>t.id===result.cup.id))).toBe(before);
 });
 it("reviews an existing continental cup without replacing participants, results or squads",()=>{
  const existing:Tournament={...league,id:"published",competitionId:"conmebol-libertadores",season:2027,competitionRules:undefined,name:"Copa publicada",players:[],playerRegistrations:[]};
  const memory=repository([league,existing]);const review=reviewContinentalEdition({...input(),targetId:existing.id},memory.repo);const saved=confirmContinentalEdition(review,memory.repo,true);
  expect({...saved,continentalPlans:undefined}).toEqual({...existing,continentalPlans:undefined});expect(continentalRosterDifferences(review.entries,existing).added).toContain("Beta");expect(saved.continentalPlans![0].mode).toBe("review");
 });
 it("rejects accidental duplicate editions and wrong destination editions",()=>{
  const result=create();expect(()=>reviewContinentalEdition(input(),result.repo)).toThrow("Ya existe");expect(()=>reviewContinentalEdition({...input(),targetId:result.cup.id,edition:2028},result.repo)).toThrow("destino");
 });
 it("round-trips optional v7 records without making dependencies stale",()=>{
  const result=create();const restored=parseTournamentBackup(JSON.stringify(createTournamentBackup(result.repo.findAll())));const cup=restored.find(t=>t.id===result.cup.id)!;
  expect(cup.continentalPlans).toEqual(result.cup.continentalPlans);expect(continentalPlanState(cup.continentalPlans![0],restored,[])).toContain("vigentes");
  const legacy=parseTournamentBackup(JSON.stringify({...createTournamentBackup([league]),version:1}));expect(legacy[0].continentalPlans).toBeUndefined();
 });
 it.each(["snapshot","source","entry","edition","duplicate","pending","target"])("rejects malformed optional provenance: %s",field=>{
  const {cup}=create();const archive=JSON.parse(JSON.stringify(createTournamentArchive(cup)));const p=archive.tournament.continentalPlans[0];
  if(field==="snapshot")p.dependencies[0].snapshot="broken";if(field==="source")p.sourceUrl="http://untrusted";if(field==="entry")p.entries[0].originTournamentId="missing";if(field==="edition")p.edition=2028;
  if(field==="duplicate")p.entries.push({...p.entries[0],sourceTeamId:"another",targetTeamId:"another"});
  if(field==="pending")p.entries[0].status="pending";if(field==="target")delete p.entries[0].targetTeamId;
  expect(()=>parseTournamentArchive(JSON.stringify(archive))).toThrow("continental");
 });
 it("remaps copied roster references and keeps historical source IDs inactive for review",()=>{
  const {cup}=create();const copied=cloneTournamentWithNewIds(cup);const plan=copied.continentalPlans![0];expect(plan.requiresReview).toBe(true);expect(plan.entries[0].sourceTournamentId).toBe(league.id);expect(plan.entries[0].targetTeamId).toBe(copied.teams[0].id);expect(()=>createTournamentArchive(copied)).not.toThrow();
 });
 it("preserves continental history when updating an older archive",()=>{
  const result=create();const {continentalPlans:_plans,...old}=result.cup;const updated=importTournamentArchive(old,"update",result.repo)!;expect(updated.continentalPlans).toEqual(result.cup.continentalPlans);
 });
});

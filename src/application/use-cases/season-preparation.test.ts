import { canStartNewSeason } from "../../domain/services/tournament-history";
import { calculateTournamentStatistics } from "../../domain/services/tournament-statistics";
import { generateRoundRobinSchedule } from "../../domain/services/round-robin-scheduler";
import { LocalStorageTournamentRepository } from "../../infrastructure/persistence/local-storage-tournament-repository";
import { describe,it,expect,vi } from "vitest";
import type { Tournament } from "../../domain/entities/tournament";
import type { OfficialLeagueSeason } from "../ports/official-league-source";
import { reviewPlannedSeasonCalendar,confirmPlannedSeasonCalendar } from "./import-planned-season-calendar";
import { updateSeasonRules } from "./update-season-rules";
import { createTournamentArchive,parseTournamentArchive,createTournamentBackup,parseTournamentBackup } from "../services/tournament-archive";
import { getDivisionTransition } from "../../domain/services/division-season-transition";
import { memoryRepository } from "../../test-utils/official-resolution-fixtures";

function planned(): Tournament { return {id:"planning-uuid",competitionId:"brasileirao-serie-b",season:2027,name:"Série B 2027",
 teams:[{id:"a",name:"Club A"},{id:"b",name:"Club B"}],legs:1,tieBreakers:[],matchdays:[],createdAt:"2026-10-16T00:00:00Z",format:"staged",
 competitionRules:{season:2027,verification:{standings:"pending",placements:"pending"}},
 seasonPreparation:{schemaVersion:1,sourceTournamentIds:["upper-2026","lower-2026"],plannedParticipants:["Club A","Club B"],calendarReviews:[]} }; }
function published(second="Club B"): OfficialLeagueSeason { return {id:"brasileirao-serie-b-2027",name:"Série B 2027",season:2027,
 sourceUrl:"https://www.espn.com/soccer/fixtures/_/league/bra.2/season/2027",teams:[{name:"Club A"},{name:second}],format:"staged",
 matchdays:[{number:1,phaseName:"published-phase",matches:[{id:"published-1",homeTeamName:"Club A",awayTeamName:second,schedule:{date:"2027-04-01"}}]}]}; }
const rules = { season:2027,standings:"verified" as const,placements:"pending" as const,points:{win:3,draw:1,loss:0},tieBreakers:["wins" as const],
 sourceUrls:["https://www.cbf.com.br/regulamento-2027"],standingsNote:"Documento sintético: art. 1 para pruebas",placementsNote:"Pendiente" };
describe("future season preparation",() => {
 it("reviews without writing, attaches published fixtures and preserves the planned roster and pending rules",async()=>{
   const t=planned(),repo=memoryRepository(t),before=JSON.stringify(t);const review=await reviewPlannedSeasonCalendar(t,published());
   expect(repo.save).not.toHaveBeenCalled();expect(review.missing).toEqual([]);
   const next=confirmPlannedSeasonCalendar(t,review,repo);
   expect(next.id).toBe(t.id);expect(next.teams.map(t=>t.id)).toEqual(["a","b"]);expect(next.matchdays[0].fixtures[0].schedule?.date).toBe("2027-04-01");
   expect(next.competitionRules?.verification.standings).toBe("pending");expect(JSON.stringify(t)).toBe(before);
 });
 it("requires explicit justification of roster differences and retains original planning",async()=>{
   const t=planned(),repo=memoryRepository(t),review=await reviewPlannedSeasonCalendar(t,published("Club C"));
   expect(review.missing).toEqual(["Club B"]);expect(review.added).toEqual(["Club C"]);
   expect(()=>confirmPlannedSeasonCalendar(t,review,repo)).toThrow("justificación");expect(repo.save).not.toHaveBeenCalled();
   const next=confirmPlannedSeasonCalendar(t,review,repo,"Acta publicada: corrección de participantes, referencia de prueba");
   expect(next.seasonPreparation?.plannedParticipants).toEqual(["Club A","Club B"]);
   expect(next.seasonPreparation?.calendarReviews[0].added).toEqual(["Club C"]);
 });
 it("rejects wrong competition, year, missing roster and modified previews",async()=>{
   const t=planned(),repo=memoryRepository(t);
   await expect(reviewPlannedSeasonCalendar(t,{...published(),season:2028})).rejects.toThrow("año");
   await expect(reviewPlannedSeasonCalendar(t,{...published(),id:"arg-primera-nacional-2027"})).rejects.toThrow("competición");
   await expect(reviewPlannedSeasonCalendar(t,{...published(),teams:undefined})).rejects.toThrow("nómina");
   const review=await reviewPlannedSeasonCalendar(t,published());
   expect(()=>confirmPlannedSeasonCalendar(t,{...review,added:[]},repo)).toThrow("modificada");
 });
 it("rejects stale previews",async()=>{
   const t=planned(),repo=memoryRepository(t),review=await reviewPlannedSeasonCalendar(t,published());repo.save({...t,name:"Cambio"});
   expect(()=>confirmPlannedSeasonCalendar(t,review,repo)).toThrow("cambió");
 });
 it("preserves manual results and refuses omitted existing matches",async()=>{
   const t=planned(),repo=memoryRepository(t);const initial=confirmPlannedSeasonCalendar(t,await reviewPlannedSeasonCalendar(t,published()),repo);
   const edited={...initial,matchdays:initial.matchdays.map(d=>({...d,fixtures:d.fixtures.map(f=>({...f,result:{homeGoals:5,awayGoals:1},operationalState:{status:"finished" as const,updatedAt:"2027-04-01T00:00:00Z"}}))}))};
   repo.save(edited);const data=published();const next=confirmPlannedSeasonCalendar(edited,await reviewPlannedSeasonCalendar(edited,data),repo);
   expect(next.matchdays[0].fixtures[0].result).toEqual({homeGoals:5,awayGoals:1});
   const missing={...data,matchdays:[{number:1,matches:[{id:"other",homeTeamName:"Club A",awayTeamName:"Club B"}]}]};
   const review=await reviewPlannedSeasonCalendar(next,missing);expect(()=>confirmPlannedSeasonCalendar(next,review,repo)).toThrow("omitió");
 });
 it("rejects participant reassignment of an existing fixture even when its published ID is unchanged",async()=>{
   const t=planned(),repo=memoryRepository(t),next=confirmPlannedSeasonCalendar(t,await reviewPlannedSeasonCalendar(t,published()),repo);
   const review=await reviewPlannedSeasonCalendar(next,published("Club C"));
   expect(()=>confirmPlannedSeasonCalendar(next,review,repo,"Acta: cambio de participantes")).toThrow("participantes de un partido");
   expect(repo.findAll()[0]).toBe(next);
 });
 it("does not confirm a champion or allow a generic season transition with pending annual rules",()=>{
   const t=planned();const complete={...t,format:"round-robin" as const,matchdays:generateRoundRobinSchedule(t.teams,1).map(day=>({...day,fixtures:day.fixtures.map(f=>({...f,result:{homeGoals:2,awayGoals:0}}))}))};
   expect(calculateTournamentStatistics(complete).championTeamId).toBeUndefined();
   expect(canStartNewSeason(complete)).toBe(false);
 });
 it("stores annual documented rules without enabling unsupported future transitions or changing historical seasons",()=>{
   const t=planned(),repo=memoryRepository(t);const next=updateSeasonRules(t,rules,repo);
   expect(next.competitionRules?.verification.standings).toBe("verified");expect(next.tieBreakers).toEqual(["wins"]);
   expect(t.competitionRules?.verification.standings).toBe("pending");
   expect(getDivisionTransition({...next,competitionId:"brasileirao-serie-a"},next,[]).pending.length).toBeGreaterThan(0);
   expect(()=>updateSeasonRules(next,{...rules,season:2026},repo)).toThrow("2026");
   expect(()=>updateSeasonRules(next,{...rules,sourceUrls:["https://espn.com/rules"]},repo)).toThrow("HTTPS");
 });
 it("persists the planning provenance, calendar and annual rules with activity",async()=>{
   const values = new Map<string,string>();
   vi.stubGlobal("localStorage",{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)});
   try { const repository=new LocalStorageTournamentRepository(false),t=planned();repository.save(t);
     const next=confirmPlannedSeasonCalendar(t,await reviewPlannedSeasonCalendar(t,published()),repository);
     const documented=updateSeasonRules(next,rules,repository);
     const restored=new LocalStorageTournamentRepository(false);
     expect(restored.findAll()[0].seasonPreparation).toEqual(documented.seasonPreparation);
     expect(restored.findAll()[0].competitionRules).toEqual(documented.competitionRules);
     expect(restored.findActivity().map(e=>e.action)).toContain("tournament-imported");
     expect(restored.findActivity().map(e=>e.action)).toContain("regulations-updated");
   } finally { vi.unstubAllGlobals(); }
 });
 it("round-trips optional preparation and annual rules through JSON v7 and rejects malformed metadata",async()=>{
   const t=planned(),repo=memoryRepository(t),next=confirmPlannedSeasonCalendar(t,await reviewPlannedSeasonCalendar(t,published()),repo);
   const archive=createTournamentArchive(next);expect(archive.version).toBe(7);
   expect(parseTournamentArchive(JSON.stringify(archive)).seasonPreparation).toEqual(next.seasonPreparation);
   const backup=createTournamentBackup([next]);expect(parseTournamentBackup(JSON.stringify(backup))[0].seasonPreparation).toEqual(next.seasonPreparation);
   expect(()=>parseTournamentArchive(JSON.stringify({...archive,tournament:{...next,seasonPreparation:{schemaVersion:9}}}))).toThrow();
   const old={...t};delete (old as {seasonPreparation?:unknown}).seasonPreparation;expect(parseTournamentArchive(JSON.stringify(createTournamentArchive(old))).seasonPreparation).toBeUndefined();
 });
});

it("preserves a local suspension without a score when a future provider publishes a result",async()=>{
 const t=planned(),repository=memoryRepository(t);
 const initial=confirmPlannedSeasonCalendar(t,await reviewPlannedSeasonCalendar(t,published()),repository);
 const suspended={...initial,matchdays:initial.matchdays.map(day=>({...day,fixtures:day.fixtures.map(f=>({...f,operationalState:{status:"suspended" as const,updatedAt:"2027-04-01T00:00:00Z"}}))}))};
 repository.save(suspended);
 const data=published();const completed={...data,matchdays:data.matchdays.map(day=>({...day,matches:day.matches.map(m=>({...m,homeGoals:5,awayGoals:0,operationalStatus:"finished" as const}))}))};
 const next=confirmPlannedSeasonCalendar(suspended,await reviewPlannedSeasonCalendar(suspended,completed),repository);
 expect(next.matchdays[0].fixtures[0].operationalState?.status).toBe("suspended");
 expect(calculateTournamentStatistics(next).played).toBe(0);
});

it("rejects future criteria that the generic standings engine would silently ignore",()=>{
 const t=planned();expect(()=>updateSeasonRules(t,{...rules,tieBreakers:["redCards"]},memoryRepository(t))).toThrow(/criterios|criterio/i);
});

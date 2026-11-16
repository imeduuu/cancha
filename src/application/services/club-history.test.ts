import {describe,it,expect} from "vitest";
import type {Tournament} from "../../domain/entities/tournament";
import type {ActivityEvent} from "../../domain/entities/activity-event";
import type {TournamentRepository} from "../ports/tournament-repository";
import {continentalLeague} from "../../test-utils/continental-qualification-fixtures";
import {nationalCup,brazilUpper} from "../../test-utils/journey-competition-fixtures";
import {divisionFixture} from "../../domain/services/second-division-test-fixtures";
import {buildClubProfiles,projectClubHistory,clubHistoryScopes,accumulateClubScopes,similarlyNamedProfiles} from "./club-history";
import {reviewContinentalEdition,confirmContinentalEdition} from "../use-cases/prepare-continental-edition";
import {continentalProjection,entryKey} from "./continental-projection";
import {createTournamentBackup,parseTournamentBackup} from "./tournament-archive";
const source=continentalLeague();
const next:Tournament={...source,id:"next",name:"Liga de prueba 2027",season:2027,competitionRules:{...source.competitionRules!,season:2027}};
const simulation:ActivityEvent={id:"sim",action:"matches-simulated",tournamentId:source.id,tournamentName:source.name,summary:"Simulación de prueba",occurredAt:source.createdAt};
function profile(ts:readonly Tournament[],teamId=source.teams[0].id){return buildClubProfiles(ts).find(p=>p.teamIds.includes(teamId))!;}
function link(target?:Tournament){
 const tournaments=[source,...(target?[target]:[])];const activity:ActivityEvent[]=[];
 const repo:TournamentRepository={findAll:()=>tournaments,findActivity:()=>activity,save(t){const index=tournaments.findIndex(s=>s.id===t.id);if(index<0)tournaments.push(t);else tournaments[index]=t;},saveWithActivity(t,e){repo.save(t);activity.push(e);}};
 const review=reviewContinentalEdition({cup:"libertadores",edition:target?.season ?? 2027,qualifyingSeason:2026,sourceIds:[source.id],selectedKeys:continentalProjection([source.id],2026,"libertadores",[source],[]).entries.map(entryKey),sourceUrl:"https://www.conmebol.com/documento-prueba",note:"Vinculación sintética para pruebas",...(target?{targetId:target.id}:{})},repo);
 const cup=confirmContinentalEdition(review,repo,true);return {tournaments,activity,cup};
}
describe("club history read projection",()=>{
 it("orders seasons chronologically and reuses stable IDs without mutating records",()=>{
  const data=[next,source],before=JSON.stringify(data);const history=projectClubHistory(profile(data),data,[]);
  expect(history.map(h=>h.tournament.season)).toEqual([2026,2027]);expect(JSON.stringify(data)).toBe(before);
  expect(history[0].scopes[0].metrics).toMatchObject({played:3,wins:3,points:9});expect(history[0].scopes[0].positionStatus).toContain("Final");
 });
 it("keeps identical names with different IDs separate",()=>{
  const another=continentalLeague("another");const profiles=buildClubProfiles([source,another]);expect(profiles).toHaveLength(8);
  expect(similarlyNamedProfiles(profile([source,another]),profiles)).toHaveLength(1);
 });
 it("links only explicitly equal historical identity tokens",()=>{
  const a={...source,teams:source.teams.map((t,i)=>i? t:{...t,averageIdentity:"registered-club"})};
  const b={...next,teams:next.teams.map((t,i)=>({...t,id:`new-${t.id}`,...(!i?{name:"Nuevo nombre",averageIdentity:"registered-club"}:{})}))};
  const club=profile([a,b]);expect(club.occurrences).toHaveLength(2);expect(club.names).toContain("Nuevo nombre");expect(club.teamIds).toHaveLength(2);
 });
 it("does not merge ambiguous historical tokens within one competition roster",()=>{
  const t={...source,teams:source.teams.map(team=>({...team,averageIdentity:"ambiguous"}))};const profiles=buildClubProfiles([t]);
  expect(profiles).toHaveLength(4);expect(profiles.every(p=>p.warning?.includes("ambigua"))).toBe(true);
 });
 it("keeps contradictory historical identities separate despite a shared ID",()=>{
  const a={...source,teams:source.teams.map(t=>({...t,averageIdentity:"one"+t.id}))};const b={...next,teams:next.teams.map(t=>({...t,averageIdentity:"two"+t.id}))};expect(buildClubProfiles([a,b])).toHaveLength(8);
 });
 it("links a continental planning participant only through its recorded source ID",()=>{
  const data=link();const club=profile(data.tournaments);expect(club.occurrences).toHaveLength(2);
  const history=projectClubHistory(club,data.tournaments,data.activity);expect(history[0].qualifications[0].status).toBe("confirmed");expect(history[0].documents[0].plan.edition).toBe(2027);
  expect(history[1].category).toBe("Continental");expect(history[1].scopes).toEqual([]);
 });
 it("does not use a copied or inactive continental link as identity evidence",()=>{
  const data=link();const copied={...data.cup,continentalPlans:data.cup.continentalPlans!.map(p=>({...p,requiresReview:true}))};expect(profile([source,copied]).occurrences).toHaveLength(1);
 });
 it("keeps nominal participants in imported continental cups separate",()=>{
  const cup={...next,id:"published",competitionId:"conmebol-sudamericana",teams:next.teams.map(t=>({...t,id:`published-${t.id}`}))};
  expect(profile([source,cup]).occurrences).toHaveLength(1);
 });
 it("shows partial seasons, pending ties and no invented final position",()=>{
  const t={...source,importCoverage:"partial" as const,matchdays:source.matchdays.map(d=>({...d,fixtures:d.fixtures.map(f=>({...f,result:undefined}))}))};const row=clubHistoryScopes(t,t.teams[0],[])[0];
  expect(row.metrics.played).toBe(0);expect(row.coverage).toContain("Parcial");expect(row.position).toBeUndefined();expect(row.positionStatus).toContain("empate");
 });
 it("does not classify a documented review alone as simulated match data",()=>{
  const target={...nationalCup("argentina"),id:"published-cup",competitionId:"conmebol-libertadores",sourceUrl:"https://www.espn.com/"};const data=link(target);
  const p=profile(data.tournaments,target.teams[0].id);expect(projectClubHistory(p,data.tournaments,data.activity)[0].scenario).toBe("provider");
 });
 it("separates simulated from provider statistics in accumulations",()=>{
  const data=[source,next],history=projectClubHistory(profile(data),data,[simulation]);expect(history[0].scenario).toBe("local");expect(accumulateClubScopes(history.flatMap(h=>h.scopes)).error).toContain("escenarios");
 });
 it("sums only explicitly selected compatible seasons",()=>{
  const history=projectClubHistory(profile([source,next]),[source,next],[]);expect(accumulateClubScopes([]).totals).toBeUndefined();
  expect(accumulateClubScopes(history.flatMap(h=>h.scopes)).totals).toMatchObject({played:6,wins:6,points:18});
 });
 it("rejects duplicate seasons, separate competitions and copies",()=>{
  const duplicate={...source,id:"duplicate"};const copied={...next,competitionId:"independent-copy"};
  expect(accumulateClubScopes([clubHistoryScopes(source,source.teams[0],[])[0],clubHistoryScopes(duplicate,duplicate.teams[0],[])[0]]).error).toContain("misma temporada");
  expect(accumulateClubScopes([clubHistoryScopes(source,source.teams[0],[])[0],clubHistoryScopes(copied,copied.teams[0],[])[0]]).error).toContain("competiciones");
 });
 it("does not mix distinct configured tie-breakers or points systems",()=>{
  const first=clubHistoryScopes(source,source.teams[0],[])[0];
  const changed={...next,competitionRules:{...next.competitionRules!,tieBreakers:["wins" as const]},pointsSystem:{win:5,draw:1,loss:0}};
  expect(accumulateClubScopes([first,clubHistoryScopes(changed,changed.teams[0],[])[0]]).error).toContain("criterios");
 });
 it("keeps knockout legs and regulation-only metrics separate and omits league points",()=>{
  const cup=nationalCup("brasil");const scopes=clubHistoryScopes(cup,cup.teams[0],[]);expect(scopes).toHaveLength(2);expect(scopes.every(s=>s.kind==="knockout" && !s.pointsApplicable && s.position===undefined)).toBe(true);
  expect(accumulateClubScopes(scopes).error).toContain("fases");
 });
 it("uses full original matchdays to validate return-leg results",()=>{
  const base=nationalCup("brasil");const cup={...base,matchdays:base.matchdays.map((d,i)=>({...d,fixtures:d.fixtures.map(f=>({...f,result:i?{homeGoals:2,awayGoals:0,penalties:{homeGoals:4,awayGoals:3}}:{homeGoals:2,awayGoals:0}}))}))};
  const scopes=clubHistoryScopes(cup,cup.teams[0],[]);expect(scopes.reduce((sum,s)=>sum+s.metrics.played,0)).toBe(2);
 });
 it("reuses lower-division promotions and relegations without guessing a league rank movement",()=>{
  const t=divisionFixture("brasil");const winner=t.teams[0].id;const history=projectClubHistory(profile([t],winner),[t],[]);
  expect(history[0].movements).toContain("Ascenso determinado por el cálculo actual");
  const relegated=t.teams[19].id;expect(projectClubHistory(profile([t],relegated),[t],[])[0].movements.some(m=>m.startsWith("Descenso"))).toBe(true);
 });
 it("updates derived data when results change and marks documentary qualifications stale",()=>{
  const data=link(),old=projectClubHistory(profile(data.tournaments),data.tournaments,data.activity)[0];
  const modified={...source,matchdays:source.matchdays.map(d=>({...d,fixtures:d.fixtures.map(f=>({...f,result:{homeGoals:0,awayGoals:0}}))}))};
  const updated=data.tournaments.map(t=>t.id===source.id?modified:t);const row=projectClubHistory(profile(updated),updated,data.activity)[0];
  expect(row.scopes[0].metrics.points).not.toBe(old.scopes[0].metrics.points);expect(row.documents[0].state).toContain("Desactualizada");expect(data.cup.teams).toHaveLength(1);
 });
 it.each(["provisional","pending"] as const)("preserves an international qualification status of %s",status=>{
  const t={...source,competitionRules:{...source.competitionRules!,internationalQualification:{...source.competitionRules!.internationalQualification!,verification:status}}};
  expect(projectClubHistory(profile([t]),[t],[])[0].qualifications[0].status).toBe(status);
 });
 it("keeps recorded promotions separate from the current calculation",()=>{
  const low=divisionFixture("brasil"),upper=brazilUpper();
  const future:Tournament={...low,id:"prepared",season:2027,teams:[],matchdays:[],competitionRules:{season:2027,verification:{standings:"pending",placements:"pending"}},seasonPreparation:{schemaVersion:1,sourceTournamentIds:[upper.id,low.id],plannedParticipants:low.teams.map(t=>t.name),calendarReviews:[]}};
  const event:ActivityEvent={...simulation,id:"transition",tournamentId:future.id,action:"season-created",before:{upperId:upper.id,lowerId:low.id},after:{tournamentIds:[future.id],promoted:[low.teams[0].id],upperRelegated:[],lowerRelegated:[]}};
  const data=[low,upper,future];expect(projectClubHistory(profile(data,low.teams[0].id),data,[event])[0].movements.some(m=>m.includes("registrado al preparar 2027"))).toBe(true);
 });
 it("uses regulation-time totals without presenting an extra-time win as a regulation win",()=>{
  const original=nationalCup("argentina");const cup={...original,matchdays:original.matchdays.map(d=>({...d,fixtures:d.fixtures.map((f,i)=>i?f:{...f,knockoutResolution:"extra-time-then-penalties" as const,result:{homeGoals:1,awayGoals:1,extraTime:{homeGoals:2,awayGoals:0}}})}))};
  const scope=clubHistoryScopes(cup,cup.teams[0],[])[0];expect(scope.metrics).toMatchObject({goalsFor:1,goalsAgainst:1,draws:1,wins:0});expect(scope.pointsApplicable).toBe(false);
 });
 it("preserves pending international dependencies even without an assignable cup place",()=>{
  const t={...source,competitionRules:{...source.competitionRules!,internationalQualification:{...source.competitionRules!.internationalQualification!,cupChampions:[{sourceTournamentId:"missing-cup",destination:"conmebol-libertadores"}]}}};
  const row=projectClubHistory(profile([t]),[t],[])[0];expect(row.internationalPending.some(reason=>reason.includes("missing-cup"))).toBe(true);expect(row.qualifications[0].status).toBe("pending");
 });
 it("reads legacy backups without adding identities, seasons or history fields",()=>{
  const legacy={...source,competitionId:undefined,season:undefined,competitionRules:undefined};const data=parseTournamentBackup(JSON.stringify({...createTournamentBackup([legacy]),version:1}));
  const before=JSON.stringify(data),history=projectClubHistory(profile(data),data,[]);expect(history[0].tournament.season).toBeUndefined();expect(accumulateClubScopes(history[0].scopes).error).toContain("temporada explícita");expect(JSON.stringify(data)).toBe(before);
 });
});

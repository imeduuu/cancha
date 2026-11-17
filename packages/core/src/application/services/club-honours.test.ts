import {divisionFixture} from "../../domain/services/second-division-test-fixtures";
import {describe,it,expect} from "vitest";
import type {Tournament} from "../../domain/entities/tournament";
import {continentalLeague} from "../../test-utils/continental-qualification-fixtures";
import {buildClubProfiles} from "./club-history";
import {seasonHonours,seasonRecordRows,historicalRecords} from "./club-honours";
const league=()=>continentalLeague();
const next=(t:Tournament):Tournament=>({...t,id:"next",season:2027,competitionRules:{...t.competitionRules!,season:2027}});
const scope=(t:Tournament)=>seasonRecordRows(t)[0].scope.compatibility;
function cup():Tournament{
 const t=league(),ids=t.teams.map(t=>t.id);
 return {...t,competitionType:"cup",format:"staged",knockoutStages:[{name:"Semifinales",legs:1},{name:"Final",legs:1}],matchdays:[
  {number:1,leg:1,phaseName:"Semifinales",fixtures:[{id:"s1",homeTeamId:ids[0],awayTeamId:ids[1],result:{homeGoals:1,awayGoals:0}},{id:"s2",homeTeamId:ids[2],awayTeamId:ids[3],result:{homeGoals:1,awayGoals:0}}]},
  {number:2,leg:2,phaseName:"Final",fixtures:[{id:"f",homeTeamId:ids[0],awayTeamId:ids[2],knockoutResolution:"penalties",result:{homeGoals:0,awayGoals:0,penalties:{homeGoals:5,awayGoals:4}}}]}]};
}
describe("read-only honours and historical records",()=>{
 it("uses final league standings for champion, runner-up and highlighted places",()=>{
  const t=league(),h=seasonHonours(t);expect(h.complete).toBe(true);expect(h.awards).toContainEqual({teamId:t.teams[0].id,label:"Campeón"});expect(h.awards).toContainEqual({teamId:t.teams[1].id,label:"Subcampeón"});
 });
 it("does not award an incomplete league",()=>{
  const t=league();expect(seasonHonours({...t,matchdays:t.matchdays.slice(1)}).awards).toEqual([]);
 });
 it("keeps tied champions pending",()=>{
  const t=league();const drawn={...t,matchdays:t.matchdays.map(d=>({...d,fixtures:d.fixtures.map(f=>({...f,result:{homeGoals:0,awayGoals:0}}))}))};expect(seasonHonours(drawn).awards).toEqual([]);
 });
 it.each(["partial","unknown"] as const)("does not award with %s import coverage",coverage=>expect(seasonHonours({...league(),importCoverage:coverage}).complete).toBe(false));
 it("blocks provisional annual rules",()=>{
  const t=league();expect(seasonHonours({...t,competitionRules:{...t.competitionRules!,verification:{standings:"provisional",placements:"pending"}}}).awards).toEqual([]);
 });
 it("uses penalties and recorded final participants, not table second, for cups",()=>{
  const t=cup(),h=seasonHonours(t);expect(h.awards).toContainEqual({teamId:t.teams[0].id,label:"Campeón"});expect(h.awards).toContainEqual({teamId:t.teams[2].id,label:"Subcampeón"});expect(h.awards.filter(a=>a.label==="Finalista")).toHaveLength(2);expect(h.awards.filter(a=>a.label==="Semifinalista")).toHaveLength(4);
 });
 it("keeps Série B playoff completion separate from the regular table",()=>{
  const t=divisionFixture("brasil");expect(seasonHonours(t).awards).toEqual([]);expect(seasonHonours(t).reasons.join(" ")).toContain("incompleta");
 });
 it("does not award a cup with roster participants missing from all recorded matches",()=>{
  const t=cup();expect(seasonHonours({...t,teams:[...t.teams,{id:"missing",name:"Sin recorrido"}]}).awards).toEqual([]);
 });
 it("rejects a final populated with a semifinal loser",()=>{
  const t=cup();const bad={...t,matchdays:t.matchdays.map(d=>d.phaseName!=="Final"?d:{...d,fixtures:d.fixtures.map(f=>({...f,awayTeamId:t.teams[1].id}))})};expect(seasonHonours(bad).awards).toEqual([]);
 });
 it("uses two-leg domain winners without adding aggregate rules",()=>{
  const t=cup(),final=t.matchdays[1].fixtures[0];
  const two={...t,knockoutStages:[t.knockoutStages![0],{name:"Final",legs:2 as const}],matchdays:[t.matchdays[0],{number:2,leg:2,phaseName:"Final · Ida",fixtures:[{...final,result:{homeGoals:1,awayGoals:0},knockoutResolution:undefined}]},{number:3,leg:3,phaseName:"Final · Vuelta",fixtures:[{...final,id:"f2",homeTeamId:final.awayTeamId,awayTeamId:final.homeTeamId,knockoutResolution:"aggregate-then-penalties" as const,result:{homeGoals:0,awayGoals:0}}]}]};
  expect(seasonHonours(two).awards).toContainEqual({teamId:final.homeTeamId,label:"Campeón"});
 });
 it("does not infer a playoff runner-up from league table",()=>{
  const t=league();expect(seasonHonours({...t,format:"staged"}).awards).toEqual([]);
 });
 it("does not call a lone semifinal the championship final",()=>{
  const t=cup();expect(seasonHonours({...t,knockoutStages:[{name:"Semifinal",legs:1}],matchdays:[{...t.matchdays[1],phaseName:"Semifinal"}]}).awards).toEqual([]);
 });
 it("keeps pending final and operational suspension unresolved",()=>{
  const t=cup();const pending={...t,matchdays:t.matchdays.map(d=>({...d,fixtures:d.fixtures.map(f=>({...f,operationalState:{status:"suspended" as const,updatedAt:t.createdAt}}))}))};expect(seasonHonours(pending).awards).toEqual([]);
 });
 it("refuses duplicates and mixed points systems",()=>{
  const t=league(),n=next(t),same={...t,id:"copy"};expect(historicalRecords([t,same],[t,same],[],"titles","").error).toContain("duplicadas");
  const changed={...n,pointsSystem:{win:2,draw:1,loss:0}};expect(historicalRecords([t,changed],[t,changed],[],"points",scope(t)).error).toContain("puntos");
 });
 it("counts titles only for explicit selected years and stable identities",()=>{
  const t=league(),n=next(t);const r=historicalRecords([t,n],[t,n],[],"titles","");expect(r.rows[0].value).toBe(2);expect(r.seasons).toBe(2);
 });
 it("keeps equal club names and contradictory identities separate",()=>{
  const t=league(),other=continentalLeague("different");expect(buildClubProfiles([t,other]).filter(p=>p.names.includes("Alfa"))).toHaveLength(2);
  const n={...next(t),teams:t.teams.map(team=>({...team,averageIdentity:"changed-"+team.id}))};const a={...t,teams:t.teams.map(team=>({...team,averageIdentity:"original-"+team.id}))};
  expect(historicalRecords([a,n],[a,n],[],"titles","").rows.map(r=>r.value)).toEqual([1,1]);
 });
 it("does not mix local plans with provider results",()=>{
  const t=league(),n={...next(t),seasonPreparation:{}} as Tournament;expect(historicalRecords([t,n],[t,n],[],"titles","").error).toContain("escenarios");
 });
 it("compares season records without adding their values",()=>{
  const t=league(),n=next(t);const r=historicalRecords([t,n],[t,n],[],"wins",scope(t));expect(r.rows.filter(r=>r.value===3)).toHaveLength(2);expect(r.rows[0].value).toBe(3);
 });
 it("excludes incomplete marks by default and permits separate partial consultation",()=>{
  const t=league(),partial={...t,matchdays:t.matchdays.slice(1)};expect(historicalRecords([partial],[partial],[],"wins",scope(partial)).rows).toEqual([]);expect(historicalRecords([partial],[partial],[],"wins",scope(partial),true).rows.length).toBeGreaterThan(0);
 });
 it("updates honours and marks after an edited result without mutating its source",()=>{
  const t=league(),before=JSON.stringify(t);const changed={...t,matchdays:t.matchdays.map(d=>({...d,fixtures:d.fixtures.map(f=>({...f,result:{homeGoals:0,awayGoals:0}}))}))};expect(seasonHonours(t).complete).toBe(true);expect(seasonHonours(changed).awards).toEqual([]);expect(seasonRecordRows(changed)[0].scope.metrics.wins).toBe(0);expect(JSON.stringify(t)).toBe(before);
 });
 it("does not fabricate streak order from matchday array",()=>expect(seasonRecordRows(league())[0].streaks.reason).toContain("cronológico"));
 it("computes regulation-time streaks only with full unambiguous chronology",()=>{
  const t=league();const dated={...t,matchdays:t.matchdays.map((d,i)=>({...d,fixtures:d.fixtures.map(f=>({...f,schedule:{date:`2026-01-0${i+1}`,time:"12:00",utcOffset:"Z"}}))}))};expect(seasonRecordRows(dated)[0].streaks.wins).toBe(3);expect(seasonRecordRows(dated)[0].streaks.unbeaten).toBe(3);
 });
 it.each(["missing-zone","duplicate-time","invalid-date"])("refuses ambiguous streak chronology: %s",kind=>{
  const t=league();const dated={...t,matchdays:t.matchdays.map((d,i)=>({...d,fixtures:d.fixtures.map(f=>({...f,schedule:{date:kind==="invalid-date"?"2026-02-31":`2026-01-0${kind==="duplicate-time"?1:i+1}`,time:"12:00",...(kind!=="missing-zone"?{utcOffset:"Z"}:{})}}))}))};
  expect(seasonRecordRows(dated)[0].streaks.reason).toBeDefined();
 });
 it("sorts streaks by explicit instants instead of fixture array order",()=>{
  const t=league(),id=t.teams[0].id;const dated={...t,matchdays:t.matchdays.map((d,i)=>({...d,fixtures:d.fixtures.map(f=>({...f,
   schedule:{date:`2026-01-0${[2,1,3][i]}`,time:"12:00",utcOffset:"Z"},
   result:f.homeTeamId===id?{homeGoals:i===1?0:1,awayGoals:i===1?1:0}:f.awayTeamId===id?{homeGoals:i===1?1:0,awayGoals:i===1?0:1}:f.result}))}))};
  expect(seasonRecordRows(dated)[0].streaks.wins).toBe(2);
 });
 it("rejects unknown years for historical comparisons and tolerates old tournaments for consultation",()=>{
  const t={...league(),season:undefined,competitionRules:undefined};expect(()=>seasonHonours(t)).not.toThrow();expect(historicalRecords([t],[t],[],"titles","").error).toContain("año");
 });
});

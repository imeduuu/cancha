import {it,expect} from "vitest";
import type {Tournament} from "../../domain/entities/tournament";
import type {ActivityEvent} from "../../domain/entities/activity-event";
import {continentalLeague} from "../../test-utils/continental-qualification-fixtures";
import {buildClubProfiles} from "./club-history";
import {headToHeadMatches,summarizeHeadToHead,type H2HFilters} from "./head-to-head";
function league():Tournament{
 const t=continentalLeague(),teams=t.teams.slice(0,2);
 return {...t,teams,legs:2,matchdays:[{number:1,leg:1,fixtures:[{id:"out",homeTeamId:teams[0].id,awayTeamId:teams[1].id,result:{homeGoals:2,awayGoals:0},schedule:{date:"2026-01-01",time:"12:00",utcOffset:"Z"}}]},
 {number:2,leg:2,fixtures:[{id:"back",homeTeamId:teams[1].id,awayTeamId:teams[0].id,result:{homeGoals:1,awayGoals:1},schedule:{date:"2026-01-08",time:"12:00",utcOffset:"Z"}}]}]};
}
function query(ts:readonly Tournament[],filters:H2HFilters={},activity:readonly ActivityEvent[]=[]){
 const profiles=buildClubProfiles(ts),a=profiles.find(p=>p.teamIds.includes(ts[0].teams[0].id))!,b=profiles.find(p=>p.teamIds.includes(ts[0].teams[1].id))!;
 return headToHeadMatches(a,b,ts,activity,filters);
}
function sum(t:Tournament,filters:H2HFilters={}){return summarizeHeadToHead(query([t],filters).rows,[t.id],[t],[]);}
it("derives regulation wins, draws, goals and both venue splits from saved standings",()=>{
 const t=league(),s=sum(t);expect(s.totals?.a).toEqual({played:2,wins:1,draws:1,losses:0,goalsFor:3,goalsAgainst:1});expect(s.totals?.b.wins).toBe(0);expect(s.home?.a.played).toBe(1);expect(s.away?.a.draws).toBe(1);
});
it("requires explicit source selection",()=>{const t=league();expect(summarizeHeadToHead(query([t]).rows,[],[t],[]).error).toContain("Selecciona");});
it("leaves pending matches in the list without counting them",()=>{
 const t=league(),pending={...t,matchdays:t.matchdays.map(d=>({...d,fixtures:d.fixtures.map(f=>({...f,result:undefined}))}))};expect(query([pending]).rows).toHaveLength(2);expect(sum(pending).totals?.a.played).toBe(0);expect(sum(pending).notCounted).toBe(2);expect(sum(pending).streaks).toBeUndefined();
});
it.each(["suspended","postponed","cancelled","in-progress"] as const)("excludes %s results while preserving source scores",status=>{
 const t=league(),changed={...t,matchdays:t.matchdays.map(d=>({...d,fixtures:d.fixtures.map(f=>({...f,operationalState:{status,updatedAt:t.createdAt}}))}))};expect(sum(changed).totals?.a.played).toBe(0);expect(query([changed]).rows[0].fixture.result).toBeDefined();
});
it("filters venue from club A perspective and recomputes the accumulation",()=>{const t=league();expect(sum(t,{venue:"home"}).totals?.a.wins).toBe(1);expect(sum(t,{venue:"away"}).totals?.a.wins).toBe(0);});
it("filters competition, explicit year and provenance",()=>{
 const t=league();expect(query([t],{competition:"wrong"}).rows).toEqual([]);expect(query([t],{season:"2027"}).rows).toEqual([]);expect(query([t],{provenance:"provider"}).rows).toHaveLength(2);expect(query([t],{provenance:"local"}).rows).toEqual([]);
});
it("identifies simulated activity without presenting it as provider results",()=>{
 const t=league(),events:ActivityEvent[]=[{id:"sim",occurredAt:t.createdAt,tournamentId:t.id,tournamentName:t.name,action:"matches-simulated",summary:"Synthetic simulation"}];expect(query([t],{provenance:"local"},events).rows[0].scenario).toBe("local");expect(query([t],{provenance:"provider"},events).rows).toEqual([]);
});
it("does not merge homonyms or infer cross-tournament relationships",()=>{
 const t=league(),other={...league(),id:"other",teams:t.teams.map(team=>({...team,id:"different-"+team.id})),matchdays:[]};const profiles=buildClubProfiles([t,other]);expect(profiles.filter(p=>p.names.includes("Alfa"))).toHaveLength(2);
 const a=profiles.find(p=>p.teamIds.includes(t.teams[0].id))!,b=profiles.find(p=>p.teamIds.includes(other.teams[1].id))!;expect(headToHeadMatches(a,b,[t,other],[]).rows).toEqual([]);
});
it("blocks contradictory historical identities and same-club selection",()=>{
 const t=league(),other={...t,id:"other",teams:t.teams.map(team=>({...team,averageIdentity:"new-"+team.id}))};const first={...t,teams:t.teams.map(team=>({...team,averageIdentity:"old-"+team.id}))};const profiles=buildClubProfiles([first,other]);expect(headToHeadMatches(profiles[0],profiles[1],[first,other],[]).error).toContain("ambigua");expect(headToHeadMatches(profiles[0],profiles[0],[first,other],[]).error).toContain("distintos");
});
it("rejects duplicate season copies and duplicate fixture identities",()=>{
 const t=league(),copy={...t,id:"copy"};expect(summarizeHeadToHead(query([t,copy]).rows,[t.id,copy.id],[t,copy],[]).error).toContain("duplicadas");
 const duplicate={...t,matchdays:[t.matchdays[0],{...t.matchdays[0],number:3}]};expect(sum(duplicate).error).toContain("partido duplicadas");
});
it("rejects mixing local scenarios, competition formats and point systems",()=>{
 const t=league(),n={...t,id:"next",season:2027,competitionRules:{...t.competitionRules!,season:2027},pointsSystem:{win:2,draw:1,loss:0}};expect(summarizeHeadToHead(query([t,n]).rows,[t.id,n.id],[t,n],[]).error).toContain("incompatibles");
 const events:ActivityEvent[]=[{id:"sim",occurredAt:t.createdAt,tournamentId:n.id,tournamentName:n.name,action:"matches-simulated",summary:"Simulation"}];const same={...n,pointsSystem:t.pointsSystem};expect(summarizeHeadToHead(query([t,same],{},events).rows,[t.id,n.id],[t,same],events).error).toContain("escenarios");
});
it("does not count a penalty shootout as a regulation victory",()=>{
 const t=league(),cup={...t,competitionType:"cup" as const,matchdays:[{...t.matchdays[0],fixtures:[{...t.matchdays[0].fixtures[0],knockoutResolution:"penalties" as const,result:{homeGoals:0,awayGoals:0,penalties:{homeGoals:5,awayGoals:4}}}]}]};const s=sum(cup);expect(s.totals?.a.draws).toBe(1);expect(s.totals?.a.wins).toBe(0);expect(s.totals?.a.goalsFor).toBe(0);
});
it("keeps extra-time goals separate from regulation totals",()=>{
 const t=league(),cup={...t,competitionType:"cup" as const,matchdays:[{...t.matchdays[0],fixtures:[{...t.matchdays[0].fixtures[0],knockoutResolution:"extra-time-then-penalties" as const,result:{homeGoals:1,awayGoals:1,extraTime:{homeGoals:1,awayGoals:0}}}]}]};expect(sum(cup).totals?.a).toMatchObject({played:1,draws:1,wins:0,goalsFor:1});
});
it("retains the first leg as context when venue filters select only a return leg",()=>{
 const t=league(),cup={...t,competitionType:"cup" as const,matchdays:[{...t.matchdays[0],phaseName:"Final · Ida"},{...t.matchdays[1],phaseName:"Final · Vuelta",fixtures:[{...t.matchdays[1].fixtures[0],knockoutResolution:"aggregate-then-penalties" as const,result:{homeGoals:2,awayGoals:0,penalties:{homeGoals:4,awayGoals:5}}}]}]};expect(sum(cup,{venue:"away"}).totals?.a).toMatchObject({played:1,losses:1});
});
it.each(["missing","duplicate","invalid"])("withholds streaks and latest labels for %s chronology",kind=>{
 const t=league(),changed={...t,matchdays:t.matchdays.map(d=>({...d,fixtures:d.fixtures.map(f=>({...f,schedule:kind==="missing"?undefined:{date:kind==="invalid"?"2026-02-31":"2026-01-01",time:"12:00",utcOffset:"Z"}}))}))};expect(sum(changed).streaks).toBeUndefined();expect(sum(changed).latest).toEqual([]);
});
it("orders the latest saved meetings by verified instants and reuses record streaks",()=>{
 const t=league(),s=sum({...t,matchdays:[...t.matchdays].reverse()});expect(s.latest?.[0].fixture.id).toBe("back");expect(s.streaks).toMatchObject({winsA:1,winsB:0,unbeatenA:2,unbeatenB:1});
});
it("updates after edited scores without mutating original tournaments",()=>{
 const t=league(),before=JSON.stringify(t),edited={...t,matchdays:t.matchdays.map(d=>({...d,fixtures:d.fixtures.map(f=>({...f,result:{homeGoals:0,awayGoals:0}}))}))};expect(sum(edited).totals?.a.wins).toBe(0);expect(sum(t).totals?.a.wins).toBe(1);expect(JSON.stringify(t)).toBe(before);
});
it("consults old tournaments without year, schedule or provenance and rejects stale selections",()=>{
 const t={...league(),season:undefined,sourceUrl:undefined,competitionRules:undefined};expect(query([t]).rows[0].scenario).toBe("unknown");expect(sum(t).totals?.a.played).toBe(2);expect(summarizeHeadToHead(query([t]).rows,["deleted"],[t],[]).error).toContain("disponible");
});

it("labels simulation only when the last per-match activity matches the current score",()=>{
 const t=league(),f=t.matchdays[0].fixtures[0],simulation:ActivityEvent={id:"sim",occurredAt:"2026-01-01T00:00:00Z",tournamentId:t.id,tournamentName:t.name,action:"matches-simulated",summary:"Simulation",before:{[f.id]:null},after:{[f.id]:f.result}};
 const row=query([t],{},[simulation]).rows.find(r=>r.fixture.id===f.id)!;expect(row.resultOrigin).toContain("Simulado");
 const manual:ActivityEvent={...simulation,id:"manual",occurredAt:"2026-01-02T00:00:00Z",action:"match-result-updated",entityId:f.id,after:{result:f.result}};
 expect(query([t],{},[simulation,manual]).rows.find(r=>r.fixture.id===f.id)!.resultOrigin).toContain("manualmente");
 const replaced={...t,matchdays:t.matchdays.map(d=>({...d,fixtures:d.fixtures.map(f=>({...f,result:{homeGoals:0,awayGoals:0}}))}))};expect(query([replaced],{},[simulation]).rows.find(r=>r.fixture.id===f.id)!.resultOrigin).toContain("sin trazabilidad");
});

it("does not label unchanged or undocumented simulation batch members as simulated",()=>{
 const t=league(),f=t.matchdays[0].fixtures[0],event:ActivityEvent={id:"batch",occurredAt:t.createdAt,tournamentId:t.id,tournamentName:t.name,action:"matches-simulated",summary:"Batch with unchanged score",before:{[f.id]:f.result},after:{[f.id]:f.result}};
 expect(query([t],{},[event]).rows.find(r=>r.fixture.id===f.id)!.resultOrigin).toContain("sin trazabilidad");
 expect(query([t],{},[{...event,before:undefined}]).rows.find(r=>r.fixture.id===f.id)!.resultOrigin).toContain("sin trazabilidad");
});

it.each(["same-instant","later-manual"])("uses actual UTC instants to qualify individual provenance: %s",kind=>{
 const t=league(),f=t.matchdays[0].fixtures[0],simulation:ActivityEvent={id:"sim",occurredAt:"2026-01-01T14:00:00+02:00",tournamentId:t.id,tournamentName:t.name,action:"matches-simulated",summary:"Simulation",before:{[f.id]:null},after:{[f.id]:f.result}};
 const manual:ActivityEvent={...simulation,id:"manual",action:"match-result-updated",entityId:f.id,occurredAt:kind==="same-instant"?"2026-01-01T12:00:00Z":"2026-01-01T13:00:00Z",after:{result:f.result}};
 const origin=query([t],{},[simulation,manual]).rows.find(r=>r.fixture.id===f.id)!.resultOrigin;
 expect(origin).toContain(kind==="same-instant"?"sin trazabilidad":"manualmente");
});

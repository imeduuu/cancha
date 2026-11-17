import {it,expect} from "vitest";
import type {Tournament} from "../../domain/entities/tournament";
import type {ActivityEvent} from "../../domain/entities/activity-event";
import {continentalLeague} from "../../test-utils/continental-qualification-fixtures";
import {buildClubProfiles} from "./club-history";
import {clubPerformanceRows,performanceDetail,performanceEvolution,comparePerformance,goalAverages} from "./club-performance";
import {calculateTournamentStatistics} from "../../domain/services/tournament-statistics";
const t=()=>continentalLeague();
const next=(a:Tournament):Tournament=>({...a,id:"next",season:2027,competitionRules:{...a.competitionRules!,season:2027}});
function profile(ts:readonly Tournament[],id=ts[0].teams[0].id){return buildClubProfiles(ts).find(p=>p.teamIds.includes(id))!;}
function rows(ts:readonly Tournament[],activity:readonly ActivityEvent[]=[]){return clubPerformanceRows(profile(ts),ts,activity).rows;}
it("reuses standings metrics and computes only requested goal averages",()=>{
 const a=t(),d=performanceDetail(rows([a])[0]);expect(d.metrics).toMatchObject({played:3,wins:3,draws:0,losses:0,goalsFor:6,goalsAgainst:0,goalDifference:6});expect(d.averages).toEqual({for:2,against:0});expect(d.accreditedPosition).toBe(1);
});
it("venue results agree with existing tournament statistics",()=>{
 const a=t(),d=performanceDetail(rows([a])[0]),venue=calculateTournamentStatistics(a).homeAway.get(a.teams[0].id)!;
 expect(d.home.played).toBe(venue.homePlayed);expect(d.away.played).toBe(venue.awayPlayed);expect(d.home.wins).toBe(venue.homeWins);expect(d.away.wins).toBe(venue.awayWins);expect(d.home.goalsFor+d.away.goalsFor).toBe(d.metrics.goalsFor);
});
it("derives matchday and cumulative data in registered round order",()=>{
 const a=t(),reversed={...a,matchdays:[...a.matchdays].reverse()},d=performanceDetail(rows([reversed])[0]);expect(d.rounds.map(r=>r.label)).toEqual(["Rueda 1 · Jornada 1","Rueda 1 · Jornada 2","Rueda 1 · Jornada 3"]);expect(d.rounds[2].cumulative).toMatchObject({played:3,wins:3,goalsFor:6});
});
it("keeps fully pending seasons partial without fabricated averages or positions",()=>{
 const a=t(),p={...a,matchdays:a.matchdays.map(day=>({...day,fixtures:day.fixtures.map(f=>({...f,result:undefined}))}))};const r=rows([p])[0],d=performanceDetail(r);expect(r.complete).toBe(false);expect(d.metrics.played).toBe(0);expect(d.averages.for).toBeUndefined();expect(d.accreditedPosition).toBeUndefined();expect(d.rounds[2].cumulative.played).toBe(0);
});
it("excludes suspended scores while keeping programmed matches visible",()=>{
 const a=t(),p={...a,matchdays:a.matchdays.map(day=>({...day,fixtures:day.fixtures.map(f=>({...f,operationalState:{status:"suspended" as const,updatedAt:a.createdAt}}))}))};const r=rows([p])[0];expect(r.scope.scheduled).toBe(3);expect(performanceDetail(r).metrics.played).toBe(0);
});
it("never graphs a position for explicit partial import coverage",()=>{
 const a={...t(),importCoverage:"partial" as const};expect(performanceDetail(rows([a])[0]).accreditedPosition).toBeUndefined();
});
it("blocks provisional rules from position accreditation",()=>{
 const a=t(),p={...a,competitionRules:{...a.competitionRules!,verification:{standings:"pending" as const,placements:"pending" as const}}};expect(performanceDetail(rows([p])[0]).accreditedPosition).toBeUndefined();
});
it("does not attribute a numeric position when the final table is tied",()=>{
 const a=t(),drawn={...a,matchdays:a.matchdays.map(day=>({...day,fixtures:day.fixtures.map(f=>({...f,result:{homeGoals:0,awayGoals:0}}))}))};expect(performanceDetail(rows([drawn])[0]).accreditedPosition).toBeUndefined();
});
it("compares general performance against all opponents, not just head-to-head",()=>{
 const a=t(),p=profile([a],a.teams[1].id),comparison=comparePerformance(rows([a])[0],p,[a],[]);expect(comparison.rows).toHaveLength(2);expect(comparison.rows?.[1].scope.metrics.played).toBe(3);expect(comparison.rows?.[1].scope.metrics.wins).toBe(2);
});
it("blocks same club and unavailable or different-group peers",()=>{
 const a=t(),r=rows([a])[0];expect(comparePerformance(r,profile([a]),[a],[]).error).toContain("distintos");const other=continentalLeague("other");expect(comparePerformance(r,profile([other]),[a,other],[]).error).toContain("compatible");
});
it("does not merge homonyms and blocks contradictory historical identities",()=>{
 const a=t(),b={...next(a),teams:a.teams.map(team=>({...team,averageIdentity:"new-"+team.id}))},first={...a,teams:a.teams.map(team=>({...team,averageIdentity:"old-"+team.id}))};expect(clubPerformanceRows(profile([first,b]),[first,b],[]).error).toContain("ambigua");expect(comparePerformance(rows([a])[0],profile([first,b]),[first,b],[]).error).toContain("ambigua");expect(buildClubProfiles([a,continentalLeague("homonym")]).filter(p=>p.names.includes("Alfa"))).toHaveLength(2);
});
it("selects evolution expressly, chronologically, without summing seasons",()=>{
 const a=t(),b=next(a),rs=rows([b,a]);expect(performanceEvolution(rs,[]).error).toContain("Selecciona");const evolution=performanceEvolution(rs,rs.map(r=>r.scope.key));expect(evolution.rows.map(r=>r.tournament.season)).toEqual([2026,2027]);expect(evolution.rows.map(r=>r.scope.metrics.wins)).toEqual([3,3]);
});
it.each(["points","format","scenario"])("rejects incompatible seasonal evolution: %s",kind=>{
 const a=t(),b=next(a),changed={...b,...(kind==="points"?{pointsSystem:{win:2,draw:1,loss:0}}:kind==="format"?{legs:2}:{})};const events:ActivityEvent[]=kind==="scenario"?[{id:"sim",tournamentId:b.id,tournamentName:b.name,occurredAt:b.createdAt,action:"matches-simulated",summary:"Simulation"}]:[];const rs=rows([a,changed],events);expect(performanceEvolution(rs,rs.map(r=>r.scope.key)).error).toContain("incompatibles");
});
it("rejects duplicate copies and missing selected sources",()=>{
 const a=t(),copy={...a,id:"copy"},rs=rows([a,copy]);expect(performanceEvolution(rs,rs.map(r=>r.scope.key)).error).toContain("duplicadas");expect(performanceEvolution(rows([a]),[rs[1].scope.key,"missing"]).error).toContain("disponible");
});
it("updates after edited scores while preserving historical sources",()=>{
 const a=t(),before=JSON.stringify(a),changed={...a,matchdays:a.matchdays.map(day=>({...day,fixtures:day.fixtures.map(f=>({...f,result:{homeGoals:0,awayGoals:0}}))}))};expect(performanceDetail(rows([changed])[0]).metrics.wins).toBe(0);expect(performanceDetail(rows([a])[0]).metrics.wins).toBe(3);expect(JSON.stringify(a)).toBe(before);
});
it("consults old tournaments separately and rejects evolution without explicit years",()=>{
 const a={...t(),season:undefined,competitionRules:undefined,sourceUrl:undefined},rs=rows([a]);expect(rs[0].scenario).toBe("unknown");expect(performanceDetail(rs[0]).metrics.played).toBe(3);expect(performanceEvolution(rs,rs.map(r=>r.scope.key)).error).toContain("años");expect(goalAverages({...rs[0].scope.metrics,played:0}).for).toBeUndefined();
});
it("keeps an actual phase named like the fallback label separate from unlabelled days",()=>{
 const a=t(),extra={number:1,leg:2,phaseName:"Sin fase registrada",fixtures:[{id:"extra",homeTeamId:a.teams[0].id,awayTeamId:a.teams[1].id,result:{homeGoals:9,awayGoals:0}}]},rs=rows([{...a,matchdays:[...a.matchdays,extra]}]);expect(rs).toHaveLength(2);expect(rs.find(r=>r.scope.phaseName===undefined)!.scope.metrics.goalsFor).toBe(6);expect(performanceDetail(rs.find(r=>r.scope.phaseName===extra.phaseName)!).rounds[0].metrics.goalsFor).toBe(9);
});
it("validates extra-time and penalties but keeps regulation-only metrics",()=>{
 const a=t(),cup={...a,teams:a.teams.slice(0,2),competitionType:"cup" as const,format:"staged" as const,knockoutStages:[{name:"Final",legs:1 as const}],matchdays:[{number:1,leg:1,phaseName:"Final",fixtures:[{id:"f",homeTeamId:a.teams[0].id,awayTeamId:a.teams[1].id,knockoutResolution:"extra-time-then-penalties" as const,result:{homeGoals:1,awayGoals:1,extraTime:{homeGoals:0,awayGoals:0},penalties:{homeGoals:5,awayGoals:4}}}]}]};const d=performanceDetail(rows([cup])[0]);expect(d.metrics).toMatchObject({played:1,draws:1,wins:0,goalsFor:1});expect(d.accreditedPosition).toBeUndefined();
});
it("keeps the first leg as context for a return-leg phase and its round metrics",()=>{
 const a=t(),h=a.teams[0].id,v=a.teams[1].id,cup={...a,teams:a.teams.slice(0,2),competitionType:"cup" as const,format:"staged" as const,knockoutStages:[{name:"Final",legs:2 as const}],matchdays:[{number:1,leg:1,phaseName:"Final · Ida",fixtures:[{id:"ida",homeTeamId:h,awayTeamId:v,result:{homeGoals:1,awayGoals:0}}]},{number:1,leg:2,phaseName:"Final · Vuelta",fixtures:[{id:"vuelta",homeTeamId:v,awayTeamId:h,knockoutResolution:"aggregate-then-penalties" as const,result:{homeGoals:1,awayGoals:0,penalties:{homeGoals:4,awayGoals:5}}}]}]};const r=rows([cup]).find(r=>r.scope.phaseName==="Final · Vuelta")!,d=performanceDetail(r);expect(d.away.played).toBe(1);expect(d.rounds[0].metrics.losses).toBe(1);
});

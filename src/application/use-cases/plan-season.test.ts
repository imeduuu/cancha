import {it,expect,vi} from "vitest";
import type {Tournament} from "../../domain/entities/tournament";
import type {ActivityEvent} from "../../domain/entities/activity-event";
import type {TournamentRepository} from "../ports/tournament-repository";
import {continentalLeague} from "../../test-utils/continental-qualification-fixtures";
import {brazilUpper,nationalCup} from "../../test-utils/journey-competition-fixtures";
import {divisionFixture} from "../../domain/services/second-division-test-fixtures";
import {advanceSecondDivision} from "../../domain/services/second-division-progression";
import {simulateChampionship} from "./simulate-championship";
import {projectSeasonPlanning,type SeasonPlanningInput} from "../services/season-planning";
import {reviewSeasonPlanning,confirmSeasonPlanning} from "./plan-season";
import {createTournamentSeason} from "./create-tournament-season";
import {entryKey,continentalProjection} from "../services/continental-projection";
import {createTournamentBackup,parseTournamentBackupWithActivity} from "../services/tournament-archive";
function memory(initial:readonly Tournament[]){
 const data=[...initial],activity:ActivityEvent[]=[];
 const repo:TournamentRepository={findAll:()=>data,findActivity:()=>activity,save:vi.fn(t=>{const i=data.findIndex(s=>s.id===t.id);if(i<0)data.push(t);else data[i]=t;}),saveWithActivity:vi.fn((t,e)=>{repo.save(t);activity.push(e);}),saveManyWithActivity:vi.fn((ts,e)=>{ts.forEach((t:Tournament)=>repo.save(t));activity.push(e);})};return {repo,data,activity};
}
const roster=(t:Tournament):SeasonPlanningInput=>({mode:"roster",sourceId:t.id,targetSeason:2027,carryRoster:true});
function continental(t:Tournament):SeasonPlanningInput{return {mode:"continental",sourceId:t.id,targetSeason:2027,qualifyingSeason:2026,cup:"libertadores",sourceIds:[t.id],selectedKeys:continentalProjection([t.id],2026,"libertadores",[t],[]).entries.map(entryKey),sourceUrl:"https://www.conmebol.com/documento-sintetico",note:"Vinculación sintética de la temporada 2026 a la edición 2027; planificación local."};}
it("projects a provisional roster without writes and permits coexistence of ready/local/pending future rules",()=>{
 const t=continentalLeague(),m=memory([t]),before=JSON.stringify(m.data),p=projectSeasonPlanning(roster(t),m.data,m.activity);expect(p.canReview).toBe(true);expect(p.states).toEqual(expect.arrayContaining(["Lista para revisión","Planificación local","Pendiente de reglamento"]));expect(p.participants).toHaveLength(4);expect(p.participants.every(p=>p.status==="provisional")).toBe(true);reviewSeasonPlanning(roster(t),m.repo);expect(m.repo.save).not.toHaveBeenCalled();expect(JSON.stringify(m.data)).toBe(before);
});
it("requires express roster choice and complete results",()=>{
 const t=continentalLeague();expect(projectSeasonPlanning({...roster(t),carryRoster:false},[t],[]).canReview).toBe(false);const pending={...t,matchdays:t.matchdays.slice(1)};expect(projectSeasonPlanning(roster(pending),[pending],[]).states).toContain("Pendiente de resultados");
});
it("uses the existing creator in roster-only mode without fixtures or inherited rules",()=>{
 const t=continentalLeague(),m=memory([t]),review=reviewSeasonPlanning(roster(t),m.repo),before=JSON.stringify(t);
 expect(()=>confirmSeasonPlanning(review,m.repo,false)).toThrow("confirma");expect(m.data).toHaveLength(1);
 const [next]=confirmSeasonPlanning(review,m.repo,true);expect(next.teams.map(t=>t.id)).toEqual(t.teams.map(t=>t.id));expect(next.matchdays).toEqual([]);expect(next.competitionRules?.verification).toEqual({standings:"pending",placements:"pending"});expect(next.tieBreakers).toEqual([]);expect(next.seasonPreparation?.sourceTournamentIds).toEqual([t.id]);expect(JSON.stringify(t)).toBe(before);expect(m.activity[0].action).toBe("season-created");expect(()=>confirmSeasonPlanning(review,m.repo,true)).toThrow("Revisa");
});
it("retains legacy season creation behavior when roster-only mode is not requested",()=>{
 const t=continentalLeague(),m=memory([t]),next=createTournamentSeason(t,2027,m.repo);expect(next.matchdays.length).toBe(t.matchdays.length);expect(next.matchdays.flatMap(d=>d.fixtures).every(f=>f.result===undefined)).toBe(true);
});
it("rejects changed dependencies, altered reviews and concurrent destination creation",()=>{
 const t=continentalLeague(),m=memory([t]),review=reviewSeasonPlanning(roster(t),m.repo);m.repo.save({...t,name:"Editado"});expect(()=>confirmSeasonPlanning(review,m.repo,true)).toThrow("desactualizada");expect(m.data).toHaveLength(1);
 const n=memory([t]),r=reviewSeasonPlanning(roster(t),n.repo);r.input.targetSeason=2028;expect(()=>confirmSeasonPlanning(r,n.repo,true)).toThrow("alterar");
 const c=memory([t]),v=reviewSeasonPlanning(roster(t),c.repo);c.repo.save({...t,id:"other",season:2027});expect(()=>confirmSeasonPlanning(v,c.repo,true)).toThrow("desactualizada");
});
it("reports duplicates in source versions without silently picking one and blocks duplicate destinations",()=>{
 const t=continentalLeague(),copy={...t,id:"copy"};const p=projectSeasonPlanning(roster(t),[t,copy],[]);expect(p.notes.join(" ")).toContain("otras versiones");expect(p.source?.id).toBe(t.id);
 const d=projectSeasonPlanning(roster(t),[t,{...t,id:"future",season:2027}],[]);expect(d.canReview).toBe(false);expect(d.targets).toHaveLength(1);
});
it("does not infer participants of national cups or annual periods for unregistered seasons",()=>{
 const cup=nationalCup("argentina");const p=projectSeasonPlanning(roster(cup),[cup],[]);expect(p.participants).toEqual([]);expect(p.canReview).toBe(false);expect(p.states).toContain("Pendiente de participantes");
 const old={...continentalLeague(),season:undefined};expect(projectSeasonPlanning(roster(old),[old],[]).canReview).toBe(false);
});
it("does not bypass registered promotion/relegation workflows through the generic roster mode",()=>{
 const t=divisionFixture("brasil");expect(projectSeasonPlanning(roster(t),[t],[]).blockers.join(" ")).toContain("flujo deportivo");
});
it("keeps pending ties and unverified rules visible",()=>{
 const t=continentalLeague(),drawn={...t,matchdays:t.matchdays.map(d=>({...d,fixtures:d.fixtures.map(f=>({...f,result:{homeGoals:0,awayGoals:0}}))}))};expect(projectSeasonPlanning(roster(drawn),[drawn],[]).states).toContain("Pendiente de desempate");
 const u={...t,competitionRules:{...t.competitionRules!,verification:{standings:"pending" as const,placements:"pending" as const}}};expect(projectSeasonPlanning(roster(u),[u],[]).canReview).toBe(false);
});
it("does not merge contradictory identities or clubs with repeated roster names",()=>{
 const t=continentalLeague(),old={...t,id:"other",teams:t.teams.map(team=>({...team,averageIdentity:"old-"+team.id}))},a={...t,teams:t.teams.map(team=>({...team,averageIdentity:"new-"+team.id}))};expect(projectSeasonPlanning(roster(a),[a,old],[]).states).toContain("Conflicto de identidad");
 const repeated={...t,teams:t.teams.map((team,i)=>i===1?{...team,name:t.teams[0].name}:team)};expect(projectSeasonPlanning(roster(repeated),[repeated],[]).canReview).toBe(false);
});
it("requires an explicit division association and keeps pending playoffs blocked",()=>{
 const lower=divisionFixture("brasil"),upper=brazilUpper();const input:SeasonPlanningInput={mode:"divisions",sourceId:lower.id,targetSeason:2027};expect(projectSeasonPlanning(input,[lower,upper],[]).dependencies).not.toContainEqual(expect.objectContaining({id:upper.id}));
 const p=projectSeasonPlanning({...input,partnerId:upper.id},[lower,upper],[]);expect(p.canReview).toBe(false);expect(p.states).toContain("Pendiente de resultados");expect(p.dependencies).toContainEqual(expect.objectContaining({id:upper.id,recorded:false}));
});
it("reuses complete division movements and creates both rosters atomically only after confirmation",()=>{
 const lowerSource=advanceSecondDivision(divisionFixture("brasil"));const sandbox=memory([lowerSource]);let seed=42;const random=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};const lower=simulateChampionship(lowerSource,"pendingOnly",sandbox.repo,random).tournament,upper=brazilUpper(),m=memory([upper,lower]);
 const input:SeasonPlanningInput={mode:"divisions",sourceId:lower.id,partnerId:upper.id,targetSeason:2027,sourceUrl:"https://www.cbf.com.br/ascensos-sinteticos",incoming:[0,1,2,3].map(i=>({id:"in-"+i,name:"Nuevo "+i}))};
 const p=projectSeasonPlanning(input,m.data,[]);expect(p.blockers).toEqual([]);expect(p.movements.filter(m=>m.role.includes("Asciende"))).toHaveLength(4);const review=reviewSeasonPlanning(input,m.repo);expect(m.repo.save).not.toHaveBeenCalled();const created=confirmSeasonPlanning(review,m.repo,true);expect(created.map(t=>t.teams.length)).toEqual([20,20]);expect(created.every(t=>t.matchdays.length===0)).toBe(true);expect(m.repo.saveManyWithActivity).toHaveBeenCalledTimes(1);expect(m.data[0]).toBe(upper);expect(m.data[1]).toBe(lower);
});
it("reuses continental allocations and stores only selected participants without creating fixtures",()=>{
 const t=continentalLeague(),m=memory([t]),input=continental(t),preview=projectSeasonPlanning(input,m.data,m.activity);expect(preview.canReview).toBe(true);expect(preview.participants[0]).toMatchObject({name:"Alfa",status:"confirmed",selected:true});
 const [cup]=confirmSeasonPlanning(reviewSeasonPlanning(input,m.repo),m.repo,true);expect(cup.matchdays).toEqual([]);expect(cup.teams.map(t=>t.name)).toEqual(["Alfa"]);expect(cup.continentalPlans?.[0].qualifyingSeason).toBe(2026);
});
it("keeps provisional continental slots local and pending slots unselectable",()=>{
 const t=continentalLeague(),provisional={...t,competitionRules:{...t.competitionRules!,internationalQualification:{...t.competitionRules!.internationalQualification!,verification:"provisional" as const}}};const p=projectSeasonPlanning(continental(provisional),[provisional],[]);expect(p.participants[0].status).toBe("provisional");expect(p.canReview).toBe(true);
 const pending={...provisional,competitionRules:{...provisional.competitionRules!,internationalQualification:{...provisional.competitionRules!.internationalQualification!,verification:"pending" as const}}};expect(projectSeasonPlanning(continental(pending),[pending],[]).canReview).toBe(false);
});
it("requires explicit continental source seasons and never guesses the next edition",()=>{
 const t=continentalLeague();expect(projectSeasonPlanning({...continental(t),targetSeason:0},[t],[]).canReview).toBe(false);expect(projectSeasonPlanning({...continental(t),qualifyingSeason:2025},[t],[]).canReview).toBe(false);
 expect(projectSeasonPlanning({...continental(t),targetSeason:2026},[t],[]).canReview).toBe(true);
});
it("preserves existing continental rosters on documentary review and flags later source changes",()=>{
 const t=continentalLeague(),m=memory([t]),input=continental(t),[cup]=confirmSeasonPlanning(reviewSeasonPlanning(input,m.repo),m.repo,true),before=JSON.stringify(cup.matchdays),teams=JSON.stringify(cup.teams);
 const second=reviewSeasonPlanning({...input,targetId:cup.id,note:"Revisión documental adicional"},m.repo);const [updated]=confirmSeasonPlanning(second,m.repo,true);expect(JSON.stringify(updated.teams)).toBe(teams);expect(JSON.stringify(updated.matchdays)).toBe(before);expect(updated.continentalPlans).toHaveLength(2);
 m.repo.save({...t,matchdays:[]});expect(projectSeasonPlanning({...input,targetId:cup.id},m.data,m.activity).states).toContain("Dependencia desactualizada");expect(updated.continentalPlans).toHaveLength(2);
});
it("does not establish identity from matching published names",()=>{
 const t=continentalLeague(),target={...t,id:"cup",competitionId:"conmebol-libertadores",season:2027,competitionType:"cup" as const,format:"staged" as const,teams:[{id:"unlinked",name:"Alfa"}],matchdays:[],competitionRules:{season:2027,verification:{standings:"pending" as const,placements:"pending" as const}}};const p=projectSeasonPlanning({...continental(t),targetId:target.id},[t,target],[]);expect(p.differences[0].unlinkedExpected).toEqual(["Alfa"]);expect(p.differences[0].unlinkedRegistered).toEqual(["Alfa"]);
});
it("roundtrips roster-only planning and activity in JSON v7 and reads old backups without it",()=>{
 const t=continentalLeague(),m=memory([t]);confirmSeasonPlanning(reviewSeasonPlanning(roster(t),m.repo),m.repo,true);const text=JSON.stringify(createTournamentBackup(m.data,()=>new Date(t.createdAt),m.activity));expect(JSON.parse(text).version).toBe(7);const parsed=parseTournamentBackupWithActivity(text);expect(parsed.tournaments).toHaveLength(2);expect(parsed.activity).toHaveLength(1);expect(parseTournamentBackupWithActivity(JSON.stringify(createTournamentBackup([t]))).tournaments[0].seasonPreparation).toBeUndefined();
});

it("preserves the qualification scenario when a provider cup champion depends on an edited league",()=>{
 const t=continentalLeague(),cup:Tournament={id:"national-cup",competitionId:"national-cup",name:"Copa sintética",season:2026,createdAt:t.createdAt,teams:[t.teams[3],t.teams[2]],competitionType:"cup",format:"staged",legs:1,tieBreakers:[],sourceUrl:"https://www.cbf.com.br/",competitionRules:{season:2026,verification:{standings:"verified",placements:"verified"}},knockoutStages:[{name:"Final",legs:1}],matchdays:[{number:1,leg:1,phaseName:"Final",fixtures:[{id:"cup-final",homeTeamId:t.teams[3].id,awayTeamId:t.teams[2].id,result:{homeGoals:2,awayGoals:0}}]}]};
 const league={...t,competitionRules:{...t.competitionRules!,internationalQualification:{...t.competitionRules!.internationalQualification!,cupChampions:[{sourceTournamentId:cup.id,destination:"conmebol-libertadores"}]}}};
 const activity:ActivityEvent[]=[{id:"sim",occurredAt:t.createdAt,tournamentId:t.id,tournamentName:t.name,action:"matches-simulated",summary:"Escenario sintético"}];
 const projection=continentalProjection([league.id],2026,"libertadores",[league,cup],activity);const p=projectSeasonPlanning({...continental(league),selectedKeys:projection.entries.map(entryKey)},[league,cup],activity);expect(p.participants.find(p=>p.teamId===t.teams[3].id)?.scenario).toBe("local");expect(p.dependencies).toContainEqual(expect.objectContaining({id:cup.id,recorded:true}));
});

it("does not treat a resolved penalty final as an unresolved flat-table tie",()=>{
 const t=continentalLeague(),cup:Tournament={...t,teams:t.teams.slice(0,2),competitionType:"cup",format:"staged",knockoutStages:[{name:"Final",legs:1}],matchdays:[{number:1,leg:1,phaseName:"Final",fixtures:[{id:"f",homeTeamId:t.teams[0].id,awayTeamId:t.teams[1].id,knockoutResolution:"penalties",result:{homeGoals:0,awayGoals:0,penalties:{homeGoals:5,awayGoals:4}}}]}]};expect(projectSeasonPlanning(roster(cup),[cup],[]).states).not.toContain("Pendiente de desempate");
});

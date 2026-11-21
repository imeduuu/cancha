import {describe,it,expect,vi,afterEach} from "vitest";
import type {Tournament} from "../../domain/entities/tournament";
import type {ActivityEvent} from "../../domain/entities/activity-event";
import type {SportsUniverseLibrary} from "../../domain/entities/sports-universe";
import {projectHistoricalArchive} from "./historical-archive";
import {emptySportsUniverseLibrary} from "./sports-universes";
import {closureLeague,closureCup,closureMemory} from "../../test-utils/season-closure-fixtures";
import {reviewSeasonClosure,confirmSeasonClosure} from "../use-cases/confirm-season-closure";
import {createTournamentBackup,parseTournamentBackupWithActivity} from "./tournament-archive";
import {divisionFixture} from "../../domain/services/second-division-test-fixtures";
import {simulateChampionship} from "../use-cases/simulate-championship";
const empty=emptySportsUniverseLibrary();
const project=(ts:Tournament[],events:ActivityEvent[]=[],library:SportsUniverseLibrary=empty)=>projectHistoricalArchive(ts,events,library);
const event=(t:Tournament,action:ActivityEvent["action"],extra:Partial<ActivityEvent>={}):ActivityEvent=>({id:`event-${action}`,occurredAt:"2026-07-01T12:00:00.000Z",tournamentId:t.id,tournamentName:t.name,season:t.season,action,summary:action,...extra});
const edition=(t:Tournament,year:number):Tournament=>({...t,id:`edition-${year}`,season:year,competitionRules:{...t.competitionRules!,season:year}});
afterEach(()=>vi.restoreAllMocks());
describe("historical archive read projection",()=>{
  it("keeps an empty universe empty",()=>{expect(project([]).yearbooks).toEqual([]);expect(project([]).events).toEqual([]);});
  it("sorts explicit years and retains undated seasons without inferring from IDs or dates",()=>{
    const t=closureLeague(),view=project([edition(t,2024),{...t,id:"mystery-2023",season:undefined},edition(t,2026)]);
    expect(view.yearbooks.map(b=>b.year)).toEqual([2026,2024,undefined]);expect(view.yearbooks.at(-1)!.seasons[0].tournament.season).toBeUndefined();
  });
  it("archive status does not imply sporting completion or closure",()=>{
    const t={...closureLeague(),archived:true,matchdays:[]},row=project([t]).rows[0];
    expect(row.closure.confirmed).toBe(false);expect(row.champion).toBeUndefined();expect(row.closure.state).toBe("Sin calendario");
  });
  it("distinguishes calculated champions without closure from a current confirmed closure",()=>{
    const t=closureLeague(),memory=closureMemory([t]);expect(project([t]).rows[0].titleStatus).toBe("Campeón deportivo calculado");
    confirmSeasonClosure(reviewSeasonClosure(t.id,null,memory.repository),null,memory.repository,true);
    const view=project([t],memory.state.activity);expect(view.rows[0].titleStatus).toBe("Campeón con cierre vigente");expect(view.yearbooks[0].counts.confirmed).toBe(1);
  });
  it("updates results and marks old closures stale while retaining confirmations",()=>{
    const t=closureLeague(),memory=closureMemory([t]);confirmSeasonClosure(reviewSeasonClosure(t.id,null,memory.repository),null,memory.repository,true);
    const changed={...t,matchdays:t.matchdays.map((d,i)=>i?d:{...d,fixtures:d.fixtures.map(f=>({...f,result:{homeGoals:0,awayGoals:8}}))})};
    const row=project([changed],memory.state.activity).rows[0];expect(row.closure.state).toBe("Cierre desactualizado");expect(row.closure.history).toHaveLength(1);
  });
  it("labels a champion under provisional rules as calculated, never as verified",()=>{
    const t=closureLeague(),row=project([{...t,competitionRules:{...t.competitionRules!,verification:{standings:"provisional",placements:"verified"}}}]).rows[0];
    expect(row.champion?.tier).toBe("calculated");expect(row.titleStatus).toContain("Calculado · reglamento pendiente");
    expect(row.closure.canConfirm).toBe(false);
  });
  it("unknown cup formats have no fabricated winner or final",()=>{
    const t={...closureCup(),knockoutStages:undefined},row=project([t]).rows[0];expect(row.champion).toBeUndefined();expect(row.closure.blockers.length).toBeGreaterThan(0);
  });
  it("known cup formats reuse the existing champion and runner-up",()=>{
    const t=closureCup(),row=project([t]).rows[0];expect(row.champion?.teamId).toBe(t.teams[0].id);expect(row.runner?.teamId).toBe(t.teams[2].id);
  });
  it("unresolved league ties are not awarded titles",()=>{
    const t=closureLeague(),row=project([{...t,matchdays:t.matchdays.map(d=>({...d,fixtures:d.fixtures.map(f=>({...f,result:{homeGoals:0,awayGoals:0}}))}))}]).rows[0];
    expect(row.champion).toBeUndefined();expect(row.closure.blockers.join(" ")).toContain("desempates");
  });
  it("resolved second-division outcomes supply promotions and relegations without new sporting rules",()=>{
    const t=divisionFixture("brasil"),memory=closureMemory([t]),completed=simulateChampionship(t,"pendingOnly",memory.repository,()=>.5).tournament;
    const view=project([completed]);expect(view.movements.filter(m=>m.mechanism.startsWith("Ascenso"))).toHaveLength(4);
    expect(view.movements.filter(m=>m.mechanism.startsWith("Descenso"))).toHaveLength(4);
    expect(view.movements.every(m=>m.source.includes("Proyección"))).toBe(true);
  });
  it("only explicit preparation records establish recorded division transitions",()=>{
    const upper={...closureLeague("upper"),competitionId:"brasileirao-serie-a"},lower={...closureLeague("lower"),competitionId:"brasileirao-serie-b"};
    const target={...edition(upper,2027),seasonPreparation:{schemaVersion:1 as const,sourceTournamentIds:[upper.id,lower.id],plannedParticipants:[],calendarReviews:[]}};
    const e=event(target,"season-created",{before:{upperId:upper.id,lowerId:lower.id},after:{tournamentIds:[target.id],promoted:[lower.teams[0].id],upperRelegated:[],lowerRelegated:[]}});
    expect(project([upper,lower,target]).movements.filter(m=>m.mechanism==="Ascenso registrado")).toEqual([]);
    const move=project([upper,lower,target],[e]).movements.find(m=>m.mechanism==="Ascenso registrado")!;
    expect(move.origin).toBe(lower.name);expect(move.destination).toBe(target.name);expect(move.source).toContain(e.id);
  });
  it("missing movement references remain unresolved instead of matching names",()=>{
    const t=closureLeague(),e=event(t,"season-created",{before:{lowerId:"missing"},after:{tournamentIds:[t.id],promoted:["absent"],upperRelegated:[],lowerRelegated:[]}});
    const m=project([t],[e]).movements.find(m=>m.mechanism==="Ascenso registrado")!;expect(m.origin).toContain("no resuelto");expect(m.club).toContain("no resuelta");
  });
  it("continental qualification does not manufacture participation",()=>{
    const t=closureLeague(),cup={...closureCup(),competitionId:"conmebol-libertadores",matchdays:[]};
    const view=project([t,cup]);expect(view.yearbooks[0].counts.qualifications).toBe(2);expect(view.yearbooks[0].counts.participants).toBe(0);
    expect(view.rows.find(r=>r.tournament.id===cup.id)!.participation.every(p=>!p.scheduled)).toBe(true);
  });
  it("provisional international places stay provisional",()=>{
    const t=closureLeague(),view=project([{...t,competitionRules:{...t.competitionRules!,internationalQualification:{...t.competitionRules!.internationalQualification!,verification:"provisional"}}}]);
    expect(view.rows[0].closure.international?.entries.some(e=>e.status!=="confirmed")).toBe(true);expect(view.yearbooks[0].counts.qualifications).toBe(0);
  });
  it("keeps qualifying-round slots when they are the only placement rule",()=>{
    const base=closureLeague(),t={...base,competitionRules:{...base.competitionRules!,internationalQualification:undefined},placementRules:{libertadoresQualifyingPlaces:{from:1,to:1}}};
    expect(project([t]).rows[0].qualification?.entries).toHaveLength(1);
  });
  it("orders activity by original timestamps, keeps administrative type, and never treats import dates as editions",()=>{
    const t={...closureLeague(),season:undefined},a=event(t,"tournament-imported",{occurredAt:"2030-01-01T00:00:00.000Z"}),b=event(t,"matches-simulated",{occurredAt:"2025-01-01T00:00:00.000Z",imported:true});
    const view=project([t],[a,b]);expect(view.events.map(e=>e.event.id)).toEqual([b.id,a.id]);expect(view.events[1].kind).toBe("Administrativo");expect(view.events.every(e=>e.year===undefined)).toBe(true);
  });
  it("missing activity is not synthesized and deleted-season references stay visible in the legacy scope",()=>{
    const t=closureLeague(),orphan=event({...t,id:"missing"},"tournament-deleted");expect(project([t]).events).toEqual([]);
    expect(project([t],[orphan]).events[0].origin).toBeUndefined();
  });
  it("homonymous clubs with different registered IDs remain separate",()=>{
    const view=project([closureLeague("one"),closureLeague("two")]);expect(view.profiles.filter(p=>p.names.includes("Alfa"))).toHaveLength(2);
  });
  it("similar competition names do not create a historical relationship",()=>{
    const a=closureLeague("one"),b=edition(closureLeague("two"),2025),view=project([a,b]);expect(view.evolution).toEqual([]);
  });
  it("all filters intersect while club selection uses registered identity",()=>{
    const t={...closureLeague(),competitionId:"anfp-liga-primera"},other={...edition(closureLeague("other"),2025),competitionId:"brasileirao-serie-a"};
    const view=project([t,other]),club=view.profiles.find(p=>p.occurrences.some(o=>o.tournament.id===t.id && o.team.id===t.teams[0].id))!;
    const filtered=projectHistoricalArchive([t,other],[],empty,{year:"2026",country:"Chile",confederation:"CONMEBOL",category:"Primera",type:"Liga",provenance:"provider",competition:t.competitionId,club:club.key,search:"ALFA",closure:"Lista para revisión final"});
    expect(filtered.selected.map(r=>r.tournament.id)).toEqual([t.id]);expect(projectHistoricalArchive([t],[],empty,{country:"Brasil",search:"Alfa"}).selected).toEqual([]);
  });
  it("universes scope tournaments, ambiguous club IDs, events and absent dependencies before projecting",()=>{
    const a=closureLeague("a"),b={...a,id:"b",name:"Secret other universe"},library:SportsUniverseLibrary={version:1,activeUniverseId:"u",universes:[{id:"u",name:"One"},{id:"v",name:"Two"}],assignments:{a:"u",b:"v"}};
    const own={...a,seasonPreparation:{schemaVersion:1 as const,sourceTournamentIds:["b"],plannedParticipants:[],calendarReviews:[]}};
    const view=project([own,b],[event(b,"matches-simulated",{universeId:"v"})],library);
    expect(view.rows).toHaveLength(1);expect(view.rows[0].origins[0].tournament).toBeUndefined();expect(view.events).toEqual([]);expect(view.profiles).toHaveLength(4);
    expect(project([own,b],[],{...library,activeUniverseId:"v"}).rows[0].tournament.id).toBe("b");
  });
  it("the unassigned legacy library excludes assigned seasons and their events",()=>{
    const a=closureLeague("a"),b=closureLeague("b"),lib:SportsUniverseLibrary={version:1,activeUniverseId:null,universes:[{id:"u",name:"One"}],assignments:{b:"u"}};
    expect(project([a,b],[event(a,"tournament-created"),event(b,"matches-simulated")],lib).selected.map(r=>r.tournament.id)).toEqual([a.id]);
    expect(project([a,b],[event(b,"matches-simulated")],lib).events).toEqual([]);
  });
  it("evolution uses the existing comparison and explicit identities, never name-based joins",()=>{
    const t=closureLeague(),previous=edition(t,2025),view=project([t,previous]);expect(view.evolution).toHaveLength(1);expect(view.evolution[0].appeared).toEqual([]);
    expect(view.evolution[0].compatible).toBe(true);
    const other=edition({...closureLeague("other"),competitionId:t.competitionId},2025);expect(project([t,other]).evolution[0].appeared).toHaveLength(4);
  });
  it("multiple versions of an edition cannot be automatically compared",()=>{
    const t=closureLeague(),old=edition(t,2025);expect(project([t,old,{...old,id:"duplicate"}]).evolution.every(e=>!e.compatible)).toBe(true);
  });
  it("unknown formats or points differences explain non-comparable editions",()=>{
    const t=closureLeague(),old={...edition(t,2025),pointsSystem:{win:2,draw:1,loss:0}},view=project([t,old]);expect(view.evolution[0].compatible).toBe(false);expect(view.evolution[0].reason).toContain("puntos");
  });
  it("consultation uses no randomness or writes and preserves JSON v7 and all activity",()=>{
    const t=closureLeague(),events=[event(t,"matches-simulated")],before=JSON.stringify([t,events]),random=vi.spyOn(Math,"random");
    const view=project([t],events);expect(view.rows[0].provenance).toBe("local");expect(random).not.toHaveBeenCalled();expect(JSON.stringify([t,events])).toBe(before);
    const backup=createTournamentBackup([t],()=>new Date("2026-07-01T00:00:00.000Z"),events);expect(backup.version).toBe(7);const parsed=parseTournamentBackupWithActivity(JSON.stringify(backup));
    expect(project(parsed.tournaments,parsed.activity).yearbooks[0].counts.champions).toBe(1);
  });
});

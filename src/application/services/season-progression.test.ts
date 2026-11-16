import {it,expect} from "vitest";
import {projectSeasonProgression} from "./season-progression";
import {continentalLeague} from "../../test-utils/continental-qualification-fixtures";
it("does not invent links between selected names, years or divisions",()=>{
 const a=continentalLeague(),b={...a,id:"second",name:"Segunda",season:2027};
 const before=JSON.stringify([a,b]);
 const p=projectSeasonProgression([a.id,b.id],[a,b],[]);
 expect(p.dependencies).toEqual([]);expect(p.rows).toHaveLength(2);
 expect(JSON.stringify([a,b])).toBe(before);
});
it("allows partial progress and blocks missing calendars independently",()=>{
 const a=continentalLeague(),b={...a,id:"empty",matchdays:[]};
 const p=projectSeasonProgression([a.id,b.id],[a,b],[]);
 expect(p.rows[0].stages[0]).toBe("Disponible");
 expect(p.rows[1].stages[0]).toBe("Bloqueada");
 expect(p.rows[1].stages[6]).toBe("Bloqueada");
});
it("preserves missing explicit references and reports unavailable selections",()=>{
 const a=continentalLeague(),b={...a,id:"next",season:2027,seasonPreparation:{schemaVersion:1 as const,sourceTournamentIds:[a.id,"missing"],plannedParticipants:[],calendarReviews:[]}};
 const p=projectSeasonProgression(["next","deleted"],[a,b],[]);
 expect(p.dependencies.map(d=>d.sourceId)).toContain("missing");
 expect(p.rows[0].reasons.join(" ")).toContain("Dependencia no disponible: missing");
 expect(p.rows[0].stages[4]).toBe("Bloqueada");expect(p.missingIds).toEqual(["deleted"]);
 expect(projectSeasonProgression([a.id],[a,b],[]).rows[0].successors).toEqual([b]);
});

it("uses international cup references and registered national admission criteria",()=>{
 const a=continentalLeague();
 const target={...a,id:"cup",competitionRules:{...a.competitionRules!,internationalQualification:{verification:"verified" as const,slots:[],...a.competitionRules?.internationalQualification,cupChampions:[{sourceTournamentId:"winner-source",destination:"Libertadores"}]}},
 nationalCupPlanning:{schemaVersion:1 as const,regulations:[{id:"reg",at:a.createdAt,competitionId:"cup",edition:2027,verification:"verified" as const,note:"Documented",expectedParticipants:1,
 criteria:[{id:"admit",kind:"division" as const,description:"Origen registrado",verification:"verified" as const,count:1,sourceTournamentId:a.id}]}],reviews:[]}};
 const p=projectSeasonProgression([target.id],[a,target],[]);
 expect(p.dependencies).toEqual(expect.arrayContaining([
 expect.objectContaining({sourceId:a.id,targetId:"cup",reason:"Admisión nacional: Origen registrado"}),
 expect.objectContaining({sourceId:"winner-source",targetId:"cup"})]));
 expect(p.rows[0].stages[2]).toBe("Bloqueada");
});
it("keeps unresolved standings decisions pending after all scheduled matches",()=>{
 const a=continentalLeague(),drawn={...a,matchdays:a.matchdays.map(d=>({...d,fixtures:d.fixtures.map(f=>({...f,result:{homeGoals:0,awayGoals:0}}))}))};
 const row=projectSeasonProgression([a.id],[drawn],[]).rows[0];
 expect(row.stages[0]).toBe("Disponible");expect(row.stages[1]).toBe("Pendiente");
 expect(row.reasons.join(" ")).toContain("Desempate de tabla pendiente");
});

it("continues only explicitly derived editions and checks their own preparation",()=>{
 const source=continentalLeague();
 const next={...source,id:"next",season:2027,matchdays:[],seasonPreparation:{schemaVersion:1 as const,sourceTournamentIds:[source.id],plannedParticipants:source.teams.map(t=>t.name),calendarReviews:[]}};
 const row=projectSeasonProgression([source.id],[source,next],[]).rows[0];
 expect(row.successors).toEqual([next]);expect(row.stages[4]).toBe("Disponible");
 expect(row.stages[5]).toBe("Pendiente");expect(row.stages[6]).toBe("Bloqueada");
 expect(projectSeasonProgression([source.id],[source],[]).rows[0].stages[6]).toBe("Bloqueada");
});

it("recognizes incorporated continental editions without claiming documentary reviews as creations",()=>{
 const source=continentalLeague();
 const plan={schemaVersion:1 as const,id:"plan",at:source.createdAt,cup:"libertadores" as const,edition:2027,qualifyingSeason:2026,sourceTournamentIds:[source.id],dependencies:[],entries:[],sourceUrl:"https://example.com/reference",note:"Local planning",mode:"incorporated" as const};
 const cup={...source,id:"continental",season:2027,continentalPlans:[plan]};
 const reviewed={...cup,id:"review-only",continentalPlans:[{...plan,mode:"review" as const}]};
 const p=projectSeasonProgression([source.id],[source,cup,reviewed],[]);
 expect(p.rows[0].successors).toEqual([cup]);
 expect(p.dependencies.some(d=>d.sourceId===source.id && d.targetId===reviewed.id)).toBe(true);
});

it("allows starting a configured derived season with matches still pending",()=>{
 const source=continentalLeague();
 const next={...source,id:"next-ready",season:2027,competitionRules:{...source.competitionRules!,season:2027},seasonPreparation:{schemaVersion:1 as const,sourceTournamentIds:[source.id],plannedParticipants:source.teams.map(t=>t.name),calendarReviews:[]},matchdays:source.matchdays.map(d=>({...d,fixtures:d.fixtures.map(f=>({...f,result:undefined}))}))};
 const row=projectSeasonProgression([source.id],[source,next],[]).rows[0];
 expect(row.stages[5]).toBe("Disponible");expect(row.stages[6]).toBe("Disponible");
 expect(projectSeasonProgression([next.id],[source,next],[]).rows[0].stages[0]).toBe("Pendiente");
});

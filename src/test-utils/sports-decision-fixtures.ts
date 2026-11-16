import {divisionFixture} from "../domain/services/second-division-test-fixtures";
import {advanceSecondDivision,getOfficialResolutionContexts} from "../domain/services/second-division-progression";
import type {RecordOfficialResolutionInput} from "../application/use-cases/record-official-resolution";
/** Synthetic scores and clubs; the native 2026 AFA mechanism supplies the context. */
export function decisionTie(){
 const source=divisionFixture("argentina");
 return advanceSecondDivision({...source,name:"Temporada sintética de decisiones",matchdays:source.matchdays.map(day=>day.number>=35?{...day,fixtures:day.fixtures.map(f=>({...f,result:{homeGoals:0,awayGoals:0}}))}:day)});
}
export function decisionInput(t=decisionTie()):RecordOfficialResolutionInput{
 const context=getOfficialResolutionContexts(t).find(c=>c.scope==="argentina-seeding")!;
 return {context,verification:"verified",verifiedByUser:true,source:{url:"https://www.afa.com.ar/boletines",reference:"Acta sintética de pruebas, no publicación deportiva real"},orderedTeamIds:[...context.participantIds].reverse()};
}

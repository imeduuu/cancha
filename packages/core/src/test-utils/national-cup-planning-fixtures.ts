import {advanceOfficialCupProgression} from "../domain/services/official-cup-progression";
import {continentalLeague} from "./continental-qualification-fixtures";
import {nationalCup} from "./journey-competition-fixtures";
import type {NationalCupRegulationInput} from "../application/use-cases/register-national-cup-regulation";
export function cupPlanningFixture(){
 const league=continentalLeague(),base=nationalCup("argentina"),cup={...advanceOfficialCupProgression({...base,competitionId:"afa-copa-argentina"}),competitionId:"afa-copa-argentina"};
 const input:NationalCupRegulationInput={edition:2027,verification:"verified",sourceUrl:"https://www.afa.com.ar/documento-sintetico",note:"Disposición sintética de pruebas para esta edición; no es un reglamento real.",expectedParticipants:4,
 criteria:[{id:"division",kind:"division",description:"Nómina completa expresamente prevista",verification:"verified",sourceUrl:"https://www.afa.com.ar/anexo-sintetico",count:4,sourceTournamentId:league.id,sourceCompetitionId:league.competitionId!,sourceSeason:2026}]};
 return {league,cup,input};
}

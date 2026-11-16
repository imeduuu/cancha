import type { Tournament } from "../domain/entities/tournament";
import { generateRoundRobinSchedule } from "../domain/services/round-robin-scheduler";
export function continentalLeague(id="national-2026"): Tournament {
  const teams=["Alfa","Beta","Gamma","Delta"].map((name,i) => ({id:`${id}-${i}`,name}));
  return {id,competitionId:`national-${id}`,name:"Liga nacional de prueba",season:2026,createdAt:"2026-01-01T00:00:00.000Z",
    sourceUrl:"https://www.espn.com/", sourceName:"ESPN", teams,legs:1,tieBreakers:["goalDifference","goalsFor"],importCoverage:"complete",
    matchdays:generateRoundRobinSchedule(teams,1).map(day => ({...day,fixtures:day.fixtures.map(f => ({...f,result:{homeGoals:teams.findIndex(t=>t.id===f.homeTeamId)<teams.findIndex(t=>t.id===f.awayTeamId)?2:0,awayGoals:teams.findIndex(t=>t.id===f.homeTeamId)<teams.findIndex(t=>t.id===f.awayTeamId)?0:2}}))})),
    competitionRules:{season:2026,verification:{standings:"verified",placements:"verified"},internationalQualification:{verification:"verified",slots:[{destination:"conmebol-libertadores",position:1},{destination:"conmebol-sudamericana",position:2}]}}};
}

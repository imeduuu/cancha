import type {Tournament,Matchday} from "../../domain/entities/tournament";
import type {Team} from "../../domain/entities/team";
import type {ActivityEvent} from "../../domain/entities/activity-event";
import {calculateStandings,type TeamStanding} from "../../domain/services/standings";
import {clubHistoryScopes,type ClubProfile,type ClubHistoryScope} from "./club-history";
import {competitionIdentity} from "./competition-center";
import {honoursCompatibility,isCompleteClubScope} from "./club-honours";
import {sourceScenario} from "./continental-projection";

export interface PerformanceRow {tournament:Tournament;team:Team;scope:ClubHistoryScope;complete:boolean;scenario:ReturnType<typeof sourceScenario>;compatibility:string}
export function clubPerformanceRows(profile:ClubProfile,tournaments:readonly Tournament[],activity:readonly ActivityEvent[]){
 if(profile.warning)return {rows:[] as PerformanceRow[],error:"Identidad ambigua: no se atribuye rendimiento ni se comparan registros contradictorios."};
 const rows=tournaments.flatMap(t=>{
  const occurrence=profile.occurrences.find(o=>o.tournament.id===t.id),team=t.teams.find(team=>team.id===occurrence?.team.id);
  return team?clubHistoryScopes(t,team,activity).map(scope=>({tournament:t,team,scope,complete:isCompleteClubScope(t,scope),scenario:sourceScenario(t,activity),compatibility:JSON.stringify([scope.compatibility,honoursCompatibility(t,activity)])})):[];
 });
 rows.sort((a,b)=>(a.tournament.season ?? Number.MAX_SAFE_INTEGER)-(b.tournament.season ?? Number.MAX_SAFE_INTEGER) || a.scope.key.localeCompare(b.scope.key));
 return {rows};
}
export function goalAverages(metrics:TeamStanding){
 return {for:metrics.played?metrics.goalsFor/metrics.played:undefined,against:metrics.played?metrics.goalsAgainst/metrics.played:undefined};
}
function scopeDays(row:PerformanceRow){
 return row.tournament.matchdays.filter(d=>d.phaseName===row.scope.phaseName);
}
function clubTable(row:PerformanceRow,days:readonly Matchday[]){
 // Keep the entire original calendar for validating return-leg aggregate results.
 return calculateStandings({...row.tournament,teams:[row.team],matchdays:days},row.tournament.matchdays)[0];
}
export function performanceDetail(row:PerformanceRow){
 const days=scopeDays(row);
 const home=clubTable(row,days.map(d=>({...d,fixtures:d.fixtures.filter(f=>f.homeTeamId===row.team.id)})));
 const away=clubTable(row,days.map(d=>({...d,fixtures:d.fixtures.filter(f=>f.awayTeamId===row.team.id)})));
 const ownDays=days.filter(d=>d.fixtures.some(f=>f.homeTeamId===row.team.id || f.awayTeamId===row.team.id));
 const groups=new Map<string,Matchday>();
 for(const day of ownDays){
  const key=JSON.stringify([day.leg,day.number]);
  const old=groups.get(key);groups.set(key,old?{...old,fixtures:[...old.fixtures,...day.fixtures]}:day);
 }
 const ordered=[...groups.values()].sort((a,b)=>a.leg-b.leg || a.number-b.number);
 const rounds=ordered.map((day,index)=>({key:JSON.stringify([day.leg,day.number]),label:`Rueda ${day.leg} · Jornada ${day.number}`,
  scheduled:day.fixtures.filter(f=>f.homeTeamId===row.team.id || f.awayTeamId===row.team.id).length,
  metrics:clubTable(row,[day]),cumulative:clubTable(row,ordered.slice(0,index+1))}));
 return {row,metrics:row.scope.metrics,averages:goalAverages(row.scope.metrics),home,away,rounds,
  // Only a final, verified order already recognised by the history service is graphed as a position.
  accreditedPosition:row.complete && row.scope.positionStatus==="Final calculada de la tabla"?row.scope.position:undefined};
}
export function comparePerformance(a:PerformanceRow,bProfile:ClubProfile,tournaments:readonly Tournament[],activity:readonly ActivityEvent[]){
 if(bProfile.warning)return {error:"Identidad ambigua: no se puede comparar este segundo club."};
 const b=clubPerformanceRows(bProfile,tournaments,activity).rows.find(row=>row.tournament.id===a.tournament.id && row.scope.compatibility===a.scope.compatibility);
 if(!b)return {error:"El segundo club no tiene una participación compatible en la misma temporada, fase y grupo."};
 if(a.team.id===b.team.id)return {error:"Selecciona dos clubes distintos para comparar rendimiento general."};
 if(a.compatibility!==b.compatibility)return {error:"Los formatos, reglas o procedencias no son comparables."};
 return {rows:[a,b]};
}
export function performanceEvolution(rows:readonly PerformanceRow[],selectedKeys:readonly string[]){
 if(!selectedKeys.length)return {rows:[] as PerformanceRow[],error:"Selecciona expresamente temporadas y fases para visualizar la evolución."};
 if(new Set(selectedKeys).size!==selectedKeys.length)return {rows:[] as PerformanceRow[],error:"Hay fuentes seleccionadas repetidas."};
 const selected=rows.filter(row=>selectedKeys.includes(row.scope.key));
 if(selected.length!==selectedKeys.length)return {rows:[] as PerformanceRow[],error:"Una participación seleccionada ya no está disponible. Revisa las fuentes."};
 if(selected.some(row=>row.tournament.season===undefined))return {rows:[] as PerformanceRow[],error:"La evolución entre temporadas necesita años explícitos; no se inventan fechas."};
 if(new Set(selected.map(row=>JSON.stringify([competitionIdentity(row.tournament),row.tournament.season]))).size!==selected.length)return {rows:[] as PerformanceRow[],error:"Hay versiones o fases duplicadas de un mismo año; elige una versión por temporada."};
 if(new Set(selected.map(row=>row.compatibility)).size!==1)return {rows:[] as PerformanceRow[],error:"La selección mezcla competiciones, fases, formatos, sistemas de puntos, reglamentos o escenarios incompatibles."};
 return {rows:[...selected].sort((a,b)=>a.tournament.season!-b.tournament.season!)};
}

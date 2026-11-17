import {canonical} from "../../domain/services/continental-plan";
import type {Tournament,Fixture,Matchday} from "../../domain/entities/tournament";
import type {ActivityEvent} from "../../domain/entities/activity-event";
import {calculateStandings} from "../../domain/services/standings";
import {isValidPlayedFixture} from "../../domain/services/tournament-statistics";
import {getOperationalMatchStatus,getOperationalStatusLabel} from "../../domain/services/match-operational-status";
import {fixtureInstant,maximumResultStreak} from "./result-streaks";
import type {ClubProfile} from "./club-history";
import {competitionIdentity} from "./competition-center";
import {sourceScenario} from "./continental-projection";
import {honoursCompatibility} from "./club-honours";

export interface H2HFilters {competition?:string;season?:string;venue?:""|"home"|"away";provenance?:""|"local"|"provider"|"unknown"}
export interface H2HMatch {key:string;tournament:Tournament;day:Matchday;fixture:Fixture;aId:string;bId:string;aHome:boolean;played:boolean;status:string;resultOrigin:string;scenario:ReturnType<typeof sourceScenario>;stamp?:number}
export function headToHeadMatches(a:ClubProfile,b:ClubProfile,tournaments:readonly Tournament[],activity:readonly ActivityEvent[],filters:H2HFilters={}){
 const rows:H2HMatch[]=[];
 if(a.key===b.key)return {rows,error:"Selecciona dos clubes distintos."};
 if(a.warning || b.warning)return {rows,error:"Identidad ambigua: no se atribuyen enfrentamientos hasta contar con relaciones inequívocas."};
 for(const t of tournaments){
  const aId=a.occurrences.find(o=>o.tournament.id===t.id)?.team.id,bId=b.occurrences.find(o=>o.tournament.id===t.id)?.team.id;
  const scenario=sourceScenario(t,activity);
  if(!aId || !bId || aId===bId || filters.competition && competitionIdentity(t)!==filters.competition
    || filters.season && String(t.season ?? "unknown")!==filters.season || filters.provenance && scenario!==filters.provenance)continue;
  for(const day of t.matchdays)for(const fixture of day.fixtures){
   const aHome=fixture.homeTeamId===aId;
   if(!(aHome && fixture.awayTeamId===bId || fixture.homeTeamId===bId && fixture.awayTeamId===aId)
    || filters.venue==="home" && !aHome || filters.venue==="away" && aHome)continue;
   const played=isValidPlayedFixture(t,day,fixture),stamp=fixtureInstant(fixture);
   rows.push({key:JSON.stringify([t.id,day.phaseName,day.leg,day.number,fixture.id,rows.length]),tournament:t,day,fixture,aId,bId,aHome,played,
    status:played?"Disputado":fixture.result?`Resultado no computable · ${getOperationalStatusLabel(getOperationalMatchStatus(fixture))}`:`Pendiente · ${getOperationalStatusLabel(getOperationalMatchStatus(fixture))}`,
    scenario,resultOrigin:resultOrigin(t,fixture,activity),...(stamp!==undefined?{stamp}:{})});
  }
 }
 rows.sort((x,y)=>(y.stamp ?? -Infinity)-(x.stamp ?? -Infinity) || (y.tournament.season ?? 0)-(x.tournament.season ?? 0) || x.key.localeCompare(y.key));
 return {rows};
}
const empty=()=>({played:0,wins:0,draws:0,losses:0,goalsFor:0,goalsAgainst:0});
/** Standings use only the selected fixtures, but validate return legs against the entire original calendar. */
function sumRows(rows:readonly H2HMatch[]){
 const a=empty(),b=empty();
 for(const id of new Set(rows.map(r=>r.tournament.id))){
  const own=rows.filter(r=>r.tournament.id===id),t=own[0].tournament;
  const fixtures=new Set(own.map(r=>r.fixture));
  const table=calculateStandings({...t,teams:t.teams.filter(team=>team.id===own[0].aId || team.id===own[0].bId),
   matchdays:t.matchdays.map(d=>({...d,fixtures:d.fixtures.filter(f=>fixtures.has(f))}))},t.matchdays);
  for(const [target,teamId] of [[a,own[0].aId],[b,own[0].bId]] as const){
   const row=table.find(r=>r.teamId===teamId)!;
   for(const key of Object.keys(target) as (keyof typeof target)[])target[key]+=row[key];
  }
 }
 return {a,b};
}
export function summarizeHeadToHead(rows:readonly H2HMatch[],selectedIds:readonly string[],tournaments:readonly Tournament[],activity:readonly ActivityEvent[]){
 if(!selectedIds.length)return {error:"Selecciona las temporadas que aportarán al acumulado; las copias no se suman automáticamente."};
 if(selectedIds.some(id=>!tournaments.some(t=>t.id===id)))return {error:"Una fuente seleccionada ya no está disponible. Revisa la selección."};
 const selected=tournaments.filter(t=>selectedIds.includes(t.id));
 if(new Set(selectedIds).size!==selectedIds.length)return {error:"La selección contiene fuentes duplicadas."};
 if(selected.length>1 && selected.some(t=>t.season===undefined))return {error:"No se acumulan varias fuentes con años desconocidos."};
 if(new Set(selected.map(t=>JSON.stringify([competitionIdentity(t),t.season]))).size!==selected.length)return {error:"Hay versiones duplicadas de una competición y temporada. Elige una sola."};
 if(new Set(selected.map(t=>honoursCompatibility(t,activity))).size!==1)return {error:"Las fuentes mezclan competiciones, formatos, reglas o escenarios incompatibles. Consúltalas por separado."};
 const chosen=rows.filter(r=>selectedIds.includes(r.tournament.id));
 const ids=chosen.map(r=>JSON.stringify([r.tournament.id,r.fixture.id]));
 if(new Set(ids).size!==ids.length)return {error:"Hay identidades de partido duplicadas; no se genera un acumulado ambiguo."};
 const totals=sumRows(chosen),home=sumRows(chosen.filter(r=>r.aHome)),away=sumRows(chosen.filter(r=>!r.aHome));
 const chronology=chosen.length>0 && chosen.every(r=>r.stamp!==undefined) && new Set(chosen.map(r=>r.stamp)).size===chosen.length;
 const streaks=chronology && chosen.every(r=>r.played) ? calculateStreaks(chosen):undefined;
 return {totals,home,away,rows:chosen,notCounted:chosen.filter(r=>!r.played).length,seasons:new Set(chosen.map(r=>r.tournament.id)).size,
  chronology,latest:chronology?[...chosen].filter(r=>r.played).sort((a,b)=>b.stamp!-a.stamp!).slice(0,5):[],streaks};
}
function calculateStreaks(rows:readonly H2HMatch[]){
 const differences=[...rows].sort((a,b)=>a.stamp!-b.stamp!).map(r=>{const score=r.fixture.result!;return (r.aHome?1:-1)*(score.homeGoals-score.awayGoals);});
 const a=maximumResultStreak(differences),b=maximumResultStreak(differences.map(delta=>-delta));
 return {winsA:a.wins,winsB:b.wins,unbeatenA:a.unbeaten,unbeatenB:b.unbeaten};
}

function resultOrigin(t:Tournament,f:Fixture,activity:readonly ActivityEvent[]){
 const records=activity.filter(e=>e.tournamentId===t.id && (e.action==="tournament-imported" || e.action==="matches-simulated" && e.after && typeof e.after==="object" && Object.prototype.hasOwnProperty.call(e.after,f.id) || e.action==="match-result-updated" && e.entityId===f.id)).sort((a,b)=>Date.parse(b.occurredAt)-Date.parse(a.occurredAt));
 const latest=records[0];
 if(!f.result || !latest || latest.action==="tournament-imported" || records[1] && Date.parse(records[1].occurredAt)===Date.parse(latest.occurredAt))return "Marcador sin trazabilidad individual suficiente";
 const after=latest.after;
 const snapshot=after && typeof after==="object" ? latest.action==="matches-simulated"?(after as Record<string,unknown>)[f.id]:(after as {result?:unknown}).result:undefined;
 if(canonical(snapshot)!==canonical(f.result))return "Marcador sin trazabilidad individual suficiente";
 if(latest.action==="matches-simulated"){
  const before=latest.before;
  if(!before || typeof before!=="object" || !Object.prototype.hasOwnProperty.call(before,f.id) || canonical((before as Record<string,unknown>)[f.id])===canonical(snapshot))return "Marcador sin trazabilidad individual suficiente";
  return "Simulado según actividad coincidente";
 }
 return "Editado manualmente según actividad coincidente";
}

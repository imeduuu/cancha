import {fixtureInstant,maximumResultStreak} from "./result-streaks";
import type { Tournament, KnockoutStage } from "../../domain/entities/tournament";
import type { ActivityEvent } from "../../domain/entities/activity-event";
import { calculateTournamentStatistics, isValidPlayedFixture } from "../../domain/services/tournament-statistics";
import { getFinalStandings, getTournamentCompletionStatus } from "../../domain/services/tournament-history";
import { getUnresolvedStandingsTieGroups } from "../../domain/services/standings";
import { getCompletedStageWinners } from "../../domain/services/official-cup-progression";
import { hasUnverifiedCompetitionRules } from "../../domain/services/competition-rules";
import { hasPendingAnnualRules } from "../../domain/services/season-preparation";
import { canonical } from "../../domain/services/continental-plan";
import { argentinaHalves, getArgentinaHalfChampions } from "../../domain/services/argentina-half-champions";
import { buildClubProfiles, clubHistoryScopes, clubOccurrenceKey, type ClubHistoryScope } from "./club-history";
import { competitionIdentity } from "./competition-center";
import { sourceScenario } from "./continental-projection";
import { unverifiedTier, type ChampionTier } from "./champion-tier";

export const provenanceLabels = {local:"Escenario local, editado o simulado",provider:"Proveedor sin certificación oficial",unknown:"Procedencia no acreditada"};
export { championTierLabels, championTierTitles, unverifiedTier, type ChampionTier } from "./champion-tier";
export interface Honour { teamId:string; label:string; tier?:ChampionTier }
export interface SeasonHonours {
 readonly awards:readonly Honour[];
 /** Reasons the outcome is not verified; with a tier they are accreditation notices, not sporting gaps. */
 readonly reasons:readonly string[];
 /** True only for verified outcomes (unchanged meaning). */
 readonly complete:boolean;
 /** Accreditation of the awards; undefined when no sporting outcome is determined. */
 readonly tier?:ChampionTier;
 /** Reasons that block even a simulated or calculated outcome. */
 readonly sportingReasons:readonly string[];
}
export const coverageReason="Cobertura incompleta o no acreditada.";
export const rulesReason="Reglamento pendiente, provisional o de otro año.";
const completionReason="Competición incompleta, clasificación pendiente o formato sin conclusión acreditada.";
const championReason="El servicio deportivo no determina un campeón: revisa desempates, resultados y formato.";

/** A read projection: sporting winners always come from the existing domain services. */
export function seasonHonours(t:Tournament,activity:readonly ActivityEvent[]=[]):SeasonHonours {
 const stats=calculateTournamentStatistics(t);
 // Reasons keep their historical order; each one is either an accreditation notice or a sporting gap.
 const tagged:{reason:string;sporting:boolean}[]=[];
 if(t.importCoverage==="partial" || t.importCoverage==="unknown")tagged.push({reason:coverageReason,sporting:t.importCoverage==="partial"});
 if(hasPendingAnnualRules(t) || hasUnverifiedCompetitionRules(t))tagged.push({reason:rulesReason,sporting:false});
 if(getTournamentCompletionStatus(t,"sporting")!=="Finalizado")tagged.push({reason:completionReason,sporting:true});
 if(!stats.sportingChampionTeamId)tagged.push({reason:championReason,sporting:true});
 if(t.competitionType==="cup")tagged.push(...cupStructureReasons(t).map(reason=>({reason,sporting:true})));
 const reasons=[...new Set(tagged.map(r=>r.reason))];
 const sportingReasons=[...new Set(tagged.filter(r=>r.sporting).map(r=>r.reason))];
 const accredited=!tagged.some(r=>!r.sporting);
 const tier:ChampionTier=accredited?"verified":unverifiedTier(t,activity);
 const halves=getArgentinaHalfChampions(t);
 // Half finals are self-contained: an Apertura champion exists before the Clausura is played.
 const halfAwards:Honour[]=argentinaHalves.flatMap(half=>halves[half]?[{teamId:halves[half]!,label:`Campeón del ${half}`,tier}]:[]);
 if(sportingReasons.length)
  return {awards:halfAwards,reasons,complete:false,sportingReasons,...(halfAwards.length?{tier}:{})};
 if(accredited && stats.championTeamId && getTournamentCompletionStatus(t)==="Finalizado")
  return {awards:[...halfAwards,...podium(t,stats.championTeamId,"verified","verified")],reasons:[],complete:true,tier:"verified",sportingReasons:[]};
 const unverified=accredited?unverifiedTier(t,activity):tier;
 return {awards:[...halfAwards,...podium(t,stats.sportingChampionTeamId!,unverified,"sporting")],reasons,complete:false,tier:unverified,sportingReasons:[]};
}
function podium(t:Tournament,champion:string,tier:ChampionTier,basis:"verified"|"sporting"):Honour[]{
 const awards:Honour[]=[{teamId:champion,label:"Campeón",tier}];
 const table=getFinalStandings(t,basis);
 if(table){
  const tied=new Set(getUnresolvedStandingsTieGroups(t,table).flatMap(g=>g.map(r=>r.teamId)));
  table.slice(1,4).forEach((row,i)=>{if(!tied.has(row.teamId))awards.push({teamId:row.teamId,label:i===0?"Subcampeón":`Posición destacada: ${i+2}.º`,tier});});
 }else if(t.competitionType==="cup" && t.knockoutStages?.length){
  const stage=t.knockoutStages[t.knockoutStages.length-1];
  const participants=stageParticipants(t,stage);
  if(participants.length===2 && participants.includes(champion)){
   awards.push({teamId:participants.find(id=>id!==champion)!,label:"Subcampeón",tier});
   participants.forEach(teamId=>awards.push({teamId,label:"Finalista",tier}));
   const semi=t.knockoutStages[t.knockoutStages.length-2];
   if(semi && semi.advanceWinners!==false){
    const ids=stageParticipants(t,semi),winners=getCompletedStageWinners(t.matchdays,semi);
    if(ids.length===4 && winners?.length===2 && winners.every(id=>participants.includes(id)))
     ids.forEach(teamId=>awards.push({teamId,label:"Semifinalista",tier}));
   }
  }
 }
 return awards;
}
function cupStructureReasons(t:Tournament):string[]{
 const reasons:string[]=[];
 const final=t.knockoutStages?.[t.knockoutStages.length-1];
 if(!final || !/(?:^| · )final$/i.test(final.name) || final.advanceWinners===false || stageParticipants(t,final).length!==2)
  reasons.push("No hay una final única de campeonato inequívocamente identificada.");
 const scheduledTeams=new Set(t.matchdays.flatMap(d=>d.fixtures.flatMap(f=>[f.homeTeamId,f.awayTeamId])));
 if(t.teams.some(team=>!scheduledTeams.has(team.id)))reasons.push("Hay participantes registrados sin encuentros: la cobertura de la copa no acredita su recorrido completo.");
 const stages=t.knockoutStages ?? [];
 for(let i=0;i<stages.length-1;i++){
  if(stages[i].advanceWinners===false)continue;
  const participants=stageParticipants(t,stages[i]),winners=getCompletedStageWinners(t.matchdays,stages[i]),next=stageParticipants(t,stages[i+1]);
  // Clubs may enter in later rounds (e.g. Libertadores preliminaries): winners must advance and losers must not.
  if(!winners || new Set(winners).size!==winners.length || winners.some(id=>!next.includes(id))
   || participants.some(id=>!winners.includes(id) && next.includes(id)))
   reasons.push("Los participantes de etapas consecutivas no coinciden con los ganadores resueltos.");
 }
 return reasons;
}
function stageParticipants(t:Tournament,s:KnockoutStage){
 return [...new Set(t.matchdays.filter(d=>d.phaseName===s.name || (s.legs===2 && (d.phaseName===`${s.name} · Ida` || d.phaseName===`${s.name} · Vuelta`)))
  .flatMap(d=>d.fixtures.flatMap(f=>[f.homeTeamId,f.awayTeamId])))];
}
export function isCompleteClubScope(t:Tournament,scope:ClubHistoryScope){
 return !hasPendingAnnualRules(t) && !hasUnverifiedCompetitionRules(t) && scope.coverage.startsWith("Calendario") && scope.metrics.played===scope.scheduled;
}
export function seasonRecordRows(t:Tournament,activity:readonly ActivityEvent[]=[]){
 return t.teams.flatMap(team=>clubHistoryScopes(t,team,activity).filter(scope=>scope.metrics.played>0).map(scope=>({tournament:t,team,scope,
  complete:isCompleteClubScope(t,scope),
  streaks:scopeStreaks(t,team.id,scope)})));
}
/** Only unique, fully specified instants for every fixture establish the chronological scope. */
function scopeStreaks(t:Tournament,teamId:string,scope:ClubHistoryScope):({wins:number;unbeaten:number;reason?:undefined}|{reason:string;wins?:undefined;unbeaten?:undefined}){
 const fixtures=t.matchdays.filter(d=>(d.phaseName ?? "Sin fase registrada")===scope.phase).flatMap(day=>day.fixtures
  .filter(f=>f.homeTeamId===teamId || f.awayTeamId===teamId).map(f=>({day,f})));
 const ordered=fixtures.map(({day,f})=>({day,f,stamp:fixtureInstant(f) ?? NaN}));
 if(!ordered.length || ordered.some(o=>!Number.isFinite(o.stamp) || !isValidPlayedFixture(t,o.day,o.f)) || new Set(ordered.map(o=>o.stamp)).size!==ordered.length)
  return {reason:"Rachas no disponibles: faltan resultados válidos u orden cronológico inequívoco con fecha, hora y zona."};
 return maximumResultStreak(ordered.sort((a,b)=>a.stamp-b.stamp).map(({f})=>{
  const r=f.result!;return (f.homeTeamId===teamId?1:-1)*(r.homeGoals-r.awayGoals);
 }));
}
export function seasonHighlights(rows:ReturnType<typeof seasonRecordRows>){
 const groups=new Map<string,typeof rows>();
 for(const row of rows){const key=JSON.stringify([row.scope.compatibility,row.complete]);groups.set(key,[...(groups.get(key) ?? []),row]);}
 return [...groups.values()].flatMap(group=>(["wins","points","goalsFor","goalsAgainst","goalDifference"] as const).flatMap(metric=>{
  if(metric==="points" && group[0].scope.kind!=="league")return [];
  const value=(metric==="goalsAgainst"?Math.min:Math.max)(...group.map(r=>r.scope.metrics[metric]));
  return [{metric,value,phase:group[0].scope.phase,group:group[0].scope.group,complete:group[0].complete,leaders:group.filter(r=>r.scope.metrics[metric]===value)}];
 }));
}
export const recordMetrics={titles:"Más títulos",wins:"Más victorias en una temporada",points:"Más puntos en una liga",goalsFor:"Más goles a favor",goalsAgainst:"Menos goles recibidos",goalDifference:"Mejor diferencia de goles",streakWins:"Racha de victorias",streakUnbeaten:"Racha invicta"} as const;
export type RecordMetric=keyof typeof recordMetrics;
export function honoursCompatibility(t:Tournament,activity:readonly ActivityEvent[]){
 return canonical({competition:competitionIdentity(t),format:t.format ?? "round-robin",type:t.competitionType ?? "league",legs:t.legs,
  teams:t.teams.length,stages:t.knockoutStages,points:t.pointsSystem ?? t.competitionRules?.points ?? {win:3,draw:1,loss:0},
  ties:t.tieBreakers,configuredTies:t.competitionRules?.tieBreakers,rules:t.competitionRules?.verification,scenario:sourceScenario(t,activity)});
}
export function historicalRecords(all:readonly Tournament[],selected:readonly Tournament[],activity:readonly ActivityEvent[],metric:RecordMetric,scopeKey:string,partial=false){
 const rows:{profileKey:string;name:string;value:number;tournament:Tournament;teamId:string}[]=[];
 if(!selected.length)return {rows,error:"Selecciona temporadas expresamente; no se suman automáticamente."};
 if(selected.some(t=>t.season===undefined))return {rows,error:"Falta un año explícito en la selección."};
 if(new Set(selected.map(t=>t.season)).size!==selected.length)return {rows,error:"Temporadas duplicadas: elige una versión por año."};
 if(new Set(selected.map(t=>honoursCompatibility(t,activity))).size!==1)return {rows,error:"La selección mezcla competiciones, formatos, sistemas de puntos, reglamentos o escenarios incompatibles."};
 const profiles=buildClubProfiles(all),byOccurrence=new Map(profiles.flatMap(p=>p.occurrences.map(o=>[o.key,p] as const)));
 for(const t of selected){
  if(metric==="titles"){
   for(const award of seasonHonours(t).awards.filter(a=>a.label==="Campeón")){
    const profile=byOccurrence.get(clubOccurrenceKey(t.id,award.teamId))!;
    rows.push({profileKey:profile.key,name:t.teams.find(team=>team.id===award.teamId)!.name,value:1,tournament:t,teamId:award.teamId});
   }
  }else for(const row of seasonRecordRows(t,activity)){
   if(row.scope.compatibility!==scopeKey || row.complete===partial || metric==="points" && row.scope.kind!=="league")continue;
   const value=metric==="streakWins"?row.streaks.wins:metric==="streakUnbeaten"?row.streaks.unbeaten:row.scope.metrics[metric];
   if(value===undefined)continue;
   const profile=byOccurrence.get(clubOccurrenceKey(t.id,row.team.id))!;
   rows.push({profileKey:profile.key,name:row.team.name,value,tournament:t,teamId:row.team.id});
  }
 }
 // Trophies accumulate only inside the explicitly selected, compatible scope; other records remain per season.
 const ranked=metric==="titles" ? [...new Set(rows.map(r=>r.profileKey))].map(key=>{
  const own=rows.filter(r=>r.profileKey===key);return {...own[0],value:own.length,sources:own.map(r=>r.tournament)};
 }):rows.map(r=>({...r,sources:[r.tournament]}));
 ranked.sort((a,b)=>metric==="goalsAgainst"?a.value-b.value:b.value-a.value);
 return {rows:ranked,seasons:selected.length,participatingSeasons:new Set(rows.map(r=>r.tournament.id)).size,creditedSeasons:metric==="titles"?selected.filter(t=>seasonHonours(t).complete).length:undefined};
}

import type {Tournament} from "../../domain/entities/tournament";
import type {ActivityEvent} from "../../domain/entities/activity-event";
import {seasonOverview,seasonOrigins} from "./competition-center";
import {nationalContinentalProjection,continentalPlanState} from "./continental-projection";
import {nationalCupReviewState} from "./national-cup-planning";
import {getCompetitionAlerts} from "../../domain/services/competition-alerts";

import {calculateStandings,getUnresolvedStandingsTieGroups} from "../../domain/services/standings";
export const progressionStages = [
 "Completar partidos y resultados",
 "Resolver desempates, eliminatorias y decisiones pendientes",
 "Determinar clasificaciones y movimientos deportivos",
 "Revisar participantes de próximas temporadas",
 "Preparar las nuevas ediciones",
 "Importar calendarios y configurar reglamentos aplicables",
 "Continuar con las nuevas temporadas",
] as const;
export type ProgressionState = "Disponible" | "Pendiente" | "Bloqueada";
export interface ProgressionDependency {sourceId:string;targetId:string;reason:string}
/** Read model only: selecting records never creates a sporting relationship or writes data. */
export function projectSeasonProgression(ids:readonly string[], tournaments:readonly Tournament[], activity:readonly ActivityEvent[]) {
 const dependencies:ProgressionDependency[]=[];
 const add=(sourceId:string,targetId:string,reason:string)=>{
  if(!dependencies.some(d=>d.sourceId===sourceId && d.targetId===targetId && d.reason===reason))dependencies.push({sourceId,targetId,reason});
 };
 for(const t of tournaments){
  for(const id of seasonOrigins(t,activity))add(id,t.id,"Origen de temporada registrado");
  for(const c of t.competitionRules?.internationalQualification?.cupChampions ?? [])add(c.sourceTournamentId,t.id,"Campeón de copa referenciado para cupos internacionales");
  for(const p of t.continentalPlans ?? []){for(const id of p.sourceTournamentIds)add(id,t.id,"Origen continental registrado");for(const d of p.dependencies)add(d.tournamentId,t.id,"Dependencia continental registrada");}
  for(const r of t.nationalCupPlanning?.regulations ?? [])for(const c of r.criteria)if(c.sourceTournamentId)add(c.sourceTournamentId,t.id,`Admisión nacional: ${c.description}`);
  for(const r of t.nationalCupPlanning?.reviews ?? [])for(const d of r.dependencies)add(d.tournamentId,t.id,"Dependencia de revisión nacional");
 }
 const selected=new Set(ids);
 const rows=tournaments.filter(t=>selected.has(t.id)).map(t=>{
  const overview=seasonOverview(t,activity);
  const international=t.competitionRules?.internationalQualification?nationalContinentalProjection(t,tournaments,activity):undefined;
  const alerts=getCompetitionAlerts(t);
  const related=dependencies.filter(d=>d.targetId===t.id);
  const missing=related.filter(d=>!tournaments.some(s=>s.id===d.sourceId));
  const stale=(t.continentalPlans ?? []).some(p=>continentalPlanState(p,tournaments,activity).startsWith("Desactualizada"))
   || (t.nationalCupPlanning?.reviews ?? []).some(r=>nationalCupReviewState(r,tournaments,activity)==="Dependencia desactualizada");
  const results=overview.total>0 && overview.played===overview.total;
  const ties=results && t.competitionType!=="cup" && t.format!=="staged" && t.matchdays.every(d=>!d.phaseName) && !t.teams.some(team=>team.groupName) ? getUnresolvedStandingsTieGroups(t,calculateStandings(t)) : [];
  const decisions=alerts.filter(a=>a.type==="knockout-pending").map(a=>a.description);
  const reasons=[...new Set([...overview.pending,...decisions,...(ties.length?["Desempate de tabla pendiente: revisa las resoluciones oficiales."]:[]),...(international?.reasons ?? []),
   ...missing.map(d=>`Dependencia no disponible: ${d.sourceId}`),...(stale?["Dependencia desactualizada: vuelve a revisar la planificación."]:[])])];
  const ready=overview.status==="Finalizado" && !reasons.length;
  const successors=tournaments.filter(next=>seasonOrigins(next,activity).includes(t.id) || next.continentalPlans?.some(p=>p.mode==="incorporated" && p.sourceTournamentIds.includes(t.id)));
  const configured=successors.some(next=>{const state=seasonOverview(next,activity);return !dependencies.some(d=>d.targetId===next.id && !tournaments.some(source=>source.id===d.sourceId)) && state.total>0 && next.competitionRules?.season===next.season && next.competitionRules?.verification.standings==="verified" && next.competitionRules?.verification.placements==="verified" && !getCompetitionAlerts(next).some(a=>["calendar-incomplete","regulations-review","invalid-match"].includes(a.type)) && !(next.continentalPlans ?? []).some(p=>continentalPlanState(p,tournaments,activity).startsWith("Desactualizada")) && !(next.nationalCupPlanning?.reviews ?? []).some(r=>nationalCupReviewState(r,tournaments,activity)==="Dependencia desactualizada");});
  const stages:ProgressionState[]=[
   overview.total===0?"Bloqueada":results?"Disponible":"Pendiente",
   !results?"Bloqueada":decisions.length || ties.length || overview.pending.length?"Pendiente":"Disponible",
   !results || missing.length || stale?"Bloqueada":ready?"Disponible":"Pendiente",
   missing.length || stale?"Bloqueada":successors.length?"Disponible":"Pendiente",
   successors.length || ready?"Disponible":"Bloqueada",
   !successors.length?"Bloqueada":configured?"Disponible":"Pendiente",
   configured?"Disponible":"Bloqueada",
  ];
  return {tournament:t,overview,international,reasons,successors,stages};
 });
 const related=dependencies.filter(d=>selected.has(d.sourceId) || selected.has(d.targetId));
 const historyIds=new Set([...ids,...rows.flatMap(r=>r.successors.map(t=>t.id))]);
 return {rows,dependencies:related,missingIds:[...selected].filter(id=>!tournaments.some(t=>t.id===id)),
  events:activity.filter(e=>historyIds.has(e.tournamentId) || e.action==="season-created" && !!e.after && typeof e.after==="object" && "tournamentIds" in e.after && Array.isArray(e.after.tournamentIds) && e.after.tournamentIds.some(id=>typeof id==="string" && historyIds.has(id)))};
}

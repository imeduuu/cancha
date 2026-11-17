import type {Tournament} from "../../domain/entities/tournament";
import type {ActivityEvent} from "../../domain/entities/activity-event";
import {hasUnverifiedCompetitionRules} from "../../domain/services/competition-rules";
import {seasonOrigins} from "./competition-center";
import {continentalPlanState} from "./continental-projection";
import {nationalCupReviewState} from "./national-cup-planning";
/** Eligibility of the current edition, distinct from unresolved places for a future edition. */
export function sportsDecisionEligibility(t:Tournament,tournaments:readonly Tournament[],activity:readonly ActivityEvent[]){
 const rules:string[]=[],dependencies:string[]=[],operations:string[]=[];
 if(!t.competitionRules || t.competitionRules.season!==t.season || hasUnverifiedCompetitionRules(t))rules.push("Falta un reglamento anual coherente y verificado de tabla y decisiones deportivas.");
 if(t.matchRegulations && (t.matchRegulations.season!==t.season || t.matchRegulations.verification!=="verified"))rules.push("El reglamento de partidos registrado está pendiente o corresponde a otra edición.");
 if(t.archived)operations.push("La temporada está archivada. Revisa su estado en la biblioteca antes de registrar decisiones.");
 const ids=new Set([...seasonOrigins(t,activity),...(t.continentalPlans ?? []).flatMap(p=>p.dependencies.map(d=>d.tournamentId)),...(t.nationalCupPlanning?.reviews ?? []).flatMap(r=>r.dependencies.map(d=>d.tournamentId))]);
 for(const id of ids)if(!tournaments.some(source=>source.id===id))dependencies.push(`Dependencia de esta edición no disponible en el universo activo: ${id}.`);
 for(const plan of t.continentalPlans ?? [])if(plan.requiresReview || continentalPlanState(plan,tournaments,activity).startsWith("Desactualizada") || plan.mode==="incorporated" && plan.entries.some(e=>e.status!=="confirmed"))dependencies.push("La admisión continental de esta edición requiere revisión de sus fundamentos.");
 if(t.nationalCupPlanning?.requiresReview)dependencies.push("La admisión nacional de esta edición requiere revisión documental.");
 for(const review of t.nationalCupPlanning?.reviews ?? [])if(nationalCupReviewState(review,tournaments,activity)==="Dependencia desactualizada" || review.mode==="incorporated" && review.participants.some(p=>p.status!=="confirmed"))dependencies.push("La admisión nacional de esta edición conserva fundamentos desactualizados o participantes provisionales.");
 return {rules,dependencies:[...new Set(dependencies)],operations,allowed:!rules.length && !dependencies.length && !operations.length};
}

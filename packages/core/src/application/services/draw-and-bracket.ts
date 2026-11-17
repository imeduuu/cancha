import {projectTournamentAffiliations} from "./club-associations";
import type {Tournament,Matchday} from "../../domain/entities/tournament";
import type {ActivityEvent} from "../../domain/entities/activity-event";
import {isStageDrawRecord} from "../../domain/entities/stage-draw";
import {canonical} from "../../domain/services/continental-plan";
import {getCalendarProgrammingBlockers} from "../use-cases/program-season-calendar";
import {validateTournamentIntegrity} from "../../domain/services/tournament-integrity";
import {getCompletedStageWinners} from "../../domain/services/official-cup-progression";
import {isValidPlayedFixture} from "../../domain/services/tournament-statistics";
import {calculateStandings,getUnresolvedStandingsTieGroups} from "../../domain/services/standings";
import {continentalPlanState} from "./continental-projection";
import {nationalCupReviewState} from "./national-cup-planning";
import {advanceTournamentProgress} from "../use-cases/advance-tournament-progress";
import {seasonOrigins,competitionIdentity} from "./competition-center";
import {secondDivisionKind} from "../../domain/services/second-division-rules";
export const groupStageKey="@registered-groups";
export const stageDays=(t:Tournament,name:string)=>{const names=[name,`${name} · Ida`,`${name} · Vuelta`].map(value=>value.trim().toLocaleLowerCase("es"));return t.matchdays.filter(d=>names.includes((d.phaseName ?? "").trim().toLocaleLowerCase("es")));};
export function drawFoundation(t:Tournament,universeId:string|null,tournaments:readonly Tournament[],activity:readonly ActivityEvent[]) {
  const ids=new Set([t.id,...seasonOrigins(t,activity),...(t.continentalPlans ?? []).flatMap(p=>p.dependencies.map(d=>d.tournamentId)),...(t.nationalCupPlanning?.reviews ?? []).flatMap(r=>r.dependencies.map(d=>d.tournamentId))]);
  return canonical({tournament:t,universeId,dependencies:[...ids].sort().map(id=>tournaments.find(s=>s.id===id) ?? {missing:id}),
    activity:activity.filter(e=>ids.has(e.tournamentId) && !["stage-draw-confirmed","draw-configuration-recorded","association-recorded","club-affiliation-recorded","library-restored"].includes(e.action)).map(e=>({id:e.id,action:e.action,at:e.occurredAt}))});
}
/** The existing progression runs only against a transient adapter; it never writes the real repository. */
export function existingStageProposal(t:Tournament,tournaments:readonly Tournament[],stage:string):Matchday[] {
  const staged=new Map(tournaments.map(s=>[s.id,s]));
  const adapter={findAll:()=>[...staged.values()],save:(s:Tournament)=>{staged.set(s.id,s);}};
  const advanced=advanceTournamentProgress(t,adapter);
  const fixtures=new Map(advanced.matchdays.flatMap(d=>d.fixtures).map(f=>[f.id,f]));
  if(t.matchdays.flatMap(d=>d.fixtures).some(f=>canonical(fixtures.get(f.id))!==canonical(f)))throw new Error("La progresión alteraría encuentros existentes. Revisa sus dependencias en el flujo deportivo antes de preparar esta fase.");
  if(canonical(advanced.teams)!==canonical(t.teams))throw new Error("La progresión requiere incorporar participantes. Continúa en el flujo deportivo existente antes de preparar este cruce.");
  const proposed=stageDays(advanced,stage);
  if(!proposed.some(d=>d.fixtures.length))throw new Error("El servicio existente no acredita emparejamientos para esta fase; no se inventa un sorteo ni un orden de clasificación.");
  return proposed;
}
export function inspectDrawPreparation(t:Tournament,tournaments:readonly Tournament[],activity:readonly ActivityEvent[],universeId:string|null) {
  const blockers=[...getCalendarProgrammingBlockers(t,tournaments),...validateTournamentIntegrity(t)];
  if(t.archived)blockers.push("La temporada está archivada. Revisa su estado en la biblioteca antes de prepararla.");
  for(const plan of t.continentalPlans ?? [])if(plan.requiresReview || plan.entries.some(e=>e.status!=="confirmed") || continentalPlanState(plan,tournaments,activity).startsWith("Desactualizada"))blockers.push("La admisión continental no está definitivamente revisada.");
  for(const review of t.nationalCupPlanning?.reviews ?? [])if(review.participants.some(p=>p.status!=="confirmed") || nationalCupReviewState(review,tournaments,activity)==="Dependencia desactualizada")blockers.push("La admisión nacional está pendiente o desactualizada.");
  if(t.nationalCupPlanning?.requiresReview)blockers.push("La admisión nacional requiere revisión documental.");
  const groups=[...new Set(t.teams.flatMap(team=>team.groupName?[team.groupName]:[]))].map(name=>({name,teamIds:t.teams.filter(team=>team.groupName===name).map(team=>team.id)}));
  const history=activity.filter(e=>e.tournamentId===t.id && e.action==="stage-draw-confirmed" && isStageDrawRecord(e.after));
  const foundation=drawFoundation(t,universeId,tournaments,activity);
  const specifications=[...(groups.length?[{key:groupStageKey,name:"Grupos registrados",legs:t.legs,kind:"groups" as const}]:[]),
    ...(t.knockoutStages ?? []).map(stage=>({key:stage.name,name:stage.name,legs:stage.legs,kind:"knockout" as const}))];
  const stages=specifications.map(spec=>{
    const own=[...blockers];
    const days=spec.kind==="groups" ? t.matchdays.filter(d=>!t.knockoutStages?.some(s=>stageDays(t,s.name).includes(d))) : stageDays(t,spec.key);
    const fixtures=days.flatMap(d=>d.fixtures),played=days.reduce((n,d)=>n+d.fixtures.filter(f=>isValidPlayedFixture(t,d,f)).length,0);
    let participants=t.teams.map(team=>team.id);
    if(spec.kind==="groups") {
      if(t.teams.some(team=>!team.groupName) || groups.some(group=>group.teamIds.length<2))own.push("La distribución está incompleta: no hay capacidades registradas para asignar todas las plazas. No se deducen grupos ni bombos.");
      if(t.matchdays.some(d=>d.fixtures.length))own.push("Hay encuentros existentes. No se cambia su distribución de grupos ni se eliminan partidos.");
    } else {
      const index=t.knockoutStages!.findIndex(stage=>stage.name===spec.key),previous=t.knockoutStages![index-1];
      if(t.competitionType!=="cup" || t.format!=="staged")own.push("Las eliminatorias necesitan una copa por etapas registrada.");
      if(previous){
        participants=getCompletedStageWinners(t.matchdays,previous) ?? [];
        if(previous.advanceWinners===false || !participants.length || stageDays(t,previous.name).some(d=>d.fixtures.some(f=>!isValidPlayedFixture(t,d,f))))own.push("La fase anterior no acredita ganadores definitivos. Resuelve partidos y desempates en el flujo original.");
      }
      if(!previous && !groups.length && t.matchdays.some(day=>!t.knockoutStages!.some(s=>stageDays(t,s.name).includes(day))))own.push("Hay fases previas fuera de las eliminatorias registradas. Su clasificación debe acreditarse en el flujo específico antes de asignar participantes.");
      if(!participants.length || participants.length%2)own.push("No hay una lista par y definitiva de participantes para esta fase.");
      if(fixtures.length)own.push("La etapa ya tiene encuentros: se bloquea su reorganización, incluso sin resultados.");
    }
    // Never turn the continental service's display ordering into a definitive tiebreak.
    for(const group of groups){
      const scoped={...t,teams:t.teams.filter(team=>group.teamIds.includes(team.id)),matchdays:t.matchdays.filter(d=>d.fixtures.some(f=>group.teamIds.includes(f.homeTeamId) && group.teamIds.includes(f.awayTeamId)))};
      if(spec.kind==="knockout" && getUnresolvedStandingsTieGroups(scoped,calculateStandings(scoped)).length)own.push(`Desempates pendientes en el grupo ${group.name}.`);
    }
    const latest=[...history].reverse().find(e=>isStageDrawRecord(e.after) && e.after.stage===spec.key);
    const current=latest && isStageDrawRecord(latest.after) && latest.after.universeId===universeId && latest.after.foundation===foundation && (!latest.after.associationFoundation || latest.after.associationFoundation===projectTournamentAffiliations(t,tournaments,activity,universeId).fingerprint);
    const serviceQualification=spec.kind==="knockout" && t.knockoutStages?.[0]?.name===spec.key && groups.length>0;
    const manualBlocker=serviceQualification || competitionIdentity(t).startsWith("conmebol-") || !!t.continentalPlans?.length || !!secondDivisionKind(t)
      || ["anfp-copa-de-la-liga","arg-liga-profesional","anfp-liga-de-ascenso","anfp-liga-segunda"].includes(competitionIdentity(t))
      ? "Este formato requiere participantes y cruces del servicio específico; el registro manual no reemplaza sus restricciones, bombos ni cabezas de serie." : undefined;
    const provisional=latest && isStageDrawRecord(latest.after) && latest.after.mode==="documented" && latest.after.source?.verification!=="verified";
    return {...spec,days,fixtures,played,participants,blockers:[...new Set(own)],manualBlocker,serviceQualification,latest,current,
      state:played?"Disputada":fixtures.length?"Encuentros generados":current?provisional?"Registro documental provisional":"Sorteo confirmado":latest?"Revisión desactualizada":own.length?"Bloqueada":"Pendiente de preparación"};
  });
  return {tournament:t,groups,unassigned:t.teams.filter(team=>!team.groupName),stages,blockers:[...new Set(blockers)],history,foundation,
    unclassifiedPhases:[...new Set(t.matchdays.map(d=>d.phaseName ?? "Sin fase registrada"))].filter(name=>!specifications.some(s=>s.key===name || name.startsWith(`${s.key} · `))),
    automaticBlocker:"No se ofrece un sorteo oficial ni aleatoriedad uniforme. La generación local asistida requiere grupos registrados y una configuración válida de bombos y restricciones. Los formatos no soportados siguen bloqueados y los cruces predeterminados usan su servicio existente."};
}

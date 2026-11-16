import {projectTournamentAffiliations} from "./club-associations";
import {isSupportedAssociationRestriction} from "../../domain/entities/draw-configuration";
import {isStageDrawRecord} from "../../domain/entities/stage-draw";
import {latestDrawConfiguration,validateDrawConfiguration} from "./draw-configuration";
import {groupStageKey} from "./draw-and-bracket";
import type {Tournament} from "../../domain/entities/tournament";
import type {ActivityEvent} from "../../domain/entities/activity-event";
import {calculateStandingsWithResolution} from "../../domain/services/standings";
import {getOfficialResolutionContexts,regularDivisionTournament,divisionZoneTournaments} from "../../domain/services/second-division-progression";
import {secondDivisionKind} from "../../domain/services/second-division-rules";
import {currentResolution} from "../../domain/services/official-resolution-core";
import {programmeOrder} from "../../domain/services/official-programme";
import {getCompletedStageWinners} from "../../domain/services/official-cup-progression";
import {getCompetitionAlerts} from "../../domain/services/competition-alerts";
import {hasUnverifiedCompetitionRules} from "../../domain/services/competition-rules";
import {isValidPlayedFixture} from "../../domain/services/tournament-statistics";
import {evaluateSeasonClosure} from "./season-closure";
import {projectSeasonProgression} from "./season-progression";
import {nationalContinentalProjection} from "./continental-projection";
import {stageDays} from "./draw-and-bracket";
import {sportsDecisionEligibility} from "./sports-decision-eligibility";

export type SportsDecisionState="Pendiente"|"Requiere documentación"|"Requiere completar partidos"|"Lista para revisión"|"Resuelta"|"Resolución desactualizada"|"Bloqueada por formato no soportado";
export type SportsDecisionCategory="Afiliaciones de clubes"|"Bombos y restricciones"|"Integridad"|"Clasificación y desempates"|"Eliminatorias"|"Ascensos y descensos"|"Clasificación internacional"|"Documentación reglamentaria"|"Dependencias";
export type SportsDecisionAction="associations"|"fixture"|"calendar"|"rules"|"draw"|"planning"|"qualification";
export interface SportsDecision {
 id:string;category:SportsDecisionCategory;title:string;state:SportsDecisionState;reason:string;scope:string;
 teamIds:string[];fixtureIds:string[];positions:number[];actions:SportsDecisionAction[];impacts:string[];contextKey?:string;
}
/** A read projection. Native services determine tables, winners, movements and documentary validity. */
export function projectSportsDecisions(t:Tournament,tournaments:readonly Tournament[],activity:readonly ActivityEvent[],universeId:string|null){
 const closure=evaluateSeasonClosure(t,tournaments,activity,universeId),progression=projectSeasonProgression([t.id],tournaments,activity);
 const contexts=getOfficialResolutionContexts(t),decisions:SportsDecision[]=[],causes=new Map<string,SportsDecision>();
 function add(item:SportsDecision){
   const cause=JSON.stringify([item.reason,item.scope,[...item.teamIds].sort(),[...item.fixtureIds].sort()]);
   const existing=causes.get(cause);if(existing){existing.actions=[...new Set([...existing.actions,...item.actions])];existing.impacts=[...new Set([...existing.impacts,...item.impacts])];return existing;}
   causes.set(cause,item);decisions.push(item);return item;
 }
 function cause(category:SportsDecisionCategory,id:string,title:string,state:SportsDecisionState,reason:string,actions:SportsDecisionAction[],teamIds:string[]=[],scope="Temporada",fixtureIds:string[]=[],impacts:string[]=[]){return add({category,id,title,state,reason,actions,teamIds,scope,fixtureIds,positions:[],impacts});}
 const drawConfig=latestDrawConfiguration(t.id,groupStageKey,universeId,activity);
 if(drawConfig && !drawConfig.deleted && !t.matchdays.some(d=>d.fixtures.length) && !activity.some(e=>e.tournamentId===t.id && e.action==="stage-draw-confirmed")){
   const result=validateDrawConfiguration(drawConfig,t,tournaments,activity,universeId);
   if(result.state!=="Válida")cause("Bombos y restricciones","draw-configuration","Completar o verificar restricciones del sorteo",result.state==="Restricción no soportada"?"Bloqueada por formato no soportado":result.pending.length?"Requiere documentación":"Pendiente",[...result.errors,...result.incomplete,...result.pending,...result.unsupported].join(" "),["draw"],drawConfig.participantIds,"Grupos registrados");
 }
 const associatedDraw=[...activity].reverse().find(e=>e.tournamentId===t.id && e.action==="stage-draw-confirmed" && isStageDrawRecord(e.after) && e.after.stage===groupStageKey && e.after.universeId===universeId);
 if(drawConfig?.restrictions.some(isSupportedAssociationRestriction) && !drawConfig.deleted || associatedDraw && isStageDrawRecord(associatedDraw.after) && associatedDraw.after.associationFoundation){
   const affiliations=projectTournamentAffiliations(t,tournaments,activity,universeId);
   if(!associatedDraw)for(const row of affiliations.rows.filter(r=>!r.ready))cause("Afiliaciones de clubes",`affiliation:${row.team.id}`,`Afiliación ${row.state.toLocaleLowerCase("es")}`,"Requiere documentación",row.reason,["associations","draw"],[row.team.id],"Aparición y temporada");
   if(associatedDraw && isStageDrawRecord(associatedDraw.after) && associatedDraw.after.associationFoundation && associatedDraw.after.associationFoundation!==affiliations.fingerprint)cause("Afiliaciones de clubes","affiliation-draw-stale","Sorteo con fundamentos de afiliación desactualizados","Resolución desactualizada","Cambió una afiliación o asociación utilizada. Se conserva el sorteo anterior y se bloquea su uso definitivo; no se reorganizan encuentros.",["associations","draw"],[],"Grupos registrados");
 }
 const eligibility=sportsDecisionEligibility(t,tournaments,activity),ruleIssues=eligibility.rules;
 ruleIssues.forEach((reason,i)=>cause("Documentación reglamentaria",`rules:${i}`,"Revisión del reglamento","Requiere documentación",reason,["rules"],[],"Reglamento anual",[],["Registro documental de decisiones de esta temporada"]));
 closure.integrity.forEach((reason,i)=>cause("Integridad",`integrity:${i}`,"Datos que requieren corrección","Pendiente",reason,["calendar","rules"]));
 if(t.archived)cause("Documentación reglamentaria","archived","Temporada archivada","Pendiente","La consulta sigue disponible; revisa el archivo administrativo en la biblioteca antes de registrar una decisión.",["rules"]);
 const allDays=t.matchdays.filter(d=>!t.knockoutStages?.some(stage=>stageDays(t,stage.name).includes(d)));
 let scopes:{label:string;tournament:Tournament}[]=[];
 if(secondDivisionKind(t))scopes=(secondDivisionKind(t)==="argentina"?divisionZoneTournaments(t):[regularDivisionTournament(t)]).map(scope=>({label:scope.zoneName ?? "Fase regular",tournament:scope}));
 else if(t.teams.some(team=>team.groupName)){
   const phases=t.format==="staged"?[...new Set(allDays.map(d=>d.phaseName))]:[undefined];
   scopes=phases.flatMap(phase=>[...new Set(t.teams.flatMap(team=>team.groupName?[team.groupName]:[]))].map(group=>({label:`${phase ?? "Clasificación"} · ${group}`,tournament:{...t,teams:t.teams.filter(team=>team.groupName===group),matchdays:allDays.filter(d=>phase===undefined || d.phaseName===phase)}})));
 }else if(t.competitionType!=="cup" && t.format!=="staged")scopes=[{label:"Clasificación de la temporada",tournament:t}];
 const tables=scopes.map(scope=>({...scope,...calculateStandingsWithResolution(scope.tournament,t.matchdays)}));
 const contextTeams=new Set(contexts.flatMap(c=>c.participantIds));
 tables.forEach((table,index)=>{
   const complete=table.tournament.matchdays.length>0 && table.tournament.matchdays.every(d=>d.fixtures.length>0 && d.fixtures.every(f=>isValidPlayedFixture(t,d,f)));
   table.unresolvedTies.forEach((detail,i)=>{
     const ids=detail.teams.map(team=>team.teamId),supported=contexts.find(c=>ids.every(id=>c.participantIds.includes(id)));
     if(supported)return; // Its single documentary decision below retains the table reference and participants.
     const state:SportsDecisionState=!complete?"Requiere completar partidos":ruleIssues.length?"Requiere documentación":"Bloqueada por formato no soportado";
     add({id:`tie:${index}:${i}`,category:"Clasificación y desempates",title:"Desempate pendiente",state,reason:detail.reason,scope:table.label,teamIds:ids,fixtureIds:[...(detail.fixtureIds ?? [])],positions:detail.teams.map(team=>table.standings.findIndex(row=>row.teamId===team.teamId)+1),actions:detail.fixtureIds?.length?["fixture","rules"]:["calendar","rules"],impacts:[`Orden de ${table.label}`,"Revisión de los resultados deportivos de esta temporada"]});
   });
 });
 for(const context of contexts){
   const record=currentResolution(t,context),old=(t.officialResolutions ?? []).some(r=>r.scope===context.scope && r.key===context.key);
   const resolved=record?.verification==="verified" && (context.scope!=="argentina-relegation" || !!programmeOrder(t,context));
   const state:SportsDecisionState=!eligibility.allowed?"Requiere documentación":resolved?"Resuelta":record?record.verification!=="verified"?"Requiere documentación":"Requiere completar partidos":old?"Resolución desactualizada":"Lista para revisión";
   const table=tables.find(table=>context.participantIds.every(id=>table.standings.some(row=>row.teamId===id)));
   add({id:`document:${context.scope}:${context.key}:${context.participantIds.join(",")}`,category:"Clasificación y desempates",title:context.title,state,
     reason:resolved?"El servicio aplica la resolución verificada vigente; no hace falta confirmarla nuevamente.":record?"El registro existe, pero todavía no acredita una conclusión deportiva definitiva.":old?"La resolución anterior no coincide con los participantes o fundamentos actuales.":"El dominio acredita un contexto documental específico. Registra únicamente la publicación correspondiente a su ámbito.",
     scope:context.key,teamIds:[...context.participantIds],fixtureIds:[],positions:context.participantIds.flatMap(id=>{const i=table?.standings.findIndex(row=>row.teamId===id) ?? -1;return i>=0?[i+1]:[];}),actions:["rules"],contextKey:context.key,impacts:["Orden o movimiento del ámbito documental registrado","Preparación posterior mediante los servicios existentes"]});
 }
 for(const stage of t.knockoutStages ?? []){
   const days=stageDays(t,stage.name),pairs=new Map<string,string[]>();
   for(const day of days)for(const f of day.fixtures){const key=JSON.stringify([f.homeTeamId,f.awayTeamId].sort());pairs.set(key,[f.homeTeamId,f.awayTeamId]);}
   if(!pairs.size){cause("Eliminatorias",`stage:${stage.name}`,"Etapa sin cruces acreditados","Requiere completar partidos","Faltan encuentros o participantes definitivos para esta etapa registrada.",["draw","calendar"],[],stage.name,[],[t.knockoutStages?.[t.knockoutStages.findIndex(s=>s.name===stage.name)+1]?.name ?? "Revisión final de la competición"]);continue;}
   for(const [key,teamIds] of pairs){
     const selected=days.map(day=>({...day,fixtures:day.fixtures.filter(f=>JSON.stringify([f.homeTeamId,f.awayTeamId].sort())===key)}));
     const fixtures=selected.flatMap(d=>d.fixtures),valid=fixtures.length===stage.legs && selected.every(d=>d.fixtures.every(f=>isValidPlayedFixture(t,d,f)));
     const winners=valid && !closure.integrity.length?getCompletedStageWinners(selected,stage):undefined;
     cause("Eliminatorias",`knockout:${stage.name}:${key}`,winners?.length===1?"Ganador calculado":"Cruce sin ganador acreditado",winners?.length===1?"Resuelta":"Requiere completar partidos",
       winners?.length===1?`El servicio de la eliminatoria acredita a ${t.teams.find(team=>team.id===winners[0])?.name ?? winners[0]}. No requiere confirmación adicional.`:"Revisa los encuentros, sus estados operativos y los datos de definición exigidos por la resolución registrada; el Centro no genera prórrogas ni penales.",
       ["fixture","calendar"],teamIds,stage.name,fixtures.map(f=>f.id),[t.knockoutStages?.[t.knockoutStages.findIndex(s=>s.name===stage.name)+1]?.name ?? "Determinación del resultado final por el servicio existente"]);
   }
 }
 if(!secondDivisionKind(t) && (t.competitionType==="cup" || t.format==="staged") && !t.knockoutStages?.length && !t.teams.some(team=>team.groupName))cause("Eliminatorias","unsupported-stage","Formato sin resolución representada","Bloqueada por formato no soportado","No hay etapas eliminatorias registradas suficientes para acreditar ganadores. No se reconstruyen llaves.",["rules","calendar"]);
 if(closure.division?.pending.length && hasUnverifiedCompetitionRules(t)){
   const rule=decisions.find(d=>d.id==="rules:0");
   if(rule){rule.actions=[...new Set<SportsDecisionAction>([...rule.actions,"planning"])];rule.impacts.push("Ascensos y descensos pendientes por el mismo reglamento; preparación de participantes de la siguiente edición.");}
 }else for(const [index,reason] of (closure.division?.pending ?? []).entries())cause("Ascensos y descensos",`movement:${index}`,"Movimiento deportivo pendiente",closure.overview.played<closure.overview.total?"Requiere completar partidos":ruleIssues.length?"Requiere documentación":"Pendiente",reason,["calendar","rules","planning"],[],"Movimientos de esta edición",[],["Preparación de participantes de la siguiente edición"]);
 if(closure.division?.complete && (closure.division.promoted.length || closure.division.relegated.length))cause("Ascensos y descensos","movement:resolved","Movimientos calculados","Resuelta","El servicio específico acredita estos movimientos; no se crean nuevas temporadas al consultarlos.",["planning"],[...closure.division.promoted,...closure.division.relegated.map(row=>row.teamId)],"Movimientos de esta edición");
 if(!closure.division && t.placementRules?.relegationPlayoffPlaces){const places=t.placementRules.relegationPlayoffPlaces;cause("Ascensos y descensos","promotion:unsupported","Promoción pendiente","Bloqueada por formato no soportado","La posición de tabla no resuelve una promoción: se requiere un flujo deportivo o resolución reglamentaria representada.",["rules","planning"],closure.tables.flatMap(table=>table.rows.slice(places.from-1,places.to).map(row=>row.teamId)),"Promoción registrada");}
 for(const [index,reason] of (closure.averages?.pendingReasons ?? []).entries())cause("Ascensos y descensos",`averages:${index}`,"Descensos por promedio pendientes","Requiere documentación",reason,["planning","rules"],[],"Promedios de descenso");
 const international=closure.international ?? (t.placementRules?.libertadoresQualifyingPlaces?nationalContinentalProjection(t,tournaments,activity):undefined);
 if(international){
   international.reasons.forEach((reason,index)=>cause("Clasificación internacional",`qualification:${index}`,"Clasificación internacional pendiente","Pendiente",reason,["qualification","planning"]));
   const provisional=international.entries.filter(entry=>entry.status!=="confirmed");
   if(provisional.length)cause("Clasificación internacional","qualification:provisional","Plazas provisionales","Pendiente","Las plazas indicadas todavía no son definitivas según la proyección existente.",["qualification"],provisional.filter(e=>e.originTournamentId===t.id).map(e=>e.sourceTeamId));
   else if(international.entries.length)cause("Clasificación internacional","qualification:resolved","Plazas calculadas definitivas","Resuelta","La proyección acredita las plazas registradas; no equivale a acreditar participación en la edición de destino.",["qualification"],international.entries.filter(e=>e.originTournamentId===t.id).map(e=>e.sourceTeamId));
 }
 const dependencies=progression.dependencies.map(d=>({...d,source:tournaments.find(s=>s.id===d.sourceId),target:tournaments.find(s=>s.id===d.targetId)}));
 dependencies.filter(d=>!d.source || !d.target).forEach((d,index)=>cause("Dependencias",`dependency:${index}`,"Referencia deportiva no disponible","Requiere documentación",`${d.reason}: ${d.sourceId} → ${d.targetId}. No se resuelve por coincidencia de nombres ni fuera de este universo.`,["planning"]));
 eligibility.dependencies.filter(reason=>!reason.startsWith("Dependencia de esta edición no disponible")).forEach((reason,index)=>cause("Dependencias",`admission:${index}`,"Fundamentos de admisión pendientes","Requiere documentación",reason,["planning","rules"]));
 const history=(t.officialResolutions ?? []).map(record=>{
   const context=contexts.find(c=>c.scope===record.scope && c.key===record.key && c.dependencySnapshot===record.dependencySnapshot);
   const current=!!context && currentResolution(t,context)?.id===record.id;
   const status=record.supersededBy?"Sustituida":record.invalidation || !current?"Resolución desactualizada":!eligibility.allowed?"Requiere documentación":record.verification!=="verified"?"Requiere documentación":record.scope==="argentina-relegation" && !programmeOrder(t,context!)?"Requiere completar partidos":"Resuelta";
   if(status==="Resolución desactualizada" && !contexts.some(c=>c.scope===record.scope && c.key===record.key))cause("Clasificación y desempates",`stale:${record.id}`,"Resolución histórica fuera de contexto","Resolución desactualizada","El registro se conserva, pero el servicio no acredita su aplicación a los fundamentos actuales.",["rules","calendar"],[...record.participantIds],record.key);
   return {record,status,current,event:activity.find(event=>event.tournamentId===t.id && event.action==="official-resolution-recorded" && event.entityId===record.id)};
 });
 const observations=getCompetitionAlerts(t).filter(alert=>!["regulations-review","knockout-pending"].includes(alert.type));
 return {tournament:t,decisions,tables,contexts,history,dependencies,international,closure,observations,
   rulesReady:eligibility.allowed,
   counts:{pending:decisions.filter(d=>d.state!=="Resuelta").length,resolved:decisions.filter(d=>d.state==="Resuelta").length,
     stale:history.filter(h=>h.status==="Resolución desactualizada").length,blocked:decisions.filter(d=>d.state==="Bloqueada por formato no soportado" || d.category==="Integridad").length,dependencies:dependencies.length},
   activity:activity.filter(event=>event.tournamentId===t.id),contextTeams};
}

import type {Tournament} from "../../domain/entities/tournament";
import type {ActivityEvent} from "../../domain/entities/activity-event";
import {isDrawConfiguration,isSupportedAssociationRestriction,type DrawConfiguration} from "../../domain/entities/draw-configuration";
import {projectTournamentAffiliations} from "./club-associations";
import {drawFoundation,groupStageKey,inspectDrawPreparation} from "./draw-and-bracket";
import {sameParticipants} from "../../domain/services/official-resolution-core";

export function latestDrawConfiguration(tournamentId:string,stage:string,universeId:string|null,activity:readonly ActivityEvent[]) {
  const record=[...activity].reverse().find(e=>e.action==="draw-configuration-recorded" && e.tournamentId===tournamentId
    && isDrawConfiguration(e.after) && e.after.stage===stage && e.after.universeId===universeId)?.after;
  return isDrawConfiguration(record)?record:undefined;
}
export function emptyDrawConfiguration(t:Tournament,universeId:string|null,tournaments:readonly Tournament[],activity:readonly ActivityEvent[]):DrawConfiguration {
  return {schemaVersion:1,revision:(latestDrawConfiguration(t.id,groupStageKey,universeId,activity)?.revision ?? 0)+1,
    tournamentId:t.id,competitionId:t.competitionId ?? "",season:t.season!,universeId,stage:groupStageKey,
    foundation:drawFoundation(t,universeId,tournaments,activity),participantIds:t.teams.map(t=>t.id),pots:[],restrictions:[],mode:"local",verification:"pending"};
}
export type DrawValidationState="Válida"|"Incompleta"|"Incompatible"|"Datos pendientes"|"Restricción no soportada";
export function validateDrawConfiguration(c:DrawConfiguration,t:Tournament,tournaments:readonly Tournament[],activity:readonly ActivityEvent[],universeId:string|null) {
  const errors:string[]=[],incomplete:string[]=[],pending:string[]=[],unsupported:string[]=[];
  if(!isDrawConfiguration(c))return {state:"Incompatible" as DrawValidationState,errors:["Estructura de configuración inválida."],incomplete,pending,unsupported,warning:"",canSave:false};
  const view=inspectDrawPreparation(t,tournaments,activity,universeId),groups=view.groups;
  const duplicate=(ids:readonly string[])=>new Set(ids).size!==ids.length;
  if(c.tournamentId!==t.id || !t.competitionId || c.competitionId!==t.competitionId || c.season!==t.season || c.universeId!==universeId)errors.push("La identidad de universo, competición o temporada no coincide.");
  if(c.stage!==groupStageKey || !groups.length)unsupported.push("Solo se admiten los grupos ya registrados; las eliminatorias no tienen un modelo de bombos compatible.");
  if(c.foundation!==drawFoundation(t,universeId,tournaments,activity))pending.push("Los fundamentos cambiaron; revisa explícitamente la configuración.");
  if(duplicate(c.participantIds) || !sameParticipants(c.participantIds,t.teams.map(team=>team.id)))errors.push("Participantes duplicados, inexistentes o no admitidos.");
  // Blockers describe existing admission, annual rules, match rules and dependencies.
  pending.push(...view.blockers);
  if(!t.competitionRules || t.competitionRules.season!==t.season || Object.values(t.competitionRules.verification).some(v=>v!=="verified"))pending.push("El reglamento anual está pendiente de verificación.");
  if(c.mode==="documented" && c.verification!=="verified")pending.push("Fuente documental provisional o pendiente de revisión por el usuario.");
  if(duplicate(c.pots.map(p=>p.id)) || duplicate(c.restrictions.map(r=>r.id)))errors.push("Identificadores de bombos o restricciones duplicados.");
  const assigned=c.pots.flatMap(p=>p.teamIds);
  if(duplicate(assigned))errors.push("Hay participantes duplicados entre bombos.");
  if(assigned.some(id=>!c.participantIds.includes(id)))errors.push("Un bombo contiene una identidad inexistente o no admitida.");
  if(!c.pots.length)incomplete.push("No hay bombos registrados.");
  if(c.pots.some(p=>p.teamIds.length>p.capacity))errors.push("Capacidad de bombo excedida.");
  if(c.pots.some(p=>p.teamIds.length<p.capacity))incomplete.push("Hay bombos incompletos.");
  if(c.pots.reduce((n,p)=>n+p.capacity,0)>c.participantIds.length)errors.push("Las capacidades de bombos exceden los participantes admitidos.");
  if(c.pots.reduce((n,p)=>n+p.capacity,0)<c.participantIds.length || c.participantIds.some(id=>!assigned.includes(id)))incomplete.push("Faltan plazas de bombo o participantes por asignar.");
  if(groups.reduce((n,g)=>n+g.teamIds.length,0)!==c.participantIds.length || t.teams.some(team=>!team.groupName))errors.push("Las plazas de los grupos registrados no corresponden a los admitidos.");
  if(c.seeding && (duplicate(c.seeding.teamIds) || c.seeding.teamIds.some(id=>!c.participantIds.includes(id) || assigned.filter(a=>a===id).length!==1)))errors.push("Cabezas de serie incompatibles con participantes o bombos.");
  const fixed=c.restrictions.filter(r=>r.type==="fixed-position");
  const associationRules=c.restrictions.filter(isSupportedAssociationRestriction);
  if(associationRules.length){
    const affiliations=projectTournamentAffiliations(t,tournaments,activity,universeId);
    pending.push(...affiliations.rows.filter(r=>!r.ready).map(r=>`${r.team.name}: afiliación ${r.state.toLocaleLowerCase("es")}. ${r.reason}`));
    if(c.associationDependencies?.fingerprint!==affiliations.fingerprint)pending.push("Configuración desactualizada: revisa expresamente sus dependencias de afiliación y asociación.");
    for(const rule of associationRules){
      const counts=new Map<string,number>();for(const id of Object.values(affiliations.associationIds))counts.set(id,(counts.get(id) ?? 0)+1);
      if([...counts.values()].some(count=>count>groups.length*rule.maxPerGroup))errors.push("Restricción incompatible: una asociación tiene más participantes que plazas permitidas entre los grupos.");
      const assigned=new Map<string,Set<string>>();for(const r of fixed){const association=affiliations.associationIds[r.teamId];if(association){const key=JSON.stringify([r.group,association]),members=assigned.get(key) ?? new Set<string>();members.add(r.teamId);assigned.set(key,members);}}
      if([...assigned.values()].some(members=>members.size>rule.maxPerGroup))errors.push("Las posiciones fijas contradicen el máximo por asociación y grupo.");
    }
  }
  const sizeBounds=new Map(groups.map(g=>[g.name,{min:0,max:g.teamIds.length}]));
  for(const r of c.restrictions){
    if(r.type==="unsupported")unsupported.push(r.description);
    if(r.type==="association" && !isSupportedAssociationRestriction(r))unsupported.push("Asociación desconocida: esta condición antigua no contiene una regla ejecutable versionada. Registra explícitamente el máximo por asociación; no se convierte automáticamente.");
    if(r.type==="group-size"){
      const g=groups.find(g=>g.name===r.group),bounds=sizeBounds.get(r.group);
      if(!g || r.min>r.max || g.teamIds.length<r.min || g.teamIds.length>r.max)errors.push("Límites de grupo incompatibles con las capacidades registradas.");
      if(bounds){bounds.min=Math.max(bounds.min,r.min);bounds.max=Math.min(bounds.max,r.max);if(bounds.min>bounds.max)errors.push("Restricciones de capacidad contradictorias.");}
    }
    if(r.type==="pot-distribution"){
      const pot=c.pots.find(p=>p.id===r.potId);
      if(!pot || pot.capacity!==r.perGroup*groups.length || groups.some(g=>g.teamIds.length<r.perGroup))errors.push("Distribución por bombo incompatible con los grupos y su capacidad.");
      if(c.restrictions.some(other=>other.type==="pot-distribution" && other.potId===r.potId && other.perGroup!==r.perGroup))errors.push("Distribuciones del mismo bombo contradictorias.");
    }
    if(r.type==="incompatible"){
      if(duplicate(r.teamIds) || r.teamIds.some(id=>!c.participantIds.includes(id)))errors.push("Incompatibilidad con identidades duplicadas o no admitidas.");
      if(r.teamIds.length>groups.length)errors.push("Más participantes mutuamente incompatibles que grupos disponibles.");
      const forced=[...new Map(fixed.filter(f=>r.teamIds.includes(f.teamId)).map(f=>[f.teamId,f])).values()];
      if(duplicate(forced.map(f=>f.group)))errors.push("Participantes incompatibles obligados al mismo grupo.");
    }
    if(r.type==="fixed-position"){
      const g=groups.find(g=>g.name===r.group);
      if(!c.participantIds.includes(r.teamId) || !g || r.position>g.teamIds.length)errors.push("Posición fija inexistente o participante no admitido.");
      if(fixed.some(f=>f.id!==r.id && (f.group===r.group && f.position===r.position && f.teamId!==r.teamId || f.teamId===r.teamId && (f.group!==r.group || f.position!==r.position))))errors.push("Posiciones fijas contradictorias.");
    }
  }
  for(const g of groups){
    const quotas=new Map(c.restrictions.filter(r=>r.type==="pot-distribution").map(r=>[r.potId,r.perGroup]));
    if([...quotas.values()].reduce((n,q)=>n+q,0)>g.teamIds.length)errors.push("Las cuotas de bombos exceden la capacidad de grupo.");
    for(const [potId,quota] of quotas){const pot=c.pots.find(p=>p.id===potId);if(pot && new Set(fixed.filter(f=>f.group===g.name && pot.teamIds.includes(f.teamId)).map(f=>f.teamId)).size>quota)errors.push("Posiciones fijas exceden la cuota del bombo.");}
  }
  const state:DrawValidationState=errors.length?"Incompatible":unsupported.length?"Restricción no soportada":incomplete.length?"Incompleta":pending.length?"Datos pendientes":"Válida";
  return {state,errors:[...new Set(errors)],incomplete:[...new Set(incomplete)],pending:[...new Set(pending)],unsupported:[...new Set(unsupported)],
    warning:"Validación estructural aprobada; viabilidad completa no comprobada",canSave:!errors.length};
}

/** Position constraints consume explicit proposal order, never Team array/display order. */
export function validateRegisteredGroupDistribution(participantIds:readonly string[],registered:readonly {name:string;teamIds:readonly string[]}[],groups:readonly {name:string;teamIds:readonly string[]}[]):string[] {
  return !sameParticipants(registered.map(g=>g.name),groups.map(g=>g.name))
    || registered.some(g=>groups.find(candidate=>candidate.name===g.name)?.teamIds.length!==g.teamIds.length)
    || !sameParticipants(participantIds,groups.flatMap(g=>g.teamIds))
    ? ["Los grupos deben conservar sus capacidades registradas y asignar a todos los admitidos exactamente una vez."]:[];
}
export function validateManualDrawConfiguration(c:DrawConfiguration,groups:readonly {name:string;teamIds:readonly string[]}[],associationIds?:Readonly<Record<string,string>>):string[] {
  const issues:string[]=[];
  if(!sameParticipants(c.participantIds,groups.flatMap(g=>g.teamIds)))issues.push("La distribución no contiene exactamente los participantes configurados.");
  for(const r of c.restrictions){
    if(r.type==="unsupported" || r.type==="association" && !isSupportedAssociationRestriction(r))issues.push("Hay restricciones no soportadas; no se puede confirmar la distribución.");
    if(isSupportedAssociationRestriction(r)){
      if(!associationIds || c.participantIds.some(id=>typeof associationIds[id]!=="string" || !associationIds[id]))issues.push("Faltan afiliaciones verificadas: no se trata una asociación desconocida como diferente de las demás.");
      else for(const group of groups){const counts=new Map<string,number>();for(const id of group.teamIds){const association=associationIds[id];counts.set(association,(counts.get(association) ?? 0)+1);}if([...counts.values()].some(count=>count>r.maxPerGroup))issues.push("La distribución viola el máximo de participantes por asociación y grupo.");}
    }
    if(r.type==="group-size"){const g=groups.find(g=>g.name===r.group);if(!g || g.teamIds.length<r.min || g.teamIds.length>r.max)issues.push("La distribución viola los límites de grupo.");}
    if(r.type==="incompatible" && groups.some(g=>r.teamIds.filter(id=>g.teamIds.includes(id)).length>1))issues.push("Participantes incompatibles en el mismo grupo.");
    if(r.type==="pot-distribution"){const p=c.pots.find(p=>p.id===r.potId);if(!p || groups.some(g=>g.teamIds.filter(id=>p.teamIds.includes(id)).length!==r.perGroup))issues.push("La distribución viola la cuota por bombo.");}
    if(r.type==="fixed-position" && groups.find(g=>g.name===r.group)?.teamIds[r.position-1]!==r.teamId)issues.push("La distribución viola una posición fija explícita.");
  }
  return [...new Set(issues)];
}

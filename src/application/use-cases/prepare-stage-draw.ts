import {isSupportedAssociationRestriction} from "../../domain/entities/draw-configuration";
import {projectTournamentAffiliations} from "../services/club-associations";
import {latestDrawConfiguration,validateDrawConfiguration,validateManualDrawConfiguration,validateRegisteredGroupDistribution} from "../services/draw-configuration";
import type {Tournament,Matchday} from "../../domain/entities/tournament";
import type {StageDrawRecord} from "../../domain/entities/stage-draw";
import {isStageDrawRecord} from "../../domain/entities/stage-draw";
import type {TournamentRepository} from "../ports/tournament-repository";
import {drawFoundation,inspectDrawPreparation,existingStageProposal} from "../services/draw-and-bracket";
import {createActivityEvent,recordActivity,saveWithActivity} from "../services/activity-log";
import {validateTournamentIntegrity} from "../../domain/services/tournament-integrity";
import {sameParticipants} from "../../domain/services/official-resolution-core";
import {canonical,isHttpsReference} from "../../domain/services/continental-plan";
import {previewManualCalendar,confirmCalendarProgramming,type CalendarProgrammingProposal} from "./program-season-calendar";
import {generateRoundRobinSchedule} from "../../domain/services/round-robin-scheduler";

export interface StageDrawInput {
  tournamentId:string; universeId:string|null; stage:string; mode:StageDrawRecord["mode"];
  configurationRevision?:number;
  generation?:StageDrawRecord["generation"];
  groups?:StageDrawRecord["groups"]; pairs?:StageDrawRecord["pairs"];
  resolution?:StageDrawRecord["resolution"]; source?:StageDrawRecord["source"]; verifiedByUser?:boolean;
}
export interface StageDrawReview {readonly tournamentId:string;readonly universeId:string|null;readonly record:StageDrawRecord;readonly proposed:Tournament}
const reviews=new WeakMap<StageDrawReview,{content:string;snapshot:string}>();
const snapshot=(r:TournamentRepository)=>JSON.stringify([r.findAll(),r.findActivity?.() ?? []]);

export function reviewStageDraw(input:StageDrawInput,repository:TournamentRepository):StageDrawReview {
  return inspectStageDraw(input,repository);
}
function inspectStageDraw(input:StageDrawInput,repository:TournamentRepository,calendarReplay=false):StageDrawReview {
  const tournaments=repository.findAll(),activity=repository.findActivity?.() ?? [],before=JSON.stringify([tournaments,activity]);
  const t=tournaments.find(t=>t.id===input.tournamentId);if(!t)throw new Error("La temporada no está disponible en el universo activo.");
  const inspection=inspectDrawPreparation(t,tournaments,activity,input.universeId),stage=inspection.stages.find(s=>s.key===input.stage);
  if(!stage)throw new Error("La etapa no está registrada en este formato. No se crean etapas nuevas desde el Centro.");
  if(stage.blockers.length)throw new Error(stage.blockers.join(" "));
  if(input.mode!=="local" && stage.manualBlocker)throw new Error(stage.manualBlocker);
  if(stage.current)throw new Error("La distribución ya está confirmada. No se combina con otro sorteo; revisa el registro y continúa al calendario.");
  if(stage.latest && isStageDrawRecord(stage.latest.after) && stage.latest.after.associationFoundation)throw new Error("El sorteo confirmado conserva sus fundamentos históricos de asociación. Una corrección no autoriza a reorganizarlo ni a sobrescribirlo.");
  if(input.mode==="generated" && (stage.kind!=="groups" || stage.latest || !input.generation || input.generation.method!=="constraint-groups-v1" || !input.generation.seed.trim() || input.generation.seed.length>128))throw new Error("La generación local requiere grupos compatibles sin sorteos anteriores y una semilla explícita.");
  let associationFoundation:string|undefined;
  let configurationRevision:number|undefined;
  let generatedSource:StageDrawRecord["source"];
  let proposed=t,groups:StageDrawRecord["groups"]=[],pairs:StageDrawRecord["pairs"]=input.pairs ?? [],resolution=input.resolution;
  if(stage.kind==="groups"){
    if(input.mode==="local")throw new Error(inspection.automaticBlocker);
    groups=input.groups ?? [];
    const groupIssues=validateRegisteredGroupDistribution(t.teams.map(team=>team.id),inspection.groups,groups);
    if(groupIssues.length)throw new Error(groupIssues.join(" "));
    const configuration=latestDrawConfiguration(t.id,input.stage,input.universeId,activity);
    if(input.mode==="generated" && (!configuration || configuration.deleted || input.configurationRevision!==configuration.revision))throw new Error("La generación necesita la revisión vigente de bombos y restricciones.");
    if(calendarReplay && input.configurationRevision!==undefined && (!configuration || configuration.deleted || configuration.revision!==input.configurationRevision))throw new Error("La configuración utilizada por el sorteo no coincide con la revisión registrada.");
    if(configuration && !configuration.deleted && (!calendarReplay || input.configurationRevision!==undefined)){
      configurationRevision=configuration.revision;
      // During calendar replay the recorded draw itself accredits the new group composition.
      const replay=calendarReplay;
      const validation=validateDrawConfiguration(replay?{...configuration,foundation:drawFoundation(t,input.universeId,tournaments,activity)}:configuration,t,tournaments,activity,input.universeId);
      if(validation.state!=="Válida")throw new Error([...validation.errors,...validation.incomplete,...validation.pending,...validation.unsupported].join(" "));
      const associated=configuration.restrictions.some(isSupportedAssociationRestriction);
      if(associated)associationFoundation=configuration.associationDependencies!.fingerprint;
      const issues=validateManualDrawConfiguration(configuration,groups,associated?projectTournamentAffiliations(t,tournaments,activity,input.universeId).associationIds:undefined);if(issues.length)throw new Error(issues.join(" "));
      if(input.mode==="generated" && configuration.mode==="documented" && configuration.source)generatedSource={...configuration.source,verification:configuration.verification};
    }
    if(t.officialResolutions?.length)throw new Error("Hay resoluciones deportivas registradas; no se altera su distribución desde este Centro.");
    proposed={...t,teams:t.teams.map(team=>({...team,groupName:groups.find(g=>g.teamIds.includes(team.id))!.name}))};
    pairs=[];resolution=undefined;
  } else {
    if(input.mode==="local"){
      const days=existingStageProposal(t,tournaments,input.stage),first=days.filter(d=>stage.legs===1 || d.phaseName===`${input.stage} · Ida`).flatMap(d=>d.fixtures);
      pairs=first.map(f=>({homeTeamId:f.homeTeamId,awayTeamId:f.awayTeamId}));
      const resolutions=[...new Set(days.flatMap(d=>d.fixtures).flatMap(f=>f.knockoutResolution?[f.knockoutResolution]:[]))];
      if(resolutions.length!==1)throw new Error("El servicio no aporta una regla única de resolución representable para esta fase. Continúa en su flujo específico.");
      resolution=resolutions[0];
      if(days.some(d=>d.fixtures.some(f=>f.result)))throw new Error("La propuesta no puede incorporar resultados.");
      if(stage.legs===2 && days.filter(d=>d.phaseName===`${input.stage} · Vuelta`).flatMap(d=>d.fixtures).some(f=>!pairs.some(p=>p.homeTeamId===f.awayTeamId && p.awayTeamId===f.homeTeamId)))throw new Error("La localía del servicio exige un formato específico no representable aquí.");
    }
    let eligible=stage.participants;
    if(stage.serviceQualification)eligible=pairs.flatMap(p=>[p.homeTeamId,p.awayTeamId]); // Membership is accredited exclusively by existingStageProposal in local mode.
    if(!sameParticipants(eligible,pairs.flatMap(p=>[p.homeTeamId,p.awayTeamId])) || !pairs.length
      || pairs.some(p=>!t.teams.some(team=>team.id===p.homeTeamId) || !t.teams.some(team=>team.id===p.awayTeamId)))throw new Error("Hay participantes duplicados, no admitidos o pendientes en los cruces.");
    if(stage.legs===1 ? !["penalties","extra-time-then-penalties"].includes(resolution ?? "") : resolution!=="aggregate-then-penalties")throw new Error("Registra una resolución compatible con el partido único o la serie, sin inventar goles visitantes ni ventajas.");
    if(t.matchRegulations?.timing?.penaltyShootoutAllowed===false || resolution==="extra-time-then-penalties" && t.matchRegulations?.timing?.extraTimeAllowed===false)throw new Error("La resolución indicada contradice las restricciones del reglamento de partidos registrado.");
    const index=t.knockoutStages!.findIndex(s=>s.name===input.stage);
    if(input.mode!=="local" && index>0){
      const expected=existingStageProposal(t,tournaments,input.stage).filter(d=>stage.legs===1 || d.phaseName===`${input.stage} · Ida`).flatMap(d=>d.fixtures).map(f=>({homeTeamId:f.homeTeamId,awayTeamId:f.awayTeamId}));
      if(canonical(expected)!==canonical(pairs))throw new Error("Los cruces y localías están predeterminados por el servicio existente. No se sustituyen por otros emparejamientos.");
    }
  }
  if(input.mode==="documented" && (!input.source || !isHttpsReference(input.source.url) || !input.source.reference.trim()))throw new Error("El registro documental necesita una fuente HTTPS y su referencia.");
  if(input.mode==="documented" && input.source?.verification==="verified" && !input.verifiedByUser)throw new Error("Confirma que contrastaste la distribución con la fuente antes de marcarla verificada.");
  const record:StageDrawRecord={schemaVersion:1,universeId:input.universeId,stage:input.stage,kind:stage.kind,mode:input.mode,
    ...(input.mode==="generated"?{generation:input.generation}:{}),
    ...(configurationRevision?{configurationRevision}:{}),
    ...(associationFoundation?{associationFoundation}:{}),
    foundation:drawFoundation(proposed,input.universeId,tournaments.map(s=>s.id===t.id?proposed:s),activity),groups,pairs,
    ...(resolution?{resolution}:{}),...(input.mode==="documented"?{source:input.source}:generatedSource?{source:generatedSource}: {})};
  if(!isStageDrawRecord(record))throw new Error("Revisa la estructura, las asignaciones y la procedencia de la propuesta.");
  const issues=validateTournamentIntegrity(proposed);if(issues.length)throw new Error(issues.join(" "));
  const review={tournamentId:t.id,universeId:input.universeId,record:JSON.parse(JSON.stringify(record)) as StageDrawRecord,proposed};
  if(before!==snapshot(repository))throw new Error("La biblioteca cambió durante la revisión.");
  reviews.set(review,{content:JSON.stringify(review),snapshot:before});return review;
}
export function confirmStageDraw(review:StageDrawReview,repository:TournamentRepository,universeId:string|null,confirmed:boolean) {
  const token=reviews.get(review);
  if(!confirmed || !token || token.content!==JSON.stringify(review))throw new Error("Se requiere una revisión íntegra y confirmación explícita; las copias o propuestas consumidas no son válidas.");
  if(universeId!==review.universeId || token.snapshot!==snapshot(repository))throw new Error("La biblioteca o el universo cambió. Revisa nuevamente el sorteo.");
  const fresh=reviewStageDraw({...review.record,tournamentId:review.tournamentId,verifiedByUser:true},repository);
  if(canonical(fresh.record)!==canonical(review.record) || canonical(fresh.proposed)!==canonical(review.proposed))throw new Error("La propuesta dejó de corresponder a sus fundamentos.");
  const t=repository.findAll().find(t=>t.id===review.tournamentId)!;
  const event=createActivityEvent(t,{action:"stage-draw-confirmed",entityType:"season",entityId:review.record.stage,
    summary:`Se confirmó una preparación de ${review.record.stage} (${review.record.mode}). Registro local; no certifica un sorteo oficial.`,after:review.record});
  if(review.record.kind==="groups")saveWithActivity(repository,review.proposed,event);else recordActivity(repository,event);
  reviews.delete(review);return {tournament:review.proposed,event};
}

export interface DrawCalendarReview {readonly tournamentId:string;readonly universeId:string|null;readonly drawEventId:string;readonly calendar:CalendarProgrammingProposal}
const calendars=new WeakMap<DrawCalendarReview,{content:string;snapshot:string}>();
export function reviewDrawCalendar(tournamentId:string,drawEventId:string,universeId:string|null,repository:TournamentRepository):DrawCalendarReview {
  const before=snapshot(repository),tournaments=repository.findAll(),activity=repository.findActivity?.() ?? [],t=tournaments.find(s=>s.id===tournamentId);
  const event=activity.find(e=>e.id===drawEventId && e.tournamentId===tournamentId && e.action==="stage-draw-confirmed");
  if(!t || !event || !isStageDrawRecord(event.after))throw new Error("No hay un sorteo registrado para construir sus encuentros.");
  const record=event.after,inspection=inspectDrawPreparation(t,tournaments,activity,universeId),stage=inspection.stages.find(s=>s.key===record.stage);
  if(!stage?.current || stage.latest?.id!==event.id || record.universeId!==universeId || record.foundation!==inspection.foundation)throw new Error("El sorteo está desactualizado. Revisa sus fundamentos antes de crear encuentros.");
  if(stage.blockers.length)throw new Error(stage.blockers.join(" "));
  if(record.mode==="documented" && record.source?.verification!=="verified")throw new Error("La distribución documental sigue provisional; no acredita participantes definitivos para crear partidos.");
  const validationRepository: TournamentRepository={findAll:()=>tournaments,findActivity:()=>activity.filter(e=>!(e.action==="stage-draw-confirmed" && isStageDrawRecord(e.after) && e.after.stage===record.stage && e.tournamentId===t.id)),save:()=>{throw new Error("La revisión no escribe.");}};
  const checked=inspectStageDraw({...record,tournamentId,verifiedByUser:true},validationRepository,true);
  if(canonical(checked.record)!==canonical(record))throw new Error("Los participantes o las restricciones del sorteo no corresponden al registro actual.");
  const nextNumber=Math.max(0,...t.matchdays.map(d=>d.number))+1;
  let days:Matchday[]=[];
  if(record.kind==="groups"){
    if(t.format!=="round-robin" || t.competitionType==="cup" || t.knockoutStages?.length)throw new Error("El generador general no programa grupos de copas por etapas. Continúa con la programación específica; no se inventa su calendario.");
    if(t.matchdays.length)throw new Error("Hay jornadas vacías ya registradas para los grupos. Complétalas desde su programación original; no se reemplaza su estructura por otro calendario.");
    const byRound=new Map<string,Matchday>();
    for(const group of record.groups)for(const day of generateRoundRobinSchedule(t.teams.filter(team=>group.teamIds.includes(team.id)),t.legs)){
      const key=`${day.number}:${day.leg}`,existing=byRound.get(key);
      byRound.set(key,{...day,number:nextNumber+day.number-1,fixtures:[...(existing?.fixtures ?? []),...day.fixtures.map(f=>({...f,id:crypto.randomUUID()}))]});
    }
    days=[...byRound.values()];
  } else {
    const stageIndex=t.knockoutStages!.findIndex(s=>s.name===record.stage);
    const initialLeg=1+t.knockoutStages!.slice(0,stageIndex).reduce((n,s)=>n+s.legs,0);
    days=Array.from({length:stage.legs},(_,index)=>({number:nextNumber+index,leg:initialLeg+index,
      phaseName:stage.legs===1?record.stage:`${record.stage} · ${index===0?"Ida":"Vuelta"}`,
      fixtures:record.pairs.map(pair=>({id:crypto.randomUUID(),homeTeamId:index===0?pair.homeTeamId:pair.awayTeamId,awayTeamId:index===0?pair.awayTeamId:pair.homeTeamId,
        ...((stage.legs===1 || index===1)?{knockoutResolution:record.resolution}: {})}))}));
  }
  days=days.map(day=>{const placeholders=t.matchdays.filter(existing=>(existing.phaseName ?? "").trim().toLocaleLowerCase("es")===(day.phaseName ?? "").trim().toLocaleLowerCase("es") && !existing.fixtures.length);if(placeholders.length>1)throw new Error("Hay jornadas vacías ambiguas para la fase; revísalas en el calendario.");return placeholders.length?{...day,number:placeholders[0].number,leg:placeholders[0].leg,phaseName:placeholders[0].phaseName}:day;});
  const calendar=previewManualCalendar(t,universeId,days,()=>crypto.randomUUID(),tournaments,true);
  const existing=new Map(calendar.proposed.matchdays.flatMap(d=>d.fixtures).map(f=>[f.id,f]));
  if(t.matchdays.flatMap(d=>d.fixtures).some(f=>canonical(existing.get(f.id))!==canonical(f)))throw new Error("La operación modificaría encuentros existentes. No se guardó ninguna propuesta.");
  const review={tournamentId,universeId,drawEventId,calendar};
  if(before!==snapshot(repository))throw new Error("La biblioteca cambió durante la revisión de encuentros.");
  calendars.set(review,{content:JSON.stringify(review),snapshot:before});return review;
}
export function confirmDrawCalendar(review:DrawCalendarReview,repository:TournamentRepository,universeId:string|null,confirmed:boolean) {
  const token=calendars.get(review);
  if(!confirmed || !token || token.content!==JSON.stringify(review) || universeId!==review.universeId || token.snapshot!==snapshot(repository))throw new Error("La revisión de encuentros está alterada, consumida u obsoleta. Revisa nuevamente.");
  const t=repository.findAll().find(t=>t.id===review.tournamentId)!;
  const inspection=inspectDrawPreparation(t,repository.findAll(),repository.findActivity?.() ?? [],universeId);
  const stage=inspection.stages.find(s=>s.latest?.id===review.drawEventId);
  if(!stage?.current || stage.blockers.length)throw new Error("El sorteo dejó de ser válido para crear sus encuentros.");
  const adapter: TournamentRepository={...repository,findAll:()=>repository.findAll(),save:t=>repository.save(t),saveWithActivity:(next,event)=>{
    if(!repository.saveWithActivity)throw new Error("El repositorio no permite guardar encuentros con actividad.");
    repository.saveWithActivity(next,{...event,note:`Encuentros del sorteo ${review.drawEventId}.`,after:{...(event.after as object),drawEventId:review.drawEventId}});
  }};
  const next=confirmCalendarProgramming(review.calendar,t,adapter,universeId);calendars.delete(review);return next;
}

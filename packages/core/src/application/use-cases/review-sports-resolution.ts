import { DomainError } from "../../domain/domain-error.js";
import type {Tournament} from "../../domain/entities/tournament";
import type {ActivityEvent} from "../../domain/entities/activity-event";
import type {TournamentRepository} from "../ports/tournament-repository";
import {recordOfficialResolution,type RecordOfficialResolutionInput} from "./record-official-resolution";
import {getOfficialResolutionContexts,getDivisionOutcome} from "../../domain/services/second-division-progression";
import {currentResolution,sameParticipants} from "../../domain/services/official-resolution-core";
import {programmeOrder} from "../../domain/services/official-programme";
import {canonical} from "../../domain/services/continental-plan";
import {sportsDecisionEligibility} from "../services/sports-decision-eligibility";

export interface SportsResolutionReview {
  readonly tournamentId:string;readonly universeId:string|null;readonly input:RecordOfficialResolutionInput;
  readonly before:Tournament;readonly proposed:Tournament;readonly event:ActivityEvent;
  readonly effects:{readonly beforeState:string;readonly afterState:string;readonly beforeOrder:readonly string[]|undefined;readonly afterOrder:readonly string[]|undefined;readonly promoted:readonly string[];readonly relegated:readonly string[];readonly pending:readonly string[]};
}
const reviews=new WeakMap<SportsResolutionReview,{content:string;snapshot:string;id:string}>();
const snapshot=(r:TournamentRepository)=>JSON.stringify([r.findAll(),r.findActivity?.() ?? []]);
function assertReviewable(t:Tournament,input:RecordOfficialResolutionInput,tournaments:readonly Tournament[],activity:readonly ActivityEvent[]){
  const eligibility=sportsDecisionEligibility(t,tournaments,activity);
  if(!eligibility.allowed)throw new DomainError([...eligibility.operations,...eligibility.rules,...eligibility.dependencies].join(" "));
  const context=getOfficialResolutionContexts(t).find(c=>c.scope===input.context.scope && c.key===input.context.key && c.dependencySnapshot===input.context.dependencySnapshot && sameParticipants(c.participantIds,input.context.participantIds));
  if(!context)throw new DomainError("La decisión ya no corresponde al contexto deportivo actual.");
  const existing=currentResolution(t,context);
  if(existing?.verification==="verified" && (context.scope!=="argentina-relegation" || programmeOrder(t,context)))throw new DomainError("La decisión ya está resuelta con sus fundamentos actuales; no necesita otra confirmación.");
  if(existing && canonical({verification:existing.verification,source:existing.source,orderedTeamIds:existing.orderedTeamIds,programme:existing.programme})===canonical({verification:input.verification,source:input.source,orderedTeamIds:input.orderedTeamIds,programme:input.programme}))throw new DomainError("Esa revisión documental ya está registrada. No se duplica la operación.");
}
export function reviewSportsResolution(tournamentId:string,universeId:string|null,input:RecordOfficialResolutionInput,repository:TournamentRepository):SportsResolutionReview {
  const beforeSnapshot=snapshot(repository),t=repository.findAll().find(s=>s.id===tournamentId);
  if(!t)throw new DomainError("La temporada no está disponible en el universo activo.");
  assertReviewable(t,input,repository.findAll(),repository.findActivity?.() ?? []);
  const at=new Date().toISOString(),id=crypto.randomUUID(),events:ActivityEvent[]=[];
  let proposed=t;
  const staging: TournamentRepository={findAll:()=>[t],save:()=>{throw new DomainError("La revisión no guarda torneos.");},saveWithActivity:(next,event)=>{proposed=next;events.push(event);}};
  const captured=JSON.parse(JSON.stringify(input)) as RecordOfficialResolutionInput;
  recordOfficialResolution(t,captured,staging,()=>new Date(at),()=>id,{advanceProgression:false});
  if(canonical({...proposed,officialResolutions:t.officialResolutions})!==canonical(t) || events.length!==1)throw new DomainError("La revisión afectaría datos ajenos al registro documental; no se puede confirmar.");
  if(beforeSnapshot!==snapshot(repository))throw new DomainError("La biblioteca cambió durante la revisión. Consulta nuevamente la decisión.");
  const order=(season:Tournament)=>{const record=currentResolution(season,captured.context);return record?.verification!=="verified"?undefined:captured.context.scope==="argentina-relegation"?programmeOrder(season,captured.context):record.orderedTeamIds;};
  const state=(season:Tournament)=>{const record=currentResolution(season,captured.context);return order(season)?"Resuelta":record?record.verification==="verified"?"Requiere completar partidos":"Requiere documentación":season.officialResolutions?.some(r=>r.scope===captured.context.scope && r.key===captured.context.key)?"Resolución desactualizada":"Pendiente";};
  const outcome=getDivisionOutcome(proposed);
  const effects={beforeState:state(t),afterState:state(proposed),beforeOrder:order(t),afterOrder:order(proposed),promoted:outcome.promoted,relegated:outcome.relegated.map(r=>r.teamId),pending:outcome.pending};
  const review={tournamentId,universeId,input:captured,before:t,proposed,event:events[0],effects};
  reviews.set(review,{content:JSON.stringify(review),snapshot:beforeSnapshot,id});return review;
}
/** The caller holds the application's existing global write lease. No progression is run. */
export function confirmSportsResolution(review:SportsResolutionReview,universeId:string|null,repository:TournamentRepository,confirmed:boolean):Tournament {
  const token=reviews.get(review);
  if(!confirmed || !token || token.content!==JSON.stringify(review))throw new DomainError("Se requiere una revisión íntegra y confirmación explícita; las copias o revisiones consumidas no son válidas.");
  if(universeId!==review.universeId || token.snapshot!==snapshot(repository))throw new DomainError("La biblioteca o el universo cambió. Revisa nuevamente la decisión.");
  const t=repository.findAll().find(s=>s.id===review.tournamentId)!;
  assertReviewable(t,review.input,repository.findAll(),repository.findActivity?.() ?? []);
  const confirmedAt=new Date().toISOString();
  const expected={...review.proposed,officialResolutions:review.proposed.officialResolutions?.map(record=>record.id===token.id?{...record,recordedAt:confirmedAt}:record)};
  const guarded: TournamentRepository={findAll:()=>repository.findAll(),save:()=>{throw new DomainError("La decisión requiere guardado conjunto con actividad.");},saveWithActivity:(next,event)=>{
    if(canonical(next)!==canonical(expected) || canonical({...next,officialResolutions:t.officialResolutions})!==canonical(t))throw new DomainError("La resolución dejó de corresponder a la propuesta revisada.");
    if(!repository.saveWithActivity)throw new DomainError("El repositorio no permite registrar la resolución con su actividad.");
    repository.saveWithActivity(next,{...event,id:review.event.id});
  }};
  const next=recordOfficialResolution(t,review.input,guarded,()=>new Date(confirmedAt),()=>token.id,{advanceProgression:false});
  reviews.delete(review);return next;
}

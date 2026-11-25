import { DomainError } from "../../domain/domain-error.js";
import type {TournamentRepository} from "../ports/tournament-repository";
import {isAssociationRecord,isClubAffiliationRecord,type SportingAssociation,type AssociationRecord,type ClubAffiliationRecord} from "../../domain/entities/club-affiliation";
import {associationCatalog,affiliationHistory} from "../services/club-associations";
import {clubOccurrenceKey} from "../services/club-history";
import {createActivityEvent,recordActivity} from "../services/activity-log";

export type ClubAssociationInput =
  | {kind:"association";universeId:string|null;tournamentId:string;operation:"create"|"update";revision:number;association:SportingAssociation}
  | {kind:"affiliation";universeId:string|null;tournamentId:string;teamId:string;revision:number;status:ClubAffiliationRecord["status"];associationId?:string;mode:ClubAffiliationRecord["mode"];verification:ClubAffiliationRecord["verification"];source?:ClubAffiliationRecord["source"]};
export interface ClubAssociationReview {readonly input:ClubAssociationInput;readonly record:AssociationRecord|ClubAffiliationRecord}
const reviews=new WeakMap<ClubAssociationReview,{snapshot:string;content:string}>();
const snapshot=(r:TournamentRepository)=>JSON.stringify([r.findAll(),r.findActivity?.() ?? []]);
export function reviewClubAssociation(input:ClubAssociationInput,repository:TournamentRepository,verifiedByUser=false):ClubAssociationReview {
  const before=snapshot(repository),request=structuredClone(input),t=repository.findAll().find(t=>t.id===request.tournamentId),activity=repository.findActivity?.() ?? [];
  if(!t)throw new DomainError("La competición no está disponible en este universo.");
  const catalog=associationCatalog(activity,request.universeId);
  let record:AssociationRecord|ClubAffiliationRecord;
  if(request.kind==="association"){
    const previous=catalog.find(a=>a.id===request.association.id);
    if(request.operation==="create" && previous)throw new DomainError("El identificador de asociación ya existe. Revisa sus metadatos mediante una nueva revisión explícita.");
    if(request.operation==="update" && !previous)throw new DomainError("La asociación que se desea corregir no existe.");
    if(request.revision!==(previous?.revision ?? 0)+1)throw new DomainError("La revisión de la asociación está obsoleta.");
    record={schemaVersion:1,kind:"association",universeId:request.universeId,tournamentId:t.id,revision:request.revision,association:request.association};
    if(!isAssociationRecord(record))throw new DomainError("Revisa los metadatos, la identidad de asociación y sus referencias HTTPS.");
    if((record.association.mode==="documented" && record.association.verification==="verified" || record.association.territory?.verification==="verified") && !verifiedByUser)throw new DomainError("Confirma expresamente que contrastaste los documentos de asociación y territorio indicados.");
  }else{
    const team=t.teams.find(team=>team.id===request.teamId);
    if(!team || t.teams.filter(team=>team.id===request.teamId).length!==1)throw new DomainError("La identidad del participante no existe o es ambigua dentro de la competición.");
    if(!t.competitionId || !Number.isSafeInteger(t.season))throw new DomainError("La afiliación requiere identidad persistida de competición y año de temporada.");
    const previous=affiliationHistory(t.id,team.id,activity,request.universeId);
    if(request.revision!==Math.max(0,...previous.map(r=>r.revision))+1)throw new DomainError("La revisión de la afiliación está obsoleta.");
    const association=request.status==="known"?catalog.find(a=>a.id===request.associationId):undefined;
    if(request.status==="known" && (!association || association.ambiguous))throw new DomainError("Selecciona una asociación existente sin identidad de catálogo ambigua.");
    record={schemaVersion:1,kind:"affiliation",universeId:request.universeId,tournamentId:t.id,competitionId:t.competitionId,season:t.season!,teamId:team.id,
      occurrenceKey:clubOccurrenceKey(t.id,team.id),scope:"occurrence-season",...(team.averageIdentity?.trim()?{identityToken:team.averageIdentity.trim()}:{}),revision:request.revision,status:request.status,
      ...(association?{associationId:association.id,associationRevision:association.revision}:{}),mode:request.mode,verification:request.verification,...(request.source?{source:request.source}:{})};
    if(!isClubAffiliationRecord(record))throw new DomainError("Revisa la aparición, la vigencia y la referencia HTTPS de la afiliación.");
    if(record.mode==="documented" && record.verification==="verified" && !verifiedByUser)throw new DomainError("Confirma expresamente que contrastaste la afiliación con la fuente indicada.");
  }
  const review={input:request,record};
  if(before!==snapshot(repository))throw new DomainError("La biblioteca cambió durante la revisión.");
  reviews.set(review,{snapshot:before,content:JSON.stringify(review)});return review;
}
export function confirmClubAssociation(review:ClubAssociationReview,repository:TournamentRepository,universeId:string|null,confirmed:boolean){
  const token=reviews.get(review);
  if(!confirmed || !token || token.content!==JSON.stringify(review))throw new DomainError("Se requiere una revisión íntegra y confirmación explícita.");
  if(universeId!==review.record.universeId || token.snapshot!==snapshot(repository))throw new DomainError("La revisión está obsoleta o cambió el universo. Revisa nuevamente.");
  const checked=reviewClubAssociation(review.input,repository,true);
  if(JSON.stringify(checked.record)!==JSON.stringify(review.record))throw new DomainError("La identidad, asociación o vigencia cambió desde la revisión.");
  const t=repository.findAll().find(t=>t.id===review.record.tournamentId)!,r=review.record;
  const event=createActivityEvent(t,{action:r.kind==="association"?"association-recorded":"club-affiliation-recorded",entityType:"season",
    entityId:r.kind==="association"?r.association.id:r.occurrenceKey,
    summary:r.kind==="association"?`Se registró la revisión ${r.revision} de la asociación ${r.association.name}. Declaración del usuario.`:`Se registró la afiliación de una aparición de ${t.season}, revisión ${r.revision} (${r.status}). No se propagó a otras temporadas.`,after:r});
  recordActivity(repository,{...event,...(r.universeId?{universeId:r.universeId}:{})});
  reviews.delete(review);return t;
}

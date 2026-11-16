import type {TournamentRepository} from "../ports/tournament-repository";
import {isDrawConfiguration,isSupportedAssociationRestriction,type DrawConfiguration} from "../../domain/entities/draw-configuration";
import {projectTournamentAffiliations} from "../services/club-associations";
import {emptyDrawConfiguration,latestDrawConfiguration,validateDrawConfiguration} from "../services/draw-configuration";
import {inspectDrawPreparation} from "../services/draw-and-bracket";
import {createActivityEvent,recordActivity} from "../services/activity-log";

export interface DrawConfigurationReview {readonly configuration:DrawConfiguration;readonly validation:ReturnType<typeof validateDrawConfiguration>}
const reviews=new WeakMap<DrawConfigurationReview,{content:string;snapshot:string}>();
const snapshot=(r:TournamentRepository)=>JSON.stringify([r.findAll(),r.findActivity?.() ?? []]);
export function reviewDrawConfiguration(configuration:DrawConfiguration,repository:TournamentRepository,verifiedByUser=false):DrawConfigurationReview {
  const before=snapshot(repository),all=repository.findAll(),activity=repository.findActivity?.() ?? [],c=JSON.parse(JSON.stringify(configuration)) as DrawConfiguration;
  if(!isDrawConfiguration(c))throw new Error("Estructura de configuración inválida.");
  const t=all.find(t=>t.id===c.tournamentId);if(!t)throw new Error("La temporada no existe en el universo activo.");
  const stage=inspectDrawPreparation(t,all,activity,c.universeId).stages.find(s=>s.key===c.stage);
  if(!stage || stage.kind!=="groups")throw new Error("La etapa no soporta esta configuración de bombos.");
  if(stage.latest || stage.fixtures.length || t.matchdays.some(d=>d.fixtures.length) || t.archived)throw new Error("La etapa ya tiene un sorteo, encuentros o actividad deportiva; sus fundamentos están protegidos.");
  const expected=emptyDrawConfiguration(t,c.universeId,all,activity);
  if(c.revision!==expected.revision || c.foundation!==expected.foundation)throw new Error("La configuración está obsoleta. Revisa nuevamente sus fundamentos.");
  if(c.deleted && !latestDrawConfiguration(t.id,c.stage,c.universeId,activity))throw new Error("No hay configuración registrada para eliminar.");
  if(c.mode==="documented" && c.verification==="verified" && !verifiedByUser)throw new Error("Confirma el contraste de la fuente por el usuario.");
  if(c.restrictions.some(isSupportedAssociationRestriction))c.associationDependencies={schemaVersion:1,fingerprint:projectTournamentAffiliations(t,all,activity,c.universeId).fingerprint};
  else delete c.associationDependencies;
  const validation=validateDrawConfiguration(c,t,all,activity,c.universeId);
  if(!validation.canSave)throw new Error(validation.errors.join(" "));
  const review={configuration:c,validation};
  if(snapshot(repository)!==before)throw new Error("La biblioteca cambió durante la revisión.");
  reviews.set(review,{content:JSON.stringify(review),snapshot:before});return review;
}
export function confirmDrawConfiguration(review:DrawConfigurationReview,repository:TournamentRepository,universeId:string|null,confirmed:boolean){
  const token=reviews.get(review);
  if(!confirmed || !token || token.content!==JSON.stringify(review))throw new Error("Se requiere una revisión íntegra y confirmación explícita.");
  if(universeId!==review.configuration.universeId || token.snapshot!==snapshot(repository))throw new Error("La revisión está obsoleta o cambió el universo. Revisa nuevamente.");
  reviewDrawConfiguration(review.configuration,repository,true);
  const t=repository.findAll().find(t=>t.id===review.configuration.tournamentId)!;
  recordActivity(repository,createActivityEvent(t,{action:"draw-configuration-recorded",entityType:"season",entityId:review.configuration.stage,
    summary:`${review.configuration.deleted?"Se retiró":"Se registró"} la configuración de bombos y restricciones, revisión ${review.configuration.revision}. Declaración del usuario.`,after:review.configuration}));
  reviews.delete(review);return t;
}

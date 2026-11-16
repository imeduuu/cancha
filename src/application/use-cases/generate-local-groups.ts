import type {TournamentRepository} from "../ports/tournament-repository";
import type {StageDrawRecord} from "../../domain/entities/stage-draw";
import type {DrawConfiguration} from "../../domain/entities/draw-configuration";
import {isSupportedAssociationRestriction} from "../../domain/entities/draw-configuration";
import {projectTournamentAffiliations} from "../services/club-associations";
import {inspectDrawPreparation} from "../services/draw-and-bracket";
import {latestDrawConfiguration,validateDrawConfiguration} from "../services/draw-configuration";
import {groupGenerationMethod,groupSearchResourceIssue,searchGroupDistribution,type GroupSearchOptions,type GroupSearchResult,type GroupSearchStats} from "../services/constraint-group-generator";
import {reviewStageDraw} from "./prepare-stage-draw";

export interface LocalGroupInput {tournamentId:string;universeId:string|null;stage:string;seed:string}
export interface LocalGroupProposal extends LocalGroupInput {
  readonly configurationRevision:number;readonly method:typeof groupGenerationMethod;
  readonly groups:StageDrawRecord["groups"];readonly stats:GroupSearchStats;
}
const proposals=new WeakMap<LocalGroupProposal,{snapshot:string;content:string}>();
const snapshot=(r:TournamentRepository)=>JSON.stringify([r.findAll(),r.findActivity?.() ?? []]);
interface LocalGroupInspection {reasons:string[];configuration?:DrawConfiguration;groups:StageDrawRecord["groups"];resourceLimit?:string;associationIds?:Readonly<Record<string,string>>}
export function inspectLocalGroupGeneration(input:LocalGroupInput,repository:TournamentRepository):LocalGroupInspection {
  const all=repository.findAll(),activity=repository.findActivity?.() ?? [],t=all.find(t=>t.id===input.tournamentId),reasons:string[]=[];
  if(!t)return {reasons:["La temporada no existe en el universo activo."],configuration:undefined,groups:[]};
  if(!["round-robin","staged"].includes(t.format ?? "") || !["league","cup"].includes(t.competitionType ?? ""))reasons.push("El formato y el tipo de competición deben estar registrados; no se deducen para generar grupos.");
  const view=inspectDrawPreparation(t,all,activity,input.universeId),stage=view.stages.find(s=>s.key===input.stage);
  const configuration=latestDrawConfiguration(t.id,input.stage,input.universeId,activity);
  if(!stage || stage.kind!=="groups")reasons.push("El generador solo admite grupos ya registrados; no crea etapas ni eliminatorias.");
  if(stage){reasons.push(...stage.blockers);if(stage.manualBlocker)reasons.push(stage.manualBlocker);if(stage.latest)reasons.push("Ya existe un sorteo registrado; no se sobrescribe ni se reorganiza.");}
  const resourceLimit=configuration?groupSearchResourceIssue(configuration,view.groups):undefined;
  if(!configuration || configuration.deleted)reasons.push("Registra primero una configuración completa de bombos y restricciones.");
  else if(!resourceLimit){const validation=validateDrawConfiguration(configuration,t,all,activity,input.universeId);if(validation.state!=="Válida")reasons.push(...validation.errors,...validation.incomplete,...validation.pending,...validation.unsupported);}
  if(!input.seed.trim() || input.seed.length>128)reasons.push("Registra una semilla explícita de entre 1 y 128 caracteres.");
  return {reasons:[...new Set(reasons)],configuration,groups:view.groups,resourceLimit,
    ...(configuration?.restrictions.some(isSupportedAssociationRestriction) && !reasons.length && !resourceLimit?{associationIds:projectTournamentAffiliations(t,all,activity,input.universeId).associationIds}:{})};
}
export async function generateLocalGroups(input:LocalGroupInput,repository:TournamentRepository,options:GroupSearchOptions={}):Promise<GroupSearchResult & {proposal?:LocalGroupProposal}>{
  // Freeze caller-owned values before the first asynchronous yield.
  const request={...input},before=snapshot(repository),view=inspectLocalGroupGeneration(request,repository);
  const emptyStats={nodes:0,checks:0,batches:0,elapsedMs:0};
  if(view.reasons.length || !view.configuration)return {state:"Configuración inválida",reasons:view.reasons,stats:emptyStats};
  if(view.resourceLimit)return {state:"No determinado",reasons:[view.resourceLimit,"La validación completa y la búsqueda no se iniciaron por el límite de recursos."],stats:emptyStats};
  const configuration=structuredClone(view.configuration),groups=structuredClone(view.groups);
  if(before!==snapshot(repository))return {state:"Configuración inválida",reasons:["La biblioteca cambió durante la preparación."],stats:emptyStats};
  const result=await searchGroupDistribution(configuration,groups,request.seed,{...options,associationIds:view.associationIds});
  if(before!==snapshot(repository))return {state:"Configuración inválida",reasons:["La biblioteca cambió durante la búsqueda. Revisa nuevamente."],stats:result.stats};
  if(result.state!=="Viable" || !result.groups || options.signal?.aborted)return result.state==="Viable"?{state:"No determinado",reasons:["Búsqueda cancelada."],stats:result.stats}:result;
  // Reuse the full sporting review, including integrity, capacity, documentary
  // and dependency checks. No solver is called by review or confirmation.
  const proposal:LocalGroupProposal={...request,configurationRevision:configuration.revision,method:groupGenerationMethod,groups:result.groups,stats:result.stats};
  try{reviewStageDraw({...request,mode:"generated",configurationRevision:proposal.configurationRevision,groups:proposal.groups,generation:{method:proposal.method,seed:proposal.seed}},repository);}
  catch(error){return {state:"Configuración inválida",reasons:[error instanceof Error?error.message:"La revisión deportiva rechazó la distribución."],stats:result.stats};}
  proposals.set(proposal,{snapshot:before,content:JSON.stringify(proposal)});
  return {...result,proposal};
}
export function reviewGeneratedLocalGroups(proposal:LocalGroupProposal,repository:TournamentRepository,universeId:string|null){
  const token=proposals.get(proposal);
  if(!token || token.content!==JSON.stringify(proposal) || token.snapshot!==snapshot(repository) || universeId!==proposal.universeId)throw new Error("La propuesta generada está alterada, obsoleta o pertenece a otro universo. Genera y revisa nuevamente.");
  return reviewStageDraw({tournamentId:proposal.tournamentId,universeId:proposal.universeId,stage:proposal.stage,mode:"generated",configurationRevision:proposal.configurationRevision,
    groups:proposal.groups,generation:{method:proposal.method,seed:proposal.seed}},repository);
}

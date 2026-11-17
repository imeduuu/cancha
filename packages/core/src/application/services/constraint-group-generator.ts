import type {DrawConfiguration} from "../../domain/entities/draw-configuration";
import {isSupportedAssociationRestriction} from "../../domain/entities/draw-configuration";
import type {StageDrawRecord} from "../../domain/entities/stage-draw";
import {validateManualDrawConfiguration,validateRegisteredGroupDistribution} from "./draw-configuration";

export const groupGenerationMethod="constraint-groups-v1" as const;
export type GroupFeasibility="Viable"|"Imposible"|"No determinado"|"Configuración inválida";
export interface GroupSearchStats {nodes:number;checks:number;batches:number;elapsedMs:number}
export interface GroupSearchResult {
  state:GroupFeasibility;reasons:string[];stats:GroupSearchStats;
  groups?:StageDrawRecord["groups"];
}
export interface GroupSearchOptions {
  associationIds?:Readonly<Record<string,string>>;
  maxNodes?:number;maxChecks?:number;maxTimeMs?:number;
  signal?:AbortSignal;
  /** Test seams; production always yields to the event loop and uses a monotonic clock. */
  now?:()=>number;cooperate?:()=>Promise<void>;
}
export function groupSearchResourceIssue(c:DrawConfiguration,groups:StageDrawRecord["groups"]):string|undefined {
  if(c.participantIds.length>96 || groups.length>32 || c.restrictions.length>256)return "La configuración excede los límites de recursos del solucionador local (96 participantes, 32 grupos o 256 restricciones).";
  let relations=0;
  for(const r of c.restrictions)if(r.type==="incompatible"){relations+=r.teamIds.length*r.teamIds.length;if(relations>100_000)return "La configuración excede el límite de 100.000 relaciones de incompatibilidad.";}
  return undefined;
}
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
function seededRandom(seed:string){
  let state=2166136261;
  for(let i=0;i<seed.length;i++)state=Math.imul(state^seed.charCodeAt(i),16777619);
  return ()=>{state=(state+0x6D2B79F5)|0;let n=Math.imul(state^(state>>>15),1|state);n^=n+Math.imul(n^(n>>>7),61|n);return ((n^(n>>>14))>>>0)/4294967296;};
}
function shuffle<T>(values:T[],random:()=>number){for(let i=values.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[values[i],values[j]]=[values[j],values[i]];}return values;}
export function groupDistributionIdentity(groups:StageDrawRecord["groups"],ordinalPositions=false):string {
  return JSON.stringify([...groups].sort((a,b)=>compare(a.name,b.name)).map(g=>({name:g.name,teamIds:ordinalPositions?[...g.teamIds]:[...g.teamIds].sort(compare)})));
}

/** Requires the existing application preflight. Exhaustive over group membership;
 * free ordinal slots need no search because the catalog only constrains fixed slots.
 * No attempts, restart loop, implicit seeding, country rules or probability claims.
 */
export async function searchGroupDistribution(c:DrawConfiguration,registered:StageDrawRecord["groups"],seed:string,options:GroupSearchOptions={}):Promise<GroupSearchResult>{
  const now=options.now ?? (()=>performance.now()),start=now();
  const stats:GroupSearchStats={nodes:0,checks:0,batches:0,elapsedMs:0};
  const result=(state:GroupFeasibility,reasons:string[],groups?:StageDrawRecord["groups"]):GroupSearchResult=>({state,reasons,stats:{...stats,elapsedMs:Math.max(0,now()-start)},...(groups?{groups}: {})});
  const maxNodes=options.maxNodes ?? 100_000,maxChecks=options.maxChecks ?? 2_000_000,maxTimeMs=options.maxTimeMs ?? 1500;
  if(!seed.trim() || seed.length>128 || ![maxNodes,maxChecks].every(n=>Number.isSafeInteger(n) && n>=0) || !Number.isFinite(maxTimeMs) || maxTimeMs<0)return result("Configuración inválida",["La semilla o los presupuestos de búsqueda no son válidos."]);
  const ids=[...c.participantIds].sort(compare),groups=[...registered].sort((a,b)=>compare(a.name,b.name));
  const incompatibleRules=c.restrictions.filter(r=>r.type==="incompatible");
  const associationRules=c.restrictions.filter(isSupportedAssociationRestriction);
  if(associationRules.length && ids.some(id=>typeof options.associationIds?.[id]!=="string" || !options.associationIds[id]))return result("Configuración inválida",["Faltan afiliaciones verificadas para aplicar el máximo por asociación."]);
  const associationLimit=associationRules.length?Math.min(...associationRules.map(r=>r.maxPerGroup)):Infinity;
  const associationOf=ids.map(id=>options.associationIds?.[id] ?? ""),associationCounts=groups.map(()=>new Map<string,number>());
  const resourceIssue=groupSearchResourceIssue(c,registered);
  if(resourceIssue)return result("No determinado",[resourceIssue]);
  let limit="";
  const stopped=()=>{
    if(limit)return true;
    if(options.signal?.aborted)limit="Búsqueda cancelada; no se ha demostrado imposibilidad.";
    else if(now()-start>=maxTimeMs)limit="Presupuesto de tiempo agotado; no se ha demostrado imposibilidad.";
    return !!limit;
  };
  if(stopped())return result("No determinado",[limit]);
  const random=seededRandom(seed),order=shuffle(ids.map((_,i)=>i),random),groupOrder=shuffle(groups.map((_,i)=>i),random);
  const rank=new Map(order.map((team,index)=>[team,index])),index=new Map(ids.map((id,i)=>[id,i]));
  const groupIndex=new Map(groups.map((g,i)=>[g.name,i])),bits=ids.map((_,i)=>1n<<BigInt(i));
  const forbidden=ids.map(()=>0n),assigned=ids.map(()=>-1),occupied=groups.map(()=>0n),counts=groups.map(()=>0);
  for(const rule of incompatibleRules)for(const a of rule.teamIds)for(const b of rule.teamIds)if(a!==b)forbidden[index.get(a)!]|=bits[index.get(b)!];
  const potOf=ids.map(id=>c.pots.findIndex(p=>p.teamIds.includes(id)));
  const quotas=new Map(c.restrictions.filter(r=>r.type==="pot-distribution").map(r=>[c.pots.findIndex(p=>p.id===r.potId),r.perGroup]));
  const potCounts=groups.map(()=>c.pots.map(()=>0));
  const fixed=new Map(c.restrictions.filter(r=>r.type==="fixed-position").map(r=>[index.get(r.teamId)!,{group:groupIndex.get(r.group)!,position:r.position-1}]));
  const canPlace=(team:number,g:number)=>counts[g]<groups[g].teamIds.length
    && (!fixed.has(team) || fixed.get(team)!.group===g)
    && !(forbidden[team]&occupied[g])
    && (associationCounts[g].get(associationOf[team]) ?? 0)<associationLimit
    && (!quotas.has(potOf[team]) || potCounts[g][potOf[team]]<quotas.get(potOf[team])!);
  let solution:StageDrawRecord["groups"]|undefined,invalid:string[]=[];
  function materialize(){
    return groups.map((g,gi)=>{
      const slots:(string|undefined)[]=Array.from({length:g.teamIds.length});
      const remaining=order.filter(i=>assigned[i]===gi && !fixed.has(i));
      for(const [i,position] of fixed)if(position.group===gi)slots[position.position]=ids[i];
      let cursor=0;return {name:g.name,teamIds:slots.map(id=>id ?? ids[remaining[cursor++]])};
    });
  }
  function* explore():Generator<void,boolean,void>{
    if(stopped())return false;
    if(stats.nodes>=maxNodes){limit="Presupuesto de nodos agotado; no se ha demostrado imposibilidad.";return false;}
    stats.nodes++;
    let selected=-1,domain:number[]=[];
    const available=groups.map(()=>0),potAvailable=groups.map(()=>c.pots.map(()=>0));
    for(const team of order)if(assigned[team]===-1){
      const candidates:number[]=[];
      for(const g of groupOrder){
        if(stats.checks>=maxChecks){limit="Presupuesto de comprobaciones agotado; no se ha demostrado imposibilidad.";return false;}
        stats.checks++;
        if(stats.checks%2048===0){stats.batches++;yield;if(stopped())return false;}
        if(canPlace(team,g)){candidates.push(g);available[g]++;potAvailable[g][potOf[team]]++;}
      }
      if(!candidates.length)return false;
      if(selected===-1 || candidates.length<domain.length || candidates.length===domain.length && rank.get(team)!<rank.get(selected)!){selected=team;domain=candidates;}
    }
    if(selected===-1){
      const proposal=materialize();
      invalid=[...validateRegisteredGroupDistribution(c.participantIds,registered,proposal),...validateManualDrawConfiguration(c,proposal,options.associationIds)];
      if(invalid.length)return false;
      solution=proposal;return true;
    }
    for(let g=0;g<groups.length;g++){
      const free=groups[g].teamIds.length-counts[g];
      if(available[g]<free)return false;
      let needed=0;
      for(const [pot,quota] of quotas){const missing=quota-potCounts[g][pot];if(potAvailable[g][pot]<missing)return false;needed+=missing;}
      if(needed>free)return false;
    }
    if(associationRules.length){
      const remaining=new Map<string,number>();for(const team of order)if(assigned[team]===-1)remaining.set(associationOf[team],(remaining.get(associationOf[team]) ?? 0)+1);
      for(const [association,count] of remaining){const free=groups.reduce((n,g,i)=>n+Math.min(g.teamIds.length-counts[i],associationLimit-(associationCounts[i].get(association) ?? 0)),0);if(free<count)return false;}
    }
    for(const g of domain){
      assigned[selected]=g;counts[g]++;occupied[g]|=bits[selected];potCounts[g][potOf[selected]]++;
      if(associationRules.length)associationCounts[g].set(associationOf[selected],(associationCounts[g].get(associationOf[selected]) ?? 0)+1);
      if(yield* explore())return true;
      assigned[selected]=-1;counts[g]--;occupied[g]^=bits[selected];potCounts[g][potOf[selected]]--;
      if(associationRules.length)associationCounts[g].set(associationOf[selected],associationCounts[g].get(associationOf[selected])!-1);
      if(limit || invalid.length)return false;
    }
    return false;
  }
  const search=explore(),cooperate=options.cooperate ?? (()=>new Promise<void>(resolve=>setTimeout(resolve,0)));
  let step=search.next();
  while(!step.done){await cooperate();step=search.next();}
  if(solution)return result("Viable",["Se encontró y validó íntegramente una distribución compatible."],solution);
  if(invalid.length)return result("Configuración inválida",["La validación final rechazó la propuesta; no se guardó nada.",...invalid]);
  return limit?result("No determinado",[limit]):result("Imposible",["Se exploró completamente el espacio de asignaciones de grupos sin encontrar una distribución compatible."]);
}

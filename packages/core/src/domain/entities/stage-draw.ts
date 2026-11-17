import type {KnockoutResolution, RulesVerificationStatus} from "./tournament";
import type {OfficialReference} from "./official-resolution";
import {isHttpsReference} from "../services/continental-plan";
export interface StageDrawRecord {
  readonly schemaVersion: 1;
  readonly universeId: string | null;
  readonly stage: string;
  readonly kind: "groups" | "knockout";
  readonly mode: "manual" | "documented" | "local" | "generated";
  readonly generation?: {readonly method:"constraint-groups-v1";readonly seed:string};
  readonly foundation: string;
  readonly configurationRevision?: number;
  readonly associationFoundation?: string;
  readonly groups: readonly {name:string;teamIds:readonly string[]}[];
  readonly pairs: readonly {homeTeamId:string;awayTeamId:string}[];
  readonly resolution?: KnockoutResolution;
  readonly source?: OfficialReference & {verification:RulesVerificationStatus};
}
const record=(value:unknown):value is Record<string,unknown>=>!!value && typeof value==="object" && !Array.isArray(value);
const text=(value:unknown):value is string=>typeof value==="string" && !!value.trim();
export function isStageDrawRecord(value:unknown):value is StageDrawRecord {
  if(!record(value) || value.schemaVersion!==1 || !(value.universeId===null || text(value.universeId))
    || !text(value.stage) || !text(value.foundation) || !["groups","knockout"].includes(String(value.kind))
    || !["manual","documented","local","generated"].includes(String(value.mode)) || !Array.isArray(value.groups) || !Array.isArray(value.pairs))return false;
  if(value.configurationRevision!==undefined && (!Number.isSafeInteger(value.configurationRevision) || (value.configurationRevision as number)<1))return false;
  if(value.associationFoundation!==undefined && (!text(value.associationFoundation) || value.kind!=="groups" || value.configurationRevision===undefined))return false;
  if(value.mode==="generated"){
    if(value.kind!=="groups" || value.configurationRevision===undefined || !record(value.generation)
      || value.generation.method!=="constraint-groups-v1" || !text(value.generation.seed) || value.generation.seed.length>128)return false;
  } else if(value.generation!==undefined)return false;
  if(!value.groups.every(g=>record(g) && text(g.name) && Array.isArray(g.teamIds) && g.teamIds.length>=2 && g.teamIds.every(text)))return false;
  if(new Set(value.groups.map(g=>(g as {name:string}).name)).size!==value.groups.length)return false;
  if(!value.pairs.every(p=>record(p) && text(p.homeTeamId) && text(p.awayTeamId) && p.homeTeamId!==p.awayTeamId))return false;
  if(value.kind==="groups" ? !value.groups.length || !!value.pairs.length : !value.pairs.length || !!value.groups.length)return false;
  const ids=value.kind==="groups" ? value.groups.flatMap(g=>(g as {teamIds:string[]}).teamIds):value.pairs.flatMap(p=>[(p as {homeTeamId:string}).homeTeamId,(p as {awayTeamId:string}).awayTeamId]);
  if(new Set(ids).size!==ids.length)return false;
  if(value.resolution!==undefined && !["penalties","extra-time-then-penalties","aggregate-then-penalties"].includes(String(value.resolution)))return false;
  if(value.mode==="documented" || value.source!==undefined){
    const source=value.source;
    if(!record(source) || !text(source.reference) || !text(source.url) || !["verified","pending","provisional"].includes(String(source.verification)))return false;
    if(!isHttpsReference(source.url))return false;
  }
  return true;
}

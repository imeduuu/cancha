import type {OfficialReference} from "./official-resolution";
import type {RulesVerificationStatus} from "./tournament";
import {isHttpsReference} from "../services/continental-plan";

export interface AssociationDrawRestriction {id:string;type:"association";schemaVersion:1;maxPerGroup:number;description:string}
export type DrawRestriction =
  | {id:string;type:"group-size";group:string;min:number;max:number}
  | {id:string;type:"pot-distribution";potId:string;perGroup:number}
  | {id:string;type:"incompatible";teamIds:string[]}
  | {id:string;type:"fixed-position";teamId:string;group:string;position:number}
  | {id:string;type:"unsupported";description:string}
  | {id:string;type:"association";description:string}
  | AssociationDrawRestriction;
export function isSupportedAssociationRestriction(r:DrawRestriction):r is AssociationDrawRestriction {return r.type==="association" && "schemaVersion" in r && r.schemaVersion===1;}
/** References the existing teams and groups; never owns their identity or composition. */
export interface DrawConfiguration {
  schemaVersion:1; revision:number; universeId:string|null; tournamentId:string;
  competitionId:string; season:number; stage:string; foundation:string;
  participantIds:string[];
  pots:{id:string;name:string;capacity:number;teamIds:string[]}[];
  seeding?:{basis:string;teamIds:string[]};
  restrictions:DrawRestriction[];
  associationDependencies?:{schemaVersion:1;fingerprint:string};
  mode:"local"|"documented"; verification:RulesVerificationStatus;
  source?:OfficialReference;
  deleted?:boolean;
}
const obj=(v:unknown):v is Record<string,unknown>=>!!v && typeof v==="object" && !Array.isArray(v);
const str=(v:unknown):v is string=>typeof v==="string" && !!v.trim();
const strings=(v:unknown):v is string[]=>Array.isArray(v) && v.every(str);
const num=(v:unknown):v is number=>Number.isSafeInteger(v) && (v as number)>=0;
export function isDrawConfiguration(v:unknown):v is DrawConfiguration {
  if(!obj(v) || v.schemaVersion!==1 || !num(v.revision) || v.revision<1
    || !(v.universeId===null || str(v.universeId)) || !str(v.tournamentId) || !str(v.competitionId)
    || !Number.isSafeInteger(v.season) || !str(v.stage) || !str(v.foundation) || !strings(v.participantIds)
    || !["local","documented"].includes(String(v.mode)) || !["pending","provisional","verified"].includes(String(v.verification))
    || v.deleted!==undefined && typeof v.deleted!=="boolean" || !Array.isArray(v.pots) || !Array.isArray(v.restrictions))return false;
  if(!v.pots.every(p=>obj(p) && str(p.id) && str(p.name) && num(p.capacity) && p.capacity>0 && strings(p.teamIds)))return false;
  if(v.associationDependencies!==undefined && (!obj(v.associationDependencies) || v.associationDependencies.schemaVersion!==1 || !str(v.associationDependencies.fingerprint)))return false;
  if(v.seeding!==undefined && (!obj(v.seeding) || !str(v.seeding.basis) || !strings(v.seeding.teamIds)))return false;
  if(v.mode==="documented" || v.source!==undefined){if(!obj(v.source) || !str(v.source.reference) || !str(v.source.url) || !isHttpsReference(v.source.url))return false;}
  return v.restrictions.every(r=>{
    if(!obj(r) || !str(r.id))return false;
    switch(r.type){
      case "group-size":return str(r.group) && num(r.min) && num(r.max);
      case "pot-distribution":return str(r.potId) && num(r.perGroup) && r.perGroup>0;
      case "incompatible":return strings(r.teamIds) && r.teamIds.length>=2;
      case "fixed-position":return str(r.teamId) && str(r.group) && num(r.position) && r.position>0;
      case "unsupported":return str(r.description);
      case "association":return str(r.description) && (r.schemaVersion===undefined && r.maxPerGroup===undefined || r.schemaVersion===1 && num(r.maxPerGroup) && r.maxPerGroup>0);
      default:return false;
    }
  });
}

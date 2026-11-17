import type {OfficialReference} from "./official-resolution";
import type {RulesVerificationStatus} from "./tournament";
import {isHttpsReference} from "../services/continental-plan";

export interface SportingAssociation {
  id:string;name:string;abbreviation?:string;
  organizationType:"national-association"|"sporting-organization"|"unspecified";
  territory?:{name:string;source:OfficialReference;verification:RulesVerificationStatus};
  mode:"local"|"documented";verification:RulesVerificationStatus;source?:OfficialReference;
}
export interface AssociationRecord {
  schemaVersion:1;kind:"association";universeId:string|null;tournamentId:string;
  revision:number;association:SportingAssociation;
}
export interface ClubAffiliationRecord {
  schemaVersion:1;kind:"affiliation";universeId:string|null;tournamentId:string;
  competitionId:string;season:number;teamId:string;occurrenceKey:string;
  scope:"occurrence-season";identityToken?:string;revision:number;
  status:"known"|"unknown"|"ambiguous";
  associationId?:string;associationRevision?:number;
  mode:"local"|"documented";verification:RulesVerificationStatus;source?:OfficialReference;
}
const object=(v:unknown):v is Record<string,unknown>=>!!v && typeof v==="object" && !Array.isArray(v);
const text=(v:unknown):v is string=>typeof v==="string" && !!v.trim();
const positive=(v:unknown):v is number=>Number.isSafeInteger(v) && (v as number)>0;
const verification=(v:unknown)=>["verified","pending","provisional"].includes(String(v));
export const isOfficialAffiliationReference=(v:unknown):v is OfficialReference=>object(v) && text(v.reference) && text(v.url) && isHttpsReference(v.url);
function documentation(v:Record<string,unknown>){return ["local","documented"].includes(String(v.mode)) && verification(v.verification)
  && (v.mode!=="documented" && v.source===undefined || isOfficialAffiliationReference(v.source));}
export function isAssociationRecord(v:unknown):v is AssociationRecord {
  if(!object(v) || v.schemaVersion!==1 || v.kind!=="association" || !(v.universeId===null || text(v.universeId)) || !text(v.tournamentId) || !positive(v.revision) || !object(v.association))return false;
  const a=v.association;
  return text(a.id) && text(a.name) && (a.abbreviation===undefined || text(a.abbreviation))
    && ["national-association","sporting-organization","unspecified"].includes(String(a.organizationType)) && documentation(a)
    && (a.territory===undefined || object(a.territory) && text(a.territory.name) && verification(a.territory.verification) && isOfficialAffiliationReference(a.territory.source));
}
export function isClubAffiliationRecord(v:unknown):v is ClubAffiliationRecord {
  return object(v) && v.schemaVersion===1 && v.kind==="affiliation" && (v.universeId===null || text(v.universeId))
    && text(v.tournamentId) && text(v.competitionId) && positive(v.season) && text(v.teamId) && v.scope==="occurrence-season"
    && v.occurrenceKey===JSON.stringify([v.tournamentId,v.teamId]) && positive(v.revision)
    && (v.identityToken===undefined || text(v.identityToken)) && ["known","unknown","ambiguous"].includes(String(v.status))
    && (v.status==="known"?text(v.associationId) && positive(v.associationRevision):v.associationId===undefined && v.associationRevision===undefined)
    && documentation(v);
}

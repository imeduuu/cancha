import type {NationalCupPlanning,NationalCupRegulation} from "../entities/national-cup-planning";
import type {Tournament} from "../entities/tournament";
import {canonical,isHttpsReference} from "./continental-plan";
const record=(v:unknown):v is Record<string,unknown>=>!!v && typeof v==="object" && !Array.isArray(v);
const text=(v:unknown):v is string=>typeof v==="string" && !!v.trim();
const positive=(v:unknown):v is number=>typeof v==="number" && Number.isSafeInteger(v) && v>0;
const verification=(v:unknown)=>["verified","provisional","pending"].includes(String(v));
const date=(v:unknown)=>text(v) && Number.isFinite(Date.parse(v));
const unique=(v:unknown,test:(value:unknown)=>boolean):v is unknown[]=>Array.isArray(v) && v.every(test) && new Set(v).size===v.length;
export function isNationalCupRegulation(v:unknown):v is NationalCupRegulation {
 return record(v) && text(v.id) && date(v.at) && text(v.competitionId) && positive(v.edition) && verification(v.verification)
 && (v.sourceUrl===undefined || isHttpsReference(v.sourceUrl)) && (v.verification!=="verified" || isHttpsReference(v.sourceUrl))
 && text(v.note) && positive(v.expectedParticipants) && Array.isArray(v.criteria)
 && new Set(v.criteria.map(c=>record(c)?c.id:undefined)).size===v.criteria.length
 && v.criteria.every(c=>record(c) && text(c.id) && ["division","positions","champion","explicit","pending"].includes(String(c.kind))
  && text(c.description) && positive(c.count) && verification(c.verification)
  && (c.sourceUrl===undefined || isHttpsReference(c.sourceUrl)) && (c.verification!=="verified" || isHttpsReference(c.sourceUrl))
  && (c.sourceTournamentId===undefined || text(c.sourceTournamentId)) && (c.sourceCompetitionId===undefined || text(c.sourceCompetitionId))
  && (c.sourceSeason===undefined || positive(c.sourceSeason)) && (c.teamIds===undefined || unique(c.teamIds,text))
  && (c.positions===undefined || unique(c.positions,positive))
  && (c.kind==="pending" || text(c.sourceTournamentId) && text(c.sourceCompetitionId) && positive(c.sourceSeason))
  && (c.kind!=="explicit" || Array.isArray(c.teamIds) && c.teamIds.length===c.count)
  && (c.kind!=="positions" || Array.isArray(c.positions) && c.positions.length===c.count)
  && (c.kind!=="champion" || c.count===1));
}
export function isNationalCupPlanning(v:unknown):v is NationalCupPlanning {
 if(!record(v) || v.schemaVersion!==1 || (v.requiresReview!==undefined && typeof v.requiresReview!=="boolean")
  || !Array.isArray(v.regulations) || !v.regulations.every(isNationalCupRegulation) || !Array.isArray(v.reviews))return false;
 const ids=[...v.regulations.map(r=>r.id)];
 for(const r of v.reviews){
  if(!record(r) || !text(r.id) || !date(r.at) || !["incorporated","review"].includes(String(r.mode)) || !text(r.regulationTournamentId)
   || !isNationalCupRegulation(r.regulation) || r.regulation.verification!=="verified" || !Array.isArray(r.dependencies) || !Array.isArray(r.participants))return false;
  const regulation=r.regulation,dependencies=r.dependencies,participants=r.participants;
  if(!regulation.criteria.length || regulation.criteria.some(c=>c.verification!=="verified" || c.kind==="pending")
   || regulation.criteria.reduce((n,c)=>n+c.count,0)!==regulation.expectedParticipants
   || !dependencies.every(d=>record(d) && text(d.tournamentId) && text(d.snapshot) && (()=>{try{const parsed:unknown=JSON.parse(d.snapshot);return record(parsed) && parsed.id===d.tournamentId;}catch{return false;}})()))return false;
  if(new Set(dependencies.map(d=>d.tournamentId)).size!==dependencies.length || r.participants.length!==regulation.expectedParticipants
   || !r.participants.every(e=>record(e) && text(e.criterionId)
    && regulation.criteria.some(c=>c.id===e.criterionId && c.sourceTournamentId===e.sourceTournamentId && c.sourceSeason===e.sourceSeason && (c.kind!=="explicit" || c.teamIds?.includes(String(e.teamId))))
    && text(e.teamId) && text(e.teamName) && e.status==="confirmed" && ["local","provider","unknown"].includes(String(e.scenario))
    && dependencies.some(d=>d.tournamentId===e.sourceTournamentId))
   || new Set(r.participants.map(e=>e.teamId)).size!==r.participants.length
   || regulation.criteria.some(c=>participants.filter(e=>e.criterionId===c.id).length!==c.count)
   || !dependencies.some(d=>d.tournamentId===r.regulationTournamentId))return false;
  ids.push(r.id);
 }
 return new Set(ids).size===ids.length;
}
export function validateNationalCupPlanning(t:Tournament):string[]{
 const p=t.nationalCupPlanning;if(p===undefined)return [];
 return isNationalCupPlanning(p) && t.competitionType==="cup" && (p.requiresReview ||
  p.regulations.every(r=>r.competitionId===(t.competitionId ?? t.id.replace(/-\d{4}$/, ""))) && p.reviews.every(r=>r.regulation.edition===t.season && r.regulation.competitionId===(t.competitionId ?? t.id.replace(/-\d{4}$/, ""))))
 ? []:["Registro documental de copa nacional inválido o incompatible."];
}
/** Exclude documentary histories to avoid recursive snapshots on successive reviews. */
export function nationalCupDependencySnapshot(t:Tournament){const {nationalCupPlanning:_plans,...data}=t;return canonical(data);}

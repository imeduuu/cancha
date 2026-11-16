import type {Tournament} from "../../domain/entities/tournament";
import type {ActivityEvent} from "../../domain/entities/activity-event";
import type {NationalCupEntry,NationalCupReview} from "../../domain/entities/national-cup-planning";
import {canonical} from "../../domain/services/continental-plan";
import {nationalCupDependencySnapshot} from "../../domain/services/national-cup-planning";
import {getFinalStandings,getTournamentCompletionStatus} from "../../domain/services/tournament-history";
import {calculateStandings,getUnresolvedStandingsTieGroups} from "../../domain/services/standings";
import {hasCompleteDivisionLeague} from "../../domain/services/second-division-progression";
import {secondDivisionKind} from "../../domain/services/second-division-rules";
import {calculateTournamentStatistics} from "../../domain/services/tournament-statistics";
import {buildClubProfiles,clubOccurrenceKey} from "./club-history";
import {competitionIdentity} from "./competition-center";
import {sourceScenario} from "./continental-projection";
export interface NationalCupSelection {regulationId:string;targetId?:string}
export function nationalCupReviewState(review:NationalCupReview,tournaments:readonly Tournament[],activity?:readonly ActivityEvent[]){
 const holder=tournaments.find(t=>t.id===review.regulationTournamentId);
 const current=holder?.nationalCupPlanning?.regulations.filter(r=>r.edition===review.regulation.edition).at(-1);
 return holder?.nationalCupPlanning?.requiresReview || canonical(current)!==canonical(review.regulation)
  || activity && review.participants.some(e=>{const t=tournaments.find(t=>t.id===e.sourceTournamentId);return !t || sourceScenario(t,activity)!==e.scenario;})
  || review.dependencies.some(d=>{const t=tournaments.find(t=>t.id===d.tournamentId);return !t || nationalCupDependencySnapshot(t)!==d.snapshot;})
  ? "Dependencia desactualizada":"Dependencias coincidentes; planificación local";
}
export function projectNationalCup(holder:Tournament,edition:number,selection:NationalCupSelection,tournaments:readonly Tournament[],activity:readonly ActivityEvent[]){
 const regulation=holder.nationalCupPlanning?.regulations.find(r=>r.id===selection.regulationId);
 const blockers:string[]=[],pending:string[]=[],entries:NationalCupEntry[]=[];
 const dependencies=new Set<string>([holder.id]);
 const fail=(s:string)=>blockers.push(s);
 if(holder.competitionType!=="cup" || competitionIdentity(holder).startsWith("conmebol-") || !holder.competitionId && competitionIdentity(holder)===holder.id)fail("Selecciona una copa nacional con identificador de competición registrado.");
 if(!regulation || regulation.edition!==edition || regulation.competitionId!==competitionIdentity(holder))fail("Falta un reglamento registrado aplicable a esta edición; no se hereda el de otro año.");
 if(holder.nationalCupPlanning?.requiresReview)fail("El registro documental es una copia que requiere revisión expresa.");
 if(regulation){
  if(holder.nationalCupPlanning?.regulations.filter(r=>r.edition===edition).at(-1)?.id!==regulation.id)fail("Reglamento sustituido por una revisión posterior de esta edición; conserva el antecedente y elige la revisión vigente.");
  if(regulation.verification!=="verified")fail("Reglamento de participación pendiente de verificación manual.");
  if(!regulation.criteria.length || regulation.criteria.reduce((sum,c)=>sum+c.count,0)!==regulation.expectedParticipants)fail("El reglamento no acredita todos los cupos previstos.");
  for(const c of regulation.criteria){
   if(c.verification!=="verified")fail(`${c.description}: criterio provisional o pendiente de verificación.`);
   if(c.kind==="pending"){pending.push(`${c.count} cupo(s): ${c.description}`);fail(`${c.description}: cupo pendiente de resolución.`);continue;}
   const origin=tournaments.find(t=>t.id===c.sourceTournamentId);if(c.sourceTournamentId)dependencies.add(c.sourceTournamentId);
   if(!origin || origin.season!==c.sourceSeason || competitionIdentity(origin)!==c.sourceCompetitionId || (origin.season ?? Infinity)>edition){fail(`${c.description}: origen, competición o temporada incompatible.`);continue;}
   let ids:readonly string[]=[];
   if(c.kind==="division"){
    if(origin.competitionType==="cup" || origin.importCoverage!=="complete"){fail(`${c.description}: nómina de división sin cobertura completa registrada.`);continue;}ids=origin.teams.map(t=>t.id);
   }else if(c.kind==="explicit")ids=c.teamIds ?? [];
   else{
    if(origin.importCoverage==="partial" || origin.importCoverage==="unknown" || origin.competitionRules?.season!==origin.season
     || origin.competitionRules?.verification.standings!=="verified" || origin.competitionRules?.verification.placements!=="verified"){
     fail(`${c.description}: reglamento o cobertura de clasificación pendiente.`);continue;}
    if(c.kind==="champion"){
     const champion=calculateTournamentStatistics(origin).championTeamId;
     if(getTournamentCompletionStatus(origin)!=="Finalizado" || !champion){fail(`${c.description}: campeonato o desempate pendiente.`);continue;}ids=[champion];
    }else{
     const table=secondDivisionKind(origin) && hasCompleteDivisionLeague(origin)
      ? calculateStandings({...origin,matchdays:origin.matchdays.filter(d=>d.phaseName==="Fase regular")}):getFinalStandings(origin);
     if(!table){fail(`${c.description}: clasificación completa no acreditada para este formato; no se aplana una copa o sus fases.`);continue;}
     const positions=c.positions ?? [],selected=positions.flatMap(p=>table[p-1]?[table[p-1].teamId]:[]);
     const regular=secondDivisionKind(origin)?{...origin,matchdays:origin.matchdays.filter(d=>d.phaseName==="Fase regular")}:origin;
     if(getUnresolvedStandingsTieGroups(regular,table).some(tie=>tie.some(row=>selected.includes(row.teamId)))){fail(`${c.description}: desempate de posición pendiente.`);continue;}ids=selected;
    }
   }
   if(ids.length!==c.count){fail(`${c.description}: la cantidad de participantes no coincide con los cupos documentados.`);continue;}
   for(const id of ids){const team=origin.teams.find(t=>t.id===id);if(!team){fail(`${c.description}: participante registrado no disponible (${id}).`);continue;}
    entries.push({criterionId:c.id,sourceTournamentId:origin.id,sourceSeason:origin.season!,teamId:team.id,teamName:team.name,
     status:regulation.verification==="verified" && c.verification==="verified"?"confirmed":"provisional",scenario:sourceScenario(origin,activity)});
   }
  }
 }
 const profiles=buildClubProfiles(tournaments),byOccurrence=new Map(profiles.flatMap(p=>p.occurrences.map(o=>[o.key,p] as const)));
 const identities=entries.map(e=>byOccurrence.get(clubOccurrenceKey(e.sourceTournamentId,e.teamId)));
 if(identities.some(p=>!p || p.warning))fail("Identidad histórica ambigua o contradictoria en los participantes.");
 if(new Set(identities.map(p=>p?.key)).size!==entries.length || new Set(entries.map(e=>e.teamName.trim().toLocaleLowerCase("es"))).size!==entries.length)fail("Participantes duplicados: no se reasignan cupos automáticamente.");
 if(regulation && entries.length!==regulation.expectedParticipants)fail("Participantes insuficientes para la nómina documentada.");
 const targets=tournaments.filter(t=>competitionIdentity(t)===competitionIdentity(holder) && t.season===edition);
 const target=targets.find(t=>t.id===selection.targetId);
 if(targets.length && !target)fail("La edición ya existe: selecciona expresamente el destino para revisar discrepancias sin reemplazarlo.");
 if(target?.nationalCupPlanning?.requiresReview)fail("El destino es una copia con documentación pendiente de revisión; no se reactiva al confirmar otra operación.");
 if(target && target.competitionType!=="cup")fail("El destino no tiene formato de copa registrado.");
 if(selection.targetId && !target)fail("Destino incompatible con la copa y edición seleccionadas.");
 const chosenKeys=new Set(identities.map(p=>p?.key));
 const targetKeys=new Set(target?.teams.map(t=>byOccurrence.get(clubOccurrenceKey(target.id,t.id))?.key));
 const differences=target?{missing:entries.filter((_,i)=>!targetKeys.has(identities[i]?.key)).map(e=>e.teamName),additional:target.teams.filter(t=>!chosenKeys.has(byOccurrence.get(clubOccurrenceKey(target.id,t.id))?.key)).map(t=>t.name)}:undefined;
 return {regulation,entries,pending,blockers:[...new Set(blockers)],dependencies:[...dependencies],targets,target,differences,canPrepare:!blockers.length,
  snapshots:[...dependencies].flatMap(id=>{const t=tournaments.find(t=>t.id===id);return t?[{tournamentId:id,snapshot:nationalCupDependencySnapshot(t)}]:[]})};
}

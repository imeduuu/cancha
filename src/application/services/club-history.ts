import type { Team } from "../../domain/entities/team";
import type { Matchday, Tournament } from "../../domain/entities/tournament";
import type { ActivityEvent } from "../../domain/entities/activity-event";
import { calculateStandings, getUnresolvedStandingsTieGroups, type TeamStanding } from "../../domain/services/standings";
import { getFinalStandings, getTournamentCompletionStatus } from "../../domain/services/tournament-history";
import { isValidPlayedFixture } from "../../domain/services/tournament-statistics";
import { secondDivisionKind } from "../../domain/services/second-division-rules";
import { getDivisionOutcome, hasCompleteDivisionLeague } from "../../domain/services/second-division-progression";
import { getDivisionTransition } from "../../domain/services/division-season-transition";
import { calculateRelegationAverages } from "../../domain/services/relegation-averages";
import { canonical } from "../../domain/services/continental-plan";
import { normalizeTeamName } from "../../domain/services/team-name";
import { competitionIdentity, groupCompetitions, recordedSeasonMovements, seasonOrigins } from "./competition-center";
import { continentalPlanState, nationalContinentalProjection, sourceScenario } from "./continental-projection";

export const clubOccurrenceKey = (tournamentId:string,teamId:string) => JSON.stringify([tournamentId,teamId]);
export interface ClubOccurrence { readonly key:string; readonly tournament:Tournament; readonly team:Team }
export interface ClubProfile {
  readonly key:string;
  readonly names:readonly string[];
  readonly teamIds:readonly string[];
  readonly historicalIdentities:readonly string[];
  readonly occurrences:readonly ClubOccurrence[];
  readonly warning?:string;
}
/** Only stable IDs, explicit identity tokens and recorded continental roster references link records. */
export function buildClubProfiles(tournaments:readonly Tournament[]):ClubProfile[] {
  const occurrences=tournaments.flatMap(tournament => tournament.teams.map(team => ({key:clubOccurrenceKey(tournament.id,team.id),tournament,team})));
  const parents=occurrences.map((_,i)=>i);
  const root=(i:number):number => parents[i]===i ? i : (parents[i]=root(parents[i]));
  const join=(a:number,b:number) => {parents[root(b)]=root(a);};
  const byId=new Map<string,number>(),byIdentity=new Map<string,number>();
  occurrences.forEach((o,i)=>{
    const sameId=byId.get(o.team.id); if(sameId!==undefined)join(i,sameId);else byId.set(o.team.id,i);
    const token=o.team.averageIdentity?.trim();
    if(token){const same=byIdentity.get(token);if(same!==undefined)join(i,same);else byIdentity.set(token,i);}
  });
  const byKey=new Map(occurrences.map((o,i)=>[o.key,i]));
  for(const target of tournaments) for(const plan of target.continentalPlans ?? []) {
    if(plan.requiresReview || plan.mode!=="incorporated")continue;
    for(const entry of plan.entries){
      const a=entry.targetTeamId ? byKey.get(clubOccurrenceKey(target.id,entry.targetTeamId)) : undefined;
      const b=byKey.get(clubOccurrenceKey(entry.originTournamentId,entry.sourceTeamId));
      if(a!==undefined && b!==undefined)join(a,b);
    }
  }
  const components=new Map<number,ClubOccurrence[]>();
  occurrences.forEach((o,i)=>{const id=root(i);components.set(id,[...(components.get(id) ?? []),o]);});
  const profiles:ClubProfile[]=[];
  const append=(items:ClubOccurrence[],warning?:string)=>{
    const ordered=[...items].sort((a,b)=>(a.tournament.season ?? Number.MAX_SAFE_INTEGER)-(b.tournament.season ?? Number.MAX_SAFE_INTEGER)
      || a.tournament.createdAt.localeCompare(b.tournament.createdAt) || a.key.localeCompare(b.key));
    profiles.push({key:[...items.map(o=>o.key)].sort()[0],names:[...new Set(ordered.map(o=>o.team.name))],teamIds:[...new Set(items.map(o=>o.team.id))].sort(),
      historicalIdentities:[...new Set(items.flatMap(o=>o.team.averageIdentity ? [o.team.averageIdentity]:[]))],occurrences:ordered,...(warning?{warning}: {})});
  };
  for(const items of components.values()){
    const duplicateTournament=new Set(items.map(o=>o.tournament.id)).size!==items.length;
    const contradictoryTokens=new Set(items.flatMap(o=>o.team.averageIdentity?.trim() ? [o.team.averageIdentity.trim()]:[])).size>1;
    if(duplicateTournament || contradictoryTokens)items.forEach(o=>append([o],"Identidad histórica ambigua o contradictoria: los registros se mantienen separados."));else append(items);
  }
  return profiles.sort((a,b)=>a.names[a.names.length-1].localeCompare(b.names[b.names.length-1],"es") || a.key.localeCompare(b.key));
}
export type ClubScopeKind="league"|"group"|"knockout"|"unclassified";
export interface ClubHistoryScope {
  readonly key:string;
  readonly kind:ClubScopeKind;
  readonly phase:string;
  readonly phaseName?:string;
  readonly group?:string;
  readonly metrics:TeamStanding;
  readonly scheduled:number;
  readonly position?:number;
  readonly positionStatus:string;
  readonly coverage:string;
  readonly compatibility:string;
  readonly tournamentId:string;
  readonly season?:number;
  readonly pointsApplicable:boolean;
}
function scopeKind(t:Tournament,days:readonly Matchday[]):ClubScopeKind {
  const phase=days[0]?.phaseName;
  if(secondDivisionKind(t))return phase==="Fase regular" ? "league":"knockout";
  if(competitionIdentity(t)==="arg-liga-profesional" && t.season===2026)return phase?.endsWith("Fase regular") ? "league":"knockout";
  if(t.knockoutStages?.some(stage=>phase===stage.name || phase?.startsWith(`${stage.name} · `))
    || days.some(day=>day.fixtures.some(f=>f.knockoutResolution!==undefined)))return "knockout";
  if(t.teams.some(team=>team.groupName))return "group";
  if(t.competitionType!=="cup" && t.format!=="staged")return "league";
  return "unclassified";
}
export function clubHistoryScopes(t:Tournament,team:Team,activity:readonly ActivityEvent[]):ClubHistoryScope[] {
  const phases=[...new Set(t.matchdays.filter(d=>d.fixtures.some(f=>f.homeTeamId===team.id || f.awayTeamId===team.id)).map(d=>d.phaseName))];
  return phases.map(phase=>{
    const days=t.matchdays.filter(d=>d.phaseName===phase);
    const kind=scopeKind(t,days),group=kind!=="knockout" ? team.groupName:undefined;
    const teams=group ? t.teams.filter(candidate=>candidate.groupName===group):t.teams;
    const scope:Tournament={...t,teams,matchdays:days};
    // Full original matchdays are required to validate aggregate scores in return legs.
    const standings=calculateStandings(scope,t.matchdays),metrics=standings.find(row=>row.teamId===team.id)!;
    const fixtures=days.flatMap(day=>day.fixtures.filter(f=>f.homeTeamId===team.id || f.awayTeamId===team.id));
    const played=fixtures.filter(f=>days.some(day=>day.fixtures.includes(f) && isValidPlayedFixture(t,day,f))).length;
    const pointsApplicable=kind==="league" || kind==="group";
    const tied=pointsApplicable && getUnresolvedStandingsTieGroups(scope,standings,t.matchdays).some(tie=>tie.some(row=>row.teamId===team.id));
    const verified=t.competitionRules?.season===t.season && t.competitionRules?.verification.standings==="verified";
    const final=verified && !tied && (secondDivisionKind(t) ? hasCompleteDivisionLeague(t):Boolean(getFinalStandings(t)));
    const completeCoverage=played===fixtures.length && fixtures.length>0 && t.importCoverage!=="partial" && t.importCoverage!=="unknown"
      && (Boolean(getFinalStandings(t)) || Boolean(secondDivisionKind(t) && hasCompleteDivisionLeague(t)) || kind==="knockout" && getTournamentCompletionStatus(t)==="Finalizado");
    const phaseLabel=phase ?? "Sin fase registrada";
    const points=t.pointsSystem ?? t.competitionRules?.points ?? {win:3,draw:1,loss:0};
    return {key:JSON.stringify([t.id,team.id,phase ?? null,group ?? null]),kind,phase:phaseLabel,phaseName:phase,...(group?{group}: {}),metrics,scheduled:fixtures.length,
      ...(pointsApplicable && !tied ? {position:standings.findIndex(row=>row.teamId===team.id)+1}: {}),
      positionStatus:!pointsApplicable ? "Sin posición de liga para esta fase":tied ? "Pendiente por empate":final ? "Final calculada de la tabla":"Provisional",
      coverage:completeCoverage ? "Calendario y resultados acreditados para esta tabla":"Parcial o cobertura no acreditada",
      compatibility:canonical({competition:competitionIdentity(t),kind,phase:phaseLabel,group,format:t.format ?? "round-robin",type:t.competitionType ?? "league",legs:t.legs,
        points:pointsApplicable?points:null,scenario:sourceScenario(t,activity),verification:t.competitionRules?.verification.standings ?? "pending",tieBreakers:t.tieBreakers,configuredTieBreakers:t.competitionRules?.tieBreakers}),
      tournamentId:t.id,season:t.season,pointsApplicable};
  });
}
export function accumulateClubScopes(scopes:readonly ClubHistoryScope[]) {
  if(!scopes.length)return {error:"Selecciona registros concretos para calcular un acumulado; no se suman torneos automáticamente."};
  if(scopes.some(s=>s.season===undefined))return {error:"Un registro no tiene temporada explícita; no se acumula con otros años."};
  if(new Set(scopes.map(s=>s.compatibility)).size!==1)return {error:"La selección mezcla competiciones, escenarios, fases, grupos, formatos o criterios de puntos distintos."};
  if(new Set(scopes.map(s=>s.season)).size!==scopes.length)return {error:"Hay más de un registro de la misma temporada. Elige una sola versión para evitar duplicados."};
  const totals={played:0,wins:0,draws:0,losses:0,goalsFor:0,goalsAgainst:0,points:0};
  for(const s of scopes)for(const key of Object.keys(totals) as (keyof typeof totals)[])totals[key]+=s.metrics[key];
  return {totals,pointsApplicable:scopes[0].pointsApplicable,partial:scopes.filter(s=>s.coverage.startsWith("Parcial")).length,
    seasons:scopes.map(s=>s.season),tournamentIds:scopes.map(s=>s.tournamentId)};
}
export function projectClubHistory(profile:ClubProfile,tournaments:readonly Tournament[],activity:readonly ActivityEvent[]) {
  const metadata=new Map(groupCompetitions(tournaments).flatMap(g=>g.seasons.map(t=>[t.id,{competition:g.name,category:g.category,territory:g.territory}] as const)));
  const projections=tournaments.filter(t=>t.competitionRules?.internationalQualification || t.placementRules?.libertadoresPlaces
    || t.placementRules?.libertadoresQualifyingPlaces || t.placementRules?.sudamericanaPlaces)
    .map(source=>({source,result:nationalContinentalProjection(source,tournaments,activity)}));
  return profile.occurrences.map(({tournament:t,team,key})=>{
    const scopes=clubHistoryScopes(t,team,activity),movements:string[]=[],pending:string[]=[];
    if(secondDivisionKind(t)){
      const outcome=getDivisionOutcome(t);if(outcome.promoted.includes(team.id))movements.push("Ascenso determinado por el cálculo actual");
      const relegated=outcome.relegated.find(r=>r.teamId===team.id);if(relegated)movements.push(`Descenso calculado: ${relegated.destination}`);
      pending.push(...outcome.pending);
    }
    if(t.competitionRules?.relegationAverage){
      const averages=calculateRelegationAverages(t,tournaments,t.competitionRules.relegationAverage);
      const row=averages.standings.find(row=>row.teamId===team.id);if(row?.relegation)movements.push(`Descenso por promedios: ${row.status}`);
      pending.push(...averages.pendingReasons);
    }
    for(const future of tournaments){
      const origins=seasonOrigins(future,activity);if(!origins.includes(t.id))continue;
      const sources=origins.flatMap(id=>tournaments.filter(t=>t.id===id));
      const upper=sources.find(s=>["arg-liga-profesional","brasileirao-serie-a"].includes(competitionIdentity(s)));
      const lower=sources.find(s=>Boolean(secondDivisionKind(s)));
      const record=recordedSeasonMovements(future,activity);
      if(record && lower && upper){
        if(t.id===lower.id && record.promoted.includes(team.id))movements.push(`Ascenso registrado al preparar ${future.season ?? "sin año"} · ${record.at}`);
        if((t.id===upper.id && record.upperRelegated.includes(team.id)) || (t.id===lower.id && record.lowerRelegated.includes(team.id)))movements.push(`Descenso registrado al preparar ${future.season ?? "sin año"} · ${record.at}`);
      }
      if(upper?.id===t.id && lower){const current=getDivisionTransition(upper,lower,tournaments);if(current.upperRelegated.includes(team.id))movements.push("Descenso determinado por la transición actual");pending.push(...current.pending);}
    }
    const qualifications=projections.flatMap(p=>p.result.entries.filter(e=>e.originTournamentId===t.id && e.sourceTeamId===team.id));
    const internationalPending=[...new Set(projections.filter(p=>p.source.id===t.id
      || p.source.competitionRules?.internationalQualification?.cupChampions?.some(c=>c.sourceTournamentId===t.id)).flatMap(p=>p.result.reasons))];
    const documents=tournaments.flatMap(cup=>(cup.continentalPlans ?? []).flatMap(plan=>plan.entries.filter(e=>
      e.originTournamentId===t.id && e.sourceTeamId===team.id || cup.id===t.id && e.targetTeamId===team.id)
      .map(entry=>({cup,plan,entry,state:continentalPlanState(plan,tournaments,activity)}))));
    return {key,tournament:t,team,...metadata.get(t.id)!,scopes,movements:[...new Set(movements)],pending:[...new Set(pending)],qualifications,internationalPending,documents,
      scenario:sourceScenario(t,activity),status:getTournamentCompletionStatus(t),sameNameProfilesNotice:"Las coincidencias de nombre no acreditan identidad ni continuidad oficial."};
  });
}
/** Informational only; never used to join identities. */
export function similarlyNamedProfiles(profile:ClubProfile,profiles:readonly ClubProfile[]) {
  const names=new Set(profile.names.map(normalizeTeamName));
  return profiles.filter(p=>p.key!==profile.key && p.names.some(name=>names.has(normalizeTeamName(name))));
}

import {projectNationalCup,nationalCupReviewState} from "./national-cup-planning";
import {evaluateSeasonClosure} from "./season-closure";
import {isChileanAscenso} from "../../domain/services/chilean-ascenso-playoff-progression";
import type {Tournament} from "../../domain/entities/tournament";
import type {Team} from "../../domain/entities/team";
import type {ActivityEvent} from "../../domain/entities/activity-event";
import type {ContinentalCup} from "../../domain/entities/continental-plan";
import {canonical,isHttpsReference} from "../../domain/services/continental-plan";
import {getDivisionTransition} from "../../domain/services/division-season-transition";
import {secondDivisionKind} from "../../domain/services/second-division-rules";
import {seasonCompetition} from "../../domain/services/season-preparation";
import {canStartNewSeason,getTournamentCompletionStatus} from "../../domain/services/tournament-history";
import {hasUnverifiedCompetitionRules} from "../../domain/services/competition-rules";
import {calculateTournamentStatistics,isValidPlayedFixture} from "../../domain/services/tournament-statistics";
import {calculateStandings,getUnresolvedStandingsTieGroups} from "../../domain/services/standings";
import {normalizeTeamName} from "../../domain/services/team-name";
import {validateTournamentIntegrity} from "../../domain/services/tournament-integrity";
import {buildClubProfiles,clubOccurrenceKey} from "./club-history";
import {competitionIdentity,seasonOrigins,seasonOverview} from "./competition-center";
import {userFacingLabels} from "./user-facing-labels";
import {continentalProjection,nationalContinentalProjection,continentalPlanState,entryKey,sourceScenario} from "./continental-projection";

export type PlanningState="Lista para revisión"|"Pendiente de resultados"|"Pendiente de desempate"|"Pendiente de reglamento"|"Pendiente de participantes"|"Conflicto de identidad"|"Dependencia desactualizada"|"Planificación local";
export interface SeasonPlanningInput {
 mode:"roster"|"divisions"|"continental"|"national-cup";sourceId:string;targetSeason:number;qualifyingSeason?:number;partnerId?:string;cup?:ContinentalCup;
 regulationId?:string;sourceIds?:readonly string[];selectedKeys?:readonly string[];targetId?:string;incoming?:readonly Team[];sourceUrl?:string;note?:string;carryRoster?:boolean;
 /** Active sports universe: closure confirmations are only valid inside it. */
 universeId?:string|null;
}
export interface PlannedParticipant {key:string;teamId?:string;originId?:string;name:string;role:string;status:"confirmed"|"provisional"|"pending";competitionId:string;clubKey?:string;scenario:ReturnType<typeof sourceScenario>;selected:boolean;identityConflict?:boolean}
export function planningLibrarySnapshot(tournaments:readonly Tournament[],activity:readonly ActivityEvent[]){return canonical({tournaments:[...tournaments].sort((a,b)=>a.id.localeCompare(b.id)),activity});}
/** Query only. Relationships come from stored references or explicit choices for this prospective review. */
export function projectSeasonPlanning(input:SeasonPlanningInput,tournaments:readonly Tournament[],activity:readonly ActivityEvent[]){
 const states=new Set<PlanningState>(["Planificación local"]),blockers:string[]=[],notes:string[]=[],participants:PlannedParticipant[]=[],movements:{name:string;originId:string;role:string;teamId:string}[]=[];
 const dependencies:{id:string;reason:string;recorded:boolean}[]=[];
 const block=(state:PlanningState,message:string)=>{states.add(state);blockers.push(message);};
 const source=tournaments.find(t=>t.id===input.sourceId),partner=tournaments.find(t=>t.id===input.partnerId);
 const profiles=buildClubProfiles(tournaments),profileMap=new Map(profiles.flatMap(p=>p.occurrences.map(o=>[o.key,p] as const)));
 const add=(t:Tournament,team:Team,role:string,status:PlannedParticipant["status"],competitionId=competitionIdentity(t),selected=true)=>{
  const profile=profileMap.get(clubOccurrenceKey(t.id,team.id));
  if(profile?.warning){states.add("Conflicto de identidad");if(selected)block("Conflicto de identidad",`${team.name}: identidad histórica contradictoria; revisa ${t.name}.`);else notes.push(`${team.name}: identidad contradictoria, no seleccionable.`);}
  participants.push({key:clubOccurrenceKey(t.id,team.id),teamId:team.id,originId:t.id,name:team.name,role,status,competitionId,clubKey:profile?.key,scenario:sourceScenario(t,activity),selected,identityConflict:!!profile?.warning});
 };
 const dependency=(id:string,reason:string,recorded:boolean)=>{if(!dependencies.some(d=>d.id===id && d.reason===reason))dependencies.push({id,reason,recorded});};
 // A confirmed simulated closure is the foundation of a simulated next season (never an official one).
 const closures=new Map<string,{confirmed:boolean;simulated:boolean}>();
 const closureOf=(t:Tournament)=>{let c=closures.get(t.id);if(!c){const e=evaluateSeasonClosure(t,tournaments,activity,input.universeId ?? null);c={confirmed:e.confirmed,simulated:e.closureTier==="simulated"};closures.set(t.id,c);}return c;};
 const simulatedClosed=(t:Tournament)=>{const c=closureOf(t);return c.confirmed && c.simulated;};
 let simulatedSources=false;
 const suggestedIncoming:string[]=[];
 if(!["roster","divisions","continental","national-cup"].includes(input.mode))block("Pendiente de reglamento","El flujo de planificación no está soportado.");
 if(!source)block("Pendiente de participantes","Selecciona una temporada de origen disponible.");
 if(!Number.isSafeInteger(input.targetSeason) || input.targetSeason<1 || input.mode!=="continental" && input.mode!=="national-cup" && source?.season!==undefined && input.targetSeason<=source.season)block("Pendiente de reglamento","Indica expresamente un año/edición de destino posterior; no se deduce una periodicidad.");
 if(source)dependency(source.id,"Origen elegido para la vista previa",false);
 if(source){
  for(const parent of tournaments.filter(t=>t.competitionRules?.internationalQualification?.cupChampions?.some(c=>c.sourceTournamentId===source.id)))dependency(parent.id,"Competición que registra una clasificación por esta copa",true);
  for(const id of seasonOrigins(source,activity))dependency(id,"Antecedente histórico registrado del origen",true);
  for(const plan of source.continentalPlans ?? [])for(const d of plan.dependencies)dependency(d.tournamentId,"Dependencia documental registrada del origen continental",true);
 }

 let targetCompetitionId=source?competitionIdentity(source):"";
 let upper:Tournament|undefined,lower:Tournament|undefined;
 let continental:ReturnType<typeof continentalProjection>|undefined;
 let nationalCup:ReturnType<typeof projectNationalCup>|undefined;
 if(source && input.mode==="divisions"){
  const isLower=(t:Tournament)=>!!secondDivisionKind(t) || isChileanAscenso(t);
  lower=isLower(source)?source:partner && isLower(partner)?partner:undefined;
  upper=lower?.id===source.id?partner:source;
  if(!lower || !upper)block("Pendiente de participantes","Elige expresamente ambas divisiones; no se enlazan por país, año o nombres.");
  else{
   dependency(partner!.id,"División asociada elegida expresamente para esta planificación (aún no es una relación histórica)",false);
   const transition=getDivisionTransition(upper,lower,tournaments);
   if(isChileanAscenso(lower)){
    for(const t of [upper,lower])if(!closureOf(t).confirmed)block("Pendiente de resultados",`Confirma el cierre de ${t.name} en el Centro de cierre antes de planificar la siguiente temporada.`);
    simulatedSources=[upper,lower].every(simulatedClosed);
    if(simulatedSources)notes.push("Escenario simulado: los movimientos salen de cierres simulados confirmados; no son ascensos ni descensos oficiales.");
    for(const t of tournaments)if(/^anfp-liga-segunda/.test(competitionIdentity(t)) && t.season===lower.season){
     const id=calculateTournamentStatistics(t).sportingChampionTeamId,name=t.teams.find(team=>team.id===id)?.name;
     if(name && !suggestedIncoming.includes(name))suggestedIncoming.push(name);
    }
   }
   transition.pending.forEach(message=>block(/desempate|sorteo/i.test(message)?"Pendiente de desempate":/reglamento/i.test(message)?"Pendiente de reglamento":"Pendiente de resultados",message));
   if(input.targetSeason!==upper.season!+1)block("Pendiente de reglamento","El flujo existente de divisiones solo admite la siguiente temporada anual de sus formatos verificados; no calcula otros destinos.");
   for(const team of upper.teams){if(transition.upperRelegated.includes(team.id)){add(upper,team,"Desciende a Segunda por cálculo","confirmed",competitionIdentity(lower));movements.push({name:team.name,teamId:team.id,originId:upper.id,role:"Desciende desde Primera"});}else add(upper,team,"Permanece en Primera según movimientos calculados",transition.pending.length?"pending":"confirmed");}
   for(const team of lower.teams){if(transition.promoted.includes(team.id)){add(lower,team,"Asciende a Primera por cálculo","confirmed",competitionIdentity(upper));movements.push({name:team.name,teamId:team.id,originId:lower.id,role:"Asciende desde Segunda"});}
    else if(transition.lowerRelegated.includes(team.id))movements.push({name:team.name,teamId:team.id,originId:lower.id,role:"Salida de Segunda según el cálculo existente"});else add(lower,team,"Permanece en Segunda según movimientos calculados",transition.pending.length?"pending":"confirmed");}
   for(const [i,team] of (input.incoming ?? []).entries())participants.push({key:`incoming-${i}`,name:team.name,role:simulatedSources?"Ascendido desde Segunda aportado por el usuario (simulado)":"Ascenso inferior aportado por el usuario; sin identidad histórica vinculada",status:"provisional",competitionId:competitionIdentity(lower),scenario:"local",selected:true});
   if((input.incoming?.length ?? 0)!==transition.lowerRelegated.length)block("Pendiente de participantes",`Registra expresamente los ${transition.lowerRelegated.length} ascendidos inferiores exigidos por el flujo existente.`);
   if(input.sourceUrl?.trim() && !isHttpsReference(input.sourceUrl))block("Pendiente de participantes","La referencia de los participantes inferiores debe ser HTTPS.");
   else if(!isHttpsReference(input.sourceUrl)){
    if(simulatedSources)notes.push("Escenario simulado: la referencia HTTPS de los ascendidos desde Segunda es opcional.");
    else block("Pendiente de participantes","Falta la referencia HTTPS de los participantes inferiores aportados.");
   }
   const upperProfiles=new Set(upper.teams.map(t=>profileMap.get(clubOccurrenceKey(upper!.id,t.id))?.key));
   if(lower.teams.some(t=>upperProfiles.has(profileMap.get(clubOccurrenceKey(lower!.id,t.id))?.key)))block("Conflicto de identidad","Un mismo club registrado aparece en ambas divisiones de origen; no se decide su asignación automáticamente.");
  }
 }else if(source && input.mode==="national-cup"){
  nationalCup=projectNationalCup(source,input.targetSeason,{regulationId:input.regulationId ?? "",targetId:input.targetId},tournaments,activity);
  for(const reason of nationalCup.blockers)block(/identidad|duplicad/i.test(reason)?"Conflicto de identidad":/reglamento|criterio provisional/i.test(reason)?"Pendiente de reglamento":/desempate/i.test(reason)?"Pendiente de desempate":"Pendiente de participantes",reason);
  notes.push(...nationalCup.pending);
  for(const id of nationalCup.dependencies)dependency(id,"Dependencia del reglamento de admisión nacional seleccionado",true);
  for(const e of nationalCup.entries){const origin=tournaments.find(t=>t.id===e.sourceTournamentId)!,team=origin.teams.find(t=>t.id===e.teamId)!;
   add(origin,team,nationalCup.regulation!.criteria.find(c=>c.id===e.criterionId)!.description,e.status,targetCompetitionId);
   participants[participants.length-1].key=JSON.stringify([e.criterionId,e.sourceTournamentId,e.teamId]);
  }
 }else if(source && input.mode==="continental"){
  targetCompetitionId=`conmebol-${input.cup ?? "libertadores"}`;
  const ids=input.sourceIds ?? [source.id];
  if(!ids.length || new Set(ids).size!==ids.length)block("Pendiente de participantes","Selecciona orígenes nacionales distintos.");
  const qualifyingSeason=input.qualifyingSeason ?? source.season ?? 0;
  if(!Number.isSafeInteger(qualifyingSeason) || qualifyingSeason<1 || input.targetSeason<qualifyingSeason)block("Pendiente de reglamento","Indica expresamente la temporada nacional y una edición continental compatible.");
  continental=continentalProjection(ids,qualifyingSeason,input.cup ?? "libertadores",tournaments,activity);
  for(const d of continental.dependencies)dependency(d.tournamentId,"Regla internacional o campeón de copa referenciado por el origen seleccionado",true);
  for(const e of continental.entries){const origin=tournaments.find(t=>t.id===e.originTournamentId),team=origin?.teams.find(team=>team.id===e.sourceTeamId);if(!origin || !team)continue;
   const chosen=(input.selectedKeys ?? []).includes(entryKey(e));add(origin,team,`Clasificación internacional: ${userFacingLabels.destination(e.destination)} · cálculo de ${e.sourceTournamentName}`,e.status,targetCompetitionId,chosen);participants[participants.length-1].key=entryKey(e);participants[participants.length-1].scenario=e.scenario;
   if(chosen && (e.status==="pending" || continental.conflicts.includes(entryKey(e))))block(e.status==="pending"?"Pendiente de participantes":"Conflicto de identidad",`${e.teamName}: el servicio continental mantiene el cupo pendiente o en conflicto.`);
  }
  notes.push(...continental.reasons);if(continental.reasons.length || continental.entries.some(e=>e.status==="pending"))states.add("Pendiente de participantes");
  if(!(input.selectedKeys?.length))block("Pendiente de participantes","Selecciona expresamente los clasificados que incorporará la revisión local.");
  if((input.selectedKeys ?? []).some(key=>!continental!.entries.some(e=>entryKey(e)===key)))block("Conflicto de identidad","La selección contiene una clasificación que ya no está disponible.");
  if(!isHttpsReference(input.sourceUrl) || !input.note?.trim())block("Pendiente de participantes","Registra la referencia HTTPS y la decisión documental de edición; no se infiere el año continental.");
  for(const id of ids){const t=tournaments.find(t=>t.id===id);if(!t || t.season!==qualifyingSeason || competitionIdentity(t).startsWith("conmebol-"))block("Pendiente de participantes","Un origen nacional falta o corresponde a otra temporada.");}
 }else if(source){
  if(input.carryRoster && source.competitionType!=="cup")source.teams.forEach(team=>add(source,team,"Nómina actual propuesta expresamente, sin regla de permanencia futura","provisional"));
  const movementsConfigured=seasonCompetition(source) || source.placementRules?.relegationPlaces || source.placementRules?.relegationPlayoffPlaces || source.placementRules?.playoffPlaces || source.competitionRules?.relegationAverage;
  if(source.competitionType==="cup")block("Pendiente de participantes","Selecciona el flujo de copa nacional con admisión documentada y registra un reglamento aplicable; no se trasladan participantes por defecto.");
  else if(movementsConfigured)block("Pendiente de participantes","Esta competición requiere su flujo deportivo de movimientos; no se sustituye por una copia genérica.");
  else if(!canStartNewSeason(source))block("Pendiente de reglamento","El formato no admite la preparación genérica existente; revisa fases, calendario y reglamento.");
  simulatedSources=simulatedClosed(source);
  if(simulatedSources)notes.push("Escenario simulado: el origen se apoya en su cierre simulado confirmado; reglamento y conclusión no son oficiales.");
  else{
   if(getTournamentCompletionStatus(source)!=="Finalizado")block("Pendiente de resultados","La temporada de origen no tiene una conclusión acreditada por el servicio existente.");
   if(hasUnverifiedCompetitionRules(source))block("Pendiente de reglamento","Verifica el reglamento de origen antes de continuar con esta revisión.");
  }
  if(!input.carryRoster)block("Pendiente de participantes","Confirma que propones la nómina actual solo como escenario local, sin acreditar participantes oficiales futuros.");
 }
 const targetIdentities=input.mode==="divisions" && upper && lower?[competitionIdentity(upper),competitionIdentity(lower)]:[targetCompetitionId];
 const targets=tournaments.filter(t=>targetIdentities.includes(competitionIdentity(t)) && t.season===input.targetSeason);
 for(const identity of targetIdentities){const versions=targets.filter(t=>competitionIdentity(t)===identity);if(versions.length>1 && !(["continental","national-cup"].includes(input.mode) && input.targetId && versions.some(t=>t.id===input.targetId)))block("Pendiente de participantes",`Hay varias versiones guardadas de ${identity} ${input.targetSeason}; selecciona el destino concreto y revisa sus antecedentes.`);}
 if(targets.length && !["continental","national-cup"].includes(input.mode))block("Pendiente de participantes","El destino ya existe. Se conserva intacto; abre su preparación o revisión en lugar de crear otra versión.");
 if(["continental","national-cup"].includes(input.mode) && targets.length && !input.targetId)block("Pendiente de participantes","Selecciona la edición existente para una revisión documental sin reemplazar su nómina.");
 if(input.targetId && !targets.some(t=>t.id===input.targetId))block("Pendiente de participantes","El destino seleccionado no corresponde a la edición y competición previstas.");
 for(const target of targets){
  if(target.nationalCupPlanning?.reviews.some(r=>nationalCupReviewState(r,tournaments,activity)==="Dependencia desactualizada"))states.add("Dependencia desactualizada");
  for(const id of seasonOrigins(target,activity))dependency(id,`Origen registrado de ${target.name}`,true);
  const last=target.continentalPlans?.[target.continentalPlans.length-1];if(last && continentalPlanState(last,tournaments,activity).startsWith("Desactualizada"))states.add("Dependencia desactualizada");
  for(const id of last?.sourceTournamentIds ?? [])dependency(id,`Procedencia continental registrada de ${target.name}`,true);
 }
 const international=source && !competitionIdentity(source).startsWith("conmebol-") && (source.competitionRules?.internationalQualification || source.placementRules?.libertadoresPlaces || source.placementRules?.sudamericanaPlaces)?nationalContinentalProjection(source,tournaments,activity):undefined;
 if(international)for(const id of international.dependencyIds)dependency(id,"Dependencia de cupos internacionales registrada",true);
 for(const t of [source,partner].filter((t):t is Tournament=>!!t)){
  if(tournaments.filter(other=>competitionIdentity(other)===competitionIdentity(t) && other.season===t.season).length>1){states.add("Pendiente de participantes");notes.push(`${t.name}: hay otras versiones de la misma temporada; se usa solo el ID elegido expresamente: ${t.id}.`);}
  for(const season of t.competitionRules?.relegationAverage?.seasons ?? [])for(const history of tournaments.filter(h=>competitionIdentity(h)===competitionIdentity(t) && h.season===season))dependency(history.id,"Temporada exigida por la configuración registrada de promedios",true);
 }
 for(const d of dependencies)if(!tournaments.some(t=>t.id===d.id)){states.add("Pendiente de participantes");notes.push(`Dependencia registrada no disponible: ${d.id}.`);}
 const involved=[...new Set(dependencies.map(d=>d.id))].flatMap(id=>tournaments.filter(t=>t.id===id));
 const overviews=involved.map(t=>({tournament:t,overview:seasonOverview(t,activity)}));
 for(const {tournament:t,overview} of overviews){
  if(overview.pending.some(reason=>/desempate|sorteo/i.test(reason)))states.add("Pendiente de desempate");
  if(t.importCoverage==="partial" || t.importCoverage==="unknown"){states.add("Pendiente de participantes");notes.push(`${t.name}: la cobertura declarada es ${t.importCoverage}; no acredita una nómina oficial completa.`);}
  const last=t.continentalPlans?.[t.continentalPlans.length-1];if(last && continentalPlanState(last,tournaments,activity).startsWith("Desactualizada"))states.add("Dependencia desactualizada");
  const fixtures=t.matchdays.flatMap(day=>day.fixtures.map(f=>({day,f})));
  if(fixtures.some(({day,f})=>!isValidPlayedFixture(t,day,f)))states.add("Pendiente de resultados");
  if(!t.competitionRules || t.competitionRules.season!==t.season || hasUnverifiedCompetitionRules(t)){
   if(simulatedClosed(t))notes.push(`${t.name}: escenario simulado con cierre confirmado; su reglamento no está verificado.`);
   else states.add("Pendiente de reglamento");
  }
  if(t.competitionType!=="cup" && t.format!=="staged" && t.matchdays.every(d=>d.phaseName===undefined) && fixtures.length && fixtures.every(({day,f})=>isValidPlayedFixture(t,day,f)) && !t.teams.some(team=>team.groupName) && getUnresolvedStandingsTieGroups(t,calculateStandings(t)).length)states.add("Pendiente de desempate");
 }
 if(!targets.length || targets.some(t=>!t.competitionRules || hasUnverifiedCompetitionRules(t))){
  if(simulatedSources)notes.push("Escenario simulado: el reglamento de la temporada de destino queda pendiente.");
  else states.add("Pendiente de reglamento");
 }
 const chosen=participants.filter(p=>p.selected);
 const identities=chosen.map(p=>p.clubKey).filter((v):v is string=>!!v);
 if(new Set(identities).size!==identities.length)block("Conflicto de identidad","Un club está repetido en los participantes previstos; revisa sus orígenes.");
 for(const identity of targetIdentities){const roster=chosen.filter(p=>p.competitionId===identity);if(roster.length){
  if(new Set(roster.map(p=>normalizeTeamName(p.name))).size!==roster.length)block("Conflicto de identidad","Hay clubes homónimos en la nómina prevista; vincula sus identidades antes de preparar la temporada.");
  const issues=validateTournamentIntegrity({id:"planning-preview",name:"Vista previa local",season:input.targetSeason,createdAt:source?.createdAt ?? "2000-01-01T00:00:00Z",teams:roster.map((p,i)=>({id:`preview-${i}`,name:p.name})),legs:1,tieBreakers:[],matchdays:[],format:"staged",competitionType:["continental","national-cup"].includes(input.mode)?"cup":"league"});
  issues.forEach(issue=>block("Conflicto de identidad",issue));
 }}
 const differences=targets.map(target=>{
  const expected=chosen.filter(p=>p.competitionId===competitionIdentity(target));
  const targetKeys=new Set(target.teams.map(t=>profileMap.get(clubOccurrenceKey(target.id,t.id))?.key));
  const expectedKeys=new Set(expected.map(p=>p.clubKey).filter(Boolean));
  return {target,unlinkedExpected:expected.filter(p=>!p.clubKey || !targetKeys.has(p.clubKey)).map(p=>p.name),unlinkedRegistered:target.teams.filter(t=>!expectedKeys.has(profileMap.get(clubOccurrenceKey(target.id,t.id))?.key)).map(t=>t.name)};
 });
 if(differences.some(d=>d.unlinkedExpected.length || d.unlinkedRegistered.length))states.add("Pendiente de participantes");
 if(!blockers.length)states.add("Lista para revisión");
 return {input,source,partner,upper,lower,targetCompetitionId,targets,participants,movements,dependencies,states:[...states],blockers:[...new Set(blockers)],notes:[...new Set(notes)],differences,international,canReview:!blockers.length,
  nationalCup,simulatedSources,suggestedIncoming,continentalEntries:continental?.entries ?? [],continentalConflicts:continental?.conflicts ?? [],overviews,snapshot:planningLibrarySnapshot(tournaments,activity)};
}

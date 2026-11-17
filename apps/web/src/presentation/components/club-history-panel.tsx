import {ClubAffiliationSummary} from "./club-affiliation-summary";
import {ClubPerformanceAccess} from "./club-performance-access";
import {HeadToHeadAccess} from "./head-to-head-access";
import {ClubHonours} from "./club-honours-panel";
import { useMemo } from "react";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import type { ActivityEvent } from "@cancha/core/domain/entities/activity-event";
import { accumulateClubScopes, buildClubProfiles, projectClubHistory, similarlyNamedProfiles } from "@cancha/core/application/services/club-history";
import { useSessionDraft } from "../session-drafts";
interface Props { tournaments:readonly Tournament[]; activity:readonly ActivityEvent[]; onOpen:(t:Tournament)=>void;initialClub?:string;contextKey?:string }
const scenarioLabels={local:"Escenario local, editado o simulado",provider:"Datos de proveedor sin certificación oficial",unknown:"Procedencia no acreditada"};
const qualificationLabels={confirmed:"Confirmado por cálculo verificado",provisional:"Provisional",pending:"Pendiente"};
const kindLabels={league:"Tabla de liga",group:"Tabla de grupo",knockout:"Eliminatoria",unclassified:"Fase sin tipo acreditado"};
export function ClubHistoryPanel({tournaments,activity,onOpen,initialClub="",contextKey}:Props){
 const profiles=useMemo(()=>buildClubProfiles(tournaments),[tournaments]);
 const [search,setSearch]=useSessionDraft(contextKey?`${contextKey}:search`:"club-history-search","");
 const [selected,setSelected]=useSessionDraft(contextKey?`${contextKey}:selected`:"club-history-selected",initialClub);
 const profile=profiles.find(p=>p.occurrences.some(o=>o.key===selected));
 const history=useMemo(()=>profile ? projectClubHistory(profile,tournaments,activity):[],[profile,tournaments,activity]);
 const [selectedScopes,setSelectedScopes]=useSessionDraft(JSON.stringify(["club-history-totals",profile?.key ?? "none",...(contextKey?[contextKey]:[])]),[] as string[]);
 const scopes=history.flatMap(row=>row.scopes),chosen=scopes.filter(s=>selectedScopes.includes(s.key));
 const missingSelection=selectedScopes.some(key=>!scopes.some(scope=>scope.key===key));
 const accumulated:ReturnType<typeof accumulateClubScopes>=missingSelection ? {error:"La selección contiene registros que ya no están disponibles. Limpia y revisa las fuentes."}:accumulateClubScopes(chosen);
 return <section className="club-history" aria-label="Historial deportivo de clubes">
   <h3>Historial deportivo de clubes</h3>
   <p>Consulta de los torneos guardados, incluidos los archivados. No acredita resultados oficiales ni reconstruye temporadas ausentes. Los nombres iguales no unen clubes.</p>
   <div className="competition-controls">
     <label>Buscar club registrado<input type="search" value={search} onChange={e=>setSearch(e.target.value)}/></label>
     <label>Club registrado<select value={profile?.key ?? ""} onChange={e=>setSelected(e.target.value)}>
       <option value="">Selecciona un registro de club</option>{profiles.filter(p=>!search || p.names.some(n=>n.toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es"))) || p.teamIds.some(id=>id.includes(search)) || p===profile).map(p=>
         <option key={p.key} value={p.key}>{p.names[p.names.length-1]} · ID {p.teamIds.join(", ")} · {p.occurrences.length} registro(s) · {p.occurrences[0].tournament.name} · {p.occurrences[0].tournament.season ?? "sin año"} · {p.occurrences[0].tournament.id}</option>)}
     </select></label>
   </div>
   {profile && <>
     <h4>{profile.names[profile.names.length-1]}</h4>
     <p>Nombres registrados: {profile.names.join(" · ")}</p><p>Identificadores conocidos: {profile.teamIds.join(" · ")}</p>
     <p>Identidades históricas expresas: {profile.historicalIdentities.join(" · ") || "no registradas"}</p>
     {profile.warning && <p role="note">{profile.warning}</p>}
     {similarlyNamedProfiles(profile,profiles).length>0 && <p role="note">Hay otros registros con el mismo nombre que permanecen separados por falta de vínculo verificable.</p>}
     <p>Las cifras proceden del servicio de tablas: PJ, G/E/P y goles del tiempo reglamentario. No se suman prórrogas ni tandas de penales. Las eliminatorias no otorgan aquí puntos ni posición de liga.</p>
     <section aria-label="Estadísticas acumuladas del club">
       <h4>Acumulado de la selección expresa</h4>
       <p>Elige una versión por año de la misma competición, fase, grupo, formato, procedencia y criterios. Las copias y los escenarios no se suman automáticamente. Las temporadas sin año quedan fuera del acumulado.</p>
       <button className="small-action" type="button" onClick={()=>setSelectedScopes([])}>Limpiar selección acumulada</button>
       {accumulated.totals ? <>
         <p>{accumulated.totals.played} PJ · {accumulated.totals.wins} G · {accumulated.totals.draws} E · {accumulated.totals.losses} P · {accumulated.totals.goalsFor} GF · {accumulated.totals.goalsAgainst} GC{accumulated.pointsApplicable ? ` · ${accumulated.totals.points} puntos`:""}</p>
         <p>Temporadas: {accumulated.seasons.join(", ")} · Registros parciales o sin cobertura acreditada: {accumulated.partial}. Son partidos válidos disponibles, no el historial completo del club.</p>
         <p>Fuentes seleccionadas: {accumulated.tournamentIds.join(" · ")}</p>
       </> : <p role={chosen.length ? "alert":"note"}>{accumulated.error}</p>}
     </section>
     <ClubPerformanceAccess tournaments={tournaments} activity={activity} onOpen={onOpen} contextKey={`${contextKey ?? "club-history"}:performance:${profile.key}`} label="Perfil de club" initialClub={profile.key}/>
     <HeadToHeadAccess tournaments={tournaments} activity={activity} onOpen={onOpen} contextKey={`${contextKey ?? "club-history"}:h2h:${profile.key}`} label="Perfil de club" initialA={profile.key}/><ClubHonours profile={profile} activity={activity} onOpen={onOpen}/><div className="club-history-timeline">{history.map(row=><article className="club-history-season" key={row.key} aria-label={`${row.tournament.name} · ${row.tournament.season ?? "sin año"} · ${row.team.id}`}>
       <h4>{row.tournament.season ?? "Temporada no registrada"} · {row.tournament.name}</h4>
       <p>{row.team.name} · {row.territory} · {row.competition} · {row.category}{row.tournament.archived ? " · Archivado":""}</p>
       <p>{scenarioLabels[row.scenario]} · Estado del torneo: {row.status}</p>
       <p>Cobertura declarada: {row.tournament.importCoverage ?? "no registrada"} · Fuente: {row.tournament.sourceName ?? "no registrada"}{row.tournament.sourceUrl ? ` · ${row.tournament.sourceUrl}`:""}</p>
       <ClubAffiliationSummary tournament={row.tournament} teamId={row.team.id} tournaments={tournaments} activity={activity}/>
       {!row.scopes.length && <p>Participante registrado sin partidos programados; no se inventan estadísticas.</p>}
       {row.scopes.map(scope=><section className="club-history-scope" key={scope.key} aria-label={`${scope.phase}${scope.group ? ` · ${scope.group}`:""}`}>
         <h5>{kindLabels[scope.kind]} · {scope.phase}{scope.group ? ` · ${scope.group}`:""}</h5>
         <p>{scope.position!==undefined ? `Posición ${scope.position} · `:""}{scope.positionStatus}</p>
         <p>{scope.metrics.played} PJ de {scope.scheduled} programados · {scope.metrics.wins} G · {scope.metrics.draws} E · {scope.metrics.losses} P</p>
         <p>{scope.metrics.goalsFor} GF · {scope.metrics.goalsAgainst} GC{scope.pointsApplicable ? ` · ${scope.metrics.points} puntos`:" · Sin puntos de liga"}</p>
         <p>{scope.coverage}</p>
         <label className="club-history-choice"><input type="checkbox" checked={selectedScopes.includes(scope.key)} onChange={e=>setSelectedScopes(old=>e.target.checked ? [...old,scope.key]:old.filter(key=>key!==scope.key))}/>
           Acumular {row.tournament.name} · {row.tournament.season ?? "sin año"} · {scope.phase}{scope.group ? ` · ${scope.group}`:""} · {row.tournament.id}
         </label>
       </section>)}
       {row.movements.length>0 ? row.movements.map(m=><p key={m}>{m} · {scenarioLabels[row.scenario]}</p>):<p>Sin ascenso o descenso determinado registrado para este club.</p>}
       {row.pending.length>0 && <details><summary>Movimientos o clasificaciones pendientes ({row.pending.length})</summary><ul>{row.pending.map(p=><li key={p}>{p}</li>)}</ul></details>}
       {row.internationalPending.length>0 && <details><summary>Cupos internacionales pendientes o por revisar ({row.internationalPending.length})</summary><ul>{row.internationalPending.map(reason=><li key={reason}>{reason}</li>)}</ul></details>}
       {row.qualifications.map(q=><p key={JSON.stringify([q.sourceTournamentId,q.originTournamentId,q.destination])}>Cupo internacional: {q.destination} · {qualificationLabels[q.status]} · cálculo de {q.sourceTournamentName} · {scenarioLabels[q.scenario]}. La edición no se infiere del año nacional.</p>)}
       {row.documents.map(d=><details key={`${d.cup.id}-${d.plan.id}-${d.entry.sourceTeamId}`}><summary>Vinculación documental: {d.cup.name} · edición {d.plan.edition}</summary>
         <p>{d.state} · Estado al registrar: {qualificationLabels[d.entry.status]} · {scenarioLabels[d.entry.scenario]}</p>
         <p>{d.plan.sourceUrl}</p><p>{d.plan.note}</p><button className="small-action" type="button" onClick={()=>onOpen(d.cup)}>Abrir edición vinculada</button>
       </details>)}
       {!row.qualifications.length && !row.documents.length && <p>Sin cupo internacional calculado o vinculado registrado; no equivale a una exclusión deportiva.</p>}
       <button className="small-action" type="button" onClick={()=>onOpen(row.tournament)}>Abrir torneo de origen</button>
     </article>)}</div>
   </>}
 </section>;
}

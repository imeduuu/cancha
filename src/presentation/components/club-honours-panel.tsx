import {useMemo} from "react";
import type {Tournament} from "../../domain/entities/tournament";
import type {ActivityEvent} from "../../domain/entities/activity-event";
import {seasonHonours,seasonRecordRows,seasonHighlights,historicalRecords,recordMetrics,provenanceLabels,type RecordMetric} from "../../application/services/club-honours";
import type {ClubProfile} from "../../application/services/club-history";
import {sourceScenario} from "../../application/services/continental-projection";
import {groupCompetitions} from "../../application/services/competition-center";
import {useSessionDraft} from "../session-drafts";

export function SeasonHonours({tournament,activity=[],teamId}:{tournament:Tournament;activity?:readonly ActivityEvent[];teamId?:string}){
 const honours=useMemo(()=>seasonHonours(tournament),[tournament]);
 const allRecords=useMemo(()=>seasonRecordRows(tournament,activity),[tournament,activity]);
 const records=allRecords.filter(r=>!teamId || r.team.id===teamId);
 const highlights=seasonHighlights(allRecords).filter(h=>!teamId || h.leaders.some(r=>r.team.id===teamId));
 const visible=honours.awards.filter(a=>!teamId || a.teamId===teamId);
 return <section aria-label={`Palmarés y marcas de ${tournament.name}`} className="club-history-scope">
  <h4>Palmarés y marcas de temporada</h4>
  <p>{provenanceLabels[sourceScenario(tournament,activity)]}. Cálculo sobre datos guardados; no certifica un título oficial.</p>
  {visible.map(a=><p key={`${a.teamId}-${a.label}`}>{a.label}: {tournament.teams.find(t=>t.id===a.teamId)?.name}</p>)}
  {!visible.length && <p>Sin distinción determinada para este alcance.</p>}
  {honours.reasons.map(reason=><p key={reason}>{reason}</p>)}
  <p>Marcas del tiempo reglamentario, separadas por fase. Las cifras parciales no son récords definitivos; no incluyen goles de prórroga ni tandas.</p>
  <ul>{highlights.map((h,i)=><li key={i}>{recordMetrics[h.metric]}: {h.value} · {h.leaders.map(r=>r.team.name).join(" · ")} · {h.phase}{h.group?` · ${h.group}`:""} · {h.complete?"Marca de fase completa, calculada":"Marca parcial, no definitiva"}</li>)}</ul>
  {records.map(r=><details key={r.scope.key}><summary>{r.team.name} · {r.scope.phase}{r.scope.group ? ` · ${r.scope.group}`:""} · {r.complete?"Cobertura completa de esta fase":"Marca parcial o cobertura no acreditada"}</summary>
   <p>{r.scope.positionStatus} · {r.scope.metrics.wins} victorias · {r.scope.metrics.goalsFor} GF · {r.scope.metrics.goalsAgainst} GC · {r.scope.metrics.goalDifference} DG{r.scope.kind==="league"?` · ${r.scope.metrics.points} puntos de liga`:""}</p>
   {r.streaks.reason?<p>{r.streaks.reason}</p>:<p>Racha máxima: {r.streaks.wins} victorias · {r.streaks.unbeaten} invicto. Orden por fecha, hora y zona de todos los encuentros de la fase.</p>}
  </details>)}
 </section>;
}
export function ClubHonours({profile,activity,onOpen}:{profile:ClubProfile;activity:readonly ActivityEvent[];onOpen:(t:Tournament)=>void}){
 return <section aria-label="Palmarés y récords del club"><h4>Palmarés y récords del club</h4>
  <p>Se conservan las versiones de cada temporada sin sumarlas. Cada registro permite abrir su torneo de origen para revisar el respaldo.</p>
  {profile.occurrences.map(o=><div key={o.key}><h5>{o.tournament.season ?? "Sin año"} · {o.tournament.name}</h5><SeasonHonours tournament={o.tournament} teamId={o.team.id} activity={activity}/><button type="button" className="small-action" onClick={()=>onOpen(o.tournament)}>Abrir respaldo del palmarés: {o.tournament.name} · {o.tournament.season ?? "sin año"}</button></div>)}
 </section>;
}
export function HistoricalRecordsPanel({tournaments,activity,onOpen,contextKey="historical-records"}:{tournaments:readonly Tournament[];activity:readonly ActivityEvent[];onOpen:(t:Tournament)=>void;contextKey?:string}){
 const groups=useMemo(()=>groupCompetitions(tournaments),[tournaments]);
 const [competition,setCompetition]=useSessionDraft(`${contextKey}:competition`,"");
 const [selected,setSelected]=useSessionDraft(`${contextKey}:seasons`,[] as string[]);
 const [metric,setMetric]=useSessionDraft<RecordMetric>(`${contextKey}:metric`,"titles");
 const [scope,setScope]=useSessionDraft(`${contextKey}:scope`,"");
 const [partial,setPartial]=useSessionDraft(`${contextKey}:partial`,false);
 const group=groups.find(g=>g.id===competition);
 const seasons=(group?.seasons ?? []).filter(t=>selected.includes(t.id));
 const options=useMemo(()=>[...new Map(seasons.flatMap(t=>seasonRecordRows(t,activity).map(r=>[r.scope.compatibility,`${r.scope.phase} · ${r.scope.group ?? ({league:"Liga",group:"Grupo",knockout:"Eliminatoria",unclassified:"Fase sin tipo acreditado"}[r.scope.kind])} · ${provenanceLabels[sourceScenario(t,activity)]}`] as const))).entries()],[seasons,activity]);
 const missing=selected.some(id=>!group?.seasons.some(t=>t.id===id));
 const result=missing?{rows:[],error:"Hay fuentes seleccionadas que ya no están disponibles. Revisa la selección."}:historicalRecords(tournaments,seasons,activity,metric,scope,partial);
 return <section aria-label="Clasificaciones históricas" className="club-history">
  <h3>Clasificaciones históricas y récords</h3>
  <p>Consulta de la biblioteca disponible. Elige una versión por año; no se mezclan formatos, puntuaciones ni procedencias. Las marcas se comparan por temporada; solo los títulos se cuentan entre años seleccionados.</p>
  <div className="competition-controls"><label>Competición para récords<select value={group?.id ?? ""} onChange={e=>{setCompetition(e.target.value);setSelected([]);setScope("");}}><option value="">Selecciona una competición</option>{groups.map(g=><option key={g.id} value={g.id}>{g.territory} · {g.name} · {g.id}</option>)}</select></label>
  <label>Estadística histórica<select value={metric} onChange={e=>setMetric(e.target.value as RecordMetric)}>{Object.entries(recordMetrics).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label></div>
  <fieldset><legend>Temporadas incluidas expresamente</legend>{group?.seasons.map(t=><label className="club-history-choice" key={t.id}><input type="checkbox" checked={selected.includes(t.id)} onChange={e=>setSelected(old=>e.target.checked?[...old,t.id]:old.filter(id=>id!==t.id))}/>{t.season ?? "Sin año"} · {t.name} · {t.id} · {provenanceLabels[sourceScenario(t,activity)]}</label>)}<button type="button" className="small-action" onClick={()=>setSelected([])}>Limpiar temporadas seleccionadas</button></fieldset>
  {metric!=="titles" && <><div className="competition-controls" style={{gridTemplateColumns:"minmax(0, 1fr)"}}><label>Fase y alcance comparables<select value={scope} onChange={e=>setScope(e.target.value)}><option value="">Selecciona una fase</option>{options.map(([key,label],i)=><option key={key} value={key}>{label} · alcance {i+1}</option>)}</select></label></div>
   <label className="club-history-choice"><input type="checkbox" checked={partial} onChange={e=>setPartial(e.target.checked)}/>Consultar exclusivamente marcas parciales o de cobertura no acreditada</label></>}
  <p>Temporadas seleccionadas: {seasons.length}. {partial && metric!=="titles"?"Comparación parcial; no establece récords definitivos.":"Se excluyen las marcas sin cobertura completa; un cálculo completo no acredita oficialidad."}</p>
  <details><summary>Conclusión y pendientes de las temporadas seleccionadas</summary>{seasons.map(t=><div key={t.id}><p>{t.name} · {t.season}</p>{seasonHonours(t).reasons.map(reason=><p key={reason}>{reason}</p>)}<button type="button" className="small-action" onClick={()=>onOpen(t)}>Revisar temporada: {t.name}</button></div>)}</details>
  {result.error?<p role={selected.length?"alert":"note"}>{result.error}</p>:<>
   <p>Temporadas que aportan marcas al ranking: {result.participatingSeasons} de {result.seasons}. Las restantes no aportan datos elegibles para este alcance.</p>
   {result.creditedSeasons!==undefined && <p>Temporadas con campeón acreditado por el cálculo: {result.creditedSeasons} de {result.seasons}.</p>}
   {!result.rows.length && <p>Sin marcas elegibles para el alcance. Revisa la fase, cobertura, resultados y cronología; no se inventan valores.</p>}
   <ul>{result.rows.map((r,i)=><li key={`${r.profileKey}-${r.tournament.id}-${i}`}><strong>{r.name}: {r.value}</strong> · ID {r.teamId}{"sources" in r && r.sources.map(t=><button className="small-action" type="button" key={t.id} onClick={()=>onOpen(t)}>Abrir respaldo: {t.name} · {t.season}</button>)}</li>)}</ul>
  </>}
 </section>;
}

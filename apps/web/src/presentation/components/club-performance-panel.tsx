import {useMemo} from "react";
import type {Tournament} from "@cancha/core/domain/entities/tournament";
import type {ActivityEvent} from "@cancha/core/domain/entities/activity-event";
import type {TeamStanding} from "@cancha/core/domain/services/standings";
import {buildClubProfiles} from "@cancha/core/application/services/club-history";
import {clubPerformanceRows,performanceDetail,performanceEvolution,comparePerformance,goalAverages,type PerformanceRow} from "@cancha/core/application/services/club-performance";
import {competitionIdentity,groupCompetitions} from "@cancha/core/application/services/competition-center";
import {provenanceLabels} from "@cancha/core/application/services/club-honours";
import {useSessionDraft} from "../session-drafts";
export interface PerformanceProps {tournaments:readonly Tournament[];activity:readonly ActivityEvent[];onOpen:(t:Tournament)=>void;contextKey:string;label:string;initialClub?:string}
const outcomes=[{key:"wins",label:"Victorias"},{key:"draws",label:"Empates"},{key:"losses",label:"Derrotas"}] as const;
const goals=[{key:"goalsFor",label:"Goles a favor"},{key:"goalsAgainst",label:"Goles en contra"}] as const;
const formatAverage=(value:number|undefined)=>value===undefined?"Sin partidos":value.toLocaleString("es-CL",{minimumFractionDigits:2,maximumFractionDigits:2});
function chartValues(m:TeamStanding){return {wins:m.wins,draws:m.draws,losses:m.losses,goalsFor:m.goalsFor,goalsAgainst:m.goalsAgainst};}
interface Point {label:string;values:Readonly<Record<string,number|undefined>>}
function Bars({title,points,series,note}:{title:string;points:readonly Point[];series:readonly {key:string;label:string}[];note?:string}){
 const maximum=Math.max(1,...points.flatMap(p=>series.map(s=>p.values[s.key] ?? 0)));
 return <figure className="performance-chart" aria-label={title}><figcaption>{title}</figcaption>
  <p>{note ?? "Barras con escala común dentro de este gráfico; son cantidades, no porcentajes de rendimiento."}</p>
  <ul>{points.map((p,i)=><li key={`${p.label}-${i}`}><strong>{p.label}</strong>{series.map((s,index)=><div className="performance-bar-row" key={s.key}>
   <span>{s.label}: {p.values[s.key] ?? "No acreditada"}</span><span className="performance-bar-track" aria-hidden="true"><span className={`performance-bar series-${index}`} style={{width:`${(p.values[s.key] ?? 0)/maximum*100}%`}}/></span>
  </div>)}</li>)}</ul>
 </figure>;
}
function Metrics({rows}:{rows:readonly {label:string;metrics:TeamStanding}[]}){
 return <div className="table-scroll"><table className="statistics-table performance-table"><caption>Métricas reglamentarias de partidos válidos</caption><thead><tr><th>Alcance</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>GF</th><th>GC</th><th>DG</th><th>GF/PJ</th><th>GC/PJ</th></tr></thead><tbody>{rows.map(r=>{const avg=goalAverages(r.metrics);return <tr key={r.label}><th scope="row">{r.label}</th><td>{r.metrics.played}</td><td>{r.metrics.wins}</td><td>{r.metrics.draws}</td><td>{r.metrics.losses}</td><td>{r.metrics.goalsFor}</td><td>{r.metrics.goalsAgainst}</td><td>{r.metrics.goalDifference}</td><td>{formatAverage(avg.for)}</td><td>{formatAverage(avg.against)}</td></tr>;})}</tbody></table></div>;
}
function rowLabel(row:PerformanceRow){return `${row.team.name} · ID ${row.team.id} · ${row.tournament.season ?? "sin año"} · ${row.tournament.name} · ${row.scope.phase}${row.scope.group?` · ${row.scope.group}`:""} · ${row.complete?"Fase completa, calculada":"Parcial o no acreditada"} · ${row.scope.metrics.played} PJ · ${provenanceLabels[row.scenario]}`;}
function SeasonDetail({row,onOpen}:{row:PerformanceRow;onOpen:(t:Tournament)=>void}){
 const detail=useMemo(()=>performanceDetail(row),[row]);
 return <section className="performance-season" aria-label={`Rendimiento de ${row.team.name} en ${row.tournament.name} · ${row.scope.phase}`}>
  <h4>{rowLabel(row)}</h4><p>{provenanceLabels[row.scenario]} · {row.scope.positionStatus}{detail.accreditedPosition!==undefined?` · Posición ${detail.accreditedPosition}`:" · Sin posición acreditada para el gráfico"}</p>
  <p>{row.scope.metrics.played} PJ de {row.scope.scheduled} programados · {row.scope.coverage}. Los partidos pendientes o inválidos no añaden resultados. La cobertura de una fase no acredita que toda la competición haya terminado.</p>
  <p>Fuente: {row.tournament.sourceName ?? "No registrada"} · {row.tournament.sourceUrl ?? "Sin referencia"}. No certifica resultados oficiales.</p>
  <Metrics rows={[{label:"General",metrics:detail.metrics},{label:"Local",metrics:detail.home},{label:"Visitante",metrics:detail.away}]}/>
  <p>Promedio de goles a favor por partido: {formatAverage(detail.averages.for)} · En contra: {formatAverage(detail.averages.against)}. Se usan goles y resultados del tiempo reglamentario; prórrogas y tandas no se suman.</p>
  <Bars title={`Resultados generales de ${row.team.name}`} points={[{label:rowLabel(row),values:chartValues(detail.metrics)}]} series={outcomes}/>
  <Bars title={`Rendimiento por localía de ${row.team.name}`} points={[{label:"Local",values:chartValues(detail.home)},{label:"Visitante",values:chartValues(detail.away)}]} series={outcomes}/>
  <details><summary>Evolución por jornada de {row.team.name}</summary>
   <p>Orden por rueda y jornada registradas, dentro de esta fase. No representa el orden real de disputa: un aplazamiento puede cambiarlo. El acumulado cuenta únicamente los resultados válidos guardados actuales.</p>
   <Bars title={`Resultados por jornada de ${row.team.name}`} points={detail.rounds.map(r=>({label:r.label,values:chartValues(r.metrics)}))} series={outcomes}/>
   <div className="table-scroll"><table className="statistics-table performance-table"><caption>Jornadas y acumulados disponibles</caption><thead><tr><th>Jornada</th><th>Programados</th><th>PJ</th><th>G/E/P</th><th>GF/GC</th><th>PJ acumulados</th><th>G/E/P acumulados</th><th>GF/GC acumulados</th></tr></thead><tbody>{detail.rounds.map(r=><tr key={r.key}><th scope="row">{r.label}</th><td>{r.scheduled}</td><td>{r.metrics.played}</td><td>{r.metrics.wins}/{r.metrics.draws}/{r.metrics.losses}</td><td>{r.metrics.goalsFor}/{r.metrics.goalsAgainst}</td><td>{r.cumulative.played}</td><td>{r.cumulative.wins}/{r.cumulative.draws}/{r.cumulative.losses}</td><td>{r.cumulative.goalsFor}/{r.cumulative.goalsAgainst}</td></tr>)}</tbody></table></div>
  </details>
  <button type="button" className="small-action" onClick={()=>onOpen(row.tournament)}>Abrir origen del rendimiento</button>
 </section>;
}
function EvolutionCharts({rows,title}:{rows:readonly PerformanceRow[];title:string}){
 const details=useMemo(()=>rows.map(row=>performanceDetail(row)),[rows]);
 const points=details.map(d=>({label:rowLabel(d.row),values:{...chartValues(d.metrics),position:d.accreditedPosition}}));
 return <section aria-label={title}><h4>{title}</h4><p>{rows.length} participaciones seleccionadas. Son valores por temporada/fase, no una suma histórica. Compara también PJ: una fuente parcial tiene menos oportunidades de sumar victorias y goles.</p>
  <Bars title={`${title}: victorias, empates y derrotas`} points={points} series={outcomes}/>
  <Bars title={`${title}: goles a favor y en contra`} points={points} series={goals}/>
  <Bars title={`${title}: posiciones acreditadas`} points={points} series={[{key:"position",label:"Posición"}]} note="Menor posición es mejor. La longitud representa el número de puesto, no una puntuación. No se dibujan posiciones provisionales, empatadas o sin cobertura acreditada."/>
  <Bars title={`${title}: resultados como local`} points={details.map(d=>({label:rowLabel(d.row),values:chartValues(d.home)}))} series={outcomes}/>
  <Bars title={`${title}: resultados como visitante`} points={details.map(d=>({label:rowLabel(d.row),values:chartValues(d.away)}))} series={outcomes}/>
  <Metrics rows={details.map(d=>({label:rowLabel(d.row),metrics:d.metrics}))}/>
 </section>;
}
export function ClubPerformancePanel({tournaments,activity,onOpen,contextKey,label,initialClub=""}:PerformanceProps){
 const profiles=useMemo(()=>buildClubProfiles(tournaments),[tournaments]);
 const [club,setClub]=useSessionDraft(`${contextKey}:club`,initialClub),[peer,setPeer]=useSessionDraft(`${contextKey}:peer`,"");
 const [competition,setCompetition]=useSessionDraft(`${contextKey}:competition`,"");
 const [scopeKey,setScope]=useSessionDraft(`${contextKey}:scope`,"");
 const [selected,setSelected]=useSessionDraft<string[]>(`${contextKey}:evolution`,[]);
 const profile=profiles.find(p=>p.occurrences.some(o=>o.key===club)),other=profiles.find(p=>p.occurrences.some(o=>o.key===peer));
 const result=useMemo(()=>profile?clubPerformanceRows(profile,tournaments,activity):{rows:[] as PerformanceRow[]},[profile,tournaments,activity]);
 const groups=useMemo(()=>groupCompetitions(tournaments),[tournaments]);
 const rows=result.rows.filter(row=>competitionIdentity(row.tournament)===competition);
 const current=rows.find(row=>row.scope.key===scopeKey);
 const evolution=performanceEvolution(rows,selected);
 const comparison=current && other?comparePerformance(current,other,tournaments,activity):undefined;
 const labelClub=(p:typeof profiles[number])=>`${p.names[p.names.length-1]} · ID ${p.teamIds.join(", ")} · ${p.occurrences[0].tournament.name} · ${p.occurrences[0].tournament.id}${p.warning?" · Identidad ambigua":""}`;
 return <section className="club-history club-performance" aria-label={`Rendimiento deportivo · ${label}`}>
  <h3>Rendimiento y evolución deportiva</h3><p>Consulta de toda la actuación del club en un alcance guardado; no es H2H ni considera solo los partidos contra el otro club. No modifica resultados ni certifica oficialidad.</p>
  <div className="competition-controls">
   <label>Club para rendimiento<select value={profile?.key ?? ""} onChange={e=>{setClub(e.target.value);setScope("");setSelected([]);setPeer("");}}><option value="">Selecciona un club</option>{profiles.map(p=><option key={p.key} value={p.key}>{labelClub(p)}</option>)}</select></label>
   <label>Competición para rendimiento<select value={competition} onChange={e=>{setCompetition(e.target.value);setScope("");setSelected([]);}}><option value="">Selecciona una competición</option>{groups.map(g=><option key={g.id} value={g.id}>{g.name} · {g.id}</option>)}</select></label>
   <label>Temporada y fase de rendimiento<select value={current?.scope.key ?? ""} onChange={e=>setScope(e.target.value)}><option value="">Selecciona una participación</option>{rows.map(r=><option key={r.scope.key} value={r.scope.key}>{rowLabel(r)} · {r.tournament.id}</option>)}</select></label>
   <label>Segundo club para comparar rendimiento<select value={other?.key ?? ""} onChange={e=>setPeer(e.target.value)}><option value="">Sin comparación</option>{profiles.map(p=><option key={p.key} value={p.key}>{labelClub(p)}</option>)}</select></label>
  </div>
  {club && !profile && <p role="alert">La identidad seleccionada ya no está disponible. Revisa la selección sin reconstruir relaciones por nombre.</p>}
  {result.error && <p role="alert">{result.error}</p>}
  {profile && !result.error && competition && !rows.length && <p>Sin partidos programados para este club en la competición seleccionada; no se inventan participaciones ni métricas.</p>}
  {scopeKey && !current && <p role="note">La participación seleccionada ya no está disponible en este alcance.</p>}
  {current && <SeasonDetail row={current} onOpen={onOpen}/>}
  {peer && !other && <p role="alert">El segundo club ya no está disponible.</p>}
  {comparison?.error && <p role="alert">{comparison.error}</p>}
  {comparison?.rows && <><EvolutionCharts rows={comparison.rows} title="Comparación de rendimiento general"/><SeasonDetail row={comparison.rows[1]} onOpen={onOpen}/></>}
  {profile && !result.error && <section aria-label="Selección de evolución entre temporadas"><h4>Evolución entre temporadas compatibles</h4><p>Marca una sola versión por año de la misma competición, fase, grupo, formato, puntuación y procedencia. No se suman copias ni se seleccionan temporadas automáticamente.</p>
   <fieldset><legend>Participaciones para evolución</legend>{rows.map(r=><label className="club-history-choice" key={r.scope.key}><input type="checkbox" checked={selected.includes(r.scope.key)} onChange={e=>setSelected(old=>e.target.checked?[...old,r.scope.key]:old.filter(key=>key!==r.scope.key))}/>{rowLabel(r)} · {r.tournament.id}</label>)}<button type="button" className="small-action" onClick={()=>setSelected([])}>Limpiar evolución seleccionada</button></fieldset>
   {evolution.error?<p role={selected.length?"alert":"note"}>{evolution.error}</p>:<EvolutionCharts rows={evolution.rows} title="Evolución entre temporadas"/>}
  </section>}
 </section>;
}

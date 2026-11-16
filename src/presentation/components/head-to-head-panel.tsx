import {useMemo} from "react";
import type {Tournament} from "../../domain/entities/tournament";
import type {ActivityEvent} from "../../domain/entities/activity-event";
import {buildClubProfiles} from "../../application/services/club-history";
import {headToHeadMatches,summarizeHeadToHead,type H2HFilters,type H2HMatch} from "../../application/services/head-to-head";
import {competitionIdentity,groupCompetitions} from "../../application/services/competition-center";
import {provenanceLabels} from "../../application/services/club-honours";
import {useSessionDraft} from "../session-drafts";
export interface HeadToHeadProps {tournaments:readonly Tournament[];activity:readonly ActivityEvent[];onOpen:(t:Tournament)=>void;contextKey:string;label:string;initialA?:string;initialB?:string}
export function HeadToHeadPanel({tournaments,activity,onOpen,contextKey,label,initialA="",initialB=""}:HeadToHeadProps){
 const profiles=useMemo(()=>buildClubProfiles(tournaments),[tournaments]);
 const [aKey,setA]=useSessionDraft(`${contextKey}:a`,initialA),[bKey,setB]=useSessionDraft(`${contextKey}:b`,initialB);
 const [filters,setFilters]=useSessionDraft<H2HFilters>(`${contextKey}:filters`,{});
 const [selected,setSelected]=useSessionDraft<string[]>(`${contextKey}:sources`,[]);
 const a=profiles.find(p=>p.occurrences.some(o=>o.key===aKey)),b=profiles.find(p=>p.occurrences.some(o=>o.key===bKey));
 const result=useMemo(()=>a && b?headToHeadMatches(a,b,tournaments,activity,filters):{rows:[] as H2HMatch[]},[a,b,tournaments,activity,filters]);
 const summary=result.error?{error:result.error}:summarizeHeadToHead(result.rows,selected,tournaments,activity);
 const groups=useMemo(()=>groupCompetitions(tournaments),[tournaments]);
 const candidates=tournaments.filter(t=>result.rows.some(r=>r.tournament.id===t.id));
 const update=(field:keyof H2HFilters,value:string)=>setFilters(old=>({...old,[field]:value}));
 const clubLabel=(p:typeof profiles[number])=>`${p.names[p.names.length-1]} · ID ${p.teamIds.join(", ")} · ${p.occurrences[0].tournament.name} · ${p.occurrences[0].tournament.id}${p.warning?" · Identidad ambigua":""}`;
 const changeClub=(side:"a"|"b",value:string)=>{(side==="a"?setA:setB)(value);setSelected([]);};
 return <section className="club-history head-to-head" aria-label={`Enfrentamientos directos (H2H) · ${label}`}>
  <h3>Enfrentamientos directos (H2H)</h3>
  <p>Solo encuentros guardados. Los nombres iguales no acreditan identidad. Las fuentes se eligen expresamente para el acumulado.</p>
  <div className="competition-controls">
   <label>Club A<select value={a?.key ?? ""} onChange={e=>changeClub("a",e.target.value)}><option value="">Selecciona el primer club</option>{profiles.map(p=><option key={p.key} value={p.key}>{clubLabel(p)}</option>)}</select></label>
   <label>Club B<select value={b?.key ?? ""} onChange={e=>changeClub("b",e.target.value)}><option value="">Selecciona el segundo club</option>{profiles.map(p=><option key={p.key} value={p.key}>{clubLabel(p)}</option>)}</select></label>
   <label>Competición H2H<select value={filters.competition ?? ""} onChange={e=>update("competition",e.target.value)}><option value="">Todas las competiciones</option>{groups.map(g=><option key={g.id} value={g.id}>{g.name} · {g.id}</option>)}</select></label>
   <label>Temporada H2H<select value={filters.season ?? ""} onChange={e=>update("season",e.target.value)}><option value="">Todas las temporadas</option>{[...new Set(tournaments.map(t=>String(t.season ?? "unknown")))].sort().map(year=><option key={year} value={year}>{year==="unknown"?"Año no registrado":year}</option>)}</select></label>
   <label>Localía del club A<select value={filters.venue ?? ""} onChange={e=>update("venue",e.target.value)}><option value="">Local y visitante</option><option value="home">A como local</option><option value="away">A como visitante</option></select></label>
   <label>Procedencia H2H<select value={filters.provenance ?? ""} onChange={e=>update("provenance",e.target.value)}><option value="">Todas las procedencias</option>{Object.entries(provenanceLabels).map(([key,text])=><option key={key} value={key}>{text}</option>)}</select></label>
  </div>
  {(aKey && !a || bKey && !b) && <p role="alert">Una identidad o fuente seleccionada ya no está disponible. Revisa los clubes y las fuentes sin reconstruir relaciones por nombre.</p>}
  {a && b && <>
   {(a.warning || b.warning) && <p role="note">Identidad ambigua: la comparación está bloqueada; los registros se conservan separados.</p>}
   <fieldset><legend>Fuentes incluidas en el acumulado H2H</legend>{candidates.map(t=><label className="club-history-choice" key={t.id}><input type="checkbox" checked={selected.includes(t.id)} onChange={e=>setSelected(old=>e.target.checked?[...old,t.id]:old.filter(id=>id!==t.id))}/>{t.name} · {t.season ?? "sin año"} · {t.id}</label>)}
    <button className="small-action" type="button" onClick={()=>setSelected([])}>Limpiar fuentes H2H</button>
   </fieldset>
   {summary.error?<p role={selected.length || result.error?"alert":"note"}>{summary.error}</p>:summary.totals && <section aria-label="Acumulado H2H">
    <h4>Acumulado de la selección y los filtros</h4>
    <p>{summary.totals.a.played} PJ · A: {summary.totals.a.wins} victorias · B: {summary.totals.b.wins} victorias · {summary.totals.a.draws} empates</p>
    <p>Goles reglamentarios: A {summary.totals.a.goalsFor} · B {summary.totals.b.goalsFor}. {summary.notCounted} encuentros no computables o pendientes. Fuentes con encuentros en este filtro: {summary.seasons} de {selected.length} seleccionadas.</p>
    <p>A local / B visitante: {summary.home.a.played} PJ · A {summary.home.a.wins} G · {summary.home.a.draws} E · B {summary.home.b.wins} G · goles A {summary.home.a.goalsFor}–{summary.home.b.goalsFor} B.</p>
    <p>A visitante / B local: {summary.away.a.played} PJ · A {summary.away.a.wins} G · {summary.away.a.draws} E · B {summary.away.b.wins} G · goles A {summary.away.a.goalsFor}–{summary.away.b.goalsFor} B.</p>
    <p>No es el historial completo de la carrera de estos clubes. V/E/D y goles corresponden al tiempo reglamentario; prórrogas y penales se muestran por separado. Las tandas no añaden victorias reglamentarias.</p>
    {summary.streaks?<p>Rachas máximas en el alcance filtrado: victorias A {summary.streaks.winsA}, B {summary.streaks.winsB}; invictos A {summary.streaks.unbeatenA}, B {summary.streaks.unbeatenB}.</p>:<p>Rachas no disponibles: se requieren resultados válidos y cronología inequívoca de todos los encuentros seleccionados.</p>}
    {summary.chronology?<><h4>Últimos enfrentamientos disputados de la selección (hasta cinco)</h4><ul>{summary.latest.map(r=><li key={r.key}>{matchText(r)} <button className="small-action" type="button" onClick={()=>onOpen(r.tournament)}>Abrir origen del último encuentro</button></li>)}</ul></>:<p>Últimos enfrentamientos no acreditados: faltan fecha, hora o zona inequívocas. El listado conserva un orden de consulta, sin inventar fechas.</p>}
   </section>}
   <h4>Encuentros registrados con estos filtros ({result.rows.length})</h4>
   <p>El listado puede incluir fuentes y escenarios distintos; solo las fuentes seleccionadas y compatibles aportan al acumulado. Los partidos sin instante completo aparecen aparte en el orden de consulta.</p>
   {!result.rows.length && <p>Sin enfrentamientos atribuibles a estos registros con los filtros actuales.</p>}
   <div className="club-history-timeline">{result.rows.map(r=><article className="club-history-season" key={r.key} aria-label={`Encuentro ${r.fixture.id} · ${r.tournament.id}`}>
    <p>{matchText(r)}</p><p>{r.status} · {provenanceLabels[r.scenario]} · {r.resultOrigin}</p>
    <p>{r.day.phaseName ?? "Fase no registrada"} · Rueda {r.day.leg} · Jornada {r.day.number} · Competición ID {competitionIdentity(r.tournament)}</p>
    <p>Fuente: {r.tournament.sourceName ?? "no registrada"} · {r.tournament.sourceUrl ?? "sin referencia de proveedor"} · Cobertura: {r.tournament.importCoverage ?? "no acreditada"}</p>
    {r.fixture.result && <p>{r.played?"Resultado válido":"Marcador conservado, excluido del acumulado"}: 90′ {r.fixture.result.homeGoals}–{r.fixture.result.awayGoals}{r.fixture.result.extraTime?` · Prórroga (goles adicionales) ${r.fixture.result.extraTime.homeGoals}–${r.fixture.result.extraTime.awayGoals}`:""}{r.fixture.result.penalties?` · Tanda ${r.fixture.result.penalties.homeGoals}–${r.fixture.result.penalties.awayGoals}`:""}.</p>}
    <p>No se infiere el clasificado de una eliminatoria a partir de este marcador aislado.</p>
    <button className="small-action" type="button" onClick={()=>onOpen(r.tournament)}>Abrir torneo del encuentro</button>
   </article>)}</div>
  </>}
 </section>;
}
function matchText(r:H2HMatch){
 const f=r.fixture,t=r.tournament;
 return `${f.schedule?.date ?? "Fecha no registrada"}${f.schedule?.time?` ${f.schedule.time}`:""}${f.schedule?.utcOffset?` ${f.schedule.utcOffset}`:" (zona no registrada)"} · ${t.name} · ${t.season ?? "sin año"} · ${t.teams.find(team=>team.id===f.homeTeamId)?.name} (local) – ${t.teams.find(team=>team.id===f.awayTeamId)?.name} (visitante)${r.played?` · 90′ ${f.result!.homeGoals}–${f.result!.awayGoals}`:" · Sin resultado computable"}`;
}

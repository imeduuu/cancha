import {ClubAssociationsAccess} from "./club-associations-access";
import {useEffect, useMemo, useRef, useState} from "react";
import type {Tournament} from "@cancha/core/domain/entities/tournament";
import type {ActivityEvent} from "@cancha/core/domain/entities/activity-event";
import type {SportsUniverseLibrary} from "@cancha/core/domain/entities/sports-universe";
import {projectHistoricalArchive, type ArchiveFilters} from "@cancha/core/application/services/historical-archive";
import {sportingStorageKeys} from "../../infrastructure/persistence/library-write-lock";
import {ClubHistoryAccess} from "./club-history-access";
import {HistoricalRecordsAccess} from "./historical-records-access";
import {ClubPerformanceAccess} from "./club-performance-access";

type Projection = ReturnType<typeof projectHistoricalArchive>;
type Row = Projection["rows"][number];
interface Props {
  read: () => {tournaments: Tournament[]; activity: ActivityEvent[]; library: SportsUniverseLibrary};
  onOpen: (t: Tournament) => void; onCalendar: (t: Tournament) => void; onClosure: (t: Tournament) => void;
  onPlanning: (t: Tournament) => void; onQualification: (t: Tournament) => void; onCompetitions: () => void; onClose: () => void;
}
const edition = (year?: number) => year === undefined ? "Sin año registrado" : String(year);

export function HistoricalArchive(props: Props) {
  const snapshot = props.read(), fingerprint = JSON.stringify(snapshot);
  const [filters, setFilters] = useState<ArchiveFilters>({}), [scope, setScope] = useState(snapshot.library.activeUniverseId);
  const [clubFocus,setClubFocus]=useState<string>();
  const [, refresh] = useState(0), heading = useRef<HTMLHeadingElement>(null);
  const currentFilters = scope === snapshot.library.activeUniverseId ? filters : {};
  const currentClubFocus = scope === snapshot.library.activeUniverseId ? clubFocus : undefined;
  useEffect(()=>{setScope(snapshot.library.activeUniverseId);setFilters({});setClubFocus(undefined);},[snapshot.library.activeUniverseId]);
  useEffect(()=>{heading.current?.focus();},[]);
  useEffect(()=>{
    const storage=(event:StorageEvent)=>{if(event.key===null || sportingStorageKeys.some(key=>key===event.key))refresh(n=>n+1);};
    const focus=()=>refresh(n=>n+1);
    window.addEventListener("storage",storage);window.addEventListener("focus",focus);
    return ()=>{window.removeEventListener("storage",storage);window.removeEventListener("focus",focus);};
  },[]);
  const archive=useMemo(()=>projectHistoricalArchive(snapshot.tournaments,snapshot.activity,snapshot.library,currentFilters),[fingerprint,currentFilters]);
  const set=(key:keyof ArchiveFilters,value:string)=>setFilters(previous=>({...previous,[key]:value}));
  const distinct=(key:"country"|"confederation"|"category"|"type"|"provenance")=>[...new Set(archive.rows.map(row=>row[key]))].sort();
  const scopedTournaments=archive.rows.map(row=>row.tournament);
  const scopedActivity=archive.activity;
  const contextKey=`archive:${snapshot.library.activeUniverseId ?? "unassigned"}`;
  const name=(row:Row,id?:string)=>row.tournament.teams.find(team=>team.id===id)?.name ?? "No determinado";
  function card(row:Row) {
    const t=row.tournament,e=row.closure;
    return <article key={t.id} className="archive-season" aria-label={`Ficha histórica de ${t.name}`}>
      <header><span className="eyebrow">{row.country} · {row.category}</span><h4>{t.name}</h4><p>{edition(t.season)} · {row.type} · {t.archived?"Archivada administrativamente":"Sin archivar"}</p></header>
      <p className="archive-badge">{e.state}</p><p>{e.overview.status} · {e.overview.played}/{e.overview.total} partidos acreditados</p>
      <p>{row.titleStatus}</p>{row.champion && <p className="archive-champion">Campeón: {name(row,row.champion.teamId)}</p>}
      {row.runner && <p>Subcampeón: {name(row,row.runner.teamId)}</p>}
      <p>{e.overview.provenance}. Los cálculos y cierres locales no certifican resultados oficiales.</p>
      <details><summary>Clasificación, fases y decisiones de {t.name}</summary>
        {e.tables.map(table=><div key={table.label} className="table-scroll"><table><caption>{table.label}{e.blockers.length?" · requiere revisión":""}</caption><thead><tr><th>Pos.</th><th>Club</th><th>Puntos</th><th>PJ</th></tr></thead><tbody>{table.rows.map((r,i)=><tr key={r.teamId}><td>{i+1}</td><td>{r.teamName}</td><td>{r.points}</td><td>{r.played}</td></tr>)}</tbody></table></div>)}
        {!e.tables.length && <p>No existe una clasificación final acreditada para este formato.</p>}
        <ul>{e.honours.awards.filter(a=>a.label.startsWith("Posición destacada")).map(a=><li key={a.label}>{a.label}: {name(row,a.teamId)}</li>)}</ul>
        <ul>{e.phases.map(phase=><li key={phase.index}>{phase.label} · {phase.complete?"Completa":"Pendiente"}</li>)}</ul>
        {t.knockoutStages?.length && <div><h5>Encuentros de la final registrada</h5>{t.matchdays.filter(day=>{const stage=t.knockoutStages!.at(-1)!;return /(?:^| · )final$/i.test(stage.name) && (day.phaseName===stage.name || day.phaseName?.startsWith(`${stage.name} · `));}).map((day,i)=><ul key={i}>{day.fixtures.map(f=><li key={f.id}>{name(row,f.homeTeamId)} — {name(row,f.awayTeamId)}: {f.result?`${f.result.homeGoals}–${f.result.awayGoals}${f.result.extraTime?` · prórroga ${f.result.extraTime.homeGoals}–${f.result.extraTime.awayGoals}`:""}${f.result.penalties?` · penales ${f.result.penalties.homeGoals}–${f.result.penalties.awayGoals}`:""}`:"Pendiente"}</li>)}</ul>)}</div>}
        <h5>Participantes registrados</h5><ul>{row.participation.map(p=><li key={p.team.id}>{p.team.name} · {p.scheduled?"Participación acreditada en calendario":"Inscripción sin encuentros registrados"} <button type="button" className="small-action" onClick={()=>{setClubFocus(p.profileKey);requestAnimationFrame(()=>document.getElementById("archive-existing-queries")?.focus());}}>Ver historial de {p.team.name}</button></li>)}</ul>
        <h5>Asuntos pendientes de esta edición</h5><ul>{e.blockers.map(reason=><li key={reason}>{reason}</li>)}</ul>
        <h5>Relaciones y antecedentes</h5><ul>{row.origins.map(origin=><li key={origin.id}>{origin.tournament?<button type="button" className="small-action" onClick={()=>props.onOpen(origin.tournament!)}>{origin.tournament.name}</button>:`Referencia no resuelta en este universo: ${origin.id}`}</li>)}{e.dependencies.map(d=><li key={d.id}>{d.name} · {d.kind} · {d.available?"Disponible":"No resuelta"}</li>)}</ul>
        <p>Confirmaciones conservadas: {e.history.length}. {e.confirmed?"Última confirmación vigente.":"Sin cierre vigente acreditado."}</p>
      </details>
      <details><summary>Asociaciones registradas de {t.name}</summary><p>Afiliaciones desconocidas: {row.associations.unknown}. Sin verificación definitiva o pendientes de revisión: {row.associations.pending}.</p><p>Las afiliaciones corresponden a esta edición; no acreditan clasificaciones ni representaciones nacionales deducidas.</p><ul>{row.associations.associations.map(a=><li key={a.association.id}>{a.association.name}: {a.registered} inscritos con relaci?n registrada ? {a.scheduled} con encuentros ? {a.played} con partidos disputados ? {a.verified} afiliaciones verificadas por el usuario.</li>)}</ul><ClubAssociationsAccess tournament={t}/></details>
      <details><summary>Clasificaciones continentales de {t.name}</summary>
        <p>Clasificar no acredita haber participado en la edición de destino.</p>
        <ul>{row.qualification?.entries.map((entry,i)=><li key={i}>{entry.teamName} → {entry.destination} · {entry.status} · {entry.originTournamentName} · Vía: {row.qualification?.qualificationRoutes.find(q=>q.teamId===entry.sourceTeamId && q.destination===entry.destination && (q.originTournamentId ?? t.id)===entry.originTournamentId)?.source ?? "Origen registrado"}</li>)}</ul>
        <ul>{[...new Set([...e.nextSeasonPending,...(row.qualification?.reasons ?? [])])].map(reason=><li key={reason}>{reason}</li>)}</ul>
        {t.continentalPlans?.map(plan=><div key={plan.id}><p>Admisión registrada: {plan.cup} · {plan.edition} · {plan.mode}{plan.requiresReview?" · requiere revisión":""}</p><ul>{plan.entries.map((entry,i)=><li key={i}>{entry.teamName} · {entry.status} · {entry.originTournamentName}{entry.targetTeamId?" · participante vinculado":" · sin participante vinculado"}</li>)}</ul></div>)}
      </details>
      <nav aria-label={`Orígenes de ${t.name}`} className="archive-actions">
        <button type="button" className="small-action" onClick={()=>props.onOpen(t)}>Abrir temporada original</button>
        <button type="button" className="small-action" onClick={()=>props.onCalendar(t)}>Calendario</button>
        <button type="button" className="small-action" onClick={()=>props.onClosure(t)}>Revisar cierre</button>
        <button type="button" className="small-action" onClick={()=>props.onOpen(t)}>Estadísticas del torneo</button>
        <button type="button" className="small-action" onClick={()=>props.onQualification(t)}>Clasificación internacional</button>
        <button type="button" className="small-action" onClick={()=>props.onPlanning(t)}>Planificación de temporadas</button>
      </nav>
    </article>;
  }
  return <section className="preview-panel historical-archive" aria-label="Archivo histórico del universo">
    <header className="archive-heading"><div><span className="eyebrow">MEMORIA DE LA PARTIDA</span><h2 ref={heading} tabIndex={-1}>Archivo histórico</h2><p>{archive.universeName}</p></div><div className="archive-actions"><button type="button" className="small-action" onClick={props.onClose}>Volver al contexto anterior</button><button type="button" className="small-action" onClick={props.onCompetitions}>Centro de competiciones</button></div></header>
    <p>Explora las ediciones y sus fundamentos actuales. Consultar el archivo no guarda datos ni reconstruye acontecimientos ausentes.</p>
    <details open><summary>Buscar y filtrar el archivo</summary><div className="archive-filters">
      <label>Buscar clubes y competiciones<input type="search" value={currentFilters.search ?? ""} onChange={e=>set("search",e.target.value)}/></label>
      <label>Año del archivo<select value={currentFilters.year ?? ""} onChange={e=>set("year",e.target.value)}><option value="">Todos los años</option>{[...new Set(archive.rows.map(r=>r.tournament.season))].sort((a,b)=>(b??-Infinity)-(a??-Infinity)).map(year=><option key={year ?? "undated"} value={year ?? "undated"}>{edition(year)}</option>)}</select></label>
      {([['country','País'],['confederation','Confederación'],['category','Categoría'],['type','Tipo de competición'],['provenance','Procedencia']] as const).map(([key,label])=><label key={key}>{label}<select value={currentFilters[key] ?? ""} onChange={e=>set(key,e.target.value)}><option value="">Todos</option>{distinct(key).map(value=><option key={value} value={value}>{value}</option>)}</select></label>)}
      <label>Competición del archivo<select value={currentFilters.competition ?? ""} onChange={e=>set("competition",e.target.value)}><option value="">Todas</option>{[...new Map(archive.rows.map(r=>[r.competition,`${r.country} · ${r.competitionName} (${r.competition})`])).entries()].map(([id,label])=><option value={id} key={id}>{label}</option>)}</select></label>
      <label>Club del archivo<select value={currentFilters.club ?? ""} onChange={e=>set("club",e.target.value)}><option value="">Todos</option>{archive.profiles.map(profile=><option key={profile.key} value={profile.key}>{profile.names.join(" / ")} · {profile.teamIds.join(", ")}{profile.warning?" · identidad ambigua":""}</option>)}</select></label>
      <label>Estado del cierre<select value={currentFilters.closure ?? ""} onChange={e=>set("closure",e.target.value)}><option value="">Todos</option>{[...new Set(archive.rows.map(r=>r.closure.state))].map(state=><option key={state}>{state}</option>)}</select></label>
    </div><button type="button" className="small-action" onClick={()=>setFilters({})}>Limpiar filtros históricos</button></details>
    {!archive.rows.length && <p>Este universo no tiene temporadas registradas.</p>}
    {!!archive.rows.length && !archive.selected.length && <p>No hay temporadas que coincidan con estos filtros.</p>}
    <nav aria-label="Cronología de temporadas" className="archive-timeline">{archive.yearbooks.map(book=><a key={book.year ?? "undated"} href={`#archive-year-${book.year ?? "undated"}`}><strong>{edition(book.year)}</strong><span>{book.counts.competitions} ediciones · {book.counts.champions} campeones</span><span>{book.counts.confirmed} cierres vigentes · {book.counts.stale} desactualizados</span></a>)}</nav>
    {archive.yearbooks.map(book=><section key={book.year ?? "undated"} id={`archive-year-${book.year ?? "undated"}`} aria-label={`Anuario ${edition(book.year)}`} className="archive-yearbook">
      <h3>Anuario {edition(book.year)}</h3><dl className="archive-counts">{Object.entries({"Competiciones":book.counts.competitions,"Finalizadas deportivamente":book.counts.completed,"En disputa":book.counts.inProgress,"Pendientes":book.counts.pending,"Listas sin confirmar cierre":book.counts.pendingClosure,"Cierres vigentes":book.counts.confirmed,"Cierres desactualizados":book.counts.stale,"Campeones identificados":book.counts.champions,"Movimientos calculados o registrados":book.counts.movements,"Cupos internacionales definitivos":book.counts.qualifications,"Participantes continentales con encuentros":book.counts.participants}).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <h4>Campeones del año</h4><div className="archive-champions">{book.seasons.filter(r=>r.champion).map(row=><button type="button" key={row.tournament.id} onClick={()=>props.onOpen(row.tournament)}><span>{row.tournament.name} · {edition(row.tournament.season)}</span><strong>{name(row,row.champion?.teamId)}</strong><span>{row.titleStatus}</span><span>{row.closure.overview.provenance} · {row.closure.state}</span>{row.runner && <span>Subcampeón: {name(row,row.runner.teamId)}</span>}</button>)}</div>
      {!book.counts.champions && <p>No hay campeones acreditados. Las temporadas y sus limitaciones permanecen abajo.</p>}
      {(["Liga","Copa nacional","Continental","Tipo no registrado"] as const).map(type=>{const seasons=book.seasons.filter(r=>r.type===type);return seasons.length?<section key={type} aria-label={`${type} ${edition(book.year)}`}><h4>{type==="Liga"?"Ligas nacionales":type==="Copa nacional"?"Copas nacionales":type==="Continental"?"Competiciones continentales":type}</h4>{[...new Set(seasons.map(r=>`${r.country} · ${r.category}`))].map(group=><div key={group}><h5>{group}</h5><div className="archive-seasons">{seasons.filter(r=>`${r.country} · ${r.category}`===group).map(card)}</div></div>)}</section>:null;})}
    </section>)}
    {archive.yearbooks.length>1 && <div className="table-scroll"><table><caption>Comparación anual del universo</caption><thead><tr><th>Edición</th><th>Competiciones</th><th>Campeones</th><th>Participantes continentales con encuentros</th><th>Movimientos calculados o registrados</th><th>Cupos definitivos</th></tr></thead><tbody>{archive.yearbooks.map(book=><tr key={book.year ?? "undated"}><th>{edition(book.year)}</th><td>{book.counts.competitions}</td><td>{book.seasons.filter(r=>r.champion).map(r=>`${r.tournament.name}: ${name(r,r.champion?.teamId)}`).join("; ") || "No acreditados"}</td><td>{book.counts.participants}</td><td>{book.counts.movements}</td><td>{book.counts.qualifications}</td></tr>)}</tbody></table></div>}
    <section aria-label="Movimientos históricos"><h3>Movimientos entre divisiones</h3><p>Proyecciones y registros se muestran por separado. Un cálculo no demuestra que la transición se haya incorporado a otra edición.</p>{!archive.movements.length && <p>No hay movimientos acreditados para esta selección.</p>}<ul>{archive.movements.map(m=><li key={m.key}><strong>{m.club}</strong> · {edition(m.year)} · {m.origin} → {m.destination}<br/>{m.mechanism} · {m.status} · {m.source} <button type="button" className="small-action" onClick={()=>{const t=scopedTournaments.find(t=>t.id===m.tournamentId);if(t)props.onOpen(t);}}>Abrir origen del movimiento</button></li>)}</ul></section>
    <section aria-label="Evolución anual"><h3>Evolución de las competiciones</h3><p>Solo se relacionan identidades registradas. Aparecer o dejar de aparecer en una categoría no demuestra un movimiento deportivo. Para comparar métricas se utiliza el rendimiento existente.</p>{!archive.evolution.length && <p>Selecciona varias ediciones con una identidad de competición compartida para comparar.</p>}<ul>{archive.evolution.map((e,i)=><li key={i}><strong>{e.competition}: {edition(e.previous.season)} → {edition(e.current.season)}</strong><p>{e.reason}</p><p>Nuevas presencias registradas: {e.appeared.join(", ") || "Ninguna acreditada"}. Ausencias respecto de la edición anterior: {e.disappeared.join(", ") || "Ninguna acreditada"}.</p><button className="small-action" type="button" onClick={()=>props.onOpen(e.previous)}>Abrir edición anterior</button><button className="small-action" type="button" onClick={()=>props.onOpen(e.current)}>Abrir edición posterior</button></li>)}</ul></section>
    <section aria-label="Acontecimientos históricos"><h3>Acontecimientos registrados</h3><p>La fecha es la del registro de actividad, no necesariamente la del partido o hecho deportivo. No se reconstruyen eventos que no se guardaron.</p>{!archive.events.length && <p>No hay actividad registrada para esta selección.</p>}<ol className="archive-events">{archive.events.map(({event,kind,origin,year})=><li key={event.id}><time dateTime={event.occurredAt}>{event.occurredAt}</time><p><strong>{event.summary}</strong></p><p>{kind} · {event.action} · {edition(year)} · {event.imported?"Registro importado":"Registro local"} · ID {event.id}</p>{origin?<button type="button" className="small-action" onClick={()=>props.onOpen(origin)}>{origin.name}</button>:<p>Referencia no resuelta en este universo: {event.tournamentId} · {event.tournamentName}</p>}<details><summary>Datos originales del acontecimiento</summary><pre>{JSON.stringify(event,null,2)}</pre></details></li>)}</ol></section>
    <section id="archive-existing-queries" tabIndex={-1} aria-label="Consultas históricas existentes"><h3>Explorar clubes y récords</h3><p>Estas consultas utilizan todas las temporadas del universo activo; mantienen sus filtros y criterios propios.</p><ClubHistoryAccess key={`${contextKey}:history:${currentClubFocus ?? "all"}`} contextKey={`${contextKey}:history:${currentClubFocus ?? "all"}`} initialClub={currentClubFocus} initiallyOpen={!!currentClubFocus} tournaments={scopedTournaments} activity={scopedActivity} onOpen={props.onOpen}/><HistoricalRecordsAccess key={`${contextKey}:records`} contextKey={`${contextKey}:records`} tournaments={scopedTournaments} activity={scopedActivity} onOpen={props.onOpen}/><ClubPerformanceAccess label="Archivo histórico" key={`${contextKey}:performance`} contextKey={`${contextKey}:performance`} tournaments={scopedTournaments} activity={scopedActivity} onOpen={props.onOpen}/></section>
  </section>;
}

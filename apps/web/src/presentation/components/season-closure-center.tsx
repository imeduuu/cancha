import {SportsDecisionsAccess} from "./sports-decisions-access";
import { useEffect, useRef, useState } from "react";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import type { TournamentRepository } from "@cancha/core/application/ports/tournament-repository";
import { evaluateSeasonClosure } from "@cancha/core/application/services/season-closure";
import { reviewSeasonClosure, confirmSeasonClosure, type SeasonClosureReview } from "@cancha/core/application/use-cases/confirm-season-closure";
import { useLibraryWrite } from "../library-write-context";
import { sportingStorageKeys } from "../../infrastructure/persistence/library-write-lock";
import { isHttpsReference } from "@cancha/core/domain/services/continental-plan";
import { championTierLabels } from "@cancha/core/application/services/champion-tier";
import { ChampionCards } from "./champion-card";

export function SeasonClosureCenter({tournaments, repository, universeId, universeName, initialTournamentId, getUniverseId, onChanged, onCalendar, onAlerts, onEdit, onPlanning, onClose}: {
  tournaments: readonly Tournament[]; repository: TournamentRepository; universeId: string | null; universeName: string;
  initialTournamentId?: string; getUniverseId: () => string | null; onChanged: () => void;
  onCalendar: (t: Tournament) => void; onAlerts: (t: Tournament) => void; onEdit: (t: Tournament) => void;
  onPlanning: (t: Tournament) => void; onClose: () => void;
}) {
  const runWrite = useLibraryWrite();
  const [id, setId] = useState(initialTournamentId ?? tournaments[0]?.id ?? "");
  const [review, setReview] = useState<SeasonClosureReview | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const pending = useRef(false), heading = useRef<HTMLHeadingElement>(null);
  const [, refreshRead] = useState(0);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    const refresh = (event: StorageEvent) => {if(event.key===null || sportingStorageKeys.some(key=>key===event.key))refreshRead(value=>value+1);};
    const focus = () => refreshRead(value=>value+1);
    window.addEventListener("storage",refresh);window.addEventListener("focus",focus);
    return () => {window.removeEventListener("storage",refresh);window.removeEventListener("focus",focus);};
  }, []);
  const liveTournaments = repository.findAll(), scopeChanged = getUniverseId() !== universeId;
  const current = liveTournaments.find(t => t.id === id), activity = repository.findActivity?.() ?? [];
  const evaluation = review?.evaluation ?? (current ? evaluateSeasonClosure(current, liveTournaments, activity, universeId) : undefined);
  const t = evaluation?.tournament;
  const name = (teamId: string) => t?.teams.find(team => team.id === teamId)?.name ?? teamId;
  const simulated = evaluation?.closureTier === "simulated";
  async function confirm() {
    if (!review || pending.current) return;
    pending.current = true;setBusy(true);
    try {
      await runWrite(() => confirmSeasonClosure(review, getUniverseId(), repository, true));
      onChanged();setReview(null);setMessage(review.evaluation.closureTier === "simulated"
        ? "Cierre simulado confirmado (no oficial). Resultados conservados; no se creó una nueva edición."
        : "Cierre deportivo confirmado. Resultados conservados; no se creó una nueva edición.");
    } catch (error) { setReview(null);setMessage(error instanceof Error ? error.message : "No se pudo confirmar el cierre."); }
    finally { pending.current = false;setBusy(false); }
  }
  return <section className="preview-panel season-closure-center" aria-label="Centro de cierre de temporadas">
    <h2 tabIndex={-1} ref={heading}>Centro de cierre y revisión deportiva</h2>
    <button type="button" className="small-action" onClick={onClose} disabled={busy}>Volver al contexto anterior</button>
    <p>Universo: {universeName}. La confirmación registra una revisión local, sin certificar documentos externos ni resultados oficiales. No archiva ni impide editar.</p>
    {scopeChanged && <p role="alert">El universo activo cambió. Actualiza la biblioteca antes de confirmar un cierre.</p>}
    <label>Competición y temporada para cierre<select value={id} disabled={busy} onChange={event => {setId(event.target.value);setReview(null);setMessage("");}}>
      <option value="">Selecciona una temporada</option>{liveTournaments.map(item => <option key={item.id} value={item.id}>{item.name} · {item.season ?? "Sin año"}</option>)}
    </select></label>
    {review && <p>La información mostrada pertenece a la revisión capturada. Confirmar vuelve a comprobar sus fundamentos y el estado guardado.</p>}
    {t && evaluation && <>
      <p role="status">Estado: {evaluation.state}</p>
      <p>{t.name} · Edición {t.season ?? "Sin año"} · Formato: {t.competitionType ?? "No registrado"} / {t.format ?? "No registrado"}</p>
      <p>{evaluation.overview.provenance}. {evaluation.closureTier ? championTierLabels[evaluation.closureTier] : "Sin resultado deportivo determinado"}; no constituye certificación externa.</p>
      <p>{t.teams.length} participantes · {evaluation.overview.played} partidos disputados · {evaluation.overview.total - evaluation.overview.played} pendientes · {evaluation.matchdays.filter(p => p.complete).length}/{evaluation.matchdays.length} jornadas completas · {evaluation.phases.filter(p => p.complete).length}/{evaluation.phases.length} fases o ruedas completas.</p>
      <details><summary>Participantes y calendario</summary><ul>{t.teams.map(team => <li key={team.id}>{team.name}</li>)}</ul>
        <ul>{evaluation.phases.map(phase => <li key={phase.index}>{phase.label}: {phase.complete ? "Completa" : "Pendiente"}</li>)}</ul>
        <ul>{evaluation.matchdays.map(day=><li key={day.index}>{day.label}: {day.complete?"Completa":"Pendiente"}</li>)}</ul></details>
      <p>Reglamento: {evaluation.overview.rules}. Integridad: {evaluation.integrity.length ? "Requiere corrección" : "Sin incidencias detectadas"}.</p>
      <details><summary>Reglamento registrado y fuentes</summary><p>Edición reglamentaria: {t.competitionRules?.season ?? "No registrada"}. {t.competitionRules?.standingsNote}</p>
        <ul>{t.competitionRules?.sourceUrls?.map((url,index)=><li key={index}>{isHttpsReference(url)?<a href={url} target="_blank" rel="noreferrer">{url}</a>:url}</li>)}</ul>
        {t.matchRegulations && <p>Reglamento de partidos: {t.matchRegulations.season} · {t.matchRegulations.verification}. {t.matchRegulations.notes} {t.matchRegulations.sourceUrl && isHttpsReference(t.matchRegulations.sourceUrl) && <a href={t.matchRegulations.sourceUrl} target="_blank" rel="noreferrer">Fuente del reglamento de partidos</a>}</p>}</details>
      <h3>Resultados deportivos</h3>
      <ChampionCards tournament={t} activity={activity} showRunnerUp={false} />
      {evaluation.honours.awards.length ? <ul>{evaluation.honours.awards.filter(a => ["Campeón", "Subcampeón"].includes(a.label) || a.label.startsWith("Campeón del ")).map(a => <li key={a.label}>{a.label}: {name(a.teamId)}{a.tier && a.tier !== "verified" ? ` · ${championTierLabels[a.tier]}` : ""}</li>)}</ul> : <p>No hay campeón acreditado por los servicios deportivos existentes.</p>}
      {evaluation.tables.map(table => <div className="table-scroll" key={table.label}><table><caption>{table.label === "Clasificación final" && evaluation.blockers.length ? "Clasificación calculada · requiere revisión" : table.label}</caption><thead><tr><th>Posición</th><th>Club</th><th>Puntos</th><th>PJ</th></tr></thead><tbody>{table.rows.map((row, index) => <tr key={row.teamId}><td>{index + 1}</td><td>{row.teamName}</td><td>{row.points}</td><td>{row.played}</td></tr>)}</tbody></table></div>)}
      <h3>Ascensos, descensos y decisiones</h3>
      <p>Ascendidos calculados: {evaluation.division?.promoted.map(name).join(", ") || "Sin ascensos resueltos por un servicio aplicable"}.</p>
      <p>{simulated ? "Descensos calculados (simulado, no oficial)" : "Descensos calculados"}: {evaluation.relegated.map(row => `${name(row.teamId)} → ${row.destination}`).join("; ") || "Sin descensos resueltos por un servicio aplicable"}.</p>
      {evaluation.averages && <p>Proyección de descensos por promedio, separada de la tabla: {evaluation.averages.standings.filter(row => row.relegation).map(row => `${row.teamName} · ${row.status}`).join("; ") || "Sin plazas resueltas"}. {evaluation.averages.pendingReasons.join(" ")}</p>}
      <p>{t.competitionRules?.placementsNote ?? t.placementRules?.note ?? "No se deducen movimientos por el nombre de la competición."}</p>
      <details><summary>Resoluciones registradas ({evaluation.resolutions.length})</summary><ul>{evaluation.resolutions.map(resolution => <li key={resolution.id}>{resolution.key} · {resolution.verification} · {resolution.invalidation ? "Invalidada" : resolution.supersededBy ? "Sustituida" : "Registro vigente"} · <a href={resolution.source.url} target="_blank" rel="noreferrer">{resolution.source.reference}</a></li>)}</ul></details>
      <h3>Clasificación internacional y próxima edición</h3>
      {evaluation.international ? <ul>{evaluation.international.entries.map((entry, index) => <li key={index}>{entry.teamName} → {entry.destination} · {entry.status === "confirmed" ? "Definitiva según cálculo registrado" : entry.status === "provisional" ? "Provisional" : "Pendiente"} · {entry.sourceTournamentName} / {entry.originTournamentName} · Vía: {evaluation.international?.qualificationRoutes.find(route => route.teamId === entry.sourceTeamId && route.destination === entry.destination && (route.originTournamentId ?? t.id) === entry.originTournamentId)?.source ?? "Origen registrado"}</li>)}</ul> : <p>Sin regla internacional registrada para mostrar cupos. No se infieren plazas.</p>}
      <p>Estas dependencias no bloquean por sí solas el cierre de una competición independiente.</p>
      <ul>{evaluation.nextSeasonPending.map(reason => <li key={reason}>{reason}</li>)}</ul>
      <ul aria-label="Dependencias del cierre y preparación">{evaluation.dependencies.map(dependency=><li key={dependency.id}>{dependency.name} · {dependency.kind} · {dependency.available?"Disponible":"No disponible en este universo"}
        {dependency.available && <button type="button" className="small-action" disabled={busy} onClick={()=>{const source=liveTournaments.find(item=>item.id===dependency.id);if(source)onEdit(source);}}>Revisar temporada vinculada: {dependency.name}</button>}</li>)}</ul>
      <SportsDecisionsAccess tournament={t} />
      <h3>Bloqueos de la propia competición</h3>
      {evaluation.blockers.length ? <ul>{evaluation.blockers.map(reason => <li key={reason}>{reason} <button type="button" className="small-action" disabled={busy} onClick={()=>onAlerts(t)}>Abrir revisión deportiva</button></li>)}</ul> : <p>Sin bloqueos deportivos de cierre detectados.</p>}
      <details><summary>Advertencias ({evaluation.warnings.length})</summary><ul>{evaluation.warnings.map(reason => <li key={reason}>{reason} <button type="button" className="small-action" disabled={busy} onClick={()=>onAlerts(t)}>Abrir alertas de la temporada</button></li>)}</ul></details>
      <div className="section-heading"><button type="button" className="small-action" disabled={busy} onClick={() => onCalendar(t)}>Revisar partidos y calendario</button>
        <button type="button" className="small-action" disabled={busy} onClick={() => onAlerts(t)}>Revisar reglamentos, desempates y alertas</button>
        <button type="button" className="small-action" disabled={busy} onClick={() => onEdit(t)}>Abrir edición de temporada</button></div>
      <button type="button" className="small-action" disabled={busy || scopeChanged || !evaluation.canConfirm} onClick={() => {
        try { setReview(reviewSeasonClosure(t.id, universeId, repository));setMessage(""); }
        catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo revisar."); }
      }}>{simulated ? "Revisar cierre simulado" : "Revisar cierre deportivo"}</button>
      {review && <div aria-label="Vista previa del cierre deportivo"><h3>Vista previa de confirmación</h3>
        <p>Se registrará la revisión de {review.evaluation.tournament.name}: {review.evaluation.overview.played} partidos completos. No se cambiarán resultados, participantes, calendarios ni el archivo de la competición.</p>
        <p>Campeón: {name(review.evaluation.honours.awards.find(a => a.label === "Campeón")?.teamId ?? "No determinado")}. La clasificación, movimientos, decisiones y dependencias anteriores forman parte de esta revisión.</p>
        {review.evaluation.blockers.length > 0 && <ul>{review.evaluation.blockers.map(reason => <li key={reason}>{reason}</li>)}</ul>}
        <button type="button" disabled={busy || scopeChanged || !review.evaluation.canConfirm} onClick={() => void confirm()}>{busy ? "Confirmando…" : review.evaluation.closureTier === "simulated" ? "Confirmar cierre simulado (no oficial)" : "Confirmar cierre deportivo"}</button>
        <button type="button" className="small-action" disabled={busy} onClick={() => setReview(null)}>Cancelar revisión de cierre</button>
      </div>}
      <button type="button" className="small-action" disabled={busy || scopeChanged || !evaluation.confirmed} onClick={() => onPlanning(t)}>Preparar siguiente edición en planificación</button>
      {evaluation.confirmed && <p>El cierre habilita navegación. La planificación vuelve a validar sus propios participantes, descensos y dependencias antes de crear nada.</p>}
      <details><summary>Historial de confirmaciones ({evaluation.history.length})</summary><ul>{evaluation.history.map(event => <li key={event.id}>{event.occurredAt} · {event.imported ? "Confirmación importada" : "Confirmación local"} · {event.id === evaluation.latest?.id && evaluation.confirmed ? "Vigente" : "Necesita nueva revisión o fue sustituida"}</li>)}</ul></details>
    </>}
    {!t && <p>Selecciona una temporada disponible en este universo.</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}

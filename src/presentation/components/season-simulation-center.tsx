import {SportsDecisionsAccess} from "./sports-decisions-access";
import {DrawCenterAccess} from "./draw-center-access";
import { SeasonClosureAccess } from "./season-closure-access";
import { useLibraryWrite } from "../library-write-context";
import { matchResultOrigin } from "../../application/services/match-result-origin";
import { useEffect, useRef, useState } from "react";
import type { Tournament } from "../../domain/entities/tournament";
import type { TournamentRepository } from "../../application/ports/tournament-repository";
import { previewSeasonSimulation, confirmSeasonSimulation, type SeasonSimulationPreview, type SeasonSimulationScope } from "../../application/use-cases/simulate-season-scope";
import { seasonOverview } from "../../application/services/competition-center";
import { nationalContinentalProjection } from "../../application/services/continental-projection";
import { SaveRecoveryAccess } from "./save-recovery-access";

export function SeasonSimulationCenter({ tournaments, repository, universeId, getUniverseId, onChanged, onCalendar, onReview, onClose, initialTournamentId }: {
  initialTournamentId?: string; tournaments: readonly Tournament[]; repository: TournamentRepository; universeId: string | null;
  getUniverseId: () => string | null; onChanged: (t: Tournament) => void;
  onCalendar: (t: Tournament) => void; onClose: () => void;
  onReview?: (t: Tournament) => void;
}) {
  const runWrite = useLibraryWrite();

  const [id, setId] = useState(initialTournamentId ?? tournaments[0]?.id ?? "");
  const [scopeKey, setScopeKey] = useState("");
  const [preview, setPreview] = useState<SeasonSimulationPreview | null>(null);
  const [message, setMessage] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const t = tournaments.find(t => t.id === id);
  const activity = repository.findActivity?.() ?? [];
  const overview = t ? seasonOverview(t, activity) : undefined;
  const qualification = t?.competitionRules?.internationalQualification
    ? nationalContinentalProjection(t, tournaments, activity) : undefined;
  const scopes: {label: string; scope: SeasonSimulationScope}[] = t ? [
    ...t.matchdays.map((d, index) => ({ label: `${d.phaseName ?? `Rueda ${d.leg}`} · Jornada ${d.number}`, scope: {kind: "matchday" as const, index} })),
    ...[...new Set(t.matchdays.map(d => d.leg))].map(leg => ({label: `Rueda ${leg}`, scope: {kind: "leg" as const, leg}})),
    ...[...new Set(t.matchdays.flatMap(d => d.phaseName ? [d.phaseName] : []))].map(name => ({label: `Fase: ${name}`, scope: {kind: "phase" as const, name}})),
    {label: "Pendientes de la competición", scope: {kind: "competition"}},
  ] : [];
  async function attempt(action: () => void | Promise<void>) { try { await action(); } catch (e) { setMessage(e instanceof Error ? e.message : "No se pudo simular."); setPreview(null); } }
  return <section className="preview-panel season-simulation-center" aria-label="Centro de simulación de temporadas">
    <h2 ref={heading} tabIndex={-1}>Centro de simulación de temporadas</h2>
    <button type="button" className="small-action" onClick={onClose}>Cerrar simulación</button>
    <label>Competición y temporada<select value={id} onChange={e => {setId(e.target.value);setPreview(null);setScopeKey("");setMessage("");}}>
      <option value="">Selecciona una temporada</option>{tournaments.map(t => <option key={t.id} value={t.id}>{t.name} · {t.season ?? "Sin año"}</option>)}
    </select></label>
    {t && overview && <>
      <p>Formato: {t.format ?? "No registrado"} · Disputados: {overview.played} · Pendientes: {overview.total - overview.played}</p>
      <p>Estado: {overview.status} · {overview.rules}</p>
      <p>{overview.provenance}</p>
      <SeasonClosureAccess tournament={t} /><DrawCenterAccess tournament={t} /><SportsDecisionsAccess tournament={t} />
      <SaveRecoveryAccess label="Crear punto de control antes de simular" suggestedName={`Antes de simular — ${t.name} ${t.season ?? ""}`.trim()}/>
      <p>Clasificación internacional: {qualification
        ? `${qualification.entries.filter(e => e.status === "confirmed").length} plazas confirmadas · ${qualification.entries.filter(e => e.status !== "confirmed").length} provisionales o pendientes`
        : "Sin configuración internacional registrada"}</p>
      {qualification && qualification.reasons.length > 0 && <ul aria-label="Pendientes de clasificación">{qualification.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
      {overview.pending.length > 0 && <ul aria-label="Pendientes deportivos">{overview.pending.map(reason => <li key={reason}>{reason}</li>)}</ul>}
      <p>Etapa actual: {t.matchdays.find(d => d.fixtures.some(f => !f.result))?.phaseName ?? t.matchdays.find(d => d.fixtures.some(f => !f.result))?.number ?? "Sin etapa pendiente"}</p>
      <label>Alcance<select value={scopeKey} onChange={e => {setScopeKey(e.target.value);setPreview(null);}}>
        <option value="">Selecciona el alcance</option>{scopes.map((s,i) => <option key={i} value={i}>{s.label}</option>)}
      </select></label>
      <button type="button" disabled={scopeKey === ""} onClick={() => attempt(() => {setMessage("");setPreview(previewSeasonSimulation(t.id, scopes[Number(scopeKey)].scope, universeId, repository));})}>Revisar simulación</button>
      <button type="button" className="small-action" onClick={() => onCalendar(t)}>Revisar calendario</button>
      {onReview && <button type="button" className="small-action" onClick={() => onReview(t)}>Revisar bloqueos, reglamentos y resoluciones</button>}
      {preview && <div aria-label="Vista previa de simulación">
        <h3>Vista previa</h3>
        <p>{preview.fixtureIds.length} encuentros pendientes incluidos. Se conservarán {preview.preservedIds.length} resultados existentes.</p>
        <ul>{preview.matchdays.map((label,i) => <li key={i}>{label}</li>)}</ul>
        <ul>{t.matchdays.flatMap(d => d.fixtures).filter(f => preview.fixtureIds.includes(f.id) || preview.preservedIds.includes(f.id)).map(f => <li key={f.id}>
          {t.teams.find(team => team.id === f.homeTeamId)?.name} — {t.teams.find(team => team.id === f.awayTeamId)?.name}: {f.result ? `${f.result.homeGoals}–${f.result.awayGoals} · ${matchResultOrigin(t, f.id, activity)} · Se conserva` : "Pendiente · simulación local"}
        </li>)}</ul>
        <p>Se actualizarán tablas, estadísticas y pendientes. El historial deportivo, palmarés, clasificaciones y progresión podrán recalcularse cuando se cumplan sus condiciones reglamentarias. Las siguientes etapas requerirán otra revisión.</p>
        {preview.blockers.length > 0 && <><h3>Bloqueos deportivos</h3><ul>{preview.blockers.map(b => <li key={b}>{b}</li>)}</ul></>}
        <button type="button" disabled={!!preview.blockers.length || !preview.fixtureIds.length} onClick={() => attempt(async () => {
          const result = await runWrite(() => confirmSeasonSimulation(preview, getUniverseId(), repository, true));
          onChanged(result.tournament);setPreview(null);setMessage(`Se simularon localmente ${result.simulatedCount} partidos. Resultados registrados en el historial de actividad.`);
         })}>Confirmar simulación local</button>
      </div>}
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}

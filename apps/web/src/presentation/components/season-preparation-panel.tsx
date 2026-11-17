import { useLibraryWrite } from "../library-write-context";
import { useSessionDraft } from "../session-drafts";
import { SourceIncidentsPanel } from "./source-incidents-panel";
import { useState } from "react";
import type { Tournament, RulesVerificationStatus } from "@cancha/core/domain/entities/tournament";
import type { TournamentRepository } from "@cancha/core/application/ports/tournament-repository";
import { divisionCompetitions, seasonCompetition } from "@cancha/core/domain/services/season-preparation";
import type { PublishedSeasonSource } from "@cancha/core/application/ports/official-league-source";
import { reviewPlannedSeasonCalendar, confirmPlannedSeasonCalendar, type CalendarReview } from "@cancha/core/application/use-cases/import-planned-season-calendar";
import { updateSeasonRules } from "@cancha/core/application/use-cases/update-season-rules";
import { tieBreakerOptions, configurableTieBreakerOptions, type TieBreaker } from "@cancha/core/domain/value-objects/tie-breaker";

export function SeasonPreparationPanel({ tournament: t, repository, source, onChange, onActivityChanged }: {
  onActivityChanged?: () => void;
  tournament: Tournament; repository: TournamentRepository; source: PublishedSeasonSource; onChange: (t: Tournament) => void;
}) {
  const runWrite = useLibraryWrite();

  const version = JSON.stringify([t.competitionRules, t.pointsSystem, t.tieBreakers]);
  function useDraft<T>(field: string, initial: T | (() => T)) {
    return useSessionDraft<T>(JSON.stringify(["preparation", t.id, field]), initial, version);
  }
  const [review,setReview] = useState<CalendarReview>();
  const [reason,setReason] = useDraft("reason", "");
  const [accepted,setAccepted] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [standings,setStandings] = useDraft<RulesVerificationStatus>("standings", t.competitionRules?.verification.standings ?? "pending");
  const [placements,setPlacements] = useDraft<RulesVerificationStatus>("placements", t.competitionRules?.verification.placements ?? "pending");
  const [sources,setSources] = useDraft("sources", t.competitionRules?.sourceUrls?.join("\n") ?? "");
  const [standingsNote,setStandingsNote] = useDraft("standingsNote", t.competitionRules?.standingsNote ?? "");
  const [placementsNote,setPlacementsNote] = useDraft("placementsNote", t.competitionRules?.placementsNote ?? "");
  const [points,setPoints] = useDraft("points", t.pointsSystem ?? { win:3,draw:1,loss:0 });
  const [criteria,setCriteria] = useDraft<readonly TieBreaker[]>("criteria", t.competitionRules?.tieBreakers ?? []);
  const competition = seasonCompetition(t);
  if (!competition || !t.season || t.season <= 2026) return null;
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : "No se pudo completar la operación.");
  return <section aria-label="Preparación de temporada"><h3>Calendario y reglamento · {t.season}</h3>
    <p>Clasificaciones provisionales hasta verificar el reglamento anual. Las reglas de 2026 no se trasladan. La programación local solo se habilita con reglamento verificado y formatos compatibles.</p>
    <SourceIncidentsPanel repository={repository} onActivityChanged={onActivityChanged} />
    <details><summary>Consultar calendario y comparar participantes</summary>
      <p>Participantes planificados: {(t.seasonPreparation?.plannedParticipants ?? t.teams.map(team => team.name)).join(", ")}.</p>
      <button type="button" disabled={busy} onClick={async () => {
        setBusy(true);setError("");setReview(undefined);setAccepted(false);setReason("");
        try { const data = await source.fetchPublishedSeason(divisionCompetitions[competition],t.season!);
          setReview(await reviewPlannedSeasonCalendar(t,data,repository,runWrite)); } catch(e) { fail(e); } finally { setBusy(false); onActivityChanged?.(); }
      }}>{busy ? "Consultando…" : "Consultar calendario publicado en ESPN"}</button>
      {review && <div><p>Competición: {review.imported.name}. Año: {review.imported.season}. Partidos publicados: {review.imported.matchdays.flatMap(d => d.fixtures).length}.</p>
        <a href={review.imported.sourceUrl} target="_blank" rel="noreferrer">Consultar fuente del calendario</a>
        <p>Publicados: {review.imported.teams.map(team => team.name).join(", ")}.</p>
        <p>Faltan respecto de la planificación actual: {review.missing.join(", ") || "Ninguno"}. Agregados: {review.added.join(", ") || "Ninguno"}.</p>
        {(!!review.missing.length || !!review.added.length) && <label>Justificación documental de las diferencias<textarea value={reason} onChange={e => setReason(e.target.value)} /></label>}
        <label><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} />He revisado los participantes, el año y las diferencias; confirmo esta actualización.</label>
        <button type="button" disabled={!accepted || ((!!review.missing.length || !!review.added.length) && !reason.trim())} onClick={async () => {
          try { await runWrite(() => { onChange(confirmPlannedSeasonCalendar(t,review,repository,reason));setReview(undefined);setError("");  }); } catch(e) { fail(e); }
        }}>Incorporar calendario conservando resultados locales</button></div>}
      {t.seasonPreparation?.calendarReviews.map((item,index) => <p key={index}>{item.at}: <a href={item.sourceUrl} target="_blank" rel="noreferrer">Calendario revisado</a>. Faltaban: {item.missing.join(", ") || "ninguno"}. Agregados: {item.added.join(", ") || "ninguno"}. {item.discrepancyReason}</p>)}
    </details>
    <details><summary>Registrar reglamento anual documentado</summary>
      <p>Verificación manual: la aplicación no certifica los documentos. Ascensos, descensos y formatos futuros requieren soporte deportivo específico; la generación automática local solo reutiliza el generador round-robin.</p>
      <label>Reglas de tabla<select value={standings} onChange={e => setStandings(e.target.value as RulesVerificationStatus)}>{["pending","provisional","verified"].map(s => <option key={s} value={s}>{s === "verified" ? "Verificado por el usuario" : s === "pending" ? "Pendiente" : "Provisional"}</option>)}</select></label>
      <label>Clasificaciones y movimientos<select value={placements} onChange={e => setPlacements(e.target.value as RulesVerificationStatus)}>{["pending","provisional","verified"].map(s => <option key={s} value={s}>{s === "verified" ? "Verificado por el usuario" : s === "pending" ? "Pendiente" : "Provisional"}</option>)}</select></label>
      <label>Fuentes oficiales HTTPS (una por línea)<textarea value={sources} onChange={e => setSources(e.target.value)} /></label>
      <label>Disposiciones de tabla y referencia documental<textarea value={standingsNote} onChange={e => setStandingsNote(e.target.value)} /></label>
      <label>Disposiciones de clasificación y referencia documental<textarea value={placementsNote} onChange={e => setPlacementsNote(e.target.value)} /></label>
      {(["win","draw","loss"] as const).map(key => <label key={key}>Puntos por {key === "win" ? "victoria" : key === "draw" ? "empate" : "derrota"}<input type="number" min="0" value={points[key]} onChange={e => setPoints({...points,[key]:Number(e.target.value)})} /></label>)}
      <p>Criterios de desempate, en orden de aplicación:</p>
      {criteria.map((criterion,index) => <div key={index}>
        <label>Criterio {index+1}<select value={criterion} onChange={e => setCriteria(criteria.map((value,i) => i === index ? e.target.value as TieBreaker : value))}>
          {tieBreakerOptions.filter(option => option.value === criterion || (configurableTieBreakerOptions.some(supported => supported.value === option.value) && !criteria.includes(option.value))).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>
        <button type="button" disabled={index===0} onClick={() => { const next=[...criteria];[next[index-1],next[index]]=[next[index],next[index-1]];setCriteria(next); }}>Subir criterio {index+1}</button>
        <button type="button" onClick={() => setCriteria(criteria.filter((_,i) => i!==index))}>Quitar criterio {index+1}</button>
      </div>)}
      <button type="button" disabled={!configurableTieBreakerOptions.some(option => !criteria.includes(option.value))} onClick={() => { const option=configurableTieBreakerOptions.find(o => !criteria.includes(o.value));if(option)setCriteria([...criteria,option.value]); }}>Agregar criterio</button>
      <button type="button" onClick={async () => { try { await runWrite(() => { onChange(updateSeasonRules(t,{season:t.season!,standings,placements,points,
        tieBreakers:criteria, sourceUrls:sources.split("\n").map(s => s.trim()).filter(Boolean),standingsNote,placementsNote},repository));setError("");  }); } catch(e) { fail(e); } }}>Guardar reglamento de {t.season}</button>
    </details>{error && <p role="alert">{error}</p>}
  </section>;
}

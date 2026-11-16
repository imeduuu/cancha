import { useLibraryWrite } from "../library-write-context";
import { useSessionDraft } from "../session-drafts";
import { useState } from "react";
import type { TournamentRepository } from "../../application/ports/tournament-repository";
import { listSourceIncidents, reviewSourceIncident, revokeSourceIncident } from "../../application/services/source-incidents";
import type { SourceIncident, SourceCorrection } from "../../domain/entities/source-incident";

const statusLabels: Record<SourceIncident["status"], string> = {
  pending: "Pendiente", provisional: "Provisional", verified: "Verificado por el usuario",
  stale: "Inactiva: cambió la fuente", "provider-corrected": "Corregida por el proveedor", revoked: "Revocada",
};

function IncidentReview({ incident, repository, onChange }: {
  incident: SourceIncident; repository: TournamentRepository; onChange: () => void;
}) {
  const runWrite = useLibraryWrite();

  function useDraft<T>(field: string, initial: T | (() => T)) {
    return useSessionDraft<T>(JSON.stringify(["incident", incident.id, field]), initial, String(incident.revision));
  }
  const [selected, setSelected] = useDraft("selected", 0);
  const original = incident.matches[selected];
  const published = original ? JSON.parse(original.published) : {};
  const [draft, setDraft] = useDraft<SourceCorrection["replacement"]>("draft", () => ({
    homeTeamName: published.homeTeamName ?? "", awayTeamName: published.awayTeamName ?? "",
    homeGoals: published.homeGoals, awayGoals: published.awayGoals,
  }));
  const [url, setUrl] = useDraft("url", "");
  const [reference, setReference] = useDraft("reference", "");
  const [note, setNote] = useDraft("note", "");
  const [verified, setVerified] = useDraft("verified", false);
  const [confirmed, setConfirmed] = useDraft("confirmed", false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const inactive = incident.status === "stale" || incident.status === "provider-corrected";
  async function save() {
    try { await runWrite(() => {
      if (!original) throw new Error("No hay encuentro identificable que corregir.");
      reviewSourceIncident(repository, incident.id, incident.revision, [
        ...incident.corrections.filter(c => c.original.matchId !== original.matchId),
        { original, replacement: draft, documentUrl: url, reference, confirmed: true },
      ], verified, confirmed, note);
      setError(""); setMessage("Revisión guardada. Vuelve a importar para validarla; los torneos guardados conservan sus datos.");
      setConfirmed(false); onChange();
     }); } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  }
  return <details>
    <summary>{incident.competitionName} · {incident.season} · {statusLabels[incident.status]} · revisión {incident.revision}</summary>
    <p>Detección automática: {incident.reason}</p>
    <p>{incident.type} · {incident.provider} · <a href={incident.sourceUrl} target="_blank" rel="noreferrer">Publicación de origen</a></p>
    <p>{incident.reviewNote}</p>
    <details><summary>Datos originales y correcciones registradas</summary>
      <pre>{JSON.stringify({ matches: incident.matches.map(m => ({ ...m, published: JSON.parse(m.published) })),
        corrections: incident.corrections }, null, 2)}</pre>
    </details>
    {!inactive && original && <form onSubmit={event => { event.preventDefault(); save(); }}>
      <label>Encuentro afectado<select value={selected} onChange={event => {
        const i = Number(event.target.value); setSelected(i);
        const m = JSON.parse(incident.matches[i].published);
        setDraft({ homeTeamName: m.homeTeamName, awayTeamName: m.awayTeamName, homeGoals: m.homeGoals, awayGoals: m.awayGoals });
        setConfirmed(false);
      }}>{incident.matches.map((m, i) => <option key={`${m.matchId}-${i}`} value={i}>
        Jornada {m.round} · {m.phase ?? "sin fase"} · {m.matchId}
      </option>)}</select></label>
      <p>Original: {published.homeTeamName} {published.homeGoals ?? "—"} – {published.awayGoals ?? "—"} {published.awayTeamName}.</p>
      <p>Introduce únicamente valores respaldados por el documento. Cambiar equipos no invierte los marcadores.</p>
      <label>Local corregido<input required value={draft.homeTeamName} onChange={e => { setDraft({ ...draft, homeTeamName: e.target.value }); setConfirmed(false); }} /></label>
      <label>Visitante corregido<input required value={draft.awayTeamName} onChange={e => { setDraft({ ...draft, awayTeamName: e.target.value }); setConfirmed(false); }} /></label>
      <label>Goles local corregidos<input type="number" min="0" max="99" value={draft.homeGoals ?? ""}
        onChange={e => { setDraft({ ...draft, homeGoals: e.target.value === "" ? undefined : Number(e.target.value) }); setConfirmed(false); }} /></label>
      <label>Goles visitante corregidos<input type="number" min="0" max="99" value={draft.awayGoals ?? ""}
        onChange={e => { setDraft({ ...draft, awayGoals: e.target.value === "" ? undefined : Number(e.target.value) }); setConfirmed(false); }} /></label>
      <label>Documento HTTPS<input required type="url" value={url} onChange={e => { setUrl(e.target.value); setConfirmed(false); }} /></label>
      <label>Referencia documental<input required value={reference} onChange={e => { setReference(e.target.value); setConfirmed(false); }} /></label>
      <label>Motivo de la revisión<input required value={note} onChange={e => { setNote(e.target.value); setConfirmed(false); }} /></label>
      <label><input type="checkbox" checked={verified} onChange={e => { setVerified(e.target.checked); setConfirmed(false); }} />He contrastado estos valores con una fuente documental confiable</label>
      <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Confirmo expresamente esta corrección y su alcance a esta competición y temporada</label>
      <p>Sin verificación manual se guarda como provisional y no se aplica. Cancha no descarga ni certifica el documento.</p>
      <button type="submit">Registrar revisión</button>
      <button type="button" onClick={async () => {
        try { await runWrite(() => {
          if (!confirmed) throw new Error("Confirma expresamente la revocación e indica su motivo.");
          revokeSourceIncident(repository, incident.id, incident.revision, note); setError(""); setConfirmed(false); onChange();
         }); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
      }}>Revocar correcciones</button>
    </form>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </details>;
}
export function SourceIncidentsPanel({ repository, onActivityChanged }: { repository: TournamentRepository; onActivityChanged?: () => void }) {
  const [, refresh] = useState(0);
  let incidents: SourceIncident[];
  try { incidents = listSourceIncidents(repository); }
  catch (error) { return <p role="alert">No se pueden leer las incidencias: {String(error)}</p>; }
  return <section aria-label="Incidencias de fuentes externas">
    <h3>Incidencias de fuentes externas</h3>
    <p>Las incidencias automáticas y sus revisiones se conservan en el historial y en el respaldo de la biblioteca JSON v7.
      Registrar una corrección no modifica los torneos guardados. La próxima importación conserva sus modos de confirmación.</p>
    {!incidents.length && <p>No hay incidencias registradas.</p>}
    {incidents.map(incident => <IncidentReview key={incident.id} incident={incident} repository={repository} onChange={() => { refresh(n => n + 1); onActivityChanged?.(); }} />)}
  </section>;
}

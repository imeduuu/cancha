import { useMemo, useState } from "react";
import type { ActivityEvent } from "../../domain/entities/activity-event";
import type { Tournament } from "../../domain/entities/tournament";
interface ActivityHistoryProps {
  events: readonly ActivityEvent[];
  tournaments: readonly Tournament[];
  focusTournamentId?: string;
  focusFixtureId?: string;
  onClose: () => void;
  onOpenTournament: (tournament: Tournament) => void;
  onOpenMatch: (tournament: Tournament, fixtureId: string) => void;
}
const actionLabels: Record<ActivityEvent["action"], string> = {
  "association-recorded": "Asociación deportiva registrada",
  "club-affiliation-recorded": "Afiliación de participante registrada",
  "draw-configuration-recorded": "Bombos y restricciones",
  "stage-draw-confirmed": "Distribución y cruces revisados",
  "season-closure-confirmed": "Cierre deportivo revisado",
  "source-incident-reviewed": "Incidencia de fuente externa",
  "match-result-updated": "Resultado",
  "match-schedule-updated": "Programación",
  "match-operational-state-updated": "Estado operativo",
  "match-details-updated": "Detalles del partido",
  "match-goal-scorers-updated": "Autores de goles",
  "regulations-updated": "Reglamento",
  "roster-updated": "Plantilla",
  "tournament-created": "Creación",
  "tournament-renamed": "Cambio de nombre",
  "matches-simulated": "Simulación",
  "tournament-duplicated": "Duplicación",
  "season-created": "Temporada",
  "calendar-programmed": "Calendario programado",
  "tournament-archived": "Archivo",
  "tournament-restored": "Restauración",
  "tournament-imported": "Importación",
  "tournament-import-rejected": "Importación rechazada",
  "tournament-deleted": "Eliminación",
  "library-restored": "Respaldo",
  "official-resolution-recorded": "Resolución oficial",
  "official-resolution-revoked": "Resolución revocada",
  "official-resolution-invalidated": "Resolución invalidada",
};
function stringifyValue(value: unknown): string {
  if (value === null) return "Sin valor anterior";
  if (value === undefined) return "No registrado";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
export function ActivityHistory({
  events,
  tournaments,
  focusTournamentId,
  focusFixtureId,
  onClose,
  onOpenTournament,
  onOpenMatch,
}: ActivityHistoryProps) {
  const [competition, setCompetition] = useState(focusTournamentId ?? "");
  const [season, setSeason] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [query, setQuery] = useState("");
  const availableSeasons = [...new Set(events
    .filter((event) => !competition || event.tournamentId === competition)
    .map((event) => event.season)
    .filter((value): value is number => value !== undefined))].sort((a, b) => b - a);
  const visibleEvents = useMemo(() => [...events]
    .filter((event) => !competition || event.tournamentId === competition)
    .filter((event) => !season || String(event.season ?? "") === season)
    .filter((event) => !action || event.action === action)
    .filter((event) => !from || event.occurredAt.slice(0, 10) >= from)
    .filter((event) => !to || event.occurredAt.slice(0, 10) <= to)
    .filter((event) => !focusFixtureId || event.entityId === focusFixtureId)
    .filter((event) => !query || event.summary.toLocaleLowerCase("es").includes(query.trim().toLocaleLowerCase("es")))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)), [
    events, competition, season, action, from, to, focusFixtureId, query,
  ]);
  const tournamentsById = new Map(tournaments.map((tournament) => [tournament.id, tournament]));
  return (
    <section className="activity-history" aria-label="Historial de actividad">
      <div className="activity-history-heading">
        <div>
          <span className="eyebrow">REGISTRO LOCAL · SIN USUARIOS ATRIBUIDOS</span>
          <h2>{focusFixtureId ? "Actividad del partido" : "Historial de actividad"}</h2>
          <p>Solo se muestran cambios observados desde que se incorporó el historial. Los eventos importados se identifican como tales.</p>
        </div>
        <button className="small-action" type="button" onClick={onClose}>Cerrar historial</button>
      </div>
      <div className="activity-history-filters" aria-label="Filtros del historial">
        <label>
          <span>Competición</span>
          <select aria-label="Filtrar historial por competición" value={competition} onChange={(event) => setCompetition(event.target.value)}>
            <option value="">Todas</option>
            {tournaments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label>
          <span>Temporada</span>
          <select aria-label="Filtrar historial por temporada" value={season} onChange={(event) => setSeason(event.target.value)}>
            <option value="">Todas</option>
            {availableSeasons.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>
          <span>Tipo</span>
          <select aria-label="Filtrar historial por tipo" value={action} onChange={(event) => setAction(event.target.value)}>
            <option value="">Todos</option>
            {Object.entries(actionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label><span>Desde</span><input aria-label="Historial desde" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label><span>Hasta</span><input aria-label="Historial hasta" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <label className="activity-search"><span>Buscar resumen</span><input aria-label="Buscar en el historial" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      </div>
      {visibleEvents.length === 0 ? (
        <p className="muted" role="status">Todavía no hay actividad registrada para estos filtros.</p>
      ) : (
        <ol className="activity-event-list">
          {visibleEvents.map((event) => {
            const entityId = event.entityId;
            const relatedTournament = event.action === "tournament-deleted"
              ? undefined
              : tournamentsById.get(event.tournamentId);
            const matchStillExists = relatedTournament && entityId
              ? relatedTournament.matchdays.some(({ fixtures }) =>
                fixtures.some((fixture) => fixture.id === entityId))
              : false;
            return (
              <li className="activity-event" key={event.id}>
                <div className="activity-event-meta">
                  <strong>{actionLabels[event.action]}</strong>
                  <time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString("es-CL")}</time>
                  <span>{event.tournamentName}{event.season !== undefined ? ` · ${event.season}` : ""}</span>
                  {event.imported && <span className="activity-imported-tag">Importado desde respaldo</span>}
                </div>
                <p>{event.summary}</p>
                {event.note && <p className="muted">Observación: {event.note}</p>}
                {(event.before !== undefined || event.after !== undefined) && (
                  <details>
                    <summary>Ver valores anteriores y nuevos</summary>
                    <div className="activity-value-comparison">
                      {event.before !== undefined && <pre><strong>Anterior</strong>{"\n"}{stringifyValue(event.before)}</pre>}
                      {event.after !== undefined && <pre><strong>Nuevo</strong>{"\n"}{stringifyValue(event.after)}</pre>}
                    </div>
                  </details>
                )}
                {relatedTournament && (
                  <div className="activity-event-actions">
                    {event.entityType === "match" && entityId && matchStillExists
                      ? <button className="small-action" type="button" onClick={() => onOpenMatch(relatedTournament, entityId)}>Abrir partido</button>
                      : <button className="small-action" type="button" onClick={() => onOpenTournament(relatedTournament)}>Abrir temporada</button>}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

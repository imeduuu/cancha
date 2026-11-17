import {SportsDecisionsAccess} from "./sports-decisions-access";
import {DrawCenterAccess} from "./draw-center-access";
import {HistoricalArchiveAccess} from "./historical-archive-access";
import { SeasonClosureAccess } from "./season-closure-access";
import { SeasonSimulationAccess } from "./season-simulation-access";
import { SaveRecoveryAccess } from "./save-recovery-access";
import { useMemo } from "react";
import { projectSportsUniverseDashboard, type UniverseDashboardAction } from "@cancha/core/application/services/sports-universe-dashboard";
import type { SportsUniverseLibrary } from "@cancha/core/domain/entities/sports-universe";
import type { ActivityEvent } from "@cancha/core/domain/entities/activity-event";
import type { Tournament } from "@cancha/core/domain/entities/tournament";

interface Props {
  tournaments: readonly Tournament[];
  activity: readonly ActivityEvent[];
  universeLibrary: SportsUniverseLibrary;
  onOpen: (tournament: Tournament) => void;
  onCalendar: (tournament: Tournament) => void;
  onAlerts: (tournament: Tournament) => void;
  onPlanning: (tournament: Tournament) => void;
  onQualification: (tournament: Tournament) => void;
  onImportCalendar?: (tournament: Tournament) => void;
  onProgramCalendar?: (tournament: Tournament) => void;
  onOpenSaveRecovery?: () => void;
}

function actionHandler(
  action: UniverseDashboardAction,
  handlers: Pick<Props, "onCalendar" | "onAlerts" | "onPlanning" | "onQualification" | "onImportCalendar">,
): () => void {
  switch (action.kind) {
    case "calendar": return () => handlers.onCalendar(action.tournament);
    case "alerts": return () => handlers.onAlerts(action.tournament);
    case "planning": return () => handlers.onPlanning(action.tournament);
    case "qualification": return () => handlers.onQualification(action.tournament);
    case "import-calendar": return () => handlers.onImportCalendar?.(action.tournament);
  }
}

export function SportsUniverseDashboard({
  tournaments,
  activity,
  universeLibrary,
  onOpen,
  onCalendar,
  onAlerts,
  onPlanning,
  onQualification,
  onImportCalendar,
  onProgramCalendar,
  onOpenSaveRecovery,
}: Props) {
  const dashboard = useMemo(
    () => projectSportsUniverseDashboard(tournaments, activity, universeLibrary),
    [tournaments, activity, universeLibrary],
  );
  const handlers = { onCalendar, onAlerts, onPlanning, onQualification, onImportCalendar };
  const availableActions = dashboard.actions.filter((action) =>
    action.kind !== "import-calendar" || onImportCalendar);
  const tournamentById = new Map(dashboard.competitions.map(({ tournament }) =>
    [tournament.id, tournament]));

  return (
    <section className="sports-universe-dashboard" aria-label="Panel del universo deportivo">
      <header className="sports-universe-dashboard-heading">
        <div>
          <span className="eyebrow">ESTADO DE LA PARTIDA</span>
          <h3>{dashboard.universeName}</h3><SeasonSimulationAccess /><DrawCenterAccess /><SportsDecisionsAccess /><SeasonClosureAccess /><HistoricalArchiveAccess />
          {dashboard.description && <p>{dashboard.description}</p>}
        </div>
        <p>Consulta de solo lectura · los datos se calculan desde este universo y no certifican resultados oficiales.</p>
        {onOpenSaveRecovery && (
          <button className="small-action" type="button" onClick={onOpenSaveRecovery}>
            Centro de guardado y recuperación
          </button>
        )}
        {!onOpenSaveRecovery && <SaveRecoveryAccess />}
      </header>

      <dl className="universe-dashboard-counts" aria-label="Resumen del universo">
        <div><dt>Competiciones</dt><dd>{dashboard.counts.competitions}</dd></div>
        <div><dt>Temporadas</dt><dd>{dashboard.counts.seasons}</dd></div>
        <div><dt>Competiciones en curso</dt><dd>{dashboard.counts.inProgress}</dd></div>
        <div><dt>Competiciones terminadas</dt><dd>{dashboard.counts.completed}</dd></div>
        <div><dt>Temporadas preparadas</dt><dd>{dashboard.counts.prepared}</dd></div>
        <div><dt>Competiciones por configurar</dt><dd>{dashboard.counts.configurationPending}</dd></div>
      </dl>

      {dashboard.competitions.length === 0 ? (
        <p className="muted" role="status">Este universo todavía no contiene competiciones.</p>
      ) : (
        <section aria-label="Competiciones del universo">
          <h4>Competiciones y temporadas</h4>
          <div className="universe-dashboard-competitions">
            {dashboard.competitions.map((item) => (
              <article
                className="universe-dashboard-competition"
                key={item.tournament.id}
                aria-label={`Competición ${item.competition} ${item.tournament.season ?? ""}`}
              >
                <header>
                  <div>
                    <span className="eyebrow">{item.territory} · {item.category}</span>
                    <h5>{item.competition} · {item.tournament.season ?? "Temporada sin año"}</h5>
                  </div>
                  <strong className="universe-dashboard-status">{item.status}</strong>
                </header>
                <p>{item.format} · {item.tournament.teams.length} participantes</p>
                <p>
                  Partidos: {item.statistics.played} disputados · {item.statistics.pending} pendientes
                  {item.statistics.incomplete > 0 ? ` · ${item.statistics.incomplete} incompletos` : ""}
                </p>
                <p>Procedencia: {item.provenance}</p>
                <p>Tabla: {item.tableStatus} · Clasificaciones: {item.placementStatus}</p>
                {item.qualificationStatus && (
                  <p>
                    Clasificación internacional: {item.qualificationStatus}
                    {item.qualificationPendingReasons.length > 0
                      ? ` · ${item.qualificationPendingReasons[0]}`
                      : ""}
                  </p>
                )}
                {item.topPositions.length > 0 && (
                  <ol className="universe-dashboard-standings" aria-label={`Resumen de posiciones de ${item.tournament.name}`}>
                    {item.topPositions.map((standing, index) => (
                      <li key={`${item.tournament.id}:${index}`}>
                        <span>{index + 1}. {standing.name}</span>
                        <strong>{standing.points} pts</strong>
                      </li>
                    ))}
                  </ol>
                )}
                {item.blockers.length > 0 && (
                  <details>
                    <summary>Bloqueos y alertas ({item.blockers.length})</summary>
                    <ul>{item.blockers.slice(0, 5).map((blocker) => (
                      <li key={blocker.id}>{blocker.title}: {blocker.description}</li>
                    ))}</ul>
                  </details>
                )}
                <div className="library-file-actions">
                  <button className="small-action" type="button" onClick={() => onOpen(item.tournament)}>
                    Abrir competición
                  </button>
                  <button className="small-action" type="button" onClick={() => onCalendar(item.tournament)}>
                    Abrir calendario
                  </button>
                  <button className="small-action" type="button" onClick={() => onAlerts(item.tournament)}>
                    Revisar alertas
                  </button>
                  {onProgramCalendar && <button className="small-action" type="button" onClick={() => onProgramCalendar(item.tournament)}>
                    Programar calendario
                  </button>}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section aria-label="Partidos pendientes del calendario">
        <h4>Partidos pendientes registrados</h4>
        {dashboard.datedFixtures.length === 0 && dashboard.undatedFixtures.length === 0 ? (
          <p role="status">No hay próximos partidos programados en los calendarios disponibles.</p>
        ) : (
          <>
            {dashboard.datedFixtures.length > 0 && (
              <ul className="universe-dashboard-fixtures">
                {dashboard.datedFixtures.map(({ tournament, fixture, date, time, utcOffset, matchdayLabel, homeTeam, awayTeam }) => (
                  <li key={`${tournament.id}:${fixture.id}`}>
                    <time dateTime={date}>{date}{time ? ` · ${time}${utcOffset ? ` ${utcOffset}` : ""}` : ""}</time>
                    <span>{matchdayLabel} · {tournament.name}: {homeTeam} vs. {awayTeam}</span>
                    <button className="small-action" type="button" onClick={() => onCalendar(tournament)}>
                      Abrir calendario
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {dashboard.undatedFixtures.length > 0 && (
              <>
                <p>Sin fecha registrada; se conserva la jornada o fase del calendario y no se priorizan estos encuentros.</p>
                <ul className="universe-dashboard-fixtures">
                  {dashboard.undatedFixtures.map(({ tournament, fixture, matchdayLabel, homeTeam, awayTeam }) => (
                    <li key={`${tournament.id}:${fixture.id}`}>
                      <span>{matchdayLabel} · {tournament.name}: {homeTeam} vs. {awayTeam}</span>
                      <button className="small-action" type="button" onClick={() => onCalendar(tournament)}>
                        Abrir calendario
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </section>

      <section aria-label="Acciones recomendadas">
        <h4>Acciones disponibles</h4>
        {availableActions.length === 0 ? (
          <p role="status">No hay acciones adicionales que puedan recomendarse a partir de los datos guardados.</p>
        ) : (
          <ul className="universe-dashboard-actions">
            {availableActions.map((action) => (
              <li key={action.id}>
                <span>{action.label} · {action.tournament.name}</span>
                <button
                  className="small-action"
                  type="button"
                  onClick={actionHandler(action, handlers)}
                >
                  Abrir flujo
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Actividad reciente del universo">
        <h4>Actividad reciente</h4>
        {dashboard.recentActivity.length === 0 ? (
          <p role="status">No hay actividad atribuible a este universo.</p>
        ) : (
          <ol className="universe-dashboard-activity">
            {dashboard.recentActivity.map((event) => {
              const tournament = tournamentById.get(event.tournamentId);
              return (
                <li key={event.id}>
                  <time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString("es-CL")}</time>
                  <span>{event.summary} · {event.tournamentName}</span>
                  {tournament && (
                    <button className="small-action" type="button" onClick={() => onOpen(tournament)}>
                      Abrir competición
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </section>
  );
}

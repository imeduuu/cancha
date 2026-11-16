import {SportsDecisionsAccess} from "./sports-decisions-access";
import {DrawCenterAccess} from "./draw-center-access";
import type { Tournament } from "../../domain/entities/tournament";
import {
  countCompetitionAlerts,
  getCompetitionAlerts,
  type CompetitionAlert,
} from "../../domain/services/competition-alerts";

interface CompetitionAlertCenterProps {
  readonly tournament: Tournament;
  readonly onOpenFixture: (fixtureId: string) => void;
  readonly onOpenCalendar: () => void;
  readonly onOpenStatistics: () => void;
  readonly onOpenRegulations: () => void;
  readonly onBack: () => void;
}

export function CompetitionAlertCenter({
  tournament,
  onOpenFixture,
  onOpenCalendar,
  onOpenStatistics,
  onOpenRegulations,
  onBack,
}: CompetitionAlertCenterProps) {
  const alerts = getCompetitionAlerts(tournament);
  const counts = countCompetitionAlerts(alerts);

  function openAlert(alert: CompetitionAlert) {
    if (alert.action === "fixture" && alert.fixtureId) onOpenFixture(alert.fixtureId);
    else if (alert.action === "calendar") onOpenCalendar();
    else if (alert.action === "statistics") onOpenStatistics();
    else onOpenRegulations();
  }

  return (
    <section className="competition-alert-center" aria-label={`Alertas de ${tournament.name}`}>
      <header className="alert-center-heading">
        <div>
          <span className="eyebrow">SEGUIMIENTO DE INCIDENCIAS · {tournament.season ?? "temporada no especificada"}</span>
          <DrawCenterAccess tournament={tournament} /><SportsDecisionsAccess tournament={tournament} /><h3>{tournament.name}</h3>
          <p>Se calculan desde los datos guardados; resolver una causa actualiza la lista al volver.</p>
        </div>
        <button className="small-action" onClick={onBack} type="button">Volver al torneo</button>
      </header>
      <div className="alert-priority-counts" aria-label="Resumen de alertas">
        <span>Críticas: <strong>{counts.critical}</strong></span>
        <span>Advertencias: <strong>{counts.warning}</strong></span>
        <span>Informativas: <strong>{counts.informative}</strong></span>
        <span>Total: <strong>{counts.total}</strong></span>
      </div>
      {alerts.length === 0 ? (
        <p className="alert-empty" role="status">
          No se detectan incidencias con los datos disponibles de esta competición y temporada.
        </p>
      ) : (
        <ul className="competition-alert-list">
          {alerts.map((alert) => (
            <li className={`competition-alert priority-${alert.priority}`} key={alert.id}>
              <div className="competition-alert-content">
                <div className="competition-alert-topline">
                  <span className="alert-priority-label">{getPriorityLabel(alert.priority)}</span>
                  <span>{alert.competitionName}{alert.season ? ` · ${alert.season}` : ""}</span>
                </div>
                <h4>{alert.title}</h4>
                {alert.matchday && <p className="alert-matchday">{alert.matchday}</p>}
                <p>{alert.description}</p>
              </div>
              <button className="small-action" onClick={() => openAlert(alert)} type="button">
                {getActionLabel(alert)}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="alert-priority-legend">
        Prioridad crítica: resultado/referencia que invalida el partido; advertencia: datos incompletos o que requieren revisión;
        informativa: seguimiento sin afirmar infracción ni estado oficial.
      </p>
    </section>
  );
}

function getPriorityLabel(priority: CompetitionAlert["priority"]): string {
  if (priority === "critical") return "Crítica";
  if (priority === "warning") return "Advertencia";
  return "Informativa";
}

function getActionLabel(alert: CompetitionAlert): string {
  if (alert.action === "fixture") return "Abrir partido";
  if (alert.action === "calendar") return "Abrir calendario";
  if (alert.action === "statistics") return "Ver estadísticas";
  return "Revisar reglamento";
}

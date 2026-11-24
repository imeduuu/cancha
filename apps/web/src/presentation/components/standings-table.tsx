import type { CompetitionRulesConfiguration, PointsSystem } from "@cancha/core/domain/entities/tournament";
import type { TeamStanding, UnresolvedStandingsTieDetail } from "@cancha/core/domain/services/standings";
import {
  classifyPosition,
  getPlayoffPlacementStatuses,
} from "@cancha/core/domain/services/placement-classification";
import type { Fixture, Tournament, TournamentPlacementRules } from "@cancha/core/domain/entities/tournament";
import { tieBreakerOptions } from "@cancha/core/domain/value-objects/tie-breaker";
import type { InternationalQualificationResult } from "@cancha/core/domain/services/international-qualification";
import type { RelegationAverageResult } from "@cancha/core/domain/services/relegation-averages";
import { userFacingLabels } from "@cancha/core/application/services/user-facing-labels";

interface StandingsTableProps {
  standings: readonly TeamStanding[];
  tieBreakers: readonly string[];
  placementRules?: TournamentPlacementRules;
  placementFixtures?: readonly Fixture[];
  placementTournament?: Tournament;
  competitionRules?: CompetitionRulesConfiguration;
  pointsSystem?: PointsSystem;
  heading?: string;
  placementNote?: string;
  internationalQualifications?: InternationalQualificationResult;
  relegationAverages?: RelegationAverageResult;
  unresolvedTies?: readonly UnresolvedStandingsTieDetail[];
}

export function StandingsTable({
  standings,
  tieBreakers,
  placementRules,
  placementFixtures,
  placementTournament,
  competitionRules,
  pointsSystem,
  heading,
  placementNote,
  internationalQualifications,
  relegationAverages,
  unresolvedTies = [],
}: StandingsTableProps) {
  const tiebreakerLabels = tieBreakers.flatMap((tieBreaker) => {
    const label = tieBreakerOptions.find((option) => option.value === tieBreaker)?.label;
    return label ? [label] : [];
  });
  const playoffStatuses = placementRules && placementFixtures && placementTournament
    ? getPlayoffPlacementStatuses(
      standings,
      placementFixtures,
      placementRules,
      placementTournament,
      pointsSystem ?? competitionRules?.points,
    )
    : new Map<string, "confirmed" | "provisional">();
  return (
    <section className="standings-section" aria-label="Tabla de posiciones">
      <div className="standings-heading">
        <div>
          <span className="eyebrow">CLASIFICACIÓN EN VIVO</span>
          <h3>{heading ?? "Tabla de posiciones"}</h3>
        </div>
        <span className="standings-updated">Se actualiza con cada resultado</span>
      </div>
      {competitionRules && (
        <div className="rules-verification-note" role="note">
          <p>
            Desempates de {competitionRules.season}:{" "}
            {competitionRules.verification.standings === "verified"
              ? "reglas verificadas."
              : competitionRules.verification.standings === "provisional"
                ? "reglas provisionales; la posición no es oficial."
                : "pendientes de verificar; el orden mostrado es orientativo y usa criterios genéricos."}
          </p>
          {competitionRules.standingsNote && <p>{competitionRules.standingsNote}</p>}
          {placementRules && (
            <p>
              Clasificación:{" "}
              {competitionRules.verification.placements === "verified"
                ? "reglas verificadas."
                : competitionRules.verification.placements === "provisional"
                  ? "puestos/cupos provisionales; pueden depender de resultados externos."
                  : "pendiente de verificar; los puestos se muestran como referencia."}
              {competitionRules.placementsNote ? ` ${competitionRules.placementsNote}` : ""}
            </p>
          )}
          {competitionRules.conditionalPlacements?.map((condition) => (
            <p key={condition.description}>
              Cupo condicionado ({userFacingLabels.verificationStatus(condition.status)}): {condition.description}
            </p>
          ))}
          {competitionRules.sourceUrls && competitionRules.sourceUrls.length > 0 && (
            <details>
              <summary>Fuentes consultadas</summary>
              <ul>
                {competitionRules.sourceUrls.map((url) => (
                  <li key={url}>
                    <a href={url} target="_blank" rel="noreferrer">{url}</a>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {unresolvedTies.map((tie, index) => (
        <p className="rules-verification-note" role="note" key={`${tie.criterion}-${index}`}>
          Orden provisional entre {tie.teams.map(({ teamName }) => teamName).join(", ")}: {tie.reason}
        </p>
      ))}
      <div className="standings-scroll">
        <table className="standings-table">
          <thead>
            <tr>
              <th scope="col" className="standing-position">#</th>
              <th scope="col" className="standing-team">Equipo</th>
              <th scope="col" title="Partidos jugados">PJ</th>
              <th scope="col" title="Partidos ganados">PG</th>
              <th scope="col" title="Partidos empatados">PE</th>
              <th scope="col" title="Partidos perdidos">PP</th>
              <th scope="col" title="Goles a favor">GF</th>
              <th scope="col" title="Goles en contra">GC</th>
              <th scope="col" title="Diferencia de goles">DG</th>
              <th scope="col" className="standing-points" title="Puntos">Pts</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((standing, index) => {
              const placement = placementRules
                ? classifyPosition(index + 1, standings.length, placementRules)
                : undefined;
              return (
                <tr
                  className={placement ? `standing-${placement}` : undefined}
                  key={standing.teamId}
                >
                  <td className="standing-position">{index + 1}</td>
                  <th scope="row" className="standing-team">
                    {standing.teamName}
                    {playoffStatuses.has(standing.teamId) && (
                      <small className={`playoff-placement-${playoffStatuses.get(standing.teamId)}`}>
                        {placement === "relegation-playoff"
                          ? playoffStatuses.get(standing.teamId) === "confirmed"
                            ? "Playoff de descenso confirmado"
                            : "Playoff de descenso provisional"
                          : playoffStatuses.get(standing.teamId) === "confirmed"
                            ? "Playoff confirmado"
                            : "Playoff provisional"}
                      </small>
                    )}
                  </th>
                  <td>{standing.played}</td>
                  <td>{standing.wins}</td>
                  <td>{standing.draws}</td>
                  <td>{standing.losses}</td>
                  <td>{standing.goalsFor}</td>
                  <td>{standing.goalsAgainst}</td>
                  <td className={standing.goalDifference > 0
                    ? "standing-difference-positive"
                    : standing.goalDifference < 0 ? "standing-difference-negative" : undefined}
                  >
                    {standing.goalDifference > 0 ? `+${standing.goalDifference}` : standing.goalDifference}
                  </td>
                  <td className="standing-points">{standing.points}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {placementRules && (
        <div className="standings-legend" aria-label="Clasificación y puestos decisivos">
          {placementRules.championPlaces !== undefined && (
            <span className="standing-legend-champion">
              {placementRules.libertadoresPlaces
                ? "Campeón de Liga"
                : "Puesto de campeón / ascenso directo"}
            </span>
          )}
          {placementRules.libertadoresPlaces && (
            <span className="standing-legend-libertadores">
              Libertadores · fase de grupos ({placementRules.championPlaces ? "1.º–" : ""}
              {placementRules.libertadoresPlaces.to}.º)
            </span>
          )}
          {placementRules.libertadoresQualifyingPlaces && (
            <span className="standing-legend-libertadores-qualifying">
              Libertadores · fase previa ({placementRules.libertadoresQualifyingPlaces.from}.º)
            </span>
          )}
          {placementRules.sudamericanaPlaces && (
            <span className="standing-legend-sudamericana">
              Sudamericana ({placementRules.sudamericanaPlaces.from}.º–{placementRules.sudamericanaPlaces.to}.º)
            </span>
          )}
          {placementRules.playoffPlaces && (
            <span className="standing-legend-playoff">
              Playoff ({placementRules.playoffPlaces.from}.º–{placementRules.playoffPlaces.to}.º)
            </span>
          )}
          {(placementRules?.note || placementNote) && (
            <p className="standings-placement-note">{placementNote ?? placementRules?.note}</p>
          )}
          {placementRules.relegationPlayoffPlaces && (
            <span className="standing-legend-relegation-playoff">
              Playoff de descenso ({placementRules.relegationPlayoffPlaces.from}.º–{placementRules.relegationPlayoffPlaces.to}.º)
            </span>
          )}
          {placementRules.relegationPlaces ? (
            <span className="standing-legend-relegation">
              Descenso ({placementRules.relegationPlaces} {placementRules.relegationPlaces === 1 ? "puesto" : "puestos"})
            </span>
          ) : null}
        </div>
      )}
      {internationalQualifications && (
        <div
          aria-label="Clasificación internacional"
          className="rules-verification-note"
          role="region"
        >
          <strong>Clasificación internacional</strong>
          {internationalQualifications.qualifications.length === 0
            ? <p>No hay cupos calculables con la configuración disponible.</p>
            : internationalQualifications.qualifications.map((qualification) => (
              <p key={`${qualification.teamId}:${qualification.destination}:${qualification.source}`}>
                {qualification.teamName}: {userFacingLabels.destination(qualification.destination)} · {userFacingLabels.verificationStatus(qualification.status)}
                {" "}({qualification.source})
              </p>
            ))}
          {internationalQualifications.pendingReasons.map((reason) => (
            <p key={reason}>{reason}</p>
          ))}
        </div>
      )}
      {relegationAverages && (
        <div
          aria-label="Descenso por promedios"
          className="rules-verification-note"
          role="region"
        >
          <strong>Promedios de descenso</strong>
          <p>
            Temporadas: {relegationAverages.standings
              .flatMap(({ seasonsPresent }) => seasonsPresent)
              .filter((season, index, seasons) => seasons.indexOf(season) === index)
              .sort((first, second) => first - second)
              .join(", ") || "sin datos disponibles"}.
          </p>
          {relegationAverages.standings.map((standing) => (
            <p key={standing.teamId}>
              {standing.rank}. {standing.teamName} · {standing.average === undefined
                ? "sin promedio calculable"
                : standing.average.toFixed(3)}
              {" "}({standing.points} pts / {standing.played} PJ)
              {standing.completeHistory ? "" : " · historial incompleto"}
              {standing.tiedAtBoundary ? " · empate en zona de descenso" : ""}
              {standing.relegation
                ? ` · descenso ${standing.status === "confirmed" && !standing.tiedAtBoundary
                  ? userFacingLabels.verificationStatus("confirmed")
                  : userFacingLabels.verificationStatus(standing.status)}`
                : ""}
              {" · "}{userFacingLabels.verificationStatus(standing.status)}
            </p>
          ))}
          {relegationAverages.pendingReasons.map((reason) => (
            <p key={reason}>{reason}</p>
          ))}
        </div>
      )}
      <p className="standings-tiebreakers">
        Desempates: Puntos
        {tiebreakerLabels.map((label) => ` → ${label}`).join("")}
      </p>
    </section>
  );
}

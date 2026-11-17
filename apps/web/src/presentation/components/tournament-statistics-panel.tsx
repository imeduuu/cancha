import {seasonHonours} from "@cancha/core/application/services/club-honours";
import {SeasonHonours} from "./club-honours-panel";
import type {ActivityEvent} from "@cancha/core/domain/entities/activity-event";
import { useEffect, useMemo, useState } from "react";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import { calculateTournamentStatistics } from "@cancha/core/domain/services/tournament-statistics";
import { PlayerRosterPanel } from "./player-roster-panel";
import { MatchRegulationsEditor } from "./match-regulations-editor";

interface TournamentStatisticsPanelProps {
  activity?: readonly ActivityEvent[];
  tournament: Tournament;
  tournaments: readonly Tournament[];
  onSelectTournament: (tournamentId: string) => void;
  onSaveTournament: (tournament: Tournament) => void;
  onSaveRegulations: (tournament: Tournament) => void;
}

export function TournamentStatisticsPanel({
  tournament,
  activity = [],
  tournaments,
  onSelectTournament,
  onSaveTournament,
  onSaveRegulations,
}: TournamentStatisticsPanelProps) {
  const [phaseName, setPhaseName] = useState("");
  const [groupName, setGroupName] = useState("");
  const phaseNames = useMemo(() => [...new Set(tournament.matchdays
    .map(({ phaseName: name }) => name)
    .filter((name): name is string => Boolean(name)))], [tournament.matchdays]);
  const groupNames = useMemo(() => [...new Set(tournament.teams
    .map(({ groupName: name }) => name)
    .filter((name): name is string => Boolean(name)))].sort((first, second) =>
    first.localeCompare(second, "es")), [tournament.teams]);

  useEffect(() => {
    setPhaseName("");
    setGroupName("");
  }, [tournament.id]);

  const stats = calculateTournamentStatistics(tournament, {
    ...(phaseName ? { phaseName } : {}),
    ...(groupName ? { groupName } : {}),
  });
  const canShowChampion = useMemo(() => seasonHonours(tournament).complete, [tournament]);
  const teamNames = new Map(tournament.teams.map(({ id, name }) => [id, name]));
  let scorerPosition = 0;
  const scorersWithPositions = stats.topScorers.map((scorer, index) => {
    if (index === 0 || stats.topScorers[index - 1].goals !== scorer.goals) {
      scorerPosition = index + 1;
    }
    return { ...scorer, position: scorerPosition };
  });

  return (
    <section id="tournament-statistics" className="statistics-panel" aria-label="Estadísticas del campeonato">
      <div className="statistics-heading">
        <div>
          <span className="eyebrow">RESUMEN DE TEMPORADA</span>
          <h2>Estadísticas</h2>
        </div>
        <label className="statistics-tournament-select">
          <span>Torneo activo</span>
          <select
            aria-label="Torneo activo para estadísticas"
            value={tournament.id}
            onChange={(event) => onSelectTournament(event.target.value)}
          >
            {tournaments.map((saved) => (
              <option key={saved.id} value={saved.id}>{saved.name}</option>
            ))}
          </select>
        </label>
      </div>

      {(phaseNames.length > 0 || groupNames.length > 0) && (
        <div className="statistics-filters">
          {phaseNames.length > 0 && (
            <label>
              <span>Fase</span>
              <select
                aria-label="Filtrar estadísticas por fase"
                value={phaseName}
                onChange={(event) => setPhaseName(event.target.value)}
              >
                <option value="">Todas las fases</option>
                {phaseNames.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
          )}
          {groupNames.length > 0 && (
            <label>
              <span>Grupo</span>
              <select
                aria-label="Filtrar estadísticas por grupo"
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
              >
                <option value="">Todos los grupos</option>
                {groupNames.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
          )}
        </div>
      )}

      <div className="statistics-cards">
        <StatisticCard label="Partidos jugados" value={stats.played} />
        <StatisticCard label="Pendientes" value={stats.pending} />
        <StatisticCard label="Resultados incompletos / inválidos" value={stats.incomplete} />
        <StatisticCard label="Partidos con detalles inválidos" value={stats.invalidDetails} />
        <StatisticCard label="No disputados" value={stats.notPlayed} detail="No existe ese estado en el modelo" />
        <StatisticCard label="Goles" value={stats.totalGoals} detail={`${stats.averageGoals.toFixed(2)} por partido jugado`} />
        <StatisticCard label="Avance" value={`${stats.progressPercent}%`} detail={stats.progressLabel} />
      </div>

      <p className="statistics-match-status" role="note">
        {stats.homeWins} victorias locales · {stats.draws} empates · {stats.awayWins} victorias visitantes.
        {" "}Operativos: {stats.unscheduled} sin programar · {stats.scheduled} programados ·
        {" "}{stats.inProgress} en juego · {stats.finished} finalizados · {stats.postponed} aplazados ·
        {" "}{stats.suspended} suspendidos · {stats.cancelled} cancelados.
        {" "}Estados aplazado, suspendido y cancelado permanecen sin resolver para las estadísticas deportivas.
      </p>
      {stats.invalidDetails > 0 && (
        <p className="history-warning" role="alert">
          Los detalles individuales de {stats.invalidDetails} partido(s) contienen referencias o datos
          inválidos y se excluyeron de las estadísticas de jugadores y goleadores. Los resultados
          deportivos válidos se mantienen en las estadísticas de equipos.
        </p>
      )}

      <SeasonHonours tournament={tournament} activity={activity}/>
      <div className="statistics-highlights">
        <Highlight label="Más goles a favor" value={leaderText(stats.standings, "goalsFor", teamNames, false, stats.played)} />
        <Highlight label="Menos goles en contra" value={leaderText(stats.standings, "goalsAgainst", teamNames, true, stats.played)} />
        <Highlight label="Mejor diferencia de goles" value={leaderText(stats.standings, "goalDifference", teamNames, false, stats.played)} />
        <Highlight
          label="Campeón"
          value={canShowChampion && stats.championTeamId
            ? teamNames.get(stats.championTeamId) ?? "Equipo desconocido"
            : "Aún no determinado"}
        />
      </div>

      <div className="statistics-tables">
        <section className="statistics-table-section" aria-label="Estadísticas por equipo">
          <h3>Rendimiento por equipo</h3>
          <div className="statistics-table-scroll">
            <table className="statistics-table">
              <thead>
                <tr>
                  <th>Equipo</th><th>PJ</th><th>G</th><th>E</th><th>P</th>
                  <th>GF</th><th>GC</th><th>DG</th><th>Pts</th>
                  <th>Local G-E-P (PJ)</th><th>Visita G-E-P (PJ)</th>
                </tr>
              </thead>
              <tbody>
                {stats.standings.map((standing) => {
                  const homeAway = stats.homeAway.get(standing.teamId);
                  return (
                    <tr key={standing.teamId}>
                      <th scope="row">{standing.teamName}</th>
                      <td>{standing.played}</td><td>{standing.wins}</td><td>{standing.draws}</td>
                      <td>{standing.losses}</td><td>{standing.goalsFor}</td><td>{standing.goalsAgainst}</td>
                      <td>{standing.goalDifference}</td><td>{standing.points}</td>
                      <td>{homeAway
                        ? `${homeAway.homeWins}-${homeAway.homeDraws}-${homeAway.homeLosses} (${homeAway.homePlayed})`
                        : "—"}</td>
                      <td>{homeAway
                        ? `${homeAway.awayWins}-${homeAway.awayDraws}-${homeAway.awayLosses} (${homeAway.awayPlayed})`
                        : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {stats.standings.length === 0 && <p className="muted">No hay equipos para este filtro.</p>}
          </div>
          <PlayerRosterPanel tournament={tournament} onSave={onSaveTournament} />
          <MatchRegulationsEditor tournament={tournament} onSave={onSaveRegulations} />
        </section>

        <section className="statistics-table-section" aria-label="Tabla de goleadores">
          <h3>Goleadores</h3>
          {scorersWithPositions.length > 0 ? (
            <div className="statistics-table-scroll">
              <table className="statistics-table scorers-table">
                <thead><tr><th>Pos.</th><th>Jugador</th><th>Equipo</th><th>Goles</th></tr></thead>
                <tbody>
                  {scorersWithPositions.map((scorer, index) => (
                    <tr key={`${scorer.teamId}-${scorer.playerName}-${index}`}>
                      <td>{scorer.position}</td><th scope="row">{scorer.playerName}</th>
                      <td>{scorer.teamName}</td><td>{scorer.goals}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="statistics-empty">
              Todavía no hay información suficiente para construir la tabla de goleadores.
              Registra los autores en cada partido.
            </p>
          )}
          {stats.played > 0 && stats.topScorerRecordCount !== stats.totalGoals && (
            <p className="statistics-match-status">
              Advertencia: hay {stats.topScorerRecordCount} autores registrados y {stats.totalGoals} goles computados.
              {" "}El marcador no se modifica.
            </p>
          )}
        </section>

        <section className="statistics-table-section" aria-label="Estadísticas individuales">
          <h3>Estadísticas individuales registradas</h3>
          {stats.individualStatistics.length > 0 ? (
            <div className="statistics-table-scroll">
              <table className="statistics-table">
                <thead>
                  <tr>
                    <th>Jugador</th><th>Equipo</th><th>Titular</th><th>Suplente utilizado</th>
                    <th>Goles</th><th>Autogoles</th><th>Amarillas</th><th>Rojas</th><th>Minutos</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.individualStatistics.map((player) => (
                    <tr key={`${player.playerId}-${player.teamId}`}>
                      <th scope="row">{player.playerName}</th>
                      <td>{teamNames.get(player.teamId) ?? "Equipo desconocido"}</td>
                      <td>{player.starts}</td><td>{player.substituteAppearances}</td>
                      <td>{player.goals}</td><td>{player.ownGoals}</td>
                      <td>{player.yellowCards}</td><td>{player.redCards}</td>
                      <td>{player.minutesPlayed ?? "No disponible"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="statistics-empty">
              No hay eventos vinculados a jugadores ni alineaciones o sustituciones válidas para calcular
              estadísticas individuales. Los minutos no se calculan porque no se registra la duración del partido.
            </p>
          )}
        </section>
      </div>
    </section>
  );
}

function StatisticCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail?: string;
}) {
  return (
    <div className="statistics-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

function Highlight({ label, value }: { label: string; value: string }) {
  return <div className="statistics-highlight"><span>{label}</span><strong>{value}</strong></div>;
}

function leaderText(
  standings: TournamentStatisticsReturn["standings"],
  field: "goalsFor" | "goalsAgainst" | "goalDifference",
  teamNames: ReadonlyMap<string, string>,
  minimum = false,
  played = 0,
): string {
  if (played === 0 || standings.length === 0) return "Sin datos";
  const playedStandings = standings.filter((standing) => standing.played > 0);
  if (playedStandings.length === 0) return "Sin datos";
  const leaderValue = playedStandings.reduce((value, standing) =>
    minimum
      ? Math.min(value, standing[field])
      : Math.max(value, standing[field]), standings[0][field]);
  return playedStandings
    .filter((standing) => standing[field] === leaderValue)
    .map(({ teamId }) => teamNames.get(teamId) ?? "Equipo desconocido")
    .join(", ");
}

type TournamentStatisticsReturn = ReturnType<typeof calculateTournamentStatistics>;

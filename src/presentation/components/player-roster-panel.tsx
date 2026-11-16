import { useLibraryWrite } from "../library-write-context";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Player, Tournament } from "../../domain/entities/tournament";
import {
  registerTournamentPlayer,
  releaseTournamentPlayer,
  saveTournamentPlayer,
  transferTournamentPlayer,
} from "../../domain/services/player-roster";
import { calculateTournamentStatistics } from "../../domain/services/tournament-statistics";

interface PlayerRosterPanelProps {
  tournament: Tournament;
  onSave: (tournament: Tournament) => void;
}

export function PlayerRosterPanel({ tournament, onSave }: PlayerRosterPanelProps) {
  const runWrite = useLibraryWrite();

  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | undefined>();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [nationality, setNationality] = useState("");
  const [usualPosition, setUsualPosition] = useState("");
  const [teamId, setTeamId] = useState(tournament.teams[0]?.id ?? "");
  const [shirtNumber, setShirtNumber] = useState("");
  const [registrationPlayerId, setRegistrationPlayerId] = useState("");
  const [error, setError] = useState("");
  const players = tournament.players ?? [];
  const registrations = tournament.playerRegistrations ?? [];
  const registrationByPlayer = new Map<string, typeof registrations[number]>();
  for (const registration of registrations) {
    const current = registrationByPlayer.get(registration.playerId);
    if (!current || current.status === "released" || registration.status !== "released") {
      registrationByPlayer.set(registration.playerId, registration);
    }
  }
  const goalsByPlayerId = new Map<string, number>();
  for (const scorer of calculateTournamentStatistics(tournament).topScorers) {
    if (scorer.playerId) {
      goalsByPlayerId.set(scorer.playerId, (goalsByPlayerId.get(scorer.playerId) ?? 0) + scorer.goals);
    }
  }
  const filteredPlayers = players.filter((player) =>
    (!registrationByPlayer.has(player.id)
      || registrationByPlayer.get(player.id)?.teamId === teamId)
    && `${player.firstName} ${player.lastName}`.toLocaleLowerCase("es")
      .includes(query.trim().toLocaleLowerCase("es")));
  const selectedRegistration = registrationByPlayer.get(registrationPlayerId);

  useEffect(() => {
    setTeamId(tournament.teams[0]?.id ?? "");
    setRegistrationPlayerId("");
    setQuery("");
    resetForm();
  }, [tournament.id]);

  function resetForm() {
    setEditingId(undefined);
    setFirstName("");
    setLastName("");
    setBirthDate("");
    setNationality("");
    setUsualPosition("");
  }

  function startEditing(player: Player) {
    setEditingId(player.id);
    setFirstName(player.firstName);
    setLastName(player.lastName);
    setBirthDate(player.birthDate ?? "");
    setNationality(player.nationality ?? "");
    setUsualPosition(player.usualPosition ?? "");
    setError("");
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try { await runWrite(() => {
      const saved = saveTournamentPlayer(tournament, {
        ...(editingId ? { id: editingId } : {}),
        firstName,
        lastName,
        ...(birthDate ? { birthDate } : {}),
        ...(nationality ? { nationality } : {}),
        ...(usualPosition ? { usualPosition } : {}),
      });
      onSave(saved);
      resetForm();
      setError("");
     }); } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar el jugador.");
    }
  }

  async function addToSquad() {
    try { await runWrite(() => {
      const updated = selectedRegistration && selectedRegistration.teamId !== teamId
        ? transferTournamentPlayer(
          tournament,
          registrationPlayerId,
          teamId,
          shirtNumber ? Number(shirtNumber) : undefined,
        )
        : registerTournamentPlayer(
        tournament,
        registrationPlayerId,
        teamId,
        shirtNumber ? Number(shirtNumber) : undefined,
      );
      onSave(updated);
      setRegistrationPlayerId("");
      setShirtNumber("");
      setError("");
     }); } catch (registrationError) {
      setError(registrationError instanceof Error
        ? registrationError.message
        : "No se pudo agregar el jugador a la plantilla.");
    }
  }

  async function release(playerId: string) {
    try { await runWrite(() => {
      onSave(releaseTournamentPlayer(tournament, playerId));
      setError("");
     }); } catch (releaseError) {
      setError(releaseError instanceof Error
        ? releaseError.message
        : "No se pudo retirar el jugador.");
    }
  }

  return (
    <section className="player-roster-panel" aria-label="Plantillas y jugadores">
      <h3>Plantillas de esta temporada</h3>
      <p className="muted">
        Las plantillas se guardan por torneo/temporada. Retirar a un jugador conserva sus registros históricos.
      </p>
      <form className="player-profile-form" onSubmit={saveProfile}>
        <label>
          <span>Nombre</span>
          <input aria-label="Nombre del jugador" maxLength={60} required value={firstName}
            onChange={(event) => setFirstName(event.target.value)} />
        </label>
        <label>
          <span>Apellidos</span>
          <input aria-label="Apellidos del jugador" maxLength={80} required value={lastName}
            onChange={(event) => setLastName(event.target.value)} />
        </label>
        <details className="optional-player-fields">
          <summary>Datos opcionales</summary>
          <div className="player-optional-grid">
            <label>
              <span>Fecha de nacimiento</span>
              <input aria-label="Fecha de nacimiento" type="date" value={birthDate}
                onChange={(event) => setBirthDate(event.target.value)} />
            </label>
            <label>
              <span>Nacionalidad</span>
              <input aria-label="Nacionalidad" maxLength={60} value={nationality}
                onChange={(event) => setNationality(event.target.value)} />
            </label>
            <label>
              <span>Posición habitual</span>
              <input aria-label="Posición habitual" maxLength={40} value={usualPosition}
                onChange={(event) => setUsualPosition(event.target.value)} />
            </label>
          </div>
        </details>
        <div className="player-form-actions">
          <button className="small-action" type="submit">
            {editingId ? "Guardar cambios del jugador" : "Crear jugador"}
          </button>
          {editingId && <button className="small-action secondary-action" type="button" onClick={resetForm}>
            Cancelar edición
          </button>}
        </div>
      </form>

      {players.length > 0 && (
        <div className="player-registration-form">
          <label>
            <span>Equipo</span>
            <select aria-label="Equipo para plantilla" value={teamId}
              onChange={(event) => setTeamId(event.target.value)}>
              {tournament.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </label>
          <label>
            <span>Jugador disponible</span>
            <select aria-label="Jugador para agregar a plantilla" value={registrationPlayerId}
              onChange={(event) => setRegistrationPlayerId(event.target.value)}>
              <option value="">Seleccionar jugador</option>
              {players.map((player) => (
                <option key={player.id} value={player.id}>{player.firstName} {player.lastName}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Número (opcional)</span>
            <input aria-label="Número de camiseta" type="number" min="1" max="99" step="1"
              value={shirtNumber} onChange={(event) => setShirtNumber(event.target.value)} />
          </label>
          <button className="small-action" disabled={!registrationPlayerId} onClick={addToSquad}
            type="button">
            {selectedRegistration && selectedRegistration.teamId !== teamId
              ? "Transferir en esta temporada"
              : "Agregar a plantilla"}
          </button>
        </div>
      )}

      <label className="player-search">
        <span>Buscar jugador por nombre</span>
        <input aria-label="Buscar jugadores" type="search" value={query}
          onChange={(event) => setQuery(event.target.value)} />
      </label>
      {error && <p className="library-error" role="alert">{error}</p>}
      <div className="statistics-table-scroll">
        <h4 className="player-roster-team-heading">
          Plantilla de {tournament.teams.find(({ id }) => id === teamId)?.name ?? "equipo"}
        </h4>
        <table className="statistics-table player-roster-table">
          <thead><tr><th>Jugador</th><th>Equipo / estado</th><th>N.º</th><th>Goles registrados</th><th>Acciones</th></tr></thead>
          <tbody>
            {filteredPlayers.map((player) => {
              const registration = registrationByPlayer.get(player.id);
              const registeredTeam = tournament.teams.find(({ id }) => id === registration?.teamId);
              const active = registration?.status !== "released";
              return (
                <tr key={player.id}>
                  <th scope="row">{player.firstName} {player.lastName}</th>
                  <td>{registration
                    ? `${registeredTeam?.name ?? "Equipo desconocido"} · ${active ? "plantilla" : "retirado"}`
                    : "Sin equipo en esta temporada"}</td>
                  <td>{registration?.shirtNumber ?? "—"}</td>
                  <td>{goalsByPlayerId.get(player.id) ?? 0}</td>
                  <td>
                    <button className="small-action" type="button" onClick={() => startEditing(player)}>
                      Editar
                    </button>
                    {registration && active && (
                      <button className="small-action secondary-action" type="button"
                        onClick={() => release(player.id)}>Retirar</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {filteredPlayers.length === 0 && (
              <tr><td colSpan={5}>No hay jugadores que coincidan con la búsqueda.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="statistics-match-status">
        Apariciones, asistencias, tarjetas y minutos no se calculan: el simulador no guarda esos datos.
      </p>
    </section>
  );
}

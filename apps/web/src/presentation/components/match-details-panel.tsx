import { useLibraryWrite } from "../library-write-context";
import { useSessionDraft } from "../session-drafts";
import { useEffect, useState } from "react";
import type {
  Fixture,
  MatchEvent,
  MatchLineups,
  MatchSchedule,
  MatchSubstitution,
  Player,
  PlayerRegistration,
} from "@cancha/core/domain/entities/tournament";
import {
  getExpectedStarters,
  getLineupStatus,
  validateFixtureDetailsWithWarnings,
} from "@cancha/core/domain/services/match-details";
import type { FixtureDetailsUpdate } from "@cancha/core/domain/services/match-details";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import { createMatchSchedule, validateMatchSchedule } from "@cancha/core/domain/services/match-scheduling";

interface MatchDetailsPanelProps {
  fixture: Fixture;
  tournament: Tournament;
  homeTeam: string;
  awayTeam: string;
  players: readonly Player[];
  registrations: readonly PlayerRegistration[];
  onSave: (fixtureId: string, update: FixtureDetailsUpdate) => void;
  onSaveSchedule: (fixtureId: string, schedule: MatchSchedule | null) => boolean;
}

function emptyLineup(): MatchLineups {
  return {
    home: { starters: [], substitutes: [], status: "incomplete" },
    away: { starters: [], substitutes: [], status: "incomplete" },
  };
}

export function MatchDetailsPanel({
  fixture,
  tournament,
  homeTeam,
  awayTeam,
  players,
  registrations,
  onSave,
  onSaveSchedule,
}: MatchDetailsPanelProps) {
  const runWrite = useLibraryWrite();

  const version = JSON.stringify([fixture.homeTeamId, fixture.awayTeamId, fixture.lineups,
    fixture.substitutions, fixture.events, fixture.eventsCoverage, fixture.schedule]);
  function useDraft<T>(field: string, initial: T | (() => T)) {
    return useSessionDraft<T>(JSON.stringify(["details", tournament.id, fixture.id, field]), initial, version);
  }
  const [lineups, setLineups] = useDraft<MatchLineups>("lineups", fixture.lineups ?? emptyLineup());
  const [substitutions, setSubstitutions] = useDraft<MatchSubstitution[]>("substitutions", [
    ...(fixture.substitutions ?? []),
  ]);
  const [events, setEvents] = useDraft<MatchEvent[]>("events", [...(fixture.events ?? [])]);
  const [eventsVerified, setEventsVerified] = useDraft("eventsVerified", fixture.eventsCoverage === "complete");
  const [teamId, setTeamId] = useDraft("teamId", fixture.homeTeamId);
  const [playerOutId, setPlayerOutId] = useDraft("playerOutId", "");
  const [playerInId, setPlayerInId] = useDraft("playerInId", "");
  const [substitutionMinute, setSubstitutionMinute] = useDraft("substitutionMinute", "");
  const [substitutionWindow, setSubstitutionWindow] = useDraft("substitutionWindow", "");
  const [eventType, setEventType] = useDraft<MatchEvent["type"]>("eventType", "goal");
  const [eventTeamId, setEventTeamId] = useDraft("eventTeamId", fixture.homeTeamId);
  const [benefitedTeamId, setBenefitedTeamId] = useDraft("benefitedTeamId", fixture.awayTeamId);
  const [eventPlayerId, setEventPlayerId] = useDraft("eventPlayerId", "");
  const [eventPlayerName, setEventPlayerName] = useDraft("eventPlayerName", "");
  const [eventMinute, setEventMinute] = useDraft("eventMinute", "");
  const [eventPeriod, setEventPeriod] = useDraft<NonNullable<MatchEvent["period"]>>("eventPeriod", "regulation");
  const [editingEventId, setEditingEventId] = useDraft<string | null>("editingEventId", null);
  const [error, setError] = useState("");
  const [scheduleDate, setScheduleDate] = useDraft("scheduleDate", fixture.schedule?.date ?? "");
  const [scheduleTime, setScheduleTime] = useDraft("scheduleTime", fixture.schedule?.time ?? "");
  const [scheduleVenue, setScheduleVenue] = useDraft("scheduleVenue", fixture.schedule?.venue ?? "");
  const [scheduleNotes, setScheduleNotes] = useDraft("scheduleNotes", fixture.schedule?.logisticsNotes ?? "");
  const [scheduleError, setScheduleError] = useState("");
  const expectedStarters = getExpectedStarters(tournament);
  const regulationValidation = validateFixtureDetailsWithWarnings(tournament, fixture);
  const teams = [
    { id: fixture.homeTeamId, name: homeTeam, key: "home" as const },
    { id: fixture.awayTeamId, name: awayTeam, key: "away" as const },
  ];

  useEffect(() => { setError(""); setScheduleError(""); }, [version]);
  async function saveSchedule(schedule: MatchSchedule | null) { try {
    const issue = schedule === null ? undefined : validateMatchSchedule(schedule);
    if (issue) {
      setScheduleError(issue);
      return;
    }
    if (!await runWrite(() => onSaveSchedule(fixture.id, schedule))) {
      setScheduleError("No se pudo guardar la programación del partido.");
      return;
    }
    setScheduleError("");
    setScheduleDate(schedule?.date ?? "");
    setScheduleTime(schedule?.time ?? "");
    setScheduleVenue(schedule?.venue ?? "");
    setScheduleNotes(schedule?.logisticsNotes ?? "");
   } catch (error) { setError(error instanceof Error ? error.message : "No se pudo guardar. Revisa los datos actuales."); }}

  function activeRoster(team: string) {
    return registrations
      .filter((entry) => entry.teamId === team && entry.status !== "released")
      .flatMap((entry) => {
        const player = players.find(({ id }) => id === entry.playerId);
        return player ? [{ ...player, shirtNumber: entry.shirtNumber }] : [];
      });
  }

  function changeLineup(
    teamKey: "home" | "away",
    field: "starters" | "substitutes",
    value: string[],
  ) {
    setLineups((current) => ({
      ...current,
      [teamKey]: {
        ...current[teamKey],
        [field]: value,
        status: getLineupStatus(
          { starters: field === "starters" ? value : current[teamKey].starters },
          expectedStarters,
        ),
      },
    }));
  }

  async function saveLineups() {
    try { await runWrite(() => {
      onSave(fixture.id, { lineups });
      setError("");
     }); } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudieron guardar las alineaciones.");
    }
  }

  async function saveSubstitution() {
    const substitution: MatchSubstitution = {
      id: createMatchDetailId(),
      teamId,
      playerOutId,
      playerInId,
      ...(substitutionMinute ? { minute: Number(substitutionMinute) } : {}),
      ...(substitutionWindow ? { window: Number(substitutionWindow) } : {}),
    };
    const updated = [...substitutions, substitution];
    try { await runWrite(() => {
      onSave(fixture.id, { lineups, substitutions: updated });
      setSubstitutions(updated);
      setPlayerOutId("");
      setPlayerInId("");
      setSubstitutionMinute("");
      setSubstitutionWindow("");
      setError("");
     }); } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar el cambio.");
    }
  }

  async function removeSubstitution(id: string) {
    const updated = substitutions.filter((substitution) => substitution.id !== id);
    try { await runWrite(() => {
      onSave(fixture.id, { lineups, substitutions: updated });
      setSubstitutions(updated);
      setError("");
     }); } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo quitar el cambio.");
    }
  }

  async function addEvent() {
    const player = players.find(({ id }) => id === eventPlayerId);
    const event: MatchEvent = {
      id: editingEventId ?? createMatchDetailId(),
      type: eventType,
      teamId: eventTeamId,
      playerName: player ? `${player.firstName} ${player.lastName}` : eventPlayerName.trim(),
      ...(eventPlayerId ? { playerId: eventPlayerId } : {}),
      ...(eventMinute ? { minute: Number(eventMinute) } : {}),
      ...(eventType === "own-goal" ? { benefitedTeamId } : {}),
      period: eventPeriod,
    };
    const updated = editingEventId
      ? events.map((entry) => entry.id === editingEventId ? event : entry)
      : [...events, event];
    try { await runWrite(() => {
      onSave(fixture.id, { events: updated, eventsCoverage: "unverified" });
      setEvents(updated);
      setEventsVerified(false);
      setEventPlayerId("");
      setEventPlayerName("");
      setEventMinute("");
      setEventPeriod("regulation");
      setEditingEventId(null);
      setError("");
     }); } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar el evento.");
    }
  }

  async function removeEvent(id: string) {
    const updated = events.filter((event) => event.id !== id);
    try { await runWrite(() => {
      onSave(fixture.id, { events: updated, eventsCoverage: "unverified" });
      setEvents(updated);
      setEventsVerified(false);
      setError("");
     }); } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo eliminar el evento.");
    }
  }

  function editEvent(event: MatchEvent) {
    setEditingEventId(event.id);
    setEventType(event.type);
    setEventTeamId(event.teamId);
    setBenefitedTeamId(event.benefitedTeamId ?? fixture.awayTeamId);
    setEventPlayerId(event.playerId ?? "");
    setEventPlayerName(event.playerName);
    setEventMinute(event.minute?.toString() ?? "");
    setEventPeriod(event.period ?? "regulation");
  }

  const eventGoalCounts = new Map<string, number>();
  for (const event of events) {
    if (event.type === "goal") eventGoalCounts.set(event.teamId, (eventGoalCounts.get(event.teamId) ?? 0) + 1);
    if (event.type === "own-goal" && event.benefitedTeamId) {
      eventGoalCounts.set(event.benefitedTeamId, (eventGoalCounts.get(event.benefitedTeamId) ?? 0) + 1);
    }
  }
  const hasGoalEvents = events.some((event) => event.type === "goal" || event.type === "own-goal");
  const scoreMismatch = hasGoalEvents && fixture.result !== undefined
    && (
      (eventGoalCounts.get(fixture.homeTeamId) ?? 0)
        !== fixture.result.homeGoals + (fixture.result.extraTime?.homeGoals ?? 0)
      || (eventGoalCounts.get(fixture.awayTeamId) ?? 0)
        !== fixture.result.awayGoals + (fixture.result.extraTime?.awayGoals ?? 0)
    );
  const eventLabels: Record<MatchEvent["type"], string> = {
    goal: "Gol",
    "own-goal": "Autogol",
    "yellow-card": "Amarilla",
    "red-card": "Roja",
  };

  return (
    <details className="match-details-editor">
      <summary>Alineaciones y eventos {fixture.lineups ? "· alineación registrada" : ""}</summary>
      <details className="match-schedule-editor">
        <summary>Programación del partido</summary>
        <p className="muted">
          Fecha AAAA-MM-DD y hora local HH:mm, sin conversión de zona horaria. Deja un campo vacío para quitar solo ese dato.
        </p>
        {(!fixture.schedule?.date || !fixture.schedule?.time) && (
          <p className="match-schedule-status">
            Programación incompleta: falta registrar {[
              !fixture.schedule?.date ? "la fecha" : "",
              !fixture.schedule?.time ? "la hora de inicio" : "",
            ].filter(Boolean).join(" y ")}.
          </p>
        )}
        <div className="match-schedule-form">
          <label>
            Fecha
            <input aria-label={`Fecha del partido ${homeTeam} contra ${awayTeam}`}
              type="date" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} />
          </label>
          <label>
            Hora local
            <input aria-label={`Hora del partido ${homeTeam} contra ${awayTeam}`}
              type="time" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} />
          </label>
          <label>
            Estadio o recinto
            <input aria-label={`Estadio del partido ${homeTeam} contra ${awayTeam}`}
              maxLength={120} value={scheduleVenue} onChange={(event) => setScheduleVenue(event.target.value)} />
          </label>
          <label>
            Observación logística
            <textarea aria-label={`Observación logística del partido ${homeTeam} contra ${awayTeam}`}
              maxLength={500} value={scheduleNotes} onChange={(event) => setScheduleNotes(event.target.value)} />
          </label>
        </div>
        {scheduleError && <p className="error-message" role="alert">{scheduleError}</p>}
        <div className="match-schedule-actions">
          <button className="small-action" type="button" onClick={() => saveSchedule(createMatchSchedule({
            date: scheduleDate, time: scheduleTime, venue: scheduleVenue, logisticsNotes: scheduleNotes,
          }))}>Guardar programación</button>
          {fixture.schedule && (
            <button className="small-action secondary-action" type="button" onClick={() => saveSchedule(null)}>
              Quitar programación
            </button>
          )}
        </div>
      </details>
      {!fixture.lineups && <p className="muted">Sin alineaciones registradas; no se infieren datos.</p>}
      {regulationValidation.regulatoryStatus === "not-configured"
        ? <p className="muted">Sin reglamento de temporada configurado; no se declara conformidad reglamentaria.</p>
        : <p className="muted">Estado de validación: {{
          "not-configured": "sin reglamento",
          unverified: "reglamento sin verificar",
          conflict: "conflicto de reglas",
          warning: "requiere revisión",
          incomplete: "información incompleta",
          compliant: "sin advertencias conocidas",
        }[regulationValidation.regulatoryStatus]}.</p>}
      {regulationValidation.warnings.length > 0 && (
        <ul className="match-regulation-warnings" aria-label="Advertencias reglamentarias del partido">
          {regulationValidation.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}
      <div className="match-lineups-grid">
        {teams.map(({ id, name, key }) => {
          const roster = activeRoster(id);
          const lineup = lineups[key];
          return (
            <fieldset key={id} className="match-lineup-team">
              <legend>{name} · {lineup.starters.length}/{expectedStarters} titulares · {lineup.status}</legend>
              <label>
                <span>Titulares (selección múltiple)</span>
                <select aria-label={`Titulares de ${name}`} multiple size={Math.min(5, Math.max(2, roster.length))}
                  value={[...lineup.starters]}
                  onChange={(event) => changeLineup(key, "starters",
                    [...event.currentTarget.selectedOptions].map((option) => option.value))}>
                  {roster.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.firstName} {player.lastName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Suplentes convocados</span>
                <select aria-label={`Suplentes de ${name}`} multiple size={Math.min(4, Math.max(2, roster.length))}
                  value={[...lineup.substitutes]}
                  onChange={(event) => changeLineup(key, "substitutes",
                    [...event.currentTarget.selectedOptions].map((option) => option.value))}>
                  {roster.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.firstName} {player.lastName}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Capitán</span>
                <select aria-label={`Capitán de ${name}`} value={lineup.captainPlayerId ?? ""}
                  onChange={(event) => setLineups((current) => ({
                    ...current,
                    [key]: { ...current[key], captainPlayerId: event.target.value || undefined },
                  }))}>
                  <option value="">Sin especificar</option>
                  {lineup.starters.map((playerId) => {
                    const player = players.find(({ id: currentId }) => currentId === playerId);
                    return player
                      ? <option key={playerId} value={playerId}>{player.firstName} {player.lastName}</option>
                      : null;
                  })}
                </select>
              </label>
              <label>
                <span>Esquema opcional</span>
                <input aria-label={`Esquema táctico de ${name}`} maxLength={20}
                  placeholder="p. ej. 4-3-3" value={lineup.formation ?? ""}
                  onChange={(event) => setLineups((current) => ({
                    ...current,
                    [key]: { ...current[key], formation: event.target.value || undefined },
                  }))} />
              </label>
            </fieldset>
          );
        })}
      </div>
      <button className="small-action" type="button" onClick={saveLineups}>
        Guardar alineaciones (se permite incompleta)
      </button>
      <section className="match-substitution-editor" aria-label="Sustituciones">
        <h4>Sustituciones</h4>
        <p className="muted">Sin regla configurada no se valida el límite reglamentario de cambios.</p>
        <div className="match-detail-form">
          <label><span>Equipo</span><select aria-label="Equipo de sustitución" value={teamId}
            onChange={(event) => { setTeamId(event.target.value); setPlayerOutId(""); setPlayerInId(""); }}>
            {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select></label>
          <label><span>Sale</span><select aria-label="Jugador que sale" value={playerOutId}
            onChange={(event) => setPlayerOutId(event.target.value)}>
            <option value="">Seleccionar</option>
            {lineups[teamId === fixture.homeTeamId ? "home" : "away"].starters
              .concat(substitutions.filter((sub) => sub.teamId === teamId).map((sub) => sub.playerInId))
              .map((playerId) => {
                const player = players.find(({ id }) => id === playerId);
                return player ? <option key={playerId} value={playerId}>{player.firstName} {player.lastName}</option> : null;
              })}
          </select></label>
          <label><span>Entra</span><select aria-label="Jugador que entra" value={playerInId}
            onChange={(event) => setPlayerInId(event.target.value)}>
            <option value="">Seleccionar</option>
            {lineups[teamId === fixture.homeTeamId ? "home" : "away"].substitutes
              .filter((playerId) => !substitutions.some((sub) => sub.teamId === teamId && sub.playerInId === playerId))
              .map((playerId) => {
                const player = players.find(({ id }) => id === playerId);
                return player ? <option key={playerId} value={playerId}>{player.firstName} {player.lastName}</option> : null;
              })}
          </select></label>
          <label><span>Minuto (opcional)</span><input aria-label="Minuto de sustitución" type="number"
            min="1" max="180" value={substitutionMinute}
            onChange={(event) => setSubstitutionMinute(event.target.value)} /></label>
          <label><span>Ventana (opcional)</span><input aria-label="Ventana de sustitución" type="number"
            min="1" max="30" value={substitutionWindow}
            onChange={(event) => setSubstitutionWindow(event.target.value)} /></label>
          <button className="small-action" type="button" disabled={!playerOutId || !playerInId}
            onClick={saveSubstitution}>Registrar cambio</button>
        </div>
        <ol className="match-event-list">
          {substitutions.map((sub) => (
            <li key={sub.id}>
              {teamName(sub.teamId)}: {playerName(sub.playerOutId)} → {playerName(sub.playerInId)}
              {sub.minute ? ` · ${sub.minute}′` : ""}
              <button aria-label="Eliminar sustitución" className="small-action" type="button"
                onClick={() => removeSubstitution(sub.id)}>Quitar</button>
            </li>
          ))}
        </ol>
      </section>
      <section className="match-event-editor" aria-label="Eventos del partido">
        <h4>Eventos</h4>
        <label>
          <input
            aria-label="La lista de eventos está completa y revisada"
            type="checkbox"
            checked={eventsVerified}
            onChange={(event) => setEventsVerified(event.target.checked)}
          />
          Lista de eventos completa y revisada
        </label>
        <button className="small-action" type="button" onClick={async () => {
          try { await runWrite(() => {
            const coverage = eventsVerified ? "complete" : "unverified";
            onSave(fixture.id, { eventsCoverage: coverage });
            setError("");
           }); } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : "No se pudo guardar la verificación de eventos.");
          }
        }}>Guardar verificación de eventos</button>
        {!eventsVerified && <p className="muted">La lista de eventos no está verificada como completa.</p>}
        {scoreMismatch && (
          <p className="history-warning" role="alert">
            Los goles y autogoles registrados no coinciden con el marcador; el resultado no se modifica.
          </p>
        )}
        <div className="match-detail-form">
          <label><span>Evento</span><select aria-label="Tipo de evento" value={eventType}
            onChange={(event) => setEventType(event.target.value as MatchEvent["type"])}>
            <option value="goal">Gol</option><option value="own-goal">Autogol</option>
            <option value="yellow-card">Tarjeta amarilla</option><option value="red-card">Tarjeta roja</option>
          </select></label>
          <label><span>Equipo del jugador</span><select aria-label="Equipo del evento" value={eventTeamId}
            onChange={(event) => { setEventTeamId(event.target.value); setEventPlayerId(""); setEventPlayerName(""); }}>
            {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select></label>
          <label><span>Jugador registrado</span><select aria-label="Jugador del evento" value={eventPlayerId}
            onChange={(event) => {
              const player = players.find(({ id }) => id === event.target.value);
              setEventPlayerId(event.target.value);
              setEventPlayerName(player ? `${player.firstName} ${player.lastName}` : "");
            }}>
            <option value="">Ingreso manual</option>
            {activeRoster(eventTeamId).map((player) => (
              <option key={player.id} value={player.id}>{player.firstName} {player.lastName}</option>
            ))}
          </select></label>
          {!eventPlayerId && <label><span>Nombre del jugador</span><input aria-label="Nombre del jugador del evento"
            value={eventPlayerName} onChange={(event) => setEventPlayerName(event.target.value)} /></label>}
          {eventType === "own-goal" && <label><span>Equipo beneficiado</span>
            <select aria-label="Equipo beneficiado" value={benefitedTeamId}
              onChange={(event) => setBenefitedTeamId(event.target.value)}>
              {teams.filter((team) => team.id !== eventTeamId)
                .map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select></label>}
          <label><span>Minuto (opcional)</span><input aria-label="Minuto del evento" type="number"
            min="1" max="180" value={eventMinute}
            onChange={(event) => setEventMinute(event.target.value)} /></label>
          <label><span>Período</span><select aria-label="Período del evento" value={eventPeriod}
            onChange={(event) => setEventPeriod(event.target.value as NonNullable<MatchEvent["period"]>)}>
            <option value="regulation">Tiempo reglamentario</option>
            <option value="extra-time">Prórroga</option>
            <option value="penalties">Penales</option>
          </select></label>
          <button className="small-action" type="button" disabled={!eventPlayerId && !eventPlayerName.trim()}
            onClick={addEvent}>{editingEventId ? "Guardar cambios" : "Agregar evento"}</button>
          {editingEventId && <button className="small-action secondary-action" type="button"
            onClick={() => { setEditingEventId(null); setEventPlayerId(""); setEventPlayerName(""); setEventMinute(""); }}>
            Cancelar edición
          </button>}
        </div>
        <ol className="match-event-list">
          {[...events].sort((first, second) =>
            (first.minute ?? Number.MAX_SAFE_INTEGER) - (second.minute ?? Number.MAX_SAFE_INTEGER))
            .map((event) => (
              <li key={event.id}>
                {event.minute ? `${event.minute}′ · ` : ""}
                {eventLabels[event.type]} · {teamName(event.teamId)} · {event.playerName}
                {event.benefitedTeamId ? ` (beneficia a ${teamName(event.benefitedTeamId)})` : ""}
                <button aria-label={`Editar evento ${event.playerName}`} className="small-action"
                  type="button" onClick={() => editEvent(event)}>Editar</button>
                <button aria-label={`Eliminar evento ${event.playerName}`} className="small-action"
                  type="button" onClick={() => removeEvent(event.id)}>Quitar</button>
              </li>
            ))}
          {events.length === 0 && <li>No hay eventos registrados.</li>}
        </ol>
        {fixture.goalScorers?.some((scorer) => !scorer.eventId) && (
          <p className="muted">Este partido también conserva autores de goles históricos sin evento vinculado.</p>
        )}
      </section>
      {error && <p className="library-error" role="alert">{error}</p>}
    </details>
  );

  function playerName(id: string) {
    const player = players.find(({ id: playerId }) => playerId === id);
    return player ? `${player.firstName} ${player.lastName}` : "Jugador desconocido";
  }

  function teamName(id: string) {
    return teams.find((team) => team.id === id)?.name ?? "Equipo desconocido";
  }
}

function createMatchDetailId(): string {
  return crypto.randomUUID();
}

import { useLibraryWrite } from "../library-write-context";
import { useState } from "react";
import { useSessionDraft } from "../session-drafts";
import type {
  CompetitionType,
  Fixture,
  GoalScorer,
  GoalType,
  KnockoutResolution,
  MatchSchedule,
  Matchday,
  MatchResult,
  OperationalMatchStatus,
  Player,
  PlayerRegistration,
  Tournament,
} from "../../domain/entities/tournament";
import type { Team } from "../../domain/entities/team";
import { getAggregateScoreBeforeFixture } from "../../domain/services/aggregate-knockout-score";
import type { FixtureDetailsUpdate } from "../../domain/services/match-details";
import { validateFixtureDetails } from "../../domain/services/match-details";
import { validateGoalScorers } from "../../domain/services/goal-scorers";
import { isValidPlayedFixture } from "../../domain/services/tournament-statistics";
import {
  getAllowedOperationalTransitions,
  getOperationalMatchStatus,
  getOperationalStatusLabel,
  isOperationalStateSimulationBlocked,
} from "../../domain/services/match-operational-status";
import { secondDivisionKind } from "../../domain/services/second-division-rules";
import { MatchDetailsPanel } from "./match-details-panel";

export interface FixtureListProps {
  idPrefix?: string;
  matchdays: readonly Matchday[];
  teams: readonly Team[];
  allMatchdays: readonly Matchday[];
  competitionType?: CompetitionType;
  onSimulateMatchday: (matchday: Matchday) => void;
  onSimulateFixture: (fixtureId: string) => void;
  onSaveResult: (
    fixtureId: string,
    result: MatchResult,
    resolution: KnockoutResolution | null,
  ) => void;
  onSaveGoalScorers: (fixtureId: string, goalScorers: readonly GoalScorer[]) => void;
  tournament: Tournament;
  onSaveDetails: (fixtureId: string, update: FixtureDetailsUpdate) => void;
  onSaveSchedule: (fixtureId: string, schedule: MatchSchedule | null) => boolean;
  onUpdateOperationalStatus: (
    fixtureId: string,
    status: OperationalMatchStatus,
    note: string,
    confirmedAmbiguousResult: boolean,
  ) => boolean;
  onOpenActivity?: (fixtureId: string) => void;
  onCompareClubs?: (homeId:string,awayId:string) => void;
  players: readonly Player[];
  playerRegistrations: readonly PlayerRegistration[];
  otherTournaments: readonly Tournament[];
}

export function FixtureList({
  idPrefix = "fixture",
  matchdays,
  teams,
  allMatchdays,
  competitionType,
  onSimulateMatchday,
  onSimulateFixture,
  onSaveResult,
  onSaveGoalScorers,
  tournament,
  onSaveDetails,
  onSaveSchedule,
  onUpdateOperationalStatus,
  onOpenActivity,
  onCompareClubs,
  players,
  playerRegistrations,
  otherTournaments,
}: FixtureListProps) {
  const teamsById = new Map(teams.map((team) => [team.id, team.name]));

  return (
    <div className="fixture-list">
      {matchdays.map((matchday) => (
        <section
          className="matchday"
          key={`${matchday.phaseName ?? "leg"}-${matchday.leg}-${matchday.number}`}
        >
          <div className="matchday-heading">
            <div className="matchday-title">
              <span>
                {matchday.phaseName ?? `RUEDA ${String(matchday.leg).padStart(2, "0")}`}
              </span>
              {competitionType !== "cup" && (
                <h3>Fecha {String(matchday.number).padStart(2, "0")}</h3>
              )}
              {competitionType === "cup"
                && matchdays.filter((candidate) => candidate.phaseName === matchday.phaseName).length > 1 && (
                  <h3>Jornada {matchday.number}</h3>
                )}
            </div>
            {matchday.fixtures.length > 0 && (
              <button
                className="small-action"
                disabled={!matchday.fixtures.some((fixture) =>
                  !isOperationalStateSimulationBlocked(fixture))}
                type="button"
                onClick={() => onSimulateMatchday({
                  ...matchday,
                  fixtures: matchday.fixtures.filter((fixture) =>
                    !isOperationalStateSimulationBlocked(fixture)),
                })}
              >
                {matchday.fixtures.every(isOperationalStateSimulationBlocked)
                  ? "Sin partidos simulables"
                  : competitionType === "cup" ? "Simular etapa" : "Simular fecha"}
              </button>
            )}
          </div>
          <div className="matchday-fixtures">
            {matchday.fixtures.map((fixture) => {
              const homeTeam = teamsById.get(fixture.homeTeamId);
              const awayTeam = teamsById.get(fixture.awayTeamId);
              if (!homeTeam || !awayTeam) {
                return (
                  <p className="error-message" key={fixture.id}>
                    Este partido tiene equipos inválidos.
                  </p>
                );
              }
              const { operationalState: _operationalState, ...fixtureWithoutOperationalState } = fixture;
              const invalid = Boolean(validateFixtureDetails(tournament, fixture)
                || validateGoalScorers(fixture.goalScorers ?? [], fixture)
                || (fixture.result
                  && !isValidPlayedFixture(tournament, matchday, fixtureWithoutOperationalState)));
              const fixtureStatus = invalid
                ? "Datos inválidos"
                : fixture.result && getOperationalMatchStatus(fixture) !== "finished"
                  ? "Resultado en revisión"
                  : fixture.result ? "Disputado" : "Pendiente";
              const simulationBlocked = isOperationalStateSimulationBlocked(fixture);

              return (
                <FixtureRow
                  id={`${idPrefix}-${fixture.id}`}
                  key={fixture.id}
                  fixture={fixture}
                  fixtureStatus={fixtureStatus}
                  aggregateScore={getAggregateScoreBeforeFixture(
                    allMatchdays,
                    matchday,
                    fixture,
                  )}
                  homeTeam={homeTeam}
                  awayTeam={awayTeam}
                  onSimulate={() => onSimulateFixture(fixture.id)}
                  simulationBlocked={simulationBlocked}
                  onSave={onSaveResult}
                  onSaveGoalScorers={onSaveGoalScorers}
                  tournament={tournament}
                  onSaveDetails={onSaveDetails}
                  onSaveSchedule={onSaveSchedule}
                  onUpdateOperationalStatus={onUpdateOperationalStatus}
                  onOpenActivity={onOpenActivity}
                  onCompareClubs={onCompareClubs}
                  players={players}
                  playerRegistrations={playerRegistrations}
                  otherTournaments={otherTournaments}
                />
              );
            })}
            {matchday.fixtures.length === 0 && (
              <p className="muted">
                {competitionType === "cup"
                  ? "Los cruces de esta etapa se definirán al completar la ronda anterior."
                  : "Fecha libre para todos los equipos."}
              </p>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

interface FixtureRowProps {
  id: string;
  fixture: Fixture;
  fixtureStatus: string;
  aggregateScore?: { readonly homeGoals: number; readonly awayGoals: number };
  homeTeam: string;
  awayTeam: string;
  onSimulate: () => void;
  simulationBlocked: boolean;
  onSave: (
    fixtureId: string,
    result: MatchResult,
    resolution: KnockoutResolution | null,
  ) => void;
  onSaveGoalScorers: (fixtureId: string, goalScorers: readonly GoalScorer[]) => void;
  tournament: Tournament;
  onSaveDetails: (fixtureId: string, update: FixtureDetailsUpdate) => void;
  onSaveSchedule: (fixtureId: string, schedule: MatchSchedule | null) => boolean;
  onUpdateOperationalStatus: (
    fixtureId: string,
    status: OperationalMatchStatus,
    note: string,
    confirmedAmbiguousResult: boolean,
  ) => boolean;
  onOpenActivity?: (fixtureId: string) => void;
  onCompareClubs?: (homeId:string,awayId:string) => void;
  players: readonly Player[];
  playerRegistrations: readonly PlayerRegistration[];
  otherTournaments: readonly Tournament[];
}

interface GoalScorerDraft {
  teamId: string;
  playerId: string;
  playerName: string;
  minute: string;
  type: GoalType | "";
  eventId?: string;
}

function FixtureRow({
  id,
  fixture,
  fixtureStatus,
  aggregateScore,
  homeTeam,
  awayTeam,
  onSimulate,
  simulationBlocked,
  onSave,
  onSaveGoalScorers,
  tournament,
  onSaveDetails,
  onSaveSchedule,
  onUpdateOperationalStatus,
  onOpenActivity,
  onCompareClubs,
  players,
  playerRegistrations,
  otherTournaments,
}: FixtureRowProps) {
  const runWrite = useLibraryWrite();

  const result = fixture.result;
  const prefix = `${JSON.stringify(["fixture", tournament.id, fixture.id])}:`;
  const version = JSON.stringify([fixture.homeTeamId, fixture.awayTeamId, fixture.result,
    fixture.knockoutResolution, fixture.goalScorers, fixture.operationalState]);
  function useDraft<T>(field: string, initial: T | (() => T)) {
    return useSessionDraft<T>(`${prefix}${field}`, initial, version);
  }
  const [homeGoals, setHomeGoals] = useDraft("homeGoals", result?.homeGoals.toString() ?? "");
  const [awayGoals, setAwayGoals] = useDraft("awayGoals", result?.awayGoals.toString() ?? "");
  const [resolution, setResolution] = useDraft<KnockoutResolution | "">("resolution", 
    fixture.knockoutResolution ?? "",
  );
  const [extraTimeHomeGoals, setExtraTimeHomeGoals] = useDraft("extraTimeHomeGoals", 
    result?.extraTime?.homeGoals.toString() ?? "",
  );
  const [extraTimeAwayGoals, setExtraTimeAwayGoals] = useDraft("extraTimeAwayGoals", 
    result?.extraTime?.awayGoals.toString() ?? "",
  );
  const [penaltiesHomeGoals, setPenaltiesHomeGoals] = useDraft("penaltiesHomeGoals", 
    result?.penalties?.homeGoals.toString() ?? "",
  );
  const [penaltiesAwayGoals, setPenaltiesAwayGoals] = useDraft("penaltiesAwayGoals", 
    result?.penalties?.awayGoals.toString() ?? "",
  );
  const [resultError, setResultError] = useState("");
  const [goalScorerDrafts, setGoalScorerDrafts] = useDraft<GoalScorerDraft[]>("goalScorerDrafts", () =>
    (fixture.goalScorers ?? []).map((scorer) => ({
      teamId: scorer.teamId,
      playerId: scorer.playerId ?? "",
      playerName: scorer.playerName,
      minute: scorer.minute?.toString() ?? "",
      type: scorer.type ?? "",
      ...(scorer.eventId ? { eventId: scorer.eventId } : {}),
    })),
  );
  const [newGoalScorer, setNewGoalScorer] = useDraft<GoalScorerDraft>("newGoalScorer", {
    teamId: fixture.homeTeamId,
    playerId: "",
    playerName: "",
    minute: "",
    type: "regular",
  });
  const [goalScorerError, setGoalScorerError] = useState("");
  const operationalStatus = getOperationalMatchStatus(fixture);
  const [nextOperationalStatus, setNextOperationalStatus] =
    useDraft<OperationalMatchStatus>("nextOperationalStatus", operationalStatus);
  const [operationalNote, setOperationalNote] = useDraft("operationalNote", fixture.operationalState?.note ?? "");


  const parsedHomeGoals = parseGoal(homeGoals);
  const parsedAwayGoals = parseGoal(awayGoals);
  const tiedAfterRegulation = parsedHomeGoals !== undefined
    && parsedAwayGoals !== undefined
    && parsedHomeGoals === parsedAwayGoals;
  const parsedExtraTimeHomeGoals = parseGoal(extraTimeHomeGoals);
  const parsedExtraTimeAwayGoals = parseGoal(extraTimeAwayGoals);
  const tiedAfterExtraTime = tiedAfterRegulation
    && parsedExtraTimeHomeGoals !== undefined
    && parsedExtraTimeAwayGoals !== undefined
    && parsedHomeGoals + parsedExtraTimeHomeGoals
      === parsedAwayGoals + parsedExtraTimeAwayGoals;
  const tiedOnAggregate = aggregateScore !== undefined
    && parsedHomeGoals !== undefined
    && parsedAwayGoals !== undefined
    && aggregateScore.homeGoals + parsedHomeGoals
      === aggregateScore.awayGoals + parsedAwayGoals;
  const showExtraTime = resolution === "extra-time-then-penalties" && tiedAfterRegulation;
  const showPenalties = (resolution === "penalties" && tiedAfterRegulation)
    || (resolution === "extra-time-then-penalties" && tiedAfterExtraTime)
    || (resolution === "aggregate-then-penalties" && tiedOnAggregate);

  async function saveResult() { try {
    if (parsedHomeGoals === undefined || parsedAwayGoals === undefined) {
      setResultError("Ingresa dos resultados enteros entre 0 y 99.");
      return;
    }

    if (
      (showExtraTime
        && (parsedExtraTimeHomeGoals === undefined || parsedExtraTimeAwayGoals === undefined))
      || (showPenalties
        && (parseGoal(penaltiesHomeGoals) === undefined
          || parseGoal(penaltiesAwayGoals) === undefined))
    ) {
      setResultError("Ingresa los goles de la prórroga y/o penales como enteros entre 0 y 99.");
      return;
    }
    const parsedPenaltiesHomeGoals = parseGoal(penaltiesHomeGoals);
    const parsedPenaltiesAwayGoals = parseGoal(penaltiesAwayGoals);
    if (
      showPenalties
      && parsedPenaltiesHomeGoals === parsedPenaltiesAwayGoals
    ) {
      setResultError("La tanda de penales debe tener un ganador.");
      return;
    }

    let resultToSave: MatchResult = {
      homeGoals: parsedHomeGoals,
      awayGoals: parsedAwayGoals,
    };
    if (
      showExtraTime
      && parsedExtraTimeHomeGoals !== undefined
      && parsedExtraTimeAwayGoals !== undefined
    ) {
      resultToSave = {
        ...resultToSave,
        extraTime: {
          homeGoals: parsedExtraTimeHomeGoals,
          awayGoals: parsedExtraTimeAwayGoals,
        },
      };
    }
    if (
      showPenalties
      && parsedPenaltiesHomeGoals !== undefined
      && parsedPenaltiesAwayGoals !== undefined
    ) {
      resultToSave = {
        ...resultToSave,
        penalties: {
          homeGoals: parsedPenaltiesHomeGoals,
          awayGoals: parsedPenaltiesAwayGoals,
        },
      };
    }
    setResultError("");
    await runWrite(() => onSave(fixture.id, resultToSave, resolution || null));
   } catch (error) { setResultError(error instanceof Error ? error.message : "No se pudo guardar. Revisa los datos actuales."); }}

  function addGoalScorer() {
    if (!newGoalScorer.playerName.trim()) {
      setGoalScorerError("Ingresa el nombre del autor del gol.");
      return;
    }
    if (newGoalScorer.minute !== ""
      && (!Number.isSafeInteger(Number(newGoalScorer.minute))
        || Number(newGoalScorer.minute) < 1
        || Number(newGoalScorer.minute) > 120)) {
      setGoalScorerError("El minuto debe ser un entero entre 1 y 120.");
      return;
    }
    setGoalScorerDrafts((current) => [...current, newGoalScorer]);
    setNewGoalScorer({
      teamId: fixture.homeTeamId,
      playerId: "",
      playerName: "",
      minute: "",
      type: "regular",
    });
    setGoalScorerError("");
  }

  async function saveGoalScorers() { try {
    const invalidMinute = goalScorerDrafts.some((scorer) => scorer.minute !== ""
      && (!Number.isSafeInteger(Number(scorer.minute))
        || Number(scorer.minute) < 1
        || Number(scorer.minute) > 120));
    if (invalidMinute) {
      setGoalScorerError("El minuto debe ser un entero entre 1 y 120.");
      return;
    }

    await runWrite(() => onSaveGoalScorers(fixture.id, goalScorerDrafts.map((scorer) => ({
      teamId: scorer.teamId,
      playerName: scorer.playerName.trim(),
      ...(scorer.playerId ? { playerId: scorer.playerId } : {}),
      ...(scorer.minute !== "" ? { minute: Number(scorer.minute) } : {}),
      ...(scorer.type ? { type: scorer.type } : {}),
      ...(scorer.eventId ? { eventId: scorer.eventId } : {}),
    }))));
    setGoalScorerError("");
   } catch (error) { setResultError(error instanceof Error ? error.message : "No se pudo guardar. Revisa los datos actuales."); }}

  async function saveOperationalStatus() { try {
    if (nextOperationalStatus === operationalStatus) return;
    const warning = fixture.result !== undefined && nextOperationalStatus !== "finished"
      ? "\n\nEl marcador, las alineaciones, los eventos y las sustituciones se conservarán, pero dejarán de contar como resultado final hasta resolver el estado."
      : "\n\nEl marcador, las alineaciones, los eventos, las sustituciones y la programación no se modificarán.";
    const consequence = nextOperationalStatus === "cancelled"
      ? "\nNo se asignarán automáticamente puntos ni un resultado."
      : nextOperationalStatus === "postponed"
        ? "\nNo se asignará una nueva fecha automáticamente."
        : nextOperationalStatus === "suspended"
          ? "\nEl partido seguirá sin resolverse hasta reanudarlo o finalizarlo explícitamente."
          : "";
    if (!window.confirm(
      `¿Confirmas cambiar el estado de ${getOperationalStatusLabel(operationalStatus)} a ${getOperationalStatusLabel(nextOperationalStatus)}?${warning}${consequence}`,
    )) return;
    const saved = await runWrite(() => onUpdateOperationalStatus(
      fixture.id,
      nextOperationalStatus,
      operationalNote,
      fixture.result !== undefined && nextOperationalStatus !== "finished",
    ));
    if (saved) setResultError("");
   } catch (error) { setResultError(error instanceof Error ? error.message : "No se pudo guardar. Revisa los datos actuales."); }}

  function getRegisteredPlayers(teamId: string, includeReleased = false) {
    const seenPlayerIds = new Set<string>();
    return playerRegistrations
      .filter((registration) => registration.teamId === teamId
        && (includeReleased || registration.status !== "released"))
      .flatMap((registration) => {
        if (seenPlayerIds.has(registration.playerId)) return [];
        seenPlayerIds.add(registration.playerId);
        const player = players.find(({ id: playerId }) => playerId === registration.playerId);
        return player ? [{ ...player, released: registration.status === "released" }] : [];
      });
  }

  function selectPlayer(playerId: string): { playerId: string; playerName?: string } {
    if (!playerId) return { playerId: "" };
    const player = players.find(({ id }) => id === playerId);
    return player
      ? { playerId, playerName: `${player.firstName} ${player.lastName}` }
      : { playerId: "" };
  }

  function manualAuthorWarning(teamId: string, playerName: string): string {
    const nameKey = normalizePlayerName(playerName);
    if (!nameKey) return "";
    const currentSeasonPlayerIds = new Set(players
      .filter((player) => normalizePlayerName(`${player.firstName} ${player.lastName}`) === nameKey)
      .map(({ id }) => id));
    if (playerRegistrations.some((registration) =>
      currentSeasonPlayerIds.has(registration.playerId)
      && registration.teamId !== teamId
      && registration.status !== "released")) {
      return "Advertencia: hay un perfil con ese nombre en otra plantilla de esta temporada; se conservará como autor manual.";
    }
    if (otherTournaments.some((otherTournament) => {
      const otherIds = new Set((otherTournament.players ?? [])
        .filter((player) => normalizePlayerName(`${player.firstName} ${player.lastName}`) === nameKey)
        .map(({ id }) => id));
      return (otherTournament.playerRegistrations ?? []).some((registration) =>
        otherIds.has(registration.playerId) && registration.status !== "released");
    })) {
      return "Advertencia: existe el mismo nombre en otra temporada; puede ser una coincidencia y no se vinculará automáticamente.";
    }
    return "";
  }

  const displayedHomeGoals = result
    ? result.homeGoals + (result.extraTime?.homeGoals ?? 0)
    : undefined;
  const displayedAwayGoals = result
    ? result.awayGoals + (result.extraTime?.awayGoals ?? 0)
    : undefined;

  return (
    <div
      aria-label={`${homeTeam} contra ${awayTeam}`}
      className="fixture-card"
      id={id}
      role="group"
      tabIndex={-1}
    >
      <span className={`fixture-status${fixtureStatus === "Datos inválidos" ? " invalid" : ""}`}>
        {fixtureStatus}
      </span>
      <span className={`fixture-operational-status operational-${operationalStatus}`}>
        {getOperationalStatusLabel(operationalStatus)}
        {fixture.operationalState?.updatedAt
          ? ` · actualizado ${new Date(fixture.operationalState.updatedAt).toLocaleString("es-CL")}`
          : ""}
      </span>
      {onCompareClubs && <button className="small-action fixture-h2h-action" type="button" onClick={()=>onCompareClubs(fixture.homeTeamId,fixture.awayTeamId)}>Comparar clubes (H2H)</button>}
      {onOpenActivity && (
        <button className="small-action fixture-activity-action" type="button" onClick={() => onOpenActivity(fixture.id)}>
          Historial del partido
        </button>
      )}
      {(!fixture.schedule?.date || !fixture.schedule?.time) && (
        <span className="fixture-schedule-status">
          Programación incompleta
          {!fixture.schedule?.date && !fixture.schedule?.time ? " · falta fecha y hora" : ""}
          {!fixture.schedule?.date && fixture.schedule?.time ? " · falta fecha" : ""}
          {fixture.schedule?.date && !fixture.schedule?.time ? " · falta hora" : ""}
        </span>
      )}
      {fixture.schedule && <span className="fixture-schedule-status">
        Fecha/hora: {scheduleProvenanceLabel(fixture.schedule.provenance, fixture.calendarProvenance, tournament.calendarProvenance, tournament.sourceUrl)}
      </span>}
      <span className="fixture-schedule-status">
        Encuentro: {fixtureProvenanceLabel(fixture.calendarProvenance, tournament.calendarProvenance, tournament.sourceUrl)}
      </span>
      <div className="fixture">
        <span>{homeTeam}</span>
        <span className="versus">
          {result ? `${displayedHomeGoals} — ${displayedAwayGoals}` : "vs"}
        </span>
        <span>{awayTeam}</span>
      </div>
      {result && (result.extraTime || result.penalties) && (
        <p className="fixture-decision-summary">
          90′ {result.homeGoals}–{result.awayGoals}
          {result.extraTime
            ? ` · Prórroga ${result.extraTime.homeGoals}–${result.extraTime.awayGoals}`
            : ""}
          {result.penalties
            ? ` · Penales ${result.penalties.homeGoals}–${result.penalties.awayGoals}`
            : ""}
        </p>
      )}
      {result && fixture.knockoutResolution === "aggregate-then-penalties" && aggregateScore && (
        <p className="fixture-decision-summary">
          Marcador global: {aggregateScore.homeGoals + result.homeGoals}–
          {aggregateScore.awayGoals + result.awayGoals}
        </p>
      )}
      <div className="result-editor">
        <label>
          <span className="sr-only">Goles de {homeTeam}</span>
          <input
            aria-label={`Goles de ${homeTeam}`}
            type="number"
            min="0"
            max="99"
            step="1"
            value={homeGoals}
            onChange={(event) => setHomeGoals(event.target.value)}
          />
        </label>
        <span className="versus">—</span>
        <label>
          <span className="sr-only">Goles de {awayTeam}</span>
          <input
            aria-label={`Goles de ${awayTeam}`}
            type="number"
            min="0"
            max="99"
            step="1"
            value={awayGoals}
            onChange={(event) => setAwayGoals(event.target.value)}
          />
        </label>
        <button className="small-action" type="button" onClick={saveResult}>Guardar</button>
        <button
          className="small-action secondary-action"
          disabled={simulationBlocked}
          type="button"
          onClick={onSimulate}
        >
          {simulationBlocked ? "No simulable en este estado" : result ? "Simular de nuevo" : "Simular partido"}
        </button>
      </div>
      <div className="operational-state-editor">
        <label>
          <span>Estado operativo</span>
          <select
            aria-label={`Estado operativo de ${homeTeam} contra ${awayTeam}`}
            value={nextOperationalStatus}
            onChange={(event) =>
              setNextOperationalStatus(event.target.value as OperationalMatchStatus)}
          >
            <option value={operationalStatus}>{getOperationalStatusLabel(operationalStatus)}</option>
            {getAllowedOperationalTransitions(operationalStatus)
              .filter((candidate) => candidate !== operationalStatus)
              .map((candidate) => (
                <option key={candidate} value={candidate}>{getOperationalStatusLabel(candidate)}</option>
              ))}
          </select>
        </label>
        <label>
          <span>Observación operativa (opcional)</span>
          <input
            aria-label={`Observación operativa de ${homeTeam} contra ${awayTeam}`}
            maxLength={500}
            value={operationalNote}
            onChange={(event) => setOperationalNote(event.target.value)}
          />
        </label>
        <button
          className="small-action"
          disabled={nextOperationalStatus === operationalStatus}
          onClick={saveOperationalStatus}
          type="button"
        >
          Confirmar estado
        </button>
      </div>
      <details className="resolution-editor" open={Boolean(fixture.knockoutResolution)}>
        <summary>{fixture.knockoutResolution ? "Desempate de eliminación" : "Desempate opcional"}</summary>
        <label>
          <span>Si empatan</span>
          <select
            aria-label={`Regla de desempate para ${homeTeam} contra ${awayTeam}`}
            value={resolution}
            disabled={Boolean(secondDivisionKind(tournament))}
            onChange={(event) =>
              setResolution(event.target.value as KnockoutResolution | "")
            }

          >
            <option value="">Sin desempate especial</option>
            <option value="penalties">Penales directos</option>
            <option value="extra-time-then-penalties">Prórroga y, si persiste, penales</option>
            <option value="aggregate-then-penalties">Marcador global y, si empatan, penales</option>
          </select>
        </label>
        {resolution === "aggregate-then-penalties" && !aggregateScore && (
          <span className="muted">
            Guarda primero el resultado de ida para calcular si el global requiere penales.
          </span>
        )}
        {showExtraTime && (
          <div className="resolution-score">
            <span>Goles en prórroga</span>
            <input
              aria-label={`Goles de ${homeTeam} en prórroga`}
              min="0"
              max="99"
              step="1"
              type="number"
              value={extraTimeHomeGoals}
              onChange={(event) => setExtraTimeHomeGoals(event.target.value)}
            />
            <span>—</span>
            <input
              aria-label={`Goles de ${awayTeam} en prórroga`}
              min="0"
              max="99"
              step="1"
              type="number"
              value={extraTimeAwayGoals}
              onChange={(event) => setExtraTimeAwayGoals(event.target.value)}
            />
          </div>
        )}
        {showPenalties && (
          <div className="resolution-score">
            <span>Penales</span>
            <input
              aria-label={`Penales de ${homeTeam}`}
              min="0"
              max="99"
              step="1"
              type="number"
              value={penaltiesHomeGoals}
              onChange={(event) => setPenaltiesHomeGoals(event.target.value)}
            />
            <span>—</span>
            <input
              aria-label={`Penales de ${awayTeam}`}
              min="0"
              max="99"
              step="1"
              type="number"
              value={penaltiesAwayGoals}
              onChange={(event) => setPenaltiesAwayGoals(event.target.value)}
            />
          </div>
        )}
      </details>
      <details className="goal-scorers-editor">
        <summary>Autores de goles ({fixture.goalScorers?.length ?? 0})</summary>
        <p className="muted">Editar autores no cambia el marcador del partido.</p>
        {goalScorerDrafts.map((scorer, index) => (
          <div className="goal-scorer-edit-row" key={`${fixture.id}-scorer-${index}`}>
            <label>
              <span className="sr-only">Equipo de jugador autor {index + 1}</span>
              <select
                aria-label={`Equipo del autor ${index + 1}`}
                value={scorer.teamId}
                onChange={(event) => setGoalScorerDrafts((current) => current.map((entry, entryIndex) =>
                  entryIndex === index
                    ? { ...entry, teamId: event.target.value, playerId: "" }
                    : entry))}
              >
                <option value={fixture.homeTeamId}>{homeTeam}</option>
                <option value={fixture.awayTeamId}>{awayTeam}</option>
              </select>
            </label>
            <label>
              <span className="sr-only">Jugador registrado del autor {index + 1}</span>
              <select
                aria-label={`Jugador registrado del autor ${index + 1}`}
                value={scorer.playerId}
                onChange={(event) => {
                  const selected = selectPlayer(event.target.value);
                  setGoalScorerDrafts((current) => current.map((entry, entryIndex) =>
                    entryIndex === index
                      ? { ...entry, ...selected,
                        ...(selected.playerName !== undefined
                          ? { playerName: selected.playerName }
                          : {}) }
                      : entry));
                }}
              >
                <option value="">Autor manual</option>
                {getRegisteredPlayers(scorer.teamId, true).map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.firstName} {player.lastName}{player.released ? " (histórico)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="sr-only">Nombre del autor {index + 1}</span>
              <input
                aria-label={`Nombre del autor ${index + 1}`}
                value={scorer.playerName}
                onChange={(event) => setGoalScorerDrafts((current) => current.map((entry, entryIndex) =>
                  entryIndex === index
                    ? { ...entry, playerId: "", playerName: event.target.value }
                    : entry))}
              />
            </label>
            <label>
              <span className="sr-only">Minuto del autor {index + 1}</span>
              <input
                aria-label={`Minuto del autor ${index + 1}`}
                type="number"
                min="1"
                max="120"
                step="1"
                placeholder="Min."
                value={scorer.minute}
                onChange={(event) => setGoalScorerDrafts((current) => current.map((entry, entryIndex) =>
                  entryIndex === index ? { ...entry, minute: event.target.value } : entry))}
              />
            </label>
            <label>
              <span className="sr-only">Tipo del gol {index + 1}</span>
              <select
                aria-label={`Tipo del gol ${index + 1}`}
                value={scorer.type}
                onChange={(event) => setGoalScorerDrafts((current) => current.map((entry, entryIndex) =>
                  entryIndex === index
                    ? { ...entry, type: event.target.value as GoalType | "" }
                    : entry))}
              >
                <option value="">Tipo sin especificar</option>
                <option value="regular">Normal</option>
                <option value="penalty">Penal</option>
                <option value="own-goal">Autogol</option>
              </select>
            </label>
            <button
              aria-label={`Eliminar autor ${index + 1}`}
              className="small-action secondary-action"
              type="button"
              onClick={() => setGoalScorerDrafts((current) =>
                current.filter((_, entryIndex) => entryIndex !== index))}
            >
              Quitar
            </button>
            {scorer.playerId === "" && manualAuthorWarning(scorer.teamId, scorer.playerName) && (
              <p className="goal-scorer-warning">
                {manualAuthorWarning(scorer.teamId, scorer.playerName)}
              </p>
            )}
          </div>
        ))}
        <div className="goal-scorer-edit-row">
          <label>
            <span className="sr-only">Equipo del nuevo autor</span>
            <select
              aria-label="Equipo del nuevo autor"
              value={newGoalScorer.teamId}
              onChange={(event) => setNewGoalScorer((current) => ({
                ...current,
                teamId: event.target.value,
                playerId: "",
                playerName: "",
              }))}
            >
              <option value={fixture.homeTeamId}>{homeTeam}</option>
              <option value={fixture.awayTeamId}>{awayTeam}</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Jugador registrado del nuevo autor</span>
            <select
              aria-label="Jugador registrado del nuevo autor"
              value={newGoalScorer.playerId}
              onChange={(event) => {
                const selected = selectPlayer(event.target.value);
                setNewGoalScorer((current) => ({
                  ...current,
                  ...selected,
                  ...(selected.playerName !== undefined
                    ? { playerName: selected.playerName }
                    : {}),
                }));
              }}
            >
              <option value="">Ingreso manual</option>
              {getRegisteredPlayers(newGoalScorer.teamId).map((player) => (
                <option key={player.id} value={player.id}>
                  {player.firstName} {player.lastName}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Nombre del nuevo autor</span>
            <input
              aria-label="Nombre del nuevo autor"
              placeholder="Nombre del jugador"
              value={newGoalScorer.playerName}
              onChange={(event) => setNewGoalScorer((current) => ({
                ...current,
                playerId: "",
                playerName: event.target.value,
              }))}
            />
          </label>
          <label>
            <span className="sr-only">Minuto del nuevo autor</span>
            <input
              aria-label="Minuto del nuevo autor"
              type="number"
              min="1"
              max="120"
              step="1"
              placeholder="Min."
              value={newGoalScorer.minute}
              onChange={(event) => setNewGoalScorer((current) => ({
                ...current,
                minute: event.target.value,
              }))}
            />
          </label>
          <label>
            <span className="sr-only">Tipo del nuevo gol</span>
            <select
              aria-label="Tipo del nuevo gol"
              value={newGoalScorer.type}
              onChange={(event) => setNewGoalScorer((current) => ({
                ...current,
                type: event.target.value as GoalType | "",
              }))}
            >
              <option value="">Tipo sin especificar</option>
              <option value="regular">Normal</option>
              <option value="penalty">Penal</option>
              <option value="own-goal">Autogol</option>
            </select>
          </label>
          <button className="small-action" type="button" onClick={addGoalScorer}>Agregar gol</button>
        </div>
        {newGoalScorer.playerId === ""
          && manualAuthorWarning(newGoalScorer.teamId, newGoalScorer.playerName) && (
          <p className="goal-scorer-warning">
            {manualAuthorWarning(newGoalScorer.teamId, newGoalScorer.playerName)}
          </p>
        )}
        <p className="muted">Los nombres ingresados manualmente no se vinculan a un jugador registrado.</p>
        {goalScorerError && <p className="error-message" role="alert">{goalScorerError}</p>}
        <button className="small-action" type="button" onClick={saveGoalScorers}>
          Guardar autores
        </button>
      </details>
      <MatchDetailsPanel
        fixture={fixture}
        tournament={tournament}
        homeTeam={homeTeam}
        awayTeam={awayTeam}
        players={players}
        registrations={playerRegistrations}
        onSave={onSaveDetails}
        onSaveSchedule={onSaveSchedule}
      />
      {resultError && <p className="field-error result-error" role="alert">{resultError}</p>}
    </div>
  );
}

function parseGoal(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const goal = Number(value);
  return Number.isInteger(goal) && goal >= 0 && goal <= 99 ? goal : undefined;
}

function normalizePlayerName(value: string): string {
  return value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
}

function scheduleProvenanceLabel(
  provenance: import("../../domain/entities/tournament").CalendarProvenance | undefined,
  fixtureProvenance: Tournament["calendarProvenance"],
  calendarProvenance: Tournament["calendarProvenance"],
  sourceUrl?: string,
): string {
  if (provenance === "official-import") return "importada oficialmente";
  if (provenance === "local-generated" || provenance === "manual") return "local";
  if (fixtureProvenance === "official-import") return "importada oficialmente";
  if (fixtureProvenance === "local-generated" || fixtureProvenance === "manual") return "local";
  if (calendarProvenance === "official-import" || sourceUrl) return "importada oficialmente (origen heredado)";
  return "local o no registrada";
}

function fixtureProvenanceLabel(
  fixtureProvenance: Tournament["calendarProvenance"],
  calendarProvenance: Tournament["calendarProvenance"],
  sourceUrl?: string,
): string {
  if (fixtureProvenance === "local-generated") return "local generado por el usuario";
  if (fixtureProvenance === "manual") return "local registrado manualmente";
  if (fixtureProvenance === "official-import" || calendarProvenance === "official-import" || sourceUrl) {
    return "importado de fuente oficial";
  }
  return "local o no registrada";
}

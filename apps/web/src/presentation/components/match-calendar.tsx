import {DrawCenterAccess} from "./draw-center-access";
import { SeasonClosureAccess } from "./season-closure-access";
import { SeasonSimulationAccess } from "./season-simulation-access";
import { useEffect, useMemo, useState } from "react";
import type { Fixture, Matchday, Tournament } from "@cancha/core/domain/entities/tournament";
import type { OperationalMatchStatus } from "@cancha/core/domain/entities/tournament";
import { validateGoalScorers } from "@cancha/core/domain/services/goal-scorers";
import { validateFixtureDetails } from "@cancha/core/domain/services/match-details";
import { isValidPlayedFixture } from "@cancha/core/domain/services/tournament-statistics";
import { getOperationalMatchStatus, getOperationalStatusLabel } from "@cancha/core/domain/services/match-operational-status";
import type { FixtureListProps } from "./fixture-list";
import { FixtureList } from "./fixture-list";

type FixtureStatus = "pending" | "played" | "invalid";
type CalendarStatusFilter = FixtureStatus | OperationalMatchStatus | "";
type CalendarFixture = { matchday: Matchday; fixture: Fixture };
type CalendarGroup = {
  key: string;
  title: string;
  entries: Array<{ matchday: Matchday; fixtures: Fixture[] }>;
};

function matchdayKey(matchday: Matchday): string {
  return `${matchday.phaseName ?? ""}|${matchday.leg}|${matchday.number}`;
}

function getFixtureStatus(
  tournament: Tournament,
  matchday: Matchday,
  fixture: Fixture,
): FixtureStatus {
  const knownTeams = new Set(tournament.teams.map(({ id }) => id));
  const { operationalState: _operationalState, ...fixtureWithoutOperationalState } = fixture;
  if (!knownTeams.has(fixture.homeTeamId) || !knownTeams.has(fixture.awayTeamId)
    || validateFixtureDetails(tournament, fixture)
    || validateGoalScorers(fixture.goalScorers ?? [], fixture)
    || (fixture.result !== undefined
      && !isValidPlayedFixture(tournament, matchday, fixtureWithoutOperationalState))
    || (getOperationalMatchStatus(fixture) === "finished" && fixture.result === undefined)) {
    return "invalid";
  }
  return fixture.result && getOperationalMatchStatus(fixture) === "finished" ? "played" : "pending";
}

export interface MatchCalendarProps extends FixtureListProps {
  readonly onBack: () => void;
  readonly onOpenProgramming?: () => void;
}

export function MatchCalendar({
  matchdays,
  teams,
  tournament,
  onBack,
  onOpenProgramming,
  ...fixtureListProps
}: MatchCalendarProps) {
  const [teamId, setTeamId] = useState("");
  const [matchdayKeyFilter, setMatchdayKeyFilter] = useState("");
  const [groupName, setGroupName] = useState("");
  const [phaseName, setPhaseName] = useState("");
  const [status, setStatus] = useState<CalendarStatusFilter>("");
  const [sortOrder, setSortOrder] = useState<"round" | "date">("round");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  useEffect(() => {
    setTeamId("");
    setMatchdayKeyFilter("");
    setGroupName("");
    setPhaseName("");
    setStatus("");
    setSortOrder("round");
    setDateFrom("");
    setDateTo("");
  }, [tournament.id]);
  const teamGroups = useMemo(() => new Map(teams.map(({ id, groupName: group }) => [id, group])), [teams]);
  const groupNames = [...new Set(teams
    .map(({ groupName: group }) => group)
    .filter((group): group is string => Boolean(group)))].sort((a, b) => a.localeCompare(b, "es"));
  const phaseNames = [...new Set(matchdays
    .map(({ phaseName: phase }) => phase)
    .filter((phase): phase is string => Boolean(phase)))];
  const dayKeys = [...new Set(matchdays.map(matchdayKey))];
  const hasMatchdays = dayKeys.length > 1;

  const filtered = useMemo(() => {
    const selected = matchdays
      .filter((matchday) => !phaseName || matchday.phaseName === phaseName)
      .filter((matchday) => !matchdayKeyFilter || matchdayKey(matchday) === matchdayKeyFilter)
      .map((matchday) => ({
        ...matchday,
        fixtures: matchday.fixtures.filter((fixture) =>
          (!teamId || fixture.homeTeamId === teamId || fixture.awayTeamId === teamId)
          && (!groupName || teamGroups.get(fixture.homeTeamId) === groupName
            || teamGroups.get(fixture.awayTeamId) === groupName)
          && matchesCalendarStatus(tournament, matchday, fixture, status)
          && (!fixture.schedule?.date || (
            (!dateFrom || fixture.schedule.date >= dateFrom)
            && (!dateTo || fixture.schedule.date <= dateTo)
          ))),
      }))
      .filter((matchday) => matchday.fixtures.length > 0);
    return sortOrder === "round"
      ? selected.sort((first, second) =>
        first.leg - second.leg || first.number - second.number
        || (first.phaseName ?? "").localeCompare(second.phaseName ?? "", "es"))
      : selected;
  }, [dateFrom, dateTo, groupName, matchdayKeyFilter, matchdays, phaseName, sortOrder, status, teamGroups, teamId, tournament]);

  const navigationDays = matchdays
    .filter((matchday) => !phaseName || matchday.phaseName === phaseName)
    .filter((matchday) => matchday.fixtures.some((fixture) =>
      (!teamId || fixture.homeTeamId === teamId || fixture.awayTeamId === teamId)
      && (!groupName || teamGroups.get(fixture.homeTeamId) === groupName
        || teamGroups.get(fixture.awayTeamId) === groupName)
      && matchesCalendarStatus(tournament, matchday, fixture, status)
      && (!fixture.schedule?.date || (
        (!dateFrom || fixture.schedule.date >= dateFrom)
        && (!dateTo || fixture.schedule.date <= dateTo)
      ))));
  const selectedIndex = navigationDays.findIndex((matchday) =>
    matchdayKey(matchday) === matchdayKeyFilter);
  const displayedFixtures = filtered.flatMap((matchday) =>
    matchday.fixtures.map((fixture) => ({ matchday, fixture })));
  const pendingCount = displayedFixtures.filter(({ matchday, fixture }) =>
    getFixtureStatus(tournament, matchday, fixture) === "pending").length;
  const playedCount = displayedFixtures.filter(({ matchday, fixture }) =>
    getFixtureStatus(tournament, matchday, fixture) === "played").length;
  const invalidCount = displayedFixtures.filter(({ matchday, fixture }) =>
    getFixtureStatus(tournament, matchday, fixture) === "invalid").length;
  const suspendedCount = displayedFixtures.filter(({ fixture }) =>
    getOperationalMatchStatus(fixture) === "suspended").length;
  const postponedCount = displayedFixtures.filter(({ fixture }) =>
    getOperationalMatchStatus(fixture) === "postponed").length;
  const cancelledCount = displayedFixtures.filter(({ fixture }) =>
    getOperationalMatchStatus(fixture) === "cancelled").length;
  const selectedMatchday = navigationDays[selectedIndex];
  const hasScheduledDates = matchdays.some((matchday) =>
    matchday.fixtures.some((fixture) => fixture.schedule?.date));
  const flatFixtures: CalendarFixture[] = filtered.flatMap((matchday) =>
    matchday.fixtures.map((fixture) => ({ matchday, fixture })));
  const sortedFixtures = sortOrder === "date"
    ? [...flatFixtures].sort((first, second) => {
      const firstDate = first.fixture.schedule?.date ?? "\uffff";
      const secondDate = second.fixture.schedule?.date ?? "\uffff";
      return firstDate.localeCompare(secondDate)
        || (first.fixture.schedule?.time ?? "").localeCompare(second.fixture.schedule?.time ?? "")
        || first.matchday.leg - second.matchday.leg
        || first.matchday.number - second.matchday.number;
    })
    : flatFixtures;
  const calendarGroups: CalendarGroup[] = sortOrder === "round"
    ? filtered.map((matchday) => ({
      key: matchdayKey(matchday),
      title: `${matchday.phaseName ? `${matchday.phaseName} · ` : ""}${tournament.competitionType === "cup" ? "Jornada" : "Fecha"} ${matchday.number}${matchday.leg > 1 ? ` · rueda ${matchday.leg}` : ""}`,
      entries: [{ matchday, fixtures: [...matchday.fixtures] }],
    }))
    : buildChronologicalGroups(sortedFixtures);
  const upcomingFixtures = sortedFixtures.filter(({ matchday, fixture }) =>
    getFixtureStatus(tournament, matchday, fixture) === "pending"
    && getOperationalMatchStatus(fixture) === "scheduled"
    && fixture.schedule?.date !== undefined
    && isUpcomingSchedule(fixture.schedule.date, fixture.schedule.time),
  ).slice(0, 5);
  const unassignedCount = flatFixtures.filter(({ fixture }) => !fixture.schedule?.date).length;

  function moveMatchday(offset: number) {
    const next = navigationDays[selectedIndex + offset];
    if (next) setMatchdayKeyFilter(matchdayKey(next));
  }

  function jumpTo(statusToFind: FixtureStatus) {
    const matchday = navigationDays.find((candidate) => candidate.fixtures.some((fixture) =>
      getFixtureStatus(tournament, candidate, fixture) === statusToFind));
    if (matchday) {
      setMatchdayKeyFilter(matchdayKey(matchday));
      setStatus(statusToFind);
    }
  }

  return (
    <section className="match-calendar" aria-label={`Calendario de ${tournament.name}`}>
      <div className="match-calendar-heading">
        <div>
          <span className="eyebrow">CALENDARIO · {tournament.season ?? "temporada no especificada"}</span>
          <h3>{tournament.name}</h3><SeasonSimulationAccess tournament={tournament} /><SeasonClosureAccess tournament={tournament} /><DrawCenterAccess tournament={tournament} />
          <p>Procedencia del calendario: {calendarProvenanceLabel(tournament.calendarProvenance, tournament.sourceUrl)}</p>
          <p>Fechas y horas son locales y no se convierten entre zonas horarias.</p>
        </div>
        <div className="preview-topline-actions">
          {onOpenProgramming && <button className="small-action" onClick={onOpenProgramming} type="button">Programar calendario</button>}
          <button className="small-action" onClick={onBack} type="button">Volver al torneo</button>
        </div>
      </div>
      <div className="match-calendar-controls" aria-label="Filtros del calendario">
        <label>
          <span>Equipo</span>
          <select aria-label="Filtrar calendario por equipo" value={teamId}
            onChange={(event) => { setTeamId(event.target.value); setMatchdayKeyFilter(""); }}>
            <option value="">Todos los equipos</option>
            {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
        </label>
        {hasMatchdays && (
          <label>
            <span>{tournament.competitionType === "cup" ? "Jornada / cruce" : "Jornada"}</span>
            <select aria-label="Filtrar calendario por jornada" value={matchdayKeyFilter}
              onChange={(event) => setMatchdayKeyFilter(event.target.value)}>
              <option value="">Todas las jornadas</option>
              {navigationDays.map((matchday) => (
                <option key={matchdayKey(matchday)} value={matchdayKey(matchday)}>
                  {matchday.phaseName ? `${matchday.phaseName} · ` : ""}
                  {tournament.competitionType === "cup" ? "Jornada" : "Fecha"} {matchday.number}
                  {matchday.leg > 1 ? ` · rueda ${matchday.leg}` : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        {groupNames.length > 0 && (
          <label>
            <span>Grupo</span>
            <select aria-label="Filtrar calendario por grupo" value={groupName}
              onChange={(event) => { setGroupName(event.target.value); setMatchdayKeyFilter(""); }}>
              <option value="">Todos los grupos</option>
              {groupNames.map((group) => <option key={group} value={group}>{group}</option>)}
            </select>
          </label>
        )}
        {phaseNames.length > 0 && (
          <label>
            <span>Fase</span>
            <select aria-label="Filtrar calendario por fase" value={phaseName}
              onChange={(event) => { setPhaseName(event.target.value); setMatchdayKeyFilter(""); }}>
              <option value="">Todas las fases</option>
              {phaseNames.map((phase) => <option key={phase} value={phase}>{phase}</option>)}
            </select>
          </label>
        )}
        <label>
          <span>Estado</span>
          <select aria-label="Filtrar calendario por estado" value={status}
            onChange={(event) => setStatus(event.target.value as CalendarStatusFilter)}>
            <option value="">Todos los estados</option>
            <option value="pending">Pendiente</option>
            <option value="played">Disputado</option>
            <option value="invalid">Con datos inválidos</option>
            {(["unscheduled", "scheduled", "in-progress", "finished", "postponed", "suspended", "cancelled"] as const)
              .map((operationalStatus) => (
                <option key={operationalStatus} value={operationalStatus}>
                  {getOperationalStatusLabel(operationalStatus)}
                </option>
              ))}
          </select>
        </label>
        <label>
          <span>Orden</span>
          <select aria-label="Ordenar calendario" value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value as "round" | "date")}>
            <option value="round">Jornada</option>
            <option disabled={!hasScheduledDates} value="date">Fecha y hora</option>
          </select>
        </label>
        {hasScheduledDates && (
          <>
            <label>
              <span>Desde</span>
              <input aria-label="Filtrar desde fecha" type="date" value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)} />
            </label>
            <label>
              <span>Hasta</span>
              <input aria-label="Filtrar hasta fecha" type="date" value={dateTo}
                onChange={(event) => setDateTo(event.target.value)} />
            </label>
          </>
        )}
      </div>
      <div className="match-calendar-summary" role="status">
        {playedCount} disputados · {pendingCount} pendientes · {invalidCount} con datos inválidos
        {" "}· {postponedCount} aplazados · {suspendedCount} suspendidos · {cancelledCount} cancelados
      </div>
      <div className="matchday-navigation" aria-label="Navegación entre jornadas">
        <button className="small-action" disabled={!selectedMatchday || selectedIndex <= 0}
          onClick={() => moveMatchday(-1)} type="button">Jornada anterior</button>
        <span>{selectedMatchday
          ? `${selectedMatchday.phaseName ? `${selectedMatchday.phaseName} · ` : ""}Jornada ${selectedMatchday.number}`
          : matchdayKeyFilter ? "Jornada sin partidos para estos filtros" : "Todas las jornadas"}</span>
        <button className="small-action" disabled={navigationDays.length === 0
          || selectedIndex === navigationDays.length - 1}
          onClick={() => moveMatchday(1)} type="button">Jornada siguiente</button>
        <button className="small-action" disabled={!navigationDays.some((matchday) =>
          matchday.fixtures.some((fixture) => getFixtureStatus(tournament, matchday, fixture) === "pending"))}
          onClick={() => jumpTo("pending")} type="button">Ir a pendiente</button>
        <button className="small-action" disabled={!navigationDays.some((matchday) =>
          matchday.fixtures.some((fixture) => getFixtureStatus(tournament, matchday, fixture) === "invalid"))}
          onClick={() => jumpTo("invalid")} type="button">Ir a datos inválidos</button>
      </div>
      {upcomingFixtures.length > 0 && (
        <section className="match-calendar-upcoming" aria-label="Próximos partidos programados">
          <h4>Próximos partidos programados</h4>
          <ul>
            {upcomingFixtures.map(({ fixture }) => (
              <li key={fixture.id}>
                <strong>{teams.find(({ id }) => id === fixture.homeTeamId)?.name ?? fixture.homeTeamId}
                  {" contra "}{teams.find(({ id }) => id === fixture.awayTeamId)?.name ?? fixture.awayTeamId}</strong>
                <span>{formatLocalDate(fixture.schedule?.date ?? "")}
                  {fixture.schedule?.time ? ` · ${fixture.schedule.time}${fixture.schedule.utcOffset === "Z"
                    ? " UTC" : fixture.schedule.utcOffset ? ` UTC${fixture.schedule.utcOffset}` : ""}` : " · hora no registrada"}
                  {fixture.schedule?.venue ? ` · ${fixture.schedule.venue}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {sortOrder === "date" && (
        <p className="match-calendar-summary">
          {unassignedCount} partidos sin fecha asignada; se mantienen al final del calendario cronológico.
        </p>
      )}
      {calendarGroups.length > 0 ? (
        <div className="match-calendar-groups">
          {calendarGroups.map((group) => {
            const entries = group.entries.flatMap((entry) =>
              entry.fixtures.map((fixture) => ({ matchday: entry.matchday, fixture })));
            const dayPlayed = entries.filter(({ matchday, fixture }) =>
              getFixtureStatus(tournament, matchday, fixture) === "played").length;
            const dayInvalid = entries.filter(({ matchday, fixture }) =>
              getFixtureStatus(tournament, matchday, fixture) === "invalid").length;
            const dayPending = entries.filter(({ matchday, fixture }) =>
              getFixtureStatus(tournament, matchday, fixture) === "pending").length;
            const scheduledCount = entries.length;
            const isComplete = sortOrder === "round" && dayPending === 0 && dayInvalid === 0 && scheduledCount > 0;
            return (
              <section className="match-calendar-day" key={group.key}>
                <h4>
                  {group.title}
                  <span>{dayPlayed} disputados · {dayPending} pendientes · {dayInvalid} inválidos
                    {sortOrder === "date"
                      ? ` · ${scheduledCount} partidos`
                      : isComplete ? " · partidos completos" : " · incompleta"}</span>
                </h4>
                {group.entries.map(({ matchday, fixtures }) => (
                  <FixtureList
                    {...fixtureListProps}
                    idPrefix="calendar-fixture"
                    key={matchdayKey(matchday)}
                    matchdays={[{ ...matchday, fixtures }]}
                    teams={teams}
                    allMatchdays={matchdays}
                    tournament={tournament}
                  />
                ))}
              </section>
            );
          })}
        </div>
      ) : (
        <p className="library-empty" role="status">
          No hay partidos que coincidan con los filtros seleccionados.
        </p>
      )}
    </section>
  );
}

function calendarProvenanceLabel(
  provenance: Tournament["calendarProvenance"],
  sourceUrl?: string,
): string {
  if (provenance === "local-generated") return "local generado por el usuario";
  if (provenance === "manual") return "local registrado manualmente";
  if (provenance === "official-import" || sourceUrl) return "importado de fuente oficial";
  return "no registrada";
}

function buildChronologicalGroups(fixtures: readonly CalendarFixture[]): CalendarGroup[] {
  const groups = new Map<string, CalendarGroup>();
  for (const { matchday, fixture } of fixtures) {
    const date = fixture.schedule?.date;
    const key = date ?? "unassigned-date";
    let group = groups.get(key);
    if (!group) {
      group = { key, title: date ? formatLocalDate(date) : "Sin fecha asignada", entries: [] };
      groups.set(key, group);
    }

    let entry = group.entries.find((candidate) => matchdayKey(candidate.matchday) === matchdayKey(matchday));
    if (!entry) {
      entry = { matchday, fixtures: [] };
      group.entries.push(entry);
    }
    entry.fixtures.push(fixture);
  }
  return [...groups.values()];
}

function matchesCalendarStatus(
  tournament: Tournament,
  matchday: Matchday,
  fixture: Fixture,
  filter: CalendarStatusFilter,
): boolean {
  if (!filter) return true;
  if (filter === "pending" || filter === "played" || filter === "invalid") {
    return getFixtureStatus(tournament, matchday, fixture) === filter;
  }
  return getOperationalMatchStatus(fixture) === filter;
}

function getLocalToday(): string {
  const now = new Date();
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getLocalTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function isUpcomingSchedule(date: string, time?: string): boolean {
  const today = getLocalToday();
  return date > today || (date === today && (!time || time >= getLocalTime()));
}

function formatLocalDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

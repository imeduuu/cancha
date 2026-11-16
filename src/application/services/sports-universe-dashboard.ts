import type { ActivityEvent } from "../../domain/entities/activity-event";
import type { SportsUniverseLibrary } from "../../domain/entities/sports-universe";
import type { Fixture, Matchday, Tournament } from "../../domain/entities/tournament";
import { getCompetitionAlerts, type CompetitionAlert } from "../../domain/services/competition-alerts";
import { calculateInternationalQualifications } from "../../domain/services/international-qualification";
import { getOperationalMatchStatus } from "../../domain/services/match-operational-status";
import { validateMatchSchedule } from "../../domain/services/match-scheduling";
import { getUnresolvedStandingsTieDetails } from "../../domain/services/standings";
import { calculateTournamentStatistics } from "../../domain/services/tournament-statistics";
import {
  canStartNewSeason,
  getTournamentCompletionStatus,
} from "../../domain/services/tournament-history";
import { activityInUniverse, tournamentsInUniverse } from "./sports-universes";
import { competitionIdentity, groupCompetitions, seasonOverview } from "./competition-center";
import { continentalPlanState } from "./continental-projection";

export type UniverseDashboardActionKind =
  | "calendar"
  | "alerts"
  | "planning"
  | "qualification"
  | "import-calendar";

export interface UniverseDashboardAction {
  readonly id: string;
  readonly kind: UniverseDashboardActionKind;
  readonly label: string;
  readonly tournament: Tournament;
}

export interface UniverseDashboardFixture {
  readonly tournament: Tournament;
  readonly matchday: Matchday;
  readonly fixture: Fixture;
  readonly date?: string;
  readonly time?: string;
  readonly utcOffset?: string;
  readonly matchdayLabel: string;
  readonly homeTeam: string;
  readonly awayTeam: string;
}

export interface UniverseDashboardCompetition {
  readonly tournament: Tournament;
  readonly competition: string;
  readonly territory: string;
  readonly category: string;
  readonly format: string;
  readonly status: string;
  readonly statistics: ReturnType<typeof calculateTournamentStatistics>;
  readonly provenance: string;
  readonly prepared: boolean;
  readonly configurationPending: boolean;
  readonly blockers: readonly CompetitionAlert[];
  readonly tableStatus: string;
  readonly placementStatus: string;
  readonly unresolvedTieCount: number;
  readonly topPositions: readonly { readonly name: string; readonly points: number }[];
  readonly qualificationStatus?: string;
  readonly qualificationPendingReasons: readonly string[];
}

export interface SportsUniverseDashboard {
  readonly universeName: string;
  readonly description?: string;
  readonly competitions: readonly UniverseDashboardCompetition[];
  readonly counts: {
    readonly competitions: number;
    readonly seasons: number;
    readonly inProgress: number;
    readonly completed: number;
    readonly prepared: number;
    readonly configurationPending: number;
  };
  readonly datedFixtures: readonly UniverseDashboardFixture[];
  readonly undatedFixtures: readonly UniverseDashboardFixture[];
  readonly recentActivity: readonly ActivityEvent[];
  readonly actions: readonly UniverseDashboardAction[];
}

function formatLabel(tournament: Tournament): string {
  const grouped = tournament.teams.some(({ groupName }) => !!groupName);
  if (tournament.competitionType === "cup") {
    if (grouped && tournament.knockoutStages?.length) return "Copa · grupos y eliminatorias";
    if (grouped) return "Copa · grupos";
    return tournament.knockoutStages?.length ? "Copa · eliminatorias" : "Copa";
  }
  if (tournament.format === "staged") return grouped ? "Fases · grupos" : "Fases";
  if (tournament.format === "round-robin" || tournament.competitionType === "league") {
    return grouped ? "Liga · grupos" : "Liga";
  }
  return "Formato no especificado";
}

function hasPreparation(tournament: Tournament): boolean {
  return Boolean(tournament.seasonPreparation
    || tournament.nationalCupPlanning
    || tournament.continentalPlans?.some(({ mode }) => mode === "incorporated"));
}

function isConfigurationAlert(alert: CompetitionAlert): boolean {
  return ["regulations-review", "calendar-incomplete", "incomplete-schedule"].includes(alert.type);
}

function matchdayLabel(matchday: Matchday): string {
  const parts = [matchday.phaseName, `Jornada ${matchday.number}`];
  if (matchday.leg > 1) parts.push(`vuelta ${matchday.leg}`);
  return parts.filter(Boolean).join(" · ");
}

function pendingFixture(
  tournament: Tournament,
  matchday: Matchday,
  fixture: Fixture,
): UniverseDashboardFixture | undefined {
  const status = getOperationalMatchStatus(fixture);
  if (status !== "scheduled" && status !== "unscheduled") return undefined;
  const scheduleIssue = fixture.schedule ? validateMatchSchedule(fixture.schedule) : undefined;
  const homeTeam = tournament.teams.find(({ id }) => id === fixture.homeTeamId)?.name;
  const awayTeam = tournament.teams.find(({ id }) => id === fixture.awayTeamId)?.name;
  if (!homeTeam || !awayTeam) return undefined;
  return {
    tournament,
    matchday,
    fixture,
    ...(!scheduleIssue && fixture.schedule?.date ? { date: fixture.schedule.date } : {}),
    ...(!scheduleIssue && fixture.schedule?.time ? { time: fixture.schedule.time } : {}),
    ...(!scheduleIssue && fixture.schedule?.utcOffset ? { utcOffset: fixture.schedule.utcOffset } : {}),
    matchdayLabel: matchdayLabel(matchday),
    homeTeam,
    awayTeam,
  };
}

function actionFor(
  kind: UniverseDashboardActionKind,
  label: string,
  tournament: Tournament,
): UniverseDashboardAction {
  return { id: `${kind}:${tournament.id}:${label}`, kind, label, tournament };
}

export function projectSportsUniverseDashboard(
  allTournaments: readonly Tournament[],
  allActivity: readonly ActivityEvent[],
  library: SportsUniverseLibrary,
): SportsUniverseDashboard {
  const tournaments = tournamentsInUniverse(allTournaments, library);
  const tournamentIds = new Set(tournaments.map(({ id }) => id));
  const allTournamentIds = new Set(allTournaments.map(({ id }) => id));
  const scopedActivity = activityInUniverse(
    allActivity,
    tournamentIds,
    library.activeUniverseId,
    allTournamentIds,
  ).filter((event) => {
    const tournamentExists = allTournamentIds.has(event.tournamentId);
    if (tournamentExists && !tournamentIds.has(event.tournamentId)) return false;
    if (event.universeId === undefined) return true;
    return !tournamentExists
      || (library.assignments[event.tournamentId] ?? null) === library.activeUniverseId;
  });
  const groups = groupCompetitions(tournaments);
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const competitions = tournaments.map((tournament): UniverseDashboardCompetition => {
    const identity = competitionIdentity(tournament);
    const group = groupById.get(identity);
    const statistics = calculateTournamentStatistics(tournament);
    const status = getTournamentCompletionStatus(tournament);
    const alerts = getCompetitionAlerts(tournament);
    const rules = tournament.competitionRules?.season === tournament.season
      ? tournament.competitionRules
      : undefined;
    const overview = seasonOverview(tournament, scopedActivity);
    const unresolvedTies = getUnresolvedStandingsTieDetails(tournament, statistics.standings);
    const isPositionVerified = rules?.verification.standings === "verified"
      && rules.verification.placements === "verified"
      && status === "Finalizado"
      && unresolvedTies.length === 0;
    const hasTable = statistics.standings.some(({ played }) => played > 0);
    const qualification = rules?.internationalQualification
      ? calculateInternationalQualifications(
        statistics.standings,
        tournament,
        tournaments,
        rules.internationalQualification,
        rules.verification.placements,
      )
      : undefined;
    const continentalPlanStates = (tournament.continentalPlans ?? []).map((plan) =>
      continentalPlanState(plan, tournaments, scopedActivity));
    const configurationPending = tournament.teams.length < 2
      || tournament.matchdays.length === 0
      || alerts.some(isConfigurationAlert);
    return {
      tournament,
      competition: group?.name ?? tournament.name,
      territory: group?.territory ?? "Sin país o confederación registrada",
      category: group?.category ?? "Categoría no registrada",
      format: formatLabel(tournament),
      status,
      statistics,
      provenance: `${hasMixedCalendarProvenance(tournament)
        ? "Calendario con encuentros oficiales y locales"
        : tournament.calendarProvenance === "local-generated"
        ? "Calendario local generado por el usuario"
        : tournament.calendarProvenance === "manual"
          ? "Calendario local registrado manualmente"
          : tournament.calendarProvenance === "official-import" || tournament.sourceUrl
            ? `Calendario importado: ${tournament.sourceName ?? "fuente registrada"}`
            : "Origen local o no registrado"} · ${overview.provenance}`,
      prepared: hasPreparation(tournament),
      configurationPending,
      blockers: alerts.filter(({ priority }) => priority !== "informative"),
      tableStatus: isPositionVerified
        ? "Posiciones verificadas según reglamento"
        : hasTable
          ? "Tabla provisional"
          : "Clasificación pendiente",
      placementStatus: rules?.verification.placements === "verified"
        ? isPositionVerified ? "Verificada" : "Pendiente de resultados o desempates"
        : rules?.verification.placements === "provisional"
          ? "Provisional"
          : "Pendiente de verificación",
      unresolvedTieCount: unresolvedTies.length,
      topPositions: hasTable
        ? statistics.standings.slice(0, 3).map(({ teamName, points }) => ({
          name: teamName,
          points,
        }))
        : [],
      ...((qualification || continentalPlanStates.length > 0) ? {
        qualificationStatus: qualification
          ? qualification.pendingReasons.length > 0
            || qualification.qualifications.some(({ status: itemStatus }) => itemStatus === "pending")
            ? "Pendiente de verificación"
            : qualification.qualifications.some(({ status: itemStatus }) => itemStatus === "provisional")
              ? "Provisional"
              : "Calculada; no certifica cupos oficiales"
          : continentalPlanStates.some((state) => state.startsWith("Desactualizada"))
            ? "Planificación local desactualizada"
            : "Planificación local; no certifica cupos oficiales",
        qualificationPendingReasons: [
          ...(qualification?.pendingReasons ?? []),
          ...continentalPlanStates.filter((state) => state.startsWith("Desactualizada")),
        ],
      } : { qualificationPendingReasons: [] }),
    };
  });
  const competitionById = new Map(competitions.map((item) =>
    [item.tournament.id, item]));
  const datedFixtures: UniverseDashboardFixture[] = [];
  const undatedFixtures: UniverseDashboardFixture[] = [];
  const actions: UniverseDashboardAction[] = [];

  for (const tournament of tournaments) {
    const item = competitionById.get(tournament.id);
    if (!item) continue;
    const { statistics, blockers: alerts } = item;

    for (const matchday of tournament.matchdays) {
      for (const fixture of matchday.fixtures) {
        const upcoming = pendingFixture(tournament, matchday, fixture);
        if (upcoming) (upcoming.date ? datedFixtures : undatedFixtures).push(upcoming);
      }

    }

    if (statistics.pending > 0 || statistics.incomplete > 0) {
      actions.push(actionFor("calendar", "Completar o revisar partidos", tournament));
    }

    if (item.unresolvedTieCount > 0) {
      actions.push(actionFor("alerts", "Revisar desempates", tournament));
    }
    if (alerts.some(({ priority }) => priority === "critical" || priority === "warning")) {
      actions.push(actionFor("alerts", "Resolver bloqueos o revisar alertas", tournament));
    }
    if (item?.qualificationStatus && item.qualificationStatus !== "Calculada; no certifica cupos oficiales") {
      actions.push(actionFor("qualification", "Consultar clasificación internacional", tournament));
    }
    if (canStartNewSeason(tournament)) {
      actions.push(actionFor("planning", "Preparar una temporada", tournament));
    }
    if (tournament.sourceUrl && tournament.importCoverage !== "complete"
      && (statistics.pending > 0 || statistics.incomplete > 0)) {
      actions.push(actionFor("import-calendar", "Revisar o importar calendario", tournament));
    }
    if (alerts.some(({ type }) => type === "regulations-review")) {
      actions.push(actionFor("alerts", "Revisar reglamento", tournament));
    }
  }

  datedFixtures.sort((first, second) =>
    first.date!.localeCompare(second.date!)
    || first.tournament.name.localeCompare(second.tournament.name, "es")
    || first.matchday.number - second.matchday.number,
  );
  const universe = library.universes.find(({ id }) => id === library.activeUniverseId);
  return {
    universeName: universe?.name ?? "Biblioteca anterior · sin asignar",
    ...(universe?.description ? { description: universe.description } : {}),
    competitions,
    counts: {
      competitions: groups.length,
      seasons: tournaments.length,
      inProgress: groups.filter(({ seasons }) => seasons.some(({ id }) =>
        competitionById.get(id)?.status === "En curso")).length,
      completed: groups.filter(({ seasons }) => seasons.length > 0
        && seasons.every(({ id }) => competitionById.get(id)?.status === "Finalizado")).length,
      prepared: competitions.filter(({ prepared }) => prepared).length,
      configurationPending: groups.filter(({ seasons }) => seasons.some(({ id }) =>
        competitionById.get(id)?.configurationPending)).length,
    },
    datedFixtures,
    undatedFixtures,
    recentActivity: [...scopedActivity]
      .sort((first, second) => second.occurredAt.localeCompare(first.occurredAt))
      .slice(0, 8),
    actions,
  };
}

function hasMixedCalendarProvenance(tournament: Tournament): boolean {
  const origins = new Set(tournament.matchdays.flatMap(({ fixtures }) =>
    fixtures.map(({ calendarProvenance }) => calendarProvenance)
      .filter((origin): origin is NonNullable<typeof origin> => origin !== undefined)));
  return origins.has("official-import") && (origins.has("local-generated") || origins.has("manual"))
    || origins.has("local-generated") && origins.has("manual");
}

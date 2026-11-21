import {ClubAssociationsAccess} from "./club-associations-access";
import {SportsDecisionsAccess} from "./sports-decisions-access";
import {DrawCenterAccess} from "./draw-center-access";
import {HistoricalArchiveAccess} from "./historical-archive-access";
import { SeasonClosureAccess } from "./season-closure-access";
import { SeasonSimulationAccess } from "./season-simulation-access";
import {SeasonProgressionPanel} from "./season-progression-panel";
import {SaveRecoveryAccess} from "./save-recovery-access";
import {SeasonPlanningAccess} from "./season-planning-access";
import type {SeasonPlanningActions} from "@cancha/core/application/use-cases/plan-season";
import {ClubPerformanceAccess} from "./club-performance-access";
import {HeadToHeadAccess} from "./head-to-head-access";
import {HistoricalRecordsAccess} from "./historical-records-access";
import { ClubHistoryAccess } from "./club-history-access";
import { ContinentalQualificationAccess } from "./continental-qualification-access";
import type { ContinentalPreparationInput, ContinentalReview } from "@cancha/core/application/use-cases/prepare-continental-edition";
import { lazy, useEffect, useMemo, useState } from "react";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import type { ActivityEvent } from "@cancha/core/domain/entities/activity-event";
import { groupCompetitions, seasonOverview, seasonOrigins, competitionIdentity, recordedSeasonMovements } from "@cancha/core/application/services/competition-center";
import { getDivisionTransition } from "@cancha/core/domain/services/division-season-transition";
import { useSessionDraft } from "../session-drafts";
import { SportsUniverseControls } from "./sports-universe-controls";
import type { SportsUniverseLibrary } from "@cancha/core/domain/entities/sports-universe";
import { emptySportsUniverseLibrary } from "@cancha/core/application/services/sports-universes";
import { SportsUniverseDashboard } from "./sports-universe-dashboard";
import type { CalendarProgrammingProposal } from "@cancha/core/application/use-cases/program-season-calendar";
import { DeferredPanel } from "./deferred-panel";
const CalendarProgrammingPanel = lazy(() => import("./calendar-programming-center").then((module) => ({ default: module.CalendarProgrammingCenter })));

interface Props extends SeasonPlanningActions {
  onReviewContinental?: (input: ContinentalPreparationInput) => ContinentalReview;
  onConfirmContinental?: (review: ContinentalReview) => Tournament;
  tournaments: readonly Tournament[];
  allTournaments?: readonly Tournament[];
  allActivity?: readonly ActivityEvent[];
  universeLibrary?: SportsUniverseLibrary;
  onSelectUniverse?: (id: string | null) => void;
  centerRequest?: {
    readonly kind: "planning" | "qualification" | "programming";
    readonly tournamentId?: string;
    readonly request: number;
  };
  onImportCalendar?: (tournament: Tournament) => void;
  onConfirmCalendarProgramming?: (proposal: CalendarProgrammingProposal, tournament: Tournament) => Tournament | Promise<Tournament>;
  activity: readonly ActivityEvent[];
  onOpen: (t: Tournament) => void;
  onCalendar: (t: Tournament) => void;
  onAlerts: (t: Tournament) => void;
}
export function CompetitionCenter({ tournaments, allTournaments = tournaments,
  universeLibrary = emptySportsUniverseLibrary(), onSelectUniverse = () => {},
  centerRequest, onImportCalendar, onConfirmCalendarProgramming,
  activity, allActivity = activity, onOpen, onCalendar, onAlerts, onReviewContinental, onConfirmContinental,
  onReviewPlanning,onConfirmPlanning,onRegisterCupRegulation }: Props) {
  const groups = useMemo(() => groupCompetitions(tournaments), [tournaments]);
  const scopeKey = universeLibrary.activeUniverseId ?? "unassigned";
  const [territory, setTerritory] = useSessionDraft(`competition-center:${scopeKey}:territory`, "");
  const [selected, setSelected] = useSessionDraft(`competition-center:${scopeKey}:selection`, "");
  const [dashboardOpen, setDashboardOpen] = useSessionDraft(`universe-dashboard:center:${scopeKey}`, false);
  const [planningRequest, setPlanningRequest] = useState(0);
  const [qualificationRequest, setQualificationRequest] = useState(0);
  const [qualificationTarget, setQualificationTarget] = useState("");
  const [programmingOpen, setProgrammingOpen] = useState(false);
  const [programmingTargetId, setProgrammingTargetId] = useState<string>();
  const openCalendarProgramming = (target?: Tournament) => {
    setProgrammingTargetId(target?.id);
    setProgrammingOpen(true);
  };
  const group = groups.find(g => g.id === selected && (!territory || g.territory === territory));
  function openPlanning() {
    setPlanningRequest((request) => request + 1);
  }
  function openQualification(tournament: Tournament) {
    const targetGroup = groups.find(({ seasons }) => seasons.some(({ id }) => id === tournament.id));
    if (!targetGroup) return;
    setTerritory(targetGroup.territory);
    setSelected(targetGroup.id);
    setQualificationTarget(tournament.id);
    setQualificationRequest((request) => request + 1);
  }
  useEffect(() => {
    if (!centerRequest) return;
    if (centerRequest.kind === "planning") {
      setPlanningRequest(centerRequest.request);
      return;
    }
    if (centerRequest.kind === "programming") {
      setProgrammingTargetId(centerRequest.tournamentId);
      setProgrammingOpen(true);
      return;
    }
    const target = tournaments.find(({ id }) => id === centerRequest.tournamentId);
    if (target) {
      const targetGroup = groups.find(({ seasons }) =>
        seasons.some(({ id }) => id === target.id));
      if (targetGroup) {
        setTerritory(targetGroup.territory);
        setSelected(targetGroup.id);
        setQualificationTarget(target.id);
        setQualificationRequest(centerRequest.request);
      }
    }
  }, [centerRequest, groups, setSelected, setTerritory, tournaments]);
  return <section className="competition-center" aria-label="Centro de competiciones y temporadas">
    <h3>Centro de competiciones y temporadas</h3>
    <SportsUniverseControls library={universeLibrary} tournaments={tournaments} allTournaments={allTournaments} onSelect={onSelectUniverse}/>
    <p>Consulta los mismos torneos de la biblioteca, incluidos los archivados. Los resultados locales no certifican una continuidad oficial.</p>
    <button className="small-action" type="button" aria-expanded={dashboardOpen} onClick={() => setDashboardOpen(!dashboardOpen)}>
      Panel principal del universo
    </button>
    {dashboardOpen && <SportsUniverseDashboard
      tournaments={allTournaments}
      activity={allActivity}
      universeLibrary={universeLibrary}
      onOpen={onOpen}
      onCalendar={onCalendar}
      onAlerts={onAlerts}
      onPlanning={openPlanning}
      onQualification={openQualification}
      onImportCalendar={onImportCalendar}
      onProgramCalendar={openCalendarProgramming}
    />}
    <button type="button" className="small-action" aria-expanded={programmingOpen}
      onClick={() => openCalendarProgramming()}>
      Centro de programación de calendarios
    </button>
    {programmingOpen && onConfirmCalendarProgramming && <DeferredPanel fallback={<p role="status">Cargando programación…</p>}><CalendarProgrammingPanel
      tournaments={tournaments}
      universeId={universeLibrary.activeUniverseId}
      initialTournamentId={programmingTargetId}
      onConfirm={onConfirmCalendarProgramming}
      onOpenCalendar={(tournament) => onCalendar(tournament)}
      onBack={() => setProgrammingOpen(false)}
    /></DeferredPanel>}
    <SeasonPlanningAccess universeId={universeLibrary.activeUniverseId} openRequest={planningRequest} contextKey={`season-planning:${scopeKey}`} onProgramCalendar={openCalendarProgramming} onRegisterCupRegulation={onRegisterCupRegulation} tournaments={tournaments} activity={activity} onOpen={onOpen} onCalendar={onCalendar} onAlerts={onAlerts} onReviewPlanning={onReviewPlanning} onConfirmPlanning={onConfirmPlanning} onReviewContinental={onReviewContinental} onConfirmContinental={onConfirmContinental}/>
    <SeasonSimulationAccess /><DrawCenterAccess /><SportsDecisionsAccess /><SeasonClosureAccess />
    <SaveRecoveryAccess label="Abrir puntos de control y respaldos" />
    <SeasonProgressionPanel universeId={universeLibrary.activeUniverseId} key={scopeKey} contextKey={`progression:${scopeKey}`} tournaments={tournaments} activity={activity} onOpen={onOpen} onCalendar={onCalendar} onAlerts={onAlerts} onReviewPlanning={onReviewPlanning} onConfirmPlanning={onConfirmPlanning} onRegisterCupRegulation={onRegisterCupRegulation} onReviewContinental={onReviewContinental} onConfirmContinental={onConfirmContinental}/>
    <HistoricalArchiveAccess />
    <ClubAssociationsAccess tournament={tournaments[0]}/><ClubHistoryAccess contextKey={`club-history:${scopeKey}`} tournaments={tournaments} activity={activity} onOpen={onOpen}/>
    <ClubPerformanceAccess tournaments={tournaments} activity={activity} onOpen={onOpen} contextKey={`performance:${scopeKey}:center`} label="Centro"/>
    <HeadToHeadAccess tournaments={tournaments} activity={activity} onOpen={onOpen} contextKey={`h2h:${scopeKey}:center`} label="Centro"/>
    <HistoricalRecordsAccess contextKey={`records:${scopeKey}`} tournaments={tournaments} activity={activity} onOpen={onOpen}/>
    <div className="competition-controls">
      <label>País o confederación<select value={territory} onChange={e => { setTerritory(e.target.value); setSelected(""); }}>
        <option value="">Todos</option>{[...new Set(groups.map(g => g.territory))].map(value => <option key={value}>{value}</option>)}
      </select></label>
      <label>Competición guardada<select value={group?.id ?? ""} onChange={e => setSelected(e.target.value)}>
        <option value="">Selecciona una competición</option>{groups.filter(g => !territory || g.territory === territory).map(g =>
          <option key={g.id} value={g.id}>{g.territory} · {g.name} · {g.category} ({g.seasons.length})</option>)}
      </select></label>
    </div>
    {group && <><h4>{group.name} · {group.category}</h4><p>Identificador: {group.id}</p>
      <div className="competition-season-list">{group.seasons.map(t => {
        const overview = seasonOverview(t, activity);
        const origins = seasonOrigins(t, activity);
        const sources = origins.map(id => tournaments.find(item => item.id === id));
        const upper = sources.find(item => item && ["arg-liga-profesional", "brasileirao-serie-a"].includes(competitionIdentity(item)));
        const lower = sources.find(item => item && ["arg-primera-nacional", "brasileirao-serie-b"].includes(competitionIdentity(item)));
        const recorded = recordedSeasonMovements(t, activity);
        const transition = upper && lower ? getDivisionTransition(upper, lower, tournaments) : undefined;
        const names = (source: Tournament, ids: readonly string[]) => ids.map(id => source.teams.find(team => team.id === id)?.name ?? id).join(", ") || "Sin movimientos determinados";
        return <article key={t.id} className="competition-season" aria-label={`Temporada ${t.season ?? "sin año"}: ${t.name}`}>
          <h4>{t.season ?? "Año no registrado"} · {t.name}</h4>
          <p>{overview.provenance}{t.archived ? " · Archivada" : ""}</p>
          <p>{t.teams.length} participantes · Estado: {overview.status}</p>
          <p>Partidos válidos: {overview.played}/{overview.total} programados · Cobertura: {t.importCoverage ?? "no registrada"}</p>
          <p>Reglamento — {overview.rules}</p>
          <p>Procedencia: {t.sourceName ?? "sin proveedor registrado"}{t.sourceUrl ? ` · ${t.sourceUrl}` : ""}</p>
          <p>La cobertura del calendario no acredita resultados oficiales. El historial disponible puede ser incompleto.</p>
          {overview.pending.length > 0 && <details><summary>Clasificaciones o verificaciones pendientes ({overview.pending.length})</summary><ul>{overview.pending.map(p => <li key={p}>{p}</li>)}</ul></details>}
          {tournaments.filter(next => seasonOrigins(next, activity).includes(t.id)).map(next => <p key={next.id}>Temporada derivada: <button className="small-action" type="button" onClick={() => onOpen(next)}>{next.name} · {next.season ?? "sin año"} · escenario local</button></p>)}
          {origins.length > 0 && <details><summary>Origen y relaciones registradas</summary>
            <p>Temporada preparada: {t.season ?? "sin año"} · escenario local, no continuidad oficial confirmada.</p>
            <ul>{origins.map((id,i) => <li key={id}>{sources[i] ? <button className="small-action" type="button" onClick={() => onOpen(sources[i]!)}>{sources[i]!.name} · {sources[i]!.season ?? "sin año"}</button> : `Origen no disponible: ${id}`}</li>)}</ul>
            {recorded && upper && lower && <><p>Movimientos registrados al preparar · {recorded.at}</p>
              <p>Ascensos registrados: {names(lower, recorded.promoted)}</p>
              <p>Descensos registrados de Primera: {names(upper, recorded.upperRelegated)}</p>
              <p>Descensos registrados de Segunda: {names(lower, recorded.lowerRelegated)}</p></>}
            {transition && upper && lower && <><p>Situación actual de las temporadas de origen (puede diferir de la preparación histórica):</p>
              <p>Ascensos: {names(lower, transition.promoted)}</p><p>Descensos de Primera: {names(upper, transition.upperRelegated)}</p>
              <p>Descensos de Segunda: {names(lower, transition.lowerRelegated)}</p>
              {transition.pending.map(p => <p key={p}>{p}</p>)}</>}
          </details>}
          {t.seasonPreparation?.calendarReviews.map((review,i) => <details key={i}><summary>Revisión de participantes · {review.at}</summary>
            <p>Fuente: {review.sourceUrl}</p><p>Previstos ausentes: {review.missing.join(", ") || "ninguno"}</p>
            <p>Publicados adicionales: {review.added.join(", ") || "ninguno"}</p><p>{review.discrepancyReason ?? "Sin discrepancias registradas"}</p>
          </details>)}
          <ContinentalQualificationAccess key={`${t.id}:${qualificationTarget === t.id ? qualificationRequest : 0}`} openRequest={qualificationTarget === t.id ? qualificationRequest : 0} tournament={t} tournaments={tournaments} activity={activity} onOpen={onOpen} onReview={onReviewContinental} onConfirm={onConfirmContinental}/>
          <div className="library-file-actions"><button className="small-action" type="button" onClick={() => onOpen(t)}>Abrir temporada</button>
            <button className="small-action" type="button" onClick={() => onCalendar(t)}>Consultar calendario</button>
            <button className="small-action" type="button" onClick={() => onAlerts(t)}>Revisar pendientes</button></div>
        </article>;
      })}</div></>}
  </section>;
}

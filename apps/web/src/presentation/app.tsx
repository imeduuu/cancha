import {ClubAssociationsNavigation,ClubAssociationsAccess} from "./components/club-associations-access";
import {SportsDecisionsNavigation} from "./components/sports-decisions-access";
import {DrawCenterNavigation} from "./components/draw-center-access";
import { HistoricalArchiveNavigation } from "./components/historical-archive-access";
import { SeasonClosureNavigation } from "./components/season-closure-access";
import { LibraryWriteContext } from "./library-write-context";
import { sportingStorageKeys } from "../infrastructure/persistence/library-write-lock";
import { SaveRecoveryNavigation, type SaveRecoveryRequest } from "./components/save-recovery-access";
import { SaveCheckpoints } from "@cancha/core/application/services/save-checkpoints";
import { IndexedDbSaveCheckpointStore } from "../infrastructure/persistence/indexed-db-save-checkpoint-store";
import { SeasonSimulationNavigation } from "./components/season-simulation-access";
import { SeasonSimulationCenter } from "./components/season-simulation-center";
import {registerNationalCupRegulation} from "@cancha/core/application/use-cases/register-national-cup-regulation";
import {reviewSeasonPlanning,confirmSeasonPlanning} from "@cancha/core/application/use-cases/plan-season";
import {HeadToHeadAccess} from "./components/head-to-head-access";
import {clubOccurrenceKey} from "@cancha/core/application/services/club-history";
import { reviewContinentalEdition, confirmContinentalEdition } from "@cancha/core/application/use-cases/prepare-continental-edition";
import { SessionDraftProvider, useClearSessionDrafts } from "./session-drafts";
import { AccountProvider, useAccount } from "./account-context";
import { AccountAccess } from "./components/account-access";
import { localLibraryNeedsMigration } from "../infrastructure/persistence/local-library-migration";
import { DeferredPanel } from "./components/deferred-panel";
import { publishedSeasonSource } from "../infrastructure/external-services/load-official-league-source";
import { groupCompetitions } from "@cancha/core/application/services/competition-center";
import { lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GoalScorer, Matchday, MatchSchedule, Tournament } from "@cancha/core/domain/entities/tournament";
import type { ActivityEvent } from "@cancha/core/domain/entities/activity-event";
import type { SportsUniverseLibrary } from "@cancha/core/domain/entities/sports-universe";
import {
  activityInUniverse,
  createSportsUniverse,
  createScopedTournamentRepository,
  deleteSportsUniverse,
  setTournamentUniverseAssignments,
  tournamentsInUniverse,
  renameSportsUniverse,
} from "@cancha/core/application/services/sports-universes";
import type { MatchResult } from "@cancha/core/domain/entities/tournament";
import type { OperationalMatchStatus } from "@cancha/core/domain/entities/tournament";
import { calculateStandings, getUnresolvedStandingsTieDetails } from "@cancha/core/domain/services/standings";
import { calculateInternationalQualifications } from "@cancha/core/domain/services/international-qualification";
import { calculateRelegationAverages } from "@cancha/core/domain/services/relegation-averages";
import { isValidFixtureResult } from "@cancha/core/domain/services/match-result-validation";
import { persistTournamentProgress } from "@cancha/core/application/use-cases/persist-tournament-progress";
import { simulateFixtures, type SimulationMode } from "@cancha/core/application/use-cases/simulate-fixtures";
import { simulateArgentinaHalf, type ArgentinaTournamentHalf } from "@cancha/core/application/use-cases/simulate-argentina-half";
import { simulateChampionship } from "@cancha/core/application/use-cases/simulate-championship";
import { canGenerateSeasonCalendar, generateSeasonCalendar } from "@cancha/core/application/use-cases/generate-season-calendar";
import { isChileanAscenso } from "@cancha/core/domain/services/chilean-ascenso-playoff-progression";
import { updateMatchResult } from "@cancha/core/application/use-cases/update-match-result";
import { updateMatchGoalScorers } from "@cancha/core/application/use-cases/update-match-goal-scorers";
import { updateFixtureDetails } from "@cancha/core/application/use-cases/update-fixture-details";
import { updateFixtureSchedule } from "@cancha/core/application/use-cases/update-fixture-schedule";
import { updateFixtureOperationalState } from "@cancha/core/application/use-cases/update-fixture-operational-state";
import type { CalendarProgrammingProposal } from "@cancha/core/application/use-cases/program-season-calendar";
import { updateTournamentRegulations, updateTournamentRoster } from "@cancha/core/application/use-cases/update-tournament-records";
import { recordRejectedImport } from "@cancha/core/application/services/activity-log";
import { getOperationalStatusLabel } from "@cancha/core/domain/services/match-operational-status";
import type { FixtureDetailsUpdate } from "@cancha/core/domain/services/match-details";
import { createTournamentSeason } from "@cancha/core/application/use-cases/create-tournament-season";
import { setTournamentArchived } from "@cancha/core/application/use-cases/set-tournament-archived";
import {
  duplicateTournament,
  renameTournament,
  type DuplicateResultsMode,
} from "@cancha/core/application/use-cases/manage-tournaments";
import { importTournamentArchive } from "@cancha/core/application/use-cases/import-tournament-archive";
import { LocalStorageTournamentRepository } from "../infrastructure/persistence/local-storage-tournament-repository";
import type { LibraryBackend } from "../infrastructure/persistence/library-backend";
import type { CheckpointService } from "../infrastructure/persistence/checkpoint-service";
import { StandingsTable } from "./components/standings-table";
import { SimulationScopeDialog } from "./components/simulation-scope-dialog";
import { SetupTournamentForm } from "./components/setup-tournament-form";
import { TournamentLibrary } from "./components/tournament-library";
import { CompetitionAlertCenter } from "./components/competition-alert-center";
import { ActivityHistory } from "./components/activity-history";
import type {
  BackupRestoreMode,
  TournamentImportMode,
} from "./components/tournament-library";

function getTournamentPhases(matchdays: readonly Matchday[]) {
  const phases = new Map<number, string>();
  for (const matchday of matchdays) {
    if (matchday.phaseName) {
      phases.set(matchday.leg, matchday.phaseName);
    }
  }
  return [...phases].map(([leg, name]) => ({ leg, name }));
}

function getInitialTournamentLeg(tournament: Tournament): number {
  const pendingMatchday = tournament.matchdays.find(
    (matchday) => matchday.fixtures.some((fixture) =>
      !isValidFixtureResult(tournament, matchday, fixture)),
  );
  const lastMatchday = tournament.matchdays[tournament.matchdays.length - 1];
  return pendingMatchday?.leg ?? lastMatchday?.leg ?? 1;
}

import { secondDivisionKind } from "@cancha/core/domain/services/second-division-rules";

const SeasonPreparationPanel = lazy(() => import("./components/season-preparation-panel").then(module => ({ default: module.SeasonPreparationPanel })));
const ChampionCards = lazy(() => import("./components/champion-card").then(module => ({ default: module.ChampionCards })));
const TournamentStatisticsPanel = lazy(() => import("./components/tournament-statistics-panel").then(module => ({ default: module.TournamentStatisticsPanel })));
const FixtureList = lazy(() => import("./components/fixture-list").then(module => ({ default: module.FixtureList })));
const ImportOfficialTournament = lazy(() => import("./components/import-official-tournament").then(module => ({ default: module.ImportOfficialTournament })));
const MatchCalendar = lazy(() => import("./components/match-calendar").then(module => ({ default: module.MatchCalendar })));
const CalendarProgrammingCenter = lazy(() => import("./components/calendar-programming-center").then(module => ({ default: module.CalendarProgrammingCenter })));
const AccountMigration = lazy(() => import("./components/account-migration").then(module => ({ default: module.AccountMigration })));
const SecondDivisionPanel = lazy(() => import("./components/second-division-panel").then(module => ({ default: module.SecondDivisionPanel })));

export interface AppProps {
  /**
   * Biblioteca que usa la aplicación durante toda su vida (para cambiarla, vuelve a
   * montar con otra `key`). Sin indicarla: localStorage, el modo sin sesión.
   */
  readonly libraryBackend?: LibraryBackend;
}

export function App({ libraryBackend }: AppProps = {}) {
  return <AccountProvider><LibraryHost libraryBackend={libraryBackend} /></AccountProvider>;
}

type SessionLibrary =
  | { readonly userId: string; readonly backend: LibraryBackend & { dispose(): void } }
  | { readonly userId: string; readonly error: string };

async function loadSessionLibrary(account: NonNullable<ReturnType<typeof useAccount>>, userId: string) {
  const [{ SessionLibraryBackend }, session] = await Promise.all([
    import("../infrastructure/api/session-library-backend"),
    account.session(),
  ]);
  return SessionLibraryBackend.load(session, userId);
}

/**
 * Elige la biblioteca (fase 5G): sin sesión, la de este navegador (localStorage), tal
 * como antes; con sesión, la réplica de la biblioteca de la cuenta. Cada una se monta
 * con su propia `key`, así que los borradores de sesión no pasan de una a otra.
 */
function LibraryHost({ libraryBackend }: AppProps) {
  const account = useAccount();
  const userId = account?.status === "signed-in" ? account.user?.id ?? null : null;
  const [remote, setRemote] = useState<SessionLibrary | null>(null);
  const [attempt, setAttempt] = useState(0);
  /** Usuario para el que ya se resolvió (o se pospuso) la migración en este ingreso. */
  const [migrationHandledFor, setMigrationHandledFor] = useState<string | null>(null);
  const accountRef = useRef(account);
  accountRef.current = account;

  useEffect(() => {
    const current = accountRef.current;
    if (!userId || !current) { setRemote(null); setMigrationHandledFor(null); return; }
    let active = true;
    let loaded: (LibraryBackend & { dispose(): void }) | null = null;
    setRemote(null);
    loadSessionLibrary(current, userId).then(
      backend => {
        if (!active) { backend.dispose(); return; }
        loaded = backend;
        setRemote({ userId, backend });
      },
      (error: unknown) => {
        if (active) setRemote({ userId, error: error instanceof Error ? error.message : "Error desconocido." });
      },
    );
    return () => { active = false; loaded?.dispose(); };
  }, [userId, attempt]);

  if (account?.status === "restoring") return <SessionShell><p role="status">Recuperando tu sesión…</p></SessionShell>;
  if (!userId) {
    return <SessionDraftProvider key="local"><Application key="local" libraryBackend={libraryBackend} /></SessionDraftProvider>;
  }
  if (!remote || remote.userId !== userId) return <SessionShell><p role="status">Cargando la biblioteca de tu cuenta…</p></SessionShell>;
  if ("error" in remote) {
    return <SessionShell>
      <div role="alert">
        <p>No se pudo cargar la biblioteca de tu cuenta. {remote.error}</p>
        <p>Puedes reintentar o cerrar sesión desde Cuenta para usar la biblioteca de este navegador.</p>
      </div>
      <button type="button" onClick={() => setAttempt(value => value + 1)}>Reintentar</button>
    </SessionShell>;
  }
  if (migrationHandledFor !== userId && localLibraryNeedsMigration(userId)) {
    return <SessionShell>
      <DeferredPanel fallback={<p role="status">Cargando…</p>}>
        <AccountMigration userId={userId} backend={remote.backend} onDone={() => setMigrationHandledFor(userId)} />
      </DeferredPanel>
    </SessionShell>;
  }
  return <SessionDraftProvider key={`session:${userId}`}>
    <Application key={`session:${userId}`} libraryBackend={remote.backend} />
  </SessionDraftProvider>;
}

/** Cabecera mínima mientras se recupera la sesión o se carga la biblioteca de la cuenta. */
function SessionShell({ children }: { readonly children: ReactNode }) {
  return <main className="page-shell" aria-busy="true">
    <header className="topbar">
      <a className="brand" href="/" aria-label="Cancha, inicio">
        <span className="brand-mark">C</span>
        <span>cancha<span className="brand-period">.</span></span>
      </a>
      <div className="topbar-actions"><AccountAccess /></div>
    </header>
    <section className="session-shell">{children}</section>
  </main>;
}

const SportsDecisionsCenter = lazy(()=>import("./components/sports-decisions-center").then(m=>({default:m.SportsDecisionsCenter})));
const DrawAndBracketCenter = lazy(()=>import("./components/draw-and-bracket-center").then(m=>({default:m.DrawAndBracketCenter})));
const HistoricalArchive = lazy(() => import("./components/historical-archive").then(module => ({default: module.HistoricalArchive})));
const SeasonClosureCenter = lazy(() => import("./components/season-closure-center").then(module => ({default: module.SeasonClosureCenter})));

function Application({ libraryBackend }: AppProps) {
  const [repository] = useState<LibraryBackend>(() => libraryBackend ?? new LocalStorageTournamentRepository(true));
  const [initialSnapshot] = useState(() => { try { return repository.snapshot(); } catch { return null; } });
  const acknowledgedLibrary = useRef(initialSnapshot);
  const writing = useRef(false);
  const [externalChange, setExternalChange] = useState(false);
  const runWrite = useCallback(async function runWrite<T>(action: () => T): Promise<T> {
    if (writing.current) { setFeedback("Ya hay una escritura en curso. Espera a que termine."); throw new Error("Ya hay una escritura en curso. Espera a que termine."); }
    writing.current = true;
    const expected = acknowledgedLibrary.current;
    if (expected === null) { writing.current = false; throw new Error("No se pudo leer el almacenamiento. Descarga los datos de recuperación antes de editar."); }
    try {
      const committed = await repository.coordinate(expected, () => {
        const result = action();
        if (result instanceof Promise) { void result.catch(() => {}); throw new Error("La escritura debe finalizar dentro del bloqueo."); }
        return {result, snapshot: repository.snapshot()};
      });
      acknowledgedLibrary.current = committed.snapshot;
      return committed.result;
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No se pudo guardar.");
      setPersistenceStatus("error");
      try { setExternalChange(repository.snapshot() !== acknowledgedLibrary.current); }
      catch { setExternalChange(true); }
      throw error;
    } finally { writing.current = false; }
  }, [repository]);
  useEffect(() => repository.subscribeExternalChanges?.(() => {
    try { setExternalChange(repository.snapshot() !== acknowledgedLibrary.current); }
    catch { setExternalChange(true); }
  }), [repository]);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === null || sportingStorageKeys.some(key => key === event.key)) {
        try { setExternalChange(repository.snapshot() !== acknowledgedLibrary.current); }
        catch { setExternalChange(true); }
      }
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [repository]);
  function refreshExternalLibrary() {
    // Keep the current editor and its drafts mounted. Refresh the read models only;
    // continuing a stale editor still requires reopening it from the library.
    try {
      setSavedTournaments(repository.findAll());
      setActivityEvents(repository.findActivity());
      setExternalChange(true);
      setFeedback("Biblioteca actualizada. Tus borradores siguen abiertos. Para editar con los datos actuales, vuelve a abrir la competición desde la Biblioteca.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No se pudo actualizar la biblioteca.");
    }
  }
  function reopenExternalLibrary() {
    if (!window.confirm("Se cerrarán los formularios y revisiones abiertos. Los borradores de sesión se conservarán; al abrir un partido modificado se usarán sus datos guardados actuales. ¿Continuar?")) return;
    showCurrentLibrary();
  }
  /** Vuelve a la biblioteca guardada actual, cerrando formularios y revisiones (los borradores se conservan). */
  function showCurrentLibrary() {
    try {
      const snapshot = repository.snapshot();
      const current = repository.findAll(), universes = repository.getSportsUniverseLibrary();
      const activity = repository.findActivity();
      if (repository.snapshot() !== snapshot) throw new Error("La biblioteca volvió a cambiar. Revisa nuevamente.");
      acknowledgedLibrary.current = snapshot;
      setSavedTournaments(current);setUniverseLibrary(universes);setActivityEvents(activity);
      setScreen("library");setTournament(null);setSimulationCenterOpen(false);setSaveOrigin(null);setDecisionsOpen(false);setDrawOpen(false);setArchiveOpen(false);setClosureOpen(false);
      setLibraryRevision(value => value + 1);setExternalChange(false);setFeedback("");
    } catch (error) { setFeedback(error instanceof Error ? error.message : "No se pudo abrir la biblioteca actual."); }
  }
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const activeCompetition = tournament ? groupCompetitions([tournament])[0] : null;
  const [savedTournaments, setSavedTournaments] = useState<readonly Tournament[]>([]);
  const [screen, setScreen] = useState<"library" | "setup" | "tournament">("library");
  const clearSessionDrafts = useClearSessionDrafts();
  const [libraryRevision, setLibraryRevision] = useState(0);
  const [saveRecoveryRequest, setSaveRecoveryRequest] = useState<SaveRecoveryRequest | null>(null);
  const saveRequestCounter = useRef(0);
  const [saveOrigin, setSaveOrigin] = useState<{screen: typeof screen; universeId: string | null; trigger: HTMLElement | null} | null>(null);
  const showCurrentLibraryRef = useRef(showCurrentLibrary);
  showCurrentLibraryRef.current = showCurrentLibrary;
  const handleRestoreBackupRef = useRef(handleRestoreBackup);
  handleRestoreBackupRef.current = handleRestoreBackup;
  const checkpointService = useMemo<CheckpointService>(() => repository.createCheckpointService?.(() => {
      showCurrentLibraryRef.current();
      setFeedback("Biblioteca restaurada desde el punto de guardado de tu cuenta.");
    })
    ?? new SaveCheckpoints(new IndexedDbSaveCheckpointStore(), () => {
    const report = repository.findAllWithRecoveryReport();
    if (report.warnings.length) throw new Error(`No se puede proteger una biblioteca incompleta: ${report.warnings.join(" ")}`);
    return {tournaments: report.tournaments, activity: repository.findActivity(), universes: repository.getSportsUniverseLibrary()};
  }, (parsed, lease) => {
    const committed = repository.commitUnderLibraryLock(repository.snapshot(), () => {
      const result = handleRestoreBackupRef.current(parsed.tournaments, "replace", parsed.activity, parsed.universes);
      return {result, snapshot: repository.snapshot()};
    }, lease);
    acknowledgedLibrary.current = committed.snapshot;
    return committed.result;
  }), [repository]);
  const [h2hFocus,setH2HFocus]=useState<{a:string;b:string}|null>(null);
  const [simulationTargetId, setSimulationTargetId] = useState<string>();
  const [simulationCenterOpen, setSimulationCenterOpen] = useState(false);
  const [decisionsOpen,setDecisionsOpen]=useState(false);
  const [decisionsTargetId,setDecisionsTargetId]=useState<string>();
  const [drawOpen,setDrawOpen]=useState(false);
  const [drawTargetId,setDrawTargetId]=useState<string>();
  const [affiliationRequest,setAffiliationRequest]=useState<{teamId?:string;request:number}>();
  const affiliationRequestSerial=useRef(0);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [closureOpen, setClosureOpen] = useState(false);
  const [closureTargetId, setClosureTargetId] = useState<string>();
  const [closurePlanningRequest, setClosurePlanningRequest] = useState<{request: number; tournamentId: string; kind?: "planning" | "qualification" | "competitions"}>();
  const closureRequestCounter = useRef(0);
  const closureTrigger = useRef<HTMLElement | null>(null);
  function openDecisions(target?:Tournament){setDecisionsTargetId(target?.id);setDecisionsOpen(true);setDrawOpen(false);setArchiveOpen(false);setClosureOpen(false);setSimulationCenterOpen(false);setH2HFocus(null);setActivityFocus(null);}
  function openDraws(target?:Tournament){setAffiliationRequest(undefined);setDecisionsOpen(false);setDrawTargetId(target?.id);setDrawOpen(true);setArchiveOpen(false);setClosureOpen(false);setSimulationCenterOpen(false);setH2HFocus(null);setActivityFocus(null);}
  function openArchive() {
    setDecisionsOpen(false);setDrawOpen(false);
    setArchiveOpen(true);setClosureOpen(false);setSimulationCenterOpen(false);setH2HFocus(null);setActivityFocus(null);
  }
  function archiveFlow(kind: "planning" | "qualification" | "competitions", target?: Tournament) {
    setDecisionsOpen(false);setDrawOpen(false);setArchiveOpen(false);setScreen("library");closureRequestCounter.current += 1;
    setClosurePlanningRequest({request:closureRequestCounter.current,tournamentId:target?.id ?? "",kind});
  }
  function openClosure(target?: Tournament) {
    setDecisionsOpen(false);setDrawOpen(false);setArchiveOpen(false);
    const active = document.activeElement;
    closureTrigger.current = active instanceof HTMLElement && active.matches("button, a[href], input, select, textarea, [tabindex]") ? active : null;
    setClosureTargetId(target?.id);setClosureOpen(true);setSimulationCenterOpen(false);setH2HFocus(null);setActivityFocus(null);
  }
  function closeClosure() {
    setDecisionsOpen(false);setDrawOpen(false);setArchiveOpen(false);setClosureOpen(false);
    requestAnimationFrame(() => {
      if (closureTrigger.current?.isConnected) closureTrigger.current.focus();
      else document.getElementById("open-season-closure")?.focus();
    });
  }
  function closurePlanning(target: Tournament) {
    setDecisionsOpen(false);setDrawOpen(false);setArchiveOpen(false);setClosureOpen(false);setScreen("library");closureRequestCounter.current += 1;
    setClosurePlanningRequest({request: closureRequestCounter.current, tournamentId: target.id});
    setFeedback(`Planificación abierta desde ${target.name}. Selecciona expresamente el origen y la edición de destino; sus validaciones se mantienen.`);
  }
  const [calendarView, setCalendarView] = useState(false);
  const [programmingView, setProgrammingView] = useState(false);
  const [programmingReturnToCalendar, setProgrammingReturnToCalendar] = useState(false);
  const [alertsView, setAlertsView] = useState(false);
  const [activityFocus, setActivityFocus] = useState<{
    tournamentId?: string;
    fixtureId?: string;
  } | null>(null);
  const [calendarInitialized, setCalendarInitialized] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [simulationMode, setSimulationMode] = useState<SimulationMode>("pendingOnly");
  const [selectedLeg, setSelectedLeg] = useState(1);
  const [argentinaTableView, setArgentinaTableView] = useState("zona-a");
  const [feedback, setFeedback] = useState("");
  const [loadError, setLoadError] = useState("");
  const [recoveryWarning, setRecoveryWarning] = useState("");
  const [pendingScrollFixtureId, setPendingScrollFixtureId] = useState<string | null>(null);
  const [pendingFocusTargetId, setPendingFocusTargetId] = useState<string | null>(null);
  const [simulationScopeHalf, setSimulationScopeHalf] = useState<ArgentinaTournamentHalf | null>(null);
  const [activityEvents, setActivityEvents] = useState<readonly ActivityEvent[]>([]);
  const [universeLibrary, setUniverseLibrary] = useState<SportsUniverseLibrary>({
    version: 1,
    activeUniverseId: null,
    universes: [],
    assignments: {},
  });
  const scopedRepository = useMemo(
    () => createScopedTournamentRepository(
      repository,
      universeLibrary.activeUniverseId,
      () => repository.getSportsUniverseLibrary(),
    ),
    [repository, universeLibrary.activeUniverseId],
  );
  const scopedTournaments = useMemo(
    () => tournamentsInUniverse(savedTournaments, universeLibrary),
    [savedTournaments, universeLibrary],
  );
  const scopedTournamentIds = useMemo(
    () => new Set(scopedTournaments.map(({ id }) => id)),
    [scopedTournaments],
  );
  const allTournamentIds = useMemo(
    () => new Set(savedTournaments.map(({ id }) => id)),
    [savedTournaments],
  );
  const scopedActivityEvents = useMemo(
    () => activityInUniverse(
      activityEvents,
      scopedTournamentIds,
      universeLibrary.activeUniverseId,
      allTournamentIds,
    ),
    [activityEvents, scopedTournamentIds, universeLibrary.activeUniverseId, allTournamentIds],
  );
  function refreshSourceActivity() {
    try { setActivityEvents(repository.findActivity?.() ?? []); }
    catch (error) { setLoadError(error instanceof Error ? error.message : "No se pudo leer el historial."); }
  }
  const [recoverySnapshotAvailable, setRecoverySnapshotAvailable] = useState(false);
  const [persistenceStatus, setPersistenceStatus] = useState<"ready" | "saved" | "error">("ready");
  const isCreatingTournament = screen === "setup";
  const phases = useMemo(() => tournament?.format === "staged"
    ? getTournamentPhases(tournament.matchdays)
    : [], [tournament?.format, tournament?.matchdays]);
  const activeLeg = tournament ? Math.min(selectedLeg, tournament.legs) : 1;
  const activePhase = phases.find((phase) => phase.leg === activeLeg);
  const visibleMatchdays = useMemo(() => tournament && activePhase
    ? tournament.matchdays.filter((matchday) => matchday.phaseName === activePhase.name)
    : tournament?.matchdays ?? [], [activePhase, tournament]);
  const secondKind = tournament ? secondDivisionKind(tournament) : undefined;
  const isSecondDivisionPlayoffPhase = Boolean(secondKind && activePhase && activePhase.name !== "Fase regular");
  const isArgentinaTournament = tournament?.id === "arg-liga-profesional-2026";
  const isChileanAscensoTournament = !!tournament && isChileanAscenso(tournament);
  const isChileanAscensoPlayoffPhase = isChileanAscensoTournament
    && Boolean(activePhase?.name.startsWith("Liguilla de Ascenso"));
  const isContinentalTournament = tournament?.id.startsWith("conmebol-") ?? false;
  const isContinentalGroupPhase = isContinentalTournament
    && Boolean(activePhase?.name.includes("Fase de grupos"));
  const isCupKnockoutPhase = tournament?.competitionType === "cup"
    && Boolean(activePhase)
    && !Boolean(activePhase?.name.toLocaleLowerCase("es").includes("grupo"));
  const activeCupStage = tournament?.knockoutStages?.find((stage) =>
    activePhase?.name.toLocaleLowerCase("es").startsWith(stage.name.toLocaleLowerCase("es")),
  );
  const regularSeasonMatchdays = tournament?.matchdays.filter((matchday) =>
    matchday.phaseName?.includes("Fase regular")
    || matchday.phaseName?.includes("Fase de grupos"),
  ) ?? [];
  const selectedTournamentHalf = activePhase?.name.includes("Clausura") ? "Clausura" : "Apertura";
  const selectedArgentinaGroup = argentinaTableView === "zona-b" ? "Zona B" : "Zona A";
  const argentinaStandingsMatchdays = argentinaTableView === "annual"
    ? regularSeasonMatchdays
    : regularSeasonMatchdays.filter((matchday) =>
      matchday.phaseName?.includes(selectedTournamentHalf),
    );
  const argentinaStandingsTeams = argentinaTableView === "annual"
    ? tournament?.teams ?? []
    : tournament?.teams.filter((team) => team.groupName === selectedArgentinaGroup) ?? [];
  const visibleTeamIds = new Set(visibleMatchdays.flatMap((matchday) =>
    matchday.fixtures.flatMap((fixture) => [fixture.homeTeamId, fixture.awayTeamId]),
  ));
  const standingsTournament = isArgentinaTournament && tournament
    ? {
      ...tournament,
      teams: argentinaStandingsTeams,
      matchdays: argentinaStandingsMatchdays,
    }
    : tournament && activePhase
      ? {
        ...tournament,
        teams: tournament.teams.filter((team) => visibleTeamIds.has(team.id)),
        matchdays: visibleMatchdays,
      }
      : tournament;
  const continentalGroupStandings = isContinentalGroupPhase && tournament
    ? [...new Set(tournament.teams
      .map((team) => team.groupName)
      .filter((groupName): groupName is string => Boolean(groupName)))].map((groupName) => {
      const groupTeams = tournament.teams.filter((team) => team.groupName === groupName);
      return {
        groupName,
        standingsTournament: {
          ...tournament,
          teams: groupTeams,
          matchdays: visibleMatchdays,
        },
        standings: calculateStandings({
          ...tournament,
          teams: groupTeams,
          matchdays: visibleMatchdays,
        }),
      };
    })
    : [];
  const standings = standingsTournament ? calculateStandings(standingsTournament) : [];
  const unresolvedStandingTies = standingsTournament
    ? getUnresolvedStandingsTieDetails(standingsTournament, standings)
    : [];
  const internationalQualifications = standingsTournament?.competitionRules?.internationalQualification
    ? calculateInternationalQualifications(
      standings,
      standingsTournament,
      scopedTournaments,
      standingsTournament.competitionRules.internationalQualification,
      standingsTournament.competitionRules.verification.placements,
    )
    : undefined;
  const relegationAverages = standingsTournament?.competitionRules?.relegationAverage
    ? calculateRelegationAverages(
      standingsTournament,
      scopedTournaments,
      standingsTournament.competitionRules.relegationAverage,
    )
    : undefined;
  const nextPendingMatchday = tournament?.matchdays.find((matchday) =>
    matchday.fixtures.some((fixture) => !isValidFixtureResult(tournament, matchday, fixture)),
  );
  const nextPendingFixture = tournament && nextPendingMatchday?.fixtures.find((fixture) =>
    !isValidFixtureResult(tournament, nextPendingMatchday, fixture));

  useEffect(() => {
    async function load() { try {
      const recoveryReport = repository.findAllWithRecoveryReport();
      const savedUniverseLibrary = repository.getSportsUniverseLibrary();
      setUniverseLibrary(savedUniverseLibrary);
      setSavedTournaments(recoveryReport.tournaments);
      setActivityEvents(repository.findActivity?.() ?? []);
      const snapshotStatus = repository.getRecoverySnapshotStatus();
      setRecoverySnapshotAvailable(snapshotStatus.available);
      const recoveryWarnings = [
        ...recoveryReport.warnings,
        ...(snapshotStatus.warning ? [snapshotStatus.warning] : []),
      ];
      if (recoveryWarnings.length > 0) {
        setRecoveryWarning(recoveryWarnings.join(" "));
      }
      const activeId = repository.getActiveTournamentId();
      const inUniverse = tournamentsInUniverse(recoveryReport.tournaments, savedUniverseLibrary);
      const savedTournament = inUniverse.find(({ id }) => id === activeId)
        ?? inUniverse[0];
      if (savedTournament) {
        const loadingScopedRepository = createScopedTournamentRepository(
          repository,
          savedUniverseLibrary.activeUniverseId,
          () => savedUniverseLibrary,
        );
        const preparedTournament = navigator.locks ? await runWrite(() => persistTournamentProgress(savedTournament, loadingScopedRepository)) : savedTournament;
        repository.setActiveTournamentId(preparedTournament.id);
        setTournament(preparedTournament);
        setSavedTournaments(repository.findAll());
        setSelectedLeg(getInitialTournamentLeg(preparedTournament));
        setScreen("tournament");
      } else {
        repository.setActiveTournamentId(null);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "No se pudieron cargar los campeonatos.");
    } finally {
      setLibraryLoading(false);
    } }
    void load();
  }, [repository, runWrite]);

  useEffect(() => {
    if (libraryLoading) return;
    try {
      setActivityEvents(repository.findActivity?.() ?? []);
      const snapshotStatus = repository.getRecoverySnapshotStatus();
      setRecoverySnapshotAvailable(snapshotStatus.available);
      if (snapshotStatus.warning) {
        setRecoveryWarning((current) => current.includes(snapshotStatus.warning!)
          ? current
          : [current, snapshotStatus.warning].filter(Boolean).join(" "));
      }
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "No se pudo leer el historial o la copia de recuperación.";
      setLoadError((current) => current || message);
    }
  }, [libraryLoading, repository, savedTournaments, tournament]);

  useEffect(() => {
    if (!pendingScrollFixtureId) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(
        `${calendarView ? "calendar-fixture" : "fixture"}-${pendingScrollFixtureId}`,
      );
      if (target) {
        target.scrollIntoView?.({ behavior: "smooth", block: "center" });
        target.focus({ preventScroll: true });
      }
      setPendingScrollFixtureId(null);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [calendarView, pendingScrollFixtureId, visibleMatchdays]);

  useEffect(() => {
    if (!pendingFocusTargetId) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(pendingFocusTargetId);
      if (target) {
        if (target instanceof HTMLDetailsElement) target.open = true;
        target.scrollIntoView?.({ behavior: "smooth", block: "center" });
        target.focus({ preventScroll: true });
      }
      setPendingFocusTargetId(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingFocusTargetId, alertsView, calendarView]);

  function handleSimulate(fixtureIds: readonly string[], mode = simulationMode) {
    void runWrite(() => simulateWithinWrite(fixtureIds, mode)).catch(() => {});
  }

  function simulateWithinWrite(fixtureIds: readonly string[], mode = simulationMode) {
    if (!tournament) {
      return;
    }

    try {
      const result = simulateFixtures(tournament, fixtureIds, mode, scopedRepository);
      const advancedTournament = persistTournamentProgress(result.tournament, scopedRepository);
      setTournament(advancedTournament);
      setSavedTournaments(repository.findAll());
      setFeedback(
        result.simulatedCount > 0
          ? `Se simularon ${result.simulatedCount} ${result.simulatedCount === 1 ? "partido" : "partidos"}.`
          : "No había partidos pendientes en esta selección.",
      );
      setPersistenceStatus("saved");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No se pudieron simular los partidos.");
      setPersistenceStatus("error");
    }
  }

  function handleSimulateChampionship() {
    if (!tournament) return;

    try {
      const result = simulateChampionship(tournament, simulationMode, scopedRepository);
      setTournament(result.tournament);
      setSavedTournaments(repository.findAll());
      setFeedback(
        result.simulatedCount > 0
          ? `Se simularon ${result.simulatedCount} ${result.simulatedCount === 1 ? "partido" : "partidos"}.`
          : "No había partidos pendientes en esta selección.",
      );
      setPersistenceStatus("saved");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No se pudo simular el campeonato.");
      setPersistenceStatus("error");
    }
  }

  /** Planned Chilean season without fixtures (created before calendars were generated automatically). */
  function handleGenerateSeasonCalendar() {
    if (!tournament) return;
    try {
      const next = generateSeasonCalendar(tournament.id, scopedRepository);
      setTournament(next);
      setSavedTournaments(repository.findAll());
      setFeedback(`Se generó un calendario local: ${next.matchdays.length} jornadas, sin fechas. No es un fixture oficial.`);
      setPersistenceStatus("saved");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No se pudo generar el calendario.");
      setPersistenceStatus("error");
    }
  }

  function handleSimulateArgentinaHalf(half: ArgentinaTournamentHalf, includePlayoffs: boolean) {
    void runWrite(() => simulateArgentinaHalfWithinWrite(half, includePlayoffs)).catch(() => {});
  }

  function simulateArgentinaHalfWithinWrite(
    half: ArgentinaTournamentHalf,
    includePlayoffs: boolean,
  ) {
    if (!tournament) return;

    try {
      const result = simulateArgentinaHalf(
        tournament,
        half,
        includePlayoffs,
        simulationMode,
        scopedRepository,
      );
      setTournament(result.tournament);
      setSavedTournaments(repository.findAll());
      const halfPhases = getTournamentPhases(result.tournament.matchdays)
        .filter((phase) => phase.name.startsWith(`Torneo ${half} ·`));
      const targetPhase = includePlayoffs
        ? halfPhases[halfPhases.length - 1]
        : halfPhases.find((phase) => phase.name.endsWith("Fase regular"));
      if (targetPhase) setSelectedLeg(targetPhase.leg);
      setFeedback(
        result.simulatedCount > 0
          ? `Se simularon ${result.simulatedCount} ${result.simulatedCount === 1 ? "partido" : "partidos"} del Torneo ${half}.`
          : `No había partidos pendientes en la selección del Torneo ${half}.`,
      );
      setPersistenceStatus("saved");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : `No se pudo simular el Torneo ${half}.`);
      setPersistenceStatus("error");
    } finally {
      setSimulationScopeHalf(null);
    }
  }

  function handleSaveResult(
    fixtureId: string,
    result: MatchResult,
    knockoutResolution: "penalties" | "extra-time-then-penalties" | "aggregate-then-penalties" | null,
  ) {
    if (!tournament) {
      return;
    }

    try {
      const updatedTournament = updateMatchResult(
        tournament,
        fixtureId,
        result,
        scopedRepository,
        knockoutResolution,
      );
      const advancedTournament = persistTournamentProgress(updatedTournament, scopedRepository);
      setTournament(advancedTournament);
      setSavedTournaments(repository.findAll());
      setFeedback("Resultado guardado.");
      setPersistenceStatus("saved");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No se pudo guardar el resultado.");
      setPersistenceStatus("error");
    }
  }

  function handleSaveGoalScorers(fixtureId: string, goalScorers: readonly GoalScorer[]) {
    if (!tournament) return;
    try {
      const updatedTournament = updateMatchGoalScorers(
        tournament,
        fixtureId,
        goalScorers,
        scopedRepository,
      );
      setTournament(updatedTournament);
      setSavedTournaments(repository.findAll());
      setFeedback("Autores de goles guardados. El marcador se mantuvo sin cambios.");
      setPersistenceStatus("saved");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No se pudieron guardar los autores de goles.");
      setPersistenceStatus("error");
    }
  }

  function handleSaveFixtureDetails(fixtureId: string, update: FixtureDetailsUpdate) {
    if (!tournament) return;
    try {
      const updatedTournament = updateFixtureDetails(tournament, fixtureId, update, scopedRepository);
      setTournament(updatedTournament);
      setSavedTournaments(repository.findAll());
      setFeedback("Detalles del partido guardados. El marcador se mantuvo sin cambios.");
      setPersistenceStatus("saved");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudieron guardar los detalles del partido.";
      setFeedback(message);
      setPersistenceStatus("error");
      throw new Error(message);
    }
  }

  function handleSaveFixtureSchedule(fixtureId: string, schedule: MatchSchedule | null): boolean {
    if (!tournament) return false;
    try {
      const updatedTournament = updateFixtureSchedule(tournament, fixtureId, schedule, scopedRepository);
      setTournament(updatedTournament);
      setSavedTournaments(repository.findAll());
      setFeedback("Programación del partido guardada.");
      setPersistenceStatus("saved");
      return true;
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No se pudo guardar la programación.");
      setPersistenceStatus("error");
      return false;
    }
  }

  function handleUpdateOperationalStatus(
    fixtureId: string,
    status: OperationalMatchStatus,
    note: string,
    confirmedAmbiguousResult: boolean,
  ): boolean {
    if (!tournament) return false;
    try {
      const updatedTournament = updateFixtureOperationalState(
        tournament,
        fixtureId,
        status,
        note,
        scopedRepository,
        undefined,
        confirmedAmbiguousResult,
      );
      setTournament(updatedTournament);
      setSavedTournaments(repository.findAll());
      setFeedback(`Estado operativo actualizado a ${getOperationalStatusLabel(status)}. Los datos deportivos se conservaron.`);
      setPersistenceStatus("saved");
      return true;
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No se pudo actualizar el estado operativo.");
      setPersistenceStatus("error");
      return false;
    }
  }

  function handleSaveRoster(updatedTournament: Tournament) {
    try {
      const previous = tournament?.id === updatedTournament.id
        ? tournament
        : scopedTournaments.find(({ id }) => id === updatedTournament.id);
      if (!previous) throw new Error("No se encontró la temporada cuya plantilla quieres guardar.");
      const saved = updateTournamentRoster(previous, updatedTournament, scopedRepository);
      setTournament(saved);
      setSavedTournaments(repository.findAll());
      setFeedback("Plantilla guardada para esta temporada.");
      setPersistenceStatus("saved");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No se pudo guardar la plantilla.");
      setPersistenceStatus("error");
      throw error;
    }
  }

  function handleSaveRegulations(updatedTournament: Tournament) {
    try {
      const previous = tournament?.id === updatedTournament.id
        ? tournament
        : scopedTournaments.find(({ id }) => id === updatedTournament.id);
      if (!previous) throw new Error("No se encontró la temporada cuyo reglamento quieres guardar.");
      const saved = updateTournamentRegulations(previous, updatedTournament, scopedRepository);
      setTournament(saved);
      setSavedTournaments(repository.findAll());
      setFeedback("Reglamento de la temporada guardado. Revisa las advertencias de los partidos existentes.");
      setPersistenceStatus("saved");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo guardar el reglamento.";
      setFeedback(message);
      setPersistenceStatus("error");
      throw new Error(message);
    }
  }

  function applyUniverseLibrary(next: SportsUniverseLibrary) {
    const previous = repository.getSportsUniverseLibrary();
    repository.setSportsUniverseLibrary(next);
    setUniverseLibrary(next);
    if (previous.activeUniverseId !== next.activeUniverseId) {
      setDecisionsOpen(false);setDrawOpen(false);setArchiveOpen(false);setClosureOpen(false);setClosureTargetId(undefined);setClosurePlanningRequest(undefined);
      setH2HFocus(null);
      setActivityFocus(null);
      setSimulationScopeHalf(null);
      setPendingScrollFixtureId(null);
      setPendingFocusTargetId(null);
      setFeedback("");
    }
    if (tournament && !tournamentsInUniverse(repository.findAll(), next)
      .some(({ id }) => id === tournament.id)) {
      setTournament(null);
      setScreen("library");
      setCalendarView(false);
      setProgrammingView(false);
      setProgrammingReturnToCalendar(false);
      setAlertsView(false);
    }
  }

  function handleSelectUniverse(id: string | null) {
    try {
      applyUniverseLibrary({ ...repository.getSportsUniverseLibrary(), activeUniverseId: id });
      setPersistenceStatus("saved");
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "No se pudo cambiar el universo activo.");
      setPersistenceStatus("error");
    }
  }

  function handleCreateUniverse(name: string, description: string) {
    const next = createSportsUniverse(repository.getSportsUniverseLibrary(), name, description);
    applyUniverseLibrary(next);
    setPersistenceStatus("saved");
  }

  function handleRenameUniverse(id: string, name: string, description: string) {
    const current = repository.getSportsUniverseLibrary();
    if (current.activeUniverseId !== id) {
      throw new Error("El universo activo cambió. Revisa nuevamente antes de editar.");
    }
    const next = renameSportsUniverse(current, id, name, description);
    applyUniverseLibrary(next);
    setPersistenceStatus("saved");
  }

  function handleDeleteUniverse(id: string) {
    const current = repository.getSportsUniverseLibrary();
    if (current.activeUniverseId !== id) {
      throw new Error("El universo activo cambió. Revisa nuevamente antes de eliminar.");
    }
    const next = deleteSportsUniverse(current, id);
    applyUniverseLibrary(next);
    setPersistenceStatus("saved");
  }

  function handleAssignTournaments(ids: readonly string[], targetId: string | null) {
    const current = repository.getSportsUniverseLibrary();
    if (current.activeUniverseId !== universeLibrary.activeUniverseId) {
      throw new Error("El universo activo cambió. Revisa nuevamente la reorganización.");
    }
    if (targetId !== null && targetId !== current.activeUniverseId) {
      throw new Error("Solo puedes incorporar torneos al universo activo. Revisa nuevamente.");
    }
    const next = setTournamentUniverseAssignments(
      current,
      ids,
      targetId,
      repository.findAll(),
      repository.findActivity?.() ?? [],
    );
    applyUniverseLibrary(next);
    setPersistenceStatus("saved");
  }

  function assignNewTournaments(ids: readonly string[], requestedUniverseId?: string | null) {
    const current = repository.getSportsUniverseLibrary();
    const universeId = requestedUniverseId === undefined
      ? current.activeUniverseId
      : requestedUniverseId;
    if (current.activeUniverseId !== universeId) {
      throw new Error("El universo activo cambió. Revisa nuevamente antes de guardar.");
    }
    if (!universeId) return;
    const next = setTournamentUniverseAssignments(
      current,
      ids,
      universeId,
      repository.findAll(),
      repository.findActivity?.() ?? [],
    );
    repository.setSportsUniverseLibrary(next);
    setUniverseLibrary(next);
  }

  function createTournament(tournament: Tournament) {
    try {
      if (repository.getSportsUniverseLibrary().activeUniverseId !== universeLibrary.activeUniverseId) {
        throw new Error("El universo activo cambió. Revisa nuevamente antes de crear el torneo.");
      }
      assignNewTournaments([tournament.id]);
      if (openTournament(persistTournamentProgress(tournament, scopedRepository))) {
        setFeedback("Campeonato guardado y abierto. Puedes simular o ingresar resultados.");
        setPersistenceStatus("saved");
        setLoadError("");
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "No se pudo abrir el campeonato.");
      setPersistenceStatus("error");
    }
  }

  function openTournament(selectedTournament: Tournament): boolean {
    try {
      const openingSnapshot = repository.snapshot();
      const allTournaments = repository.findAll();
      const currentUniverseLibrary = repository.getSportsUniverseLibrary();
      const inUniverse = tournamentsInUniverse(allTournaments, currentUniverseLibrary);
      const current = allTournaments.find(item => item.id === selectedTournament.id);
      if (!current || !inUniverse.some(({ id }) => id === current.id)) {
        setSavedTournaments(allTournaments);
        throw new Error("El torneo no pertenece al universo activo o ya no está guardado. Revisa la biblioteca actualizada.");
      }
      repository.setActiveTournamentId(current.id);
      if (repository.snapshot() !== openingSnapshot) throw new Error("La biblioteca cambió mientras se abría. Vuelve a abrir el torneo.");
      acknowledgedLibrary.current = openingSnapshot;
      setExternalChange(false);
      setTournament(current);
      setSelectedLeg(getInitialTournamentLeg(current));
      setScreen("tournament");
      setCalendarView(false);
      setAlertsView(false);
      setSavedTournaments(allTournaments);
      setFeedback("");
      setPersistenceStatus("saved");
      setLoadError("");
      return true;
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "No se pudo abrir el campeonato.");
      setPersistenceStatus("error");
      return false;
    }
  }

  function openTournamentCalendar(selectedTournament: Tournament) {
    if (openTournament(selectedTournament)) {
      setCalendarInitialized(true);
      setCalendarView(true);
      setProgrammingView(false);
    }
  }

  function handleConfirmCalendarProgramming(
    proposal: CalendarProgrammingProposal,
    current: Tournament,
  ): Promise<Tournament> {
    try {
      return import("@cancha/core/application/use-cases/program-season-calendar").then(async ({ confirmCalendarProgramming }) => {
        const currentUniverseId = repository.getSportsUniverseLibrary().activeUniverseId;
        const saved = await runWrite(() => confirmCalendarProgramming(proposal, current, scopedRepository, currentUniverseId));
        setSavedTournaments(repository.findAll());
        setActivityEvents(repository.findActivity?.() ?? []);
        if (tournament?.id === saved.id) setTournament(saved);
        setPersistenceStatus("saved");
        setFeedback("Calendario local guardado. Resultados y simulación no fueron modificados.");
        return saved;
      }).catch((error: unknown) => {
        setPersistenceStatus("error");
        throw error;
      });
    } catch (error) {
      setPersistenceStatus("error");
      return Promise.reject(error);
    }
  }

  function toggleCalendarView() {
    setCalendarInitialized(true);
    setProgrammingView(false);
    setCalendarView((current) => !current);
  }

  function handleDuplicate(
    tournamentToDuplicate: Tournament,
    mode: DuplicateResultsMode,
  ) {
    try {
      const duplicated = duplicateTournament(tournamentToDuplicate, mode, scopedRepository);
      assignNewTournaments([duplicated.id], universeLibrary.assignments[tournamentToDuplicate.id] ?? null);
      setSavedTournaments(repository.findAll());
      setPersistenceStatus("saved");
    } catch (error) {
      setPersistenceStatus("error");
      throw error;
    }
  }

  function handleCreateSeason(
    sourceTournament: Tournament,
    season: number,
    includeSquad: boolean,
  ): Tournament {
    try {
      const created = createTournamentSeason(
        sourceTournament,
        season,
        scopedRepository,
        undefined,
        undefined,
        includeSquad,
      );
      assignNewTournaments(
        [created.id],
        universeLibrary.assignments[sourceTournament.id] ?? null,
      );
      setSavedTournaments(repository.findAll());
      if (!openTournament(created)) {
        repository.deleteById(created.id);
        setSavedTournaments(repository.findAll());
        throw new Error("La temporada se guardó, pero no se pudo seleccionarla como activa.");
      }
      setFeedback(`Temporada ${season} creada y seleccionada.`);
      setPersistenceStatus("saved");
      return created;
    } catch (error) {
      setPersistenceStatus("error");
      throw error;
    }
  }

  function handleSetArchived(sourceTournament: Tournament, archived: boolean) {
    try {
      const updated = setTournamentArchived(sourceTournament, archived, scopedRepository);
      setSavedTournaments(repository.findAll());
      setPersistenceStatus("saved");
      if (tournament?.id === updated.id) setTournament(updated);
    } catch (error) {
      setPersistenceStatus("error");
      throw error;
    }
  }

  function handleRename(tournamentToRename: Tournament, name: string) {
    try {
      const renamed = renameTournament(tournamentToRename, name, scopedRepository);
      setSavedTournaments(repository.findAll());
      setPersistenceStatus("saved");
      if (tournament?.id === renamed.id) setTournament(renamed);
    } catch (error) {
      setPersistenceStatus("error");
      throw error;
    }
  }

  function handleDelete(tournamentToDelete: Tournament) {
    let remaining: Tournament[];
    try {
      if (!scopedTournaments.some(({ id }) => id === tournamentToDelete.id)) {
        throw new Error("El torneo ya no pertenece al universo activo. Revisa la biblioteca actualizada.");
      }
      repository.deleteById(tournamentToDelete.id);
      remaining = repository.findAll();
      setUniverseLibrary(repository.getSportsUniverseLibrary());
      setSavedTournaments(remaining);
      setPersistenceStatus("saved");
    } catch (error) {
      setPersistenceStatus("error");
      throw error;
    }
    if (tournament?.id !== tournamentToDelete.id) return;

    const nextTournament = tournamentsInUniverse(
      remaining,
      repository.getSportsUniverseLibrary(),
    )[0];
    let selectionWarning = "";
    try {
      repository.setActiveTournamentId(nextTournament?.id ?? null);
    } catch (error) {
      setPersistenceStatus("error");
      selectionWarning = error instanceof Error
        ? error.message
        : "No se pudo guardar la selección del campeonato activo.";
    }
    if (nextTournament) {
      setTournament(nextTournament);
      setSelectedLeg(getInitialTournamentLeg(nextTournament));
      setScreen("tournament");
      setFeedback(selectionWarning
        ? `Se eliminó el torneo activo. Ahora estás en "${nextTournament.name}". ${selectionWarning}`
        : `Se eliminó el torneo activo. Ahora estás en "${nextTournament.name}".`);
    } else {
      setTournament(null);
      setScreen("library");
      setFeedback("");
      if (selectionWarning) setLoadError(selectionWarning);
    }
  }

  function handleImportTournament(
    importedTournament: Tournament,
    mode: TournamentImportMode,
  ) {
    try {
      if (repository.getSportsUniverseLibrary().activeUniverseId !== universeLibrary.activeUniverseId) {
        throw new Error("El universo activo cambió. Revisa nuevamente antes de importar el torneo.");
      }
      const tournamentToSave = importTournamentArchive(importedTournament, mode, repository);
      if (!tournamentToSave) return;
      if (mode === "add" || mode === "copy") {
        assignNewTournaments([tournamentToSave.id], universeLibrary.activeUniverseId);
      }
      const refreshed = repository.findAll();
      setSavedTournaments(refreshed);
      if (tournament?.id === tournamentToSave.id) setTournament(tournamentToSave);
      return tournamentToSave;
    } catch (error) {
      setPersistenceStatus("error");
      setSavedTournaments(repository.findAll());
      throw error;
    }
  }

  function handleRestoreBackup(
    importedTournaments: readonly Tournament[],
    mode: BackupRestoreMode,
    restoredActivity: readonly ActivityEvent[] = [],
    restoredUniverses?: SportsUniverseLibrary,
  ) {
    let result: { added: number; skipped: number };
    try {
      result = repository.importTournaments(
        importedTournaments,
        mode,
        restoredActivity,
        false,
        restoredUniverses,
      );
      const refreshedUniverses = repository.getSportsUniverseLibrary();
      setUniverseLibrary(refreshedUniverses);
      setPersistenceStatus("saved");
      setLoadError("");
    } catch (error) {
      setPersistenceStatus("error");
      const reason = error instanceof Error ? error.message : "Error desconocido al restaurar el respaldo.";
      try {
        recordRejectedImport(repository, reason, importedTournaments[0]);
        setSavedTournaments(repository.findAll());
      } catch (auditError) {
        const auditReason = auditError instanceof Error ? auditError.message : "error de almacenamiento";
        throw new Error(`${reason} No se pudo guardar el rechazo en el historial: ${auditReason}`);
      }
      throw error;
    }
    const refreshed = repository.findAll();
    setActivityEvents(repository.findActivity());
    setRecoverySnapshotAvailable(repository.getRecoverySnapshotStatus().available);
    if (mode === "replace") resetRestoredInterface();
    setSavedTournaments(refreshed);
    const activeUniverseTournaments = tournamentsInUniverse(
      refreshed,
      repository.getSportsUniverseLibrary(),
    );
    const activeId = repository.getActiveTournamentId();
    const activeTournament = activeUniverseTournaments.find(({ id }) => id === activeId);
    if (mode === "replace" || (activeId && !activeTournament)) {
      const nextTournament = activeUniverseTournaments[0] ?? null;
      setTournament(nextTournament);
      if (nextTournament) {
        setSelectedLeg(getInitialTournamentLeg(nextTournament));
        setScreen("tournament");
      } else {
        setScreen("library");
      }
      if (mode === "replace") setRecoveryWarning("");
    } else if (activeTournament) {
      setTournament(activeTournament);
    }
    return result;
  }

  function handleRestoreRecoverySnapshot() {
    const result = repository.restoreRecoverySnapshot();
    resetRestoredInterface();
    const refreshed = repository.findAll();
    const restoredUniverses = repository.getSportsUniverseLibrary();
    setUniverseLibrary(restoredUniverses);
    setSavedTournaments(refreshed);
    setActivityEvents(repository.findActivity?.() ?? []);
    const snapshotStatus = repository.getRecoverySnapshotStatus();
    setRecoverySnapshotAvailable(snapshotStatus.available);
    const activeId = repository.getActiveTournamentId();
    const activeScope = tournamentsInUniverse(refreshed, restoredUniverses);
    const activeTournament = activeScope.find(({ id }) => id === activeId) ?? activeScope[0] ?? null;
    setTournament(activeTournament);
    if (activeTournament) {
      setSelectedLeg(getInitialTournamentLeg(activeTournament));
      setScreen("tournament");
    } else {
      setScreen("library");
    }
    setFeedback("Se recuperó el estado anterior con su historial de actividad.");
    setPersistenceStatus("saved");
    setLoadError("");
    return result;
  }

  function resetRestoredInterface() {
    setDecisionsOpen(false);setDrawOpen(false);setArchiveOpen(false);setClosureOpen(false);setClosureTargetId(undefined);setClosurePlanningRequest(undefined);
    clearSessionDrafts("");setLibraryRevision(value => value + 1);
    setSimulationCenterOpen(false);setSimulationTargetId(undefined);setSaveOrigin(null);setSaveRecoveryRequest(null);
    setCalendarInitialized(false);setCalendarView(false);setProgrammingView(false);setProgrammingReturnToCalendar(false);
    setAlertsView(false);setActivityFocus(null);setH2HFocus(null);setSimulationScopeHalf(null);
    setSimulationMode("pendingOnly");setArgentinaTableView("zona-a");setSelectedLeg(1);
    setPendingScrollFixtureId(null);setPendingFocusTargetId(null);setFeedback("");
  }
  function openSaveRecovery(name = "") {
    setSaveOrigin({screen, universeId: universeLibrary.activeUniverseId, trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null});
    saveRequestCounter.current += 1;
    setSaveRecoveryRequest({id: saveRequestCounter.current, name});setScreen("library");
  }
  function returnFromSaveRecovery() {
    const origin = saveOrigin;
    const actualUniverses = repository.getSportsUniverseLibrary(), actualTournaments = repository.findAll();
    setSavedTournaments(actualTournaments);setUniverseLibrary(actualUniverses);refreshSourceActivity();
    setSaveOrigin(null);setSaveRecoveryRequest(null);
    const available = origin?.universeId === actualUniverses.activeUniverseId
      && (!tournament || actualTournaments.some(t => t.id === tournament.id));
    if (origin && available) {
      setScreen(origin.screen);
      requestAnimationFrame(() => { if (origin.trigger?.isConnected) origin.trigger.focus(); });
    } else { setScreen("library");setSimulationCenterOpen(false); }
  }
  useEffect(() => {
    if (!libraryRevision) return;
    const frame = requestAnimationFrame(() => {
      const heading = document.querySelector<HTMLElement>(".workspace h2, .workspace h3");
      heading?.setAttribute("tabindex", "-1");heading?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [libraryRevision]);

  function readRawTournamentDataForRecovery() {
    return repository.readRawTournamentDataForRecovery();
  }

  return (
    <ClubAssociationsNavigation.Provider value={{universeId:universeLibrary.activeUniverseId,open:(target,teamId)=>{openDraws(target);setAffiliationRequest({teamId,request:++affiliationRequestSerial.current});}}}><SportsDecisionsNavigation.Provider value={openDecisions}><DrawCenterNavigation.Provider value={openDraws}><HistoricalArchiveNavigation.Provider value={openArchive}><SeasonClosureNavigation.Provider value={openClosure}><LibraryWriteContext.Provider value={runWrite}><SaveRecoveryNavigation.Provider value={{service: checkpointService, open: openSaveRecovery, request: saveRecoveryRequest,
      acknowledge: () => setSaveRecoveryRequest(null), returnToOrigin: saveOrigin ? returnFromSaveRecovery : undefined}}>
    <SeasonSimulationNavigation.Provider value={target => {setSimulationTargetId(target?.id);setSimulationCenterOpen(true);}}><main className="page-shell" aria-busy={libraryLoading}>
      {feedback && screen !== "tournament" && <p role="status">{feedback}</p>}
      {externalChange && <aside role="alert" aria-label="Cambios externos en la biblioteca" className="preview-panel"><p>La biblioteca cambió en {repository.origin === "server" ? "otra pestaña o dispositivo" : "otra pestaña"}. Tus borradores se conservan; las confirmaciones antiguas no se guardarán.</p><button type="button" onClick={refreshExternalLibrary}>Actualizar biblioteca conservando borradores</button><button type="button" onClick={reopenExternalLibrary}>Abrir biblioteca actual y cerrar formularios</button></aside>}
      <header className="topbar">
        <a className="brand" href="/" aria-label="Cancha, inicio">
          <span className="brand-mark">C</span>
          <span>cancha<span className="brand-period">.</span></span>
        </a>
        <span className="topbar-note">SIMULADOR DE CAMPEONATOS</span>
        <div className="topbar-actions">
          <button className="topbar-nav" disabled={libraryLoading} onClick={() => {setDecisionsOpen(false);setDrawOpen(false);setArchiveOpen(false);setClosureOpen(false);setScreen("library");}} type="button">
            Biblioteca
          </button>
          <button className="topbar-nav" disabled={libraryLoading} onClick={() => {
            setLoadError("");
            setDecisionsOpen(false);setDrawOpen(false);setArchiveOpen(false);setClosureOpen(false);setScreen("setup");
          }} type="button">
            Crear torneo
          </button>
          <details className="topbar-tools">
            <summary className="topbar-nav">Más herramientas</summary>
            <div className="topbar-tools-menu">
              <button id="open-sports-decisions" className="topbar-nav" type="button" disabled={libraryLoading} onClick={()=>openDecisions(tournament ?? undefined)}>Decisiones deportivas</button>
              <ClubAssociationsAccess tournament={tournament ?? undefined}/>
              <button id="open-draw-center" className="topbar-nav" type="button" disabled={libraryLoading} onClick={()=>openDraws(tournament ?? undefined)}>Sorteos y cruces</button>
              <button id="open-historical-archive" className="topbar-nav" type="button" disabled={libraryLoading} onClick={openArchive}>Archivo histórico</button>
              <button id="open-season-closure" className="topbar-nav" type="button" disabled={libraryLoading} onClick={() => openClosure(tournament ?? undefined)}>Centro de cierre</button>
              <button className="topbar-nav" disabled={libraryLoading} type="button" onClick={() => {setDecisionsOpen(false);setDrawOpen(false);setArchiveOpen(false);setClosureOpen(false);setSimulationCenterOpen(value => !value);}}>Centro de simulación</button>
            </div>
          </details>
          <AccountAccess />
        </div>
        <span className="topbar-status"><span /> TU TORNEO, TUS REGLAS</span>
      </header>

      {tournament && activeCompetition && (
        <section className="active-tournament-bar" aria-label="Torneo activo">
          <span className="active-tournament-label">TORNEO ACTIVO</span>
          <strong>{tournament.name}</strong>
          <span>{activeCompetition.territory} · {activeCompetition.name} · Temporada {tournament.season ?? "sin año"}</span>
        </section>
      )}
      {!tournament && <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow hero-eyebrow">FÚTBOL CHILENO · TEMPORADA 2026</span>
          <h1>El campeonato<br />lo armas <em>tú.</em></h1>
          <p>Define los equipos, el formato y las reglas. Nosotros ponemos la cancha.</p>
          <div className="hero-footnote"><span>01</span> CONFIGURA TU CAMPEONATO</div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="art-sun" />
          <div className="art-ball">◉</div>
          <div className="art-label">90′<br /><span>DE PURA PASIÓN</span></div>
          <div className="art-line art-line-one" />
          <div className="art-line art-line-two" />
        </div>
      </section>}

      <section key={libraryRevision} className={`workspace${decisionsOpen || drawOpen || archiveOpen || closureOpen || screen !== "tournament" ? " workspace-setup" : ""}`}>
        {h2hFocus && <div id="head-to-head-calendar" tabIndex={-1}>
          <button type="button" className="small-action" onClick={()=>setH2HFocus(null)}>Cerrar comparación del calendario</button>
          <HeadToHeadAccess tournaments={scopedTournaments} activity={scopedActivityEvents} onOpen={t=>{openTournament(t);setH2HFocus(null);}} contextKey={`h2h:calendar:${h2hFocus.a}:${h2hFocus.b}`} label="Calendario" initialA={h2hFocus.a} initialB={h2hFocus.b} initiallyOpen/>
        </div>}
        {persistenceStatus === "saved" && (
          <p className="persistence-status persistence-status-saved" aria-live="polite">
            Cambio guardado en este dispositivo. Cada operación se confirma al escribirla.
          </p>
        )}
        {persistenceStatus === "error" && (
          <p className="persistence-status persistence-status-error" aria-live="assertive">
            No se confirmó el último cambio; se conservó el estado anterior cuando fue posible.
          </p>
        )}
        {recoveryWarning && <p className="error-message" role="alert">{recoveryWarning}</p>}
        {simulationCenterOpen && <div hidden={!!saveOrigin} className="simulation-center-host"><SeasonSimulationCenter key={`${universeLibrary.activeUniverseId}:${simulationTargetId}`} initialTournamentId={simulationTargetId}
          tournaments={scopedTournaments} repository={scopedRepository} universeId={universeLibrary.activeUniverseId}
          getUniverseId={() => repository.getSportsUniverseLibrary().activeUniverseId}
          onChanged={updated => { if (tournament?.id === updated.id) setTournament(updated); setSavedTournaments(repository.findAll()); refreshSourceActivity(); setPersistenceStatus("saved"); }}
          onCalendar={selected => {setSimulationCenterOpen(false);openTournamentCalendar(selected);}}
          onReview={selected => {setSimulationCenterOpen(false);if (openTournament(selected)) setAlertsView(true);}}
          onClose={() => setSimulationCenterOpen(false)} /></div>}
        {decisionsOpen ? <DeferredPanel fallback={<p role="status">Cargando decisiones deportivas...</p>}><SportsDecisionsCenter
          key={`${universeLibrary.activeUniverseId}:${decisionsTargetId}`} repository={scopedRepository} universeId={universeLibrary.activeUniverseId}
          universeName={universeLibrary.universes.find(u=>u.id===universeLibrary.activeUniverseId)?.name ?? "Biblioteca anterior"}
          initialTournamentId={decisionsTargetId} getUniverseId={()=>repository.getSportsUniverseLibrary().activeUniverseId}
          onChanged={updated=>{if(tournament?.id===updated.id)setTournament(updated);setSavedTournaments(repository.findAll());refreshSourceActivity();setPersistenceStatus("saved");}}
          onClose={()=>{setDecisionsOpen(false);requestAnimationFrame(()=>document.getElementById("open-sports-decisions")?.focus());}}
          onCalendar={(selected,fixtureId)=>{setDecisionsOpen(false);openTournamentCalendar(selected);if(fixtureId){const day=selected.matchdays.find(d=>d.fixtures.some(f=>f.id===fixtureId));if(day)setSelectedLeg(day.leg);setPendingScrollFixtureId(fixtureId);}}}
          onRules={selected=>{setDecisionsOpen(false);if(openTournament(selected)){setAlertsView(true);setProgrammingView(false);}}}
          onDraw={openDraws} onSimulation={selected=>{setDecisionsOpen(false);setSimulationTargetId(selected.id);setSimulationCenterOpen(true);}}
          onClosure={openClosure} onPlanning={selected=>archiveFlow("planning",selected)} onQualification={selected=>archiveFlow("qualification",selected)}
        /></DeferredPanel> : drawOpen ? <DeferredPanel fallback={<p role="status">Cargando centro de sorteos...</p>}><DrawAndBracketCenter
          key={`${universeLibrary.activeUniverseId}:${drawTargetId}:${affiliationRequest?.request ?? 0}`} affiliationRequest={affiliationRequest} repository={scopedRepository} universeId={universeLibrary.activeUniverseId}
          universeName={universeLibrary.universes.find(u=>u.id===universeLibrary.activeUniverseId)?.name ?? "Biblioteca anterior"}
          initialTournamentId={drawTargetId} getUniverseId={()=>repository.getSportsUniverseLibrary().activeUniverseId}
          onChanged={updated=>{if(tournament?.id===updated.id)setTournament(updated);setSavedTournaments(repository.findAll());refreshSourceActivity();setPersistenceStatus("saved");}}
          onClose={()=>{setDecisionsOpen(false);setDrawOpen(false);requestAnimationFrame(()=>document.getElementById("open-draw-center")?.focus());}}
          onCalendar={selected=>{setDecisionsOpen(false);setDrawOpen(false);openTournamentCalendar(selected);}}
          onProgram={selected=>{setDecisionsOpen(false);setDrawOpen(false);if(openTournament(selected))setProgrammingView(true);}}
          onSimulation={selected=>{setDecisionsOpen(false);setDrawOpen(false);setSimulationTargetId(selected.id);setSimulationCenterOpen(true);}}
          onAlerts={selected=>{setDecisionsOpen(false);setDrawOpen(false);if(openTournament(selected)){setAlertsView(true);setProgrammingView(false);}}}
          onClosure={openClosure}
        /></DeferredPanel> : archiveOpen ? <DeferredPanel fallback={<p role="status">Cargando archivo histórico…</p>}><HistoricalArchive
          key={universeLibrary.activeUniverseId ?? "unassigned"}
          read={() => ({tournaments:repository.findAll(),activity:repository.findActivity(),library:repository.getSportsUniverseLibrary()})}
          onClose={() => {setDecisionsOpen(false);setDrawOpen(false);setArchiveOpen(false);requestAnimationFrame(()=>document.getElementById("open-historical-archive")?.focus());}}
          onOpen={selected => {setDecisionsOpen(false);setDrawOpen(false);setArchiveOpen(false);if(openTournament(selected))setProgrammingView(false);}}
          onCalendar={selected => {setDecisionsOpen(false);setDrawOpen(false);setArchiveOpen(false);openTournamentCalendar(selected);}}
          onClosure={openClosure} onPlanning={selected=>archiveFlow("planning",selected)}
          onQualification={selected=>archiveFlow("qualification",selected)} onCompetitions={()=>archiveFlow("competitions")}
        /></DeferredPanel> : closureOpen ? <DeferredPanel fallback={<p role="status">Cargando revisión de cierre…</p>}><SeasonClosureCenter
          key={`${universeLibrary.activeUniverseId}:${closureTargetId}`} tournaments={scopedTournaments} repository={scopedRepository}
          universeId={universeLibrary.activeUniverseId} universeName={universeLibrary.universes.find(u => u.id === universeLibrary.activeUniverseId)?.name ?? "Biblioteca anterior · sin asignar"}
          initialTournamentId={closureTargetId} getUniverseId={() => repository.getSportsUniverseLibrary().activeUniverseId}
          onChanged={() => {refreshSourceActivity();setPersistenceStatus("saved");}} onClose={closeClosure}
          onCalendar={selected => {setDecisionsOpen(false);setDrawOpen(false);setArchiveOpen(false);setClosureOpen(false);openTournamentCalendar(selected);}}
          onAlerts={selected => {setDecisionsOpen(false);setDrawOpen(false);setArchiveOpen(false);setClosureOpen(false);if(openTournament(selected))setAlertsView(true);}}
          onEdit={selected => {setDecisionsOpen(false);setDrawOpen(false);setArchiveOpen(false);setClosureOpen(false);openTournament(selected);}} onPlanning={closurePlanning}
        /></DeferredPanel> : screen === "library" ? (
          <>
            {loadError && <p className="error-message" role="alert">{loadError}</p>}
            <TournamentLibrary
              planningNavigationRequest={closurePlanningRequest}
              onPlanningNavigationHandled={() => setClosurePlanningRequest(undefined)}
              key={universeLibrary.activeUniverseId ?? "unassigned"}
              onReviewContinental={input => reviewContinentalEdition(input,scopedRepository)}
              onConfirmContinental={review => {
                const saved=confirmContinentalEdition(review,scopedRepository,true);
                assignNewTournaments([saved.id]);
                setSavedTournaments(repository.findAll());
                return saved;
              }}
              activeTournamentId={tournament?.id ?? null}
              backupUnavailableReason={recoveryWarning || loadError}
              recoverySnapshotAvailable={recoverySnapshotAvailable}
              activityEvents={scopedActivityEvents}
              allActivityEvents={activityEvents}
              loading={libraryLoading}
              tournaments={scopedTournaments}
              allTournaments={savedTournaments}
              universeLibrary={universeLibrary}
              onSelectUniverse={handleSelectUniverse}
              onCreateUniverse={handleCreateUniverse}
              onRenameUniverse={handleRenameUniverse}
              onDeleteUniverse={handleDeleteUniverse}
              onAssignTournaments={handleAssignTournaments}
              onOpen={openTournament}
              onOpenCalendar={openTournamentCalendar}
              onConfirmCalendarProgramming={handleConfirmCalendarProgramming}
              onOpenAlerts={(selectedTournament) => {
                if (openTournament(selectedTournament)) setAlertsView(true);
              }}
              onOpenActivity={(selectedTournament) =>
                setActivityFocus({ tournamentId: selectedTournament.id })}
              onRejectedImport={(reason) => {
                recordRejectedImport(repository, reason);
                setSavedTournaments(repository.findAll());
              }}
              onCreate={() => {
                setLoadError("");
                setDecisionsOpen(false);setDrawOpen(false);setArchiveOpen(false);setClosureOpen(false);setScreen("setup");
              }}
              onDuplicate={handleDuplicate}
              onCreateSeason={handleCreateSeason}
              onRegisterCupRegulation={(sourceId,input)=>{const saved=registerNationalCupRegulation(sourceId,input,scopedRepository,true);setSavedTournaments(repository.findAll());refreshSourceActivity();return saved;}}
              onReviewPlanning={input=>reviewSeasonPlanning(input,scopedRepository)}
              onConfirmPlanning={review=>{try{const created=confirmSeasonPlanning(review,scopedRepository,true);assignNewTournaments(created.map(({id})=>id));setSavedTournaments(repository.findAll());refreshSourceActivity();setPersistenceStatus("saved");return created;}catch(e){setPersistenceStatus("error");throw e;}}}
              onSetArchived={handleSetArchived}
              onRename={handleRename}
              onDelete={handleDelete}
              onImportTournament={handleImportTournament}
              onRestoreBackup={handleRestoreBackup}
              onRestoreRecoverySnapshot={handleRestoreRecoverySnapshot}
              onExportRecoveryData={readRawTournamentDataForRecovery}
            />
          </>
        ) : isCreatingTournament ? (
          <div className="setup-screen">
            <div className="setup-screen-heading">
              <span className="eyebrow">CONFIGURACIÓN DEL CAMPEONATO</span>
              <h2>Crea tu torneo</h2>
              <p>Importa una competición o define equipos, formato y desempates a tu medida.</p>
            </div>
            <div className="setup-screen-grid">
              <section className="setup-option-panel">
                <div className="setup-option-heading">
                  <span className="eyebrow">OPCIÓN 01</span>
                  <h3>Importar campeonato</h3>
                  <p>Trae equipos y partidos de una competición disponible.</p>
                </div>
                <DeferredPanel fallback={<p role="status">Cargando competiciones…</p>}><ImportOfficialTournament
                  repository={scopedRepository}
                  onImported={createTournament}
                  onActivityChanged={refreshSourceActivity}
                /></DeferredPanel>
              </section>
              <section className="setup-option-panel custom-tournament-panel">
                <div className="setup-option-heading">
                  <span className="eyebrow">OPCIÓN 02</span>
                  <h3>Crear campeonato personalizado</h3>
                  <p>Elige participantes, cantidad de ruedas y orden de desempate.</p>
                </div>
                <SetupTournamentForm
                  repository={repository}
                  onCreated={createTournament}
                  draftScope={`setup:${universeLibrary.activeUniverseId ?? "unassigned"}`}
                />
              </section>
            </div>
            {loadError && <p className="error-message" role="alert">{loadError}</p>}
          </div>
        ) : tournament ? (
          <aside className="preview-panel">
              <div className="preview-topline">
              <span className="eyebrow">TORNEO ACTIVO · CALENDARIO</span>
                <div className="preview-topline-actions">
                  <span className="live-dot" />
                  {!alertsView && <button
                    aria-pressed={calendarView}
                    className="small-action"
                    onClick={toggleCalendarView}
                    type="button"
                  >
                    {calendarView ? "Volver al resumen" : "Centro de calendario"}
                  </button>}
                  {!alertsView && <button className="small-action" type="button"
                    aria-pressed={programmingView}
                    onClick={() => {
                      setProgrammingReturnToCalendar(false);
                      setProgrammingView((current) => !current);
                      setCalendarView(false);
                      setAlertsView(false);
                    }}>
                    {programmingView ? "Cerrar programación" : "Programar calendario"}
                  </button>}
                  {canGenerateSeasonCalendar(tournament) && <button className="small-action primary-library-action" type="button"
                    onClick={() => { void runWrite(handleGenerateSeasonCalendar).catch(() => {}); }}>
                    Generar calendario
                  </button>}
                  <button
                    aria-pressed={alertsView}
                    className="small-action"
                    onClick={() => {
                      setAlertsView((current) => !current);
                      setCalendarView(false);
                    }}
                    type="button"
                  >
                    {alertsView ? "Volver al torneo" : "Centro de alertas"}
                  </button>
                  <button
                    className="small-action"
                    type="button"
                    onClick={() => setActivityFocus({ tournamentId: tournament.id })}
                  >
                    Historial de actividad
                  </button>
                </div>
              </div>
              <h2>{tournament.name}</h2>
              {alertsView ? (
                <CompetitionAlertCenter
                  tournament={tournament}
                  onBack={() => setAlertsView(false)}
                  onOpenFixture={(fixtureId) => {
                    const matchday = tournament.matchdays.find(({ fixtures }) =>
                      fixtures.some(({ id }) => id === fixtureId));
                    if (matchday) setSelectedLeg(matchday.leg);
                    setPendingScrollFixtureId(fixtureId);
                    setCalendarInitialized(true);
                    setCalendarView(true);
                    setAlertsView(false);
                  }}
                  onOpenCalendar={() => {
                    setCalendarInitialized(true);
                    setCalendarView(true);
                    setAlertsView(false);
                  }}
                  onOpenStatistics={() => {
                    setCalendarView(false);
                    setAlertsView(false);
                    setPendingFocusTargetId("tournament-statistics");
                  }}
                  onOpenRegulations={() => {
                    setCalendarView(false);
                    setAlertsView(false);
                    setPendingFocusTargetId("match-regulations-editor");
                  }}
                />
              ) : programmingView ? (
                <DeferredPanel fallback={<p role="status">Cargando programación…</p>}>
                  <CalendarProgrammingCenter
                    tournaments={scopedTournaments}
                    universeId={universeLibrary.activeUniverseId}
                    initialTournamentId={tournament.id}
                    onConfirm={handleConfirmCalendarProgramming}
                    onOpenCalendar={openTournamentCalendar}
                    onBack={() => {
                      setProgrammingView(false);
                      setCalendarView(programmingReturnToCalendar);
                      setProgrammingReturnToCalendar(false);
                    }}
                  />
                </DeferredPanel>
              ) : (
              <>
              <div className="tournament-board" hidden={calendarView}>
              <div className="board-controls">
              <p className="preview-summary">
                {tournament.teams.length} equipos <span>·</span>{" "}
                {tournament.competitionType === "cup"
                  ? `${phases.length} etapas`
                  : tournament.format === "staged"
                    ? `${phases.length} ${phases.length === 1 ? "etapa" : "etapas"}`
                    : `${tournament.legs} ${tournament.legs === 1 ? "rueda" : "ruedas"}`} <span>·</span>{" "}
                {tournament.competitionType === "cup"
                  ? `${tournament.matchdays.reduce((total, matchday) => total + matchday.fixtures.length, 0)} partidos`
                  : `${tournament.matchdays.length} fechas`}
              </p>
              <div className="next-match-navigation">
                <div>
                  <span className="eyebrow">ACCESO RÁPIDO</span>
                  <p>
                    {nextPendingMatchday
                      ? tournament.competitionType === "cup"
                        ? `Siguiente sin resolver · ${nextPendingMatchday.phaseName ?? "Etapa eliminatoria"}`
                        : `Siguiente sin resolver · Fecha ${nextPendingMatchday.number}`
                        : "No quedan partidos por resolver"}
                  </p>
                </div>
                <button
                  aria-label="Ir al siguiente partido pendiente"
                  className="next-match-button"
                  disabled={!nextPendingFixture || !nextPendingMatchday}
                  onClick={() => {
                    if (nextPendingFixture && nextPendingMatchday) {
                      setSelectedLeg(nextPendingMatchday.leg);
                      setPendingScrollFixtureId(nextPendingFixture.id);
                    }
                  }}
                  type="button"
                >
                  <span>{nextPendingFixture ? "Ir al partido" : "Campeonato completo"}</span>
                  <span aria-hidden="true">↓</span>
                </button>
              </div>
              {tournament.format === "staged" && (
                <p className="staged-format-note">
                  {tournament.rulesNote ?? (isArgentinaTournament
                    ? "Los partidos de playoffs no se suman a las tablas de fase regular."
                    : "Se muestra únicamente la etapa seleccionada; sus resultados y clasificación se mantienen separados de las demás etapas.")}
                </p>
              )}
              {tournament.sourceUrl && (
                <p className="official-source-link">
                  Resultados importados desde {tournament.sourceName ?? "fuente externa"} ·{" "}
                  <a href={tournament.sourceUrl} target="_blank" rel="noreferrer">
                    Ver fuente ↗
                  </a>
                </p>
              )}
              <section className="simulation-controls" aria-label="Controles de simulación">
                <label>
                  <span>Partidos con resultado</span>
                  <select
                    aria-label="Partidos con resultado"
                    value={simulationMode}
                    onChange={(event) => setSimulationMode(event.target.value as SimulationMode)}
                  >
                    <option value="pendingOnly">Simular solo los pendientes</option>
                    <option value="overwrite">Simular todos y sobrescribir resultados</option>
                  </select>
                </label>
                <p className="simulation-hint">
                  {simulationMode === "pendingOnly"
                    ? "Los resultados existentes se conservarán."
                    : "Los resultados existentes se reemplazarán."}
                </p>
                <div className="leg-simulation">
                  <label>
                    <span>{tournament.format === "staged" ? "Etapa" : "Rueda"}</span>
                    <select
                      value={activeLeg}
                      onChange={(event) => setSelectedLeg(Number(event.target.value))}
                    >
                      {tournament.format === "staged"
                        ? phases.map((phase) => (
                          <option key={phase.leg} value={phase.leg}>{phase.name}</option>
                        ))
                        : Array.from({ length: tournament.legs }, (_, index) => (
                          <option key={index + 1} value={index + 1}>Rueda {index + 1}</option>
                        ))}
                    </select>
                  </label>
                  <button
                    className="small-action"
                    type="button"
                    disabled={!visibleMatchdays.some((matchday) => matchday.fixtures.length > 0)}
                    onClick={() => {
                      if (
                        isArgentinaTournament
                        && activePhase?.name.endsWith("Fase regular")
                      ) {
                        setSimulationScopeHalf(selectedTournamentHalf);
                      } else {
                        handleSimulate(
                          visibleMatchdays
                            .filter((matchday) => tournament.format === "staged" || matchday.leg === activeLeg)
                            .flatMap((matchday) => matchday.fixtures.map((fixture) => fixture.id)),
                        );
                      }
                    }}
                  >
                    {isArgentinaTournament && activePhase?.name.endsWith("Fase regular")
                      ? "Simular fase"
                      : tournament.format === "staged" ? "Simular etapa" : "Simular rueda"}
                  </button>
                </div>
                <button
                  className="small-action"
                  type="button"
                  onClick={() => { void runWrite(handleSimulateChampionship).catch(() => {}); }}
                >
                  Simular campeonato
                </button>
              </section>
              </div>
              <div className="board-extra">
              <DeferredPanel fallback={<p role="status">Cargando estadísticas…</p>}><TournamentStatisticsPanel
                activity={scopedActivityEvents}
                tournament={tournament}
                tournaments={scopedTournaments}
                onSaveTournament={handleSaveRoster}
                onSaveRegulations={handleSaveRegulations}
                onSelectTournament={(tournamentId) => {
                  const selectedTournament = scopedTournaments.find(({ id }) => id === tournamentId);
                  if (selectedTournament) openTournament(selectedTournament);
                }}
              /></DeferredPanel>
              {(tournament.season ?? 0) > 2026 &&               <DeferredPanel fallback={<p role="status">Cargando preparación de temporada…</p>}><SeasonPreparationPanel onActivityChanged={refreshSourceActivity} source={publishedSeasonSource} key={`preparation-${tournament.id}`} tournament={tournament} repository={scopedRepository}
                onChange={(updated) => { setTournament(updated); setSavedTournaments(repository.findAll()); setPersistenceStatus("saved"); }} /></DeferredPanel>}
              {secondKind && <DeferredPanel fallback={<p role="status">Cargando ascensos y desempates…</p>}><SecondDivisionPanel key={tournament.id} tournament={tournament}
                tournaments={scopedTournaments} repository={scopedRepository}
                onChange={(updated) => { setTournament(updated); setSavedTournaments(repository.findAll()); setPersistenceStatus("saved"); }}
                onCreated={(created) => { assignNewTournaments(created.map(({id})=>id)); setSavedTournaments(repository.findAll()); setFeedback("Se crearon ambas temporadas con participantes actualizados. Calendarios y reglamentos pendientes."); setPersistenceStatus("saved"); }} /></DeferredPanel>}
              </div>
              <div className="board-standings">
              <DeferredPanel fallback={null}><ChampionCards tournament={tournament} activity={scopedActivityEvents} /></DeferredPanel>
              {isArgentinaTournament && (
                <label className="table-view-select">
                  <span>Tabla que quieres consultar</span>
                  <select
                    aria-label="Tabla que quieres consultar"
                    value={argentinaTableView}
                    onChange={(event) => setArgentinaTableView(event.target.value)}
                  >
                    <option value="zona-a">Apertura/Clausura · Zona A</option>
                    <option value="zona-b">Apertura/Clausura · Zona B</option>
                    <option value="annual">Tabla anual acumulada</option>
                  </select>
                </label>
              )}
              {!isCupKnockoutPhase && !isContinentalGroupPhase && !isChileanAscensoPlayoffPhase && !isSecondDivisionPlayoffPhase && secondKind !== "argentina" && <StandingsTable
                standings={standings}
                unresolvedTies={unresolvedStandingTies}
                tieBreakers={tournament.competitionRules?.tieBreakers ?? tournament.tieBreakers}
                competitionRules={isArgentinaTournament && argentinaTableView !== "annual"
                  && tournament.competitionRules
                  ? {
                    ...tournament.competitionRules,
                    placementsNote: undefined,
                    conditionalPlacements: [],
                  }
                  : tournament.competitionRules}
                pointsSystem={tournament.pointsSystem}
                placementFixtures={standingsTournament?.matchdays.flatMap(({ fixtures }) => fixtures)}
                placementTournament={standingsTournament ?? undefined}
                placementRules={isArgentinaTournament
                  ? argentinaTableView === "annual"
                    ? tournament.placementRules
                    : { playoffPlaces: { from: 1, to: 8 } }
                  : tournament.placementRules}
                heading={isArgentinaTournament
                  ? argentinaTableView === "annual"
                    ? "Tabla anual acumulada"
                    : `${selectedArgentinaGroup} · ${selectedTournamentHalf}`
                  : undefined}
                placementNote={isArgentinaTournament && argentinaTableView !== "annual"
                  ? "Avanzan a playoffs los ocho primeros de cada zona. La tabla incluye los partidos interzonales del Apertura o Clausura seleccionado."
                  : undefined}
                internationalQualifications={internationalQualifications}
                relegationAverages={relegationAverages}
              />}
              {continentalGroupStandings.map(({ groupName, standings, standingsTournament: groupTournament }) => (
                <StandingsTable
                  key={groupName}
                  standings={standings}
                  unresolvedTies={getUnresolvedStandingsTieDetails(groupTournament, standings)}
                  tieBreakers={tournament.competitionRules?.tieBreakers ?? tournament.tieBreakers}
                  competitionRules={tournament.competitionRules}
                  pointsSystem={tournament.pointsSystem}
                  heading={`${groupName} · Fase de grupos`}
                />
              ))}
              {isCupKnockoutPhase && (
                <p className="playoff-format-note">
                  {activeCupStage?.legs === 2
                    ? "Eliminatoria a ida y vuelta. Si el marcador global queda igualado tras la vuelta, se define por penales."
                    : "Eliminatoria a partido único. Si hay empate, se define por penales."}
                </p>
              )}
              {isChileanAscensoPlayoffPhase && (
                <p className="playoff-format-note">
                  Liguilla basada en la estructura ANFP documentada para 2025, provisional para 2026.
                  Las llaves son a ida y vuelta y el empate global se define por penales.
                </p>
              )}
              {isArgentinaTournament && activePhase
                && !activePhase.name.includes("Fase regular")
                && !activePhase.name.includes("Fase de grupos") && (
                  <p className="playoff-format-note">
                    {activePhase.name.includes("Octavos")
                      ? "Cruces entre zonas: 1.º A–8.º B, 2.º A–7.º B y así sucesivamente hasta 8.º A–1.º B."
                      : "Eliminación directa."}
                    {" "}Si persiste el empate, se juega prórroga y luego penales.
                  </p>
                )}
              </div>
              <div className="board-fixtures">
              {feedback && <p className="simulation-feedback" role="status">{feedback}</p>}
              <DeferredPanel fallback={<p role="status">Cargando partidos…</p>}><FixtureList
                matchdays={visibleMatchdays}
                teams={tournament.teams}
                allMatchdays={tournament.matchdays}
                competitionType={tournament.competitionType}
                onSimulateMatchday={(matchday) =>
                  handleSimulate(matchday.fixtures.map((fixture) => fixture.id))
                }
                onSimulateFixture={(fixtureId) => handleSimulate([fixtureId], "overwrite")}
                onSaveResult={handleSaveResult}
                onSaveGoalScorers={handleSaveGoalScorers}
                tournament={tournament}
                onSaveDetails={handleSaveFixtureDetails}
                onSaveSchedule={handleSaveFixtureSchedule}
                onUpdateOperationalStatus={handleUpdateOperationalStatus}
                onCompareClubs={(a,b)=>{setH2HFocus({a:clubOccurrenceKey(tournament.id,a),b:clubOccurrenceKey(tournament.id,b)});setPendingFocusTargetId("head-to-head-calendar");}}
                onOpenActivity={(fixtureId) => setActivityFocus({
                  tournamentId: tournament.id,
                  fixtureId,
                })}
                players={tournament.players ?? []}
                playerRegistrations={tournament.playerRegistrations ?? []}
                otherTournaments={scopedTournaments.filter(({ id }) => id !== tournament.id)}
              /></DeferredPanel>
              </div>
              </div>
              {calendarInitialized && (
                <div hidden={!calendarView}>
                  <DeferredPanel fallback={<p role="status">Cargando calendario…</p>}><MatchCalendar
                    matchdays={tournament.matchdays}
                    teams={tournament.teams}
                    allMatchdays={tournament.matchdays}
                    competitionType={tournament.competitionType}
                    onSimulateMatchday={(matchday) =>
                      handleSimulate(matchday.fixtures.map((fixture) => fixture.id))
                    }
                    onSimulateFixture={(fixtureId) => handleSimulate([fixtureId], "overwrite")}
                    onSaveResult={handleSaveResult}
                    onSaveGoalScorers={handleSaveGoalScorers}
                    tournament={tournament}
                    onSaveDetails={handleSaveFixtureDetails}
                    onSaveSchedule={handleSaveFixtureSchedule}
                    onUpdateOperationalStatus={handleUpdateOperationalStatus}
                    onCompareClubs={(a,b)=>{setH2HFocus({a:clubOccurrenceKey(tournament.id,a),b:clubOccurrenceKey(tournament.id,b)});setPendingFocusTargetId("head-to-head-calendar");}}
                onOpenActivity={(fixtureId) => setActivityFocus({
                      tournamentId: tournament.id,
                      fixtureId,
                    })}
                    players={tournament.players ?? []}
                    playerRegistrations={tournament.playerRegistrations ?? []}
                    otherTournaments={scopedTournaments.filter(({ id }) => id !== tournament.id)}
                    onBack={() => setCalendarView(false)}
                    onOpenProgramming={() => {
                      setCalendarView(false);
                      setProgrammingReturnToCalendar(true);
                      setProgrammingView(true);
                    }}
                  /></DeferredPanel>
                </div>
              )}
              </>
              )}
          </aside>
        ) : (
          <p className="error-message" role="alert">
            No hay un campeonato cargado. Crea o importa uno para continuar.
          </p>
        )}
      </section>

      {activityFocus !== null && (
        <ActivityHistory
          events={scopedActivityEvents}
          tournaments={scopedTournaments}
          focusTournamentId={activityFocus.tournamentId}
          focusFixtureId={activityFocus.fixtureId}
          onClose={() => setActivityFocus(null)}
          onOpenTournament={(selected) => {
            setActivityFocus(null);
            openTournament(selected);
          }}
          onOpenMatch={(selected, fixtureId) => {
            setActivityFocus(null);
            setPendingScrollFixtureId(fixtureId);
            openTournamentCalendar(selected);
          }}
        />
      )}

      <SimulationScopeDialog
        open={simulationScopeHalf !== null}
        half={simulationScopeHalf ?? "Apertura"}
        onSelect={(includePlayoffs) => {
          if (simulationScopeHalf) {
            handleSimulateArgentinaHalf(simulationScopeHalf, includePlayoffs);
          }
        }}
        onCancel={() => setSimulationScopeHalf(null)}
      />

      <footer className="page-footer">
        <span>CANCHA © 2026</span>
        <span>HECHO PARA LOS QUE VIVEN EL FÚTBOL</span>
      </footer>
    </main></SeasonSimulationNavigation.Provider></SaveRecoveryNavigation.Provider></LibraryWriteContext.Provider></SeasonClosureNavigation.Provider></HistoricalArchiveNavigation.Provider></DrawCenterNavigation.Provider></SportsDecisionsNavigation.Provider></ClubAssociationsNavigation.Provider>
  );
}

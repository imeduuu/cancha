import {HistoricalArchiveAccess} from "./historical-archive-access";
import { useLibraryWrite } from "../library-write-context";
import { SaveRecoveryNavigation, type SaveRecoveryRequest } from "./save-recovery-access";
import { SaveCheckpointPanel } from "./save-checkpoint-panel";
import { downloadText } from "../download-text";
import type {SeasonPlanningActions} from "@cancha/core/application/use-cases/plan-season";
import type { ContinentalPreparationInput, ContinentalReview } from "@cancha/core/application/use-cases/prepare-continental-edition";
import { CompetitionCenter } from "./competition-center";
import { useSessionDraft } from "../session-drafts";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Tournament } from "@cancha/core/domain/entities/tournament";
import type { DuplicateResultsMode } from "@cancha/core/application/use-cases/manage-tournaments";
import type { CalendarProgrammingProposal } from "@cancha/core/application/use-cases/program-season-calendar";
import {
  createTournamentArchive,
  createTournamentBackup,
  parseTournamentArchive,
  parseTournamentBackupWithActivity,
} from "@cancha/core/application/services/tournament-archive";
import type { ActivityEvent } from "@cancha/core/domain/entities/activity-event";
import { championTierLabels, unverifiedTier } from "@cancha/core/application/services/champion-tier";
import type { SportsUniverseLibrary } from "@cancha/core/domain/entities/sports-universe";
import { emptySportsUniverseLibrary } from "@cancha/core/application/services/sports-universes";
import { SportsUniverseControls } from "./sports-universe-controls";
import { SportsUniverseDashboard } from "./sports-universe-dashboard";
import { ConfirmationDialog } from "./confirmation-dialog";
import {
  canStartNewSeason,
  compareTournamentSeasons,
  getFinalStandings,
  getTournamentCompletionStatus,
  hasCompleteRoundRobinSchedule,
} from "@cancha/core/domain/services/tournament-history";
import {
  calculateTournamentStatistics,
  isValidPlayedFixture,
} from "@cancha/core/domain/services/tournament-statistics";
import {
  countCompetitionAlerts,
  getCompetitionAlerts,
} from "@cancha/core/domain/services/competition-alerts";
import { getOperationalMatchStatus } from "@cancha/core/domain/services/match-operational-status";

export type TournamentImportMode = "add" | "copy" | "update";
export type BackupRestoreMode = "merge" | "replace";
type ControlStatus = "sin-comenzar" | "en-curso" | "finalizado" | "incompleto" | "indeterminado";
type TournamentSort = "name" | "progress" | "season";

function getControlStatus(tournament: Tournament): ControlStatus {
  const status = getTournamentCompletionStatus(tournament);
  if (status === "Finalizado") return "finalizado";
  if (status === "Incompleto") return "incompleto";
  const statistics = calculateTournamentStatistics(tournament);
  if (status === "Indeterminado"
    && statistics.played > 0
    && statistics.pending === 0
    && statistics.incomplete === 0) return "indeterminado";
  if (statistics.played === 0 && statistics.pending > 0) return "sin-comenzar";
  if (statistics.played > 0 || statistics.pending > 0) return "en-curso";
  return "indeterminado";
}

function getControlStatusLabel(status: ControlStatus): string {
  const labels: Record<ControlStatus, string> = {
    "sin-comenzar": "Sin comenzar",
    "en-curso": "En curso",
    finalizado: "Finalizado",
    incompleto: "Incompleto · revisar",
    indeterminado: "Indeterminado",
  };
  return labels[status];
}

function getTournamentFormatLabel(tournament: Tournament): string {
  const hasGroups = tournament.teams.some((team) => team.groupName);
  if (tournament.competitionType === "cup") {
    if (hasGroups && tournament.knockoutStages?.length) return "Copa · grupos y eliminatorias";
    if (hasGroups) return "Copa · grupos";
    return tournament.knockoutStages?.length ? "Copa · eliminatorias" : "Copa";
  }
  if (tournament.format === "staged") return hasGroups ? "Fases · grupos" : "Fases";
  if (tournament.format === "round-robin" || tournament.competitionType === "league") {
    return hasGroups ? "Liga · grupos" : "Liga";
  }
  return "Formato no especificado";
}

function getProgressText(tournament: Tournament): string {
  const statistics = calculateTournamentStatistics(tournament);
  const fixtureCount = tournament.matchdays.reduce((total, matchday) =>
    total + matchday.fixtures.length, 0);
  if (fixtureCount === 0) return "No disponible";
  if (isRoundRobin(tournament) && !hasCompleteRoundRobinSchedule(tournament)) {
    return "No disponible · calendario incompleto";
  }
  return `${statistics.progressPercent}% de partidos programados`;
}

function isRoundRobin(tournament: Tournament): boolean {
  return tournament.competitionType !== "cup"
    && tournament.format !== "staged"
    && !tournament.teams.some((team) => team.groupName)
    && (tournament.format === "round-robin"
      || (tournament.format === undefined && tournament.competitionType === "league"));
}

function getProgressSortValue(tournament: Tournament): number {
  const hasFixtures = tournament.matchdays.some(({ fixtures }) => fixtures.length > 0);
  if (!hasFixtures || (isRoundRobin(tournament) && !hasCompleteRoundRobinSchedule(tournament))) {
    return -1;
  }
  return calculateTournamentStatistics(tournament).progressPercent;
}

function findCompetitionSeasonConflict(
  imported: Tournament,
  tournaments: readonly Tournament[],
): Tournament | undefined {
  if (!imported.competitionId || imported.season === undefined) return undefined;
  return tournaments.find((saved) =>
    saved.id !== imported.id
    && saved.competitionId === imported.competitionId
    && saved.season === imported.season,
  );
}
interface TournamentLibraryProps extends SeasonPlanningActions {
  onReviewContinental?: (input: ContinentalPreparationInput) => ContinentalReview;
  onConfirmContinental?: (review: ContinentalReview) => Tournament;
  tournaments: readonly Tournament[];
  allTournaments?: readonly Tournament[];
  universeLibrary?: SportsUniverseLibrary;
  onSelectUniverse?: (id: string | null) => void;
  onCreateUniverse?: (name: string, description: string) => void;
  onRenameUniverse?: (id: string, name: string, description: string) => void;
  onDeleteUniverse?: (id: string) => void;
  onAssignTournaments?: (ids: readonly string[], universeId: string | null) => void;
  activeTournamentId: string | null;
  loading: boolean;
  backupUnavailableReason?: string;
  recoverySnapshotAvailable?: boolean;
  activityEvents?: readonly ActivityEvent[];
  allActivityEvents?: readonly ActivityEvent[];
  onOpen: (tournament: Tournament) => void;
  onOpenCalendar: (tournament: Tournament) => void;
  onConfirmCalendarProgramming?: (proposal: CalendarProgrammingProposal, tournament: Tournament) => Tournament | Promise<Tournament>;
  onOpenAlerts: (tournament: Tournament) => void;
  onOpenActivity?: (tournament: Tournament) => void;
  onRejectedImport?: (reason: string) => void;
  planningNavigationRequest?: {request: number; tournamentId: string; kind?: "planning" | "qualification" | "competitions"};
  onPlanningNavigationHandled?: () => void;
  onCreate: () => void;
  onDuplicate: (tournament: Tournament, mode: DuplicateResultsMode) => void;
  onRename: (tournament: Tournament, name: string) => void;
  onDelete: (tournament: Tournament) => void;
  onSetArchived: (tournament: Tournament, archived: boolean) => void;
  onCreateSeason: (tournament: Tournament, season: number, includeSquad: boolean) => Tournament;
  onImportTournament: (
    tournament: Tournament,
    mode: TournamentImportMode,
  ) => Tournament | void;
  onRestoreBackup: (
    tournaments: readonly Tournament[],
    mode: BackupRestoreMode,
    activity?: readonly ActivityEvent[],
    universes?: SportsUniverseLibrary,
  ) => { added: number; skipped: number };
  onRestoreRecoverySnapshot?: () => { added: number; skipped: number };
  onExportRecoveryData?: () => string;
}


function formatCreatedAt(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Fecha no disponible";
  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatBackupDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Fecha no disponible";
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function TournamentLibrary({
  tournaments,
  allTournaments: allTournamentsProp,
  universeLibrary: universeLibraryProp,
  onSelectUniverse,
  onCreateUniverse,
  onRenameUniverse,
  onDeleteUniverse,
  onAssignTournaments,
  onReviewContinental,
  onConfirmContinental,
  activeTournamentId,
  loading,
  backupUnavailableReason,
  recoverySnapshotAvailable = false,
  activityEvents = [],
  allActivityEvents: allActivityEventsProp,
  onOpen,
  onOpenCalendar,
  onConfirmCalendarProgramming,
  onOpenAlerts,
  onOpenActivity,
  onRejectedImport,
  onCreate,
  planningNavigationRequest,
  onPlanningNavigationHandled,
  onDuplicate,
  onRename,
  onDelete,
  onSetArchived,
  onCreateSeason,
  onReviewPlanning,
  onRegisterCupRegulation,
  onConfirmPlanning,
  onImportTournament,
  onRestoreBackup,
  onRestoreRecoverySnapshot,
  onExportRecoveryData,
}: TournamentLibraryProps) {
  const runWrite = useLibraryWrite();

  const allTournaments = allTournamentsProp ?? tournaments;
  const universeLibrary = universeLibraryProp ?? emptySportsUniverseLibrary();
  const allActivityEvents = allActivityEventsProp ?? activityEvents;
  const scopeKey = universeLibrary.activeUniverseId ?? "unassigned";
  const [centerOpen, setCenterOpen] = useSessionDraft(`library-center-open:${scopeKey}`, false);
  const [dashboardOpen, setDashboardOpen] = useSessionDraft(`universe-dashboard:library:${scopeKey}`, false);
  const [saveRecoveryOpen, setSaveRecoveryOpen] = useState(false);
  const checkpointNavigation = useContext(SaveRecoveryNavigation);
  const [checkpointRequest, setCheckpointRequest] = useState<SaveRecoveryRequest | null>(null);
  const externalSaveRequest = checkpointNavigation?.request;
  useEffect(() => {
    if (!externalSaveRequest) return;
    setSaveRecoveryOpen(true);setCheckpointRequest(externalSaveRequest);checkpointNavigation?.acknowledge();
  }, [checkpointNavigation, externalSaveRequest]);
  const [centerRequest, setCenterRequest] = useState<{
    kind: "planning" | "qualification" | "programming";
    tournamentId?: string;
    request: number;
  }>();
  const centerRequestCounter = useRef(0);
  const requestCenterFlow = useCallback((kind: "planning" | "qualification" | "programming", tournament?: Tournament) => {
    centerRequestCounter.current += 1;
    setCenterRequest({
      kind,
      ...(tournament ? { tournamentId: tournament.id } : {}),
      request: centerRequestCounter.current,
    });
    setCenterOpen(true);
  }, [setCenterOpen]);
  useEffect(() => {
    if (planningNavigationRequest) {
      if (planningNavigationRequest.kind === "competitions") setCenterOpen(true);
      else requestCenterFlow(planningNavigationRequest.kind ?? "planning", tournaments.find(t => t.id === planningNavigationRequest.tournamentId));
      onPlanningNavigationHandled?.();
    }
  }, [onPlanningNavigationHandled, planningNavigationRequest, requestCenterFlow, setCenterOpen, tournaments]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [duplicateMode, setDuplicateMode] = useState<DuplicateResultsMode>("reset");
  const [deleteTarget, setDeleteTarget] = useState<Tournament | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pendingImport, setPendingImport] = useState<Tournament | null>(null);
  const [pendingBackup, setPendingBackup] = useState<{
    version: number;
    exportedAt?: string;
    tournaments: readonly Tournament[];
    activity: readonly ActivityEvent[];
    universes?: SportsUniverseLibrary;
  } | null>(null);
  const [backupFileName, setBackupFileName] = useState("");
  const [backupExportAt, setBackupExportAt] = useState(() => new Date().toISOString());
  const [filePurpose, setFilePurpose] = useState<"tournament" | "backup">("tournament");
  const [busy, setBusy] = useState(false);
  const [recoveryConfirmationOpen, setRecoveryConfirmationOpen] = useState(false);
  const [libraryView, setLibraryView] = useState<"active" | "archived">("active");
  const [searchTerm, setSearchTerm] = useState("");
  const [seasonFilter, setSeasonFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<ControlStatus | "">("");
  const [sortBy, setSortBy] = useState<TournamentSort>("season");
  const [summaryTournamentId, setSummaryTournamentId] = useState<string | null>(null);
  const [creatingSeasonId, setCreatingSeasonId] = useState<string | null>(null);
  const [seasonValue, setSeasonValue] = useState("");
  const pendingImportConflict = pendingImport
    ? tournaments.find(({ id }) => id === pendingImport.id)
      ?? findCompetitionSeasonConflict(pendingImport, tournaments)
    : undefined;
  const pendingImportIsCompetitionConflict = Boolean(
    pendingImportConflict && pendingImportConflict.id !== pendingImport?.id,
  );
  const backupIdConflicts = pendingBackup
    ? pendingBackup.tournaments.filter((incoming) =>
      allTournaments.some((saved) => saved.id === incoming.id))
    : [];
  const backupSeasonConflicts = pendingBackup
    ? pendingBackup.tournaments.flatMap((incoming) => {
      const conflict = findCompetitionSeasonConflict(incoming, allTournaments);
      return conflict ? [{ incoming, conflict }] : [];
    })
    : [];
  const backupUniverseConflicts = pendingBackup?.universes
    ? pendingBackup.universes.universes.flatMap((incoming) => {
      const sameId = universeLibrary.universes.find(({ id }) => id === incoming.id);
      if (sameId && (sameId.name !== incoming.name || sameId.description !== incoming.description)) {
        return [`El ID "${incoming.id}" ya existe con otros metadatos.`];
      }
      const sameName = universeLibrary.universes.find(({ id, name }) =>
        id !== incoming.id && name.trim().toLocaleLowerCase("es")
          === incoming.name.trim().toLocaleLowerCase("es"));
      return sameName ? [`El nombre "${incoming.name}" ya pertenece al universo "${sameName.id}".`] : [];
    })
    : [];
  const backupMergeBlocked = Boolean(
    backupUniverseConflicts.length > 0,
  );
  const [copySquadForSeason, setCopySquadForSeason] = useState(false);
  const [comparisonIds, setComparisonIds] = useState<[string, string]>(["", ""]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeTournaments = tournaments.filter((saved) => !saved.archived);
  const archivedTournaments = tournaments.filter((saved) => saved.archived);
  const libraryTournaments = libraryView === "active" ? activeTournaments : archivedTournaments;
  const seasons = useMemo(() => [...new Set(tournaments
    .map(({ season }) => season)
    .filter((season): season is number => season !== undefined))]
    .sort((first, second) => second - first), [tournaments]);
  const visibleTournaments = useMemo(() => {
    const normalizedSearch = normalizeSearch(searchTerm);
    const filtered = libraryTournaments.filter((saved) =>
      (!normalizedSearch || normalizeSearch(saved.name).includes(normalizedSearch))
      && (!seasonFilter || (seasonFilter === "unregistered"
        ? saved.season === undefined
        : String(saved.season) === seasonFilter))
      && (!statusFilter || getControlStatus(saved) === statusFilter));
    return filtered.sort((first, second) => {
      if (sortBy === "name") {
        return first.name.localeCompare(second.name, "es")
          || (second.season ?? 0) - (first.season ?? 0);
      }
      if (sortBy === "progress") {
        const firstProgress = getProgressSortValue(first);
        const secondProgress = getProgressSortValue(second);
        return secondProgress - firstProgress || first.name.localeCompare(second.name, "es");
      }
      return (second.season ?? 0) - (first.season ?? 0)
        || first.name.localeCompare(second.name, "es");
    });
  }, [libraryTournaments, searchTerm, seasonFilter, sortBy, statusFilter]);
  const summaryTournament = summaryTournamentId
    ? tournaments.find(({ id }) => id === summaryTournamentId)
    : undefined;
  const comparableTournaments = archivedTournaments.filter((saved) =>
    saved.competitionId && saved.season);
  const selectedComparison = comparisonIds.every(Boolean)
    ? [
      comparableTournaments.find(({ id }) => id === comparisonIds[0]),
      comparableTournaments.find(({ id }) => id === comparisonIds[1]),
    ] as const
    : undefined;
  const comparison = selectedComparison?.[0] && selectedComparison[1]
    ? compareTournamentSeasons(selectedComparison[0], selectedComparison[1])
    : undefined;

  function downloadJson(fileName: string, value: unknown) {
    downloadText(fileName, `${JSON.stringify(value, null, 2)}\n`, "application/json;charset=utf-8");
  }

  function exportRecoveryData() {
    try {
      if (!onExportRecoveryData) {
        throw new Error("No está disponible la lectura de los datos originales para recuperación.");
      }
      const original = onExportRecoveryData();
      downloadText("cancha-recuperacion-original.json", original, "application/json;charset=utf-8");
      setError("");
      setMessage("Se exportó el contenido original sin modificar. Este archivo no está validado como respaldo restaurable; guárdalo antes de reemplazar la biblioteca.");
    } catch (exportError) {
      setError(exportError instanceof Error
        ? exportError.message
        : "No se pudieron exportar los datos originales de recuperación.");
    }
  }

  function exportTournament(tournament: Tournament) {
    try {
      downloadJson(`${tournament.id}.json`, createTournamentArchive(tournament));
      setError("");
      setMessage(`Se exportó "${tournament.name}".`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "No se pudo exportar el torneo.");
    }
  }

  function exportBackup() {
    try {
      if (backupUnavailableReason) {
        throw new Error(`No se puede asegurar un respaldo completo: ${backupUnavailableReason}`);
      }
      const exportedAt = new Date().toISOString();
      const backup = createTournamentBackup(
        allTournaments,
        () => new Date(exportedAt),
        allActivityEvents,
        universeLibrary,
      );
      downloadJson("cancha-respaldo.json", backup);
      setBackupExportAt(exportedAt);
      setError("");
      setMessage(`Respaldo exportado con ${allTournaments.length} ${allTournaments.length === 1 ? "torneo" : "torneos"}.`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "No se pudo exportar el respaldo.");
    }
  }

  async function readSelectedFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    setMessage("");
    let parsed = false;
    try {
      const contents = await file.text();
      if (filePurpose === "tournament") {
        const imported = parseTournamentArchive(contents);
        parsed = true;
        if (tournaments.some(({ id }) => id === imported.id)
          || findCompetitionSeasonConflict(imported, tournaments)) {
          setPendingImport(imported);
          setMessage(`El torneo "${imported.name}" ya existe o coincide con una competición y temporada guardadas. Elige qué hacer.`);
        } else {
          await runWrite(() => onImportTournament(imported, "add"));
          setMessage(`Se importó "${imported.name}".`);
        }
      } else {
        const imported = parseTournamentBackupWithActivity(contents);
        parsed = true;
        setBackupFileName(file.name);
        setPendingBackup(imported);
        setMessage(`Respaldo válido v${imported.version}: contiene ${imported.tournaments.length} ${imported.tournaments.length === 1 ? "torneo" : "torneos"}.`);
      }
    } catch (importError) {
      const reason = importError instanceof Error
        ? importError.message
        : "No se pudo leer o validar el archivo.";
      if (!parsed) {
        try { await runWrite(() => {
          onRejectedImport?.(reason);
         }); } catch (auditError) {
          const auditReason = auditError instanceof Error ? auditError.message : "error de almacenamiento";
          setError(`${reason} No se pudo guardar el rechazo en el historial: ${auditReason}`);
          return;
        }
      }
      setError(reason);
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function chooseFile(purpose: "tournament" | "backup") {
    setFilePurpose(purpose);
    setError("");
    setMessage("");
    fileInputRef.current?.click();
  }

  async function importAsCopy() {
    if (!pendingImport) return;
    try { await runWrite(() => {
      const copied = onImportTournament(pendingImport, "copy");
      setMessage(`Se importó "${copied?.name ?? `${pendingImport.name} (copia)`}" como una copia independiente.`);
      setError("");
      setPendingImport(null);
     }); } catch (importError) {
      setError(importError instanceof Error ? importError.message : "No se pudo crear la copia.");
    }
  }

  async function updateExisting() {
    if (!pendingImport) return;
    try { await runWrite(() => {
      const target = pendingImportConflict && pendingImportConflict.id !== pendingImport.id
        ? { ...pendingImport, id: pendingImportConflict.id }
        : pendingImport;
      const updated = onImportTournament(target, "update");
      setMessage(`Se actualizó explícitamente "${updated?.name ?? pendingImport.name}".`);
      setError("");
      setPendingImport(null);
     }); } catch (importError) {
      setError(importError instanceof Error ? importError.message : "No se pudo actualizar el torneo.");
    }
  }

  async function restoreBackup(mode: BackupRestoreMode) {
    if (!pendingBackup) return;
    if (mode === "merge" && backupMergeBlocked) {
      setError("No se puede combinar este respaldo con seguridad. Revisa los conflictos indicados antes de restaurar.");
      return;
    }
    try { await runWrite(() => {
      const result = onRestoreBackup(
        pendingBackup.tournaments,
        mode,
        pendingBackup.activity,
        pendingBackup.universes,
      );
      setMessage(mode === "replace"
        ? `Biblioteca restaurada desde "${backupFileName}" con ${result.added} torneos.`
        : `Respaldo agregado: ${result.added} nuevos; ${result.skipped} con identificador existente se conservaron sin cambios.`);
      setError("");
      setPendingBackup(null);
     }); } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "No se pudo restaurar el respaldo.");
    }
  }

  async function restoreRecoverySnapshot() {
    if (!onRestoreRecoverySnapshot) return;
    try { await runWrite(() => {
      const result = onRestoreRecoverySnapshot();
      setMessage(`Se recuperó la copia local anterior con ${result.added} competiciones.`);
      setError("");
     }); } catch (restoreError) {
      setError(restoreError instanceof Error
        ? restoreError.message
        : "No se pudo recuperar la copia local.");
    }
  }

  function beginRename(tournament: Tournament) {
    setRenamingId(tournament.id);
    setRenameValue(tournament.name);
    setError("");
    setMessage("");
  }

  async function saveRename(tournament: Tournament) {
    try { await runWrite(() => {
      onRename(tournament, renameValue);
      setRenamingId(null);
      setError("");
      setMessage(`Se cambió el nombre a "${renameValue.trim()}".`);
     }); } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "No se pudo cambiar el nombre.");
    }
  }

  async function duplicate(tournament: Tournament) {
    try { await runWrite(() => {
      onDuplicate(tournament, duplicateMode);
      setError("");
      setMessage(duplicateMode === "copy"
        ? `Se creó una copia de "${tournament.name}" con sus resultados.`
        : `Se creó una copia de "${tournament.name}" con los resultados reiniciados.`);
     }); } catch (duplicateError) {
      setError(duplicateError instanceof Error ? duplicateError.message : "No se pudo duplicar el campeonato.");
    }
  }

  return (
    <section className="tournament-library" aria-labelledby="library-heading">
      <div className="library-heading">
        <div>
          <span className="eyebrow">TUS COMPETICIONES</span>
          <h2 id="library-heading">Biblioteca de torneos</h2>
          <p>Abre un campeonato o administra copias independientes.</p>
        </div>
        <button className="library-create-button" onClick={onCreate} type="button">
          Crear o importar torneo
        </button>
      </div>
      <HistoricalArchiveAccess />
      <details className="library-tools">
      <summary>Más herramientas de biblioteca</summary>
      <SportsUniverseControls
        library={universeLibrary}
        tournaments={tournaments}
        allTournaments={allTournaments}
        onSelect={(id) => onSelectUniverse?.(id)}
        onCreate={onCreateUniverse}
        onRename={onRenameUniverse}
        onDelete={onDeleteUniverse}
        onAssign={onAssignTournaments}
        manage
      />
      <button
        className="small-action"
        type="button"
        aria-expanded={dashboardOpen}
        onClick={() => setDashboardOpen(!dashboardOpen)}
      >
        Panel principal del universo
      </button>
      {dashboardOpen && (
        <SportsUniverseDashboard
          tournaments={allTournaments}
          activity={allActivityEvents}
          universeLibrary={universeLibrary}
          onOpen={onOpen}
          onCalendar={onOpenCalendar}
          onAlerts={onOpenAlerts}
          onPlanning={(tournament) => requestCenterFlow("planning", tournament)}
          onProgramCalendar={(tournament) => requestCenterFlow("programming", tournament)}
          onQualification={(tournament) => requestCenterFlow("qualification", tournament)}
          onImportCalendar={() => onCreate()}
          onOpenSaveRecovery={() => setSaveRecoveryOpen(true)}
        />
      )}
      </details>
      <div className="library-file-actions">
        <button className="small-action" disabled={busy} onClick={() => chooseFile("tournament")} type="button">
          Importar torneo desde JSON
        </button>
      </div>
      <button
        className="small-action"
        type="button"
        aria-expanded={saveRecoveryOpen}
        aria-controls="save-recovery-center"
        onClick={() => setSaveRecoveryOpen((open) => !open)}
      >
        Centro de guardado y recuperación
      </button>
      {saveRecoveryOpen && (
        <section className="save-recovery-center" id="save-recovery-center" aria-label="Centro de guardado y recuperación">
          <header>
            <div>
              <span className="eyebrow">PROTECCIÓN DE LA BIBLIOTECA</span>
              <h3>Centro de guardado y recuperación</h3>
              <p>Usa el respaldo completo para conservar juntos torneos, actividad y universos.</p>
            </div>
          </header>
          <section aria-label="Vista previa del respaldo completo">
            <h4>Respaldo completo de biblioteca</h4>
            <dl className="save-recovery-facts">
              <div><dt>Torneos</dt><dd>{allTournaments.length}</dd></div>
              <div><dt>Universos</dt><dd>{universeLibrary.universes.length}</dd></div>
              <div><dt>Actividad</dt><dd>{allActivityEvents.length} eventos</dd></div>
              <div><dt>Generación prevista</dt><dd><time dateTime={backupExportAt}>{formatBackupDate(backupExportAt)}</time></dd></div>
              <div><dt>Formato</dt><dd>JSON v7 · cancha-backup</dd></div>
              <div><dt>Alcance</dt><dd>Biblioteca completa, historial y extensión de universos</dd></div>
            </dl>
            <button
              className="small-action"
              disabled={busy || loading || Boolean(backupUnavailableReason)}
              onClick={exportBackup}
              title={backupUnavailableReason || undefined}
              type="button"
            >
              Descargar respaldo completo
            </button>
            {backupUnavailableReason && (
              <p className="library-message" role="note">
                No se ofrece un respaldo validado porque la biblioteca no pudo verificarse: {backupUnavailableReason}
              </p>
            )}
          </section>
          {checkpointNavigation && <SaveCheckpointPanel key={checkpointRequest?.id ?? "manual"}
            service={checkpointNavigation.service} suggestedName={checkpointRequest?.name}
            onReturn={checkpointNavigation.returnToOrigin ? () => {setSaveRecoveryOpen(false);checkpointNavigation.returnToOrigin?.();} : undefined} />}
          <section aria-label="Respaldo por universo">
            <h4>Respaldo por universo</h4>
            <p>
              No disponible: separar torneos puede omitir dependencias entre temporadas,
              identidades e historial de actividad. La opción segura es descargar el respaldo completo.
            </p>
          </section>
          <section aria-label="Restauración y recuperación">
            <h4>Restaurar una biblioteca</h4>
            <p>
              El archivo se valida antes de mostrar la vista previa. Reemplazar intenta conservar
              una copia local del estado previo cuando esos datos son válidos; combina por ID y
              las relaciones se vuelven a validar antes de escribir.
            </p>
            <div className="library-file-actions">
              <button className="small-action" disabled={busy} onClick={() => chooseFile("backup")} type="button">
                Restaurar respaldo
              </button>
              {backupUnavailableReason && (
                <button
                  className="small-action"
                  disabled={busy || loading}
                  onClick={exportRecoveryData}
                  type="button"
                >
                  Exportar datos originales para recuperación
                </button>
              )}
              {recoverySnapshotAvailable && onRestoreRecoverySnapshot && (
                <button
                  className="small-action"
                  disabled={busy}
                  onClick={() => setRecoveryConfirmationOpen(true)}
                  type="button"
                >
                  Recuperar estado anterior
                </button>
              )}
            </div>
            {backupUnavailableReason && (
              <p className="library-message" role="note">
                El contenido original exportado para recuperación no es un respaldo validado ni debe usarse como sustituto de JSON v7.
              </p>
            )}
          </section>
        </section>
      )}
      <div className="library-file-actions">
        <input
          accept=".json,application/json"
          aria-label={filePurpose === "tournament" ? "Archivo JSON de torneo" : "Archivo JSON de respaldo"}
          className="sr-only"
          onChange={(event) => void readSelectedFile(event.target.files?.[0])}
          ref={fileInputRef}
          type="file"
        />
      </div>
      {busy && <p className="library-message" role="status">Leyendo y validando el archivo…</p>}
      {backupUnavailableReason && (
        <p className="library-message" role="note">
          Guarda los datos originales de recuperación antes de reemplazar la biblioteca. El archivo exportado no es un respaldo validado.
        </p>
      )}
      {loading && <p className="library-empty" role="status">Cargando torneos guardados…</p>}
      {error && <p className="library-error" role="alert">{error}</p>}
      {message && <p className="library-message" role="status">{message}</p>}
      <ConfirmationDialog
        open={recoveryConfirmationOpen}
        title="Recuperar la biblioteca anterior"
        description="Se restaurarán los torneos y la actividad que estaban guardados justo antes del último reemplazo de biblioteca."
        warning="Esta acción reemplaza la biblioteca actual. La copia solo se ofrece si no hubo cambios posteriores."
        eyebrow="RECUPERACIÓN LOCAL"
        icon="↶"
        confirmLabel="Restaurar copia local"
        onCancel={() => setRecoveryConfirmationOpen(false)}
        onConfirm={() => {
          setRecoveryConfirmationOpen(false);
          restoreRecoverySnapshot();
        }}
      />
      {!loading && tournaments.length === 0 && (
        <div className="library-empty">
          {backupUnavailableReason ? (
            <>
              <h3>No hay torneos disponibles</h3>
              <p>
                Algunos registros no pudieron cargarse. Sus datos originales podrían seguir en el almacenamiento. Exporta los datos de recuperación antes de reemplazar la biblioteca; después puedes importar un respaldo externo válido.
              </p>
            </>
          ) : (
            <>
              <h3>Aún no tienes torneos guardados</h3>
              <p>Crea uno personalizado o importa una competición para empezar.</p>
              <button className="small-action" onClick={onCreate} type="button">
                Crear mi primer torneo
              </button>
            </>
          )}
        </div>
      )}
      {!loading && tournaments.length > 0 && (
        <>
          <button className="small-action" type="button" aria-expanded={centerOpen} onClick={() => setCenterOpen(!centerOpen)}>
            Centro de competiciones y temporadas
          </button>
          {centerOpen && <CompetitionCenter centerRequest={centerRequest} onConfirmCalendarProgramming={onConfirmCalendarProgramming} onImportCalendar={() => onCreate()} onRegisterCupRegulation={onRegisterCupRegulation} onReviewPlanning={onReviewPlanning} onConfirmPlanning={onConfirmPlanning} onReviewContinental={onReviewContinental} onConfirmContinental={onConfirmContinental} tournaments={tournaments} allTournaments={allTournaments} allActivity={allActivityEvents} universeLibrary={universeLibrary} onSelectUniverse={onSelectUniverse} activity={activityEvents ?? []} onOpen={onOpen} onCalendar={onOpenCalendar} onAlerts={onOpenAlerts} />}
          <div className="history-tabs" role="group" aria-label="Vista de biblioteca">
            <button
              aria-pressed={libraryView === "active"}
              className="small-action"
              onClick={() => setLibraryView("active")}
              type="button"
            >
              Torneos activos ({activeTournaments.length})
            </button>
            <button
              aria-pressed={libraryView === "archived"}
              className="small-action"
              onClick={() => setLibraryView("archived")}
              type="button"
            >
              Historial ({archivedTournaments.length})
            </button>
          </div>
          <div className="competition-controls" aria-label="Buscar, filtrar y ordenar torneos">
            <label>
              <span>Buscar competición</span>
              <input
                aria-label="Buscar por nombre de competición"
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Nombre de competición"
                type="search"
                value={searchTerm}
              />
            </label>
            <label>
              <span>Temporada</span>
              <select
                aria-label="Filtrar por temporada"
                onChange={(event) => setSeasonFilter(event.target.value)}
                value={seasonFilter}
              >
                <option value="">Todas las temporadas</option>
                {seasons.map((season) => <option key={season} value={season}>{season}</option>)}
                {tournaments.some(({ season }) => season === undefined)
                  && <option value="unregistered">No especificada</option>}
              </select>
            </label>
            <label>
              <span>Estado</span>
              <select
                aria-label="Filtrar por estado"
                onChange={(event) => setStatusFilter(event.target.value as ControlStatus | "")}
                value={statusFilter}
              >
                <option value="">Todos los estados</option>
                <option value="sin-comenzar">Sin comenzar</option>
                <option value="en-curso">En curso</option>
                <option value="finalizado">Finalizado</option>
                <option value="incompleto">Incompleto · revisar</option>
                <option value="indeterminado">Indeterminado</option>
              </select>
            </label>
            <label>
              <span>Ordenar por</span>
              <select
                aria-label="Ordenar torneos"
                onChange={(event) => setSortBy(event.target.value as TournamentSort)}
                value={sortBy}
              >
                <option value="season">Temporada</option>
                <option value="name">Nombre</option>
                <option value="progress">Avance</option>
              </select>
            </label>
          </div>
          {summaryTournament && (
            <CompetitionSummary
              tournament={summaryTournament}
              activity={allActivityEvents}
              onOpen={() => onOpen(summaryTournament)}
              onOpenCalendar={() => onOpenCalendar(summaryTournament)}
              onOpenAlerts={() => onOpenAlerts(summaryTournament)}
              onClose={() => setSummaryTournamentId(null)}
            />
          )}
          <label className="library-duplicate-setting">
            <span>Al duplicar</span>
            <select
              aria-label="Resultados de la copia"
              onChange={(event) => setDuplicateMode(event.target.value as DuplicateResultsMode)}
              value={duplicateMode}
            >
              <option value="reset">Reiniciar resultados (recomendado)</option>
              <option value="copy">Conservar resultados actuales</option>
            </select>
          </label>
          {libraryView === "archived" && comparableTournaments.length > 1 && (
            <section className="season-comparison" aria-label="Comparar temporadas">
              <h3>Comparar temporadas</h3>
              <div className="statistics-filters">
                {[0, 1].map((index) => (
                  <label key={index}>
                    <span>{index === 0 ? "Temporada" : "Con temporada"}</span>
                    <select
                      aria-label={index === 0 ? "Primera temporada" : "Segunda temporada"}
                      value={comparisonIds[index]}
                      onChange={(event) => setComparisonIds((current) => {
                        const next: [string, string] = [...current];
                        next[index] = event.target.value;
                        return next;
                      })}
                    >
                      <option value="">Seleccionar</option>
                      {comparableTournaments.map((saved) => (
                        <option
                          key={saved.id}
                          value={saved.id}
                          disabled={saved.id === comparisonIds[1 - index]}
                        >
                          {saved.name} · {saved.season}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              {comparison && (
                comparison.compatible && selectedComparison?.[0] && selectedComparison[1]
                  ? (
                    <ComparisonTable
                      current={selectedComparison[0]}
                      previous={selectedComparison[1]}
                      comparison={comparison}
                    />
                  )
                  : <p className="history-warning" role="note">{comparison.warning}</p>
              )}
            </section>
          )}
          <h3 className="library-section-title">
            {libraryView === "active" ? "Torneos activos o en curso" : "Temporadas archivadas"}
          </h3>
          {visibleTournaments.length === 0 ? (
            <p className="library-empty">
              {libraryTournaments.length === 0
                ? libraryView === "active"
                  ? "No hay torneos activos en la biblioteca."
                  : "Todavía no hay temporadas archivadas."
                : "No hay torneos que coincidan con la búsqueda y los filtros actuales."}
              {(searchTerm || seasonFilter || statusFilter) && " Ajusta o limpia los filtros para ver otras temporadas."}
              {(searchTerm || seasonFilter || statusFilter) && (
                <button className="small-action" onClick={() => {
                  setSearchTerm("");
                  setSeasonFilter("");
                  setStatusFilter("");
                }} type="button">
                  Limpiar filtros
                </button>
              )}
            </p>
          ) : <ul className="tournament-list">
            {visibleTournaments.map((tournament) => {
              const active = tournament.id === activeTournamentId;
              const season = tournament.season ? String(tournament.season) : undefined;
              const completionStatus = getTournamentCompletionStatus(tournament);
              const statistics = calculateTournamentStatistics(tournament);
              const finalStandings = getFinalStandings(tournament);
              const controlStatus = getControlStatus(tournament);
              const alertCounts = countCompetitionAlerts(getCompetitionAlerts(tournament));
              return (
                <li
                  aria-label={tournament.name}
                  className={`tournament-card${active ? " active" : ""}`}
                  key={tournament.id}
                >
                  <div className="tournament-card-topline">
                    <span className="tournament-type">
                      {getTournamentFormatLabel(tournament)}
                      {season ? ` · ${season}` : " · temporada no especificada"}
                    </span>
                    {active && <span className="active-tournament-badge">ACTIVO</span>}
                    {tournament.archived && <span className="archived-tournament-badge">ARCHIVADO</span>}
                  </div>
                  {renamingId === tournament.id ? (
                    <form
                      className="tournament-rename-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        saveRename(tournament);
                      }}
                    >
                      <label>
                        <span className="sr-only">Nuevo nombre para {tournament.name}</span>
                        <input
                          autoFocus
                          maxLength={80}
                          onChange={(event) => setRenameValue(event.target.value)}
                          value={renameValue}
                        />
                      </label>
                      <button className="small-action" type="submit">Guardar nombre</button>
                      <button
                        className="small-action"
                        onClick={() => setRenamingId(null)}
                        type="button"
                      >
                        Cancelar
                      </button>
                    </form>
                  ) : (
                    <h3 className="tournament-card-title">{tournament.name}</h3>
                  )}
                  <div className="tournament-card-meta">
                    <span>{tournament.teams.length} equipos</span>
                    <span className={completionStatus === "Finalizado"
                      ? "tournament-status finished"
                      : "tournament-status"}>
                      {getControlStatusLabel(controlStatus)}
                    </span>
                    <span>{statistics.played} disputados · {statistics.pending} pendientes</span>
                    <span>{statistics.played}/{tournament.matchdays
                      .reduce((count, matchday) => count + matchday.fixtures.length, 0)} resultados</span>
                    <span>{getProgressText(tournament)}</span>
                    <span>Creado {formatCreatedAt(tournament.createdAt)}</span>
                  </div>
                  <div className="tournament-alert-summary" aria-label={`Alertas de ${tournament.name}`}>
                    <span>Incidencias: {alertCounts.total}</span>
                    {alertCounts.critical > 0 && <span>Críticas {alertCounts.critical}</span>}
                    {alertCounts.warning > 0 && <span>Advertencias {alertCounts.warning}</span>}
                    {alertCounts.informative > 0 && <span>Informativas {alertCounts.informative}</span>}
                  </div>
                  {(statistics.incomplete > 0 || statistics.invalidDetails > 0) && (
                    <p className="history-warning" role="note">
                      {statistics.incomplete > 0
                        && `${statistics.incomplete} resultado(s) incompleto(s) o inválido(s). `}
                      {statistics.invalidDetails > 0
                        && `${statistics.invalidDetails} partido(s) con detalles inválidos.`}
                    </p>
                  )}
                  {tournament.archived && (
                    <div className="history-summary">
                      <span>Estadísticas: {statistics.played} partidos · {statistics.totalGoals} goles · promedio {statistics.averageGoals.toFixed(2)}</span>
                      <span>Campeón: {championText(tournament, statistics, allActivityEvents, "No confirmado")}</span>
                      {finalStandings && (
                        <details>
                          <summary>Consultar tabla final</summary>
                          <ol>
                            {finalStandings.map((standing) => (
                              <li key={standing.teamId}>
                                {standing.teamName}: {standing.points} pts · {standing.goalDifference > 0 ? "+" : ""}
                                {standing.goalDifference} DG · {standing.wins}-{standing.draws}-{standing.losses}
                              </li>
                            ))}
                          </ol>
                        </details>
                      )}
                    </div>
                  )}
                  {creatingSeasonId === tournament.id && (
                    <form
                      className="new-season-form"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        try { await runWrite(() => {
                          const created = onCreateSeason(
                            tournament,
                            Number(seasonValue),
                            copySquadForSeason,
                          );
                          setCreatingSeasonId(null);
                          setSeasonValue("");
                          setCopySquadForSeason(false);
                          setMessage(`Se creó la temporada ${created.season}; la anterior permanece intacta.`);
                          setError("");
                         }); } catch (seasonError) {
                          setError(seasonError instanceof Error
                            ? seasonError.message
                            : "No se pudo iniciar la nueva temporada.");
                        }
                      }}
                    >
                      <label>
                        <span>Nueva temporada</span>
                        <input
                          aria-label={`Año de nueva temporada para ${tournament.name}`}
                          min="1"
                          step="1"
                          type="number"
                          value={seasonValue}
                          onChange={(event) => setSeasonValue(event.target.value)}
                        />
                      </label>
                      {(tournament.players?.length ?? 0) > 0 && (
                        <label className="copy-squad-option">
                          <input
                            aria-label="Copiar plantilla de la temporada anterior"
                            checked={copySquadForSeason}
                            onChange={(event) => setCopySquadForSeason(event.target.checked)}
                            type="checkbox"
                          />
                          Copiar plantilla (acción explícita)
                        </label>
                      )}
                      <button className="small-action" type="submit">Crear y abrir temporada</button>
                      <button className="small-action secondary-action" type="button" onClick={() => setCreatingSeasonId(null)}>
                        Cancelar
                      </button>
                    </form>
                  )}
                  <div className="tournament-card-actions">
                    <button
                      aria-expanded={summaryTournamentId === tournament.id}
                      className="small-action"
                      onClick={() => setSummaryTournamentId((current) =>
                        current === tournament.id ? null : tournament.id)}
                      type="button"
                    >
                      {summaryTournamentId === tournament.id ? "Cerrar resumen" : "Ver resumen"}
                    </button>
                    <button
                      className="small-action primary-library-action"
                      onClick={() => onOpen(tournament)}
                      type="button"
                    >
                      {active ? "Volver al torneo activo" : "Abrir torneo"}
                    </button>
                    <button
                      className="small-action"
                      onClick={() => onOpenActivity?.(tournament)}
                      type="button"
                    >
                      Auditoría
                    </button>
                    <button
                      className="small-action"
                      onClick={() => beginRename(tournament)}
                      type="button"
                    >
                      Renombrar
                    </button>
                    <button
                      className="small-action"
                      onClick={() => exportTournament(tournament)}
                      type="button"
                    >
                      Exportar
                    </button>
                    <button
                      className="small-action"
                      onClick={() => duplicate(tournament)}
                      type="button"
                    >
                      Duplicar
                    </button>
                    {canStartNewSeason(tournament) && !tournament.archived && (
                      <button
                        className="small-action"
                        onClick={() => {
                          setCreatingSeasonId(tournament.id);
                          setSeasonValue("");
                          setError("");
                          setMessage("");
                        }}
                        type="button"
                      >
                        Nueva temporada
                      </button>
                    )}
                    <button
                      className="small-action"
                      onClick={async () => {
                        try { await runWrite(() => {
                          onSetArchived(tournament, !tournament.archived);
                          setError("");
                          setMessage(tournament.archived
                            ? `Se restauró "${tournament.name}" a los torneos activos.`
                            : `Se archivó "${tournament.name}" sin eliminar sus resultados.`);
                         }); } catch (archiveError) {
                          setError(archiveError instanceof Error
                            ? archiveError.message
                            : "No se pudo cambiar el estado del archivo.");
                        }
                      }}
                      type="button"
                    >
                      {tournament.archived ? "Desarchivar" : "Archivar"}
                    </button>
                    <button
                      className="small-action danger-library-action"
                      onClick={() => setDeleteTarget(tournament)}
                      type="button"
                    >
                      Eliminar
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>}
        </>
      )}
      <ConfirmationDialog
        open={deleteTarget !== null}
        title="¿Eliminar este torneo?"
        description={deleteTarget
          ? `Vas a eliminar "${deleteTarget.name}". Esta acción no se puede deshacer.`
          : ""}
        warning="Solo se eliminará este torneo. Los otros campeonatos guardados no se modificarán."
        eyebrow="ELIMINAR CAMPEONATO"
        icon="!"
        confirmLabel="Sí, eliminar torneo"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try { await runWrite(() => {
            onDelete(deleteTarget);
            setMessage(`Se eliminó "${deleteTarget.name}".`);
            setError("");
           }); } catch (deleteError) {
            setError(deleteError instanceof Error ? deleteError.message : "No se pudo eliminar el campeonato.");
          }
          setDeleteTarget(null);
        }}
      />
      <ConfirmationDialog
        open={pendingImport !== null}
        title={pendingImportIsCompetitionConflict
          ? "Esta competición y temporada ya están guardadas"
          : "Este torneo ya está guardado"}
        description={pendingImport
          ? pendingImportIsCompetitionConflict && pendingImportConflict
            ? `"${pendingImport.name}" coincide con "${pendingImportConflict.name}" (ID: ${pendingImportConflict.id}) para la competición ${pendingImport.competitionId}, temporada ${pendingImport.season}. Puedes actualizar ese torneo o crear una copia independiente.`
            : `"${pendingImport.name}" (ID: ${pendingImport.id}) ya existe. Puedes crear una copia con identificadores nuevos o reemplazar sus datos por los del archivo.`
          : ""}
        warning={pendingImportIsCompetitionConflict
          ? "Actualizar reemplaza los datos del torneo existente de esa competición y temporada."
          : "Actualizar reemplaza los datos del torneo con ese identificador. La acción no se puede deshacer."}
        eyebrow="IMPORTAR TORNEO"
        icon="↓"
        confirmLabel="Crear copia independiente"
        alternateActions={[{
          label: "Actualizar torneo existente",
          onSelect: updateExisting,
        }]}
        onCancel={() => setPendingImport(null)}
        onConfirm={importAsCopy}
      />
      <ConfirmationDialog
        open={pendingBackup !== null}
        title="Restaurar respaldo"
        description={pendingBackup
          ? `El archivo "${backupFileName}" es JSON v${pendingBackup.version}${pendingBackup.exportedAt ? `, generado ${formatBackupDate(pendingBackup.exportedAt)}` : " antiguo sin fecha de exportación disponible"}. Revisa el alcance y los conflictos antes de confirmar.`
          : ""}
        details={pendingBackup ? (
          <div className="save-recovery-preview">
            <dl className="save-recovery-facts">
              <div><dt>Torneos que se incorporarían</dt><dd>{pendingBackup.tournaments.length}</dd></div>
              <div><dt>Nuevos al combinar</dt><dd>{pendingBackup.tournaments.length - backupIdConflicts.length}</dd></div>
              <div><dt>Locales reemplazados si reemplazas</dt><dd>{allTournaments.length}</dd></div>
              <div><dt>Locales conservados al combinar</dt><dd>{allTournaments.length}</dd></div>
              <div><dt>IDs que ya existen y se conservarían al combinar</dt><dd>{backupIdConflicts.length}</dd></div>
              <div><dt>Universos en el respaldo</dt><dd>{pendingBackup.universes?.universes.length ?? "No incluidos"}</dd></div>
              <div><dt>Eventos de actividad</dt><dd>{pendingBackup.activity.length}</dd></div>
              <div><dt>Universos locales reemplazados</dt><dd>{universeLibrary.universes.length} si reemplazas</dd></div>
            </dl>
            <p>
              {pendingBackup.universes
                ? "Al reemplazar se usarán los universos del archivo; al combinar se conservan los locales y se agregan las asignaciones compatibles."
                : "Este respaldo no incluye metadatos de universos. Al reemplazar, sus torneos quedarán sin asignar; al combinar, los universos locales se conservan."}
            </p>
            {backupIdConflicts.length > 0 && (
              <p>
                IDs coincidentes: {backupIdConflicts.slice(0, 4).map(({ id }) => id).join(", ")}
                {backupIdConflicts.length > 4 ? ` y ${backupIdConflicts.length - 4} más` : ""}.
                Al combinar, se conservan los torneos locales y no se reemplazan sus resultados.
              </p>
            )}
            {backupSeasonConflicts.length > 0 && (
              <div className="save-recovery-preview-conflict">
                <strong>Coincidencias de competición/temporada con IDs diferentes:</strong>
                <p>La combinación existente por ID permite incorporar ambos registros; no actualizará ni fusionará resultados.</p>
                <ul>
                  {backupSeasonConflicts.slice(0, 4).map(({ incoming, conflict }) => (
                    <li key={`${incoming.id}:${conflict.id}`}>
                      {incoming.competitionId} · {incoming.season}: {incoming.name} ({incoming.id})
                      {" "}y {conflict.name} ({conflict.id}).
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {backupUniverseConflicts.length > 0 && (
              <div role="alert">
                <strong>Combinación bloqueada por identidades de universos:</strong>
                <ul>{backupUniverseConflicts.map((conflict) => <li key={conflict}>{conflict}</li>)}</ul>
              </div>
            )}
            {backupUnavailableReason && (
              <p role="note">
                Estado local no verificado: {backupUnavailableReason} La operación vuelve a validar el almacenamiento
                y se abortará sin escribir si no puede combinarse con seguridad.
              </p>
            )}
            <p>
              Las relaciones explícitas se validan de nuevo al restaurar. Las referencias a torneos ausentes
              no se reconstruyen por nombres ni por IDs ambiguos; una incompatibilidad bloquea la escritura.
            </p>
          </div>
        ) : null}
        warning={backupUnavailableReason
          ? `Reemplazar elimina la biblioteca local. El estado actual no se pudo validar por completo: ${backupUnavailableReason} Exporta primero los datos originales de recuperación; no se garantiza una copia local restaurable.`
          : "Reemplazar elimina los torneos y universos locales que no estén en el archivo. El repositorio conserva una copia local previa cuando el estado guardado es válido y aborta si falla una escritura requerida."}
        eyebrow="RESPALDO VALIDADO"
        icon="↻"
        confirmLabel="Reemplazar biblioteca"
        alternateActions={backupMergeBlocked ? [] : [{
          label: `Combinar (${pendingBackup
            ? pendingBackup.tournaments.length - backupIdConflicts.length
            : 0} nuevos; conservar ${backupIdConflicts.length} existentes)`,
          onSelect: () => restoreBackup("merge"),
        }]}
        onCancel={() => setPendingBackup(null)}
        onConfirm={() => restoreBackup("replace")}
      />
    </section>
  );
}

function normalizeSearch(value: string): string {
  return value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
}

/** The verified champion keeps its plain name; simulated or calculated champions always carry their tier. */
function championText(tournament: Tournament, statistics: ReturnType<typeof calculateTournamentStatistics>,
  activity: readonly ActivityEvent[], fallback: string): string {
  const name = (id: string) => tournament.teams.find(team => team.id === id)?.name ?? "Desconocido";
  if (statistics.championTeamId) return name(statistics.championTeamId);
  if (statistics.sportingChampionTeamId)
    return `${name(statistics.sportingChampionTeamId)} · ${championTierLabels[unverifiedTier(tournament, activity)]}`;
  return fallback;
}

function CompetitionSummary({
  tournament,
  activity = [],
  onOpen,
  onOpenCalendar,
  onOpenAlerts,
  onClose,
}: {
  tournament: Tournament;
  activity?: readonly ActivityEvent[];
  onOpen: () => void;
  onOpenCalendar: () => void;
  onOpenAlerts: () => void;
  onClose: () => void;
}) {
  const statistics = calculateTournamentStatistics(tournament);
  const teamsById = new Map(tournament.teams.map(({ id, name }) => [id, name]));
  const fixtures = tournament.matchdays.flatMap((matchday) =>
    matchday.fixtures.map((fixture) => ({ matchday, fixture })));
  const upcoming = fixtures.filter(({ fixture }) =>
    !fixture.result && getOperationalMatchStatus(fixture) === "scheduled").slice(0, 3);
  const operationalSummary = [
    statistics.postponed > 0 ? `Aplazados: ${statistics.postponed}` : "",
    statistics.suspended > 0 ? `Suspendidos: ${statistics.suspended}` : "",
    statistics.cancelled > 0 ? `Cancelados: ${statistics.cancelled}` : "",
  ].filter(Boolean).join(" · ") || "Sin aplazados, suspendidos ni cancelados";
  const recentResults = fixtures
    .filter(({ matchday, fixture }) => isValidPlayedFixture(tournament, matchday, fixture))
    .slice(-3)
    .reverse();
  const showsStandings = tournament.competitionType !== "cup"
    && tournament.format !== "staged"
    && !tournament.teams.some((team) => team.groupName);
  const hasKnockoutStages = Boolean(tournament.knockoutStages?.length);
  const teamName = (id: string) => teamsById.get(id) ?? "Equipo no identificado";

  return (
    <section className="competition-summary" aria-label={`Resumen de ${tournament.name}`}>
      <div className="competition-summary-heading">
        <div>
          <span className="eyebrow">RESUMEN DE COMPETICIÓN</span>
          <h3>{tournament.name}{tournament.season ? ` · ${tournament.season}` : ""}</h3>
        </div>
        <button className="small-action" onClick={onClose} type="button">Cerrar resumen</button>
      </div>
      <dl className="competition-summary-facts">
        <div><dt>País / confederación</dt><dd>No registrado</dd></div>
        <div><dt>Formato</dt><dd>{getTournamentFormatLabel(tournament)}</dd></div>
        <div><dt>Equipos</dt><dd>{tournament.teams.length}</dd></div>
        <div><dt>Estado</dt><dd>{getControlStatusLabel(getControlStatus(tournament))}</dd></div>
        <div><dt>Partidos</dt><dd>{statistics.played} disputados · {statistics.pending} pendientes</dd></div>
        <div><dt>Avance</dt><dd>{getProgressText(tournament)}</dd></div>
        <div><dt>Campeón</dt><dd>{championText(tournament, statistics, activity, "No confirmado")}</dd></div>
        <div><dt>Estados operativos pendientes</dt><dd>{operationalSummary}</dd></div>
      </dl>
      {statistics.progressPercent > 0 && (tournament.format === "staged"
        || tournament.competitionType === "cup") && (
        <p className="history-warning" role="note">
          El porcentaje refleja solo los partidos ya programados; no representa etapas futuras que aún no estén cargadas.
        </p>
      )}
      {(statistics.incomplete > 0 || statistics.invalidDetails > 0) && (
        <p className="history-warning" role="alert">
          {statistics.incomplete > 0
            && `${statistics.incomplete} partido(s) tienen resultados incompletos o inválidos. `}
          {statistics.invalidDetails > 0
            && `${statistics.invalidDetails} partido(s) tienen detalles individuales inválidos, excluidos de esas estadísticas.`}
        </p>
      )}
      {!statistics.sportingChampionTeamId && getTournamentCompletionStatus(tournament) === "Indeterminado" && (
        <p className="history-warning" role="note">
          El formato o las etapas pendientes no permiten confirmar el campeón con los datos actuales.
        </p>
      )}
      <div className="competition-summary-columns">
        {showsStandings && (
          <section aria-label="Tabla de posiciones resumida">
            <h4>Posiciones</h4>
            <ol className="competition-summary-standings">
              {statistics.standings.slice(0, 5).map((standing) => (
                <li key={standing.teamId}>
                  <span>{standing.teamName}</span><strong>{standing.points} pts</strong>
                </li>
              ))}
            </ol>
            {statistics.standings.length === 0 && <p className="muted">Sin equipos para mostrar.</p>}
          </section>
        )}
        {hasKnockoutStages && (
          <section aria-label="Estado de eliminatorias">
            <h4>Eliminatorias</h4>
            <ul className="competition-summary-standings">
              {tournament.knockoutStages?.map((stage) => {
                const stageFixtures = fixtures.filter(({ matchday }) =>
                  matchday.phaseName?.toLocaleLowerCase("es").includes(stage.name.toLocaleLowerCase("es")));
                const stagePlayed = stageFixtures.filter(({ matchday, fixture }) =>
                  isValidPlayedFixture(tournament, matchday, fixture)).length;
                return (
                  <li key={stage.name}>
                    <span>{stage.name}</span>
                    <strong>{stageFixtures.length > 0
                      ? `${stagePlayed}/${stageFixtures.length} partidos`
                      : "Sin partidos programados"}</strong>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        <section aria-label="Próximos partidos">
          <h4>Próximos partidos</h4>
          {upcoming.length > 0 ? (
            <ul className="competition-summary-standings">
              {upcoming.map(({ matchday, fixture }) => (
                <li key={fixture.id}>
                  <span>{teamName(fixture.homeTeamId)} – {teamName(fixture.awayTeamId)}</span>
                  <small>{matchday.phaseName ?? `Fecha ${matchday.number}`}</small>
                </li>
              ))}
            </ul>
          ) : <p className="muted">No hay partidos pendientes con estado programado.</p>}
        </section>
        <section aria-label="Últimos resultados">
          <h4>Últimos resultados</h4>
          {recentResults.length > 0 ? (
            <ul className="competition-summary-standings">
              {recentResults.map(({ matchday, fixture }) => (
                <li key={fixture.id}>
                  <span>{teamName(fixture.homeTeamId)} {fixture.result?.homeGoals}–{fixture.result?.awayGoals} {teamName(fixture.awayTeamId)}</span>
                  <small>{matchday.phaseName ?? `Fecha ${matchday.number}`}</small>
                </li>
              ))}
            </ul>
          ) : <p className="muted">Todavía no hay resultados válidos.</p>}
        </section>
      </div>
      <details className="competition-summary-scorers">
        <summary>Estadísticas y goleadores</summary>
        <p>{statistics.played} partidos válidos · {statistics.totalGoals} goles · promedio {statistics.averageGoals.toFixed(2)}.</p>
        {statistics.topScorers.length > 0 ? (
          <ol>
            {statistics.topScorers.slice(0, 5).map((scorer, index) => (
              <li key={`${scorer.teamId}-${scorer.playerId ?? scorer.playerName}-${index}`}>
                {scorer.playerName} · {scorer.teamName} · {scorer.goals} goles
              </li>
            ))}
          </ol>
        ) : <p className="muted">Sin datos individuales de goleadores suficientes.</p>}
      </details>
      <div className="competition-summary-actions">
        <button className="small-action" onClick={onOpenAlerts} type="button">
          Centro de alertas
        </button>
        <button className="small-action" onClick={onOpenCalendar} type="button">
          Abrir calendario de partidos
        </button>
        <button className="small-action primary-library-action" onClick={onOpen} type="button">
          Abrir torneo y estadísticas
        </button>
      </div>
    </section>
  );
}

function ComparisonTable({
  current,
  previous,
  comparison,
}: {
  current: Tournament;
  previous: Tournament;
  comparison: ReturnType<typeof compareTournamentSeasons>;
}) {
  const currentStatistics = calculateTournamentStatistics(current);
  const previousStatistics = calculateTournamentStatistics(previous);
  const currentPositions = new Map(currentStatistics.standings
    .map((standing, index) => [standing.teamId, index + 1]));
  const previousPositions = new Map(previousStatistics.standings
    .map((standing, index) => [standing.teamId, index + 1]));

  return (
    <div className="statistics-table-scroll">
      <p className="history-warning">
        Comparación de tabla final: {current.season} frente a {previous.season}.
        {" "}Los equipos emparejados por nombre son posibles coincidencias, no identidades confirmadas.
      </p>
      <table className="statistics-table">
        <thead>
          <tr>
            <th>Equipo actual</th><th>Identidad</th><th>Pos.</th><th>Pts</th>
            <th>G-E-P</th><th>GF-GC-DG</th><th>Local G-E-P</th><th>Visita G-E-P</th>
            <th>Equipo anterior</th><th>Pos.</th><th>Pts</th><th>G-E-P</th><th>GF-GC-DG</th>
            <th>Local G-E-P</th><th>Visita G-E-P</th>
          </tr>
        </thead>
        <tbody>
          {comparison.teams.map((row, index) => {
            const currentHomeAway = row.current
              ? currentStatistics.homeAway.get(row.current.teamId)
              : undefined;
            const previousHomeAway = row.previous
              ? previousStatistics.homeAway.get(row.previous.teamId)
              : undefined;
            const previousPosition = row.previous
              ? previousPositions.get(row.previous.teamId)
              : undefined;
            const currentPosition = row.current
              ? currentPositions.get(row.current.teamId)
              : undefined;
            return (
              <tr key={`${row.current?.teamId ?? row.currentTeamName}-${index}`}>
                <th scope="row">{row.currentTeamName}</th>
                <td>{row.identity === "stable-id"
                  ? "ID estable"
                  : row.identity === "average-identity"
                    ? "Identidad estable"
                    : row.identity === "possible-name-match"
                      ? "Posible por nombre"
                      : "Sin coincidencia"}</td>
                <td>{currentPosition ?? "—"}</td>
                <td>{row.current?.points ?? "—"}</td>
                <td>{recordText(row.current?.wins, row.current?.draws, row.current?.losses)}</td>
                <td>{recordText(row.current?.goalsFor, row.current?.goalsAgainst, row.current?.goalDifference)}</td>
                <td>{homeAwayText(currentHomeAway, "home")}</td>
                <td>{homeAwayText(currentHomeAway, "away")}</td>
                <td>{row.previousTeamName ?? "—"}</td>
                <td>{previousPosition ?? "—"}</td>
                <td>{row.previous?.points ?? "—"}</td>
                <td>{recordText(row.previous?.wins, row.previous?.draws, row.previous?.losses)}</td>
                <td>{recordText(row.previous?.goalsFor, row.previous?.goalsAgainst, row.previous?.goalDifference)}</td>
                <td>{homeAwayText(previousHomeAway, "home")}</td>
                <td>{homeAwayText(previousHomeAway, "away")}</td>
              </tr>
            );
          })}
          {comparison.teams.length === 0 && (
            <tr><td colSpan={15}>No hay equipos disponibles para comparar.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function recordText(first?: number, second?: number, third?: number): string {
  return first === undefined || second === undefined || third === undefined
    ? "—"
    : `${first}-${second}-${third}`;
}

function homeAwayText(
  value: {
    readonly homeWins: number;
    readonly homeDraws: number;
    readonly homeLosses: number;
    readonly awayWins: number;
    readonly awayDraws: number;
    readonly awayLosses: number;
  } | undefined,
  side: "home" | "away",
): string {
  if (!value) return "—";
  return side === "home"
    ? recordText(value.homeWins, value.homeDraws, value.homeLosses)
    : recordText(value.awayWins, value.awayDraws, value.awayLosses);
}

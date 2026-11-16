import { useLibraryWrite } from "../library-write-context";
import { useState, type Dispatch, type SetStateAction } from "react";
import type { SportsUniverseLibrary } from "../../domain/entities/sports-universe";
import type { Tournament } from "../../domain/entities/tournament";
import { ConfirmationDialog } from "./confirmation-dialog";

interface Props {
  library: SportsUniverseLibrary;
  tournaments: readonly Tournament[];
  allTournaments: readonly Tournament[];
  onSelect: (id: string | null) => void;
  onCreate?: (name: string, description: string) => void;
  onRename?: (id: string, name: string, description: string) => void;
  onDelete?: (id: string) => void;
  onAssign?: (ids: readonly string[], universeId: string | null) => void;
  manage?: boolean;
}

export function SportsUniverseControls({
  library,
  tournaments,
  allTournaments,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onAssign,
  manage = false,
}: Props) {
  const runWrite = useLibraryWrite();

  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [selectedAddIds, setSelectedAddIds] = useState<string[]>([]);
  const [selectedRemoveIds, setSelectedRemoveIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [pendingAction, setPendingAction] = useState<
    | { kind: "assign"; ids: string[]; universeId: string | null; contextUniverseId: string | null }
    | { kind: "delete"; universeId: string; contextUniverseId: string }
    | null
  >(null);
  const activeUniverse = library.universes.find(({ id }) => id === library.activeUniverseId);
  const candidates = activeUniverse
    ? allTournaments.filter(({ id }) => library.assignments[id] === undefined)
    : [];
  const currentIds = new Set(tournaments.map(({ id }) => id));
  function toggleId(id: string, setIds: Dispatch<SetStateAction<string[]>>) {
    setIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  }

  async function confirmAssignment() {
    if (!pendingAction || pendingAction.kind !== "assign") return;
    if (pendingAction.contextUniverseId !== library.activeUniverseId) {
      setPendingAction(null);
      setError("El universo activo cambió. Revisa nuevamente antes de reorganizar los torneos.");
      return;
    }
    try { await runWrite(() => {
      if (!onAssign) return;
      onAssign(pendingAction.ids, pendingAction.universeId);
      setSelectedAddIds([]);
      setSelectedRemoveIds([]);
      setError("");
      setPendingAction(null);
     }); } catch (actionError) {
      setPendingAction(null);
      setError(actionError instanceof Error ? actionError.message : "No se reorganizaron los torneos.");
    }
  }

  async function confirmDelete() {
    if (!pendingAction || pendingAction.kind !== "delete") return;
    if (pendingAction.contextUniverseId !== library.activeUniverseId) {
      setPendingAction(null);
      setError("El universo activo cambió. Revisa nuevamente antes de eliminarlo.");
      return;
    }
    try { await runWrite(() => {
      if (!onDelete) return;
      onDelete(pendingAction.universeId);
      setError("");
      setPendingAction(null);
     }); } catch (actionError) {
      setPendingAction(null);
      setError(actionError instanceof Error ? actionError.message : "No se eliminó el universo.");
    }
  }

  return (
    <section className="sports-universe-controls" aria-label="Universo deportivo">
      <label>
        Universo activo
        <select
          aria-label="Universo activo"
          value={library.activeUniverseId ?? ""}
          onChange={async (event) => { try {
            const nextId = event.target.value || null;
            if (nextId !== library.activeUniverseId) {
              setPendingAction(null);
              setSelectedAddIds([]);
              setSelectedRemoveIds([]);
              setError("");
            }
            await runWrite(() => onSelect(nextId));
           } catch (error) { setError(error instanceof Error ? error.message : "No se pudo guardar. Revisa los datos actuales."); }}}
        >
          <option value="">Biblioteca anterior · sin asignar</option>
          {library.universes.map((universe) => (
            <option key={universe.id} value={universe.id}>{universe.name}</option>
          ))}
        </select>
      </label>
      {activeUniverse?.description && <p>{activeUniverse.description}</p>}
      {manage && (
        <>
          <details>
            <summary>Crear universo</summary>
            <form onSubmit={async (event) => {
              event.preventDefault();
              try { await runWrite(() => {
                if (!onCreate) return;
                onCreate(newName, newDescription);
                setNewName("");
                setNewDescription("");
                setError("");
               }); } catch (createError) {
                setError(createError instanceof Error ? createError.message : "No se creó el universo.");
              }
            }}>
              <label>Nombre<input maxLength={80} required value={newName} onChange={(event) => setNewName(event.target.value)} /></label>
              <label>Descripción opcional<textarea maxLength={500} value={newDescription} onChange={(event) => setNewDescription(event.target.value)} /></label>
              <button className="small-action" type="submit">Crear y activar universo</button>
            </form>
          </details>
          {activeUniverse && (
            <>
              <details onToggle={(event) => {
                  if (event.currentTarget.open) {
                    setEditName(activeUniverse.name);
                    setEditDescription(activeUniverse.description ?? "");
                  }
                }}>
                <summary>Renombrar o editar descripción</summary>
                <form onSubmit={async (event) => {
                  event.preventDefault();
                  try { await runWrite(() => {
                    if (!onRename) return;
                    onRename(activeUniverse.id, editName, editDescription);
                    setEditName("");
                    setEditDescription("");
                    setError("");
                   }); } catch (editError) {
                    setError(editError instanceof Error ? editError.message : "No se editó el universo.");
                  }
                }}>
                  <label>Nombre<input maxLength={80} required value={editName} onChange={(event) => setEditName(event.target.value)} /></label>
                  <label>Descripción opcional<textarea maxLength={500} value={editDescription} onChange={(event) => setEditDescription(event.target.value)} /></label>
                  <button className="small-action" type="submit">Guardar cambios</button>
                </form>
              </details>
              <button
                className="small-action"
                onClick={() => setPendingAction({
                  kind: "delete",
                  universeId: activeUniverse.id,
                  contextUniverseId: activeUniverse.id,
                })}
                type="button"
              >
                Eliminar universo
              </button>
              <details>
                <summary>Incorporar torneos existentes ({candidates.length} disponibles)</summary>
                {candidates.length === 0 ? <p>No hay torneos sin asignar. Retira torneos de otro universo antes de trasladarlos.</p> : (
                  <>
                    <fieldset>
                      <legend>Selecciona los torneos para incorporar</legend>
                      {candidates.map((tournament) => (
                        <label key={tournament.id}>
                          <input checked={selectedAddIds.includes(tournament.id)} onChange={() => toggleId(tournament.id, setSelectedAddIds)} type="checkbox" />
                          {tournament.name} · {tournament.season ?? "sin temporada"}
                        </label>
                      ))}
                    </fieldset>
                    <button
                      className="small-action"
                      disabled={selectedAddIds.length === 0}
                      onClick={() => setPendingAction({
                        kind: "assign",
                        ids: selectedAddIds.filter((id) => candidates.some(({ id: candidateId }) => candidateId === id)),
                        universeId: activeUniverse.id,
                        contextUniverseId: activeUniverse.id,
                      })}
                      type="button"
                    >
                      Incorporar seleccionados
                    </button>
                  </>
                )}
              </details>
              {tournaments.length > 0 && (
                <details>
                  <summary>Retirar torneos de este universo ({tournaments.length})</summary>
                  <fieldset>
                    <legend>Selecciona los torneos que quedarán sin asignar</legend>
                    {tournaments.map((tournament) => (
                      <label key={tournament.id}>
                        <input checked={selectedRemoveIds.includes(tournament.id)} onChange={() => toggleId(tournament.id, setSelectedRemoveIds)} type="checkbox" />
                        {tournament.name} · {tournament.season ?? "sin temporada"}
                      </label>
                    ))}
                  </fieldset>
                  <button
                    className="small-action"
                    disabled={selectedRemoveIds.length === 0}
                    onClick={() => setPendingAction({
                      kind: "assign",
                      ids: selectedRemoveIds.filter((id) => currentIds.has(id)),
                      universeId: null,
                      contextUniverseId: activeUniverse.id,
                    })}
                    type="button"
                  >
                    Retirar seleccionados
                  </button>
                </details>
              )}
            </>
          )}
          {error && <p className="error-message" role="alert">{error}</p>}
          <ConfirmationDialog
            open={pendingAction !== null}
            title={pendingAction?.kind === "delete" ? "Eliminar universo" : "Confirmar reorganización"}
            description={pendingAction?.kind === "delete"
              ? `Se eliminará "${activeUniverse?.name ?? ""}" y sus asignaciones. Los torneos se conservarán en la biblioteca sin asignar.`
              : `${pendingAction?.universeId ? "Se incorporarán" : "Se retirarán"} ${pendingAction?.ids.length ?? 0} torneos. Las temporadas relacionadas deben quedar juntas para conservar dependencias e identidades explícitas.`}
            warning={pendingAction?.kind === "delete"
              ? "Esta operación no se puede deshacer desde la aplicación y no elimina los torneos."
              : "La operación se rechazará si deja una relación registrada entre universos distintos."}
            eyebrow="UNIVERSOS DEPORTIVOS"
            icon="◎"
            confirmLabel={pendingAction?.kind === "delete" ? "Eliminar universo" : "Confirmar"}
            onCancel={() => setPendingAction(null)}
            onConfirm={pendingAction?.kind === "delete" ? confirmDelete : confirmAssignment}
          />
        </>
      )}
    </section>
  );
}

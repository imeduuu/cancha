import { useMemo, useState } from "react";
import type { LibraryBackend } from "../../infrastructure/persistence/library-backend";
import { readLocalLibrary, writeMigrationMarker } from "../../infrastructure/persistence/local-library-migration";

type Mode = "merge" | "replace";

export const migrationCheckpointName = "Antes de migrar la biblioteca local";

/**
 * Ofrece llevar la biblioteca de este navegador a la cuenta (fase 5I), antes de abrir
 * la biblioteca de la cuenta. Nunca borra ni modifica la biblioteca local: sólo la
 * lee y la envía como respaldo (`restoreBackup`). Reemplazar crea antes un punto de
 * guardado en la cuenta.
 */
export function AccountMigration({ userId, backend, onDone }: {
  readonly userId: string;
  readonly backend: LibraryBackend;
  readonly onDone: () => void;
}) {
  const local = useMemo(() => readLocalLibrary(), []);
  const [accountTournaments, setAccountTournaments] = useState(() => backend.findAll().length);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ mode: Mode; added: number; skipped: number } | null>(null);
  const universeCount = local.universes.universes.length;
  const accountEmpty = accountTournaments === 0 && backend.findActivity().length === 0;

  async function migrate(mode: Mode) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (mode === "replace") {
        const checkpoints = backend.createCheckpointService?.(() => {});
        if (!checkpoints) throw new Error("No se puede proteger la biblioteca de la cuenta antes de reemplazarla.");
        await checkpoints.confirmCreation(
          await checkpoints.reviewCreation(migrationCheckpointName, "Copia automática antes de reemplazar con la biblioteca de este navegador."),
          true,
        );
      }
      const outcome = await backend.coordinate(backend.snapshot(), () =>
        backend.importTournaments(local.tournaments, mode, local.activity, false, local.universes));
      writeMigrationMarker(userId, {
        migratedAt: new Date().toISOString(),
        mode,
        tournaments: local.tournaments.length,
        activity: local.activity.length,
        universes: universeCount,
        added: outcome.added,
        skipped: outcome.skipped,
      });
      setResult({ mode, ...outcome });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo migrar la biblioteca.");
      setAccountTournaments(backend.findAll().length);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return <section className="account-migration" role="region" aria-label="Biblioteca de este navegador">
      <h2>Biblioteca migrada</h2>
      <p role="status">
        {result.mode === "replace" ? "Se reemplazó la biblioteca de tu cuenta" : "Se agregó a tu cuenta"}: {result.added} torneos
        {result.skipped > 0 ? ` (${result.skipped} ya existían y se conservaron los de tu cuenta)` : ""}.
      </p>
      {result.mode === "replace" && <p>Antes se guardó el punto «{migrationCheckpointName}» en tu cuenta.</p>}
      <p className="account-panel-note">La biblioteca de este navegador sigue intacta y vuelve a aparecer al cerrar sesión.</p>
      <button type="button" onClick={onDone}>Abrir la biblioteca de mi cuenta</button>
    </section>;
  }

  return <section className="account-migration" role="region" aria-label="Biblioteca de este navegador">
    <h2>¿Llevar la biblioteca de este navegador a tu cuenta?</h2>
    <p>
      Este navegador tiene {local.tournaments.length} torneos, {local.activity.length} eventos de historial y {universeCount} universos.
      Tu cuenta tiene {accountTournaments} torneos.
    </p>
    <p className="account-panel-note">La biblioteca de este navegador no se borra ni se modifica: se envía una copia.</p>

    {local.warnings.length > 0 ? <div role="alert">
      <p>La biblioteca de este navegador tiene datos dañados, así que no se migra una copia incompleta.</p>
      <p>{local.warnings.join(" ")}</p>
      <p>Cierra sesión y revisa la recuperación local antes de intentarlo de nuevo.</p>
    </div> : accountEmpty ? (
      <button type="button" disabled={busy} onClick={() => { void migrate("merge"); }}>{busy ? "Subiendo…" : "Subir a mi cuenta"}</button>
    ) : <>
      <button type="button" disabled={busy} onClick={() => { void migrate("merge"); }}>{busy ? "Agregando…" : "Agregar a mi cuenta"}</button>
      <p className="account-panel-note">Agregar conserva lo que ya tiene tu cuenta; los torneos con el mismo identificador no se duplican.</p>
      <fieldset className="account-migration-replace">
        <legend>Reemplazar la biblioteca de mi cuenta</legend>
        <label>
          <input type="checkbox" checked={replaceConfirmed} disabled={busy} onChange={event => setReplaceConfirmed(event.target.checked)} />
          Entiendo que la biblioteca de mi cuenta se reemplazará por la de este navegador. Antes se guardará el punto «{migrationCheckpointName}».
        </label>
        <button type="button" disabled={busy || !replaceConfirmed} onClick={() => { void migrate("replace"); }}>
          {busy ? "Reemplazando…" : "Reemplazar con la de este navegador"}
        </button>
      </fieldset>
    </>}

    {error && <p role="alert">{error}</p>}
    <button type="button" className="small-action" disabled={busy} onClick={onDone}>Ahora no</button>
  </section>;
}

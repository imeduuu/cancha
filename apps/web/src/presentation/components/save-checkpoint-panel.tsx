import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { checkpointMetadata, CheckpointValidationError, type CheckpointCreationReview, type CheckpointRestoreReview } from "@cancha/core/application/services/save-checkpoints";
import type { CheckpointService } from "../../infrastructure/persistence/checkpoint-service";
import type { SaveCheckpoint, CheckpointStatus } from "@cancha/core/domain/entities/save-checkpoint";
import { downloadText } from "../download-text";
import { ConfirmationDialog } from "./confirmation-dialog";

function rowId(raw: unknown): string | undefined {
  return raw && typeof raw === "object" && "id" in raw && typeof raw.id === "string" ? raw.id : undefined;
}
function rowName(raw: unknown): string {
  return raw && typeof raw === "object" && "name" in raw && typeof raw.name === "string" ? raw.name : "Punto con metadatos dañados";
}
function date(value: string) {
  return new Intl.DateTimeFormat("es-CL", {dateStyle: "medium", timeStyle: "short"}).format(new Date(value));
}
function size(bytes: number) { return `${(bytes / 1024).toLocaleString("es-CL", {maximumFractionDigits: 1})} KB`; }

export function SaveCheckpointPanel({service, suggestedName = "", onReturn}: {
  service: CheckpointService; suggestedName?: string; onReturn?: () => void;
}) {
  const server = service.location === "server";
  const [records, setRecords] = useState<unknown[]>([]);
  const [checks, setChecks] = useState<Map<string, {raw: unknown; status: CheckpointStatus; error?: string}>>(new Map());
  const [name, setName] = useState(suggestedName), [description, setDescription] = useState("");
  const [creation, setCreation] = useState<CheckpointCreationReview | null>(null);
  const [restoration, setRestoration] = useState<CheckpointRestoreReview | null>(null);
  const [deleting, setDeleting] = useState<{id: string; raw: unknown} | null>(null);
  const [editing, setEditing] = useState<{record: SaveCheckpoint; name: string; description: string} | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState(""), [readError, setReadError] = useState(""), [message, setMessage] = useState("");
  const [refreshNote, setRefreshNote] = useState("");
  const pending = useRef(false), nameInput = useRef<HTMLInputElement>(null);
  const dialogTrigger = useRef<HTMLElement | null>(null), heading = useRef<HTMLHeadingElement>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const readSequence = useRef(0);
  const reload = useCallback(async (verified?: SaveCheckpoint, background = false) => {
    const sequence = ++readSequence.current;
    if (!background) setLoading(true);
    try {
      const rows = await service.list();
      if (sequence !== readSequence.current) return;
      const nextRows = rows.map(raw => verified && rowId(raw) === verified.id ? verified : raw);
      setRecords(nextRows);
      setChecks(old => {
        const next = new Map<string, {raw: unknown; status: CheckpointStatus; error?: string}>();
        for (const raw of nextRows) {
          const id = rowId(raw), checked = id ? old.get(id) : undefined;
          if (id && checked && JSON.stringify(checked.raw) === JSON.stringify(raw)) next.set(id, {...checked, raw});
        }
        if (verified) next.set(verified.id, {raw: verified, status: "Disponible"});return next;
      });
      setReadError("");
    } catch (e) { if (sequence === readSequence.current) setReadError(e instanceof Error ? e.message : "Error de lectura de los puntos guardados."); }
    finally { if (sequence === readSequence.current) setLoading(false); }
  }, [service]);
  useEffect(() => {
    void reload();
    // Background reads must not insert a loading row above a button while the user is clicking it.
    const refresh = () => { if (!pending.current) void reload(undefined, true); };
    window.addEventListener("focus", refresh);
    if (typeof BroadcastChannel !== "undefined") {
      try {
        const broadcast = new BroadcastChannel("cancha.save-checkpoints");channel.current = broadcast;
        broadcast.onmessage = refresh;
      } catch { setRefreshNote("No se pudo activar la actualización entre pestañas. Usa Actualizar puntos; cada operación sigue revalidando sus datos."); }
    }
    return () => { window.removeEventListener("focus", refresh);channel.current?.close();channel.current = null; };
  }, [reload]);
  useEffect(() => { if (suggestedName) nameInput.current?.focus(); }, [suggestedName]);

  function returnDialogFocus() {
    const trigger = dialogTrigger.current;dialogTrigger.current = null;
    requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus();else heading.current?.focus();
    });
  }

  function rememberFailure(error: unknown, fallback?: unknown) {
    const raw = error instanceof CheckpointValidationError ? error.record ?? fallback : fallback;
    const id = rowId(raw);if (!id) return;
    setRecords(old => old.map(record => rowId(record) === id ? raw : record));
    setChecks(old => new Map(old).set(id, {raw, status: error instanceof CheckpointValidationError ? error.status : "Error de lectura",
      error: error instanceof Error ? error.message : "Error de lectura"}));
  }

  async function act(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;setBusy(true);setError("");setMessage("");
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo completar la operación.");setCreation(null);setRestoration(null);setDeleting(null);rememberFailure(e);await reload();if (dialogTrigger.current) returnDialogFocus(); }
    finally { pending.current = false;setBusy(false); }
  }
  async function changed(verified?: SaveCheckpoint) {
    try { channel.current?.postMessage("changed"); }
    catch { setRefreshNote("No se pudo notificar a otras pestañas. Actualiza sus listas de puntos antes de continuar."); }
    await reload(verified);
  }
  async function download(id: string) {
    const file = await service.download(id);downloadText(file.name, file.content, "application/json");
    setMessage("Se descargó el respaldo JSON v7 del punto de control.");
  }
  const rows = useMemo(() => records.map(raw => {
    const id = rowId(raw);let metadata: SaveCheckpoint | undefined;let status: CheckpointStatus = "Validación pendiente";let issue = "";
    try { metadata = checkpointMetadata(raw); }
    catch (e) { status = e instanceof CheckpointValidationError ? e.status : "Inválido";issue = e instanceof Error ? e.message : "Registro inválido."; }
    const checked = id ? checks.get(id) : undefined;
    if (metadata && checked && checked.raw === raw) { status = checked.status;issue = checked.error ?? ""; }
    if (metadata && readError) { status = "Error de lectura";issue = readError; }
    return {raw, id, metadata, status, issue};
  }).sort((a,b) => (b.metadata?.createdAt ?? "").localeCompare(a.metadata?.createdAt ?? "")), [records, checks, readError]);
  const filtered = rows.filter(row => rowName(row.raw).toLocaleLowerCase("es").includes(query.toLocaleLowerCase("es")));
  const comparison = restoration?.comparison;
  function ids(values: readonly string[]) { return values.length ? values.join(", ") : "Ninguno"; }

  return <section className="save-checkpoint-panel" aria-label="Puntos de control manuales" aria-busy={busy || loading}>
    <h4 ref={heading} tabIndex={-1}>Puntos de control manuales</h4>
    {server ? <>
      <p>Versiones de toda la biblioteca de tu cuenta, incluidos todos los universos y torneos sin asignar. Se guardan en el servidor (hasta 20) y son independientes del universo activo y del JSON descargado.</p>
      <p>Descarga los puntos importantes como respaldo externo.</p>
    </> : <>
      <p>Versiones locales de toda la biblioteca, incluidos todos los universos y torneos sin asignar. Son independientes del universo activo, del JSON descargado y de la recuperación automática.</p>
      <p>El navegador puede borrar este almacenamiento. Descarga los puntos importantes como respaldo externo.</p>
    </>}
    {onReturn && <button type="button" className="small-action" disabled={busy} onClick={onReturn}>Volver al contexto de origen</button>}
    {loading && <p role="status">Leyendo puntos guardados…</p>}
    <button type="button" className="small-action" disabled={busy || loading} onClick={() => void reload()}>Actualizar puntos</button>
    {readError && <p className="library-message" role="note">{readError} No se ha comprobado la disponibilidad de los puntos.</p>}
    {refreshNote && <p className="library-message" role="note">{refreshNote}</p>}
    <form onSubmit={event => { event.preventDefault();void act(async () => {setCreation(await service.reviewCreation(name, description));}); }}>
      <label>Nombre del punto<input ref={nameInput} required maxLength={120} value={name} disabled={busy} onChange={e => {setName(e.target.value);setCreation(null);}}/></label>
      <label>Descripción del punto (opcional)<textarea maxLength={1000} value={description} disabled={busy} onChange={e => {setDescription(e.target.value);setCreation(null);}}/></label>
      <button type="submit" className="small-action" disabled={busy || !!readError || loading || !name.trim()}>Revisar punto de control</button>
    </form>
    {creation && <section className="checkpoint-preview" aria-label="Vista previa del punto de control">
      <h5>{creation.checkpoint.name}</h5>
      <p>Biblioteca completa · {creation.checkpoint.tournamentCount} torneos · {creation.checkpoint.universeCount} universos · {creation.checkpoint.activityCount} eventos · {size(creation.checkpoint.sizeBytes)}</p>
      <p>Fecha: {date(creation.checkpoint.createdAt)} · JSON v7 · SHA-256</p>
      <button type="button" className="small-action" disabled={busy} onClick={() => void act(async () => {
        try {
          const record = await service.confirmCreation(creation, true);setCreation(null);await changed(record);
          setMessage(`Punto «${record.name}» guardado y verificado. No se modificó la biblioteca deportiva.`);
        } catch (e) { await reload();throw e; }
      })}>Confirmar creación del punto</button>
      <button type="button" className="small-action" disabled={busy} onClick={() => setCreation(null)}>Cancelar creación</button>
    </section>}
    {rows.length > 5 && <label>Buscar puntos<input type="search" value={query} onChange={e => setQuery(e.target.value)}/></label>}
    {!loading && !readError && !rows.length && <p>No hay puntos guardados. Crea uno antes de avanzar tu partida.</p>}
    {query && !filtered.length && <p>No hay puntos con ese nombre.</p>}
    <div className="checkpoint-list">{filtered.map((row,index) => <article key={row.id ?? `invalid-${index}`} aria-label={`Punto: ${rowName(row.raw)}`}>
      <h5>{rowName(row.raw)}</h5>
      {row.metadata && <><p><time dateTime={row.metadata.createdAt}>{date(row.metadata.createdAt)}</time> · {size(row.metadata.sizeBytes)}</p>
        <p>{row.metadata.description || "Sin descripción"}</p><p>{row.metadata.tournamentCount} torneos · {row.metadata.universeCount} universos · {row.metadata.activityCount} eventos</p></>}
      <p>Integridad: <strong>{row.status}</strong>{row.issue && ` · ${row.issue}`}</p>
      <details><summary>Detalles del punto</summary><p>ID: {row.id ?? "No disponible"}</p>
        {row.metadata && <><p>JSON v{row.metadata.backupVersion} · revisión de metadatos {row.metadata.revision}</p>
          <p>Huella SHA-256: <code>{row.metadata.integrity.digest}</code></p><p>Comprueba integridad del contenido; no acredita autenticidad ni certificación oficial.</p></>}
      </details>
      <div className="library-file-actions">
        <button type="button" className="small-action" disabled={busy || !row.id} onClick={() => void act(async () => {
          try {
            const record = await service.verify(row.id!);setRecords(old => old.map(raw => rowId(raw) === row.id ? record : raw));
            setChecks(old => new Map(old).set(row.id!, {raw: record, status: "Disponible"}));setMessage(`Integridad verificada: ${record.name}.`);
          } catch (e) {
            rememberFailure(e, row.raw);throw e;
          }
        })}>Verificar integridad</button>
        <button type="button" className="small-action" disabled={busy || !row.id || !row.metadata} onClick={() => void act(() => download(row.id!))}>Descargar JSON del punto</button>
        <button type="button" className="small-action" disabled={busy || !row.id || !row.metadata} onClick={event => {dialogTrigger.current = event.currentTarget;void act(async () => {setRestoration(await service.reviewRestoration(row.id!));});}}>Revisar restauración</button>
        {service.canEdit !== false && <button type="button" className="small-action" disabled={busy || !row.metadata} onClick={() => setEditing({record: row.metadata!, name: row.metadata!.name, description: row.metadata!.description})}>Editar nombre y descripción</button>}
        <button type="button" className="small-action" disabled={busy || !row.id} onClick={event => {dialogTrigger.current = event.currentTarget;setDeleting({id: row.id!, raw: row.raw});}}>Eliminar punto</button>
      </div>
    </article>)}</div>
    {editing && <form aria-label="Editar metadatos del punto" onSubmit={e => {e.preventDefault();void act(async () => {
      const record = await service.edit(editing.record.id, editing.record, editing.name, editing.description);setEditing(null);await changed(record);setMessage("Nombre y descripción actualizados. El respaldo permanece intacto.");
    });}}>
      <label>Nuevo nombre<input required maxLength={120} disabled={busy} value={editing.name} onChange={e => setEditing({...editing, name: e.target.value})}/></label>
      <label>Nueva descripción<textarea maxLength={1000} disabled={busy} value={editing.description} onChange={e => setEditing({...editing, description: e.target.value})}/></label>
      <button type="submit" className="small-action" disabled={busy}>Guardar metadatos</button><button type="button" className="small-action" disabled={busy} onClick={() => setEditing(null)}>Cancelar edición</button>
    </form>}
    {error && <p role="alert" className="error-message">{error}</p>}
    {message && <p role="status" className="library-message">{message}</p>}
    {busy && <p role="status">Operación en curso. Espera su confirmación.</p>}
    <ConfirmationDialog open={!!deleting} busy={busy} eyebrow={server ? "PUNTO DE CONTROL DE LA CUENTA" : "PUNTO DE CONTROL LOCAL"} title="Eliminar punto de control" description={`Se eliminará únicamente «${deleting ? rowName(deleting.raw) : ""}» ${server ? "de tu cuenta" : "del almacenamiento local"}. La biblioteca deportiva no cambia.`}
      warning="Esta eliminación no se puede deshacer. Puedes cancelar y descargar primero el punto."
      confirmLabel="Confirmar eliminación" onCancel={() => {setDeleting(null);returnDialogFocus();}} onConfirm={() => void act(async () => {
        if (!deleting) return;await service.delete(deleting.id, deleting.raw, true);setDeleting(null);await changed();setMessage("Punto eliminado. La biblioteca deportiva no cambió.");returnDialogFocus();
      })}/>
    <ConfirmationDialog open={!!restoration} busy={busy} eyebrow="REEMPLAZO DE LA BIBLIOTECA COMPLETA" title="Restaurar punto de control"
      description={`Se reemplazará toda la biblioteca por «${restoration?.checkpoint.name ?? ""}», incluidos actividad, universos y asignaciones. No se combinan resultados.`}
      warning={server
        ? "Se perderán los cambios posteriores que no estén en el punto, incluidas temporadas y resultados. Descarga primero el respaldo completo actual: con sesión no hay copia automática de recuperación."
        : "Se perderán los cambios posteriores que no estén en el punto, incluidas temporadas y resultados. Descarga primero el respaldo completo actual. La copia automática de recuperación depende del almacenamiento disponible; si falla su escritura, la restauración se aborta."}
      details={comparison && <div className="checkpoint-comparison" aria-label="Comparación con la biblioteca actual">
        <p>Torneos en ambos: {ids(comparison.sharedTournamentIds)}</p><p>Exclusivos del punto: {ids(comparison.checkpointOnlyIds)}</p><p>Exclusivos actuales que se retirarán: {ids(comparison.currentOnlyIds)}</p>
        <p>Torneos con cambios: {ids(comparison.changedTournamentIds)}</p><p>IDs con diferente competición o temporada: {ids(comparison.differentSeasonIds)}</p>
        <p>Universos en ambos: {ids(comparison.sharedUniverseIds)}</p><p>Universos exclusivos del punto: {ids(comparison.checkpointOnlyUniverses)}</p><p>Universos actuales ausentes del punto: {ids(comparison.currentOnlyUniverses)}</p><p>Metadatos de universo diferentes: {ids(comparison.changedUniverseIds)}</p>
        <p>Universo activo actual: {comparison.currentActiveUniverse ?? "Biblioteca sin asignar"}. Se restaurará: {comparison.checkpointActiveUniverse ?? "Biblioteca sin asignar"}.</p>
        <p>Marcadores registrados: {comparison.currentResults} actuales → {comparison.checkpointResults} en el punto. Se retirarán o reemplazarán {comparison.replacedResults} marcadores actuales.</p>
        <p>Actividad: {comparison.currentActivity} eventos actuales → {comparison.checkpointActivity} en el punto; se registrará la restauración mediante el mecanismo existente.</p>
      </div>}
      alternateActions={[{label: "Descargar respaldo actual antes de restaurar", onSelect: () => void act(async () => {const file = service.downloadCurrent();downloadText(file.name, file.content, "application/json");setMessage("Respaldo actual descargado. La restauración aún requiere confirmación.");})}]}
      confirmLabel="Confirmar reemplazo por el punto" onCancel={() => {setRestoration(null);returnDialogFocus();}} onConfirm={() => void act(async () => {
        if (!restoration) return;await service.confirmRestoration(restoration, true);setRestoration(null);setMessage("Biblioteca restaurada desde el punto de control.");
      })}/>
  </section>;
}

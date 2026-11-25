import { useState, type FormEvent } from "react";
import { useAccount } from "../account-context";

type Mode = "login" | "register";

const minimumPasswordLength = 12;

/** Ingreso, registro y cierre de sesión (fase 5F). */
export function AccountPanel({ onClose }: { readonly onClose: () => void }) {
  const account = useAccount();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [shareTournamentId, setShareTournamentId] = useState("");
  const [shareToken, setShareToken] = useState("");
  if (!account) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account || busy) return;
    setBusy(true);
    setError("");
    try {
      if (mode === "login") await account.login(email, password);
      else await account.register(email, password);
      setPassword("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo completar la operación.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (!account) return;
    setBusy(true);
    setError("");
    try {
      await account.logout();
    } catch (caught) {
      setError(`La sesión se cerró en este navegador, pero no se pudo avisar al servidor. ${caught instanceof Error ? caught.message : ""}`.trim());
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setError("");
  }

  return <section id="account-panel" className="account-panel" role="region" aria-label="Cuenta">
    <div className="account-panel-heading">
      <h2>Cuenta</h2>
      <button type="button" className="small-action" onClick={onClose}>Cerrar panel de cuenta</button>
    </div>

    {account.status === "restoring" && <p role="status">Recuperando tu sesión…</p>}

    {account.status === "signed-in" && account.user && <>
      <p>Sesión iniciada como <strong>{account.user.email}</strong>.</p>
      <p className="account-panel-note">Tu biblioteca se guarda en tu cuenta. La de este navegador no se modifica y vuelve a aparecer al cerrar sesión.</p>
      <section aria-label="Compartir torneo">
        <h3>Enlace público de solo lectura</h3>
        <label>ID del torneo<input value={shareTournamentId} onChange={event => setShareTournamentId(event.target.value)} /></label>
        <button type="button" disabled={busy || !shareTournamentId.trim()} onClick={() => { void (async () => {
          setBusy(true); setError("");
          try { const session = await account.session(); const result = await session.request<{ createTournamentShare: string }>("mutation CreateTournamentShare($id: ID!) { createTournamentShare(tournamentId: $id) }", { id: shareTournamentId.trim() }); setShareToken(result.createTournamentShare); }
          catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo crear el enlace."); }
          finally { setBusy(false); }
        })(); }}>{busy ? "Creando…" : "Crear enlace"}</button>
        <button type="button" disabled={busy || !shareTournamentId.trim()} onClick={() => { void (async () => {
          setBusy(true); setError("");
          try { const session = await account.session(); await session.request("mutation RevokeTournamentShares($id: ID!) { revokeTournamentShares(tournamentId: $id) }", { id: shareTournamentId.trim() }); setShareToken(""); }
          catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudieron revocar los enlaces."); }
          finally { setBusy(false); }
        })(); }}>Revocar todos los enlaces de este torneo</button>
        {shareToken && <div><label>URL pública<input readOnly value={window.location.origin + "/share/" + shareToken} onFocus={event => event.currentTarget.select()} /></label>
          <button type="button" disabled={busy} onClick={() => { void (async () => { setBusy(true); try { const session = await account.session(); await session.request("mutation RevokeTournamentShare($token: String!) { revokeTournamentShare(token: $token) }", { token: shareToken }); setShareToken(""); } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo revocar el enlace."); } finally { setBusy(false); } })(); }}>Revocar enlace</button></div>}
        {error && <p role="alert">{error}</p>}
      </section>
      <button type="button" disabled={busy} onClick={() => { void logout(); }}>{busy ? "Cerrando sesión…" : "Cerrar sesión"}</button>
    </>}

    {account.status === "anonymous" && <>
      <p className="account-panel-note">Sin cuenta todo sigue funcionando: tu biblioteca se guarda en este navegador.</p>
      {account.restoreError && <p role="alert">{account.restoreError}</p>}
      <div className="account-panel-modes" role="group" aria-label="Tipo de acceso">
        <button type="button" aria-pressed={mode === "login"} onClick={() => switchMode("login")}>Ingresar</button>
        <button type="button" aria-pressed={mode === "register"} onClick={() => switchMode("register")}>Crear cuenta</button>
      </div>
      <form onSubmit={event => { void submit(event); }} aria-label={mode === "login" ? "Ingresar a tu cuenta" : "Crear una cuenta"}>
        <label>
          Email
          <input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} />
        </label>
        <label>
          Contraseña
          <input
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={mode === "register" ? minimumPasswordLength : undefined}
            aria-describedby={mode === "register" ? "account-password-hint" : undefined}
            value={password}
            onChange={event => setPassword(event.target.value)}
          />
        </label>
        {mode === "register" && <p id="account-password-hint" className="account-panel-note">Al menos {minimumPasswordLength} caracteres.</p>}
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy}>
          {mode === "login" ? (busy ? "Entrando…" : "Entrar") : (busy ? "Creando la cuenta…" : "Registrarme")}
        </button>
      </form>
    </>}
  </section>;
}

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

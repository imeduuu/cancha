import { lazy } from "react";
import { useAccount } from "../account-context";
import { DeferredPanel } from "./deferred-panel";

const AccountPanel = lazy(() => import("./account-panel").then(module => ({ default: module.AccountPanel })));

/** Botón "Cuenta" de la cabecera; el panel (ingreso, registro, cierre de sesión) se carga al abrirlo. */
export function AccountAccess() {
  const account = useAccount();
  if (!account) return null;
  const open = account.panelOpen;
  const setOpen = account.setPanelOpen;
  const label = account.status === "signed-in" && account.user ? `Cuenta · ${account.user.email}` : "Cuenta";
  return <>
    <button
      type="button"
      className="topbar-nav account-access-button"
      aria-expanded={open}
      aria-controls="account-panel"
      onClick={() => setOpen(!open)}
    >{label}</button>
    {open && <DeferredPanel fallback={<p role="status" className="account-panel">Cargando cuenta…</p>}>
      <AccountPanel onClose={() => setOpen(false)} />
    </DeferredPanel>}
  </>;
}

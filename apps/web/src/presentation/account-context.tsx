import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AccountUser, AuthSession } from "../infrastructure/api/auth-session";
import { hasSessionHint } from "../infrastructure/api/session-hint";

/**
 * Estado de la cuenta en la web (fase 5F). El cliente de la API se carga de forma
 * diferida: sin la pista de sesión no se importa ni se hace ninguna petición, así
 * que el modo sin sesión queda igual que antes.
 */
export type AccountStatus = "anonymous" | "restoring" | "signed-in";

export interface AccountState {
  readonly status: AccountStatus;
  readonly user: AccountUser | null;
  /** La sesión guardada no se pudo recuperar por un problema de red (se reintenta al recargar). */
  readonly restoreError?: string;
}

export interface Account extends AccountState {
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  /** La sesión cargada (la usa la biblioteca con sesión). */
  session(): Promise<AuthSession>;
  /** El panel de cuenta sigue abierto aunque la aplicación se vuelva a montar al ingresar o salir. */
  readonly panelOpen: boolean;
  setPanelOpen(open: boolean): void;
}

const AccountContext = createContext<Account | null>(null);

export function useAccount(): Account | null {
  return useContext(AccountContext);
}

export type SessionLoader = () => Promise<AuthSession>;

const loadBrowserSession: SessionLoader = async () => {
  const [{ AuthSession }, { createGraphqlClient }] = await Promise.all([
    import("../infrastructure/api/auth-session"),
    import("../infrastructure/api/graphql-client"),
  ]);
  return new AuthSession({ client: createGraphqlClient() });
};

const anonymous: AccountState = { status: "anonymous", user: null };

export function AccountProvider({ children, loadSession = loadBrowserSession }: {
  readonly children: ReactNode;
  readonly loadSession?: SessionLoader;
}) {
  const [state, setState] = useState<AccountState>(() => hasSessionHint() ? { status: "restoring", user: null } : anonymous);
  const loaded = useRef<Promise<AuthSession> | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const session = useCallback((): Promise<AuthSession> => {
    if (!loaded.current) {
      loaded.current = loadSession().then(current => {
        // Un refresh rechazado en cualquier petición cierra la sesión: la vista lo refleja.
        current.subscribe(user => setState(user ? { status: "signed-in", user } : anonymous));
        return current;
      });
      loaded.current.catch(() => { loaded.current = null; });
    }
    return loaded.current;
  }, [loadSession]);

  useEffect(() => {
    if (!hasSessionHint()) return;
    let active = true;
    session()
      .then(current => current.restore())
      .then(
        user => { if (active) setState(user ? { status: "signed-in", user } : anonymous); },
        (error: unknown) => {
          if (!active) return;
          const reason = error instanceof Error ? error.message : "Error desconocido.";
          setState({ ...anonymous, restoreError: `No se pudo recuperar tu sesión. ${reason}` });
        },
      );
    return () => { active = false; };
  }, [session]);

  const value = useMemo<Account>(() => ({
    ...state,
    session,
    panelOpen,
    setPanelOpen,
    async login(email, password) {
      const user = await (await session()).login(email, password);
      setState({ status: "signed-in", user });
    },
    async register(email, password) {
      const user = await (await session()).register(email, password);
      setState({ status: "signed-in", user });
    },
    async logout() {
      try {
        await (await session()).logout();
      } finally {
        setState(anonymous);
      }
    },
  }), [state, session, panelOpen]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

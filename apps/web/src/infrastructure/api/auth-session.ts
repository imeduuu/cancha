import {
  ApiUnauthenticatedError,
  type GraphqlClient,
  type GraphqlVariables,
} from "./graphql-client";

/**
 * Sesión de la cuenta en el navegador (fase 5D).
 *
 * - El access token (JWT de 15 min) vive **sólo en memoria**: nunca en
 *   localStorage, sessionStorage ni cookies legibles por JavaScript.
 * - El refresh token es la cookie HttpOnly `cancha_refresh` (Path=/graphql) que
 *   fija la API; la web nunca la ve. `refreshToken` la rota en cada uso.
 * - Rotar el mismo refresh token dos veces (dos pestañas a la vez) es, para la API,
 *   reutilización: revoca la sesión entera. Por eso el refresh se deduplica dentro
 *   de la pestaña y se serializa entre pestañas con el Web Lock `cancha.auth-refresh`.
 *   La segunda pestaña refresca después, con la cookie ya rotada por la primera.
 * - `cancha.session.hint` en localStorage sólo dice "hubo una sesión en este
 *   navegador" (sin datos). Sin la pista, `restore()` no hace ninguna petición:
 *   el modo sin sesión no toca la red.
 */

export const sessionHintKey = "cancha.session.hint";
export const authRefreshLockName = "cancha.auth-refresh";
/** Se refresca antes de que venza para no enviar un token a punto de expirar. */
const refreshMarginMs = 30_000;

export interface AccountUser {
  readonly id: string;
  readonly email: string;
  readonly createdAt: string;
}

interface AuthPayload {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: string;
  readonly user: AccountUser;
}

const authFields = "accessToken accessTokenExpiresAt user { id email createdAt }";

/** Subconjunto de Storage usado para la pista (inyectable en pruebas). */
export type HintStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Subconjunto de LockManager (Web Locks API). */
export interface RefreshLocks {
  request<T>(name: string, options: { mode: "exclusive" }, callback: () => Promise<T>): Promise<T>;
}

export interface AuthSessionOptions {
  readonly client: GraphqlClient;
  /** null = sin almacenamiento (no se recuerda la sesión entre recargas). */
  readonly storage?: HintStorage | null;
  /** undefined = sin Web Locks: el refresh sólo se deduplica dentro de la pestaña. */
  readonly locks?: RefreshLocks;
  readonly now?: () => number;
}

export type AuthSessionListener = (user: AccountUser | null) => void;

function browserStorage(): HintStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function browserLocks(): RefreshLocks | undefined {
  try {
    return typeof navigator !== "undefined" && navigator.locks ? navigator.locks as unknown as RefreshLocks : undefined;
  } catch {
    return undefined;
  }
}

export class AuthSession {
  private readonly client: GraphqlClient;
  private readonly storage: HintStorage | null;
  private readonly locks: RefreshLocks | undefined;
  private readonly now: () => number;
  private accessToken: string | null = null;
  private expiresAt = 0;
  private currentUser: AccountUser | null = null;
  private refreshing: Promise<AccountUser> | null = null;
  private readonly listeners = new Set<AuthSessionListener>();

  constructor(options: AuthSessionOptions) {
    this.client = options.client;
    this.storage = options.storage === undefined ? browserStorage() : options.storage;
    this.locks = "locks" in options ? options.locks : browserLocks();
    this.now = options.now ?? Date.now;
  }

  get user(): AccountUser | null {
    return this.currentUser;
  }

  /** ¿Hubo una sesión en este navegador? (no implica que siga vigente). */
  hasHint(): boolean {
    try {
      return this.storage?.getItem(sessionHintKey) === "1";
    } catch {
      return false;
    }
  }

  subscribe(listener: AuthSessionListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /**
   * Recupera la sesión al cargar la página. Sin pista: null sin tocar la red. Si la
   * cookie ya no sirve: borra la pista y devuelve null. Un error de red se relanza
   * (la pista se conserva: se reintenta en la próxima carga).
   */
  async restore(): Promise<AccountUser | null> {
    if (!this.hasHint()) return null;
    try {
      return await this.refresh();
    } catch (error) {
      if (error instanceof ApiUnauthenticatedError) return null;
      throw error;
    }
  }

  async register(email: string, password: string): Promise<AccountUser> {
    return this.authenticate("register", email, password);
  }

  async login(email: string, password: string): Promise<AccountUser> {
    return this.authenticate("login", email, password);
  }

  /** Cierra la sesión en el servidor y localmente. Lo local se borra aunque la red falle. */
  async logout(): Promise<void> {
    const token = this.accessToken;
    this.signOutLocally();
    if (!token) return;
    try {
      await this.client.request<{ logout: boolean }>("mutation { logout }", undefined, { token });
    } catch (error) {
      if (!(error instanceof ApiUnauthenticatedError)) throw error;
    }
  }

  /**
   * Petición autenticada. Refresca antes si el token falta o está por vencer, y
   * ante UNAUTHENTICATED refresca y reintenta **una** vez. Si el refresh también
   * falla por autenticación, la sesión se cierra localmente y se relanza.
   */
  async request<T>(query: string, variables?: GraphqlVariables): Promise<T> {
    if (!this.accessToken || this.now() >= this.expiresAt - refreshMarginMs) await this.refresh();
    try {
      return await this.client.request<T>(query, variables, { token: this.accessToken });
    } catch (error) {
      if (!(error instanceof ApiUnauthenticatedError)) throw error;
      await this.refresh();
      return this.client.request<T>(query, variables, { token: this.accessToken });
    }
  }

  /** Rota el refresh token. Deduplicado en la pestaña y serializado entre pestañas. */
  refresh(): Promise<AccountUser> {
    if (this.refreshing) return this.refreshing;
    const rotate = () => this.client.request<{ refreshToken: AuthPayload }>(`mutation { refreshToken { ${authFields} } }`);
    const pending = (this.locks ? this.locks.request(authRefreshLockName, { mode: "exclusive" }, rotate) : rotate())
      .then(({ refreshToken }) => this.apply(refreshToken))
      .catch((error: unknown) => {
        if (error instanceof ApiUnauthenticatedError) this.signOutLocally();
        throw error;
      })
      .finally(() => { this.refreshing = null; });
    this.refreshing = pending;
    return pending;
  }

  private async authenticate(operation: "register" | "login", email: string, password: string): Promise<AccountUser> {
    const data = await this.client.request<Record<typeof operation, AuthPayload>>(
      `mutation Authenticate($input: CredentialsInput!) { ${operation}(input: $input) { ${authFields} } }`,
      { input: { email, password } },
    );
    return this.apply(data[operation]);
  }

  private apply(payload: AuthPayload): AccountUser {
    this.accessToken = payload.accessToken;
    const expiresAt = Date.parse(payload.accessTokenExpiresAt);
    this.expiresAt = Number.isFinite(expiresAt) ? expiresAt : this.now();
    const changed = this.currentUser?.id !== payload.user.id;
    this.currentUser = payload.user;
    this.writeHint(true);
    if (changed) this.notify();
    return payload.user;
  }

  private signOutLocally(): void {
    const hadUser = this.currentUser !== null;
    this.accessToken = null;
    this.expiresAt = 0;
    this.currentUser = null;
    this.writeHint(false);
    if (hadUser) this.notify();
  }

  private writeHint(present: boolean): void {
    try {
      if (present) this.storage?.setItem(sessionHintKey, "1");
      else this.storage?.removeItem(sessionHintKey);
    } catch {
      // Sin almacenamiento la sesión dura lo que la pestaña.
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.currentUser);
  }
}

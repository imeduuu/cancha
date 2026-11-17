import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore,
  type ReactNode, type SetStateAction, type Dispatch } from "react";

interface Entry { baseline: string; value: unknown }
function createStore() {
  return { entries: new Map<string, Entry>(), listeners: new Set<() => void>() };
}
const DraftContext = createContext<ReturnType<typeof createStore> | null>(null);
/** In-memory UI drafts only. A new App/reload starts a new session. */
export function SessionDraftProvider({ children }: { children: ReactNode }) {
  const store = useMemo(createStore, []);
  return <DraftContext.Provider value={store}>{children}</DraftContext.Provider>;
}
export function useSessionDraft<T>(key: string, initial: T | (() => T), baseline = ""): [T, Dispatch<SetStateAction<T>>] {
  const context = useContext(DraftContext);
  const fallback = useRef<ReturnType<typeof createStore>>();
  if (!fallback.current) fallback.current = createStore();
  const store = context ?? fallback.current;
  // Initializers describe persisted data, and are recomputed only when that data changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialValue = useMemo(() => typeof initial === "function" ? (initial as () => T)() : initial, [key, baseline]);
  const read = useCallback(() => {
    const entry = store.entries.get(key);
    return entry?.baseline === baseline ? entry.value as T : initialValue;
  }, [store, key, baseline, initialValue]);
  const subscribe = useCallback((listener: () => void) => {
    store.listeners.add(listener); return () => { store.listeners.delete(listener); };
  }, [store]);
  const value = useSyncExternalStore(subscribe, read, read);
  useEffect(() => {
    const entry = store.entries.get(key);
    if (entry && entry.baseline !== baseline) {
      store.entries.delete(key); store.listeners.forEach(listener => listener());
    }
  }, [store, key, baseline]);
  const set = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    store.entries.set(key, { baseline, value: typeof next === "function" ? (next as (old: T) => T)(read()) : next });
    store.listeners.forEach(listener => listener());
  }, [store, key, baseline, read]);
  return [value, set];
}
export function useClearSessionDrafts() {
  const store = useContext(DraftContext);
  return (prefix: string) => {
    if (!store) return;
    for (const key of store.entries.keys()) if (key.startsWith(prefix)) store.entries.delete(key);
    store.listeners.forEach(listener => listener());
  };
}

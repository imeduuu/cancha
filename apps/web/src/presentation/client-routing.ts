import { useSyncExternalStore } from "react";

let currentPath = typeof window === "undefined" ? "/" : window.location.pathname;
const listeners = new Set<() => void>();

function publishPath() {
  currentPath = window.location.pathname;
  listeners.forEach((listener) => listener());
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", publishPath);
}

export function navigate(path: string, options: { replace?: boolean } = {}) {
  if (path === currentPath) return;
  if (options.replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  publishPath();
}

export function usePathname() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => currentPath,
    () => "/",
  );
}

export function tournamentPath(id: string, section = "resumen") {
  return `/torneos/${encodeURIComponent(id)}/${section}`;
}


/**
 * Pista "hubo una sesión en este navegador" (fase 5D). Vive aparte de
 * auth-session.ts para que la aplicación pueda consultarla al arrancar sin cargar
 * el cliente de la API: sin pista, el modo sin sesión no carga ese código ni toca la red.
 */
export const sessionHintKey = "cancha.session.hint";

export function hasSessionHint(storage: Pick<Storage, "getItem"> | null = browserStorage()): boolean {
  try {
    return storage?.getItem(sessionHintKey) === "1";
  } catch {
    return false;
  }
}

function browserStorage(): Pick<Storage, "getItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

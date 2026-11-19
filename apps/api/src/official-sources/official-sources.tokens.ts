/** Proxy de fuentes oficiales (`OfficialSourceProxy` de @cancha/official-source-proxy). */
export const OFFICIAL_SOURCE_PROXY = Symbol("OFFICIAL_SOURCE_PROXY");
/**
 * Destinos por prefijo. En la app real son siempre `officialSourceTargets`
 * (no hay variable de entorno que los cambie); sólo las pruebas lo sobrescriben
 * con un servidor local.
 */
export const OFFICIAL_SOURCE_TARGETS = Symbol("OFFICIAL_SOURCE_TARGETS");

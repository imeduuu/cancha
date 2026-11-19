# Proxy de fuentes oficiales (fase 6)

Los sitios de ANFP (Campeonato Chileno), ANFA (Tercera División), Copa Argentina y CBF no admiten CORS: el navegador no puede consultarlos directamente. Antes de la fase 6 sólo los proxies de `vite.config.ts` los reenviaban, y esos proxies no existen en un despliegue estático. Ahora la API los sirve con los **mismos prefijos**, así que los importadores de la web no cambian. ESPN admite CORS y no pasa por aquí.

| Prefijo | Destino fijo | Importador |
| --- | --- | --- |
| `/official-source` | `https://www.campeonatochileno.cl` | `anfp-official-league-source.ts` |
| `/third-division-source` | `https://anfaterceradivision.cl` | `anfa-third-division-source.ts` |
| `/argentina-cup-source` | `https://www.copaargentina.org` | `south-american-cup-sources.ts` |
| `/brazil-cup-source` | `https://www.cbf.com.br` | `south-american-cup-sources.ts` (cabecera `RSC: 1`) |

## Dónde vive

- **`packages/official-source-proxy`** (`@cancha/official-source-proxy`): toda la política. Usa sólo Node (`node:http`, `fetch`), sin Nest, Express, core, la API ni la web (ESLint lo exige). Tiene la misma condición `source` que core: Vite y `verify:live` leen `src/` y la API usa `dist/`.
- **`apps/api/src/official-sources/`**: controlador delgado y público (`@Public()`) que pasa la petición al módulo con `clientKey: req.ip`. Los destinos se inyectan con `OFFICIAL_SOURCE_TARGETS`, que sólo las pruebas sobrescriben.
- **Vite** (`npm run dev` / `preview`) y **`verify:live`** usan el mismo módulo (ver "Desarrollo y verificación" al final).
- `apps/web/src/**` no puede importarlo (ESLint): no entra en el bundle de la web.

## Política

- **Destino fijo por prefijo**. El cliente sólo elige la ruta y la query dentro de ese sitio. No hay variable de entorno que cambie los hosts.
- **Rutas**:
  - Se rechazan con 400 "Ruta de fuente oficial no válida." los segmentos `.` y `..`, sus formas codificadas (`%2e`), `/` y `\` codificados (`%2f`, `%5c`), la doble codificación (`%25`), `%00`, `//`, `@`, `\`, `#`, los caracteres de control, las codificaciones mal formadas y las URL de más de 2048 caracteres.
  - Después se construye la URL y se comprueba que el origen y la ruta no cambiaron.
- **Sólo GET**: cualquier otro método (también HEAD) responde 405 con `Allow: GET`.
- **Cabeceras**:
  - Al origen sólo llegan `User-Agent: Cancha (importador de fuentes oficiales)` y `Accept: */*`, más `RSC: 1` hacia la CBF si la web la envía. Nunca se reenvían `Cookie`, `Authorization`, `Origin`, `Referer`, `X-Forwarded-*` ni ninguna otra.
  - Al cliente sólo vuelve `Content-Type`, más `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` y `X-Cancha-Source-Cache: hit|miss`. Ninguna cookie del sitio oficial llega al navegador.
- **Redirecciones**: se siguen hasta 3, sólo dentro del mismo origen y con la misma validación de ruta. Una redirección a otro host (o a `http:`) responde 502 "La fuente oficial redirigió a un sitio no permitido.".
- **Timeout**: cubre conexión, redirecciones y lectura del cuerpo. Si se supera, responde 504 "La fuente oficial no respondió a tiempo.".
- **Tamaño máximo**: se mide sobre el cuerpo descomprimido y se corta en cuanto lo supera, o antes de leer si `Content-Length` ya lo excede. La respuesta es 502 "La respuesta de la fuente oficial supera el tamaño permitido.".
- **Errores del origen**:
  - un status que no es 2xx responde 502 "La fuente oficial respondió con HTTP <n>.";
  - un error de red o TLS responde 502 "No se pudo conectar con la fuente oficial.".
  - Los errores van en texto plano en español. La web los trata como hoy: el importador lanza "… respondió con HTTP 502." y no hay importación parcial.
- **Caché en memoria** (LRU):
  - La clave es la URL final de destino, más `RSC` si se envió.
  - Tiene TTL y dos límites: entradas y bytes (sin el de bytes, 200 entradas de 5 MiB serían 1 GB).
  - Sólo guarda respuestas 2xx completas: un error nunca queda en caché.
  - Las consultas simultáneas a la misma URL comparten una sola descarga.
- **Rate limit por IP**:
  - Es una ventana fija por cliente. Cuenta también los aciertos de caché, porque protege a la API y no sólo al origen.
  - Al excederlo responde 429 "Demasiadas consultas a fuentes oficiales. Espera un momento y vuelve a intentarlo." con `Retry-After`.
  - Lo cuenta el módulo y no `@nestjs/throttler`: un throttler con nombre en `ThrottlerModule` se aplicaría también a `register`/`login`, y así Vite y la API comparten la misma política.

## Límites y variables (apps/api/.env)

Tamaños medidos en `docs/live-importers-results.json` (17/10/2026). Las muestras de `apps/web/src/test-utils/fixtures/live/` son extractos reducidos y no sirven para dimensionar. Respuesta proxificada más grande: ANFP Ascenso, 1.326.967 B; ANFP Primera, 1,28 MB; CBF 1996, 1,04 MB; ANFA, 53–99 KB; Copa Argentina, 13–55 KB. Una importación de ANFA hace hasta ~55 consultas (una por jornada).

| Variable | Por defecto | Rango | Motivo |
| --- | --- | --- | --- |
| `OFFICIAL_SOURCE_TIMEOUT_MS` | 20000 | 1000–120000 | El sitio más lento descarga ~1,3 MB. |
| `OFFICIAL_SOURCE_MAX_BYTES` | 5242880 (5 MiB) | 1 KiB–64 MiB | ~3,8× la mayor respuesta medida. |
| `OFFICIAL_SOURCE_CACHE_TTL_SECONDS` | 600 | 0–86400 (0 = sin caché) | Los resultados cambian como mucho por jornada. |
| `OFFICIAL_SOURCE_CACHE_MAX_ENTRIES` | 200 | 1–10000 | Una temporada completa de las 4 fuentes. |
| `OFFICIAL_SOURCE_CACHE_MAX_BYTES` | 67108864 (64 MiB) | 1 MiB–1 GiB | Memoria acotada aunque todas las entradas sean grandes. |
| `OFFICIAL_SOURCE_RATE_LIMIT` | 300 | 1–100000 | 5 importaciones completas de ANFA por minuto. |
| `OFFICIAL_SOURCE_RATE_TTL_SECONDS` | 60 | 1–86400 | |

## Acceso sin sesión

Las rutas son públicas. La web sin cuenta (el modo por defecto) también importa y no tiene access token, así que exigir sesión rompería las importaciones en ese modo. Un proxy público es aceptable porque no es abierto: el host es fijo, el cliente no aporta cabeceras ni cuerpo, sólo hay GET con tamaño y tiempo acotados, y la caché y el rate limit limitan el costo. Lo único que se obtiene es lo que ya publican cuatro sitios oficiales.

## IP del cliente, `TRUST_PROXY` y `X-Forwarded-For`

El rate limit usa `req.ip` de Express. El módulo nunca lee `X-Forwarded-For` por su cuenta.

- `TRUST_PROXY` (también lo usa el rate limit de autenticación) es **siempre un número de saltos**, de 0 a 10. `env.validation.ts` rechaza `true`, `false`, `loopback`, IPs y negativos: la API no arranca.
- Con N saltos, Express confía en las últimas N entradas de `X-Forwarded-For` (las que agregan los proxies propios) y `req.ip` es la anterior a ellas. Lo que el cliente escribe al principio de la cabecera no cuenta.
- `true` tomaría la **primera** entrada, que escribe el cliente: cualquiera podría inventarse una IP nueva por petición y saltarse el límite.

Comprobado en las pruebas:
- `official-sources-rate-limit.e2e.test.ts`: sin `TRUST_PROXY`, un `X-Forwarded-For` falso distinto en cada petición se ignora y el límite se aplica por la IP real de la conexión.
- `official-sources-trust-proxy.e2e.test.ts`: con `TRUST_PROXY=1`, en la cadena `falsa, real` cuenta la real; cambiar sólo la parte falsa no da otro cupo, y otra IP real tiene el suyo.

Valor según el despliegue: es el número de proxies **propios** entre el navegador y la API.

| Despliegue | `TRUST_PROXY` |
| --- | --- |
| Local (`npm run dev:api`), conexión directa | `0` |
| API en Render, llamada directamente (sin Vercel) | `1` (balanceador de Render) |
| Web en Vercel con *rewrite* hacia la API en Render | `2` (edge de Vercel + balanceador de Render) |

Antes de fijar el valor en producción hay que verificarlo. Por ejemplo, registra temporalmente `req.ips` y `req.ip` y compáralos con la IP pública del navegador. Si el valor es demasiado alto, el cliente puede falsificar su IP. Si es demasiado bajo, todos los clientes comparten la IP del proxy y el límite se agota para todos.

## Varias instancias

La caché y el rate limit están en memoria y valen **por instancia**, igual que el throttler de autenticación. Con N instancias, el límite efectivo es N veces el configurado y cada una tiene su propia caché. Si hiciera falta, la solución es un almacenamiento compartido (p. ej. Redis).

## Pruebas (offline)

- `packages/official-source-proxy/src/official-source-proxy.test.ts`, con un servidor HTTP local como origen falso. Cubre:
  - los 4 prefijos con query, y `RSC` sólo hacia la CBF;
  - rutas que intentan escapar del sitio (400 sin tocar el origen) y prefijo desconocido (404);
  - métodos distintos de GET (405) y cabeceras del cliente que no llegan al origen;
  - redirección dentro del sitio, hacia otro host y en bucle;
  - `Content-Length` excesivo, stream excesivo sin `Content-Length` y respuesta justo en el límite;
  - timeout (504), origen caído y 500 (502);
  - caché: hit, TTL, TTL 0, expulsión por entradas y por bytes, coalescencia;
  - rate limit por cliente, con aciertos de caché y sin clave.
- `apps/api/src/official-sources/official-sources.e2e.test.ts`: la app completa sin sesión. Comprueba que el token y la cookie no llegan al origen, `RSC`, caché, 405, 400, que `/official-sourcex` no coincide, 502 sin caché y la redirección a otro host.
- `official-sources-rate-limit.e2e.test.ts` y `official-sources-trust-proxy.e2e.test.ts`: los casos de `X-Forwarded-For` descritos arriba (una app por archivo, porque `ConfigModule` lee `process.env` al importar).

## Verificación manual

```bash
npm run dev:api
curl -i "http://127.0.0.1:3000/third-division-source/assets/php/calendario_ta.php?j=1"   # 200, X-Cancha-Source-Cache: miss (hit la 2.ª vez)
curl -i --path-as-is "http://127.0.0.1:3000/official-source/../x"                        # 400
curl -i -X POST "http://127.0.0.1:3000/official-source/"                                 # 405
```

## Desarrollo y verificación con fuentes reales (fase 6B)

- `npm run dev` y `npm run preview` sirven las cuatro rutas con el **mismo módulo**, a través del plugin `cancha-official-sources` de `apps/web/vite.config.ts`. El modo sin sesión importa sin levantar la API ni MongoDB, y se aplica la misma política que en producción. El proxy de Vite queda sólo para `/graphql`.
  - Por qué no reenviar a la API: obligaría a levantar la API (y Mongo) para importar sin cuenta.
  - Por qué no "API y, si no responde, directo": serían dos políticas distintas y los errores quedarían ocultos.
- El cargador de configuración de Vite no aplica la condición `source` a un paquete del workspace. El plugin carga el módulo con `runnerImport` y `environments.inline.resolve.conditions = ["source", …]`, así que no hace falta compilar el paquete para `npm run dev`.
- El middleware se instala después de la validación de `Host` de Vite, así que `dev:public` sigue rechazando hosts ajenos. A través del túnel todas las peticiones llegan desde `127.0.0.1`, por lo que el rate limit es compartido por los visitantes.
- `npm run verify:live -- --via=direct|proxy|api[=URL]`: ver [live-importers-verification.md](live-importers-verification.md).

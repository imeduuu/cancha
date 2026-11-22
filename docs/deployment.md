# Despliegue: Atlas + Render + Vercel

Guía paso a paso para publicar Cancha con planes gratuitos. No hace falta experiencia previa: cada paso dice qué botón tocar, qué valor pegar y cómo comprobar que funcionó.

## Qué vas a crear

```text
Navegador ──► Vercel (web estática)
               │  /graphql, /official-source/…, /third-division-source/…,
               │  /argentina-cup-source/…, /brazil-cup-source/…  (rewrites)
               ▼
             Render (API en Docker, apps/api/Dockerfile) ──► MongoDB Atlas (cluster M0)
                                                      └──► ANFP, ANFA, Copa Argentina, CBF
```

- **Vercel** sirve la web (`apps/web/dist`) y reenvía a la API `/graphql` y las 4 rutas de fuentes oficiales. El navegador ve **un solo origen**: la cookie de sesión (`SameSite=Lax`) funciona y los importadores no necesitan CORS.
- **Render** ejecuta la API con la imagen Docker del repositorio (`render.yaml`).
- **MongoDB Atlas** guarda cuentas y bibliotecas. Un cluster de Atlas siempre es un replica set, así que las transacciones funcionan.

Archivos del repositorio que usa esta guía: [`render.yaml`](../render.yaml), [`apps/web/vercel.json`](../apps/web/vercel.json), [`apps/api/Dockerfile`](../apps/api/Dockerfile) y [`apps/api/.env.example`](../apps/api/.env.example).

## Flujo de ramas y publicación manual

- `main` es la rama de desarrollo. Vercel crea vistas previas para sus cambios.
- `production` es la rama publicada: Render construye la API desde ella y Vercel sirve desde ella el entorno Production.
- Para publicar los cambios de `main`, ejecuta desde un checkout local:

  ```bash
  git checkout production
  git merge main
  git push
  git checkout main
  ```

  El push a `production` dispara el CI. Render despliega esa rama sólo cuando el CI termina en verde (`autoDeployTrigger: checksPass`).
- En Vercel configura `production` en **Settings → Environments → Production → Branch Tracking / Production Branch**. Así `main` conserva sus vistas previas y `production` queda como producción.
- En Render configura la rama del servicio en **Build & Deploy → Branch** como `production`; `render.yaml` también declara `branch: production`.
- Las vistas previas de Vercel no mantienen la sesión con cuenta: sus dominios no están incluidos en `CORS_ORIGINS`. Usa la URL de producción para probar cuentas.

### Antes de empezar

- El repositorio debe estar en GitHub, con `render.yaml` y `apps/web/vercel.json` en `main` y el CI en verde (pestaña **Actions**).
- Cuentas gratuitas en [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register), [Render](https://render.com) y [Vercel](https://vercel.com). En Render y Vercel conviene entrar con GitHub: así ya quedan conectados al repositorio.
- Node 22 en tu computador, sólo para generar valores con `node -e …` (opcional).

**Orden recomendado:** Atlas → Render → Vercel. La API necesita la URL de la web (`CORS_ORIGINS`) y la web necesita la URL de la API (rewrites). Ambas URLs son predecibles (`https://<nombre>.onrender.com` y `https://<nombre>.vercel.app`), así que elige los nombres desde el principio y corrige al final si alguno cambió.

## Paso 1: MongoDB Atlas

### 1.1 Crear el cluster

1. Entra a Atlas y crea un proyecto, por ejemplo **Cancha**.
2. **Create** (o **Build a Database**) → elige **M0 (Free)**.
3. Proveedor **AWS**, región **N. Virginia (us-east-1)**. Es la misma zona que la región `virginia` de `render.yaml`: menos latencia entre la API y la base. Si cambias una, cambia la otra.
4. Nombre del cluster: `cancha`. **Create Deployment**.

### 1.2 Usuario de la base de datos

Atlas suele ofrecerlo al crear el cluster; si no, ve a **Security → Database Access → Add New Database User**.

1. Método **Password**. Usuario: `cancha-api`.
2. **Autogenerate Secure Password** y **cópiala** en un lugar seguro (un gestor de contraseñas). La necesitas en el paso 1.4. Una contraseña generada sólo tiene letras y números: no hay que escapar nada.
   - Si eliges una a mano con `@ : / ? # [ ] %`, tendrás que codificar esos caracteres en la cadena (por ejemplo `@` → `%40`).
3. Permisos: **Specific Privileges** → `readWrite` sobre la base `cancha`. Es lo mínimo que necesita la API (incluye crear índices). **Read and write to any database** también funciona, pero da más permisos de los necesarios.
4. **Add User**.

### 1.3 Acceso de red

**Security → Network Access → Add IP Address → Allow Access from Anywhere** (`0.0.0.0/0`) → **Confirm**.

¿Por qué desde cualquier IP? El plan gratuito de Render no tiene IPs de salida fijas, así que no hay una lista corta que autorizar. La protección es el usuario y la contraseña, con conexión siempre cifrada (TLS). Por eso la contraseña debe ser larga y aleatoria y nunca debe quedar en el repositorio.

### 1.4 Cadena de conexión

1. En el cluster: **Connect → Drivers** → Driver **Node.js**.
2. Copia la cadena. Se ve así:

   ```text
   mongodb+srv://cancha-api:<db_password>@cancha.abcde.mongodb.net/?retryWrites=true&w=majority&appName=cancha
   ```

3. Reemplaza `<db_password>` (**con** los signos `<` y `>`) por la contraseña del paso 1.2. Esta es tu `MONGODB_URI`.
   - No agregues el nombre de la base en la cadena: va aparte en `MONGODB_DB=cancha`.
   - Si se te olvida reemplazar `<db_password>`, la API no arranca y su log dice "MONGODB_URI todavía tiene un marcador". El mensaje no repite la cadena, para no exponer la contraseña.

## Paso 2: Render (API)

### 2.1 Crear el servicio desde el blueprint

1. En Render: **New → Blueprint**.
2. Conecta GitHub si te lo pide y elige el repositorio. Render lee [`render.yaml`](../render.yaml) y muestra el servicio **cancha-api** (Docker, plan free, región Virginia, health check `/health`).
3. Te pedirá los valores marcados `sync: false`:

   | Variable | Qué pegar |
   | --- | --- |
   | `MONGODB_URI` | La cadena del paso 1.4, con la contraseña real. |
   | `CORS_ORIGINS` | La URL que tendrá la web en Vercel, **https y sin barra final**: `https://<nombre-del-proyecto>.vercel.app` (por ejemplo `https://cancha.vercel.app`). Si después agregas un dominio propio, súmalo separado por coma: `https://cancha.vercel.app,https://cancha.cl`. |

   `JWT_ACCESS_SECRET` **no** se pega: Render lo genera (`generateValue: true`, 256 bits aleatorios). El resto ya tiene valor en `render.yaml`.
4. **Apply**. El primer build tarda unos 5–10 minutos: compila core, el proxy y la API dentro de Docker.

### 2.2 Comprobar la API

1. En el servicio, la pestaña **Logs** debe terminar con `API de Cancha escuchando en http://localhost:10000 (GET /health, POST /graphql)`. Render define `PORT=10000` y la API lo lee.
2. Copia la URL que aparece arriba del servicio, por ejemplo `https://cancha-api.onrender.com`. Si el nombre estaba ocupado, Render agrega un sufijo (`https://cancha-api-x1y2.onrender.com`). **Esa es la URL de la API para el paso 3.**
3. Ábrela en el navegador con `/health` al final:

   ```text
   https://cancha-api.onrender.com/health
   → {"status":"ok","app":{...},"mongo":{"status":"up","latencyMs":...}}
   ```

   `"mongo":{"status":"down"}` (HTTP 503) significa que la API no llega a Atlas. Revisa el acceso de red (1.3), el usuario y la contraseña (1.2).

**Si el despliegue falla** con `Configuración inválida de la API:` en los logs, debajo viene la lista de todo lo que falta o sobra. Por ejemplo:

- `CORS_ORIGINS en producción sólo admite orígenes https públicos, no http ni localhost`;
- `CORS_ORIGINS todavía tiene un marcador`.

Corrige en **Environment** y guarda con **Save, rebuild, and deploy**.

### 2.3 Despliegues siguientes

`render.yaml` usa `branch: production` y `autoDeployTrigger: checksPass`: los cambios de `main` se publican al fusionar `main` en `production`; Render despliega cada push a `production` **sólo cuando el CI de GitHub termina en verde**. Consulta [Flujo de ramas y publicación manual](#flujo-de-ramas-y-publicaci%C3%B3n-manual). Cambiar una variable en **Environment** también redespliega.

> **Plan free de Render:** el servicio se duerme tras 15 minutos sin tráfico. La primera petición después tarda cerca de un minuto (la web mostrará la carga de la sesión mientras tanto). Al despertar, la caché de fuentes oficiales y los contadores de rate limit empiezan vacíos: están en memoria.

### 2.4 `JWT_ACCESS_SECRET`: qué pasa si se regenera

- Render lo genera **una sola vez**, al crear el servicio. No cambia en cada despliegue. Lo ves en **Environment** (oculto); no hace falta copiarlo a ningún lado.
- Si algún día lo cambias (o lo regeneras borrando la variable y sincronizando el blueprint):
  - **Todos los access tokens vigentes dejan de valer al instante.** Duran 15 minutos y van firmados con ese secreto.
  - **Las sesiones no se cierran.** El refresh token (cookie `cancha_refresh`) no depende de este secreto: se guarda como hash en la colección `sessions`/`refresh_tokens` de Mongo. La web recibe `UNAUTHENTICATED`, se renueva sola con la cookie y reintenta, así que el usuario normalmente no nota nada.
- **Si el secreto se filtró**, cambiarlo no basta para echar a quien tenga una cookie robada: además hay que revocar todas las sesiones. Con [mongosh](https://www.mongodb.com/docs/mongodb-shell/) y tu `MONGODB_URI`:

  ```js
  // Base cancha: cierra todas las sesiones (cada usuario tendrá que volver a ingresar).
  db.sessions.updateMany({ revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: "rotacion-secreto" } })
  db.refresh_tokens.updateMany({ revokedAt: null }, { $set: { revokedAt: new Date() } })
  ```

  La API comprueba en cada petición que la sesión siga activa, así que los access tokens de esas sesiones también quedan cortados.
- Para generar un secreto a mano (por ejemplo, para la prueba local con Docker):

  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  ```

## Paso 3: Vercel (web)

### 3.1 Apuntar los rewrites a tu API

En [`apps/web/vercel.json`](../apps/web/vercel.json), reemplaza las **5** apariciones de `REEMPLAZAR-URL-DE-LA-API.onrender.com` por el host de tu API del paso 2.2, por ejemplo `cancha-api.onrender.com`. Usa buscar y reemplazar del editor. Queda así:

```json
{ "source": "/graphql(/)?", "destination": "https://cancha-api.onrender.com/graphql" },
{ "source": "/official-source(/.*)?", "destination": "https://cancha-api.onrender.com/official-source$1" },
```

Comprueba que esté completo con `npm test -w @cancha/web -- scripts/vercel-config.test.mjs`. La prueba compila los rewrites con `@vercel/routing-utils`, la misma librería que usa Vercel, y simula rutas reales: con y sin barra final, el prefijo solo y con query. Exige una sola API con https y el fallback de la SPA al final. Para publicar, sigue [Flujo de ramas y publicación manual](#flujo-de-ramas-y-publicaci%C3%B3n-manual).

> **No uses `:path*`** en las fuentes oficiales. `"/official-source/:path*"` sólo acepta segmentos no vacíos, así que **no** captura una barra final: `/official-source/ligas/liga-de-primera-mercado-libre/` (las rutas de ANFP terminan en `/`) caía en el fallback y Vercel respondía `index.html` con 200. `(/.*)?` con `$1` captura cualquier subruta, la barra final y el prefijo solo.

### 3.2 Crear el proyecto

1. En Vercel: **Add New… → Project** → importa el repositorio de GitHub.
2. **Project Name:** el nombre que usaste en `CORS_ORIGINS` (por ejemplo `cancha` → `https://cancha.vercel.app`).
3. **Root Directory → Edit → `apps/web`**. Importante: aquí vive `vercel.json`.
4. **Framework Preset:** Vite. `vercel.json` ya lo fija.
5. **Build and Output Settings:** déjalos sin tocar. `vercel.json` los define y tienen prioridad:

   | Opción | Valor (desde `vercel.json`) |
   | --- | --- |
   | Install Command | `cd ../.. && npm ci -w @cancha/web` |
   | Build Command | `npm run build` |
   | Output Directory | `dist` |

6. **Environment Variables:** ninguna. La web no usa variables de entorno; la URL de la API sólo está en los rewrites.
7. **Deploy**.

Después del primer despliegue, en **Settings → Build and Deployment** (Settings → General en versiones anteriores del panel):

- **Root Directory → "Include files outside the root directory in the Build Step": Enabled.** Viene activado por defecto en proyectos nuevos; confirma que lo esté.
- **Node.js Version: 22.x.**

### 3.3 Por qué esa configuración

Vercel ejecuta los comandos **dentro de** `apps/web`, pero la web es un workspace de npm y depende de código fuera de esa carpeta:

- **Install Command (`cd ../.. && npm ci -w @cancha/web`):** el `package-lock.json` está en la raíz del monorepo y `npm ci` lo exige, así que la instalación sube a la raíz.
  - `-w @cancha/web` instala sólo las dependencias de la web (unos 138 paquetes, ~11 s) y enlaza `@cancha/core` y `@cancha/official-source-proxy` como workspaces.
  - Sin `-w`, también instalaría la API (unos 613 paquetes, con `argon2` nativo y el CLI de Nest), que la web no usa.
- **Build Command (`npm run build`, en `apps/web`):** es `tsc -b && vite build`.
  - La web importa `@cancha/core` **como código fuente** (`packages/core/src`, condición `source`).
  - El chequeo de tipos de `vite.config.ts` lee `packages/official-source-proxy/src`.
  - No hace falta compilar core antes.
- **"Include files outside the root directory": Enabled.** Sin esa opción, Vercel sólo deja `apps/web` disponible en el build y falla con:

  ```text
  error TS2307: Cannot find module '@cancha/core/domain/entities/tournament' or its corresponding type declarations.
  ```

- **Rewrites:** `/graphql` y las 4 rutas de fuentes oficiales van primero y se reenvían a la API (Vercel conserva la query y las cookies). Para comprobar en producción que una ruta llega a la API, mira la cabecera `X-Render-Origin-Server` (y `X-Cancha-Source-Cache` en las fuentes): `curl -I https://<web>.vercel.app/official-source/ligas/liga-de-primera-mercado-libre/`. Si falta, respondió el fallback de la SPA. La última regla, `/(.*)` → `/index.html`, es el fallback de la SPA. Vercel sirve antes los archivos que existen (`/assets/…`), así que esa regla sólo atrapa rutas sin archivo.

Esta configuración se comprobó simulando el build de Vercel en un clon limpio del repositorio: `npm ci -w @cancha/web` desde la raíz y `npm run build` en `apps/web` construyen el mismo bundle que el build local. Sin `packages/` el build falla con el error de arriba.

### 3.4 Si la URL de Vercel no es la que pusiste en Render

Si el nombre del proyecto estaba ocupado, Vercel te da otra URL. Corrige `CORS_ORIGINS` en Render (**Environment → Save, rebuild, and deploy**) con la URL real, https y sin barra final. Si no coincide, ingresar parece funcionar pero la sesión se pierde al recargar: la renovación (`refreshToken`) responde `FORBIDDEN` porque el `Origin` no está en la lista.

> **Despliegues de vista previa (Preview) de Vercel:** cada PR o rama obtiene una URL distinta (`cancha-git-rama-usuario.vercel.app`) que también usa **la API y la base de producción**. Sin cuenta funcionan bien. Con cuenta, la sesión no se renueva, porque esa URL no está en `CORS_ORIGINS` (y no conviene agregarla). Prueba la cuenta siempre en la URL de producción.

## Paso 4: verificar `TRUST_PROXY`

La API limita intentos por IP: login y registro (10/min) y fuentes oficiales (300/min). Para ver la IP real del visitante detrás de los proxies, `TRUST_PROXY` debe ser **exactamente** el número de proxies propios que agregan su entrada a `X-Forwarded-For`.

- **Demasiado alto:** cualquiera falsifica su IP con un `X-Forwarded-For` inventado y se salta el límite.
- **Demasiado bajo:** todos los visitantes comparten la IP del proxy y el límite se agota para todos a la vez.

`render.yaml` empieza con `2` (edge de Vercel + balanceador de Render), pero hay que comprobarlo. No se sabe de antemano si el rewrite de Vercel agrega su salto o reescribe la cabecera.

1. **Activa el diagnóstico.** En Render → **Environment**, cambia `LOG_CLIENT_IP` a `true` → **Save, rebuild, and deploy**. Al arrancar, el log avisa `LOG_CLIENT_IP=true: se registran IPs de clientes…`.
2. **Averigua tu IP pública:** busca "cuál es mi IP" en el navegador. Es la misma para el navegador y para `curl` en ese computador.
3. **Haz dos peticiones a través de Vercel**, desde ese computador:

   ```bash
   # Normal
   curl -s -o /dev/null https://cancha.vercel.app/graphql
   # Con una IP falsa inventada por el cliente
   curl -s -o /dev/null https://cancha.vercel.app/graphql -H "X-Forwarded-For: 203.0.113.7"
   ```

   (Responden 400 porque no son consultas GraphQL válidas; no importa, igual quedan registradas.)
4. **Lee los logs** de Render y busca `ClientIp`. Cada petición deja una línea como esta (con tus IPs):

   ```json
   {"method":"GET","path":"/graphql","xForwardedFor":"203.0.113.7, 190.100.20.30, 76.76.21.1","socket":"10.214.5.6","trustProxy":2,"ips":["190.100.20.30","76.76.21.1"],"ip":"190.100.20.30"}
   ```

5. **Calcula el valor correcto:** en `xForwardedFor`, cuenta desde la **derecha** hasta tu IP pública. La primera de la derecha es 1, la siguiente 2, etc. Esa posición es `TRUST_PROXY`.
   - En el ejemplo, `190.100.20.30` es la 2.ª desde la derecha ⇒ `TRUST_PROXY=2`.
   - Así razona Express: con N, confía en las últimas N entradas y `req.ip` es la N-ésima desde la derecha (con 0, la IP del socket).
6. **Comprueba en las dos líneas** (la normal y la de `203.0.113.7`) que `ip` sea **tu IP pública**:

   | `ip` muestra | Significa | Qué hacer |
   | --- | --- | --- |
   | Tu IP pública en ambas | Correcto | Nada |
   | `203.0.113.7` en la petición falsa | Demasiado alto: se puede falsificar | Bájalo en 1 y repite |
   | Una IP que no es tuya (Vercel `76.76.…`, Render `10.…`) | Demasiado bajo | Súbelo en 1 y repite |

7. **Fija el valor** en `TRUST_PROXY` y, si cambió, actualiza `render.yaml` para que el blueprint no lo devuelva a `2`.
8. **Vuelve a desactivar el diagnóstico:** `LOG_CLIENT_IP` = `false` → **Save, rebuild, and deploy**. Comprueba que el log ya no muestre el aviso. **Las IPs son datos personales**: no dejes el registro activo más tiempo del necesario. Las líneas ya escritas quedan en los logs de Render según su retención.

> **Límite conocido:** la URL de Render (`https://cancha-api.onrender.com`) también es pública. Quien llame a la API **directamente**, sin pasar por Vercel, tiene un salto menos y puede elegir la IP que verá el rate limit con un `X-Forwarded-For` inventado. Render free no permite aceptar sólo tráfico de Vercel. El efecto es saltarse el rate limit, no la autenticación: argon2 sigue encareciendo cada intento de login y los emails siguen siendo únicos. Si algún día importa, habría que poner la API detrás de un proxy que sólo acepte tráfico de Vercel (por ejemplo con una cabecera secreta).

## Variables de entorno de producción (Render)

Todas van en el servicio de Render (**Environment**). `render.yaml` ya declara todas: tú sólo pegas `MONGODB_URI` y `CORS_ORIGINS`. Vercel no lleva variables.

| Variable | Valor recomendado | Secreta | Notas |
| --- | --- | --- | --- |
| `NODE_ENV` | `production` | No | Activa las validaciones de producción. |
| `PORT` | *(no la declares)* | No | Render la define (10000). |
| `MONGODB_URI` | `mongodb+srv://cancha-api:<contraseña>@cancha.xxxxx.mongodb.net/?retryWrites=true&w=majority&appName=cancha` | **Sí** | Paso 1.4. Rechazada si conserva `<db_password>` o `REEMPLAZAR`. |
| `MONGODB_DB` | `cancha` | No | |
| `JWT_ACCESS_SECRET` | *(generada por Render)* | **Sí** | ≥ 32 caracteres. Rechazada si falta, si es el valor de desarrollo o si es un marcador. Ver 2.4. |
| `CORS_ORIGINS` | `https://cancha.vercel.app` | No | https, sin barra final; varias separadas por coma. En producción se rechazan `http://`, `localhost`, `127.0.0.1` y marcadores. |
| `AUTH_COOKIE_SAMESITE` | `lax` | No | Basta con el rewrite (mismo origen). `none` sólo si se descartara el rewrite. |
| `AUTH_COOKIE_SECURE` | `true` | No | `false` está prohibido en producción. |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | No | Días sin uso antes de pedir login otra vez. |
| `AUTH_RATE_LIMIT` / `AUTH_RATE_TTL_SECONDS` | `10` / `60` | No | Intentos de register/login/refresh por IP y por minuto. |
| `TRUST_PROXY` | `2` (verificar, paso 4) | No | Entero 0–10, nunca `true`. |
| `LOG_CLIENT_IP` | `false` | No | `true` sólo durante el paso 4. |
| `OFFICIAL_SOURCE_TIMEOUT_MS` | `20000` | No | Plazo por consulta a la fuente. |
| `OFFICIAL_SOURCE_MAX_BYTES` | `5242880` (5 MiB) | No | Tamaño máximo por respuesta. |
| `OFFICIAL_SOURCE_CACHE_TTL_SECONDS` | `600` | No | 0 desactiva la caché. |
| `OFFICIAL_SOURCE_CACHE_MAX_ENTRIES` | `200` | No | |
| `OFFICIAL_SOURCE_CACHE_MAX_BYTES` | `67108864` (64 MiB) | No | Cabe en los 512 MB del plan free. |
| `OFFICIAL_SOURCE_RATE_LIMIT` / `OFFICIAL_SOURCE_RATE_TTL_SECONDS` | `300` / `60` | No | Consultas por IP y por minuto (cuentan también los aciertos de caché). |

Nunca pongas `MONGODB_URI` ni `JWT_ACCESS_SECRET` en el repositorio, en `render.yaml`, en `vercel.json` ni en un `.env` versionado. Detalle de cada variable en [`apps/api/.env.example`](../apps/api/.env.example).

## Lista de verificación final

Hazla en la URL de producción de Vercel (no en una vista previa), con la API ya despierta.

- [ ] **Health:** `https://<api>.onrender.com/health` responde 200 con `"mongo":{"status":"up"}`.
- [ ] **Web:** `https://<web>.vercel.app` carga. Recarga en una ruta interna (si la app cambia la URL): no da 404 (fallback de la SPA).
- [ ] **Registro:** **Cuenta → Crear cuenta** con un email y una contraseña nuevos → el botón muestra "Cuenta · tu email". Si había torneos locales en ese navegador, se ofrece migrarlos.
- [ ] **Guardar:** crea un campeonato (o simula una fecha) y espera a que se guarde.
- [ ] **Recargar:** con F5 la sesión sigue abierta sin volver a ingresar y la biblioteca muestra el campeonato. Esto prueba la cookie `cancha_refresh` y `CORS_ORIGINS`.
- [ ] **Login en otro navegador** (o en una ventana privada): **Cuenta → Ingresar** con el mismo email → aparece la misma biblioteca.
- [ ] **Importar desde ANFA:** **Importar campeonato → Chile → Tercera B 2026 → Zona Norte → Importar / actualizar**. El torneo aparece con sus equipos y jornadas. Esto prueba el rewrite `/third-division-source` y el proxy de la API.
  - Tercera A puede rechazarse por un dato publicado por ANFA (ver [verificación de importadores](live-importers-verification.md)).
  - Si responde 502, la fuente no contestó: reintenta más tarde.
- [ ] **Cerrar sesión:** **Cuenta → Cerrar sesión** → la web vuelve a la biblioteca local del navegador.
- [ ] **`TRUST_PROXY` verificado** (paso 4) y **`LOG_CLIENT_IP=false`** de nuevo.
- [ ] **Logs de Render** sin errores (`ERROR`) durante la prueba.

## Problemas frecuentes

| Síntoma | Causa probable | Solución |
| --- | --- | --- |
| Build de Vercel: `Cannot find module '@cancha/core/…'` | "Include files outside the root directory" desactivado | Actívalo (3.2) y redespliega. |
| Build de Vercel: `npm ci` sin `package-lock.json` | Install Command sobrescrito en el panel | Deja el campo vacío para que use `vercel.json`. |
| La web carga, pero ingresar o importar da 404 o error de red | `vercel.json` todavía con `REEMPLAZAR-URL-DE-LA-API` o con otra URL | Paso 3.1. |
| Ingresar funciona, pero al recargar se pierde la sesión | `CORS_ORIGINS` no coincide con la URL de la web | Paso 3.4. |
| La API no arranca: `Configuración inválida de la API:` | Variable faltante, marcador o valor de desarrollo | Lee la lista del log y corrige en **Environment**. |
| `/health` responde 503 con `mongo: down` | Atlas rechaza la conexión | Acceso de red `0.0.0.0/0` (1.3), usuario y contraseña (1.2). |
| La primera visita tarda un minuto | Render free se durmió | Normal en el plan gratuito (2.3). |
| `Demasiados intentos` para todos a la vez | `TRUST_PROXY` demasiado bajo | Paso 4. |

## Probar la imagen en local

Antes de desplegar puedes levantar la misma imagen con Docker (perfil `api` de `docker-compose.yml`, conectado al MongoDB local). Ver [API en contenedor](../README.md#api-en-contenedor).

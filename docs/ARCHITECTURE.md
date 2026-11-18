# Arquitectura de Cancha

Este documento describe cómo está organizado el código de Cancha, qué reglas separan sus capas, cómo se persisten los datos y qué formato tienen los respaldos JSON. Para instalar y ejecutar el proyecto, consulta el [README](../README.md).

## Estructura del monorepo

El repositorio es un monorepo con npm workspaces. Todas las órdenes `npm` se ejecutan desde la raíz.

| Paquete | Ruta | Contenido |
| --- | --- | --- |
| `@cancha/core` | `packages/core` | El modelo deportivo (`src/domain`), los casos de uso y puertos (`src/application`) y fixtures reutilizables para pruebas (`src/test-utils`). Es TypeScript puro, sin DOM ni APIs del navegador o del servidor. |
| `@cancha/web` | `apps/web` | La aplicación React/Vite: adaptadores de infraestructura (`src/infrastructure`), interfaz (`src/presentation`), pruebas de casos de uso contra los adaptadores reales (`src/integration`), utilidades de prueba y muestras de los importadores (`src/test-utils`), pruebas de navegador (`e2e/`), scripts de desarrollo (`scripts/`) y la configuración de Vite y Playwright. |
| `@cancha/api` | `apps/api` | API NestJS 12 sobre `@cancha/core` compilado: configuración validada, `GET /health`, persistencia en MongoDB (`MongoTournamentRepository`), una unidad de trabajo (`LibraryUnitOfWork`) que ejecuta los casos de uso de core sin cambios sobre la biblioteca guardada en Mongo, y una API GraphQL (`/graphql`). |

Cómo se relacionan los paquetes:

- La web consume el núcleo como `@cancha/core/<ruta>`, por ejemplo `@cancha/core/domain/entities/tournament`. Nunca se importa otro paquete con rutas relativas; dentro de un mismo paquete sí se usan rutas relativas.
- `@cancha/core` tiene dos salidas en `exports`: la condición `source` (`./src/*.ts`), que usan Vite, Vitest y `tsc` de la web, por lo que la web no necesita compilar el núcleo; y `default`/`types` (`./dist/*.js`, `./dist/*.d.ts`), generados con tsdown por `npm run build -w @cancha/core` para Node (`apps/api`). `@cancha/core/test-utils/*` apunta siempre a la fuente.
- Las dependencias se instalan una sola vez en el `node_modules` de la raíz.
- Vite reenvía durante el desarrollo las rutas `/official-source`, `/third-division-source`, `/argentina-cup-source` y `/brazil-cup-source` a los sitios oficiales que no admiten CORS (configuración en `apps/web/vite.config.ts`). Un despliegue estático necesita un proxy equivalente.
- El acceso público temporal (`npm run dev:public`) solo sirve los módulos de `@cancha/core` que la aplicación realmente importa.

## Arquitectura de capas

Cancha sigue una arquitectura hexagonal. Las dependencias apuntan siempre hacia adentro: la presentación usa la aplicación, la aplicación usa el dominio, y la infraestructura implementa los puertos que define la aplicación.

```
presentation ─┐
              ├─► application ─► domain
infrastructure┘
```

- **Dominio** (`packages/core/src/domain`): el modelo deportivo. Contiene las entidades (el agregado central es `Tournament`; además `ActivityEvent`, `SaveCheckpoint`, resoluciones oficiales, planes continentales, etc.), los servicios de dominio (calendarios todos contra todos, tablas y desempates, simulador de partidos, progresiones de copas, playoffs y ascensos, promedios de descenso, validación de integridad) y objetos de valor. Son funciones puras sobre datos inmutables.
- **Aplicación** (`packages/core/src/application`): un caso de uso por archivo en `use-cases/`, servicios de consulta y orquestación en `services/` (historial de actividad, respaldos, puntos de guardado, centro de competiciones…), los puertos en `ports/` y la validación de entradas en `validation/`. Los casos de uso reciben el repositorio como parámetro, de modo que no dependen de dónde se guardan los datos. Los identificadores se generan con `crypto.randomUUID()`, disponible tanto en navegadores como en Node; los generadores de IDs y los relojes suelen poder inyectarse.
- **Infraestructura** (`apps/web/src/infrastructure`): `persistence/` contiene los adaptadores de almacenamiento del navegador y la coordinación de escrituras entre pestañas; `external-services/` contiene los importadores de ANFP, ANFA, ESPN, Copa Argentina y CBF.
- **Presentación** (`apps/web/src/presentation`): la interfaz en React. `app.tsx` es el contenedor principal y `components/` agrupa los centros y paneles. Los paneles pesados se cargan de forma diferida para mantener pequeño el paquete inicial. Los borradores de formularios se guardan solo en memoria durante la sesión; no se persisten ni se incluyen en los respaldos.

## Regla de oro

**El dominio no puede depender de React, de `localStorage` ni de ninguna otra API del navegador, ni de ninguna librería de servidor.**

La regla se extiende a todo `@cancha/core`, que es TypeScript puro y determinista. Cualquier efecto (almacenamiento, red, interfaz) entra a través de un puerto definido en `application/ports/` e implementado fuera del núcleo: en `apps/web/src/infrastructure/` (navegador) y en `apps/api/src/infrastructure/` (servidor). Gracias a esto el mismo núcleo se ejecuta en el navegador, en pruebas con Node y en el servidor (`apps/api`).

La regla se comprueba automáticamente:

- El `tsconfig` de `@cancha/core` no incluye la biblioteca de tipos del DOM, así que `npm run build` falla si el núcleo usa tipos del navegador.
- `npm run lint` (ESLint) aplica estas restricciones:
  - En `packages/core/src`, solo se permiten imports relativos dentro del paquete y `vitest` en las pruebas. Quedan fuera React, los módulos de Node y cualquier otro paquete. También se prohíben los globales `window`, `document`, `localStorage`, `sessionStorage`, `indexedDB`, `navigator`, `location`, `process`, `Buffer`, `require`, `__dirname` y `__filename`.
  - En `packages/core/src/domain`, además, no se puede importar `application` ni `test-utils`, tampoco desde las pruebas. Una prueba que necesita casos de uso se ubica en `packages/core/src/application`.
  - En `apps/web`, el núcleo se importa solo como `@cancha/core/...`. Además se comprueban las reglas de hooks de React (`rules-of-hooks` como error y `exhaustive-deps` como advertencia).

## Puertos de persistencia

Las interfaces están en `packages/core/src/application/ports/` y sus implementaciones en `apps/web/src/infrastructure/persistence/` (navegador) y `apps/api/src/infrastructure/persistence/` (servidor).

### Repositorio de torneos

`TournamentRepository` y `TournamentLibraryRepository` (`tournament-repository.ts`) definen cómo se guardan y leen los torneos, la biblioteca y el historial de actividad. En el navegador lo implementa `LocalStorageTournamentRepository`; en el servidor, `InMemoryTournamentRepository` (dentro de la unidad de trabajo, ver más abajo). `LocalStorageTournamentRepository` usa las claves `cancha.tournaments`, `cancha.activity`, `cancha.sportsUniverses` y `cancha.recovery`, además de la selección activa.

- **`saveWithActivity(tournament, event)`** es la forma de guardar cualquier cambio que deba quedar registrado: escribe el torneo y su evento de actividad de manera coordinada. Si falla una de las escrituras, el adaptador intenta revertir ambas; si la reversión también falla, el error lo indica explícitamente. No equivale a una transacción del navegador.
- Los casos de uso guardan mediante el servicio `saveWithActivity` de `application/services/activity-log.ts`. Ese servicio rechaza el guardado si el repositorio no ofrece escritura coordinada, en lugar de guardar el torneo y el evento por separado (lo que podría dejar uno sin el otro). También añade al evento las resoluciones oficiales que el cambio haya invalidado.
- `saveManyWithActivity` cubre las operaciones que modifican varios torneos a la vez, como la creación de temporadas vinculadas entre divisiones o la simulación de una temporada completa.
- `recordActivity` registra eventos que no corresponden a un torneo guardado, como una importación rechazada.

### Repositorio de torneos en el servidor (MongoDB)

El puerto síncrono no puede implementarse sobre MongoDB, cuyo driver es asíncrono. `AsyncTournamentRepository` y `AsyncTournamentLibraryRepository` (`async-tournament-repository.ts`) tienen los mismos métodos y la misma semántica, pero devuelven promesas y hacen obligatorias las escrituras con historial. Los implementa `MongoTournamentRepository` en `apps/api`:

- Cada escritura con historial es una transacción real (replica set): el torneo, o los torneos, y su evento se guardan juntos o no se guarda nada.
- Antes de escribir valida igual que `localStorage`, con `getTournamentStorageIssue` (`application/validation/tournament-storage.ts`): integridad, jugadores, reglamento y detalles de partido.
- **Concurrencia optimista**: cada documento lleva `_version`. Una instancia del repositorio es una unidad de trabajo que recuerda la versión de lo que leyó; al guardar exige que siga vigente. Si no, lanza `TournamentVersionConflictError` y aborta la transacción. Tampoco permite sobrescribir a ciegas un torneo existente que no leyó.
- No implementa lo específico del navegador: universos deportivos, copia `cancha.recovery` e importación de respaldos.
- **Versión de biblioteca**: `library_state` guarda además, por usuario, la versión de su biblioteca, que sube en cada escritura. Sirve para detectar *write skew*: un caso de uso que decide leyendo el torneo B y escribe sólo el A.

### Biblioteca por usuario

Cada instancia de `MongoTournamentRepository` está acotada a un usuario (`new MongoTournamentRepository(client, db, userId)`), y la unidad de trabajo recibe ese userId de la sesión (`run(userId, …)`, `read(userId, …)`). Los resolvers nunca aceptan un userId del cliente.

- **Clave compuesta**: todos los documentos de la biblioteca (torneos, actividad, contadores y estado) tienen `_id: { userId, id }`. Se eligió en vez de un campo `userId` con un índice único secundario porque el repositorio detecta conflictos con la clave duplicada al insertar. El índice de `_id` existe siempre; uno secundario se crea de forma asíncrona al arrancar, y en una base nueva habría una carrera. Además, dos usuarios pueden tener el mismo id de torneo o de evento sin chocar, así que ninguna colisión revela que algo de otro usuario existe.
- **Índices por usuario**: una búsqueda por `"_id.userId"` no puede usar el índice de `_id`. Por eso hay índices secundarios que empiezan por `_id.userId` (torneos ordenados por guardado, historial ordenado por registro), verificados con `explain()` en las pruebas.
- **Versión y torneo activo por usuario**: la escritura de un usuario no invalida la lectura de otro, así que dos usuarios trabajando a la vez nunca ven un conflicto ni provocan reintentos.
- **Lo ajeno no existe**: como la biblioteca cargada sólo contiene lo propio, un torneo de otro usuario responde `NOT_FOUND` por los mismos caminos que uno inexistente. Restaurar con REPLACE sólo borra la biblioteca propia.
- **Datos anteriores**: la biblioteca global de antes de la fase 4B (documentos con `_id` de texto) queda invisible para todos. La API avisa al arrancar; se vacía con `npm run db:reset`. No hay migración: eran datos de desarrollo, y la ruta exportar → restaurar ya está probada.

### Unidad de trabajo del servidor

Los casos de uso de core son síncronos y el repositorio de MongoDB es asíncrono. En lugar de duplicarlos, `LibraryUnitOfWork` (`apps/api/src/library/`) los ejecuta **sin cambios** en tres pasos:

1. **Cargar**: `MongoTournamentRepository.loadLibrary()` lee en una transacción *snapshot* los torneos con sus versiones, la actividad, el torneo activo y la versión de la biblioteca.
2. **Ejecutar**: el caso de uso corre sobre un `InMemoryTournamentRepository`, un adaptador síncrono que cumple la suite de contrato y registra lo que cambió: torneos guardados y eliminados, eventos y torneo activo.
3. **Escribir**: `MongoTournamentRepository.commit(cambios, versionesLeídas)` lo escribe todo en **una** transacción. Exige que la versión de la biblioteca y la de cada torneo escrito sigan siendo las leídas. Un conflicto aborta todo.

Consecuencias:

- **Atomicidad por caso de uso**: aunque llame varias veces a `save` o `saveWithActivity`, como `simulateChampionship`, se hace un único commit.
- **Si el caso de uso lanza**, no se escribe nada. La excepción son los eventos de rechazo (`outcome: "rejected"`, p. ej. `tournament-import-rejected`), que se registran aparte, igual que en la web.
- **Versión del cliente**: `run(trabajo, { expectedVersions })` compara la versión que editó el cliente antes de ejecutar nada. Si ya no es la vigente, lanza `TournamentVersionConflictError`; un torneo inexistente es `NotFoundError`.
- **Conflicto sólo de biblioteca**: otro cliente escribió otro torneo. Se reintenta hasta 3 veces sobre datos frescos, comprobando de nuevo la versión esperada. Es seguro porque el caso de uso se vuelve a ejecutar completo.
- **Costo**: cada petición carga la biblioteca completa del usuario, en memoria y latencia O(biblioteca del usuario). Es aceptable con bibliotecas de decenas de torneos.
- **Sólo síncronos**: la unidad de trabajo admite únicamente casos de uso síncronos. Los asíncronos, como la importación oficial o la generación de grupos, quedan pendientes.

### API GraphQL

`apps/api/src/graphql/` expone la biblioteca en `/graphql` (Apollo, esquema *code-first*).

- **Resolvers delgados** (`library.resolver.ts`): cada operación es un caso de uso de core ejecutado con `LibraryUnitOfWork`, más la traducción a tipos GraphQL (`tournament-mapper.ts`). Los cálculos (tabla, partidos jugados, estado) los hace core. La orquestación que antes vivía en la web pasó a core para que el servidor no la duplique:
  - `persistTournamentProgress`;
  - la simulación por jornada o rueda (`simulate-tournament-selection.ts`).
- **Tipos y JSON**:
  - Tienen tipos GraphQL lo que un cliente liviano muestra o filtra sin conocer core: el resumen de la biblioteca, el calendario, la tabla y la actividad.
  - El documento completo del torneo va como escalar `JSON`. Tiene decenas de estructuras opcionales y versionadas (reglamentos, planes, resoluciones…), y tiparlas en GraphQL duplicaría el modelo y divergiría con cada extensión de v7. El cliente ya tiene los tipos de core.
- **Versiones**: las consultas devuelven `version` por torneo y `libraryVersion`. Las mutaciones sobre un torneo reciben `expectedVersion`, que la unidad de trabajo compara antes de ejecutar.
- **Errores** (`graphql-errors.ts`, en `formatError`):
  - `CONFLICT`, con la versión vigente;
  - `NOT_FOUND`;
  - `VALIDATION`, para los `Error` de core, con su mensaje en español;
  - `UNAUTHENTICATED`, `FORBIDDEN` (origen no permitido) y `TOO_MANY_REQUESTS` (rate limit), de la autenticación;
  - `INTERNAL_SERVER_ERROR` genérico para todo lo demás.

  Los errores propios de GraphQL conservan su código. Fuera de desarrollo no hay *stack traces*, GraphiQL ni introspección.
- **Límites**: una regla de validación propia (`depth-limit.rule.ts`) rechaza consultas de más de 10 niveles antes de ejecutarlas. Sólo en desarrollo exceptúa la introspección, porque la consulta estándar de GraphiQL tiene 15. El cuerpo JSON admite hasta 32 MB: un respaldo de 60 torneos simulados, exportado con sangría como lo hace la web, ocupa 8,2 MB dentro de la petición. El límite por defecto de Nest (100 KB) rechazaba respaldos reales.
- **Arranque compartido** (`src/bootstrap.ts`): `configureApp` fija CORS, el body parser, `cookie-parser` y `trust proxy`. Lo usan `main.ts` y las pruebas e2e, así que las pruebas ejercitan la misma configuración HTTP que producción.

### Autenticación

`apps/api/src/auth/` agrega cuentas y sesiones. Las decisiones principales:

- **Dónde viaja cada token**:
  - El access token es un JWT HS256 de 15 minutos que va en `Authorization: Bearer`. El cliente lo guarda sólo en memoria. Como no es una cookie, el navegador no lo adjunta solo en una petición entre sitios, y las operaciones de la biblioteca no quedan expuestas a CSRF.
  - El refresh token va en la cookie `cancha_refresh`, `HttpOnly`, `Secure` y con `Path=/graphql`: un XSS no puede leerlo ni sacarlo del navegador, como sí podría desde `localStorage` o desde el cuerpo de una respuesta.
  - `SameSite` es `Lax` por defecto y configurable. En la fase 8 la web hará un *rewrite* de `/graphql` hacia la API, así que serán el mismo origen y `Lax` basta. `None` (que exige `Secure`) queda disponible para un despliegue entre sitios, con el riesgo de que los navegadores que bloquean cookies de terceros la descarten.
- **CSRF de la cookie**: Apollo exige un preflight a toda petición (`csrfPrevention`). CORS sólo responde con credenciales a `CORS_ORIGINS`. Además, `refreshToken` y `logout` rechazan con `FORBIDDEN` un `Origin` que no esté en la lista.
- **Sesiones y rotación**:
  - Cada login o registro crea una sesión (`sessions`, `_id` = familia) y su primer refresh token.
  - Un refresh token tiene la forma `id.secreto`, y en `refresh_tokens` sólo se guarda el hash SHA-256 del secreto. Basta SHA-256 porque el secreto tiene 256 bits aleatorios; argon2 se reserva para las contraseñas.
  - `refreshToken` marca el token como usado e inserta el siguiente de la misma familia, en una transacción.
  - Si llega un token ya usado, se trata como robo: se revoca la familia completa (la sesión y todos sus refresh tokens). Las demás sesiones del usuario siguen activas.
- **Revocación inmediata**: el JWT lleva `sub` (usuario) y `sid` (sesión). El guard global (`APP_GUARD`) verifica firma y vencimiento, y además que la sesión siga activa (un `findOne` por `_id`). Así, `logout` y la detección de robo cortan también los access tokens vigentes. Comparada con cargar la biblioteca en cada petición, esa lectura es despreciable.
- **Login sin filtraciones**: si el email no existe se ejecuta igual `argon2.verify` contra un hash ficticio, y el mensaje es siempre "Email o contraseña incorrectos". El registro sí informa que el email está en uso: evitarlo exige verificación por correo, que todavía no existe. El rate limit lo mitiga.
- **Índices**: los de `users` (email único) y los TTL de `sessions` y `refresh_tokens` se crean antes del primer registro o login, con un memo. Así la unicidad del email no depende de que haya terminado una tarea asíncrona de arranque, y la API sigue arrancando sin Mongo.
- **Operaciones públicas**: `@Public()` marca `GET /health`, `register`, `login` y `refreshToken`. Esas tres mutaciones tienen rate limit por IP y por operación (`GqlThrottlerGuard`, una adaptación de `@nestjs/throttler` a GraphQL). Su almacenamiento es en memoria, válido para una instancia; con varias haría falta uno compartido (p. ej. Redis).

### Suite de contrato

`describeTournamentRepositoryContract` (`packages/core/src/test-utils/tournament-repository-contract.ts`) recibe una fábrica de repositorios y verifica en 13 casos el comportamiento que esperan los casos de uso, con el puerto síncrono o el asíncrono. Provoca los fallos sólo con entradas inválidas, así que funciona con cualquier adaptador sin inyectar errores de almacenamiento. La ejecutan el adaptador de `localStorage` (en `apps/web`), el de MongoDB y el repositorio en memoria de la unidad de trabajo (ambos en `apps/api`); un adaptador nuevo debe pasarla también.

### Puntos de guardado

`SaveCheckpointStore` (`save-checkpoint-store.ts`) define el almacén de puntos de guardado, implementado sobre IndexedDB por `IndexedDbSaveCheckpointStore`. Sus operaciones de reemplazo y eliminación comparan primero con el valor esperado (compare-and-set), y `exclusive()` garantiza exclusión entre pestañas.

En el servidor no se usan ni `SaveCheckpointStore` ni `LibraryWriteLease`: las transacciones, la versión de cada torneo y la de la biblioteca reemplazan la exclusión entre pestañas. Los puntos de guardado del servidor son por usuario:

- **Puerto propio**: `AsyncSaveCheckpointStore` (`async-save-checkpoint-store.ts`) no tiene `exclusive(action(lease))`. Ese método existe para serializar pestañas con Web Locks y emitir el comprobante que exige localStorage. Entre instancias de un servidor no hay un bloqueo que pueda sostenerse durante un `await`, y la coordinación la dan las transacciones y las versiones. Implementarlo como una operación vacía haría creer que hay una exclusión que no existe.
- **Misma lógica que la web**: crear, verificar (huella SHA-256 y coherencia con los metadatos) y comparar con la biblioteca actual son funciones de core (`save-checkpoints.ts`), extraídas de la clase de la web sin cambiar su comportamiento.
- **Revisar y confirmar sin memoria compartida**: en la web, la revisión de una restauración se ata a su confirmación con un `WeakMap`, lo que no sirve entre dos peticiones HTTP. En el servidor, la vista previa devuelve la versión del punto y la de la biblioteca, y la restauración exige ambas. La unidad de trabajo compara la versión de biblioteca antes de ejecutar (`expectedLibraryVersion`), y el compare-and-set del punto se hace dentro de la misma transacción que reemplaza la biblioteca (`beforeCommit`). Ese compare-and-set es una escritura, para que un borrado concurrente choque con la restauración en vez de pasar inadvertido. Si algo cambió, no se escribe nada.
- `MongoSaveCheckpointStore` (`apps/api/src/save-checkpoints/`) guarda cada punto con `_id: { userId, id }` y `_version`, como la biblioteca. Un punto de otro usuario responde `NOT_FOUND`.

### Coordinación entre pestañas

`LibraryWriteLease` (`library-write-lease.ts`) es un comprobante opaco que no depende del navegador. La infraestructura web lo emite mientras tiene el bloqueo de la biblioteca, usando la Web Locks API (bloqueo `cancha.save-checkpoints`), y las escrituras que lo requieren verifican que siga vigente. En navegadores sin Web Locks se rechazan las restauraciones. Más detalle en [la coordinación de escrituras entre pestañas](cross-tab-write-coordination.md).

### Fuentes oficiales

`OfficialLeagueSource` (`official-league-source.ts`) define cómo se obtiene una temporada publicada: `fetchSeason(league, zone?)` devuelve una `OfficialLeagueSeason`. Si la fuente no responde o cambia de formato, la importación falla con un error; nunca se guarda una importación parcial.

## Formato JSON v7

Los respaldos se generan y leen en `packages/core/src/application/services/tournament-archive.ts`, y la importación se resuelve en `application/use-cases/import-tournament-archive.ts`.

- **Envoltorio:** `{ "format": "cancha-tournament", "version": 7, "exportedAt": … }` para un campeonato, o `{ "format": "cancha-backup", "version": 7, "exportedAt": … }` para la biblioteca completa. El respaldo de biblioteca incluye el historial de actividad desde la versión 7.
- **Contenido:** el modelo deportivo completo (equipos, fixture, marcadores y penales, temporada, formato, puntos, desempates y reglas versionadas), los perfiles de jugadores y sus pertenencias, y datos opcionales de cada partido: alineaciones, sustituciones, eventos, programación (`schedule`, con `date` en formato `AAAA-MM-DD`, `time` en `HH:mm` como hora local sin zona horaria, `venue` y `logisticsNotes`) y estado operativo. No incluye datos de usuario ni estado de la interfaz.
- **Compatibilidad:** se leen todas las versiones anteriores, incluida la versión 0 (sin envoltorio ni número de versión). Los archivos de una versión posterior o con estructura inválida se rechazan completos, sin importación parcial. A los archivos antiguos no se les inventan datos que no tenían; por ejemplo, un respaldo de la versión 6 o anterior no recibe estados operativos ni eventos históricos.
- **Evolución:** las funcionalidades nuevas amplían la versión 7 con campos opcionales (por ejemplo `continentalPlans`, `seasonPreparation` o las resoluciones oficiales) en lugar de crear una versión nueva, y su ausencia en respaldos anteriores sigue siendo válida. Todo lo que se importa pasa por la validación de integridad del dominio antes de guardarse.
- **Recuperación:** al restaurar con **Reemplazar biblioteca** se guarda antes una copia en `cancha.recovery`, siempre que la biblioteca anterior sea válida.
- **Restauración compartida:** `application/services/library-restore.ts` (`validateLibraryRestore` y `planLibraryRestore`) calcula, sin escribir, la biblioteca, el historial, el evento `library-restored` y el torneo activo que resultan de agregar o reemplazar. Lo usan `LocalStorageTournamentRepository.importTournaments`, que añade los universos deportivos y la copia de recuperación, e `InMemoryTournamentRepository.importTournaments` en el servidor. El caso de uso `restore-tournament-backup` parsea el respaldo y llama al método opcional `importTournaments` del puerto.
- **En el servidor** (GraphQL): `exportTournament`, `exportLibrary`, `importTournament` y `restoreBackup`. La restauración se escribe en una sola transacción (`replaceLibrary`/`replaceActivity` en el commit de la unidad de trabajo). Los universos deportivos del respaldo se ignoran y no hay copia de recuperación automática; el equivalente es crear antes un punto de guardado.

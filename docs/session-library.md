# Biblioteca con sesión (fase 5)

## Objetivo y alcance

Una persona con cuenta guarda su biblioteca en el servidor (`apps/api`, MongoDB) y la abre desde cualquier navegador. Sin sesión, Cancha funciona exactamente como antes: la biblioteca vive en `localStorage` y los puntos de guardado en IndexedDB. Crear una cuenta es opcional.

Con sesión se puede:

- crear una cuenta, ingresar y cerrar sesión desde el botón **Cuenta** de la cabecera;
- llevar la biblioteca de este navegador a la cuenta, con confirmación y sin borrarla del navegador;
- usar todas las funciones de la aplicación sobre la biblioteca de la cuenta: crear, editar, simular, temporadas, sorteos, cierres, universos, importar y restaurar respaldos;
- crear, descargar, eliminar y restaurar puntos de guardado de la cuenta;
- trabajar desde dos pestañas o dispositivos: si otro cambió la biblioteca, se avisa y no se sobrescribe nada a ciegas.

Fuera de alcance: trabajar sin conexión con sesión (una escritura sin red falla y no se guarda), editar el nombre o la descripción de un punto de la cuenta, y la copia automática de recuperación (`cancha.recovery`), que con sesión reemplazan los puntos de la cuenta.

## Decisión de arquitectura (C3)

Los casos de uso de `@cancha/core` son síncronos y la API es asíncrona, así que no puede existir un repositorio GraphQL síncrono. Se descartaron:

- **sincronizar la biblioteca completa** (subirla y bajarla entera): cada clic movería megabytes, el servidor sería sólo una copia y dos dispositivos obligarían a elegir una versión;
- **una mutación por operación**: obliga a refactorizar las 54 escrituras de la web y deja sin versión con sesión 24 de los 32 casos de uso hasta implementarlos en el servidor.

Se eligió una **réplica en memoria con envío de conjuntos de cambios**:

1. La web descarga la biblioteca de la cuenta (`librarySnapshot`) en un `InMemoryTournamentRepository` de core, el mismo que usa la unidad de trabajo del servidor.
2. Cada escritura ejecuta los mismos casos de uso síncronos sobre un borrador y obtiene `changes()`.
3. Envía esos cambios con `commitLibraryChanges(changes, expectedLibraryVersion)`. El servidor **valida todo lo que llega** y lo escribe en una transacción, sólo si la biblioteca sigue en la versión que leyó el cliente.

Así, las 54 escrituras y los 32 casos de uso funcionan con sesión desde el primer día, incluidos los de revisar → confirmar y los importadores.

## Reglas del servidor

`commitLibraryChanges` (`LibraryUnitOfWork.commitChanges` + `validateLibraryChanges` de core):

- La biblioteca debe seguir en `expectedLibraryVersion`; si no, `CONFLICT` sin escribir y sin reintentos.
- Cada torneo pasa `getTournamentStorageIssue` y cada evento `isActivityEvent`. Un torneo construido a mano que no los pase es `VALIDATION` sin escribir nada.
- No admite `replaceLibrary` ni `replaceActivity`: reemplazar la biblioteca sólo se hace con `restoreBackup`.
- **La actividad sólo se agrega**: un evento con un id ya registrado se ignora y nunca reemplaza al guardado. El `tournamentId` de cada evento nuevo debe existir en la biblioteca o venir en el mismo envío, salvo una lista cerrada de acciones sin torneo (`libraryLevelActivityActions`: rechazos de importación e incidencias de fuente), que tampoco pueden traer un torneo completo.
- **Universos**: se validan siempre sobre la biblioteca resultante. Si cambian, el servidor reatribuye el `universeId` de los eventos existentes con la misma regla que `localStorage` (`reattributeActivityToUniverses`); es lo único de un evento guardado que puede cambiar, y un cliente no puede pedirlo directamente.

Restaurar respaldos (MERGE o REPLACE) y migrar la biblioteca local van por `restoreBackup(backup, mode, expectedLibraryVersion)`.

## La web con sesión

- **Sesión** (`infrastructure/api/auth-session.ts`): el access token vive sólo en memoria y el refresh token es la cookie HttpOnly que fija la API. El refresh se serializa entre pestañas con un Web Lock: dos pestañas rotando la misma cookie a la vez harían que la API detectara una reutilización y cerrara la sesión. En `localStorage` sólo queda la pista `cancha.session.hint`, sin datos; sin ella la web no hace ninguna petición a la API.
- **Biblioteca** (`infrastructure/api/session-library-backend.ts`): implementa la misma interfaz que `localStorage` (`LibraryBackend`). La aplicación la monta en lugar de la local cuando hay sesión, con otra `key`, así que los borradores de sesión no pasan de una biblioteca a otra.
- **Cambios desde otro lugar**: si otra pestaña o dispositivo escribió, la siguiente escritura recibe `CONFLICT`, la réplica se recarga y aparece el aviso de cambios externos de siempre ("La biblioteca cambió en otra pestaña o dispositivo"). También se detecta al volver a la pestaña y entre pestañas del mismo navegador.
- **Puntos de guardado** (`infrastructure/api/server-checkpoint-service.ts`): el centro de guardado usa los puntos de la cuenta (hasta 20). Restaurar exige que ni la biblioteca ni el punto hayan cambiado desde la vista previa.
- **Migración** (`components/account-migration.tsx`): al iniciar sesión con una biblioteca en este navegador, se ofrece subirla (cuenta vacía), agregarla o reemplazar la de la cuenta. Reemplazar exige confirmar y guarda antes el punto «Antes de migrar la biblioteca local». La biblioteca del navegador sólo se lee; una marca por cuenta (`cancha.accountMigration.<id>`) evita volver a preguntar.
- Al cerrar sesión vuelve la biblioteca de este navegador, intacta.

## Desarrollo local

```bash
npm run db:up                             # MongoDB en Docker (replica set)
cp apps/api/.env.example apps/api/.env   # una vez
npm run dev:api                           # API en http://127.0.0.1:3000
npm run dev                               # web en http://127.0.0.1:5173; /graphql se reenvía a la API
```

- La web habla con la API por el mismo origen: Vite reenvía `/graphql` a `CANCHA_API_URL` (por defecto `http://127.0.0.1:3000`), como hará el *rewrite* de Vercel en producción.
- El origen de la web debe estar en `CORS_ORIGINS` de la API (por defecto incluye `http://127.0.0.1:5173` y `http://localhost:5173`; para `preview` agrega su puerto).
- La cookie de sesión es `Secure`. Chromium y Firefox la aceptan sobre `http://127.0.0.1`; en WebKit puede hacer falta `AUTH_COOKIE_SECURE=false` en `apps/api/.env` (prohibido en producción).
- `npm run dev:public` no expone `/graphql`: el acceso temporal sigue siendo sólo para la web sin sesión.

## Limitaciones conocidas

- **Importar desde fuentes oficiales desplegado** (fase 6): los importadores siguen en el navegador y consultan `/official-source`, `/third-division-source`, `/argentina-cup-source` y `/brazil-cup-source` por el mismo origen. En producción las sirve la API, así que el *rewrite* debe incluirlas junto a `/graphql`. En desarrollo, el plugin de Vite usa el mismo proxy (`docs/official-source-proxy.md`).
- Sin conexión no se puede escribir con sesión; no hay cola de cambios pendientes.
- Dos dispositivos que editan torneos distintos al mismo tiempo también ven el aviso de cambios externos: la web no reintenta sola, porque la acción se decidió con datos que ya cambiaron.
- La biblioteca de la cuenta se carga completa al abrirla y el servidor la carga completa en cada escritura: O(biblioteca del usuario).
- Agregar una biblioteca a la cuenta no duplica torneos con el mismo identificador: conserva los de la cuenta.

## Enlaces públicos de torneos

Desde el panel de cuenta se puede crear un enlace de solo lectura ingresando el ID del torneo y revocarlo mientras su token siga disponible en el panel. El enlace usa `/share/<token>` y muestra tabla, partidos y líder actual sin cargar la biblioteca en el navegador. El campeón se presenta como provisional porque la primera posición no certifica por sí sola un cierre oficial.

La API genera 256 bits aleatorios y guarda únicamente el SHA-256 del token en `tournament_shares`. La lectura pública consulta solamente el dueño y torneo asociados a ese hash; no entrega actividad, universos, sesiones ni otros torneos. La consulta pública tiene un límite de 30 solicitudes por IP y minuto, independiente del límite de autenticación. La revocación está acotada al usuario autenticado y devuelve el mismo resultado genérico que un token ya revocado.

## Verificación

- `npm test`: core (validación de envíos, reatribución, réplica en memoria), API (`library-changes.e2e`, `library-universes.e2e`, puntos de guardado, esquema publicado) y web (cliente y sesión, réplica, puntos, migración y recorridos de `App` contra un servidor en memoria que usa las validaciones reales de core).
- `apps/api/schema.graphql` es el esquema publicado de la API: una prueba de la API exige que coincida con el real (`UPDATE_GRAPHQL_SCHEMA=1` lo regenera) y `apps/web/src/infrastructure/api/operations.test.ts` valida contra él cada operación que envía la web.
- `npm run test:e2e:session`: Playwright (Chromium) con la pila real (web compilada, proxy de Vite, API compilada y MongoDB en memoria, sin Docker): registro, migración, guardado, recarga con la sesión recuperada, cambio desde otro dispositivo y cierre de sesión.
- `npm run test:flows` mantiene sus 92 pruebas sin cambios: el modo sin sesión no cambió.

# Arquitectura de Cancha

Este documento describe cómo está organizado el código de Cancha, qué reglas separan sus capas, cómo se persisten los datos y qué formato tienen los respaldos JSON. Para instalar y ejecutar el proyecto, consulta el [README](../README.md).

## Estructura del monorepo

El repositorio es un monorepo con npm workspaces. Todas las órdenes `npm` se ejecutan desde la raíz.

| Paquete | Ruta | Contenido |
| --- | --- | --- |
| `@cancha/core` | `packages/core` | El modelo deportivo (`src/domain`), los casos de uso y puertos (`src/application`) y fixtures reutilizables para pruebas (`src/test-utils`). Es TypeScript puro, sin DOM ni APIs del navegador o del servidor. |
| `@cancha/web` | `apps/web` | La aplicación React/Vite: adaptadores de infraestructura (`src/infrastructure`), interfaz (`src/presentation`), pruebas de casos de uso contra los adaptadores reales (`src/integration`), utilidades de prueba y muestras de los importadores (`src/test-utils`), pruebas de navegador (`e2e/`), scripts de desarrollo (`scripts/`) y la configuración de Vite y Playwright. |
| `@cancha/api` | `apps/api` | Reservado para una API futura (fase 2). Todavía no contiene código. |

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

La regla se extiende a todo `@cancha/core`, que es TypeScript puro y determinista. Cualquier efecto (almacenamiento, red, interfaz) entra a través de un puerto definido en `application/ports/` e implementado fuera del núcleo: hoy en `apps/web/src/infrastructure/` y, en la fase 2, en `apps/api`. Gracias a esto el mismo núcleo puede ejecutarse en el navegador, en pruebas con Node y, más adelante, en un servidor.

La regla se comprueba automáticamente:

- El `tsconfig` de `@cancha/core` no incluye la biblioteca de tipos del DOM, así que `npm run build` falla si el núcleo usa tipos del navegador.
- `npm run lint` (ESLint) aplica estas restricciones:
  - En `packages/core/src`, solo se permiten imports relativos dentro del paquete y `vitest` en las pruebas. Quedan fuera React, los módulos de Node y cualquier otro paquete. También se prohíben los globales `window`, `document`, `localStorage`, `sessionStorage`, `indexedDB`, `navigator`, `location`, `process`, `Buffer`, `require`, `__dirname` y `__filename`.
  - En `packages/core/src/domain`, además, no se puede importar `application` ni `test-utils`, tampoco desde las pruebas. Una prueba que necesita casos de uso se ubica en `packages/core/src/application`.
  - En `apps/web`, el núcleo se importa solo como `@cancha/core/...`. Además se comprueban las reglas de hooks de React (`rules-of-hooks` como error y `exhaustive-deps` como advertencia).

## Puertos de persistencia

Las interfaces están en `packages/core/src/application/ports/` y sus implementaciones en `apps/web/src/infrastructure/persistence/`.

### Repositorio de torneos

`TournamentRepository` y `TournamentLibraryRepository` (`tournament-repository.ts`) definen cómo se guardan y leen los torneos, la biblioteca y el historial de actividad. La única implementación es `LocalStorageTournamentRepository`, que usa las claves `cancha.tournaments`, `cancha.activity`, `cancha.sportsUniverses` y `cancha.recovery`, además de la selección activa.

- **`saveWithActivity(tournament, event)`** es la forma de guardar cualquier cambio que deba quedar registrado: escribe el torneo y su evento de actividad de manera coordinada. Si falla una de las escrituras, el adaptador intenta revertir ambas; si la reversión también falla, el error lo indica explícitamente. No equivale a una transacción del navegador.
- Los casos de uso guardan mediante el servicio `saveWithActivity` de `application/services/activity-log.ts`. Ese servicio rechaza el guardado si el repositorio no ofrece escritura coordinada, en lugar de guardar el torneo y el evento por separado (lo que podría dejar uno sin el otro). También añade al evento las resoluciones oficiales que el cambio haya invalidado.
- `saveManyWithActivity` cubre las operaciones que modifican varios torneos a la vez, como la creación de temporadas vinculadas entre divisiones o la simulación de una temporada completa.
- `recordActivity` registra eventos que no corresponden a un torneo guardado, como una importación rechazada.

### Puntos de guardado

`SaveCheckpointStore` (`save-checkpoint-store.ts`) define el almacén de puntos de guardado, implementado sobre IndexedDB por `IndexedDbSaveCheckpointStore`. Sus operaciones de reemplazo y eliminación comparan primero con el valor esperado (compare-and-set), y `exclusive()` garantiza exclusión entre pestañas.

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

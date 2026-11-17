# Centro de simulación de temporadas

## Auditoría previa y arquitectura

La simulación ya existe en `simulate-fixtures.ts`, `simulate-championship.ts` y `simulate-argentina-half.ts`; estos últimos pueden encadenar etapas, por lo que el Centro utiliza exclusivamente `simulateFixtures` con `pendingOnly`. El motor aleatorio sigue siendo `match-simulator.ts`. No se introduce un motor adicional ni se cambian reglas deportivas.

`advanceTournamentProgress` ya coordina progresiones argentinas, ascenso chileno, segunda división y copas. Los calendarios y su programación ya están implementados en `MatchCalendar`, `CalendarProgrammingCenter` y `program-season-calendar.ts`. El Centro no llama generadores ni crea temporadas; consume encuentros registrados. El avance propio del simulador puede habilitar cruces mediante los servicios deportivos existentes, pero no los simula en la misma confirmación.

Reglamentos, validación de partidos y desempates se reutilizan desde `validateTournamentIntegrity`, `getCompetitionAlerts`, `projectSeasonProgression` y los servicios de clasificaciones existentes. Tablas y estadísticas se proyectan desde los encuentros; dashboard, historial de clubes, palmarés y clasificación internacional consumen las mismas temporadas y actividad. No hay copias de estas proyecciones que deban mantenerse por separado.

`simulate-season-scope.ts` coordina revisión y confirmación. `SeasonSimulationCenter` presenta temporada, formato, avance, estado de reglas y clasificación, encuentros afectados, resultados conservados y bloqueos. Hay accesos desde la navegación general, el Centro de competiciones, dashboards de universo, calendario y progresión encadenada. `SeasonSimulationNavigation` coordina solamente navegación; no ejecuta operaciones deportivas.

## Alcances

- Jornada: una jornada registrada, identificada por su índice dentro del calendario.
- Rueda: jornadas de una rueda, exclusivamente para formatos sin grupos ni etapas.
- Fase: jornadas con el mismo nombre de fase registrado.
- Competición: pendientes del calendario de una liga sin grupos ni etapas.

Los formatos por etapas, copas y grupos requieren jornada o fase, con los encuentros anteriores completos. Las copas sin etapas reglamentarias registradas quedan bloqueadas. No se ofrece completar automáticamente varias fases, decidir sorteos, resolver documentación, generar participantes o iniciar futuras temporadas.

## Validaciones y confirmación

La revisión no genera marcadores, no avanza el torneo y no escribe en el repositorio. Identifica pendientes y resultados existentes por separado. Solo una confirmación explícita invoca el simulador.

Se requieren reglas anuales verificadas y coherentes con la temporada. Un reglamento de partidos registrado también debe estar verificado. Se revisan integridad, calendario, referencias a participantes, estados operativos, dependencias, alertas y desempates. Un torneo archivado queda bloqueado. Los bloqueos ofrecen acceso al calendario y al Centro de alertas, desde donde se continúa hacia los flujos deportivos existentes.

La revisión se registra en un WeakMap privado junto con una instantánea de las temporadas y actividad del repositorio del universo. La confirmación comprueba identidad de la revisión, contenido, universo y estado actual, y repite todas las validaciones. Revisiones copiadas, manipuladas, ya consumidas o anteriores a cualquier cambio del universo requieren nueva revisión. La invalidación es deliberadamente conservadora: incluso un cambio en otra temporada del mismo universo obliga a revisar nuevamente.

Se usa el repositorio limitado al universo activo y se consulta el universo persistido al confirmar. La escritura existente también revalida pertenencia. Después de confirmar, el simulador y `advanceTournamentProgress` trabajan primero contra un adaptador transitorio en memoria. Esto permite coordinar Libertadores y Sudamericana con el mismo servicio que usan los controles actuales, comprobar todos los torneos afectados y conservar la actividad del simulador. Antes de guardar se comprueba que la progresión no eliminó ni modificó ninguno de los encuentros que ya tenía resultado, que los datos resultantes pasan integridad, que no se crearon temporadas y que la revisión sigue vigente. Se confirma mediante `saveWithActivity` o, para varias copas, `saveManyWithActivity`, con la recuperación coordinada existente. Si el repositorio no admite la operación conjunta, se rechaza antes de escribir. El adaptador no genera resultados ni implementa reglas deportivas.

## Procedencia, persistencia e integración

Se mantiene `saveWithActivity` y el evento `matches-simulated` con los identificadores y marcadores. `matchResultOrigin` distingue operaciones manuales y simuladas mediante la actividad registrada. Los resultados importados se muestran como importados de fuente sin certificar su oficialidad. No se infiere que un marcador sea oficial a partir del calendario. Los respaldos antiguos sin actividad no permiten acreditar individualmente todos los resultados.

No se cambia el modelo ni JSON v7. Los resultados y su actividad usan el almacenamiento, recuperación y respaldos actuales. Después de guardar, la aplicación vuelve a leer temporadas y actividad y actualiza el torneo abierto. Las proyecciones existentes recalculan tablas, estadísticas, pendientes, dashboard, historial, palmarés, clasificaciones y progresión según sus propias condiciones reglamentarias.

Se corrigió además `simulateFixtures`: cuando un encuentro simulado tiene un estado operativo registrado, pasa a `finished` en todos los formatos, no solo en segunda división. Así un marcador recién simulado no permanece marcado como programado ni queda excluido de las estadísticas. Los estados que impiden simular siguen usando el bloqueo deportivo existente.

## Limitaciones

El acceso «Crear punto de control antes de simular» abre el Centro de guardado
existente con un nombre sugerido editable. Crear el punto no simula ni modifica
actividad deportiva; al volver se conserva el alcance y la revisión mientras
sigan vigentes. Restaurar una partida descarta revisiones y borradores previos.
Véase [Puntos de control manuales](save-checkpoints.md).

- La progresión continental usa exclusivamente los formatos que ya reconoce el servicio existente; no se infieren cruces para nuevas ediciones o formatos desconocidos.
- No se atribuye retrospectivamente certificación oficial ni procedencia individual ausente en respaldos históricos.
- La disponibilidad reglamentaria se basa en los registros y validaciones existentes, sin certificar documentos externos.
- No hay simulación multitemporada ni reanudación automática al abrir el Centro.

## Pruebas

La suite nueva comprueba jornadas, ruedas, fases y pendientes de competición; preservación de resultados importados y manuales; revisión sin azar ni escrituras; confirmación obsoleta/manipulada; cambio de universo; calendario ausente; reglas pendientes; participantes desconocidos; eliminatorias bloqueadas; desempates pendientes; estadísticas; dashboard; persistencia y respaldo JSON v7. Las pruebas de interfaz comprueban confirmación explícita y navegación. Un recorrido Playwright comprueba en navegador que abrir y revisar no genera resultados y que confirmar guarda solamente la jornada elegida.

### Comparación de Vitest

El entorno utiliza Node v22.18.0, Vitest 5.0.4 y Windows, con 8 procesadores disponibles. La configuración del proyecto conserva únicamente `environment: "node"`; las pruebas de interfaz declaran jsdom por archivo. La función `getDefaultMaxWorkers` del Vitest instalado calcula `availableParallelism() - 1` en modo run: aquí el límite predeterminado es **7 procesos concurrentes**, frente a 4 con `--maxWorkers=4`.

El mensaje de Vitest «87/88 workers spawned» contabiliza los procesos aislados creados a lo largo de toda la suite, uno por archivo: no significa 87/88 procesos ejecutándose simultáneamente. Ambas configuraciones conservan el aislamiento y los timeouts existentes.

La primera ejecución predeterminada terminó en 89,22 s: 86 archivos aprobados, uno fallido; 885 pruebas aprobadas y un timeout de 5000 ms en `app-lazy.test.tsx`. La ejecución con 4 workers, después de agregar los tres casos de interfaz, terminó en 104,98 s: 88 archivos y 889 pruebas aprobados. `npm run test:flows` también aprobó sus 70 pruebas con la configuración predeterminada en 31,98 s, incluida la prueba que había agotado el tiempo en la suite completa.

Esto aporta evidencia de sensibilidad a la concurrencia/carga durante el arranque de jsdom e importación de la aplicación; no demuestra un defecto funcional determinista de esa prueba. No se desactiva aislamiento, no se aumenta ningún timeout y no se añaden reintentos. Se registran también las ejecuciones finales después de las correcciones de estado operativo y los casos adicionales.

La ejecución final predeterminada, sin navegadores activos y con la implementación completa de progresión continental, aprobó **88 archivos y 892 pruebas en 62,64 s**. Por tanto, el fallo inicial no es determinista. El orden de ejecución, las cachés y la carga compartida también pueden influir; estas mediciones no constituyen un benchmark que aísle exclusivamente el número de workers ni prueban una causa única del timeout inicial.

La misma versión con `npm test -- --maxWorkers=4`, ejecutada después y también sin navegadores activos, aprobó **88 archivos y 892 pruebas en 93,24 s**. En esta medición el modo predeterminado fue más rápido y ambos aprobaron; no se modifica la configuración del proyecto para favorecer un resultado. Los registros iniciales y finales se conservan por separado.

### Navegadores y compilación

El recorrido nuevo de Playwright agotó inicialmente el tiempo esperando `getByLabel("Alcance", {exact: true})`: la etiqueta incluye el contenido del selector. La captura de accesibilidad mostraba el control correcto. Se corrigió el selector a `getByRole("combobox", {name: "Alcance", exact: true})`, se interrumpió esa ejecución y se verificó la corrección en las 12 combinaciones de Chromium, Firefox y WebKit con tamaños escritorio, notebook, tablet y móvil: **12 aprobadas, 1,2 minutos**. Esta repetición responde a una corrección concreta del test, sin reintentos configurados ni cambios de timeout.

`npm run build` aprobó TypeScript y Vite. Los registros se conservan en [`docs/validation/season-simulation`](validation/season-simulation/).

La ejecución completa de `npm run test:e2e` registró **286 casos aprobados y ningún fallo**, pero su proceso desapareció antes del resumen final y sin archivo `.last-run.json`; no se pudo recuperar una causa ni un código de salida. No se declara esa invocación completa como aprobada. Se ejecutó el proyecto restante mediante `npm run test:e2e -- --project=webkit-mobile`: **26 aprobados, 1,3 minutos**. Así se obtuvo evidencia aprobada para las **312 combinaciones de la matriz en dos ejecuciones**, conservando la interrupción en `e2e-full-interrupted.log` y el resultado restante en `e2e-webkit-mobile.log`. No se cambiaron workers, timeouts ni reintentos de Playwright.

La suite específica final agrega la coordinación continental: ambos torneos se guardan en una sola operación, los cruces derivados permanecen sin resultados y un repositorio sin guardado conjunto no recibe escrituras parciales.

### Resultado final

| Comando / cobertura | Resultado |
| --- | --- |
| `npm test` | 88 archivos, 892 pruebas aprobadas |
| `npm test -- --maxWorkers=4` | 88 archivos, 892 pruebas aprobadas |
| `npm run test:flows` | 5 archivos, 70 pruebas aprobadas |
| Matriz Playwright | 286 casos aprobados antes de la interrupción; 26 restantes aprobados en ejecución separada |
| `npm run build` final | TypeScript y Vite aprobados |

El respaldo continúa en versión 7 y no se agregaron dependencias ni se modificaron reglas de clasificación o desempate.

# Puntos de control manuales de partidas

## Objetivo y alcance

Los puntos guardan versiones completas de la biblioteca de Cancha: todos los torneos y temporadas, sus resultados y calendarios, reglas y planificaciones, actividad y metadatos de todos los universos. Incluyen también los torneos sin asignar. El usuario elige un nombre y una descripción opcional; no se crean puntos automáticamente.

La instantánea contiene los datos guardados en la biblioteca, no los borradores aún sin confirmar de los editores. Crear un punto no confirma esas ediciones deportivas.

Son conceptos distintos: la biblioteca activa permanece en LocalStorage; un universo organiza sus torneos; un punto manual es una copia local en IndexedDB; el respaldo descargado es un archivo JSON v7 independiente; `cancha.recovery` conserva la recuperación automática existente. Los puntos no son universos, ramas ni una segunda biblioteca activa. No contienen otros puntos, evitando copias recursivas.

El almacenamiento del navegador **no es permanente**: puede borrarse, restringirse o agotar su cuota. Los puntos importantes deben descargarse como archivos JSON fuera del navegador.

## Auditoría previa

Se revisaron las implementaciones y las rutas reales de `save-recovery-center.md`, `sports-universes.md`, `sports-universe-dashboard.md`, `season-simulation-center.md`, `calendar-programming-center.md` y `vitest-stability-audit.md`.

- Domain define torneos, partidos, universos y validaciones deportivas. No se modificaron motores ni reglas.
- Application ya dispone de `createTournamentBackup` y `parseTournamentBackupWithActivity`: serializan y validan JSON v7, integridad de torneos, actividad y relaciones entre universos. Se reutilizan sin otro serializador ni validador deportivo.
- `LocalStorageTournamentRepository.findAllWithRecoveryReport()` permite detectar lecturas parciales. Los puntos se bloquean si hay advertencias: nunca se guarda como completa una biblioteca que omitió registros dañados.
- `importTournaments(..., "replace", ..., false, universes)` ya implementa el reemplazo, valida relaciones, registra `library-restored`, prepara `cancha.recovery` cuando corresponde y restaura valores anteriores ante errores. El nuevo flujo llama al mismo `handleRestoreBackup` del Centro; no implementa otro restaurador.
- La combinación por ID y sus conflictos se mantienen en el flujo JSON existente. Los puntos ofrecen reemplazo completo, no una fusión de resultados.
- La extensión v7 `extensions.sportsUniverses` conserva universos, asignaciones y universo activo. El torneo activo individual no forma parte del respaldo v7; al restaurar se selecciona un torneo válido del universo restaurado mediante el comportamiento existente, sin inventar referencias.
- Presentación ya dispone del Centro de guardado, `ConfirmationDialog`, navegación de universos y borradores de sesión. Se amplían estas piezas. `useClearSessionDrafts` y una revisión de montaje descartan editores y referencias obsoletos después de reemplazar o recuperar la biblioteca.
- La simulación existente valida sus revisiones contra datos actuales. Crear puntos no cambia esos datos ni llama a sus casos de uso; una revisión de simulación intacta puede conservarse al volver, y sigue revalidándose al confirmar.

## Arquitectura y archivos

Archivos nuevos:

- `src/domain/entities/save-checkpoint.ts`: contenedor local y estados de validación.
- `src/application/ports/save-checkpoint-store.ts`: puerto asíncrono de almacenamiento, comparación transaccional y coordinación entre pestañas.
- `src/application/services/save-checkpoints.ts`: revisión/confirmación, huella, metadatos, comparación, descarga y coordinación con el restaurador existente.
- `src/infrastructure/persistence/indexed-db-save-checkpoint-store.ts`: API IndexedDB nativa y Web Locks, sin dependencias externas.
- `src/presentation/components/save-checkpoint-panel.tsx`: formulario, listado, detalles, verificación, búsqueda, edición, descarga y confirmaciones.
- `src/presentation/components/save-recovery-access.tsx`: accesos al mismo Centro y solicitud contextual de creación.
- `src/presentation/download-text.ts`: utilidad de descarga extraída del Centro existente y compartida; no añade otro exportador.
- Pruebas de servicio, almacenamiento, flujos y fixtures sintéticos en los archivos `save-checkpoints.test.ts`, `indexed-db-save-checkpoint-store.test.ts`, `app-checkpoints.test.tsx` y `test-utils/save-checkpoint-fixtures.ts`.

Archivos modificados:

- `presentation/app.tsx`: lectura global completa, navegación contextual, llamada al restaurador existente y reinicio de vistas/borradores tras restauración.
- `tournament-library.tsx`: panel dentro del Centro actual y apertura contextual.
- `sports-universe-dashboard.tsx`, `competition-center.tsx`, `season-simulation-center.tsx`: accesos que conducen al mismo flujo.
- `confirmation-dialog.tsx`: estado ocupado opcional, que impide una cancelación aparente mientras una operación ya confirmada se ejecuta.
- `styles.css`: estilos coherentes con Cancha, ajuste de contenido y comparación sin desbordamiento horizontal.
- `package.json`: incorpora los nuevos flujos a `test:flows`; no cambia dependencias.
- `e2e/cancha.e2e.ts`: recorridos con IndexedDB real, recarga, descarga, teclado, restauración, corrupción y dos pestañas.
- Documentación del Centro de guardado, universos y simulación: enlaces y distinción de almacenamiento.

## Almacenamiento y alternativas

La base nativa `cancha.save-checkpoints`, versión de almacenamiento 1, contiene el object store `checkpoints`, con clave `id`. La versión de esta base es independiente de JSON v7. Cada operación abre y cierra su conexión; `versionchange` cierra conexiones antiguas. Una versión futura incompatible o una apertura bloqueada no se oculta ni provoca borrado o migración destructiva.

IndexedDB evita repetir grandes respaldos dentro de la cuota y las escrituras síncronas de LocalStorage. Se descartaron una copia por universo, copias múltiples en LocalStorage, bibliotecas externas, servicios remotos y una migración del almacenamiento deportivo. Si IndexedDB falla, el Centro conserva su exportación/restauración JSON, pero no afirma haber guardado un punto.

Cada registro contiene:

- `storageVersion`, `id`, `name`, `description`, `createdAt`, `updatedAt`, `revision`.
- `backupFormat: "cancha-backup"`, `backupVersion: 7`.
- Cantidades de torneos, universos y actividad; tamaño del JSON codificado en UTF-8, aproximación que no incluye la sobrecarga interna de IndexedDB.
- `integrity: { algorithm: "SHA-256", digest }` y el `content` completo del exportador actual.

La huella usa Web Crypto. Comprueba integridad del contenido, **no autenticidad, cifrado ni protección contra una modificación maliciosa que recalcule la huella**. No se guardan secretos. Nombre y descripción son metadatos editables; el contenido deportivo no se edita desde la interfaz.

## Creación y administración

La revisión muestra alcance completo, cantidades, tamaño, fecha y formato. Solo prepara datos y una huella en memoria: no llama a IndexedDB ni al repositorio deportivo para escribir. Abrir/listar puede inicializar el esquema vacío de IndexedDB; no crea puntos.

La confirmación exige una revisión emitida por el servicio y sin modificaciones. Relee la biblioteca completa y vuelve a validar antes de escribir. Si cambiaron resultados, actividad, universos o cualquier parte de la biblioteca, exige nueva revisión. Impide confirmar dos veces la misma revisión o ejecutar una confirmación duplicada en paralelo.

El adaptador usa `add`, no `put`, para crear: un ID existente nunca se reemplaza. Se espera `transaction.oncomplete`, no el éxito provisional de una solicitud. Después se vuelve a leer y verificar contenido, huella y metadatos. Si la escritura se completa pero la lectura de verificación falla, se informa el error; el registro puede quedar listado como pendiente y no se anuncia protección confirmada ni se borra silenciosamente.

El listado se ordena por fecha descendente. Distingue Disponible, Validación pendiente, Inválido, Incompatible y Error de lectura. Los registros recién leídos no se marcan válidos por tener una huella almacenada. La verificación comprueba SHA-256, el lector JSON existente, cantidades, fecha y tamaño. Se conserva una comprobación anterior solo si el registro completo sigue siendo idéntico; la lista se actualiza con foco, mensajes entre pestañas o el botón de actualización. Las respuestas de lectura antiguas no reemplazan una actualización más reciente.

Nombres repetidos están permitidos; IDs, fecha, descripción y detalles permiten distinguirlos. La búsqueda por nombre aparece con más de cinco puntos. Editar metadatos y eliminar usan comparación exacta dentro de una transacción: no pisan ediciones concurrentes ni recrean un punto eliminado. Eliminar exige confirmación y no modifica la biblioteca deportiva. Descargar verifica primero el punto y entrega exactamente su JSON v7.

## Comparación y restauración

La comparación se calcula una vez por revisión, mediante IDs explícitos de torneo y universo. Muestra elementos en ambos estados, exclusivos de cada uno, cambios de competición/temporada, metadatos de universos, universo activo, cantidades de marcadores y actividad y marcadores actuales que se retirarían o reemplazarían. Cuenta marcadores registrados, sin recalcular ni reinterpretar estadísticas o reglas deportivas. Nombres iguales no unen torneos ni clubes.

La confirmación advierte que se reemplaza la biblioteca completa, incluidos avances posteriores, y ofrece descargar el respaldo completo actual. Descargarlo no inicia el reemplazo. No se crea otro punto previo automáticamente. Cancelar la revisión no escribe nada.

El servicio verifica de nuevo el punto, detecta cambios/eliminaciones y revalida la biblioteca justo antes de llamar al restaurador existente. Las revisiones copiadas, alteradas, consumidas o anteriores a cambios quedan bloqueadas. Se conserva el comportamiento de `cancha.recovery`: si falla su escritura o cualquier escritura coordinada, se propaga el error y se aplica la recuperación existente; no se anuncia éxito sin confirmación del repositorio.

Web Locks coordina la restauración y las mutaciones de puntos con las escrituras deportivas de la aplicación actual mediante el mismo bloqueo global `cancha.save-checkpoints`. El adaptador transmite a la restauración un permiso vigente de esa adquisición, sin solicitar otro bloqueo anidado. La revisión de biblioteca y las transacciones/CAS de IndexedDB se mantienen. Si Web Locks no está disponible, se permiten creación y administración de puntos mediante transacciones y comparación de registros, pero se bloquean tanto el reemplazo desde un punto como las restauraciones JSON. Se puede descargar el archivo. No se afirma atomicidad general entre IndexedDB y LocalStorage: el punto permanece inmutable y la restauración usa la compensación actual. La cobertura, avisos, recuperación y límites frente a versiones antiguas se detallan en [Coordinación entre pestañas](cross-tab-write-coordination.md).

Después de restaurar se actualizan torneos, universos, actividad y torneo activo; las proyecciones existentes actualizan dashboard, historial y estadísticas. Se descartan calendarios/editores abiertos, revisiones de simulación, selecciones obsoletas y borradores de sesión. El modo de los controles de simulación vuelve a «solo pendientes», sin conservar una selección anterior de sobrescritura de otra versión de la partida. La vista previa muestra explícitamente el cambio de universo activo antes de confirmarlo. Un error no elimina el punto restaurable.

## Integración con simulación

«Crear punto de control antes de simular» abre el Centro actual con un nombre sugerido editable. Se conserva la vista de simulación montada pero oculta, con alcance y revisión, mientras se crea el punto. Al volver se recupera el contexto cuando sigue disponible y se devuelve el foco al origen. Si el universo o el torneo ya no corresponden, se mantiene la biblioteca en vez de reabrir referencias inválidas.

Guardar un punto no inicia simulación, no registra actividad deportiva y no crea temporadas ni calendarios. Simular conserva su confirmación y validaciones originales. Restaurar un punto, en cambio, descarta las revisiones y borradores deportivos anteriores.

## Compatibilidad y límites

- JSON v7 no cambia. Los puntos nuevos contienen el sobre completo del exportador actual y se pueden abrir desde la restauración JSON existente.
- Los respaldos históricos siguen pasando por el lector/migrador existente. Sin universos, permanecen sin asignar; no se inventa actividad ni relaciones históricas.
- Se conservan procedencia, resultados manuales/simulados/importados, calendarios, reglas y planes que admite el formato actual. No se certifica oficialidad ni se reconstruyen referencias ausentes que el modelo histórico mantiene pendientes.
- Una biblioteca actual que no pueda leerse íntegramente bloquea creación y comparación/restauración desde puntos. Se mantiene la exportación de datos originales y recuperación existente para investigar daños antes de reemplazar datos no verificables.
- No hay sincronización remota, cuentas, autenticación, fusión deportiva, ramas, puntos automáticos, restauración parcial ni remapeo de IDs.
- La lista carga los registros locales y memoiza sus metadatos; no guarda comparaciones derivadas ni calcula estadísticas costosas por render. Bibliotecas con muchísimos puntos pueden requerir una futura paginación de metadatos. No se aplica borrado automático para resolver cuota.

## Pruebas y resultados

Las pruebas de aplicación usan un puerto en memoria como doble explícito. Las del adaptador controlan eventos de apertura, solicitudes y transacciones para verificar abortos, cuota, conflictos y el momento real de confirmación. Los E2E usan IndexedDB y Web Locks reales, en contextos aislados de Playwright, sin fuentes externas ni datos reales del usuario.

Se cubren bibliotecas vacías y múltiples universos, torneos sin asignar, nombres repetidos, IDs duplicados, contenido íntegro/corrupto, metadatos, cuota, abortos, lectura fallida, descarga, edición, eliminación, cancelación/restauración, revisiones obsoletas, cambio de universo, compatibilidad histórica, recuperación y fallos del repositorio actual, creación concurrente y retorno a simulación.

Fallos encontrados y correcciones demostradas:

- TypeScript detectó un acceso a un resultado opcional sin estrechar su tipo y opciones `exact` de Playwright usadas en consultas de Testing Library; se corrigieron los tipos y las consultas, sin desactivar verificaciones.
- Los tests de interfaz encontraron que jsdom no implementa los métodos de diálogo. El entorno de esas pruebas conserva/restaura los descriptores, como los tests existentes; no modifica el comportamiento de producción.
- Los primeros casos E2E estaban registrados antes del fixture `test`; se movieron después de su declaración. Se conserva el error de compilación.
- Playwright detectó pérdida real de foco al cancelar una revisión asíncrona: el botón que la abría se deshabilitaba mientras se verificaba el contenido, antes de abrir el diálogo. Ahora el panel conserva el disparador y le devuelve foco al cancelar o fallar, con un encabezado como alternativa si desapareció. El test mantiene su exigencia de foco y pasó tras la corrección. Se conserva captura y contexto del fallo.
- La matriz de navegadores detectó que, tras rechazar correctamente un contenido corrupto, una actualización del listado descartaba el diagnóstico y mostraba «Validación pendiente». Ahora el error de validación identifica el registro realmente leído y el panel conserva su estado «Inválido» mientras ese registro siga idéntico. Se añade una regresión de interfaz que también actualiza manualmente la lista. El bloqueo de restauración no se debilita.
  Esa ejecución focalizada de 36 casos se interrumpió deliberadamente al reproducir el defecto: quedaron **9 aprobados, 4 fallidos y 23 sin completar**. Terminaron los tres casos de los cuatro proyectos Chromium y el de administración en Firefox escritorio; faltaron los otros dos de Firefox escritorio y los tres casos de cada uno de los siete proyectos restantes. La ejecución posterior de 36 casos aprobados fue otra invocación completa; no se sumaron ambas como una sola.
- La primera suite E2E completa finalizó con **347 aprobados y 1 fallo, código 1, 16,3 minutos**. Falló el caso de dos pestañas en Firefox móvil: una página conservó la vista previa y no mostró confirmación de guardado; la otra guardó un punto. Las trazas muestran dos acciones de puntero en paralelo y solo una página entrando en la operación. No se observó un éxito falso, pero no se demostró una causa única de la entrega fallida. Se conservan log, código de salida, traza, contexto y capturas en `npm-test-e2e-full-attempt1*` y `failures/two-tabs-*`.
- Se instrumentó la entrega de eventos y se ejecutó una reproducción diagnóstica con `--project=firefox-mobile --grep "pestañas simultáneas" --repeat-each=6`: **6 aprobadas en 1,3 minutos**. Es una medición aislada conservada por separado, no una sustitución ni una declaración de éxito de la suite que falló. Los reintentos de Playwright siguen en cero.
- Se identificó y reprodujo además un cambio de disposición del formulario: una lectura de fondo por foco/BroadcastChannel insertaba el aviso de carga encima de la confirmación. La prueba con una lectura retenida falló antes de la corrección. Ahora las lecturas de fondo conservan la vista mientras actualizan el listado; carga inicial y actualización manual conservan sus indicadores. La regresión y el conjunto específico de **45 pruebas** aprobaron después. Esto corrige un desplazamiento observable, sin afirmar que explique por sí solo el fallo de Firefox.
- El test de concurrencia comprueba controles visibles y habilitados y activa los eventos DOM de ambas confirmaciones en paralelo, comprobando también que ambos eventos fueron entregados. Ejecuta los mismos handlers, Web Locks e IndexedDB nativos, verifica dos IDs distintos y el rechazo de restauraciones obsoletas. Separa así las solicitudes simultáneas de almacenamiento de dos gestos de puntero compartidos entre páginas. Los recorridos de administración, restauración y simulación mantienen los clics físicos de Playwright en las doce configuraciones. No se sustituyó la persistencia, no se eliminaron expectativas de datos ni se aumentaron tiempos de espera. La causa única de la entrega intermitente original sigue sin demostrarse.

Los resultados de las validaciones se conservan por invocación. No se han aumentado timeouts, añadido reintentos ni omitido verificaciones para ocultar errores. Los antecedentes de intermitencia de Vitest siguen siendo antecedentes, no una causa declarada resuelta por esta funcionalidad.

Validaciones ya completadas con la implementación integrada:

- `npm run test:e2e -- --grep "puntos de control:"`: **36 aprobados en 3,6 minutos**, una ejecución completa de los tres recorridos nuevos en 12 combinaciones. Incluye IndexedDB real, recarga, verificación, descarga, cancelación/restauración, edición/eliminación, foco, diseño adaptable y dos pestañas.
- `npm test`: **91 archivos y 936 pruebas aprobadas en 79,53 s**. No había navegadores activos durante la ejecución.
- `npm test -- --maxWorkers=4`: **91 archivos y 936 pruebas aprobadas en 97,51 s**, también sin navegadores activos. En este entorno el límite predeterminado de Vitest es 7 procesos concurrentes, frente a 4 explícitos; «91 workers spawned» cuenta procesos aislados creados durante toda la suite, no 91 procesos simultáneos. La comparación conserva aislamiento y timeouts. Cachés, orden y carga compartida impiden atribuir una causa única a las diferencias de duración. Ambas ejecuciones aprobaron y no demuestran que se haya resuelto la intermitencia histórica.
- `npm run test:flows`: **6 archivos y 79 pruebas aprobadas en 43,57 s**. Incluye la revisión final del reinicio del modo «solo pendientes» después de restaurar, los nuevos recorridos de puntos y los flujos existentes de la aplicación.
- `npm run build`: **aprobado**, TypeScript y Vite; compilación de Vite en 727 ms.
- Después de la revisión del caso simultáneo y de la corrección del refresco de fondo, `npm run test:e2e -- --grep "pestañas simultáneas"` aprobó **12 casos en 1,5 minutos**, con eventos de confirmación entregados en ambas páginas, almacenamiento real y verificaciones de datos completas. No convierte la primera suite completa fallida en aprobada; se ejecuta una nueva validación completa por separado.

Ronda final después de esa corrección:

- `npm test`: **91 archivos y 937 pruebas aprobadas en 79,08 s**. Incluye la nueva regresión de la lectura de fondo; la ejecución anterior de 936 casos se conserva por separado.
- `npm test -- --maxWorkers=4`: **91 archivos y 937 pruebas aprobadas en 98,08 s**, sin otra suite activa. No se cambió la configuración predeterminada ni el aislamiento.
- `npm run test:flows`: **6 archivos y 80 pruebas aprobadas en 40,64 s**.
- `npm run build`: **aprobado**, TypeScript y Vite; compilación de Vite en 685 ms.
- `npm run test:e2e`: **348 aprobados en 16,1 minutos, cero fallos, código de salida 0**, en una sola invocación completa. El registro `npm-test-e2e-full.log`, el resultado `npm-test-e2e-full-result.json` y el reporte HTML de Playwright corresponden a esta ejecución final. La ejecución anterior de 347 aprobados y un fallo permanece archivada, sin sumarla a esta ni borrarla.

Los registros y los contextos/capturas de fallos corregidos se conservan en [`validation/save-checkpoints`](validation/save-checkpoints/).

### Resultado final de los comandos requeridos

| Comando | Resultado final |
| --- | --- |
| `npm test` | 91 archivos, 937 pruebas aprobadas; 79,08 s |
| `npm test -- --maxWorkers=4` | 91 archivos, 937 pruebas aprobadas; 98,08 s |
| `npm run test:flows` | 6 archivos, 80 pruebas aprobadas; 40,64 s |
| `npm run test:e2e` | 348 casos aprobados en una sola invocación; 16,1 min; código 0 |
| `npm run build` | TypeScript y Vite aprobados |

## Estado de entrega y revisión final

**Implementado:** creación explícita de puntos íntegros, metadatos y SHA-256, administración y búsqueda, verificación y descarga JSON v7, comparación por identidades, restauración por el mecanismo existente, cancelación y protección contra revisiones obsoletas, integración de navegación con Biblioteca/dashboard/competiciones/simulación, retorno seguro al origen y descarte de borradores después de restaurar.

**Probado:** 45 pruebas específicas de servicio, adaptador y flujos de la nueva funcionalidad; las suites generales anteriores; y tres recorridos E2E de puntos en las doce combinaciones de navegador/viewport. IndexedDB y Web Locks son reales en los navegadores. Incluye recarga, contenido completo de todos los universos, datos sin asignar, integridad de resultados/actividad, dos pestañas, errores, accesibilidad de foco y ausencia de desbordamiento horizontal.

**Bloqueado por seguridad:** crear/restaurar con datos que no puedan validarse íntegramente; restaurar una revisión obsoleta, alterada o consumida; usar puntos corruptos/incompatibles; sobrescribir un ID existente al crear; modificar directamente su contenido deportivo; restaurar directamente sin coordinación Web Locks. Si IndexedDB o Web Crypto no están disponibles, se informa y se conserva el flujo JSON existente.

**No soportado deliberadamente:** servicios remotos, cuentas, autenticación, cifrado, copias parciales por universo, fusión de resultados, ramas y puntos automáticos. La persistencia indefinida del navegador no se garantiza.

**Pendiente:** no se demostró una causa única del fallo inicial de entrega de clic en Firefox móvil; las trazas, instrumentación y resultados separados permanecen disponibles. Tampoco se atribuye una solución a la intermitencia histórica de Vitest. La paginación sigue pendiente. La ampliación posterior del protocolo a los escritores deportivos de la aplicación se documenta y valida por separado en [Coordinación entre pestañas](cross-tab-write-coordination.md); no convierte LocalStorage en un almacenamiento transaccional ni protege escritores antiguos que no participen.

## Mejoras posibles

Paginación de metadatos para grandes colecciones y estimación de cuota del navegador podrían añadirse con alcance propio. La coordinación global posterior tampoco sustituye el archivo JSON externo ni justifica cambiar JSON v7 o el motor deportivo.

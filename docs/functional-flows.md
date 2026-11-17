# Revisión funcional y estabilidad de Cancha

Revisión del 17 de octubre de 2026, America/Santiago. Base inicial: 543 pruebas.

## Método y aislamiento

Se reutilizan Vitest, React Testing Library y jsdom. Los nuevos recorridos montan `App` real: componentes diferidos, controladores, casos de uso, reglas deportivas y repositorio local. Solo se sustituyen la frontera del proveedor y funciones de navegador que jsdom no implementa, como `dialog.showModal` y la descarga nativa.

No se instalaron herramientas ni dependencias. Cada prueba dispone de localStorage de jsdom, lo limpia y restaura sus mocks. No se abre el perfil del navegador ni se accede a la biblioteca real. Las recargas se modelan desmontando y montando `App` sin borrar ese almacenamiento: se reconstruyen repositorio y estado de sesión.

Los archivos de respaldo se obtienen del Blob que genera la interfaz, se leen y se restauran mediante el selector JSON de la interfaz, con sus confirmaciones. La descarga al disco y el selector nativo del sistema operativo no se consideran comprobados por este método.

## Auditoría de cobertura

Antes de esta revisión existían 33 pruebas en `app.test.tsx`, un recorrido de carga diferida en `app-lazy.test.tsx` y pruebas específicas de componentes y servicios. Ya se cubrían creación, edición de resultados y clasificación, estadísticas, reconciliación de eliminatorias, navegación por calendario, duplicación, borrado confirmado, importación JSON, respaldos y recuperación de datos dañados. Las progresiones de divisiones y copas tenían principalmente comprobaciones de servicios.

Faltaban recorridos encadenados desde App para reimportación de proveedor, expediente de incidencia con respaldo y recarga, transiciones de divisiones y conservación de formularios al desmontar pantallas. Tampoco se comprobaba que el botón de simulación respetase la rueda elegida.

| Recorrido | Verificación actual |
| --- | --- |
| Crear campeonato, editar participantes y puntos, generar calendario | Formulario real; se comprueban equipos, fixture y sistema 5/2/0 guardados. |
| Resultado manual, edición y clasificación | Se comprueba el cambio de puntos en las celdas de la tabla. |
| Simular partido, fecha, rueda y campeonato | App existente y nuevos recorridos; una regresión exige simular exclusivamente la rueda elegida. |
| Tablas y estadísticas | Se abren los paneles reales, se recalculan y se conserva su contexto. |
| Importar y actualizar desde proveedor | Frontera de proveedor sintética; cancelación de conflicto, actualización conservadora y recarga mantienen el marcador local. |
| Incidencia de proveedor | Rechazo por localía repetida, revisión documental explícita, respaldo sin torneos, restauración, importación corregida y recarga. |
| Respaldo y biblioteca | Blob real de la interfaz, rechazo de JSON corrupto sin mutación, confirmación de reemplazo y lectura tras recarga. |
| Almacenamiento lleno | Escritura de un marcador rechazada; la recarga recupera el resultado previo. Se mantienen las pruebas existentes de rollback y recuperación. |
| Datos dañados | Las pruebas existentes verifican conservación/exportación del texto original, registros válidos y restauración confirmada. |
| Carga diferida y errores | Carga inicial bajo demanda, Suspense, aislamiento del panel fallido, conservación de edición vecina y remontaje con un módulo disponible. |
| Formularios sin guardar | Navegación por biblioteca y regreso conservan configuración, marcador, programación, incidencia, sorteo, participantes de transición y reglamento anual. |
| Borradores y datos nuevos | Borradores separados por torneo/encuentro; una versión guardada nueva invalida el borrador del marcador anterior. Los borradores no se escriben en localStorage ni en respaldos. |

## Competiciones y progresión

`app-competitions.test.tsx` usa clubes y resultados sintéticos, salvo el calendario capturado de Apertura. Las simulaciones tienen una secuencia pseudoaleatoria reproducible; no se cambió el motor de producción.

| Competición | Recorrido y alcance |
| --- | --- |
| Primera División argentina | Muestra capturada de Apertura 2026: se deja pendiente su final y se completa desde App. No se crea el Clausura ausente ni se declara completa la temporada anual. |
| Primera Nacional argentina | Fase regular completa de 36 partidos por club, interzonales y afiliaciones sintéticas; simulación de final y Reducido, dos ascensos y cuatro descensos. Regulares y puntos permanecen intactos. Se conserva además un sorteo pendiente sin resolverlo arbitrariamente. |
| Série A | Calendario parcial explícito para apertura de interfaz, simulación, tabla y recarga. La transición brasileña usa, por separado, los 380 encuentros completos de Primera para determinar sus cuatro descensos. No se presenta la prueba de calendario parcial como cierre de Série A. |
| Série B | Liga completa de 38 partidos por club, playoffs de ida y vuelta, cuatro ascendidos y cuatro descendidos; recarga conserva la resolución. El escenario de igualdad con disciplina pendiente mantiene el bloqueo. |
| Copas nacionales | Tramos sintéticos de semifinales y final: Copa Argentina a partido único y Copa do Brasil con semifinales a ida/vuelta y final única, según los formatos soportados. No se presentan como calendarios publicados completos de ambas copas. |
| Libertadores | Ocho grupos de cuatro con seis partidos por club; progresión y simulación de las eliminatorias hasta la final desde App. |
| Sudamericana | Grupos completos y Libertadores vinculada; incorporación de terceros, playoff, octavos y eliminatorias hasta la final. Se validan las referencias de participantes al persistir. |
| Preparación argentina | Primera de 30 clubes y antecedentes 2024/2025 completos sintéticos para promedios; con la Segunda resuelta se revisan plantillas y se confirman ambas temporadas. Se conservan los históricos y las nuevas reglas quedan pendientes. |
| Preparación brasileña | Se revisan los intercambios con Primera y Segunda completas, se incorporan cuatro clubes desde categorías inferiores y se confirman dos plantillas de 20 participantes. Los históricos no cambian. |
| Años futuros | Sin calendario generado ni reglas 2026 trasladadas. La edición sin guardar de un reglamento no lo convierte en verificado. |

La representación en jsdom de todos los formularios de una Série A completa resultó demasiado costosa para un recorrido estable. Se separó esa prueba de interfaz del escenario de transición con el calendario completo. No se atribuye ese coste de jsdom al rendimiento de un navegador real, ni se modificó la interfaz para mejorar una medición no comparable.

## Problemas reproducidos y correcciones

### 1. Pérdida de borradores al navegar

Los formularios guardaban su edición exclusivamente en el estado del componente. Al desmontarse por navegación se perdían nombre/equipos, marcadores, programación, documentos de incidencias, sorteos y reglamentos pendientes.

Se agregó un almacén de borradores limitado a la sesión de App, en presentación (`session-drafts.tsx`). Comparte las ediciones de un mismo encuentro entre resumen y calendario, distingue torneos mediante claves estructuradas (también con `:` en IDs históricos) e invalida borradores si cambian los datos guardados correspondientes. Una recarga real descarta lo no guardado. No cambia JSON v7, historial ni persistencia. La configuración de creación se limpia tras crear correctamente el torneo; los diálogos de confirmación no se restauran automáticamente.

### 2. «Simular rueda» incluía otras ruedas

El selector cambiaba la rueda activa, pero la acción enviaba todos los partidos visibles al caso de uso. En un campeonato de dos ruedas, seleccionar la segunda también simulaba la primera.

La acción filtra por la rueda elegida en formatos de liga. Las fases de formatos staged conservan su comportamiento. La regresión comprueba que la primera queda pendiente y la segunda tiene resultado. No se modificaron probabilidades ni criterios deportivos.

### 3. Referencias inexistentes en el playoff de Sudamericana

La progresión generaba encuentros contra terceros de Libertadores sin incorporarlos a los participantes de Sudamericana. El repositorio rechazaba los encuentros y App quedaba en la biblioteca con el error de integridad.

La progresión incorpora esos clubes antes de persistir. Conserva identidades existentes y reutiliza un club ya conocido; las incorporaciones no heredan la pertenencia a los grupos de Libertadores ni su numeración de competición. Los 32 clubes de los grupos de Sudamericana conservan su pertenencia. No se debilita el validador ni se generan resultados. Se comprueban integridad e idempotencia y se ejecutan ambas copas completas desde App.

### 4. Apertura de una versión desactualizada

`openTournament` leía el repositorio pero abría el objeto anterior que recibía de la biblioteca. Una modificación posterior en el almacenamiento seguía sin aparecer y un borrador antiguo podía mostrarse sobre el encuentro anterior.

Ahora se abre la versión realmente guardada por ID; si dejó de existir, se informa y se actualiza la lista. La regresión cambia la versión guardada mientras la pantalla está en biblioteca y exige que al volver aparezca el resultado actual, no el borrador antiguo. Esto no añade sincronización automática entre pestañas ni garantiza escrituras concurrentes durante una edición activa.

## Ejecución reproducible

```sh
npm run test:flows
npm test
npm run build
```

`test:flows` ejecuta App, carga diferida, recorridos nuevos y recuperación de paneles. `npm test` incluye además reglas deportivas, casos de uso, adaptadores, persistencia y compatibilidad con respaldos.

## Límites de la evidencia

Son recorridos de integración de interfaz, no pruebas en Chromium, Firefox o WebKit. No certifican diseño visual, foco/modalidad nativa, navegación real, caché de chunks, descargas del sistema ni tiempos de renderizado de un navegador. La recuperación de módulos modela un nuevo montaje con una definición lazy nueva; no se afirma haber provocado una caída HTTP de chunks de producción.

Los proveedores se sustituyen únicamente en su frontera para repetir escenarios sin red y sin alterar fuentes reales. El muestreo real anterior permanece en `live-importers-verification.md` y `source-incidents.md`; esta revisión no vuelve a certificar disponibilidad ni completitud de esos endpoints.

No se modificaron reglamentos, reglas futuras, formato JSON ni validaciones deportivas para aceptar escenarios. Los fixtures de prueba se corrigieron para respetar los validadores existentes, y las correcciones de aplicación tienen regresiones que fallaban antes del cambio.

## Resultado final

| Comando | Resultado |
| --- | --- |
| `npm run test:flows` | 62 pruebas aprobadas en 5 archivos. |
| `npm test` | 570 pruebas aprobadas en 62 archivos; 27 pruebas añadidas respecto a la base de 543. |
| `npm run build` | TypeScript y Vite correctos; carga diferida conservada y sin advertencia de tamaño. |

No se añadieron dependencias ni se modificó la biblioteca real. Las correcciones quedan limitadas a presentación y a la incorporación coherente de participantes continentales; las reglas deportivas, JSON v7 y las validaciones existentes se conservan.

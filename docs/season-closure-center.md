# Centro de cierre y revisión deportiva

## Auditoría y arquitectura

No existía un estado de cierre equivalente a una revisión deportiva. `archived` administra archivo/consulta y no acredita finalización. Tampoco los resultados completos, la planificación ni los registros de nuevas temporadas equivalen a una confirmación de cierre. El Centro no reutiliza el archivo para otro propósito ni introduce un motor deportivo.

| Área auditada | Servicio existente y alcance |
| --- | --- |
| Centro de competiciones y simulación | `seasonOverview` reúne recuentos, procedencia y pendientes. Completar el calendario registrado por sí solo no acredita etapas faltantes. El simulador conserva sus alcances y confirmaciones. |
| Calendario y programación | `isValidPlayedFixture` valida marcadores y estados operativos; `getCompetitionAlerts` detecta encuentros, detalles y calendario incompletos. Faltar un horario no invalida automáticamente una competición ya disputada. No se llama a programadores ni generadores. |
| Finalización, tablas y campeón | `getTournamentCompletionStatus`, `getFinalStandings`, `seasonHonours` y los desempates existentes acreditan las ligas y copas soportadas. `seasonHonours` comprueba final inequívoca, recorrido de participantes y continuidad entre etapas. Formatos indeterminados siguen bloqueados. |
| Ascensos y descensos | `getDivisionOutcome`, sus tablas regulares/zonas, `classifyPosition` y `calculateRelegationAverages` conservan sus reglas. No se deducen cantidades de movimientos por el nombre ni se mezclan sistemas de descenso mediante un algoritmo nuevo. |
| Clasificación internacional | `nationalContinentalProjection` y `continentalProjection` conservan cálculo, cupos, conflictos y dependencias. La proyección nacional expone además las vías textuales del cálculo ya existente, sin cambiar entradas ni reglas. |
| Progresión y planificación | `projectSeasonProgression`, `continentalPlanState` y `nationalCupReviewState` aportan referencias y revisiones. La preparación futura conserva sus validaciones propias. Un origen anterior o una copa externa no bloquean por sí solos el cierre de una liga independiente. |
| Reglas y documentación | Se requieren reglas anuales coherentes con la edición y verificadas; un reglamento de partidos registrado también debe ser coherente y verificado. Se reutilizan integridad, resoluciones oficiales y estados de admisión. No se certifican documentos externos. |
| Universos e historial | El repositorio limitado al universo activo suministra temporadas y actividad. La biblioteca sin asignar conserva el acceso actual. La confirmación se añade al historial existente. |
| Escrituras entre pestañas | `LibraryWriteContext`, `coordinate` y el bloqueo global vigente siguen coordinando todas las escrituras. No se añade otro lock ni un repositorio deportivo. |

`application/services/season-closure.ts` agrega estos diagnósticos. `reviewSeasonClosure` captura una revisión de solo lectura; `confirmSeasonClosure` revalida y registra la actividad dentro del comando global. `SeasonClosureCenter` presenta el resultado y navega a los flujos existentes. Los servicios de dominio, simulación, progresión y clasificación no se modifican.

## Estados y criterios

- **Sin calendario:** no hay encuentros; nunca se considera terminada.
- **Partidos pendientes:** hay calendario registrado y todavía no se acreditan partidos disputados.
- **Temporada en disputa:** hay partidos disputados y otros pendientes.
- **Decisiones deportivas pendientes:** los encuentros registrados pueden estar completos, pero faltan integridad, reglamentos, etapas, desempates, movimientos propios o un campeón acreditado.
- **Lista para revisión final:** los servicios existentes acreditan la finalización, los resultados y las condiciones propias.
- **Cierre confirmado:** la última confirmación coincide con sus fundamentos actuales y no hay bloqueos propios.
- **Cierre desactualizado:** existe una confirmación anterior que necesita nueva revisión. El panel también muestra los pendientes actuales y conserva su historial.

Se exige calendario no vacío, encuentros válidos, ausencia de fases vacías y una finalización que los servicios existentes reconozcan. La revisión exige integridad, reglas anuales verificadas, campeón deportivo, posiciones finales sin desempates irresueltos cuando existe una tabla final y resoluciones de los movimientos propios aplicables. Una copa sin etapas completas o sin una final inequívoca queda bloqueada. No se ejecuta progresión para completar una temporada desde este Centro.

Las tablas de una segunda división por etapas son las proyecciones de su fase regular o sus zonas; no se inventa una clasificación única final de eliminatorias. Solo se muestra subcampeón cuando `seasonHonours` lo acredita. Campeones y cupos calculados no se convierten en resultados oficiales por cerrar la revisión. Las procedencias local, proveedor y desconocida se mantienen visibles.

Los descensos directos por tabla y las proyecciones por promedio se muestran separados. Si se configura una combinación de ambos, se solicita la resolución conjunta del flujo deportivo existente. Una promoción de descenso no se resuelve a partir de una tabla. Los formatos para los cuales los servicios existentes no acreditan una conclusión siguen sin confirmación, incluidos formatos compuestos sin campeón único reconocido; no se completan mediante reglas nuevas.

## Dependencias propias y preparación futura

La admisión continental/nacional registrada para la edición actual y las temporadas que sustentan sus promedios son fundamentos propios. Una admisión desactualizada, participantes provisionales o una dependencia propia ausente impiden confirmar.

Las clasificaciones hacia otra edición se muestran con destino, vía, origen, estado definitivo/provisional, conflictos y motivos pendientes. Una copa externa inconclusa puede impedir conocer un cupo, pero no invalida el título de una liga ya completa. Estas advertencias quedan en el apartado de próxima edición y no se convierten indiscriminadamente en bloqueos de cierre.

La navegación a planificación requiere un cierre vigente. Abre el Centro de competiciones y su planificación existente, indicando la temporada de origen; el usuario sigue eligiendo expresamente origen, edición y participantes en ese flujo. No se crea una temporada ni un calendario al cerrar, y la planificación conserva sus bloqueos y revisión propios. No se enlazan automáticamente dos divisiones por país/año/nombre.

## Confirmación, persistencia y cambios posteriores

La extensión mínima es el evento `season-closure-confirmed`, con un `after` validado: versión interna 1, universo, fundamento canónico y campeón calculado. No se añade un campo de cierre al torneo ni otra tabla de estado. Se usa `recordActivity`; confirmar no llama a `save`, no cambia resultados y no archiva ni restringe ediciones.

El fundamento conserva la temporada, su universo, procedencia, dependencias propias y referencias a su actividad. La invalidación es conservadora: cambios de metadatos o nuevos eventos de esas temporadas también pueden exigir una nueva revisión. Excluye las propias confirmaciones para no invalidarse al registrarlas ni incluir recursivamente su historial. Se excluye también el evento técnico de restauración de biblioteca: restaurar el mismo fundamento desde un respaldo puede conservar un cierre coincidente. La marca `imported` del historial no cambia el fundamento ni certifica su origen externo.

Cambiar un resultado, reglamento, desempate, admisión o dependencia propia deja el cierre desactualizado. Cambiar y luego revertir un resultado mediante el flujo deportivo también exige nueva revisión: quedan nuevas referencias de actividad. Las confirmaciones anteriores no se borran. Una temporada independiente modificada en otra parte de la biblioteca puede invalidar una vista previa pendiente por el protocolo conservador, pero no vuelve obsoleto por sí solo un cierre deportivo ya registrado.

**Abrir edición de temporada** lleva al editor existente. No se necesita un nuevo estado de reapertura: la edición permanece habilitada según las reglas actuales, y un cambio real exige después otra revisión. La nueva confirmación añade historial; no sustituye ni elimina eventos anteriores.

## Protocolo de confirmación

La revisión no escribe, genera resultados, avanza fases ni crea participantes. Un `WeakMap` privado vincula identidad y contenido de la revisión a las temporadas y actividad leídas. Se comprueba que esa lectura no atravesó un cambio antes de emitirla. Una revisión copiada, alterada o consumida se rechaza.

Al confirmar, `LibraryWriteContext` adquiere el mismo bloqueo de toda la biblioteca usado por las escrituras deportivas y puntos de control. Dentro de él se comprueban instantánea global, universo persistido, identidad de revisión, instantánea revisada y evaluación deportiva actual. Solo entonces se crea el evento. Dos confirmaciones de los mismos fundamentos no producen dos cierres; una revisión que esperó un cambio de otra pestaña se rechaza antes de registrar actividad.

Sin Web Locks se mantiene el bloqueo de escrituras existente y la lectura/exportación JSON. Los errores de cuota y la compensación usan el repositorio actual. El Centro no convierte LocalStorage en una transacción atómica ni promete recuperación de varias claves ante la terminación abrupta del proceso; se mantienen los límites del [protocolo global](cross-tab-write-coordination.md).

## JSON v7 e integración visual

El formato y versión del respaldo siguen siendo `cancha-backup` v7. La actividad y su payload usan los campos existentes y sus validadores; los respaldos históricos sin confirmación siguen siendo legibles y se muestran sin cierre. Se conservan resultados, actividad previa y universos. Un lector antiguo que no conoce el nuevo tipo de actividad no adquiere soporte retroactivo para él.

Hay accesos desde navegación general, Centro de competiciones, calendario, simulación, progresión encadenada y dashboard del universo. Se usa un único panel central y los estilos actuales, con carga diferida, foco inicial y retorno a la navegación. El selector solo contiene temporadas del alcance activo. Las advertencias ofrecen calendario, alertas/reglamentos, edición y planificación, sin ejecutar acciones deportivas durante la navegación.

El panel vuelve a leer el repositorio al recibir cambios de almacenamiento o recuperar el foco. Una vista previa ya capturada conserva sus datos hasta cancelar o confirmar; la confirmación siempre valida nuevamente bajo el bloqueo global. Actualizar la presentación no acepta silenciosamente una instantánea obsoleta ni descarta formularios de otros flujos.

## Pruebas, evidencia y límites

Las pruebas focalizadas cubren ligas, copas, calendario ausente, fases, reglas, desempates, movimientos de segunda división, promedios pendientes, cupos provisionales/definitivos, dependencias propias y externas, revisión pura, confirmación, duplicados, manipulación, cambios posteriores, reversión de marcadores, universos, cuota y JSON v7. Las carreras usan barreras de promesas y el protocolo real del repositorio, sin pausas fijas. Los flujos de App comprueban navegación y conservación de datos.

Los registros se conservan en [validation/season-closure-center](validation/season-closure-center/), con [lista de archivos](validation/season-closure-center/changed-files.txt). No se modifican workers, timeouts, reintentos ni aislamiento del proyecto.

Durante el desarrollo se conservaron tres incidencias concretas: TypeScript detectó un fixture operativo sin `updatedAt` y opciones `exact` no admitidas por Testing Library; la comparación exacta de la copa detectó que el fixture omitía `knockoutResolution`, que la migración existente añadía al iniciar; y la primera matriz del Centro aprobó 44 casos y falló cuatro retornos de foco en WebKit. Se corrigieron los fixtures y la captura del control de retorno, que ahora descarta elementos sin capacidad de foco como `body`. Las aserciones de conservación de datos y foco se mantienen. Los errores, capturas y trazas se conservan separados de las ejecuciones posteriores.

La matriz específica posterior a esas correcciones aprobó los **48 casos** en Chromium, Firefox y WebKit, con tamaños escritorio, notebook, tablet y móvil, en 4,0 minutos. Incluye dos pestañas reales, conservación exacta de temporadas, cierre de copa, navegación y retorno de foco.

La ejecución general predeterminada registró **94 archivos aprobados y uno fallido; 988 pruebas aprobadas y una fallida**, en 105,05 s. Falló `app.test.tsx`, caso «opens the selected season calendar and returns to its tournament without switching context», al agotar la espera de `findByRole` del calendario diferido; no llegó a las ediciones del encuentro. Las 35 pruebas nuevas aprobaron. `app-lazy` no falló en esta invocación, lo que no acredita que su intermitencia histórica esté resuelta.

La misma versión con `npm test -- --maxWorkers=4` aprobó **95 archivos y 989 pruebas**, en 123,11 s, incluido el flujo que había fallado. La diferencia es evidencia de que ese fallo no se reproduce en ambas invocaciones; no prueba una causa única. Se conserva la ejecución fallida completa y no se repite el comando predeterminado para sustituir su resultado por uno favorable.

`npm run test:flows` aprobó **7 archivos y 83 pruebas** en 60,23 s, incluido nuevamente el flujo de calendario. `npm run build` aprobó TypeScript y Vite, sin dependencias nuevas. Las cuatro invocaciones se hicieron en serie y antes de iniciar los navegadores de la matriz completa.

La invocación completa de `npm run test:e2e` aprobó **432 casos en una sola ejecución de 26,5 minutos**: 36 recorridos en cada una de las 12 combinaciones de navegador/tamaño. Terminó con código 0 y `.last-run.json` con estado `passed` y sin pruebas fallidas. No se sumaron ejecuciones parciales para declarar ese resultado. Se conserva el registro completo y el resultado del proceso; el lanzador oculto guardó los códigos de salida aunque la sesión de terminal no permaneciera abierta.

| Validación final | Resultado |
| --- | --- |
| `npm test` | 988 aprobadas, 1 fallo de espera del calendario; 94 archivos aprobados y 1 fallido; salida 1 |
| `npm test -- --maxWorkers=4` | 95 archivos, 989 pruebas aprobadas; salida 0 |
| `npm run test:flows` | 7 archivos, 83 pruebas aprobadas; salida 0 |
| `npm run test:e2e` | 432 casos aprobados en una ejecución; salida 0 |
| `npm run build` | TypeScript y Vite aprobados; salida 0 |

Los [resultados de proceso](validation/season-closure-center/validation-results.json) conservan comandos, fechas UTC y códigos de salida. Las [huellas SHA-256](validation/season-closure-center/source-hashes.json) identifican los archivos fuente, fixtures y configuración de esta validación; la documentación se excluye para permitir registrar después sus resultados. No se añadieron dependencias ni se modificaron motores de simulación, reglas deportivas, versión JSON o configuración de las suites.

La garantía de finalización depende del formato y cobertura que el proyecto ya puede acreditar. No se certifican reglamentos externos, resultados de proveedor, fechas oficiales, identidades históricas ausentes o ediciones desconocidas. Los fundamentos canónicos conservan una copia de los datos relevantes por confirmación: su almacenamiento crece con la temporada y el historial; no se implementa una política nueva de retención ni paginación.

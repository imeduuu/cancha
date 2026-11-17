# Asociaciones y afiliaciones de clubes

## Auditoría inicial de identidad (antes de implementar el modelo)

`Team.id` no tiene garantía global: `create-tournament.ts` crea `team-1`, `team-2`, etc. para cada torneo local; proveedores externos pueden conservar sus propios IDs. `create-tournament-season.ts` copia IDs al preparar otra temporada y las nóminas continentales pueden registrar referencias explícitas de origen/destino. Compartir un ID no acredita por sí solo continuidad global de una organización.

`clubOccurrenceKey` usa `[tournamentId, teamId]`. `buildClubProfiles` reúne apariciones por IDs iguales, `averageIdentity` explícito y vínculos continentales incorporados; separa componentes con apariciones duplicadas en un torneo o tokens contradictorios y muestra una advertencia. Su clave de perfil depende de las apariciones disponibles: no es un ID global persistido. El agrupamiento por IDs locales repetidos también puede reunir registros sin continuidad acreditada. No se alteran aquí esas métricas ni los algoritmos existentes, y esas agrupaciones no se utilizarán para transferir afiliaciones.

La afiliación AFA `direct`/`indirect` tiene una finalidad específica: determinar destinos de descenso en Primera Nacional con fuente AFA. No identifica una asociación nacional genérica y no se convertirá automáticamente en una afiliación nueva. El catálogo de países de competiciones describe competiciones; no acredita el país o afiliación de cada club. Las clasificaciones internacionales y progresiones conservan sus servicios y referencias actuales.

`DrawConfiguration` ya representa participantes, bombos y condiciones. El contrato antiguo `association` contiene solamente `description` y está reservado como no soportado. No basta para ejecutar un máximo por asociación. La validación manual y el generador acotado existente deben compartir cualquier nueva condición ejecutable, sin reinterpretar registros antiguos.

La actividad validada, el respaldo completo JSON v7, sus puntos de control y el coordinador global con Web Locks ofrecen persistencia trazable sin crear otra base de clubes. La administración deberá usar esas operaciones existentes y las consultas del Historial y Archivo seguirán siendo de solo lectura.

## Decisión de alcance

La representación mínima segura será una afiliación de aparición y temporada, identificada por torneo persistido, participante, competición, año y universo. No habrá herencia automática, fusiones por nombre, rangos temporales ni una identidad global nueva de clubes. Los tokens existentes solo se conservarán como evidencia de identidad de esa aparición y para detectar cambios. Las asociaciones serán conceptos con ID estable dentro de cada universo y sus metadatos tendrán revisiones; no se creará un catálogo paralelo de países.

## Modelo implementado

`domain/entities/club-affiliation.ts` contiene dos contratos versión interna 1, transportados por la actividad existente:

- `AssociationRecord`: universo declarado, torneo de anclaje del evento, revisión positiva y `SportingAssociation`.
- `ClubAffiliationRecord`: universo, ID del torneo, competición persistida, año, ID del participante, `clubOccurrenceKey`, alcance fijo `occurrence-season`, token de identidad explícito opcional, revisión, relación conocida/desconocida/ambigua, ID y revisión de asociación cuando es conocida, procedencia y fuente.

La asociación tiene ID independiente de su nombre, abreviatura opcional, tipo `national-association`, `sporting-organization` o `unspecified`, procedencia local/documental y revisión documental. El país o territorio es opcional y tiene nombre, **fuente HTTPS propia y estado documental independiente**. No se generan códigos de país, federaciones ni membresías a partir del catálogo de competiciones. Una asociación puede verificarse sin registrar país; una restricción por organización no exige inventarlo.

El ID de asociación es estable dentro de su universo. Una revisión puede cambiar el nombre conservando ese ID y los metadatos anteriores. Dos asociaciones con el mismo nombre pero IDs diferentes no se fusionan. La revisión de una afiliación apunta a una revisión concreta de asociación: el Historial no sustituye silenciosamente una denominación antigua por la actual.

El torneo solo ancla la escritura en el repositorio existente; no convierte al catálogo en un dato deportivo exclusivo de esa competición. La afiliación, en cambio, sí pertenece exactamente a una aparición y año. Las asociaciones locales o documentales pendientes pueden registrarse para completar datos, pero no satisfacen la modalidad definitiva de sorteo por asociación.

## Identidad y vigencia

No se añade una colección de clubes. Se siguen usando los participantes de `Tournament.teams` y el Historial existente. La nueva afiliación nunca se comparte porque coincidan `Team.id`, nombre, `averageIdentity`, país, competición o el perfil de consulta. Copiar una nómina a otra temporada no copia afiliaciones: no se agregaron campos nuevos a `Team`.

El token `averageIdentity`, cuando existe, se conserva como evidencia de la aparición. Si cambia, la afiliación debe revisarse. El año o la competición discrepantes también producen desactualización. Las advertencias de ambigüedad de `buildClubProfiles` bloquean el uso definitivo. Una aparición puede tener un registro explícito «ambigua» o «desconocida» sin asignarle una organización genérica.

Se adopta solo el alcance de temporada específica; no hay períodos ni propagación entre apariciones. La clave del perfil histórico sigue siendo una proyección y no se persiste como identidad nueva. El Historial puede conservar sus agrupaciones anteriores por IDs repetidos; esta implementación no las convierte en continuidad acreditada ni modifica sus métricas o las clasificaciones que las usan.

## Fuentes y estados

Se reutilizan `OfficialReference`, `RulesVerificationStatus` e `isHttpsReference`. No se visitan URLs ni se ejecuta texto libre. Marcar como verificada una asociación documental, su territorio o una afiliación documental exige confirmación expresa del usuario antes de revisar. La confirmación conserva una declaración personal, no una certificación independiente.

Las consultas distinguen:

| Estado | Condición |
| --- | --- |
| Desconocida | No hay registro de esta aparición o se declaró desconocida. |
| Ambigua | Hay evidencia de identidad contradictoria, relación sin resolver o versiones de la misma revisión con contenido distinto. |
| Declaración local | Asociación o afiliación local; consultable, sin acreditar la modalidad documental por asociación. |
| Fuente pendiente | Falta verificar la documentación de asociación o afiliación. |
| Desactualizada | Cambió la evidencia de identidad, año, competición o revisión del catálogo; o falta una referencia. |
| Verificada por el usuario | Afiliación y asociación documentales verificadas, sin ambigüedad y con referencias vigentes. |

Los registros importados que comparten ID y revisión con contenidos distintos no se resuelven tomando el último silenciosamente. El conflicto se muestra y bloquea el uso deportivo. Una corrección explícita puede crear una revisión posterior. Una versión histórica de asociación ambigua tampoco aporta un nombre o territorio definitivo.

## Administración y navegación

Hay una sola administración compartida dentro del Centro de sorteos, con accesos desde la navegación general/Biblioteca, Centro de competiciones, cada aparición del Historial de clubes, Archivo histórico y decisiones que requieren completar afiliaciones. El acceso puede preseleccionar competición y participante.

Permite registrar asociaciones, revisar metadatos conservando ID, consultar fuentes y apariciones vinculadas, registrar o corregir una afiliación y consultar ambos historiales. Los participantes, años y asociaciones se seleccionan por IDs persistidos; los nombres son etiquetas. El alcance temporal está limitado expresamente a esa aparición. La interfaz usa campos etiquetados, selectores nativos, foco de revisión, confirmación separada y controles de teclado, con diseño adaptable y sin nuevas dependencias.

No se ofrece eliminación de asociaciones: las correcciones son revisiones, no borrados. Sin temporada seleccionada, el catálogo sigue disponible en modo de consulta, incluso si se movió o eliminó el torneo original. Registrar metadatos requiere un torneo real como anclaje del repositorio; no se fabrican competiciones o clubes para almacenarlos.

## Historial de clubes y Archivo histórico

Cada aparición del Historial muestra asociación registrada, país acreditado cuando su fuente está verificada, año, fuente de afiliación, estado y cambios anteriores. Las apariciones sin datos permanecen desconocidas aunque el perfil tenga otra temporada verificada. Se mantienen las tablas, acumulados, métricas, progresiones y demás consultas existentes.

El Archivo añade un resumen por asociación y edición, derivado de las referencias explícitas. Distingue inscritos con relación registrada, participantes con encuentros, participantes con partidos válidamente disputados y afiliaciones verificadas. Muestra además desconocidos y pendientes. Los recuentos de partidos reutilizan `isValidPlayedFixture`; no convierten inscripción en participación deportiva ni reconstruyen clasificaciones internacionales.

Los nuevos eventos permanecen en la cronología como **administrativos**, no como campeonatos, resultados, desempates o resoluciones oficiales.

## Restricción por asociación: contrato versionado

El registro anterior permanece reservado y no ejecutable:

```ts
{ id, type: "association", description }
```

La modalidad nueva requiere registro explícito del usuario:

```ts
{ id, type: "association", schemaVersion: 1, maxPerGroup: 1, description }
```

`maxPerGroup` es un entero positivo: **cada grupo** puede contener como máximo esa cantidad de participantes de **cada misma asociación registrada**. Se aplica a todos los participantes de la etapa configurada. No es una regla por país, no se activa por defecto y no se presupone para ninguna edición de CONMEBOL. No hay conversión automática de la descripción antigua. El botón del editor crea la condición versionada solo al solicitarlo.

Para uso definitivo se exigen estructura de grupos soportada, participantes y bombos completos, reglamento anual y dependencias revisados por los mecanismos actuales, afiliación y asociación documentales verificadas de todos los participantes, alcance temporal exacto y ausencia de ambigüedad. El país puede estar ausente: la organización se identifica por su ID, no por el territorio.

Las configuraciones incompletas pueden conservar condiciones pendientes, pero no confirmar distribuciones manuales ni generar propuestas definitivas con ellas. Una afiliación desconocida no funciona como una organización distinta ni se rellena con un identificador genérico. El servicio de generación ignora mapas de asociaciones suministrados por el llamador y obtiene siempre el contexto de las afiliaciones validadas.

## Validación y solucionador reutilizado

`validateDrawConfiguration` evalúa las afiliaciones y las dependencias, detecta asociaciones con más participantes que las plazas admitidas entre grupos y contradicciones entre posiciones fijas y máximos. No cuenta dos veces un participante por repetir una condición fija equivalente.

`validateManualDrawConfiguration` recibe el contexto verificado de IDs de asociación y comprueba el máximo por grupo. Si falta algún participante, bloquea la operación. `prepare-stage-draw.ts` obtiene ese contexto mediante la misma consulta de afiliaciones, sin leer países de competiciones ni nombres de clubes como identidad.

El solucionador existente mantiene backtracking, MRV, incompatibilidades, cuotas, posiciones fijas, presupuestos, lotes y semillas. Se añaden recuentos de asociación por grupo al estado que se actualiza/deshace y a los dominios de MRV, junto con una poda por plazas restantes de cada asociación. La validación final reutiliza la validación manual ampliada. No hay segundo solucionador ni reducción incorrecta a incompatibilidades por pares cuando el máximo es mayor que uno.

Las configuraciones sin la modalidad nueva mantienen su orden de exploración y reproducibilidad; no se añaden consumos de azar. La confirmación sigue sin ejecutar el solucionador. Los estados Viable, Imposible demostrado, No determinado y Configuración inválida conservan su significado; agotar un presupuesto no demuestra imposibilidad.

## Dependencias, desactualización y protección histórica

Al revisar explícitamente una configuración se captura `associationDependencies: {schemaVersion: 1, fingerprint}`. Es una instantánea canónica de las afiliaciones necesarias, versiones de asociación, identidad de aparición y estados; no otra base de clubes. Si cambian, la configuración queda pendiente de nueva revisión. Registrar la última afiliación faltante no verifica automáticamente una configuración antigua: el usuario debe revisarla.

Una distribución que usó esta modalidad conserva además `associationFoundation` en `StageDrawRecord`, junto a `configurationRevision`. El campo es opcional, solo para grupos y con revisión positiva. La inspección existente contrasta esa dependencia para decidir si el sorteo sigue vigente. Si cambia una afiliación usada, el sorteo anterior se conserva y se bloquea su programación definitiva hasta disponer de un flujo compatible de revisión; no se reorganiza ni sobrescribe para adaptarlo.

Los eventos de metadatos se excluyen del fundamento deportivo general. Por eso las afiliaciones nuevas **no desactualizan por sí solas sorteos históricos que no registraron esa modalidad**. La dependencia adicional solo afecta a las distribuciones que la declararon. No se borran partidos, resultados, eventos, alineaciones, estados operativos, calendarios, clasificaciones o reglamentos.

También se excluyen estos dos eventos administrativos del fundamento del cierre de temporada. Una prueba de regresión reprodujo que, sin esa exclusión, registrar una asociación dejaba desactualizado un cierre ya confirmado. Se corrigió el filtro de metadatos, conservando íntegros el cálculo deportivo, campeón y premios. El fallo previo se conserva en `closure-regression-before-fix.log` y su corrección pasó en la suite focalizada posterior.

El Centro de decisiones diferencia afiliación pendiente/local/desconocida, ambigua, fuente pendiente, restricción no soportada/incompatible y fundamentos desactualizados. Solo crea estos avisos cuando una configuración o sorteo depende expresamente de la información; no impone afiliaciones a todas las competiciones ni registra una afiliación como desempate.

## Universos y traslados

Asociaciones y afiliaciones pertenecen al universo declarado, incluido `null` para la biblioteca heredada. Incluso IDs o nombres iguales en dos partidas no comparten registros. Los accesos, servicios y tokens verifican ese ámbito.

El repositorio existente trasladaba el universo de los eventos al reasignar un torneo. La extensión puntual conserva el universo original de estos **dos tipos nuevos de metadatos**. `activityInUniverse` los consulta por su universo declarado, incluso si el torneo de anclaje se movió o desapareció. Así no se corrompe la atribución validada del payload ni se transfieren afiliaciones a la nueva partida. Los demás eventos conservan su comportamiento anterior.

Se bloquea la eliminación de un universo que conserve estos metadatos: no existe una operación de traslado o eliminación masiva revisada que permita hacerlo sin perder su alcance. No se introduce un bloqueo alternativo ni una reasignación automática. Un torneo trasladado puede registrar nuevas afiliaciones explícitas en su destino; las de origen quedan como referencias históricas de su partida.

## Persistencia, coordinación y recuperación

No hay claves nuevas de almacenamiento, otra tabla de clubes ni migración de `Team`. Los eventos son `association-recorded` y `club-affiliation-recorded`, con el registro tipado en `after`. `isActivityEvent` exige su estructura y coincidencia del torneo, entidad y universo; para afiliaciones comprueba también competición y año. Las referencias faltantes o revisiones conflictivas se muestran en las consultas y bloquean uso definitivo, sin inventar sustituciones.

Se conserva JSON **v7**, con extensiones opcionales en las configuraciones y registros de sorteos ya existentes. El respaldo completo transporta catálogo, afiliaciones e historial. Exportar solo un torneo no transporta su actividad: para conservar estos datos se usa el respaldo completo o los puntos de control. Los respaldos antiguos sin metadatos se leen como desconocidos; no se reconstruyen afiliaciones retrospectivas.

`reviewClubAssociation` no escribe: genera una revisión privada vinculada a contenido e instantánea completa del repositorio del ámbito. Las copias, alteraciones, revisiones consumidas, conflictos de revisión y cambios de biblioteca o universo se rechazan. La confirmación de la interfaz usa `LibraryWriteContext`, el coordinador existente y el Web Lock global `cancha.save-checkpoints`. Bajo ese bloqueo se revalidan torneo, participante, evidencia de identidad, asociación, documentos y vigencia antes de añadir actividad con `recordActivity`.

Los puntos de control, restauración, controles de cuota y recuperación permanecen en sus servicios. Se prueba que un fallo de escritura no altere torneos ni actividad anterior y que la integridad SHA-256 del punto incluya los nuevos registros. Las consultas y vistas previas no crean eventos deportivos ni metadatos.

## Pruebas y resultados

Las pruebas usan exclusivamente organizaciones y documentos sintéticos explícitamente ficticios. No asignan federaciones reales como supuestos históricos.

`record-club-affiliation.test.ts` cubre catálogo, ausencia de país, renombre con ID estable, apariciones, homónimos e IDs repetidos, ambigüedad, temporalidad, correcciones, fuentes, duplicados/referencias, versión antigua/nueva de la restricción, manuales, solucionador con solución/imposibilidad/presupuesto/semillas, vistas previas, confirmación, obsolescencia, universo, concurrencia, protección histórica, Archivo, v7, restauración, puntos de control, cuota y traslado de torneos sin compartir afiliaciones.

`club-associations-manager.test.tsx` cubre formularios, contraste documental explícito, correcciones, historial por aparición y catálogo sin torneo actual. Los cinco E2E nuevos cubren registro e historial, restricción manual y generación, dos pestañas, universos y exportación/restauración.

La ejecución focalizada final aprobó **134 pruebas en cinco archivos** (13,81 s). Los **10 E2E focalizados de Chromium** aprobaron en escritorio y móvil (1,0 min). Los resultados completos y capturas se conservan en `docs/validation/club-associations-and-affiliations/`.

Tras añadir la protección del cierre deportivo, la ejecución focalizada aprobó **135 pruebas en cinco archivos** (10,34 s), registrada en `focused-with-closure.log`. Las capturas revisadas están en `association-desktop.png` y `association-mobile.png`.

Resultados completos del 11 de noviembre de 2026:

| Comando / ejecución | Resultado |
| --- | --- |
| `npm test`, inicial | **Falló**: 109 archivos aprobados y 2 fallidos; 1.218 pruebas aprobadas y 2 fallidas, 1.220 totales; 111,86 s. Timeout documental de `app-decisions` y región de calendario no encontrada en `app.test`. `npm-test.log`. |
| `npm test -- --maxWorkers=4`, inicial | **Aprobó**: 111 archivos y 1.220 pruebas; 137,94 s. `npm-test-maxWorkers4.log`. |
| `npm test`, final con regresión de cierre | **Falló**: 110 archivos aprobados y 1 fallido; 1.220 pruebas aprobadas y 1 fallida, 1.221 totales; 123,28 s. Solo falló por timeout de 5.000 ms el recorrido documental de `app-decisions`. `npm-test-final.log`. |
| `npm test -- --maxWorkers=4`, final | **Aprobó**: 111 archivos y 1.221 pruebas; 113,43 s. Incluye la regresión de preservación del cierre. `npm-test-maxWorkers4-final.log`. |
| Calendario aislado: `npx vitest run src/presentation/app.test.tsx -t opens.the.selected.season.calendar --maxWorkers=1` | **Aprobó**: 1 prueba, 34 excluidas por el filtro; 8,37 s. `calendar-isolated.log`. |

El caso del calendario se conserva como fallo real de la ejecución inicial; pasó dentro de la ejecución predeterminada final. No se cambiaron sus esperas ni su implementación, ni se atribuyen automáticamente los fallos a una causa común. Las pruebas nuevas pasaron en las suites completas; el resultado de una ejecución fallida no se presenta como aprobado.

Durante el desarrollo se corrigieron una aserción que intentaba omitir metadatos del Archivo en vez de comprobar su clasificación administrativa, y una consulta de prueba que coincidía simultáneamente con el resumen y la entrada de historial. Se identificaron por sus mensajes y contexto; no se atribuyeron a los timeouts históricos. También se corrigió una construcción del formulario al ampliar la unión tipada del contrato y texto acentuado introducido durante la edición. No se aumentan tiempos ni se añaden reintentos para ocultar errores.

## Limitaciones pendientes

No hay una identidad global acreditada nueva de clubes, continuidad automática entre temporadas, períodos de vigencia, traslado masivo revisado de afiliaciones, eliminación de asociaciones ni importación automática de fuentes. Las declaraciones locales siguen siendo consultables pero no acreditan la restricción definitiva. El país no es obligatorio para identificar una asociación, y no se infiere.

Los formatos deportivos específicos conservan sus bloqueos existentes: completar afiliaciones no demuestra que todos los reglamentos de una edición continental estén representados ni habilita automáticamente su generador. Las condiciones antiguas reservadas siguen no soportadas hasta ser sustituidas explícitamente. Corregir metadatos de un sorteo confirmado puede dejarlo desactualizado; no hay una operación automática que cambie o borre sus grupos o encuentros.

## Archivos modificados

- Modelo/validación: `src/domain/entities/club-affiliation.ts`, `activity-event.ts`, `draw-configuration.ts` y `stage-draw.ts`.
- Servicios: `src/application/services/club-associations.ts`, `draw-configuration.ts`, `draw-and-bracket.ts`, `constraint-group-generator.ts`, `sports-decisions.ts`, `historical-archive.ts`, `sports-universes.ts` y el filtro administrativo de `season-closure.ts`.
- Casos de uso: `src/application/use-cases/record-club-affiliation.ts`, `configure-stage-draw.ts`, `prepare-stage-draw.ts` y `generate-local-groups.ts`.
- Persistencia: extensión acotada de `src/infrastructure/persistence/local-storage-tournament-repository.ts` para conservar el universo de metadatos al trasladar torneos.
- Presentación: `src/presentation/app.tsx`, `src/styles.css`, `club-associations-access.tsx`, `club-associations-manager.tsx`, `club-association-catalog.tsx`, `club-affiliation-summary.tsx`, `club-history-panel.tsx`, `competition-center.tsx`, `historical-archive.tsx`, `sports-decisions-center.tsx`, `draw-and-bracket-center.tsx`, `draw-configuration-editor.tsx` y `activity-history.tsx` en los directorios correspondientes.
- Pruebas y fixtures: `src/test-utils/club-association-fixtures.ts`, `src/application/use-cases/record-club-affiliation.test.ts`, `src/presentation/components/club-associations-manager.test.tsx` y `e2e/cancha.e2e.ts`.
- Este documento y sus evidencias de validación. No se modifican motores de simulación, clasificación ni progresión, ni dependencias.

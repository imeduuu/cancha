# Archivo histórico y anuarios por universo

## Auditoría y arquitectura

El Archivo es una proyección de consulta de temporadas y actividad existentes. No añade entidades persistidas, copias de resultados, snapshots, eventos ni versiones del respaldo. Consultarlo no ejecuta simulación, progresión, planificación, cierre ni generadores. `archived` sigue representando archivo administrativo y no se usa como prueba de finalización deportiva.

| Área | Servicio reutilizado |
| --- | --- |
| Centro de competiciones | `groupCompetitions`, `competitionIdentity` y su catálogo suministran identidades, país y categoría. No se relacionan competiciones por nombre. |
| Centro de cierre | `evaluateSeasonClosure` reúne finalización, integridad, reglas, tablas, campeón, subcampeón, movimientos, dependencias y vigencia del cierre. Las confirmaciones anteriores permanecen intactas. |
| Historial de clubes | `buildClubProfiles` y `clubOccurrenceKey` resuelven identidades por IDs estables, vínculos expresos e identidades históricas. Los componentes existentes permiten abrir un participante concreto sin duplicar su historial. |
| Palmarés | Los premios de `seasonHonours`, consumidos por cierre, acreditan los ganadores. Se integra `HistoricalRecordsAccess` para consultar el palmarés y los récords existentes. |
| Rendimiento | `ClubPerformanceAccess` conserva sus métricas, compatibilidad, gráficos y limitaciones. El Archivo no implementa estadísticas deportivas nuevas. |
| Clasificación continental | Las proyecciones del cierre y `nationalContinentalProjection` conservan cupos, vías, estados y conflictos. También se contemplan configuraciones que solo tengan plazas de fase clasificatoria. |
| Progresión y divisiones | Los resultados de división y promedios proceden del cierre. `seasonOrigins` y `recordedSeasonMovements` aportan relaciones y movimientos explícitos de preparación. No se adivina una transición por los clubes presentes. |
| Comparación de temporadas | `compareTournamentSeasons` determina compatibilidad. Sus posibles coincidencias por nombre no se convierten en identidad: las presencias y ausencias usan exclusivamente los perfiles registrados. |
| Dashboard y universos | `tournamentsInUniverse` y `activityInUniverse` filtran antes de calcular premios, dependencias, perfiles o estadísticas. Se mantiene la biblioteca anterior sin asignar. |
| Actividad y JSON | Se conservan IDs, fechas, acciones, procedencia y payloads originales. El respaldo continúa en JSON v7 y los respaldos sin actividad no adquieren hechos reconstruidos. |

`application/services/historical-archive.ts` construye filas, anuarios, movimientos, acontecimientos, opciones y comparaciones. `HistoricalArchive` presenta una única pantalla con carga diferida. `HistoricalArchiveNavigation` solo abre esa consulta desde navegación principal, biblioteca, Centro de competiciones y dashboard. No existe un repositorio histórico adicional.

## Cronología y anuarios

La cronología ordena los años explícitos de mayor a menor. Las temporadas sin `season` aparecen en **Sin año registrado**; no se deduce su edición del ID, fecha de creación, importación o partidos. Cada entrada permite desplazarse hasta su anuario.

Los anuarios muestran recuentos de ediciones, finalización según el servicio existente, temporadas en disputa y pendientes, cierres listos sin confirmar, confirmaciones vigentes y desactualizadas, campeones acreditados, movimientos y clasificaciones. Los indicadores representan los registros seleccionados: dos versiones guardadas de una competición son dos ediciones consultables, no se fusionan ni se deduplican arbitrariamente.

Hay tarjetas de campeones y fichas por país, categoría y tipo: ligas, copas nacionales, continentales y registros cuyo tipo o ámbito no se puede acreditar. El país y la categoría proceden del catálogo existente; CONMEBOL se identifica para sus competiciones y para los países sudamericanos representados en ese catálogo. Las competiciones personalizadas sin esa información conservan etiquetas desconocidas. No se inventa un país o una confederación a partir del nombre.

Las fichas muestran tablas, posiciones destacadas, fases registradas, finales cuando existe una etapa final explícita, marcadores guardados, prórrogas y penales, participantes y limitaciones. No se reconstruyen cruces, sorteos ni recorridos ausentes. Las tablas de segunda división conservan sus zonas o fases regulares; no se fabrica una tabla única de eliminatorias.

## Campeones, cierre y procedencia

Se distingue campeón calculado, campeón con cierre vigente, resultado provisional o ganador no determinable y campeón desconocido. Una competición sin ganador acreditado permanece visible con sus bloqueos, pero no recibe una tarjeta de campeón. Solo se muestra subcampeón cuando lo acredita el servicio existente. Una temporada sin año puede conservar un ganador acreditado por ese servicio, siempre dentro del apartado sin año y sin convertirlo en un cierre anual válido.

La procedencia mantiene escenario local, proveedor sin certificación oficial y desconocida. Ni una simulación ni una confirmación local de cierre certifican un resultado oficial. Archivar una temporada no la cierra. Las confirmaciones se vuelven a evaluar con sus fundamentos actuales y se muestran desactualizadas cuando corresponde; nunca se modifican o eliminan desde el Archivo.

## Movimientos y competiciones continentales

Los ascensos y descensos calculados se etiquetan como proyecciones deportivas actuales. Los pendientes y la provisionalidad se conservan. Los descensos por promedio se presentan separados de los descensos por tabla; no se sintetiza un nuevo sistema combinado. Si no hay una división de destino explícitamente vinculada, se muestra esa ausencia.

Los movimientos registrados al preparar una edición conservan el evento, fecha, mecanismo e IDs explícitos de origen. Los destinos se resuelven únicamente entre los torneos del universo activo relacionados por ese registro. Un origen ausente se muestra como referencia no resuelta; no se buscan nombres similares ni temporadas de otro universo. Una proyección y su posterior registro pueden aparecer por separado: el indicador cuenta registros/proyecciones y no afirma una cantidad única de transferencias realizadas.

Las plazas continentales muestran origen, destino, vía, estado y motivos pendientes. Una clasificación no acredita participación. El indicador de participantes continentales exige al menos un encuentro registrado para ese club en una competición continental; los clubes solamente inscritos se distinguen. Esto acredita presencia en el calendario, no que un partido pendiente se haya disputado. Los documentos de admisión conservan sus estados y referencias.

## Acontecimientos y evolución anual

Los acontecimientos se ordenan por sus fechas originales de actividad y conservan identidad, acción, resumen, edición registrada y procedencia local/importada. Los detalles permiten inspeccionar el evento original. Se diferencian operaciones administrativas de actividad deportiva o preparación. La fecha de importación nunca se presenta como la fecha de un partido. No se generan eventos de campeonato terminado, ascenso o clasificación si el historial no los contiene.

Los eventos con referencias ausentes permanecen en la consulta general dentro de su universo según las reglas existentes. Al filtrar por una competición o club se muestran los acontecimientos vinculados a las temporadas seleccionadas; no se atribuyen eventos huérfanos a clubes mediante sus nombres. Una actividad ausente se declara, sin reconstrucción retrospectiva.

La tabla anual compara los indicadores ya calculados, con sus valores accesibles. La evolución de cada competición utiliza su identidad registrada y el servicio de comparación de temporadas. Varias versiones de un mismo año impiden una comparación automática. Se explican incompatibilidades de formato, puntos, cobertura o procedencia. Las nuevas presencias y ausencias son diferencias entre registros de clubes, no pruebas de ascenso, descenso, desaparición institucional o transferencia. Las métricas deportivas detalladas permanecen en Rendimiento.

## Filtros, navegación y actualización

Los filtros de año, país, confederación, competición, categoría, club, tipo, cierre, procedencia y búsqueda se intersectan. La búsqueda ignora mayúsculas y acentos, pero no crea identidades. Los selectores de clubes distinguen homónimos por sus IDs y mantienen advertencias de identidad ambigua.

Cada ficha abre temporada original, calendario, cierre, estadísticas, clasificación internacional y planificación existentes. Los participantes pueden abrir su perfil exacto en el Historial de clubes. Se integran palmarés y rendimiento, con su alcance completo del universo claramente indicado; esos componentes conservan sus propios filtros. No se añaden editores de resultados al Archivo.

El panel lee el estado actual al abrir, al recibir eventos de almacenamiento y al recuperar foco. Los cambios en resultados actualizan tablas, campeones, movimientos y cierres. Cambiar de universo descarta filtros y perfiles seleccionados incompatibles y utiliza contextos de consulta separados por universo. Las dependencias se resuelven después del filtrado de ámbito.

La lectura no actualiza la instantánea aceptada por el coordinador de escrituras. Después de una modificación externa, las escrituras posteriores siguen requiriendo abrir expresamente la biblioteca o temporada actual mediante los flujos existentes. El Archivo no desactiva Web Locks ni acepta silenciosamente revisiones obsoletas.

## Interfaz y persistencia

Se usan los estilos, tipografías y colores de Cancha: navegación cronológica, tarjetas de campeones, indicadores anuales y fichas desplegables. Los filtros y tarjetas se adaptan al ancho disponible y las tablas conservan desplazamiento local. Hay nombres accesibles, foco inicial y retorno al acceso principal. No se incorpora una biblioteca gráfica.

No hay persistencia nueva ni cambios en JSON v7. Los filtros y navegación propios son de presentación; las consultas integradas conservan sus borradores de sesión existentes con claves de universo. Consultar, buscar y desplazarse no guarda temporadas, resultados, cierres, actividad ni universos.

## Pruebas y evidencia

Los registros se conservan en [validation/historical-archive](validation/historical-archive/). Las pruebas nuevas cubren años y registros sin año, vacío, archivo administrativo, campeones y formatos desconocidos, cierres vigentes/desactualizados, empates, movimientos, plazas, actividad incompleta, homónimos, identidades de competición, dependencias ausentes, filtros combinados, cambio de universo, actualización, navegación, lectura sin azar ni escrituras y JSON v7.

Durante el desarrollo se corrigieron campos de admisión continental y expectativas de pruebas sobre roles accesibles, payloads y temporadas sin año. El flujo nuevo de App sincroniza la navegación con la promesa del módulo real de calendario mediante `act`, sin elevar timeouts ni simular el panel. Las pruebas existentes de carga diferida y los recorridos de navegador permanecen completos. Un diagnóstico con filtro de nombre incorrectamente transmitido no ejecutó casos y no se considera aprobado.

El primer recorrido de navegador tuvo un selector ambiguo entre los dos controles de universo existentes. La siguiente matriz se interrumpió tras detectar que el recorrido intentaba cambiar de universo sin aceptar la biblioteca modificada externamente; se corrigió el recorrido para abrir primero la temporada guardada, conservando la protección global. Se conservan registros y trazas de esas invocaciones por separado. No se añaden reintentos ni se cambian workers, timeouts o aislamiento para ocultar fallos.

La matriz específica posterior informó **24 casos aprobados en 2,9 minutos**, pero la sesión envolvente de PowerShell terminó con código 1 y registros `NativeCommandError` al redirigir advertencias nativas. Por tanto no se declara esa invocación aprobada. La validación general usa redirección nativa mediante `cmd.exe`, registra por separado el código real de cada comando y exige cierre normal para declarar éxito. La suite focalizada final registró **37 pruebas aprobadas en cuatro archivos** (incluye tres pruebas existentes del Centro de cierre), en 19,26 s.

La primera ejecución general predeterminada de `npm test` aprobó **98 archivos y 1.023 pruebas** en **93,53 s**, con código 0. La misma versión con cuatro workers aprobó **98 archivos y 1.023 pruebas** en **111,07 s**, con código 0. No hubo navegadores de pruebas activos durante estas suites de Vitest. Los resultados no demuestran que las intermitencias históricas de interfaz diferida estén resueltas.

La primera ejecución de `npm run test:flows` registró **84 pruebas aprobadas y dos fallidas**, seis archivos aprobados y dos fallidos, en **43,67 s**, con código 1. Falló `app-lazy.test.tsx` por su timeout de 5.000 ms y el caso de apertura del Archivo de `app-archive.test.tsx` al esperar su región diferida. Se conserva íntegra. La compilación posterior pasó TypeScript y Vite. Se ajustó únicamente el helper nuevo de apertura del Archivo para esperar, dentro de `act`, la promesa del módulo real, igual que la navegación al calendario. No se amplía ningún timeout ni se cambia el test histórico. La validación de Vitest y compilación se ejecutó nuevamente tras este cambio concreto; la E2E completa usó los mismos archivos de aplicación y navegador, que no cambiaron con este ajuste del test unitario.

La invocación completa de `npm run test:e2e` aprobó **456 casos en una sola ejecución de 21,2 minutos**: 38 recorridos en cada combinación de Chromium, Firefox y WebKit con tamaños escritorio, notebook, tablet y móvil. Terminó con código 0 y `.last-run.json` con estado `passed` y sin pruebas fallidas. Incluye dos pestañas reales, actualización del cierre ante cambios externos, descarte de filtros al cambiar de universo, navegación, teclado, conservación de datos y comprobaciones de desbordamiento. No se sumaron ejecuciones parciales para declarar el resultado.

La última validación, después del ajuste concreto del helper de prueba, terminó así:

| Comando | Resultado final | Duración informada | Salida |
| --- | --- | --- | --- |
| `npm test` | 98 archivos, 1.023 pruebas aprobadas | 92,10 s | 0 |
| `npm test -- --maxWorkers=4` | 98 archivos, 1.023 pruebas aprobadas | 102,77 s | 0 |
| `npm run test:flows` | 8 archivos, 86 pruebas aprobadas | 40,61 s | 0 |
| `npm run test:e2e` | 456 casos aprobados, ejecución completa | 21,2 min | 0 |
| `npm run build` | TypeScript y Vite aprobados | Resultado de proceso conservado | 0 |

Los 34 casos nuevos de Vitest están en tres archivos; el comando de flujos incorpora el nuevo archivo de App. Las repeticiones finales responden al cambio del helper de carga diferida, no a reintentos configurados. Que `app-lazy` aprobara las últimas invocaciones no acredita una solución a su intermitencia histórica. Los resultados iniciales y finales no se sustituyen ni se suman para ocultar los fallos.

Se conservan [archivos modificados](validation/historical-archive/changed-files.txt), [resultados finales de proceso](validation/historical-archive/validation-complete-results.json), [huellas SHA-256 de fuente y configuración](validation/historical-archive/source-hashes.json), [verificación de esas huellas](validation/historical-archive/source-verification.json) y [estado final de Playwright](validation/historical-archive/playwright-last-run.json). La documentación se excluye de las huellas para poder completar sus resultados después. Los lanzadores y las invocaciones fallidas/interrumpidas quedan separados. No se añadieron dependencias, persistencia, eventos, motores, reglas deportivas ni cambios a JSON v7.

## Limitaciones

- El alcance histórico depende de las temporadas, cobertura, actividad e identidades efectivamente guardadas. El Archivo no certifica fuentes externas ni reconstruye hechos ausentes.
- Los países, categorías y confederaciones desconocidos se mantienen sin acreditar; no existe un editor nuevo de ese catálogo.
- La participación continental indicada acredita encuentros registrados; no equivale automáticamente a partidos disputados ni a certificación oficial.
- Un cambio de presencia no demuestra un movimiento de división. Los destinos sin vínculo explícito siguen sin resolver.
- Las proyecciones históricas son actuales, no una reconstrucción del estado de la biblioteca en una fecha pasada. Para recuperar un estado anterior se mantienen los respaldos y puntos de control existentes.
- La lectura de todos los formatos reutiliza servicios de dominio potencialmente costosos. No se añade una caché persistida, paginación de la biblioteca ni un motor de agregación alternativo; las fichas detalladas son desplegables.

# Centro de decisiones deportivas

## Auditoría y alcance

El Centro reúne decisiones por competición y temporada del universo activo, incluidas las temporadas heredadas sin asignación cuando se consulta ese ámbito. La consulta utiliza las mismas temporadas y actividad que calendario, tablas, progresión, sorteos y cierre. No mantiene una segunda clasificación ni persiste una lista de decisiones.

Se reutilizan `calculateStandingsWithResolution`, los detalles nativos de desempates, `getOfficialResolutionContexts`, `currentResolution`, `programmeOrder`, `getCompletedStageWinners`, `getDivisionOutcome`, las proyecciones continentales, `projectSeasonProgression` y `evaluateSeasonClosure`. Las alertas operativas se presentan como observaciones; no todas son decisiones editables. Los vínculos entre temporadas usan identificadores registrados, nunca coincidencias de nombres.

Los únicos registros documentales habilitados son los que reconoce actualmente el dominio: `brasil-table` para Série B 2026, `argentina-seeding` para la siembra entre zonas de Primera Nacional 2026 y `argentina-relegation` para sus programas oficiales de permanencia. No existe un mecanismo genérico de resolución para cualquier liga o copa. Los empates a puntos ya resueltos por criterios nativos no aparecen como desempates pendientes. Los empates múltiples conservan las reglas existentes.

La ordenación nativa divide el grupo empatado por cada criterio y continúa con el siguiente sobre los subgrupos restantes. Los criterios particulares calculan sus estadísticas entre los integrantes del grupo evaluado. No se añadió un reinicio genérico de criterios. El dominio omite el enfrentamiento directo brasileño de 2026 cuando el grupo tiene más de dos clubes y exige cobertura válida para tarjetas. Al agotar criterios o faltar datos conserva el grupo como no resuelto: su orden alfabético de presentación no acredita posiciones deportivas ni habilita una resolución arbitraria.

Las eliminatorias utilizan los encuentros y etapas registrados, su validez operativa y el cálculo nativo de ganadores. Un ganador calculable no exige confirmación documental adicional. Los penales, resultados u otros datos faltantes remiten al editor existente. No se agregan reglas de gol visitante, encuentros, vencedores arbitrarios ni sorteos.

## Proyección y estados

`sports-decisions.ts` produce categorías de integridad, clasificación y desempates, eliminatorias, ascensos y descensos, clasificación internacional, documentación reglamentaria y dependencias. Cada causa conserva participantes, encuentros, posiciones disponibles, explicación, impactos y acciones aplicables. Las causas idénticas se reúnen con sus acciones e impactos.

Los estados de presentación son Pendiente, Requiere documentación, Requiere completar partidos, Lista para revisión, Resuelta, Resolución desactualizada y Bloqueada por formato no soportado. No se agregaron estados al modelo persistido. La tabla muestra estadísticas y criterios registrados; el dominio no expone una traza del criterio decisivo de cada par y el Centro no la reconstruye con otro algoritmo.

`sports-decision-eligibility.ts` comprueba reglamento anual de la misma temporada, verificación, reglamento de partidos si existe, archivo administrativo y dependencias explícitas de admisión de la edición actual. Una plaza pendiente para una futura edición internacional no se transforma por sí sola en un bloqueo de la clasificación de la edición de origen. Las referencias ausentes del universo y los fundamentos de admisión desactualizados impiden registrar decisiones.

El historial contrasta cada resolución con el contexto deportivo actual. Distingue vigencia, sustitución, falta documental y programa incompleto. La actividad antigua por sí sola no acredita una resolución vigente. Las fuentes importadas conservan su procedencia sin recibir certificación retrospectiva.

## Revisión y confirmación

Se reutiliza `OfficialResolutionManager` con una devolución opcional para revisar. Sus otros consumidores mantienen su funcionamiento. El formulario conserva fuentes, atestación del usuario, participantes, orden y programas nativos; no permite sustituir una regla no soportada por una elección libre.

`review-sports-resolution.ts` ejecuta `recordOfficialResolution` contra un adaptador transitorio, sin escrituras reales. La nueva opción `advanceProgression: false` evita que este registro genere cruces posteriores; el valor predeterminado del caso existente conserva su comportamiento previo. La revisión comprueba que únicamente cambie `officialResolutions` y que se produzca el evento nativo correspondiente. No simula partidos ni modifica sus resultados.

La vista previa muestra temporada, ámbito, participantes, fundamentos, fuente, orden o programa y efectos nativos antes y después, incluidos movimientos que ya pueda calcular el servicio. Estos efectos son proyecciones en memoria. Confirmar registra el documento; la continuación deportiva se realiza desde los controles existentes.

Un `WeakMap` privado vincula la identidad de la revisión, su contenido completo y la instantánea de temporadas y actividad del repositorio acotado. Copias, manipulaciones, revisiones consumidas o anteriores a cambios requieren otra revisión. La confirmación explícita vuelve a validar universo, instantánea, elegibilidad, contexto, participantes, fundamentos y situación pendiente. Se rechazan duplicados, incluidas publicaciones provisionales idénticas. Las revisiones documentales posteriores conservan los registros sustituidos.

La aplicación utiliza el `runWrite` y la coordinación global existentes con el Web Lock `cancha.save-checkpoints`. El repositorio real vuelve a comprobar la instantánea de almacenamiento al adquirir el bloqueo y la pertenencia persistida al universo. Las pestañas no pueden confirmar dos revisiones del mismo estado. La compensación de errores, recuperación y tratamiento de cuota son los existentes. No se implementó un bloqueo paralelo.

El guardado utiliza exclusivamente `saveWithActivity`, `OfficialResolution` y `official-resolution-recorded`. La fecha técnica se toma al confirmar, conservando el contenido deportivo revisado. No se cambian modelos, eventos, dependencias ni JSON v7.

## Interfaz e integración

Hay acceso desde la navegación general, Centro de competiciones, alertas, sorteos, simulación, cierre, progresión y dashboard del universo. El Centro permite elegir competición y temporada, filtrar estados, consultar tablas y fundamentos, revisar historial y seguir encuentros o flujos deportivos. La navegación no confirma operaciones.

Los borradores documentales del Centro incluyen el universo en su clave de sesión. Cambiar de ámbito invalida la revisión. Abrir, filtrar y revisar no escribe. La confirmación actualiza temporadas y actividad desde el repositorio y conserva el torneo abierto correspondiente. La vista previa recibe foco; las tablas disponen de desplazamiento local. La navegación superior permite distribuir sus botones en varias filas en móvil.

La proyección pura se memoriza mediante el contenido completo de temporadas, actividad, selección y universo. Cambios locales de filtro, vista previa o indicador de guardado reutilizan el cálculo; cualquier cambio de los datos leídos produce otro. Esta optimización no conserva autorizaciones de escritura ni sustituye las validaciones de confirmación.

## Validación

Los registros, resultados de proceso y manifiesto están en [validation/sports-decisions-center](validation/sports-decisions-center/). Las pruebas nuevas cubren criterios nativos, empates múltiples, eliminatorias y penales, programas AFA, sorteo de Série B con cobertura de tarjetas, movimientos, clasificación provisional y definitiva, dependencias explícitas, revisión pura, cambios de reglas o participantes, manipulación, duplicados, revisión provisional, fechas de confirmación, persistencia y JSON v7. Las pruebas de concurrencia utilizan el repositorio protegido y comprueban adquisición del bloqueo, dos confirmaciones, cambios de universo, cuota, compensación, restauración y falta de Web Locks.

Las pruebas de aplicación cubren revisión y confirmación explícitas, navegación y aislamiento entre universos. Los tres recorridos nuevos de Playwright comprueban conservación exacta de partidos, dos pestañas y navegación de penales pendientes. Se ejecutan en las doce combinaciones de navegadores y tamaños existentes.

La primera matriz específica aprobó 33 casos y falló en los tres de Firefox móvil: el botón superior quedaba fuera del área visible por la altura fija del encabezado. Se corrigió la distribución responsive del producto; no se modificaron timeouts, workers, aislamiento ni reintentos. Los registros de desarrollo conservan también un error de preparación de un fixture y dos errores de TypeScript corregidos. Las 60 pruebas focalizadas anteriores a la comprobación adicional de dependencias aprobaron.

Los resultados de la validación completa se registran al finalizar sus procesos en los archivos `*.result.json` y `validation-results.json`.

| Comando final | Resultado |
| --- | --- |
| `npm test` | 1109 aprobadas; 2 timeouts de 5000 ms en `app-closure` y el primer recorrido de `app-decisions`; 102 archivos aprobados y 2 fallidos; 103,38 s |
| `npm test -- --maxWorkers=4` | 104 archivos y 1111 pruebas aprobados; 132,31 s |
| `npm run test:flows` | 91 aprobadas; 1 timeout de 5000 ms en el primer recorrido de `app-decisions`; 9 archivos aprobados y 1 fallido; 58,57 s |
| `npm run build` | TypeScript y Vite aprobados |
| `npm run test:e2e` | 528 casos aprobados en una sola ejecución; 27,7 minutos; código de salida 0 y `.last-run.json` con estado `passed` |

El timeout del recorrido nuevo bajo la concurrencia predeterminada permanece como limitación de validación. Las ejecuciones con cuatro workers y las focalizadas aportan evidencia complementaria; no convierten las invocaciones fallidas en aprobadas. El aislamiento, los timeouts y los reintentos conservan sus valores originales. No se atribuye una causa única al comportamiento por diferencias de carga, importación o planificación.

El entorno mantiene Node 22.18.0 y Vitest 5.0.4 en Windows con ocho procesadores disponibles. El límite predeterminado de esta instalación es siete workers concurrentes, frente a cuatro con el argumento explícito. Los 104 workers que informa el resumen corresponden a los archivos aislados creados durante la suite, no a 104 procesos simultáneos. La ejecución predeterminada final fue más rápida, pero tuvo fallos; la comparación no es un benchmark que aísle el número de workers.

La matriz final incluye los 36 casos nuevos en Chromium, Firefox y WebKit con tamaños escritorio, notebook, tablet y móvil: todos aprobaron. La corrección del encabezado quedó comprobada en Firefox móvil. Los recorridos verifican conservación de encuentros, confirmación explícita, historial vigente, navegación y coordinación entre pestañas con Web Locks reales. Se conservan doce capturas de revisión en `screenshots`, el estado final de Playwright en `playwright-last-run.json` y las huellas de los 22 archivos de código y configuración en `source-hashes.json`. El manifiesto de los 23 archivos fuente y documentación afectados está en `changed-files.txt`; los registros y artefactos de validación se agrupan aparte en esta carpeta.

La primera tanda completa se conserva en `initial-full`: `npm test` aprobó 1108 pruebas y registró tres timeouts de 5000 ms (`app-lazy`, `app-closure` y el primer recorrido de `app-decisions`); con cuatro workers aprobaron las 1111 pruebas; `test:flows` aprobó 90 y registró dos timeouts (`app-closure` y `app-decisions`). Se interrumpió el proceso coordinador posterior para aplicar la memorización de la proyección antes de repetir los comandos con la corrección. No se cambió ningún timeout, retry, aislamiento o configuración de workers. Estos resultados no permiten atribuir todos los timeouts históricos a una única causa.

## Limitaciones

- La verificación documental requiere que el usuario contraste la publicación con la fuente; el Centro no certifica documentos externos.
- Los ámbitos, ediciones y programas sin soporte nativo permanecen bloqueados con explicación. No se infieren reglas nuevas.
- Las dependencias y procedencia que no existen en respaldos históricos no se reconstruyen por nombres ni por actividad aislada.
- La confirmación documental no inicia progresión, sorteos, simulación, cierre ni futuras temporadas. Los flujos originales conservan sus propias condiciones y controles.
- Las proyecciones consultan la biblioteca acotada completa para conservar coherencia; no se añadió una caché persistida ni otro sistema de recuperación.

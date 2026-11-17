# Centro de sorteos, grupos y cruces

## Auditoría previa y arquitectura

La auditoría encontró progresiones y generadores de calendario, pero **no un generador aleatorio genérico de sorteos ni un modelo estructurado de bombos y restricciones de distribución**. El Centro no añade esos algoritmos ni interpreta notas documentales como instrucciones ejecutables.

| Área auditada | Capacidad existente y reutilización |
| --- | --- |
| Eliminatorias genéricas de copas | `advanceOfficialCupProgression` y `getCompletedStageWinners` completan estructuras registradas y acreditan ganadores. Sus cruces posteriores son predeterminados, no sorteos aleatorios. |
| Continental | `advanceContinentalCupProgression` reconoce formatos concretos, grupos y transferencias entre copas. Se invoca mediante `advanceTournamentProgress` contra un adaptador transitorio, limitado al universo. No se infieren formatos de otras ediciones. |
| Argentina, ascenso chileno y segunda división | `advanceTournamentProgress` coordina sus servicios particulares. No se ofrece reemplazar sus ventajas, ordenamientos, sorteos reglamentarios o cabezas de serie mediante un formulario genérico. |
| Grupos | La composición ya existe en `Team.groupName`. Se reutilizan sus nombres y capacidades registrados; las tablas y desempates siguen siendo los existentes. No hay una entidad de bombos que pueda completarse de forma fiable con nombres o rankings. |
| Desempates y resoluciones | `getUnresolvedStandingsTieGroups`, validación de resultados y ganadores impiden usar posiciones provisionales. `OfficialResolutionManager` y `recordOfficialResolution` conservan los ámbitos documentales específicos de Brasil y Argentina. No se reutiliza un ámbito de desempate para registrar un sorteo de grupos ajeno. |
| Calendarios | `previewManualCalendar` y `confirmCalendarProgramming` conservan las validaciones, procedencia y guardado. `generateRoundRobinSchedule` se reutiliza por cada grupo compatible; no se duplica su algoritmo. |
| Reglamento y admisión | `getCalendarProgrammingBlockers`, `validateTournamentIntegrity`, `continentalPlanState` y `nationalCupReviewState` validan preparación, fuentes, identidad, reglamento anual, estados documentales y dependencias. |
| Simulación | `simulateFixtures` y el Centro de simulación consumen los mismos encuentros. Confirmar una distribución o crear encuentros no genera marcadores ni llama al simulador. |
| Cierre | El Centro de cierre consume las etapas, calendarios, tablas y premios actuales. Una fase vacía o una final pendiente sigue bloqueando el cierre. No se introduce otra determinación de campeón. |
| Identidades, actividad y respaldo | Se conservan IDs y `competitionIdentity`; no se asignan clubes por nombre. La actividad existente admite el registro de confirmación, sin añadir campos al torneo. JSON continúa en versión 7. |
| Pestañas y puntos de control | Las confirmaciones utilizan `LibraryWriteContext` y el bloqueo global vigente. El almacenamiento, compensación, restauración y puntos de control permanecen en sus servicios actuales. |

`draw-and-bracket.ts` inspecciona estructuras y ejecuta las propuestas del servicio existente en memoria. `prepare-stage-draw.ts` revisa y confirma distribuciones y, en una operación posterior, sus encuentros. `DrawAndBracketCenter` es la interfaz común; `DrawCenterNavigation` solo coordina navegación.

## Formatos y modos soportados

### Registro manual

- Grupos con nombres y capacidades ya registrados, todos los participantes asignados y sin encuentros existentes en la temporada. Se permite reorganizar la composición respetando esas capacidades; no se inventa una cantidad de grupos o plazas faltantes.
- Primera eliminatoria de una copa genérica por etapas, con admisión y reglamento verificados, participantes definitivos y estructura registrada. Cada club debe aparecer exactamente una vez.
- Rondas posteriores con ganadores acreditados. La distribución y localía deben coincidir con los cruces predeterminados del servicio existente; no se sustituyen por otro cuadro.

Los formatos específicos continentales, argentinos, de segunda división y del ascenso chileno mantienen sus restricciones y flujos propios. Las fases previas ajenas a la estructura eliminatoria registrada no se consideran automáticamente resueltas. No se configura un cuadro de un formato desconocido a partir del número de equipos.

### Propuesta local del servicio deportivo

La acción explícita **Generar propuesta del servicio deportivo** utiliza únicamente `advanceTournamentProgress` y sus servicios actuales, con un adaptador transitorio. No consume azar ni afirma realizar un sorteo. Se extraen solo los cruces de la etapa elegida; no se guardan otras progresiones calculadas en memoria.

La propuesta se bloquea si el servicio no acredita cruces, necesita incorporar nuevos participantes, modifica encuentros existentes o no aporta una resolución y localía representables. Los participantes de grupos proceden exclusivamente de la clasificación que acredita ese servicio; los desempates pendientes bloquean la operación. No se usa el orden visual de tablas como sustituto de un desempate.

El sorteo aleatorio queda deshabilitado con una explicación visible: no existe un generador compatible auditado. Tampoco se inventan bombos, cabezas de serie, restricciones por país o reglas de CONMEBOL. Registrar datos documentales no habilita un algoritmo que no existe.

### Registro documental

Reutiliza el contrato `OfficialReference`, `RulesVerificationStatus` y `isHttpsReference`, con referencia, URL HTTPS, estado de revisión y confirmación expresa de contraste si el usuario marca la fuente como verificada. Las restricciones estructurales y deportivas son las mismas del registro manual compatible.

La operación mantiene `mode: documented` y la fuente original, pero **no certifica un sorteo oficial** ni crea una `OfficialResolution` de un ámbito incorrecto. Un registro documental provisional puede conservarse como tal; no permite crear encuentros definitivos. Los sorteos y desempates oficiales de los ámbitos ya implementados se siguen resolviendo en sus controles existentes, accesibles desde la revisión de reglamentos y alertas.

## Inspección y protección

La pantalla muestra universo, temporada, formato, participantes e IDs, grupos, plazas sin asignar, etapas, reglamentos, dependencias, encuentros, marcadores, localías y programación registrada. Distingue preparación pendiente, bloqueada, confirmada, documental provisional, revisión desactualizada, encuentros generados y etapas disputadas. Los recuentos indican cuántos encuentros tienen resultado válido o fecha registrada.

No se reconstruyen etapas ausentes ni sorteos históricos sin actividad. Las fases del calendario que no corresponden a la estructura preparable permanecen visibles como tales. Una copa sin estructura suficiente queda bloqueada.

**Cualquier encuentro existente en la etapa bloquea su reorganización**, incluso sin marcador. Los grupos no se reorganizan si existen encuentros en la temporada. Se conservan íntegramente resultados, eventos, alineaciones, estados operativos, programación y resoluciones. La propuesta nativa también se rechaza si su progresión modificaría o eliminaría un encuentro anterior. No se borran partidos para hacer encajar una nueva distribución.

Las series usan el número de partidos registrado en `KnockoutStage`. La localía manual es explícita; la vuelta invierte el orden revisado. Las opciones de resolución son las que el modelo existente soporta y se contrastan con las restricciones registradas del reglamento de partidos. No se inventan goles visitantes, ventajas deportivas, neutralidad, prórrogas o sedes oficiales.

## Revisión, confirmación y escritura global

Consultar no genera propuestas. Una solicitud explícita crea la vista previa en memoria. Un `WeakMap` privado vincula identidad y contenido de la revisión a la lectura de temporadas y actividad del repositorio limitado al universo. Se verifica que la biblioteca no cambió durante la lectura.

La confirmación debe ser explícita. El comando de App obtiene el bloqueo global de la biblioteca, valida su instantánea e invoca el caso de uso sin operaciones asíncronas dentro de la escritura. Se comprueban universo persistido, revisión íntegra, estado actual, participantes, admisión, reglas y dependencias. Las copias, manipulaciones, revisiones consumidas, duplicadas o anteriores a un cambio se rechazan antes de escribir. No se combinan dos sorteos incompatibles.

Las propuestas del servicio nativo son deterministas. Revalidarlas no ejecuta un nuevo sorteo aleatorio ni cambia la propuesta guardada. Las propuestas de encuentros conservan exactamente sus IDs y emparejamientos revisados; confirmar no los regenera.

La confirmación de grupos utiliza `saveWithActivity`, porque cambia `Team.groupName`. La de cruces registra solo actividad: **no crea partidos**. El coordinador existente conserva sus controles de cuota, compensación y ausencia de Web Locks. La lectura y exportación siguen disponibles donde el protocolo actual las permite; no se añade un mecanismo de bloqueo alternativo.

## Creación y programación de encuentros

Tras confirmar una distribución aparece **Revisar creación de encuentros**. Esa revisión vuelve a validar el registro de sorteo, su ámbito y fundamentos y los participantes reales, incluso tras restaurar actividad desde JSON. Los registros documentales provisionales siguen bloqueados.

La creación de encuentros exige una segunda confirmación. Usa la programación manual existente y registra `calendar-programmed`, vinculado al ID del registro de distribución.

- Eliminatorias compatibles: transcribe los cruces y la localía revisados. Las jornadas vacías registradas se completan conservando su nombre, número y rueda; no se duplican.
- Grupos de una liga round-robin compatible y sin jornadas existentes: coordina el generador actual por grupo y registra sus encuentros con el servicio de programación. La procedencia del servicio sigue siendo registro local manual de calendario; no se presenta como calendario oficial.
- Grupos de copas por etapas, calendarios de grupos con jornadas vacías previas o estructuras ambiguas: se bloquea la construcción general y se ofrece continuar en la programación existente. No se reemplaza una estructura desconocida.

La extensión puntual de `previewManualCalendar` permite reutilizar jornadas vacías **solo mediante un parámetro opcional explícito**. Su comportamiento anterior permanece por defecto. El servicio conserva toda jornada existente y solo rellena coincidencias únicas de nombre, número y rueda sin encuentros; integridad se valida antes de emitir la propuesta. Nunca sustituye una jornada con partidos.

Crear encuentros no asigna fechas, horarios ni estadios oficiales. La programación logística continúa en el calendario existente. La simulación y las posteriores progresiones quedan a cargo de sus controles originales. El cierre reutiliza sus verificaciones actuales y no acredita una temporada solo por tener una distribución confirmada.

## Persistencia y procedencia

No se añade un campo persistido al torneo ni otra biblioteca. Los grupos siguen en `Team.groupName`, las etapas en `knockoutStages` y los encuentros en `matchdays`. La única extensión es el evento **`stage-draw-confirmed`**, con payload validado `StageDrawRecord` versión interna 1: universo, etapa, modalidad, distribución, cruces, resolución cuando corresponde, fundamento y fuente opcional.

El fundamento canónico conserva temporada, dependencias explícitas y referencias a actividad relevante. Excluye las propias confirmaciones de distribución y el evento técnico de restauración para evitar recursión y permitir restaurar un registro coincidente. Cambios posteriores pueden exigir nueva revisión de manera conservadora. Las confirmaciones antiguas no se eliminan. Las propuestas continentales se contrastan nuevamente con el servicio al construir sus encuentros.

La actividad conserva identidad de competición, temporada, operación y procedencia; los eventos importados mantienen su marca. No se atribuye retroactivamente una fuente a un sorteo histórico. Los resultados manuales, importados y simulados siguen usando su procedencia existente.

JSON permanece en **v7**. Los respaldos anteriores sin estos eventos siguen siendo legibles. Los respaldos nuevos conservan distribuciones y fuentes usando la actividad existente, y la restauración mantiene los controles actuales. Un lector antiguo que desconoce esta acción no adquiere soporte retroactivo para ella. Los fundamentos almacenados aumentan el tamaño del historial; no se añade otra política de retención.

## Navegación e interfaz

Existe un único Centro, accesible desde navegación principal, Centro de competiciones, calendario, simulación, progresión, dashboard y alertas. Los accesos específicos conservan la temporada seleccionada. El Centro navega a calendario, programación, simulación, reglamentos/decisiones y cierre existentes; no añade editores de resultados.

Las lecturas se actualizan al recibir cambios de almacenamiento y recuperar el foco. Una revisión pendiente conserva su propuesta capturada, y confirmar revalida bajo bloqueo. Si cambia el universo persistido se ocultan los controles del ámbito anterior y se exige abrir la biblioteca actual. La navegación no acepta silenciosamente una instantánea obsoleta para escribir.

El cuadro tiene una región accesible y desplazamiento horizontal local, con columnas legibles por jornada. Formularios, grupos y tarjetas se adaptan a móvil. Se mantienen los estilos de Cancha, foco inicial, retorno al acceso principal y ausencia de bibliotecas nuevas.

## Pruebas y diagnósticos

La evidencia se conserva en [validation/draw-and-bracket-center](validation/draw-and-bracket-center/). La suite focalizada reúne pruebas de propuestas manuales y predeterminadas válidas, bloqueo de azar/bombos sin generador, fuentes documentales, grupos completos e incompletos, participantes duplicados/no admitidos, reglas y restricciones, dependencias, ganadores y empates, localías, partido único e ida/vuelta, revisión pura, confirmación explícita/obsoleta/manipulada, protección de encuentros, calendario, simulación, progresión, cierre, JSON v7 y restauración.

Las carreras usan barreras de promesas y el coordinador real, sin pausas fijas: dos distribuciones, escritura anterior a una confirmación en espera, dos creaciones de encuentros, reasignación de universo, cuota y ausencia de Web Locks. Los flujos de App verifican las dos confirmaciones y el ámbito activo. Playwright usa las 12 configuraciones actuales e incluye dos pestañas reales.

Durante el desarrollo TypeScript detectó imports sin uso, una conversión de readonly innecesaria en un test de manipulación y la falta de anotación de `this` en el mock de almacenamiento; se corrigieron. La primera invocación de navegador quedó bloqueada por compilación y no se declara aprobada. La siguiente aprobó dos casos y falló el recorrido de ida/vuelta esperando el cuadro: al contenedor le faltaba el rol de región. Se añadió ese rol, manteniendo la comprobación de accesibilidad, el timeout de 45 s y las aserciones de conservación. Se guardaron capturas, contexto y traza.

La matriz específica posterior informó **36 casos aprobados en 3,2 minutos**, en los tres navegadores y cuatro tamaños, con salida 0. Las validaciones generales finales se registran a continuación. No se modifican timeouts, reintentos, aislamiento ni configuración de workers del proyecto; no se presume resuelta la intermitencia histórica de Vitest.

La suite general predeterminada aprobó **101 archivos y 1.067 pruebas en 88,01 s**, con salida 0. La misma versión con `--maxWorkers=4` aprobó **101 archivos y 1.067 pruebas en 115,34 s**, con salida 0. Ambas se ejecutaron en serie, sin navegadores de pruebas activos. Son resultados de invocaciones diferentes, no un benchmark que aísle exclusivamente la concurrencia.

`npm run test:flows` registró **87 pruebas aprobadas y dos fallidas**, siete archivos aprobados y dos fallidos, en **65,04 s**, con salida 1. Los casos fueron `app-lazy.test.tsx` («starts in the library, loads the import screen on navigation and imports only on request») y `app-closure.test.tsx` («reviews without writing, confirms only explicitly and navigates to the existing planning flow»); ambos agotaron el límite existente de 5.000 ms. Los mismos casos aprobaron en las dos suites generales y las tres pruebas nuevas de App aprobaron en flujos. Esto no demuestra una causa única ni permite declarar resuelta la intermitencia histórica de `app-lazy`. Se conserva el fallo completo y no se repite la invocación para sustituir su resultado por uno favorable. No se modificaron esos tests ni sus timeouts.

`npm run build` aprobó TypeScript y Vite. La E2E completa se ejecutó después de estas invocaciones y aprobó **492 casos en una sola ejecución de 22,4 minutos**: 41 recorridos en cada una de las 12 combinaciones de Chromium, Firefox y WebKit con tamaños escritorio, notebook, tablet y móvil. Terminó con salida 0 y `.last-run.json` con estado `passed` y ninguna prueba fallida. No se sumaron resultados parciales para declarar la matriz aprobada. El lanzador oculto conservó el código de salida y el resumen final aunque la sesión inicial de terminal no permaneciera abierta.

| Comando final | Resultado | Salida |
| --- | --- | --- |
| `npm test` | 101 archivos, 1.067 pruebas aprobadas; 88,01 s | 0 |
| `npm test -- --maxWorkers=4` | 101 archivos, 1.067 pruebas aprobadas; 115,34 s | 0 |
| `npm run test:flows` | 87 aprobadas y 2 timeouts; 7 archivos aprobados y 2 fallidos; 65,04 s | 1 |
| `npm run test:e2e` | 492 casos aprobados en una ejecución; 22,4 min | 0 |
| `npm run build` | TypeScript y Vite aprobados | 0 |

Se añadieron **44 pruebas de Vitest en tres archivos**, incluidas tres pruebas nuevas de App; la suite de flujos incorpora ese archivo. La suite focalizada final incluye además las diez pruebas existentes de programación: **54 casos aprobados en cuatro archivos**, en 11,17 s. No se declara aprobada la invocación de flujos con errores ni se modifica su resultado por los éxitos de otras suites.

La [lista de archivos](validation/draw-and-bracket-center/changed-files.txt), los [resultados de proceso](validation/draw-and-bracket-center/validation-results.json), las [huellas SHA-256](validation/draw-and-bracket-center/source-hashes.json), su [verificación](validation/draw-and-bracket-center/source-verification.json) y el [estado final de Playwright](validation/draw-and-bracket-center/playwright-last-run.json) identifican la entrega. La documentación se excluye de las huellas para completar después sus resultados. Los registros de desarrollo fallidos y sus trazas permanecen separados. No se añadieron dependencias ni se modificaron motores de simulación, clasificaciones, desempates o la versión JSON.

## Limitaciones y posibles mejoras

- No hay sorteo aleatorio nuevo ni edición de bombos: faltan un modelo estructurado de restricciones y un generador compatible auditado. Se requiere una futura ampliación documental explícita antes de soportarlos, sin inferencias por prestigio, nombre, país o ranking.
- No se crean grupos, plazas, etapas, participantes ni temporadas ausentes. La capacidad registrada es un requisito de la reorganización manual.
- Los formatos especiales conservan sus servicios. La incorporación de participantes entre copas o las progresiones que afectarían encuentros existentes deben resolverse en el flujo deportivo original.
- No se interpreta texto reglamentario libre como una restricción ejecutable ni se certifican documentos externos.
- El generador por grupos se limita a ligas round-robin con calendario vacío. Las copas por grupos o calendarios ambiguos mantienen programación específica pendiente.
- La coordinación usa LocalStorage, recuperación y compensación existentes; no se promete una transacción de varias claves ante la terminación abrupta del proceso.
- La representación de nuevas reglas de localía, ventajas, neutralidad o formatos continentales necesitaría capacidades explícitas del dominio. No se añaden para hacer pasar un sorteo desconocido.

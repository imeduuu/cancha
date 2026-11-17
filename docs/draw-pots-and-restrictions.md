# Bombos y restricciones de sorteos

Este documento conserva la auditoría y los resultados de la implementación inicial del editor. La ampliación posterior de generación local, sus formatos habilitados, presupuestos y limitaciones se documenta en [Generador local con restricciones](constraint-based-group-generator.md).

## Auditoría y alcance

El Centro de sorteos (`draw-and-bracket-center.tsx`), `stage-draw.ts`, `draw-and-bracket.ts` y `prepare-stage-draw.ts` ya registran distribuciones y cruces, pero no contenían bombos estructurados. No se deducen bombos de grupos, tablas, prestigio, campeones o posiciones de pantalla.

| Área | Estructura existente y decisión |
| --- | --- |
| Grupos y participantes | `Team.id` y `Team.groupName` son la única identidad y composición. Los nombres de grupo y capacidades proceden de la distribución registrada, sin persistir una segunda colección de grupos. |
| Etapas | Se reutiliza `@registered-groups`. Las eliminatorias de `knockoutStages` siguen sus servicios específicos; no se inventa un modelo de bombos para ellas. |
| Admisión | `inspectDrawPreparation`, planes continentales y planificación nacional conservan sus verificaciones y dependencias. La lista de IDs de la configuración debe coincidir exactamente con los admitidos actuales. Es una referencia al conjunto existente, no otra lista de equipos. |
| Reglamento anual y partidos | `getCalendarProgrammingBlockers` e integridad verifican temporada, fuentes, estado documental, preparación y dependencias. Las notas libres no se ejecutan. |
| Fuentes | Se reutilizan `OfficialReference`, `RulesVerificationStatus` e `isHttpsReference`. No hay consultas externas ni extracción automática de reglas. |
| Distribución documental | `StageDrawRecord` sigue representando el sorteo confirmado. La nueva configuración representa condiciones previas y nunca lo sustituye. |
| Clasificación y progresión | Tablas, ganadores y progresiones continental, nacional y de divisiones permanecen en sus servicios existentes. Sus formatos restringidos conservan el bloqueo de sustitución manual. |
| Clubes | `Team` tiene ID, nombre, grupo, número de competición, identidad de promedio y afiliación AFA directa/indirecta con fuente opcional. Esa afiliación no es un catálogo verificable de países o asociaciones nacionales. El territorio del catálogo de competiciones tampoco acredita el país de cada club. La separación por asociación queda desactivada y bloqueada. |
| Actividad | Se amplía el historial validado con `draw-configuration-recorded`; no se crea una `OfficialResolution` ni una resolución de desempate. |
| Decisiones | Se añade una categoría distinta, «Bombos y restricciones», solo cuando hay una configuración registrada pendiente antes de su utilización. No se inventan obligaciones de registrar bombos en competiciones sin ellos. |
| Persistencia | El repositorio, respaldo JSON v7, restauración, recuperación y puntos de control ya transportan actividad validada. No hay otra clave de almacenamiento ni cambio de versión del respaldo. |
| Coordinación | `LibraryWriteContext` ejecuta la confirmación bajo el coordinador existente y su Web Lock global `cancha.save-checkpoints`. Los repositorios de producción continúan exigiendo su lease. |

## Modelo y ciclo de revisión

`DrawConfiguration`, versión interna 1, contiene universo, ID persistido de temporada (`tournamentId`), `competitionId`, año, etapa, fundamento, revisión positiva, IDs de participantes, bombos, condiciones explícitas de siembra opcionales, restricciones, procedencia local/documental, revisión documental, fuente opcional y marca opcional de retirada.

Cada bombo contiene ID propio, nombre, capacidad positiva y referencias a `Team.id`. Cada restricción tiene ID estable. No se usan nombres de clubes ni índices de pantalla como identificadores. Una competición sin identidad persistida o temporada registrada no puede confirmar este modelo.

La actividad contiene el registro completo en `after`, con `entityId` igual a la etapa. `isActivityEvent` valida tanto el payload como su coincidencia con temporada, competición y etapa del evento. Los registros ausentes significan «no registrado». La última revisión de la misma temporada, etapa y universo es la vigente. La retirada es una nueva revisión con `deleted: true`, preservando todo el historial anterior.

La consulta y edición son locales en memoria. **Revisar bombos y restricciones** no escribe: crea un token privado vinculado a la identidad y contenido de la revisión y la instantánea de temporadas y actividad. La confirmación expresa se ejecuta mediante el protocolo global de escritura. Se rechazan copias, alteraciones, revisiones consumidas, cambios del universo y cualquier cambio de la instantánea. Bajo el bloqueo se repiten las comprobaciones de identidad, fundamentos, participantes, reglas, dependencias y actividad deportiva antes de añadir el evento. No hay combinación automática de configuraciones.

Se pueden guardar configuraciones incompletas, documentales pendientes o con condiciones declaradas no soportadas para continuar su revisión. Una estructura inválida o incompatible no se guarda. Toda condición pendiente bloquea su uso para confirmar una distribución manual definitiva.

## Editor, bombos y cabezas de serie

La sección **Bombos y restricciones** del Centro permite crear, renombrar, dimensionar y eliminar bombos; asignar o mover participantes mediante selectores; consultar los no asignados; revisar, confirmar, actualizar explícitamente o retirar una configuración sin utilizar. Usa controles nativos de teclado, sin arrastrar y soltar ni dependencias nuevas.

Las cabezas de serie requieren activar explícitamente su presencia en el formato y registrar su condición o referencia. Cada ID debe pertenecer a los admitidos y a un único bombo. Ni el primer participante, ni el campeón, ni el nombre o país otorgan una condición automática. La siembra solo identifica participantes: no impone una ventaja, separación o plaza que no se haya registrado como restricción explícita. Una condición que exceda el catálogo se registra como no soportada.

La vista previa muestra identidad y año, universo, etapa, participantes, bombos y capacidades, cabezas de serie, condiciones, fuente, advertencias y estado. Los grupos y sus plazas siguen visibles junto al editor. La verificación documental es una declaración del usuario; al marcarla verificada debe confirmar expresamente que contrastó los datos. No es una certificación independiente.

## Catálogo cerrado

| Tipo | Semántica |
| --- | --- |
| `group-size` | Mínimo y máximo de un grupo existente. No cambia su capacidad registrada. |
| `pot-distribution` | Cantidad exacta del bombo indicado en **cada** grupo existente. No se presupone una cuota de uno. |
| `incompatible` | Todos los IDs explícitos deben quedar en grupos distintos; es una incompatibilidad mutua entre cada par de la lista. |
| `fixed-position` | Participante en un grupo y una posición ordinal explícita de la propuesta manual. |
| `unsupported` | Condición documental o local todavía no representable; bloquea el uso definitivo. |
| `association` | Contrato reservado y validado como no soportado por ausencia de asociaciones verificables. La interfaz no permite activarlo. |

No se implementan restricciones geográficas implícitas, rankings históricos, lenguajes dinámicos, evaluación de texto, criterios nuevos de siembra ni reglas supuestamente comunes a todas las ediciones de CONMEBOL. La fuente documental es la de la configuración completa; no se afirma que cada restricción tenga una fuente independiente.

## Validación estructural e imposibilidades

`validateDrawConfiguration` distingue **Válida**, **Incompleta**, **Incompatible**, **Datos pendientes** y **Restricción no soportada**, conservando listas separadas de errores y condiciones pendientes incluso cuando coinciden varios estados.

Comprueba identidades de ámbito; igualdad exacta de admitidos; duplicados en participantes, bombos y restricciones; pertenencia de asignaciones y cabezas de serie; capacidades excedidas, insuficientes e incompletas; grupos y plazas existentes; referencias HTTPS; reglas y dependencias del servicio existente; fundamentos desactualizados; referencias de restricciones; límites y cuotas; plazas fijas inexistentes y contradictorias; participantes incompatibles forzados al mismo grupo; más participantes mutuamente incompatibles que grupos; y cuotas que exceden plazas del grupo o del bombo.

No se implementa un solucionador de restricciones ni un generador aleatorio. La ausencia de contradicciones detectables no demuestra que exista una solución global. La advertencia de una configuración estructuralmente válida es exactamente:

> Validación estructural aprobada; viabilidad completa no comprobada

## Distribuciones manuales e historia

El flujo existente de revisión de grupos consulta las condiciones registradas de esa misma etapa y universo. Rechaza configuraciones incompletas, pendientes, desactualizadas o no soportadas y propuestas que violen límites, cuotas, incompatibilidades o posiciones fijas. Si existen posiciones fijas, la interfaz exige que el usuario indique posiciones únicas para todos los participantes de cada grupo; no obtiene esos ordinales del orden de `Team`, de tablas ni de la pantalla.

Un nuevo `StageDrawRecord` puede incluir `configurationRevision`, un entero opcional que vincula la distribución con la revisión utilizada. La revisión de calendario exige esa misma configuración y vuelve a contrastar la distribución. En esta repetición interna admite el cambio de composición de grupos acreditado por el propio sorteo; el fundamento vigente del sorteo, participantes, capacidades, reglas y dependencias se siguen verificando. Las distribuciones históricas sin ese vínculo mantienen su compatibilidad, sin imponer configuraciones retroactivas.

Una vez que existe un sorteo registrado, cualquier encuentro en la temporada de grupos o archivo administrativo, se bloquea la modificación o retirada de su configuración. No se reorganizan grupos confirmados ni se alteran partidos, calendarios, resultados, localías, eliminatorias o eventos anteriores. Los formatos deportivos específicos conservan sus bloqueos anteriores aunque tengan bombos registrados. El botón de sorteo aleatorio permanece deshabilitado.

## Persistencia, recuperación y límites

La revisión se registra con `recordActivity` del repositorio actual. Sus controles de coordinación, escritura, cuotas, recuperación y restauración siguen vigentes. El respaldo completo v7 y los puntos de control incluyen la actividad; exportar solo un torneo no transporta su historial, por lo que debe usarse el respaldo completo para conservar bombos. Los respaldos antiguos sin configuraciones siguen siendo válidos.

No se añaden asociaciones de clubes, rankings, reglas automáticas por edición ni soporte de bombos para eliminatorias. Tampoco se crean grupos o capacidades desde cero. Es una infraestructura para grupos ya registrados; la compatibilidad con un generador futuro exige trabajo adicional explícito. La validación completa de viabilidad queda pendiente de un solucionador apropiado.

## Pruebas y resultados

Las pruebas nuevas están en `configure-stage-draw.test.ts`, `draw-configuration-editor.test.tsx` y los recorridos de bombos de `e2e/cancha.e2e.ts`. Cubren validación, contradicciones, siembra, fuentes, distribución manual, revisiones sin escritura, confirmación explícita, concurrencia bajo Web Locks, cambio de universo, protección de actividad deportiva, exportación/restauración v7, fallos de escritura y puntos de control con integridad.

Los resultados completos de las ejecuciones solicitadas se conservan en `docs/validation/draw-pots-and-restrictions/`. Los fallos de cualquier suite se documentan como fallos, sin aumentar tiempos de espera ni añadir reintentos.

Ejecuciones de desarrollo del 11 de noviembre de 2026:

| Comando | Resultado registrado |
| --- | --- |
| `npm test` | **Falló**: 100 archivos aprobados, 6 fallidos; 1.125 pruebas aprobadas, 7 fallidas, 1.132 totales; 134,33 s. Registro `npm-test.log`. |
| `npm test` final | **Falló**: 104 archivos aprobados, 2 fallidos; 1.133 pruebas aprobadas, 2 fallidas, 1.135 totales; 96,95 s. Ambos fallos son timeouts de 5.000 ms en el primer recorrido de `app-closure` y el recorrido documental de `app-decisions`. Registro `npm-test-final.log`. |
| `npm test -- --maxWorkers=4` | **Aprobó**: 106 archivos, 1.132 pruebas; 131,31 s. Registro `npm-test-maxWorkers4.log`. |
| `npm test -- --maxWorkers=4` final | **Aprobó**: 106 archivos, 1.135 pruebas; 125,66 s. Registro `npm-test-maxWorkers4-final.log`. |
| `npm run test:flows` | **Falló**: 9 archivos aprobados, 1 fallido; 91 pruebas aprobadas, 1 fallida; 59,26 s. Registro `test-flows.log`. |
| `npm run test:flows` final | **Falló**: 9 archivos aprobados, 1 fallido; 91 pruebas aprobadas, 1 fallida; 57,76 s. Timeout de 5.000 ms en el recorrido documental de `app-decisions`. Registro `test-flows-final.log`. |
| `npm run test:e2e` | **Aprobó**: 552 casos, 25,5 minutos, sin reintentos. Incluye 24 casos nuevos de bombos en Chromium, Firefox y WebKit, cada uno en escritorio, notebook, tablet y móvil. Registro `test-e2e.log`. |
| `npm run test:e2e -- --grep bombos --reporter=list` final | **Aprobó**: 24 casos, 2,2 minutos, sin reintentos, con todos los ajustes finales de interfaz. Registro `test-e2e-final-editor.log`. Capturas revisadas: `editor-desktop.png` y `editor-mobile.png`. |
| `npm run build` final | **Aprobó**: comprobación TypeScript y compilación de producción completas. Registro `build.log`. |
| Pruebas focalizadas con un worker | **Aprobaron**: 3 archivos, 58 pruebas; 26,55 s. Registro `focused.log`. |
| `npx tsc -b` | **Aprobó** después de corregir una asignación de prueba a `OfficialReference.url`, propiedad de solo lectura. Registro final `typecheck.log` sin errores. |

En `npm test`, seis fallos son timeouts de 5.000 ms: `app-checkpoints`, el segundo recorrido de `app-closure`, `app-decisions`, recuperación desde el dashboard en `app-journeys`, recuperación en `app.test` y ordenación/filtrado en `match-calendar`. El otro fallo, en el primer recorrido de `app-closure`, no encontró el panel diferido de planificación. En `test:flows` solo falló por timeout el recorrido documental de `app-decisions`. La misma suite completa pasó con cuatro workers; esto no convierte las ejecuciones fallidas en aprobadas ni establece por sí solo la causa de cada fallo. Las pruebas nuevas se investigaron por separado y pasaron. No se modificaron estos casos ajenos ni sus tiempos o reintentos.

Las ejecuciones finales incluyen tres regresiones añadidas después de las primeras suites: protección de encuentros sin sorteo registrado, HTTPS y contraste documental explícito, y compatibilidad de un sorteo histórico ante una configuración importada posterior. De ahí el cambio del total de 1.132 a 1.135 pruebas. La corrección posterior de interfaz también se valida mediante la repetición final de los 24 E2E de bombos.

| Casos solicitados | Cobertura |
| --- | --- |
| 1–6: válida, incompleta, duplicados, inexistentes, capacidad excedida e insuficiente | Servicio de consistencia y rechazo antes de la revisión. |
| 7–8: cabezas de serie | Pertenencia explícita, base declarada y relación con bombos. |
| 9–12: restricción explícita, no soportada, asociación desconocida, contradicciones | Cuotas, incompatibilidades, posiciones fijas, capacidades y contrato no ejecutable de asociación. |
| 13–16: distribución manual, reglas pendientes y fuente provisional | Validación de propuestas compatibles/incompatibles, reglamento anual y estados documentales. |
| 17–21: vista previa, confirmación, obsolescencia, concurrencia y universo | Servicio, interfaz, Web Lock serializado y recorrido real entre pestañas. |
| 22–26: sorteo existente, etapa disputada y conservación | Rechazo con sorteo, partidos programados o resultados; igualdad del torneo y conservación de eventos anteriores. |
| 27–29: v7, restauración y puntos de control | Respaldo completo, repositorio, fallo de cuota sin pérdida, huella SHA-256 y restauración del punto. |
| 30: navegación desde el Centro | App existente y E2E de creación, revisión, rechazo y confirmación desde el acceso de sorteos. |

## Archivos de implementación

- `src/domain/entities/draw-configuration.ts`: modelo y guard de payload.
- `src/domain/entities/activity-event.ts`: acción y validación contextual del evento.
- `src/domain/entities/stage-draw.ts`: vínculo opcional con la revisión utilizada.
- `src/application/services/draw-configuration.ts`: lectura, borrador y validación estructural/manual.
- `src/application/use-cases/configure-stage-draw.ts`: revisión pura y confirmación protegida por el coordinador existente.
- `src/application/use-cases/prepare-stage-draw.ts`: aplicación de condiciones a la distribución y comprobación posterior del vínculo.
- `src/application/services/draw-and-bracket.ts`: fundamento sin recursión de configuraciones y explicación del bloqueo automático.
- `src/application/services/sports-decisions.ts`: proyección diferenciada de condiciones pendientes.
- `src/presentation/components/draw-configuration-editor.tsx`: editor, resumen, fuentes y confirmación.
- `src/presentation/components/draw-and-bracket-center.tsx`: integración y posiciones manuales explícitas.
- `src/presentation/components/activity-history.tsx`: etiqueta de actividad.
- `src/styles.css`: alineación de casillas acotada al nuevo editor.
- `src/application/use-cases/configure-stage-draw.test.ts`, `src/presentation/components/draw-configuration-editor.test.tsx`, `e2e/cancha.e2e.ts`: pruebas.
- Este documento y los registros en `docs/validation/draw-pots-and-restrictions/`.

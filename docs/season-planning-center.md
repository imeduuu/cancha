# Centro de planificación de temporadas futuras

## Auditoría y arquitectura

Se revisaron el Centro de competiciones, sus identidades y antecedentes, la preparación anual, las transiciones de divisiones, los cupos internacionales, los reglamentos, las resoluciones oficiales, las importaciones posteriores de calendarios, el historial de clubes, los borradores y los respaldos v7.

Ya existían tres caminos útiles: `createTournamentSeason`, `createLinkedDivisionSeasons` y la pareja `reviewContinentalEdition` / `confirmContinentalEdition`. Las importaciones de calendarios y la configuración anual continúan en sus paneles existentes. No existía una proyección común que reuniera participantes, dependencias, discrepancias y bloqueos antes de escoger uno de esos caminos.

- `application/services/season-planning.ts` construye una proyección de consulta sobre los torneos y la actividad actuales. Reutiliza `getDivisionTransition`, `seasonOverview`, `seasonOrigins`, la clasificación continental, los perfiles de clubes y la validación de integridad.
- `application/use-cases/plan-season.ts` coordina revisión y confirmación con los casos de uso anteriores. No implementa otra escritura de torneos ni cálculos deportivos.
- `presentation/components/season-planning-center.tsx` presenta filtros, vista previa y confirmación. El panel y el historial se cargan bajo demanda mediante los límites de errores existentes.
- `domain` e `infrastructure` conservan sus reglas, entidades y contratos de persistencia. No se añaden paquetes, bases de datos ni servicios remotos.

El creador genérico recibe una opción final `planningOnly`, desactivada por defecto. Cuando se solicita, prepara solo la nómina: sin calendario, reglamento futuro heredado, plantel, criterios de clasificación o reglas de partidos. Los consumidores anteriores conservan su comportamiento. Se reutiliza `seasonPreparation`, que ya formaba parte del JSON v7 opcional.

## Acceso y funcionamiento

**Biblioteca → Centro de competiciones y temporadas → Planificación de temporadas**.

Selecciona país/confederación, tipo, competición, temporada guardada y año o edición de destino. Los torneos sin metadatos se muestran como tales, incluidos los archivados. No se elige una versión de origen por similitud de nombre. El destino se introduce expresamente: una copa continental puede corresponder al mismo año nacional cuando el flujo existente lo admite; no se impone automáticamente el año siguiente.

Hay tres flujos:

1. **Nómina local sin movimientos automáticos.** Exige proponer expresamente la nómina actual, un origen terminado y un formato admitido por el creador existente. Los participantes se etiquetan como provisionales. Si existen movimientos deportivos registrados, no permite sustituirlos por esta copia genérica. El destino debe ser posterior al origen y no estar guardado.
2. **Transición entre divisiones.** Exige elegir las dos temporadas expresamente. Reutiliza todos los requisitos, resultados, desempates y movimientos del servicio vigente para Argentina/Brasil. Los ascendidos desde categorías inferiores se aportan por el usuario con referencia HTTPS, en la cantidad exigida. No se inventan equipos. El caso existente admite la siguiente temporada anual de sus formatos verificados; esta pantalla no amplía sus reglas a años desconocidos.
3. **Clasificación a edición continental.** Exige elegir temporada nacional, orígenes, Libertadores/Sudamericana, edición, clasificados elegibles, referencia HTTPS y decisión documental. Reutiliza los cupos, reasignaciones, conflictos y procedencias existentes. Permite una nómina local parcial o provisional donde el servicio anterior lo admite; un cupo pendiente o en conflicto no es seleccionable. Si la edición existe, hay que elegirla: la operación registra una revisión documental y conserva su nómina, calendario y resultados.

Las copas nacionales incorporan ahora el flujo de [admisión documentada por edición](national-cup-planning.md), integrado en el mismo creador. Exige criterios, fuentes y participantes suficientes; sin ellos mantiene los bloqueos. No traslada automáticamente los participantes de una copa terminada.

La vista previa es de solo lectura. Consultar, cambiar filtros, navegar o cancelar no crea torneos ni guarda resultados. Para escribir se requiere **Revisar planificación y continuar → Confirmar preparación**. La confirmación vuelve a consultar la biblioteca y ejecuta el caso de uso existente. Una creación coordinada de divisiones mantiene la escritura atómica con actividad; los demás caminos conservan sus escrituras coordinadas con el historial.

## Participantes, procedencia y estados

Cada fila muestra nombre, ID cuando existe, origen, destino, movimiento o cupo, condición confirmada/provisional/pendiente y procedencia. **Confirmado por cálculo** describe el resultado del servicio deportivo; no certifica una nómina oficial ni convierte un escenario simulado en datos de proveedor.

Los estados pueden coexistir:

| Estado | Significado |
| --- | --- |
| Lista para revisión | No hay bloqueos para la operación local elegida. |
| Pendiente de resultados | Los servicios o partidos relevantes mantienen resultados pendientes o inválidos. |
| Pendiente de desempate | Existe un desempate/sorteo pendiente indicado por las reglas o tablas aplicables. |
| Pendiente de reglamento | Falta verificar el origen relevante o el reglamento del destino. |
| Pendiente de participantes | Faltan participantes, hay versiones o diferencias que revisar, cobertura incompleta o relaciones ausentes. |
| Conflicto de identidad | Hay identidades contradictorias, duplicadas o selecciones incompatibles. |
| Dependencia desactualizada | Una revisión ya no coincide con la biblioteca actual. |
| Planificación local | La operación y sus resultados previstos constituyen un escenario local. |

Una planificación puede estar lista para crear una nómina local y seguir pendiente de reglas o de cupos no seleccionados. Los bloqueos concretos se enumeran por separado. No se ignoran para permitir un ascenso, una clasificación o una creación que su caso de uso rechace. Las temporadas futuras quedan sin partidos y con reglamento pendiente; estar operativamente preparadas no habilita su progresión deportiva.

Las eliminatorias se interpretan mediante los servicios existentes. Una final resuelta por penales no se transforma en un empate pendiente de una tabla plana. Tampoco se mezclan las fases de una copa para intentar calcular sus posiciones como liga.

## Dependencias y conflictos

Se distinguen referencias históricas registradas de elecciones expresas para la revisión actual. Se utilizan `seasonPreparation`, `continentalPlans`, las referencias de campeones de copa, los antecedentes del historial y los años configurados para promedios. La selección de otra división crea una asociación prospectiva para revisar el caso; no afirma que antes existiera un vínculo histórico.

Una referencia cuyo torneo ya no está disponible permanece visible. No se reconstruye mediante nombres, país o cercanía de años. Se muestran versiones duplicadas de un origen, el ID elegido y los destinos ya guardados. No se sobrescriben ni se elige uno arbitrariamente.

Los perfiles del historial atribuyen identidades mediante sus relaciones explícitas. La presencia de un mismo club en ambas divisiones, una identidad contradictoria o participantes duplicados impide continuar. Los nombres repetidos se validan también con las restricciones del caso de creación existente. Las discrepancias con un destino se describen como **sin vínculo de identidad**; dos nombres iguales no prueban que sean el mismo club.

La revisión en memoria conserva una copia de la entrada y un snapshot canónico de la biblioteca y su actividad. No admite alterar la revisión ni confirmarla dos veces. Si cambia el estado entre revisión y confirmación, se rechaza la escritura y hay que revisar nuevamente. Es deliberadamente conservador: incluso un cambio ajeno al origen puede exigir otra revisión.

Las proyecciones se reconstruyen al recibir los torneos actualizados. Las revisiones continentales persistidas conservan todo su historial y muestran la vigencia de sus dependencias calculada por `continentalPlanState`. No se actualiza una copa ya creada silenciosamente. Los snapshots de divisiones conservan las referencias que guarda el caso existente, pero no adquieren un nuevo historial documental de dependencias ni una invalidación automática adicional.

Las temporadas planificadas de LPF, Primera Nacional y Série A/B pueden recibir un calendario local con **Generar calendario** cuando aún no tienen partidos. Brasil usa dos ruedas todos contra todos. Las competiciones argentinas requieren exactamente dos zonas registradas y del mismo tamaño; se generan dos ruedas intrazonales y una jornada interzonal por rueda, con parejas por orden de participantes y localía invertida. Si las zonas no quedaron asignadas al crear la temporada, deben configurarse expresamente antes de generar. La operación registra procedencia `local-generated`, no asigna fechas ni afirma que los emparejamientos sean oficiales. Los nuevos cruces quedan disponibles para simulación inmediata.

## Navegación y borradores

Los accesos aparecen sobre los registros disponibles: origen, calendario, tabla/reglamento/pendientes, destino, preparación existente de las divisiones reconocidas y clasificación internacional. Se presentan fuentes de reglamento, resoluciones oficiales, motivos de invalidación, revisiones sucesoras, revisiones continentales y discrepancias de calendarios guardadas.

Cada participante identificado permite abrir el Historial de clubes con su perfil preseleccionado. Las identidades no vinculadas no reciben un perfil inventado. Los enlaces a temporadas preparadas utilizan los registros que devuelve el caso de uso, sin cambiar automáticamente el torneo activo.

Los filtros, selecciones, nóminas aportadas, documentación y perfil consultado utilizan borradores de sesión. Navegar conserva esos borradores y los marcadores sin guardar según el comportamiento anterior. La confirmación revisada es efímera y debe solicitarse de nuevo tras desmontar el panel; una recarga inicia otra sesión. Ningún borrador se agrega al respaldo.

Los controles adaptan sus columnas a ventanas pequeñas y los textos largos admiten saltos. Se usan etiquetas y controles nativos, el diálogo existente y los estados de carga/error diferidos. No hay una biblioteca nueva de gráficos o interfaz.

## Persistencia y límites

Se mantiene JSON **versión 7**. La implementación inicial reutiliza `seasonPreparation`, `continentalPlans` y la actividad existente. La ampliación de [copas nacionales](national-cup-planning.md) añade únicamente su registro documental opcional, sin cambiar la versión 7. Los respaldos antiguos sin esos campos siguen siendo válidos. Las temporadas originales, resoluciones, resultados, planteles y calendarios no se modifican por consultar o crear una planificación.

El Centro no consulta proveedores ni importa calendarios automáticamente. Una futura importación se realiza desde el flujo existente, con sus diferencias de participantes y confirmaciones. Tampoco descarga ni certifica el contenido de una URL documental; HTTPS y una confirmación del usuario no equivalen a certificación federativa.

Las limitaciones de identidad de las transiciones anteriores se mantienen: el caso de divisiones genera IDs nuevos y algunos antecedentes solo guardan nombres. Sin una relación explícita adicional, el Centro informa participantes sin vínculo, aunque sus nombres coincidan. Los aportados desde categorías inferiores son provisionales y no adquieren una identidad histórica por su texto.

No se inventan dependencias nacionales, reglas futuras, periodicidades, participantes de copa, grupos, cruces, sorteos, resultados ni fechas. Una ausencia de datos no acredita una clasificación oficial. Las pruebas utilizan exclusivamente fuentes sintéticas aisladas.

## Validación

```powershell
npm test
npm run test:flows
npm run test:e2e
npm run build
```

Las pruebas nuevas cubren proyecciones sin escritura, confirmación explícita, revisiones alteradas/desactualizadas, creación coordinada de divisiones, cupos confirmados/provisionales/pendientes, escenarios combinados de liga y copa, identidad estricta, homónimos, duplicados, destinos existentes, reglas pendientes, restauración v7 y conservación del comportamiento anterior del creador.

La interfaz se comprueba para borradores, cancelación, navegación y rechazo de revisiones desactualizadas. Los tres recorridos nuevos de navegador realizan la preparación local sin calendario, una edición continental con modificación concurrente del origen y la creación conjunta de divisiones. Se comprueba el almacenamiento aislado antes de confirmar y la conservación de los torneos anteriores después de confirmar.

### Resultados definitivos — 28 de octubre de 2026

| Comando ejecutado | Resultado |
| --- | --- |
| `npm test` | **793 pruebas aprobadas en 78 archivos**, 61,16 s, configuración normal. |
| `npm run test:flows` | **62 pruebas aprobadas en 5 archivos**, 31,30 s. |
| `npm run test:e2e -- --workers=3` | **276 pruebas aprobadas**, 10,6 min, sin reintentos. |
| `npm run build` | **Correcto**, TypeScript y Vite, sin aviso de tamaño. |

Se añadieron **25 pruebas unitarias/de integración** (20 de aplicación y 5 de interfaz) y **tres recorridos E2E**, ejecutados en los doce proyectos: **36 comprobaciones nuevas** de navegador. La suite completa incluye las 240 comprobaciones anteriores. La selección previa de los tres nuevos recorridos también aprobó en Chromium móvil. Las 37 pruebas enfocadas de planificación y preparación anterior aprobaron antes de ejecutar la suite general.

Se ejecutaron Chromium, Firefox y WebKit en escritorio **1440×900**, notebook **1366×768**, tablet **768×1024** y móvil **390×844**. Son perfiles de navegador reales con resoluciones representativas; no son dispositivos físicos. No se detectaron errores inesperados de consola/solicitudes ni desbordamiento horizontal del documento en estos recorridos. Los casos anteriores que provocan deliberadamente un fallo de módulo conservan su comprobación específica de recuperación. Se revisaron las capturas nuevas de escritorio y móvil; el informe HTML y las capturas de Playwright corresponden a la suite completa de 276 pruebas.

El fragmento diferido del Centro mide **16,21 kB** (**4,86 kB gzip**). El JavaScript principal mide **393,41 kB** (**113,10 kB gzip**). No se añadieron dependencias ni se aumentó el límite de advertencia de Vite.

Toda la verificación utilizó contextos aislados, datos sintéticos deterministas y el servidor local dedicado. No se consultaron proveedores ni se acreditó información federativa, no se utilizó Cloudflare y no se accedió a la biblioteca personal. Las correcciones durante la validación se limitaron a tipados y al repositorio ficticio de la preparación E2E; no se relajaron validaciones deportivas o de persistencia.

En esta etapa inicial permanecían las copas nacionales sin un flujo de admisión documentada; su ampliación se recoge abajo. Siguen siendo límites los metadatos ausentes, identidades históricas no reconstruibles y calendarios/reglamentos futuros pendientes. Los destinos guardados no se actualizan automáticamente.

## Ampliación posterior: copas nacionales

La preparación por reglamentos de admisión expresamente registrados y sus validaciones actuales se documentan en [Preparación de futuras ediciones de copas nacionales](national-cup-planning.md). Los resultados de 793 pruebas y 276 E2E anteriores corresponden a la etapa inicial del Centro; el informe de la ampliación registra la validación actual.

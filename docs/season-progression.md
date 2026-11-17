# Progresión encadenada de temporadas

El Centro de competiciones y temporadas incluye el asistente de progresión.
Selecciona IDs concretos de temporadas (incluidas archivadas). La selección se
conserva en la sesión de interfaz; no modifica JSON v7 ni los respaldos.
Las temporadas consultadas pertenecen al universo activo (o a la biblioteca
anterior sin asignar); las dependencias de otros universos no se incorporan.

## Arquitectura y funcionamiento

season-progression.ts es una proyección de consulta. Reutiliza seasonOverview,
las alertas deportivas, la clasificación continental y la verificación de
revisiones nacionales y continentales. Proyecta siete etapas por temporada.
Disponible significa que se puede consultar o revisar el paso; nunca sustituye
la autorización del caso de uso de escritura. Pendiente requiere trabajo o
selección del usuario; Bloqueada señala datos previos insuficientes.

Las dependencias se extraen de seasonOrigins (incluido el historial antiguo),
fuentes de campeones internacionales, planes continentales y criterios y
revisiones de admisión nacional. No se enlazan divisiones por nombre o año.
Una pareja futura se elige explícitamente en el Centro de planificación.
Las referencias ausentes siguen visibles; seleccionar dos competiciones no
crea una relación deportiva. Las temporadas pueden avanzar por separado.

El panel delega calendario y simulación al calendario existente; tablas y
resoluciones al centro de pendientes; importación, reglamentos y preparación a
la temporada existente. Incorpora los accesos actuales al Centro de planificación
y clasificación continental. No ofrece un editor adicional.

## Escritura y seguridad

El asistente no escribe. Las creaciones siguen reviewSeasonPlanning y
confirmSeasonPlanning: revisión explícita, comprobación de integridad de la
revisión, snapshot actual de biblioteca y actividad y nueva validación antes de
escribir. Los creadores conservan rechazo de destinos existentes y guardados
coordinados con actividad. Los planes documentales de ediciones ya existentes
siguen sus confirmaciones y no reemplazan participantes ni resultados.
Una creación de divisiones usa el guardado múltiple existente.

No se simula al abrir, seleccionar o consultar. Para simular se debe navegar al
calendario y elegir expresamente alcance y confirmación en el flujo existente.
No se generan calendarios ni resultados desde esta proyección.
El historial reutiliza ActivityHistory, filtrado por IDs seleccionados y
temporadas derivadas explícitas; no atribuye autoría al asistente.

## Límites

No determina reglamentos nuevos ni periodicidades; las transiciones verificadas
conservan sus límites deportivos y temporales existentes. No permite ejecutar
todas las etapas de varias temporadas con una sola confirmación.
Los respaldos antiguos sin referencias o actividad no acreditan continuidad.
Una temporada sin calendario queda bloqueada para jugar, aunque pueda abrirse
para importar y revisar reglamentos. Los escenarios locales conservan su
procedencia. Ningún estado acredita resultados oficiales.

## Validación

Las pruebas nuevas cubren dependencias explícitas y ausentes, selección sin
inferencias, avance parcial, calendarios faltantes, navegación sin simulación,
creación confirmada, destino existente, historial, escenario local y rollback
ante fallo al guardar actividad. Las suites existentes mantienen pruebas de
simulación explícita, transiciones, creación coordinada y compatibilidad v7.
Resultados finales:

| Comando | Resultado |
| --- | --- |
| `npm test` (repetición final con `--maxWorkers=4`) | 82 archivos, 829 pruebas aprobadas |
| `npm run test:flows` | 5 archivos, 62 pruebas aprobadas |
| `npm run test:e2e` | 300 casos aprobados, 13,2 minutos |
| `npm run build` | TypeScript y Vite aprobados |
| `npm run test:e2e -- --grep "asistente de progresión"` | 12 casos aprobados sobre la compilación final |

Los 11 casos específicos de las dos suites nuevas también pasaron.
La prueba E2E se ejecuta en Chromium, Firefox y WebKit, con tamaños desktop,
notebook, tablet y mobile. Comprueba selección, consulta sin escritura ni
simulación y navegación al calendario.

La primera ejecución simultánea de varias suites presentó timeouts en pruebas
existentes y un selector incorrecto en una prueba nueva. Se corrigieron los
fixtures y selectores nuevos y se repitieron las validaciones anteriores hasta
obtener estos resultados. No se cambiaron los límites temporales de las pruebas.

La etapa de continuación consulta las ediciones derivadas explícitas y sus
propios reglamentos y calendarios. Los partidos pendientes de una edición ya
configurada no impiden comenzarla. Una incorporación continental se reconoce
por el modo registrado `incorporated`; un plan `review` por sí solo no acredita
una creación. Los eventos de creación conjunta se incluyen cuando identifican
expresamente una temporada seleccionada mediante `after.tournamentIds`.

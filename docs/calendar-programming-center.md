# Centro de programación de calendarios

## Arquitectura

`CalendarProgrammingCenter` es la interfaz común del Centro de competiciones, la planificación de temporadas, el dashboard del universo y el calendario activo. Trabaja únicamente con temporadas del universo activo. `program-season-calendar.ts` prepara propuestas inmutables en memoria, revisa integridad y dependencias y las confirma mediante el repositorio existente y `saveWithActivity`; no introduce otro almacenamiento ni motor de competición.

La vista previa no escribe datos. La confirmación compara el torneo, las dependencias de la preparación y el universo activo con sus valores actuales, vuelve a validar el calendario y registra la operación en la actividad. Un cambio posterior a la vista previa obliga a revisarla.

## Generadores y formatos

- **Generación automática local:** reutiliza `generateRoundRobinSchedule` de `domain/services/round-robin-scheduler.ts`. Solo admite una liga sin grupos; cantidad de ruedas entera entre 1 y el límite ya definido por el dominio (20). La selección explícita de ruedas y la confirmación registran el formato local en la misma escritura del calendario.
- **Programación manual:** agrega jornadas/encuentros que usan equipos ya registrados y se validan con `validateTournamentIntegrity` y `validateFixturePairings`. Se permiten fases por etapas solo cuando el torneo registra esas etapas y sus reglas de ida/vuelta. No se agrega un generador alternativo.
- **No soportado automáticamente:** copas, formatos por grupos, formatos desconocidos, reglas pendientes y reglamentos de partido pendientes o de otra temporada. No se infieren sorteos, cruces, etapas, reglas continentales o nacionales. Para esos casos, la generación automática queda bloqueada con una explicación.

## Validaciones y protección de datos

Se requiere temporada preparada, al menos dos participantes con identidades únicas, reglas anuales verificadas y fuentes/notas registradas. El generador existente comprueba cantidad de ruedas e identidades. La integridad del torneo valida referencias a clubes, duplicados, conflictos de localía por jornada, cruces repetidos y reglas de etapas. Se revisan dependencias de preparación dentro del universo activo.

La generación no reemplaza calendarios que ya tengan partidos; los resultados, eventos, alineaciones, decisiones oficiales y demás actividad permanecen intactos. Una propuesta manual solo agrega encuentros y se rechaza si produce conflictos. No se asignan fechas, horarios, sedes ni estadios automáticamente.

## Procedencia

`calendarProvenance` identifica calendarios oficiales importados, calendarios locales generados y calendarios locales registrados manualmente. Cada encuentro también puede identificar su procedencia para que una adición manual no haga pasar por oficial o local el calendario previo. Las fechas conservan `schedule.provenance`; las modificaciones de fecha realizadas en el editor existente se etiquetan como locales y las fechas importadas como oficiales. Los respaldos anteriores sin estos campos mantienen su lectura mediante la inferencia histórica de la fuente y el torneo.

Los campos nuevos son opcionales y compatibles con la estructura JSON v7 existente; la versión del respaldo no cambia. Los guardados coordinados y la recuperación continúan usando `LocalStorageTournamentRepository`.

## Integración deportiva

El calendario y el editor existentes consumen los encuentros guardados. Las estadísticas, tabla, partidos pendientes, dashboard y progresión encadenada se proyectan con los servicios actuales. El registro del calendario no simula partidos ni modifica reglas de clasificación, movimientos o desempates.

## Limitaciones pendientes

- No hay generación automática de copas, fases eliminatorias, grupos ni torneos nacionales/continentales.
- La programación manual no infiere sorteos, clasificados ni descansos reglamentarios. Los descansos visibles se derivan únicamente de la propuesta round-robin generada.
- El modelo actual no registra restricciones adicionales de localía por club ni asignaciones de estadio; se validan las restricciones estructurales del calendario existente.
- La verificación de fuentes y reglas es una declaración/revisión del usuario; Cancha no certifica documentos externos.
- Los respaldos antiguos no permiten atribuir retrospectivamente la procedencia de cada encuentro o fecha.

## Pruebas

La suite de casos cubre temporadas preparadas sin calendario, generación round-robin local, formato/grupos no soportados, reglamento pendiente, participantes insuficientes o duplicados, conflictos de localía y cruces, propuestas sin escritura, confirmación obsoleta, cambio de universo, calendario con resultados, conservación de calendario oficial al agregar manualmente, round-trip de respaldo JSON v7, navegación al calendario, dashboard y progresión.

- `npm run build`: aprobado.
- `npm run test -- --maxWorkers=4`: 86 archivos y 876 pruebas aprobadas.
- Las invocaciones predeterminadas de `npm test` / `npm run test` fueron intermitentes en este entorno: hubo ejecuciones completas verdes (86/876), pero también timeouts de UI de 5 s con la configuración que inicia 86 workers aislados en paralelo. Las mismas pruebas focalizadas pasan y la suite completa pasa limitando los workers a 4; por eso el modo predeterminado no se declara consistentemente verde.

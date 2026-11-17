# Panel principal de universos deportivos

## Alcance

El panel es una vista de consulta del universo activo. Tiene accesos desde la
Biblioteca y el Centro de competiciones, y también funciona con un universo
vacío y con la biblioteca anterior «sin asignar». Los datos que recibe se
vuelven a limitar al universo seleccionado antes de proyectarse; competiciones,
actividad y dependencias de clasificación de otros universos no se agregan.

No se introducen nuevos formatos de respaldo, persistencia, reglas deportivas,
resultados ni simulaciones. Las únicas acciones del panel navegan a flujos ya
existentes.

## Datos reutilizados

- `tournamentsInUniverse` y `activityInUniverse` aplican el alcance y mantienen
  los eventos antiguos solo cuando existe una referencia explícita suficiente.
- `groupCompetitions` agrupa competiciones; `getTournamentCompletionStatus`,
  `calculateTournamentStatistics` y `getUnresolvedStandingsTieDetails` proveen
  estados, partidos y posiciones sin recalcular reglas.
- `getCompetitionAlerts` expone bloqueos y pendientes existentes. Los datos de
  preparación se leen de la temporada y sus planes guardados.
- `calculateInternationalQualifications` y `continentalPlanState` muestran
  estados de clasificación o dependencias locales ya calculados. Un cálculo o
  una planificación local no se presenta como certificación oficial.
- La procedencia se deriva del proveedor registrado y de `seasonOverview`.

El resumen distingue competiciones agrupadas de temporadas individuales. Los
contadores de en curso, terminadas y pendientes de configuración cuentan
competiciones agrupadas del universo; «terminadas» requiere que todas sus
temporadas estén finalizadas. El contador de preparadas cuenta temporadas.
Una competición queda pendiente de configuración si alguna temporada no tiene
participantes suficientes, calendario o una alerta existente de
reglamento/calendario.

Las posiciones solo aparecen cuando hay partidos válidos disputados. Se
etiquetan como tabla provisional o como posiciones verificadas según el
reglamento registrado y el estado de finalización. Las clasificaciones
internacionales pendientes muestran sus motivos conocidos; el panel aclara que
no certifica resultados ni cupos oficiales.

## Calendarios y navegación

Los encuentros pendientes con una fecha válida se presentan ordenados por esa
fecha registrada. Los encuentros sin fecha conservan la fase o jornada indicada
por el calendario, sin inventar fechas ni priorizar partidos. Cada tarjeta y
encuentro permite abrir la competición, calendario o alertas originales.

Las recomendaciones se generan a partir de partidos pendientes/incompletos,
desempates no resueltos, alertas, reglas de clasificación y capacidades de
planificación reconocidas por los servicios existentes. Abren el calendario,
alertas, clasificación, planificación o importador existente. No simulan,
guardan ni crean temporadas desde el panel.

Las selecciones de apertura y los flujos solicitados usan claves de sesión por
universo. Cambiar de universo descarta el panel abierto y actualiza sus
consultas; al abrir una recomendación del Centro, se selecciona la competición
del mismo universo antes de mostrar el flujo correspondiente.

## Validación

Las pruebas cubren universo vacío, bibliotecas antiguas sin asignaciones,
aislamiento entre universos y eventos, IDs locales de clubes repetidos,
estadísticas/posiciones provisionales, temporadas preparadas, fechas reales y
partidos sin fecha, navegación a calendario y planificación, cambio de
universo y ausencia de escrituras de resultados desde el dashboard.

### Resultados

- `npm test`: una ejecución tuvo 1 fallo (856/857); el flujo de aplicación
  agotó su espera al cargar el panel diferido de partidos mientras el DOM aún
  mostraba «Cargando partidos…». El caso aislado pasó y la repetición completa
  pasó: 85 archivos y 857 pruebas. No se modificaron esperas ni reintentos para
  esta suite.
- `npm run test:flows`: una ejecución concurrente con `npm test` tuvo 1 fallo
  (66/67) al esperar el panel diferido de estadísticas. La repetición serial
  pasó (5 archivos, 67 pruebas), al igual que la ejecución serial final
  (5 archivos, 67 pruebas). La causa del fallo concurrente no quedó probada.
- `npm run build`: aprobado.
- `npm run test:e2e`: una ejecución previa aprobó 300/300. Otra tuvo 298/300;
  dos casos Firefox expiraron esperando `networkidle` en `seed`. El trace
  mostraba la aplicación renderizada y los recursos locales con respuesta
  correcta, pero no permitió identificar una petición bloqueante. Se reemplazó
  la espera de inactividad por una comprobación del estado visible de la
  aplicación, sin ampliar tiempos ni añadir reintentos. Los dos casos pasaron
  aisladamente. Una primera selección del indicador «Biblioteca» falló en los
  12 proyectos de un flujo con biblioteca vacía; se cambió al enlace de inicio,
  que existe en ambos estados, y el caso focalizado pasó. La ejecución E2E
  completa final aprobó 300/300 en 20,5 minutos, sin reintentos.

El fallo de carga de panel observado anteriormente en WebKit no se reprodujo
en la ejecución completa previa (300/300) ni en la ejecución final (300/300),
incluidos los proyectos WebKit. La evidencia apunta a una condición de espera
E2E inadecuada, no a un defecto funcional del dashboard; no se pudo determinar
qué evento de red impidió `networkidle` en los dos casos Firefox. Ningún fallo
se ocultó con reintentos ni se aumentaron timeouts.

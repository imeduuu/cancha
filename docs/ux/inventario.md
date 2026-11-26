# Inventario de experiencia actual

Revisión de `apps/web/src/presentation` según la guía de presentación de `CLAUDE.md`. Este documento describe lo que existe hoy; no propone cambios de código.

## Vistas, paneles y centros

| Vista o panel | Cómo se llega | Qué hace | Acciones disponibles |
|---|---|---|---|
| Biblioteca de torneos | Inicio, botón **Biblioteca** de la barra superior (`app.tsx:1323`) | Reúne torneos guardados y permite encontrar, abrir y organizar temporadas. | Crear torneo; buscar, filtrar y ordenar; abrir, duplicar, renombrar o eliminar; comparar temporadas; importar/exportar; administrar universos y respaldos. |
| Crear campeonato | **Crear torneo** en la barra superior o **Crear torneo** en la biblioteca (`app.tsx:1326`, `tournament-library.tsx:579`) | Permite importar una competición disponible o definir una personalizada. | Elegir una fuente e importar; configurar participantes, formato y desempates; guardar y abrir el torneo. |
| Torneo activo / resumen | Abrir una temporada desde la biblioteca | Muestra el estado del campeonato, próximos partidos, controles de simulación, tablas y estadísticas. | Elegir etapa o rueda; simular partidos, etapa/rueda o campeonato; abrir calendario, alertas, programación, historial y secciones estadísticas. |
| Calendario | En el torneo, **Centro de calendario** (`app.tsx:1530-1536`) | Presenta las fechas y partidos de la temporada. | Consultar fechas y resultados, navegar a partidos, registrar/editar resultados y consultar enfrentamientos directos cuando estén disponibles. |
| Programación del calendario | **Programar calendario** desde el torneo o centro de programación (`app.tsx:1538-1545`) | Permite preparar fechas y horarios para los partidos. | Revisar la propuesta, ajustar la programación, confirmar y volver al calendario. |
| Alertas de competición | **Centro de alertas** desde el torneo o una tarjeta de la biblioteca (`app.tsx:1561-1569`, `tournament-library.tsx:1465-1467`) | Reúne asuntos pendientes y alertas de una temporada. | Abrir el partido o calendario relacionado, revisar estadísticas o reglamentos y volver al torneo. |
| Historial de actividad | **Historial de actividad** en el torneo (`app.tsx:1568`) | Muestra cambios registrados, con filtros por competición, temporada o partido. | Filtrar y cerrar el historial. |
| Centro de competiciones y temporadas | Biblioteca, botón desplegable de competiciones (`tournament-library.tsx:774-778`) | Ordena y agrupa temporadas para compararlas y administrarlas. | Cambiar vista, buscar, filtrar, ordenar, comparar temporadas y abrir/crear temporadas. |
| Centro de guardado y recuperación | Biblioteca o panel del universo (`tournament-library.tsx:626-640`, `sports-universe-dashboard.tsx:73-75`) | Permite revisar respaldos y recuperar información guardada. | Exportar respaldo completo o por universo; importar respaldo; restaurar datos y recuperar una copia disponible. |
| Panel del universo deportivo | Biblioteca, al elegir un universo (`sports-universe-dashboard.tsx:64`) | Resume las competiciones, partidos pendientes, actividad y acciones sugeridas del universo. | Abrir torneos, calendarios y alertas; programar calendarios; entrar a recuperación. |
| Administración de universos | Selector de universo de la biblioteca (`sports-universe-controls.tsx:92`) | Crea, cambia, renombra, elimina y asigna torneos a universos. | Seleccionar universo, crearlo, editar nombre, asignar o quitar torneos y eliminarlo si corresponde. |
| Decisiones deportivas | **Más herramientas → Decisiones deportivas** (`app.tsx:1335`) | Revisa decisiones pendientes, resoluciones documentales, dependencias y sus efectos. | Filtrar decisiones; abrir calendario, sorteos, simulación, cierre o planificación; revisar y confirmar una resolución admitida; consultar historial. |
| Sorteos y cruces | **Más herramientas → Sorteos y cruces** (`app.tsx:1337`) | Administra sorteos y cuadros de eliminación para torneos compatibles. | Elegir torneo, configurar/revisar sorteo o cruces, confirmar cambios, abrir calendario o simulación. |
| Archivo histórico | **Más herramientas → Archivo histórico** (`app.tsx:1338`) | Consulta temporadas y antecedentes guardados y permite continuar flujos históricos. | Abrir temporada, calendario, cierre, planificación, clasificación o competiciones. |
| Cierre de temporada | **Más herramientas → Centro de cierre** (`app.tsx:1339`) | Comprueba resultados, ascensos/descensos, cupos y bloqueos antes de dar por terminada una temporada. | Elegir temporada, revisar alertas y calendario, confirmar cierre cuando esté habilitado y preparar la edición siguiente. |
| Simulación | **Más herramientas → Centro de simulación** (`app.tsx:1340`) | Ejecuta o revisa simulaciones para una temporada o un conjunto de temporadas. | Elegir alcance, simular, revisar temporadas y alertas, abrir calendario y cerrar. |
| Planificación de temporadas | Desde cierre, archivo o decisiones (`season-planning-center.tsx:39-41`) | Prepara una vista previa de participantes y destino para una temporada futura. | Elegir origen, destino y tipo de preparación; revisar participantes; abrir historial de clubes o temporada; enviar a programación cuando aplique. |
| Resumen de competición | Seleccionar el resumen de una tarjeta en la biblioteca (`tournament-library.tsx:1352`) | Muestra posiciones, eliminatorias, próximos partidos y últimos resultados de una temporada. | Cerrar resumen; abrir torneo, calendario o alertas. |
| Cuenta y acceso | **Cuenta** en la barra superior (`account-access.tsx`) | Permite iniciar o crear cuenta y administrar la sesión y enlaces compartidos. | Ingresar, crear cuenta, cerrar sesión, compartir torneo y revocar enlace. |
| Migración de biblioteca | Al entrar con cuenta si hay datos locales pendientes (`account-migration.tsx:63-105`) | Ofrece copiar la biblioteca de este navegador a la cuenta. | Agregar o reemplazar datos, confirmar reemplazo o continuar sin migrar. |
| Estadísticas | Panel del campeonato (`tournament-statistics-panel.tsx:58`) | Resume estadísticas de equipos, goleadores y jugadores. | Elegir temporada, fase o grupo; editar nóminas y reglamentos cuando corresponda. |
| Preparación de temporada | Panel del torneo en temporadas futuras (`app.tsx`, render condicional tras estadísticas) | Reúne la preparación previa de una temporada y los datos disponibles. | Revisar y guardar la preparación según el flujo habilitado. |
| Ascensos y segunda división | Panel del torneo cuando la competición es compatible (`app.tsx`, condición `secondKind`) | Revisa la relación entre divisiones y prepara los cambios deportivos admitidos. | Revisar posiciones, movimientos y temporada vinculada; crear temporadas cuando se cumplan las condiciones. |
| Historial del club | Acceso desde asociaciones, planificación o tarjetas de club (`club-history-panel.tsx`) | Consulta apariciones, títulos y trayectoria de un club. | Cambiar club/temporada y recorrer el historial disponible. |
| Asociaciones y afiliaciones | Herramienta de asociaciones en la barra o desde sorteos (`club-associations-access.tsx`, `club-associations-manager.tsx:35`) | Registra asociaciones y la relación de un participante con una asociación para una temporada. | Registrar/revisar asociación o afiliación, documentar fuente, revisar y confirmar el registro. |
| Incidencias de fuentes | Dentro de las revisiones de temporada y decisiones (`source-incidents-panel.tsx:95`) | Permite documentar una corrección asociada a un partido importado. | Seleccionar partido, corregir datos, añadir fuente y motivo, confirmar y registrar revisión. |
| Comparación de enfrentamientos | Desde calendario o historial de temporada (`head-to-head-panel.tsx`) | Compara partidos entre dos equipos. | Elegir equipos y consultar los encuentros; cerrar comparación. |
| Detalle de partido | Seleccionar un partido en calendario (`match-details-panel.tsx`) | Muestra información y actividad del encuentro. | Consultar detalle, editar resultado si está permitido y cerrar. |
| Reglamentos del partido | Panel de estadísticas/torneo (`match-regulations-editor.tsx`) | Consulta y edita las reglas y criterios de desempate de la competición. | Elegir criterios, guardar y revisar el efecto en la tabla. |
| Nómina de jugadores | Panel de estadísticas (`player-roster-panel.tsx`) | Administra jugadores asociados a los equipos. | Añadir, editar o quitar jugadores y guardar. |
| Clasificación internacional | Desde cierre, decisiones o planificación (`continental-qualification-panel.tsx`) | Revisa participantes y cupos de una competición continental. | Seleccionar orígenes y edición, revisar clasificación y confirmar la preparación admitida. |
| Formulario de torneo | **Crear campeonato personalizado** (`setup-tournament-form.tsx`) | Configura una competición nueva con equipos y reglas. | Completar campos, elegir formato/desempate y crear torneo. |
| Importar torneo oficial | **Importar campeonato** en Crear torneo (`import-official-tournament.tsx`) | Busca una competición disponible para importar sus datos. | Elegir competición y temporada, consultar fuente y ejecutar importación. |

Los paneles condicionales (por ejemplo, nómina, incidencias, segunda división y clasificación internacional) solo aparecen cuando el tipo, la temporada o los datos del torneo los habilitan.

## Textos visibles con jerga técnica o interna

Las propuestas son alternativas de redacción simple; se documentan los textos actuales sin cambiarlos.

| Texto actual | Archivo y línea | Propuesta simple |
|---|---|---|
| «Centro de cierre» | `app.tsx:1339` | «Revisar y cerrar temporada» |
| «Centro de simulación» | `app.tsx:1340` | «Simular temporadas» |
| «Centro de calendario» | `app.tsx:1536` | «Ver calendario» |
| «Centro de alertas» | `app.tsx:1561` | «Pendientes de la temporada» |
| «Centro de competiciones y temporadas» | `tournament-library.tsx:775` | «Competiciones y temporadas» |
| «Centro de guardado y recuperación» | `tournament-library.tsx:633,640` | «Copias y recuperación» |
| «Centro de programación de calendarios» | `season-planning-center.tsx:41` | «Programar calendarios» |
| «Operativos» | `tournament-statistics-panel.tsx:120` | «Partidos» |
| «minitabla completa (legado)» | `packages/core/src/domain/value-objects/tie-breaker.ts:12` | «Enfrentamientos directos entre los equipos empatados» |
| «biblioteca JSON v7» | `source-incidents-panel.tsx:97` | «copia de seguridad» |
| «No existe ese estado en el modelo» | No se encontró como texto literal en `apps/web/src/presentation` ni en `apps`/`packages`; si aparece, confirmar su origen antes de atribuirlo a una vista actual. | «Ese estado todavía no está disponible» |
| «Proveedor sin certificación oficial» | `club-history-panel.tsx:11` muestra «Datos de proveedor sin certificación oficial» | «Datos externos sin verificar» |
| «No disponible en este universo» | `season-closure-center.tsx:91` | «No está incluida en este grupo de torneos» |
| «Resoluciones desactualizadas» | `sports-decisions-center.tsx:39` | «Revisiones que necesitan actualizarse» |
| «Dependencias explícitas» | `sports-decisions-center.tsx:49` | «Temporadas relacionadas» |
| «Alertas operativas de consulta» | `sports-decisions-center.tsx:50` | «Avisos para revisar» |
| «Escenario local, editado o simulado» | `club-history-panel.tsx:11` | «Datos creados o modificados aquí» |
| «Procedencia no acreditada» | `club-history-panel.tsx:11` | «Origen sin confirmar» |
| «Estados operativos pendientes» | `tournament-library.tsx:1368` | «Partidos pendientes» |
| «Registrar resoluciones soportadas» | `sports-decisions-center.tsx:46` | «Registrar una decisión disponible» |
| «ID estable» / «ID del torneo» | `club-associations-manager.tsx:50`, `account-panel.tsx:67` | «Código del torneo» |

## Controles de la vista principal

La vista principal es el tablero de un torneo abierto, definido en `app.tsx` y compuesto por secciones que aparecen según el torneo y su estado. La cuenta exacta cambia con el número de fechas, equipos, tablas y acciones que se muestran; por eso el recuento es una estimación del tablero cargado, no un total fijo de la aplicación.

| Control visible | Cantidad aproximada |
|---|---:|
| Botones | 35 |
| Selectores (`select`) | 27 |
| Campos de entrada (`input`) | 33 |

El total incluye los controles de las secciones visibles del torneo y puede variar al cambiar de temporada, abrir paneles o mostrar formularios condicionales. No incluye controles ocultos en otras vistas ni elementos que solo aparecen después de una interacción.

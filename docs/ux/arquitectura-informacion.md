# Arquitectura de información

## Principios de navegación

- La navegación global se mantiene visible y contiene **Mis torneos · Crear torneo · Cuenta**.
- Al abrir una temporada se muestra una navegación propia del torneo: **Resumen · Partidos · Tabla · Estadísticas · Plantel · Herramientas**.
- Las pestañas siguen el recorrido más común: entender el estado, consultar los partidos, revisar posiciones y rendimiento, y administrar jugadores. Las herramientas menos frecuentes quedan agrupadas aparte.
- Las seis pestañas pertenecen al mismo torneo y temporada seleccionados. Las rutas hijas conservan ese contexto; cada vista secundaria permite volver a su sección de origen.
- **Herramientas** funciona como índice agrupado por tareas. Allí se trasladan «Más herramientas» y estos cuatro accesos de la barra del torneo: calendario, programación del calendario, alertas e historial de actividad.
- Las rutas detalladas de este documento describen el destino completo de la arquitectura; las rutas principales conectadas hoy y su alcance están en [Enrutamiento de la web](./enrutamiento.md).
- En 360 px las pestañas pueden desplazarse horizontalmente con teclado y lector de pantalla; los controles deben conservar nombres accesibles y una indicación visible de la sección activa.

## Mapa de navegación

```text
/
├── /torneos                                      Mis torneos (biblioteca)
│   ├── /torneos/competiciones                    Competiciones y temporadas
│   ├── /torneos/universos/:universoId             Panel del universo
│   ├── /torneos/universos                         Administrar universos
│   ├── /torneos/copias                            Copias y recuperación
│   ├── /torneos/:torneoId/resumen-competicion     Resumen de una tarjeta
│   └── /torneos/:torneoId/resumen                 Abrir temporada
├── /torneos/crear                                 Elegir cómo crear/importar
│   ├── /torneos/crear/importar                    Importar competición oficial
│   └── /torneos/crear/personalizado               Formulario de torneo
├── /cuenta                                        Cuenta y acceso
├── /torneos/:torneoId/resumen                     Pestaña Resumen
├── /torneos/:torneoId/partidos                    Pestaña Partidos
│   ├── /torneos/:torneoId/partidos/:partidoId     Detalle de partido
│   └── /torneos/:torneoId/enfrentamientos         Comparación directa
├── /torneos/:torneoId/tabla                       Pestaña Tabla
├── /torneos/:torneoId/estadisticas                Pestaña Estadísticas
├── /torneos/:torneoId/plantel                     Pestaña Plantel
└── /torneos/:torneoId/herramientas                Pestaña Herramientas
    ├── /calendario                                Ver calendario
    ├── /programacion                              Programar calendario
    ├── /pendientes                                Alertas de competición
    ├── /actividad                                 Historial de actividad
    ├── /decisiones                                Decisiones deportivas
    ├── /sorteos                                   Sorteos y cruces
    ├── /incidencias                               Incidencias de fuentes
    ├── /asociaciones                              Asociaciones y afiliaciones
    ├── /archivo                                   Archivo histórico
    ├── /cierre                                    Cierre de temporada
    ├── /simulacion                                Simulación
    ├── /planificacion                             Planificación de temporadas
    ├── /clasificacion-internacional               Clasificación internacional
    ├── /historial-club/:clubId                    Historial del club
    ├── /divisiones                                Ascensos y segunda división
    └── /copias                                    Acceso contextual a copias
```

Las funciones de biblioteca, universos y copias son globales porque organizan datos que pueden abarcar varias temporadas. Se puede llegar a ellas desde Herramientas, pero su destino principal permanece en Mis torneos. El estado seleccionado debe conservarse al regresar.

## Navegación global

### Mis torneos — `/torneos`

Es la biblioteca y la puerta de entrada a las temporadas. Incluye:

- Buscar, filtrar, ordenar y cambiar la vista de competiciones y temporadas.
- Abrir, duplicar, renombrar y eliminar torneos; comparar temporadas; abrir o crear temporadas.
- Importar y exportar torneos.
- Administrar universos: seleccionar, crear, cambiar, renombrar, asignar o quitar torneos y eliminar un universo cuando corresponda.
- Abrir el panel de un universo (`/torneos/universos/:universoId`), con competiciones, partidos pendientes, actividad, acciones sugeridas y accesos a torneos, calendario, alertas, programación y recuperación.
- Ver el resumen de una tarjeta (`/torneos/:torneoId/resumen-competicion`): posiciones, eliminatorias, próximos partidos y últimos resultados; desde ahí cerrar el resumen o abrir el torneo, calendario o pendientes.
- Abrir Copias y recuperación (`/torneos/copias`): exportar una copia completa o por universo, importar una copia, restaurar datos y recuperar una copia disponible.
- Acceder a alertas desde una tarjeta como atajo contextual; la ubicación estable de esa función dentro del torneo es Herramientas → Pendientes.

### Crear torneo — `/torneos/crear`

Permite elegir entre importar una competición oficial (`/torneos/crear/importar`) y crear un campeonato personalizado (`/torneos/crear/personalizado`). La importación permite elegir competición y temporada, consultar la fuente y ejecutar la importación. El formulario permite configurar participantes, formato y desempates; al crear, guarda y abre el torneo.

### Cuenta — `/cuenta`

Permite ingresar, crear una cuenta, administrar la sesión, compartir un torneo y revocar un enlace compartido. Si al entrar con cuenta hay datos locales pendientes, se abre el flujo de migración (`/cuenta/migrar`): agregar o reemplazar datos, confirmar el reemplazo o continuar sin migrar.

## Dentro de un torneo

### Resumen — `/torneos/:torneoId/resumen`

Presenta el estado del campeonato, próximos partidos y una síntesis de tablas y estadísticas. Permite elegir etapa o rueda y simular partidos, una etapa/rueda o el campeonato. Desde aquí se puede saltar a las pestañas de detalle o a Herramientas.

Cuando la temporada es futura, incluye la preparación de temporada y los datos disponibles (`/torneos/:torneoId/resumen/preparacion`), con las acciones de revisión y guardado habilitadas. Para competiciones compatibles, muestra el resumen de ascensos y segunda división (`/torneos/:torneoId/resumen/divisiones`): posiciones, movimientos y temporada vinculada; la creación de temporadas aparece solo si se cumplen las condiciones. Estas secciones contextuales no sustituyen el acceso organizado de Herramientas a la planificación y divisiones.

### Partidos — `/torneos/:torneoId/partidos`

Es el lugar principal para consultar fechas y resultados. Muestra el calendario, permite navegar por fechas, abrir cada partido y registrar o editar resultados cuando está permitido. También da acceso a la comparación de enfrentamientos (`/torneos/:torneoId/partidos/enfrentamientos`), para elegir dos equipos y consultar sus encuentros.

El detalle de partido (`/torneos/:torneoId/partidos/:partidoId`) muestra información y actividad; permite editar el resultado si está permitido y volver al partido o calendario de origen. Ver calendario también está disponible desde Herramientas → Temporada.

### Tabla — `/torneos/:torneoId/tabla`

Reúne las posiciones y tablas de la temporada. La edición de reglamentos y criterios de desempate (`/torneos/:torneoId/herramientas/reglamentos`) se abre como panel contextual desde Tabla; permite elegir criterios, guardar y revisar su efecto en la clasificación. El retorno lleva a la tabla.

### Estadísticas — `/torneos/:torneoId/estadisticas`

Resume estadísticas de equipos, goleadores y jugadores. Permite elegir temporada, fase o grupo. Desde esta sección se consulta o edita la nómina cuando corresponde, y se accede a los reglamentos si el flujo actual lo requiere. La administración completa de jugadores tiene una ubicación clara en Plantel.

### Plantel — `/torneos/:torneoId/plantel`

Administra los jugadores asociados a los equipos: añadir, editar, quitar y guardar jugadores. El alcance se indica por equipo. Estadísticas conserva los datos de rendimiento; Plantel es el punto principal para modificar las nóminas.

### Herramientas — `/torneos/:torneoId/herramientas`

La portada presenta grupos con nombres orientados a tareas y un resumen breve. Las herramientas se abren en rutas hijas, mantienen temporada y torneo, y ofrecen retorno a esta portada o a la sección que originó el acceso.

#### Temporada

- **Ver calendario** — `/torneos/:torneoId/herramientas/calendario`: fechas, partidos y resultados; abre el detalle de partido, permite registrar/editar resultados y consultar enfrentamientos directos. El acceso principal para jugar y recorrer partidos está en Partidos.
- **Programar calendario** — `/torneos/:torneoId/herramientas/programacion`: revisar una propuesta, ajustar fechas y horarios, confirmar y volver al calendario.
- **Pendientes de la temporada** — `/torneos/:torneoId/herramientas/pendientes`: alertas de competición; abre el partido o calendario relacionado, estadísticas o reglamentos. También admite un acceso rápido desde una tarjeta de Mis torneos.
- **Historial de actividad** — `/torneos/:torneoId/herramientas/actividad`: cambios registrados y filtros por competición, temporada o partido; permite cerrar y volver.

#### Decisiones y formato

- **Decisiones deportivas** — `/torneos/:torneoId/herramientas/decisiones`: filtrar decisiones, abrir calendario, sorteos, simulación, cierre o planificación; revisar y confirmar una resolución admitida y consultar el historial.
- **Sorteos y cruces** — `/torneos/:torneoId/herramientas/sorteos`: elegir torneo, configurar y revisar el sorteo o cuadro, confirmar cambios y abrir calendario o simulación.
- **Incidencias de fuentes** — `/torneos/:torneoId/herramientas/incidencias`: seleccionar un partido importado, corregir datos, añadir fuente y motivo, confirmar y registrar la revisión.
- **Asociaciones y afiliaciones** — `/torneos/:torneoId/herramientas/asociaciones`: registrar o revisar una asociación o afiliación, documentar la fuente y confirmar. Desde aquí se puede abrir el historial del club.
- **Reglamentos** — `/torneos/:torneoId/herramientas/reglamentos`: editar criterios de desempate; acceso contextual también desde Tabla y Estadísticas.

#### Gestión de temporadas

- **Archivo histórico** — `/torneos/:torneoId/herramientas/archivo`: consultar temporadas y antecedentes, abrir temporada, calendario, cierre, planificación, clasificación o competiciones.
- **Revisar y cerrar temporada** — `/torneos/:torneoId/herramientas/cierre`: elegir temporada, revisar resultados, ascensos/descensos, cupos, bloqueos, alertas y calendario; confirmar el cierre cuando esté habilitado y preparar la edición siguiente.
- **Simular temporadas** — `/torneos/:torneoId/herramientas/simulacion`: elegir alcance (una temporada o conjunto), simular, revisar temporadas y alertas, abrir calendario y cerrar.
- **Planificación de temporadas** — `/torneos/:torneoId/herramientas/planificacion`: elegir origen, destino y tipo de preparación; revisar participantes; abrir historial de clubes o temporada y pasar a programación cuando corresponda.
- **Clasificación internacional** — `/torneos/:torneoId/herramientas/clasificacion-internacional`: elegir orígenes y edición, revisar participantes y cupos y confirmar la preparación admitida.

#### Clubes y divisiones

- **Historial del club** — `/torneos/:torneoId/herramientas/historial-club/:clubId`: consultar apariciones, títulos y trayectoria; cambiar club o temporada. También se llega desde asociaciones, planificación y tarjetas de club.
- **Ascensos y segunda división** — sección contextual del Resumen cuando la competición es compatible; ruta propuesta `/torneos/:torneoId/resumen/divisiones`. Revisar posiciones, movimientos y temporada vinculada, y crear temporadas cuando se cumplan las condiciones. Herramientas puede ofrecer un enlace a esta sección para encontrarla.

#### Copias y universos

Las copias y la administración de universos son funciones de biblioteca, no acciones propias de una sola temporada. Para evitar duplicarlas, Herramientas incluye enlaces a **Copias y recuperación** (`/torneos/copias`) y **Administrar universos** (`/torneos/universos`); al volver se restaura el torneo activo. Mis torneos sigue siendo su ubicación principal.

## Vistas auxiliares y retorno

| Vista | Ruta propuesta | Acceso y regreso |
|---|---|---|
| Biblioteca / competiciones y temporadas | `/torneos` y `/torneos/competiciones` | Navegación global; conserva filtros y universo al regresar. |
| Crear torneo | `/torneos/crear` | Navegación global; elegir importar o personalizar. |
| Importar torneo oficial | `/torneos/crear/importar` | Desde Crear torneo; tras importar, abrir temporada. |
| Formulario de torneo personalizado | `/torneos/crear/personalizado` | Desde Crear torneo; tras crear, abrir temporada. |
| Cuenta y acceso | `/cuenta` | Navegación global. |
| Migración de biblioteca | `/cuenta/migrar` | Al iniciar sesión si hay datos locales pendientes; volver a Cuenta. |
| Resumen de competición | `/torneos/:torneoId/resumen-competicion` | Tarjeta en Mis torneos; cerrar o abrir torneo/calendario/pendientes. |
| Panel de universo | `/torneos/universos/:universoId` | Selector de universo; abrir torneo, calendario, pendientes, programación o recuperación. |
| Administración de universos | `/torneos/universos` | Selector de universo en Mis torneos o enlace en Herramientas; volver a la biblioteca. |
| Copias y recuperación | `/torneos/copias` | Mis torneos, panel de universo o enlace en Herramientas; volver al origen y restaurar contexto. |
| Detalle de partido | `/torneos/:torneoId/partidos/:partidoId` | Desde Partidos o calendario; volver al partido/calendario de origen. |
| Comparación de enfrentamientos | `/torneos/:torneoId/partidos/enfrentamientos` | Desde partido/calendario o historial; cerrar y volver al origen. |
| Reglamentos | `/torneos/:torneoId/herramientas/reglamentos` | Desde Herramientas, Tabla o Estadísticas; guardar y volver a la sección de origen. |
| Nómina de jugadores | `/torneos/:torneoId/plantel` | Pestaña Plantel; acceso complementario desde Estadísticas. |
| Preparación de temporada | `/torneos/:torneoId/resumen/preparacion` | Solo en temporadas futuras; volver al Resumen. |
| Divisiones | `/torneos/:torneoId/resumen/divisiones` | Solo en competiciones compatibles; volver al Resumen. |
| Historial de club | `/torneos/:torneoId/herramientas/historial-club/:clubId` | Asociaciones, planificación o tarjeta de club; volver al flujo de origen. |
| Incidencias de fuentes | `/torneos/:torneoId/herramientas/incidencias` | Revisiones de temporada o decisiones; confirmar y volver al flujo de origen. |
| Asociaciones y afiliaciones | `/torneos/:torneoId/herramientas/asociaciones` | Herramientas o sorteos; confirmar y volver al flujo de origen. |
| Clasificación internacional | `/torneos/:torneoId/herramientas/clasificacion-internacional` | Cierre, decisiones o planificación; volver a esa herramienta. |

Los paneles que hoy aparecen de forma condicional se describen como secciones o vistas contextuales. Solo se muestran cuando el tipo de torneo, temporada o datos disponibles los habilitan. Las rutas sirven para expresar ubicación y retorno propuestos, no presuponen que cada panel deba abrirse como página completa.

## Matriz de cobertura del inventario

| Elemento del inventario | Ubicación propuesta | Acceso y funciones cubiertas | Notas y condiciones |
|---|---|---|---|
| Biblioteca de torneos | `/torneos` | Crear, buscar, filtrar, ordenar, abrir, duplicar, renombrar, eliminar; comparar temporadas; importar/exportar; administrar universos y copias. | Navegación global Mis torneos. |
| Crear campeonato | `/torneos/crear` | Elegir fuente e importar o configurar participantes, formato y desempates; guardar y abrir. | Navegación global Crear torneo. |
| Torneo activo / resumen | `/torneos/:torneoId/resumen` | Elegir etapa/rueda; simular partidos, etapa/rueda o campeonato; consultar estado, próximos partidos, tablas y estadísticas; enlaces a calendario, alertas, programación e historial. | Alertas/programación/historial se encuentran en Herramientas. |
| Calendario | `/torneos/:torneoId/partidos` y `/torneos/:torneoId/herramientas/calendario` | Consultar fechas/resultados; abrir partido; registrar/editar resultado; consultar enfrentamientos directos. | Partidos es acceso frecuente; Ver calendario también queda en Herramientas como se solicitó. |
| Programación del calendario | `/torneos/:torneoId/herramientas/programacion` | Revisar propuesta, ajustar fechas/horarios, confirmar y volver al calendario. | Herramientas → Temporada. |
| Alertas de competición | `/torneos/:torneoId/herramientas/pendientes` | Abrir partido/calendario relacionado, revisar estadísticas/reglamentos y volver al torneo. | Acceso rápido opcional desde tarjeta de biblioteca; destino canónico en Herramientas. |
| Historial de actividad | `/torneos/:torneoId/herramientas/actividad` | Filtrar por competición, temporada o partido; cerrar. | Herramientas → Temporada. |
| Centro de competiciones y temporadas | `/torneos/competiciones` | Cambiar vista, buscar, filtrar, ordenar, comparar, abrir y crear temporadas. | Dentro de Mis torneos. |
| Centro de guardado y recuperación | `/torneos/copias` | Exportar respaldo completo o por universo, importar, restaurar y recuperar una copia. | Global, con accesos contextuales desde universo/Herramientas. |
| Panel del universo deportivo | `/torneos/universos/:universoId` | Ver competiciones, partidos pendientes, actividad, acciones; abrir torneos, calendarios, alertas, programación y recuperación. | Seleccionando universo en Mis torneos. |
| Administración de universos | `/torneos/universos` | Seleccionar, crear, cambiar, renombrar, asignar/quitar torneos y eliminar cuando corresponda. | Selector de universo; función global. |
| Decisiones deportivas | `/torneos/:torneoId/herramientas/decisiones` | Filtrar; abrir calendario, sorteos, simulación, cierre y planificación; revisar/confirmar resolución admitida; consultar historial. | Herramientas → Decisiones y formato. |
| Sorteos y cruces | `/torneos/:torneoId/herramientas/sorteos` | Elegir torneo; configurar/revisar sorteo o cruces; confirmar cambios; abrir calendario/simulación. | Solo para torneos compatibles. |
| Archivo histórico | `/torneos/:torneoId/herramientas/archivo` | Consultar antecedentes; abrir temporada, calendario, cierre, planificación, clasificación o competiciones. | Herramientas → Gestión de temporadas. |
| Cierre de temporada | `/torneos/:torneoId/herramientas/cierre` | Elegir temporada; revisar resultados, ascensos/descensos, cupos, bloqueos, alertas/calendario; confirmar cierre y preparar edición siguiente. | Confirmación solo cuando esté habilitada. Rótulo sugerido: «Revisar y cerrar temporada». |
| Simulación | `/torneos/:torneoId/herramientas/simulacion` | Elegir alcance, simular, revisar temporadas/alertas, abrir calendario y cerrar. | Puede abarcar más de una temporada. Rótulo sugerido: «Simular temporadas». |
| Planificación de temporadas | `/torneos/:torneoId/herramientas/planificacion` | Elegir origen, destino y tipo; revisar participantes; abrir historial/temporada; enviar a programación. | Envío a programación cuando aplique. |
| Resumen de competición | `/torneos/:torneoId/resumen-competicion` | Ver posiciones, eliminatorias, próximos partidos y últimos resultados; cerrar, abrir torneo/calendario/alertas. | Desde tarjeta en Mis torneos. |
| Cuenta y acceso | `/cuenta` | Ingresar, crear cuenta, cerrar sesión, compartir torneo y revocar enlace. | Navegación global Cuenta. |
| Migración de biblioteca | `/cuenta/migrar` | Agregar o reemplazar datos, confirmar reemplazo o seguir sin migrar. | Solo al entrar con cuenta si hay datos locales pendientes. |
| Estadísticas | `/torneos/:torneoId/estadisticas` | Consultar equipos, goleadores y jugadores; elegir temporada, fase/grupo; acceder a nóminas/reglamentos cuando corresponda. | Pestaña propia. |
| Preparación de temporada | `/torneos/:torneoId/resumen/preparacion` | Revisar y guardar preparación según el flujo habilitado. | Solo temporadas futuras. |
| Ascensos y segunda división | `/torneos/:torneoId/resumen/divisiones` | Revisar posiciones, movimientos y temporada vinculada; crear temporadas si se cumplen condiciones. | Solo competiciones compatibles; enlace desde Herramientas sin duplicar la función. |
| Historial del club | `/torneos/:torneoId/herramientas/historial-club/:clubId` | Cambiar club/temporada; consultar apariciones, títulos y trayectoria. | Acceso desde asociaciones, planificación o tarjeta de club. |
| Asociaciones y afiliaciones | `/torneos/:torneoId/herramientas/asociaciones` | Registrar/revisar asociación o afiliación; documentar fuente; revisar y confirmar. | Acceso también desde sorteos. |
| Incidencias de fuentes | `/torneos/:torneoId/herramientas/incidencias` | Elegir partido importado, corregir datos, añadir fuente/motivo, confirmar y registrar revisión. | Disponible en revisiones de temporada/decisiones. |
| Comparación de enfrentamientos | `/torneos/:torneoId/partidos/enfrentamientos` | Elegir equipos y consultar encuentros; cerrar y volver. | Desde calendario o historial de temporada. |
| Detalle de partido | `/torneos/:torneoId/partidos/:partidoId` | Consultar información y actividad; editar resultado si está permitido; cerrar. | Desde calendario/Partidos. |
| Reglamentos del partido | `/torneos/:torneoId/herramientas/reglamentos` | Elegir criterios, guardar y revisar efecto en la tabla. | Acceso contextual desde Tabla/Estadísticas y alertas. |
| Nómina de jugadores | `/torneos/:torneoId/plantel` | Añadir, editar, quitar jugadores y guardar. | Función principal en Plantel; acceso de consulta desde Estadísticas. |
| Clasificación internacional | `/torneos/:torneoId/herramientas/clasificacion-internacional` | Elegir orígenes/edición; revisar clasificación y confirmar preparación admitida. | Desde cierre, decisiones o planificación. |
| Formulario de torneo | `/torneos/crear/personalizado` | Completar campos, elegir formato/desempate y crear torneo. | Subvista de Crear torneo. |
| Importar torneo oficial | `/torneos/crear/importar` | Elegir competición/temporada, consultar fuente e importar. | Subvista de Crear torneo. |

## Notas de rotulación del inventario

El inventario registra alternativas de lenguaje simple; son recomendaciones de texto y no cambios de interfaz. Mantenerlas asociadas a sus funciones al definir los nombres visibles:

| Texto actual del inventario | Alternativa sugerida | Ubicación funcional |
|---|---|---|
| Centro de cierre | Revisar y cerrar temporada | Herramientas → Gestión de temporadas |
| Centro de simulación | Simular temporadas | Herramientas → Gestión de temporadas |
| Centro de calendario | Ver calendario | Partidos y Herramientas → Temporada |
| Centro de alertas | Pendientes de la temporada | Herramientas → Temporada |
| Centro de competiciones y temporadas | Competiciones y temporadas | Mis torneos |
| Centro de guardado y recuperación | Copias y recuperación | Mis torneos; enlace desde Herramientas |
| Centro de programación de calendarios | Programar calendarios | Herramientas → Temporada |
| Operativos | Partidos | Estadísticas |
| minitabla completa (legado) | Enfrentamientos directos entre los equipos empatados | Explicación de desempates |
| biblioteca JSON v7 | copia de seguridad | Incidencias/revisiones |
| No existe ese estado en el modelo | Ese estado todavía no está disponible | Mensaje, si aparece |
| Datos de proveedor sin certificación oficial | Datos externos sin verificar | Historial del club |
| No disponible en este universo | No está incluida en este grupo de torneos | Cierre de temporada |
| Resoluciones desactualizadas | Revisiones que necesitan actualizarse | Decisiones deportivas |
| Dependencias explícitas | Temporadas relacionadas | Decisiones deportivas |
| Alertas operativas de consulta | Avisos para revisar | Decisiones deportivas |
| Escenario local, editado o simulado | Datos creados o modificados aquí | Historial del club |
| Procedencia no acreditada | Origen sin confirmar | Historial del club |
| Estados operativos pendientes | Partidos pendientes | Mis torneos |
| Registrar resoluciones soportadas | Registrar una decisión disponible | Decisiones deportivas |
| ID estable / ID del torneo | Código del torneo | Asociaciones y cuenta |

## Criterios de uso

El orden de pestañas prioriza información que se consulta con frecuencia: estado, partidos y resultados, posiciones, rendimiento y jugadores. Herramientas reúne acciones necesarias pero menos frecuentes, organizadas por tarea y con nombres reconocibles. El calendario tiene un acceso directo en Partidos y también queda en Herramientas junto a programación, pendientes e historial, tal como requiere esta propuesta.

Cada ruta secundaria conserva torneo y temporada, identifica de dónde vino la persona y facilita volver sin perder filtros ni selección. Las vistas condicionales solo aparecen cuando el torneo o la temporada las habilitan. En pantallas de 360 px se conserva acceso a las seis pestañas mediante navegación adaptable y desplazable; todo debe funcionar con teclado, foco visible, encabezado principal y etiquetas claras.

# Enrutamiento de la web

La web usa la History API del navegador para gestionar rutas del lado del cliente. La arquitectura actual necesita navegación entre unas pocas pantallas de una sola SPA y no necesita anidamiento avanzado, loaders ni acciones de formulario propias de un framework de rutas. La History API evita sumar y mantener una dependencia; `pushState` guarda cada navegación y `popstate` restaura la vista al usar Atrás o Adelante.

## Rutas conectadas

- `/`: entrada actual de la app (torneo activo o biblioteca si no hay uno abierto).
- `/torneos`: biblioteca.
- `/torneos/nuevo`: creación de torneo.
- `/torneos/:id` y `/torneos/:id/resumen`: torneo activo.
- `/torneos/:id/partidos`, `/tabla`, `/estadisticas` y `/plantel`: torneo activo en las vistas existentes.
- `/torneos/:id/herramientas/:herramienta`: vistas actuales de herramientas; `calendario`, `programacion`, `pendientes`, `actividad`, `decisiones`, `sorteos`, `incidencias`, `asociaciones`, `archivo`, `cierre` y `simulacion` abren el panel existente que las contiene.
- `/cuenta`: cuenta y acceso.

Las secciones de tabla, estadísticas y plantel todavía forman parte del tablero existente; sus rutas preservan el torneo y permiten abrir directamente la vista actual. Esta conexión no cambia su composición visual.

Cada cambio de ruta actualiza el título del documento y lleva el foco al `h1` de la página. Vercel conserva las reglas de proxy para API y fuentes oficiales antes de la reescritura general de rutas a `index.html`.


# Medición del paquete JavaScript

Medición del 16 de octubre de 2026. Tamaños decimales (1 kB = 1000 bytes). Se comparó el mismo proyecto, dependencias y configuración de producción antes y después de introducir cargas diferidas. No se aumentó `chunkSizeWarningLimit`, no se añadieron dependencias y no se configuraron divisiones manuales de Vite.

| JavaScript | Antes | Después |
| --- | ---: | ---: |
| Entrada principal | 589,23 kB | 373,27 kB |
| Dependencias estáticas compartidas adicionales | 0 kB | 45,78 kB |
| **Carga inicial completa** | **589,23 kB** | **419,04 kB** |
| Carga inicial comprimida (gzip de Node) | 162,56 kB | 120,93 kB |
| Fragmentos diferidos, todos sumados | 0 kB | 177,98 kB |
| Total JavaScript disponible | 589,23 kB | 597,02 kB |

La carga inicial baja **28,9 %**, y su gzip **25,6 %**. El total disponible sube **1,3 %** por las referencias entre módulos, envoltorios de carga y compresión separada; el beneficio es descargar y evaluar menos código al abrir la biblioteca. No se afirma una mejora medida de tiempo de arranque o FPS. Con un torneo activo guardado, sus paneles se solicitan al abrirlo, por lo que esa navegación descarga más código que la biblioteca vacía.

## Auditoría y decisiones

El proyecto solo usa React y React DOM como dependencias de ejecución. Los módulos de mayor contribución según `chunk.modules[].renderedLength` fueron React DOM (~183,8 kB), biblioteca (~59,8 kB), App (~52,5 kB), repositorio local (~46,6 kB), lista de partidos (~36,1 kB), detalles de partido (~31,6 kB), archivo JSON (~29,6 kB), resoluciones oficiales (~26,3 kB) y ESPN de Argentina/Brasil (~24,8 kB). Son contribuciones de código renderizado por el empaquetador, previas a la minificación final; no deben sumarse como tamaños finales transferidos.

La biblioteca, el repositorio, las validaciones y los servicios deportivos compartidos siguen disponibles al iniciar porque se necesitan para consultar y reconciliar los datos guardados. No se fraccionaron motores deportivos ni simulaciones. Se reutilizó la tabla ya calculada al calcular los cupos internacionales, eliminando una segunda llamada inmediata a `calculateStandings` con el mismo torneo. No se añadieron cachés ni memoizaciones especulativas.

## Fragmentos generados

Los nombres llevan hashes que pueden variar con cambios posteriores. Vite decide automáticamente los fragmentos compartidos; las fronteras explícitas corresponden a seis paneles y cinco familias de proveedores.

| Fragmento | kB | Momento de carga |
| --- | ---: | --- |
| index | 373,27 | Inicial |
| jsx-runtime y código compartido | 43,22 | Inicial |
| match-scheduling | 2,35 | Inicial |
| team-name | 0,21 | Inicial |
| fixture-list y detalles de partido | 33,67 | Al abrir un torneo o sus partidos |
| tournament-statistics-panel y editores de plantillas/reglamento | 22,82 | Al abrir un torneo |
| second-division-panel y resoluciones oficiales | 29,87 | Al abrir una segunda división de 2026 |
| season-preparation-panel | 11,97 | Al abrir una temporada posterior a 2026 |
| match-calendar | 10,42 | Al abrir el calendario por primera vez |
| import-official-tournament (interfaz) | 9,17 | Al abrir la creación/importación |
| import-official-tournament (caso de uso compartido) | 12,50 | Al cargar una interfaz de importación |
| anfa-third-division-source | 4,13 | Al solicitar ANFA |
| anfp-official-league-source | 12,06 | Al solicitar ANFP |
| espn-continental-cup-source | 6,71 | Al solicitar una copa continental |
| espn-south-american-league-source | 15,53 | Al solicitar Argentina/Brasil o su calendario posterior |
| south-american-cup-sources | 8,52 | Al solicitar Copa Argentina/Copa do Brasil |
| espn-match-status (compartido) | 0,62 | Con los proveedores ESPN |

`React.lazy` se declara fuera de `App` para conservar la identidad de los componentes. Cada panel tiene su propio `Suspense`, con un estado de carga accesible. El calendario conserva el montaje una vez abierto y se oculta al volver al resumen; una prueba comprueba que una edición sin guardar sobrevive a ese recorrido. Se conservaron las condiciones y claves anteriores de los demás paneles.

## Reproducción y validación

- `npm run analyze:bundle`: compila en memoria, recorre las importaciones estáticas desde la entrada y reporta por separado los bytes iniciales y diferidos, gzip y los módulos de mayor contribución. No escribe en `dist`. Gzip usa `node:zlib` con su configuración predeterminada; puede diferir ligeramente del gzip informado por Vite.
- `npm run build`: genera el paquete de producción, sin el aviso de fragmentos superiores a 500 kB y sin cambiar el umbral de Vite.
- `npm test`: incluye navegación real por componentes diferidos, importación bajo demanda, selección de todos los proveedores originales, propagación de errores y conservación de ediciones del calendario, además de las pruebas deportivas, archivos JSON v7 e historial existentes.

Las pruebas de proveedores usan datos sintéticos; no se hizo una importación real ni se modificaron torneos del usuario para medir el paquete.

# Sistema de diseño (fase 9): «Estadio nocturno»

Estilos de `apps/web`. Todo valor visual sale de tokens; las pantallas sólo combinan tokens.

## Archivos

| Archivo | Contenido |
| --- | --- |
| `apps/web/src/styles/tokens.css` | Único lugar con valores: colores, tipografía, espaciado, radios, sombras, capas y colores de zona. |
| `apps/web/src/styles/base.css` | Reset, cuerpo, enlaces, foco visible y controles de formulario (con `:where()`, especificidad 0). |
| `apps/web/src/styles/components.css` | Piezas compartidas: `.eyebrow`, `.small-action`, `.primary-button`, avisos, botones de los centros, tablas de datos y medida de texto. |
| `apps/web/src/styles.css` | Pantallas y paneles. Importa los tres anteriores. |

## Temas

- Oscuro por defecto (`:root`).
- Claro con `prefers-color-scheme: light` o con `<html data-theme="light">`; `data-theme="dark"` fuerza el oscuro. Hoy no hay selector de tema en la interfaz.
- La barra superior y la ilustración de cancha son oscuras en ambos temas (tokens `--top-*`, `--pitch-*`, `--chalk`, `--floodlight`).

## Tokens principales

- **Superficies**: `--bg` (página) < `--surface-2` (paneles) < `--surface` (tarjetas y controles) < `--surface-3` (seleccionado o hover).
- **Texto**: `--fg`, `--fg-soft`, `--muted`. Sobre `--primary` va `--on-primary`; sobre `--highlight` (amarillo marcador), `--on-highlight`. Para texto amarillo sobre fondos del tema, `--highlight-fg`.
- **Estados**: `--danger-*`, `--warning-*` e `--info-*` (`-fg`, `-bg`, `-line`).
- **Tabla**: `--thead-*`, `--row-alt`, `--row-hover`, `--points-*`.
- **Zonas** (una por cada valor de `PlacementClassification`): `--zone-<zona>` (barra lateral y leyenda), `--zone-<zona>-tint` (fila) y `--zone-<zona>-fg` (número de puesto). Zonas: `champion`, `libertadores`, `libertadores-qualifying`, `sudamericana`, `playoff`, `relegation-playoff`, `relegation`.
- **Tipografía**: `--font-display` / `--font-num` (Barlow Condensed) para títulos y cifras; `--font-body` / `--font-label` (Inter). Escala `--fs-2xs` (12 px) a `--fs-4xl` (40 px); no hay texto por debajo de 12 px.
- **Medidas**: `--space-1…10` (escala de 4 px), `--radius-sm|md|lg|pill`, `--control-height` (40 px), `--page-max` (1680 px), `--measure` (72ch).

## Reglas

1. **Sin colores literales** en `styles.css`: usa un token o agrega uno en `tokens.css`, en los tres bloques (oscuro, claro por preferencia y `data-theme="light"`).
2. **Contraste AA**: ≥ 4,5:1 en texto y ≥ 3:1 en bordes de controles y barras de zona. Al agregar un par texto/fondo, verifícalo en ambos temas.
3. **Scroll horizontal** sólo dentro de `.standings-scroll`, `.statistics-table-scroll` o `.table-scroll`. Son las clases que excluye el chequeo `layout()` de `apps/web/e2e/cancha.e2e.ts`, que falla si cualquier otro elemento sale del viewport (incluso recortado por `overflow: hidden`).
4. **Grillas**: usa columnas `minmax(0, 1fr)` y `min-width: 0` en los hijos que contienen tablas o texto largo; sin eso, una tabla ancha empuja la página.
5. **Sin cambios de texto ni de roles por estilo**: las pruebas buscan por rol y nombre accesible. No uses `text-transform` en encabezados ni botones con nombre que las pruebas consulten.

## Layout del torneo

`app.tsx` agrupa el panel del torneo en `.tournament-board` (`.board-controls`, `.board-extra`, `.board-standings` y `.board-fixtures`, sólo `div` con clase). Desde 1200 px, si hay tabla de posiciones, la tabla ocupa la columna izquierda; controles y partidos, la derecha; y estadísticas y paneles extra, el ancho completo debajo. En una columna se mantiene ese orden visual con `order`.

## Agregar una zona de clasificación

1. Agrega `--zone-<zona>`, `--zone-<zona>-tint` y `--zone-<zona>-fg` en los tres bloques de `tokens.css`.
2. Agrega en `styles.css` la fila `.standings-table tbody tr.standing-<zona>` (variables `--zone` y `--zone-fg` y el fondo) y `.standing-legend-<zona>::before`.

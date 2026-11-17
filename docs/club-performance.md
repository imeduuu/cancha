# Panel de rendimiento y evolución deportiva de clubes

## Revisión y arquitectura

Se revisaron las tablas, estadísticas generales, historial de clubes, palmarés, récords, H2H, identidades, borradores y persistencia. No hay biblioteca de gráficos en las dependencias actuales. El panel usa barras CSS adaptables con cantidades y tablas accesibles; no incorpora dependencias.

`application/services/club-performance.ts` es una proyección de consulta. Reutiliza `clubHistoryScopes` para las métricas por fase y sus criterios de posición, `calculateStandings` para localías/jornadas, las identidades del historial y la compatibilidad del palmarés. La condición de fase completa del palmarés se comparte como `isCompleteClubScope` sin cambiar su comportamiento. La consulta histórica expone el nombre de fase original además de su etiqueta: una fase cuyo nombre sea literalmente “Sin fase registrada” no se confunde con los partidos sin fase declarada.

No se recalculan reglas deportivas, ascensos, títulos, desempates o clasificaciones. Las tablas de localía y de jornada reciben el calendario original completo como contexto de validación de agregados. Filtrar una vuelta no elimina su ida necesaria. No se reutiliza H2H como si midiera toda la actuación: H2H selecciona solamente los encuentros entre dos clubes; rendimiento utiliza **todos los rivales del club** dentro del alcance elegido.

## Accesos y selección

- **Biblioteca → Centro → Rendimiento deportivo de clubes**.
- **Historial deportivo → Perfil de club → Rendimiento deportivo de clubes**, con la identidad del perfil preseleccionada.

Selecciona club, competición y participación (temporada, torneo y fase). No se elige automáticamente una versión de una temporada. Las opciones incluyen IDs de clubes, torneos y categoría de cobertura para distinguir copias y homónimos. Las temporadas archivadas siguen consultables.

Se conservan los filtros, el alcance, la selección de evolución y el segundo club durante la navegación mediante los borradores de sesión existentes. Abrir el torneo de origen permite revisar el respaldo de las métricas y conserva los formularios sin guardar según el comportamiento actual. Los borradores no se escriben en el JSON; una recarga inicia otra sesión.

## Métricas y jornadas

Para el alcance seleccionado se muestran PJ, G/E/P, GF, GC, DG y los mismos valores como local y visitante. Los únicos cocientes nuevos son GF/PJ y GC/PJ para el club: no son el promedio de todos los goles de todos los encuentros del torneo. Con cero partidos se muestra **Sin partidos**, en vez de una tasa observada de cero.

Goles y G/E/P pertenecen al tiempo reglamentario de las tablas existentes. Una tanda o prórroga no añade una victoria reglamentaria ni suma sus goles aquí. No se inventan posesión, xG, tiros, asistencias ni estadísticas de eventos ausentes.

La evolución por jornada ofrece barras de G/E/P, métricas por jornada y acumulados de los resultados actualmente guardados. El orden es por **rueda y jornada registradas**, dentro de una sola fase. No pretende reconstruir el orden real de disputa: los aplazamientos pueden alterarlo. Las jornadas pendientes conservan sus partidos programados y no aportan resultados ficticios. Se puede consultar la tabla textual de acumulados sin depender de los gráficos.

## Evolución entre temporadas

El usuario marca expresamente las participaciones que quiere comparar. Se exige un año explícito y una sola versión/fase por año, misma competición, fase, grupo, formato, cantidad de participantes, etapas, puntos, criterios, verificación y procedencia compatibles. Las copias o escenarios incompatibles se rechazan. Se reutilizan las restricciones existentes del historial y el palmarés; no se deduce continuidad por nombres.

Los gráficos muestran valores **por temporada/fase**, sin sumarlos: G/E/P, GF/GC, posiciones acreditadas y G/E/P como local y visitante. Las participaciones se ordenan por año. Cada etiqueta indica club e ID, torneo, fase, cobertura, PJ y procedencia, también cuando no hay una ficha individual abierta. No se igualan artificialmente calendarios con distinto número de partidos disponibles.

Solo se grafica una posición final reconocida por el historial, con cobertura y reglas suficientes. Un empate pendiente, reglamento provisional, importación parcial o fase eliminatoria deja la posición sin acreditar; no se dibuja un cero como supuesto puesto. Para posiciones, **menor número es mejor**: la longitud representa el número, no una puntuación deportiva.

Una fuente parcial puede consultarse y compararse por selección expresa cuando conserva un alcance compatible. Se etiqueta como parcial en cada serie. No se presenta como un récord definitivo ni como una temporada completa; las cantidades menores pueden deberse a menos partidos disponibles. Se muestran las participaciones incluidas en el cálculo.

## Comparación de clubes

El segundo club se compara dentro del **mismo torneo, temporada, fase y grupo** que el primero, con todos sus rivales. Si falta una participación compatible, se informa y no se inventa una relación con otra temporada. No se selecciona dos veces el mismo club ni se comparan identidades ambiguas. Los homónimos se mantienen separados por las reglas de identidad ya implementadas.

Las barras y tablas comparan cantidades y PJ; no crean un ranking nuevo ni predicen un ganador. Las diferencias de partidos disputados, cobertura y procedencia se mantienen visibles.

## Gráficos y accesibilidad

Las barras comparten escala dentro de cada gráfico. Las etiquetas muestran nombres y valores, sin depender exclusivamente de colores; son cantidades, no porcentajes de victorias. Las tablas incluyen cabeceras y títulos accesibles, y disponen de desplazamiento horizontal propio en ventanas pequeñas. Los controles son selectores, casillas y botones nativos con etiquetas. El panel se carga bajo demanda con el límite de errores diferidos existente.

## Integridad y persistencia

El panel solo consulta torneos y actividad actuales. Guardar resultados reconstruye la proyección; un cambio de procedencia o reglamento puede volver incompatible una selección de años y se pide revisarla. Las fuentes retiradas se señalan; no se sustituyen por coincidencias nominales. Las identidades contradictorias bloquean la atribución.

No se agregan campos persistentes, bases de datos, sincronización ni migraciones. Se mantiene JSON v7. Los torneos antiguos sin año o referencias pueden consultarse por separado, con sus límites visibles; no se inventa un año para graficar su evolución. La preparación sin partidos no se presenta como campaña disputada.

## Validación

```powershell
npm test
npm run test:flows
npm run test:e2e
npm run build
```

Pruebas sintéticas para métricas, localías, promedios, jornadas y acumulados, pendientes y suspendidos, reglas y posiciones parciales, comparación general frente a H2H, identidades ambiguas, homónimos, formatos/puntos/procedencias incompatibles, duplicados, fuentes retiradas, actualización, datos antiguos, fases con etiquetas coincidentes, prórroga/penales e ida/vuelta.

El recorrido nuevo de navegador abre el panel desde el Centro y el perfil, muestra gráficos y tablas, compara dos clubes, selecciona dos años y conserva filtros y el marcador sin guardar. Después registra expresamente ese marcador desde el torneo original: verifica el nuevo promedio del panel y el rechazo de una evolución que pasó a mezclar procedencias; conserva el otro torneo.

### Resultados definitivos — 28 de octubre de 2026

Se retomó únicamente la validación pendiente. Los servicios, componentes, gráficos, pruebas y accesos ya estaban implementados, incluido el guardado explícito del marcador en el recorrido E2E. No fue necesario cambiar la implementación ni ampliar nuevamente las pruebas; en esta reanudación solo se completa este informe, además de regenerar los artefactos normales de pruebas y compilación.

| Comando ejecutado | Resultado |
| --- | --- |
| `npm test` | **768 pruebas aprobadas en 76 archivos**, 75,90 s, con configuración normal. |
| `npm run test:flows` | **62 pruebas aprobadas en 5 archivos**, 30,40 s. |
| `npm run test:e2e -- --grep "rendimiento de clubes grafica" --workers=3` | **12 pruebas aprobadas**, 1,2 min. |
| `npm run build` | **Correcto**, TypeScript y Vite sin avisos de tamaño. |

El recorrido E2E se ejecutó con Chromium, Firefox y WebKit en escritorio (1440×900), notebook (1366×768), tablet (768×1024) y móvil (390×844). No se afirman pruebas en dispositivos físicos. El panel queda como fragmento diferido de 14,90 kB (4,69 kB gzip); el JavaScript principal mide 381,69 kB (109,63 kB gzip). No se añadieron dependencias.

El caso confirma, desde la interfaz, lo siguiente:

- Las consultas y la navegación conservan el marcador sin guardar y no alteran los resultados persistidos.
- Guardar expresamente el marcador local de prueba actualiza el promedio de goles en contra de **0,00 a 2,33**, conservando el promedio a favor de **2,00**.
- La temporada editada pasa a ser un escenario local. Su selección conjunta con la temporada de proveedor queda **rechazada por incompatibilidad de procedencias**, en lugar de conservar una comparación desactualizada.
- La otra temporada conserva sus partidos y resultados originales. Los filtros y la identidad seleccionada sobreviven a la navegación entre Centro, torneo e Historial.

### Alcance de la repetición y limitaciones

La suite completa de **240 pruebas de navegador ya había aprobado** en la ejecución anterior (17 de octubre, 11,6 min). No se repitió: los últimos ajustes estaban acotados a etiquetas de identidad/procedencia, legibilidad de las tablas y ampliación del recorrido específico de rendimiento. Se ejecutó ese recorrido afectado en los doce proyectos, junto con toda la suite unitaria, los flujos existentes y la compilación final. La suite general permanece disponible con `npm run test:e2e`.

Los datos usados son sintéticos y deterministas. No se consultaron proveedores reales ni se certificaron resultados oficiales. La infraestructura de navegador es la existente, con servidor local dedicado y contextos aislados; no se abrió ni modificó la biblioteca personal y no se utilizó el túnel público. Las comprobaciones incluyen errores inesperados de consola/solicitudes y desbordamiento horizontal del documento; las tablas mantienen su propio desplazamiento.

El informe HTML y las capturas de Playwright corresponden a la última selección de **12 pruebas**; el comando general regenera el informe completo. Las limitaciones deportivas descritas arriba se conservan: datos parciales etiquetados, posiciones solo acreditadas, orden por jornadas sin inventar fechas reales y comparaciones restringidas a alcances compatibles. No se modificaron reglas deportivas, resultados reales, importadores, persistencia ni JSON v7.

# Historial de enfrentamientos directos (H2H)

## Auditoría y arquitectura

Se revisaron el historial de clubes, el palmarés, los modelos `Tournament`, `Matchday`, `Fixture`, `MatchResult` y `MatchSchedule`, las tablas, la validación de resultados, las localías, los estados operativos y los eventos de simulación/edición. El desempate directo interno de las tablas no constituye una consulta histórica de clubes: sus criterios deportivos permanecen intactos.

`application/services/head-to-head.ts` construye una proyección de los calendarios guardados. Reutiliza `buildClubProfiles`, `calculateStandings`, `isValidPlayedFixture`, las etiquetas operativas y la compatibilidad de fuentes del palmarés. Las tablas reciben solo los encuentros seleccionados y conservan **todo el calendario original como contexto de validación**; así, filtrar únicamente una vuelta no elimina la ida necesaria para comprobar su agregado.

La comprobación del instante y el acumulador de rachas ya usados por el palmarés se comparten en `application/services/result-streaks.ts`. Se mantiene su convención de tiempo reglamentario y sus pruebas existentes. No se añaden reglas deportivas ni se modifica la validación de eliminatorias.

## Accesos y navegación

- **Biblioteca → Centro → Enfrentamientos directos (H2H)**.
- **Historial deportivo → Perfil de club → Enfrentamientos directos (H2H)**, con el primer club preseleccionado.
- **Partido del resumen o calendario → Comparar clubes (H2H)**, con ambos participantes preseleccionados. Abre una consulta independiente sobre los datos guardados, sin guardar el marcador que se esté editando.

Cada encuentro permite abrir el torneo de origen. Los selectores de clubes incluyen nombres registrados, IDs y el torneo de referencia para distinguir homónimos. Cada acceso conserva sus filtros y selección de fuentes con los borradores de sesión existentes. Navegar no guarda resultados ni borra formularios de edición. Cerrar/recargar la aplicación sigue el diseño de borradores en memoria: no son campos persistentes.

## Identidades

Se reutilizan exclusivamente IDs estables, identidades históricas expresas y relaciones continentales registradas que reconoce el historial. No se une por nombre. Una identidad ambigua o contradictoria bloquea la comparación y muestra el motivo. No se selecciona dos veces el mismo perfil. Si desaparece el registro de identidad que sostenía una selección, se pide revisarla; no se reconstruye por parecido nominal.

## Filtros y fuentes

Los filtros de competición, año, condición local/visitante **del club A** y procedencia afectan tanto al listado como al acumulado. Los partidos de distintas fuentes pueden consultarse en el listado, con su origen visible, sin que eso los incorpore a una suma.

Para obtener el acumulado se marcan expresamente los torneos fuente. No hay selección automática. Se rechazan versiones duplicadas de una misma competición y año, IDs repetidos de partidos, fuentes desaparecidas y mezclas de competición, formato, reglas, sistema de puntos o procedencia incompatibles. La compatibilidad es conservadora y reutiliza la del palmarés: incluso cuando una métrica aislada pudiera compararse, no se declara compatible una mezcla de formatos desconocidos. No se consolidan copias mediante coincidencias de marcador.

Un torneo antiguo sin año puede consultarse y contabilizarse por separado; no se acumulan varias fuentes si alguna carece de año explícito. Los filtros no eliminan silenciosamente una fuente marcada: si queda oculta, sigue seleccionada y se informa cuántas fuentes aportan encuentros al filtro. Usa **Limpiar fuentes H2H** para revisar una selección incompatible u obsoleta.

## Qué cuentan las estadísticas

PJ, victorias, empates, derrotas y goles se obtienen de las tablas existentes. Se muestran totales de ambos clubes y los desgloses A local/B visitante y A visitante/B local. No se muestran puntos ni se infiere una clasificación deportiva del H2H.

Solo cuentan resultados válidos y operativamente finalizados. Los pendientes, suspendidos, aplazados, cancelados, en juego y marcadores inválidos permanecen consultables, pero no añaden partidos ni goles al acumulado. Se indica cuántos encuentros quedaron sin computar.

El marcador de **90 minutos**, los **goles adicionales de prórroga** y la **tanda de penales** se presentan por separado. Una victoria por tanda o prórroga no se convierte en victoria del marcador reglamentario. No se infiere el ganador agregado de una llave a partir de un encuentro aislado. Se conserva el torneo original para consultar su resolución.

## Procedencia y simulaciones

Se muestra la procedencia general existente: escenario local/editado/simulado, proveedor sin certificación oficial o procedencia no acreditada. ESPN no se presenta como federación ni como certificación oficial.

Además, puede mostrarse **Simulado según actividad coincidente** cuando el último evento individual identificable tiene el mismo ID de partido, el resultado actual coincide con su snapshot y el evento acredita un cambio respecto del resultado anterior. Un lote de simulación puede incluir partidos que se conservaron: esos miembros sin cambio no se etiquetan como simulados. Sin snapshot anterior, con eventos simultáneos ambiguos (comparados por instante UTC, incluso con desfases textuales distintos), con una importación posterior o con un marcador que ya no coincide, no se atribuye esa procedencia individual. Una edición manual posterior coincidente se distingue de la simulación previa.

La actividad antigua o incompleta no permite certificar cómo se obtuvo cada marcador. Ese límite se muestra como falta de trazabilidad individual; nunca se completa por suposición.

## Cronología, últimos encuentros y rachas

Se conserva fecha, hora, zona, competición, año, fase, rueda, jornada y participantes publicados en cada encuentro. No se inventan fechas. Para comparar instantes se exige programación válida con fecha, hora y zona explícitas; se usa la validación existente, sin aceptar fechas inexistentes.

El listado ordena primero los instantes completos de más reciente a más antiguo; los registros sin instante se dejan en orden de consulta por año y referencias. Si la selección contiene instantes incompletos o duplicados, no se anuncia cuál fue el último enfrentamiento. Con cronología inequívoca, se muestran hasta cinco encuentros disputados más recientes **dentro del alcance seleccionado y filtrado**, sin afirmar que son los últimos de toda la historia del club.

Las rachas máximas exigen además que todos los encuentros seleccionados con esos filtros tengan resultado válido. Se calculan victorias e invictos reglamentarios para ambos clubes, ordenando los instantes; no el arreglo ni el número de jornada. Los filtros de localía restringen también la racha: no se presenta una racha como trayectoria general fuera de ese alcance. Una fuente parcial sigue siendo un conjunto parcial de la biblioteca, aunque todos sus registros estén fechados.

## Integridad y persistencia

No se añaden entidades, repositorios, bases de datos, migraciones ni campos de respaldo. Se mantiene JSON v7 y los torneos antiguos. El panel recibe las versiones actuales de los torneos y la actividad; guardar un resultado actualiza la proyección. No persiste acumulados ni modifica resoluciones, calendarios, reglas, importadores o resultados.

## Validación

```powershell
npm test
npm run test:flows
npm run test:e2e
npm run build
```

Pruebas sintéticas para identidades iguales/ambiguas, homónimos, pendientes y estados operativos, localías y filtros, simulaciones con trazabilidad individual, fuentes duplicadas o incompatibles, penales, prórrogas, contexto de ida/vuelta, cronologías incompletas, actualización de resultados, datos antiguos, fuentes retiradas y borradores de navegación.

Resultados registrados el 17 de octubre de 2026:

- `npm test`: **740 pruebas aprobadas en 74 archivos**, 57,14 s en la ejecución final con configuración normal. Son 32 casos añadidos sobre las 708 pruebas anteriores.
- `npm run test:flows`: **62 pruebas aprobadas en 5 archivos**, 35,63 s en la ejecución final.
- `npm run test:e2e -- --workers=3`: **228 pruebas aprobadas**, 10,0 min.
- Después del último ajuste de comparación UTC de eventos individuales, `npm run test:e2e -- --grep "H2H desde centro" --workers=3`: **12 pruebas aprobadas**, 1,2 min. Se volvió a ejecutar H2H en todos los proyectos, junto con la suite unitaria completa; la suite general de navegador no se repitió tras ese ajuste.
- `npm run build`: correcto, sin avisos de tamaño. Panel H2H diferido de 13,07 kB (4,62 kB gzip); JavaScript principal de 381,02 kB (109,51 kB gzip). No se incorporaron dependencias nuevas.

Se ejecutaron Chromium, Firefox y WebKit con ventanas de escritorio 1440×900, notebook 1366×768, tablet 768×1024 y móvil 390×844. Son resoluciones automatizadas, no pruebas en dispositivos físicos. Se revisaron capturas de escritorio y móvil; no se observaron solapamientos en filtros y acumulado, y las comprobaciones de ancho del documento aprobaron. Los recorridos revisan también errores de consola y solicitudes fallidas inesperadas.

El recorrido H2H abre la comparación desde el Centro, selecciona ambos clubes y una fuente, consulta el acumulado, vuelve al torneo conservando un marcador sin guardar, utiliza el acceso del partido, vuelve a la biblioteca con filtros/fuentes conservados y abre H2H desde el perfil. Comprueba que los resultados persistidos siguen siendo los originales.

Una ejecución unitaria completa previa terminó con 739 pruebas aprobadas y un timeout de 5000 ms en la prueba preexistente `app-lazy.test.tsx` de apertura/importación. Esa prueba pasó aisladamente y la siguiente ejecución normal aprobó las 740. No se cambió su timeout ni se excluyeron pruebas. La prueba nueva de ida/vuelta requirió corregir su muestra para registrar las fases reconocidas por el servicio de agregado; no se relajó la validación. El primer recorrido móvil requirió localizar los selectores de clubes por su rol accesible de combobox; el recorrido corregido aprobó y se incluyó en la suite completa.

El informe HTML y las capturas de Playwright conservan la última selección de 12 pruebas; el comando general regenera el informe de las 228. Se reutilizó la infraestructura local existente, con servidor dedicado y contextos aislados. No se abrió ni modificó la biblioteca personal, no se usó Cloudflare y no se consultaron proveedores reales para estas muestras sintéticas. JSON v7 y sus recorridos existentes de exportación/restauración permanecen cubiertos por las suites.

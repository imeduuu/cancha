# Palmarés y récords históricos

## Auditoría y arquitectura

La proyección de consulta `application/services/club-honours.ts` reutiliza `calculateTournamentStatistics`, `getTournamentCompletionStatus`, `getFinalStandings`, los empates pendientes, `getCompletedStageWinners` y las métricas por fase del historial de clubes. No agrega fórmulas para resolver resultados, agregados, penales, tablas o ascensos. Usa las identidades de `buildClubProfiles`: ni nombres iguales ni parecidos conceden títulos de otro registro.

No se modifican reglas deportivas ni servicios de dominio, importadores o simuladores. Los componentes usan los torneos y la actividad actuales. No hay campos nuevos en entidades, escrituras de historial, migraciones, cachés persistentes ni cambios en JSON v7. Las consultas no modifican torneos y se recalculan después de guardar resultados. Las selecciones de consulta usan los borradores de sesión existentes.

## Accesos

- **Biblioteca → Centro → Palmarés y récords históricos**: selecciona competición, años y estadística. El panel se carga bajo demanda.
- **Centro → Historial deportivo de clubes**: el perfil incorpora palmarés y marcas por participación, con los mismos vínculos estrictos de identidad.
- **Estadísticas del torneo**: muestra distinciones, marcas destacadas y detalle por club/fase.

Los respaldos de los rankings abren el torneo existente. Cada registro del palmarés del club tiene también su acción de apertura del respaldo. No se crea una segunda biblioteca. La selección sobrevive a navegar durante la sesión y no se incorpora al respaldo.

## Qué concede una distinción

El campeón debe estar determinado por el servicio existente y la competición debe figurar finalizada. Se rechazan cobertura parcial/desconocida explícita, reglas pendientes/provisionales/de otro año y finales no identificadas inequívocamente. Para copas, se exige una última etapa `Final` (también con prefijo de competición), dos participantes, encuentros para todos los participantes registrados y coherencia entre ganadores y participantes de etapas consecutivas que avanzan ganadores. Las etapas expresamente configuradas para no avanzar ganadores no se reinterpretan.

Una liga completa obtiene subcampeón y puestos tercero/cuarto de su tabla final, salvo empates no resueltos. En copas se usan los participantes de la final resuelta; no se emplea el segundo de una tabla acumulada. Finalistas incluye ambos clubes de la final y semifinalistas los cuatro participantes de la etapa precedente cuando su avance a esa final está acreditado. Son participaciones en esas rondas, no una clasificación global adicional.

La consulta es conservadora: una competición sin conclusión reconocida por los servicios actuales muestra el motivo y no recibe un campeón reconstruido por esta funcionalidad. La Primera argentina con torneos por fases no se convierte en una liga anual por sumar puntos. En Segunda se respeta el estado completo que informa el servicio existente; la fase regular completa no basta para fingir que acabaron los playoffs. No se inventa un subcampeón de playoff.

El [Trofeo de Campeones de la LPF 2026](argentina-champions-trophy.md) usa la final única derivada de Apertura y Clausura y aparece en este mismo palmarés al concluirse.

Cada distinción se etiqueta como escenario local/editado/simulado, proveedor sin certificación oficial o procedencia no acreditada según el servicio de procedencia y el historial de actividad. Un enlace de ESPN no certifica un título oficial. Los registros antiguos sin actividad suficiente conservan esa limitación de trazabilidad.

El indicador previo de campeón en Estadísticas utiliza ahora esa misma condición de confirmación. Una prueba reprodujo que antes mostraba “Campeón: Alfa” pese a `importCoverage: "partial"`; se corrigió exclusivamente la presentación para que no contradiga el palmarés. El cálculo del servicio deportivo permanece intacto.

## Marcas y comparabilidad

Las métricas son las tablas existentes: victorias, puntos de liga, GF, GC y DG del tiempo reglamentario. Prórrogas y tandas no se suman. Se separan fases y grupos; una marca de fase no se anuncia como récord global de toda una copa. En Estadísticas, el encabezado de cada marca identifica expresamente su fase y grupo, y la explicación aclara que no suma fases distintas. Se conservan todos los líderes empatados.

Los rankings requieren selección explícita, año registrado y una sola versión por año. Se rechazan mezclas de competición, formato, cantidad de equipos, etapas, sistema de puntos, criterios, estados de verificación y procedencia. Las copias no entran automáticamente. Si desaparece una fuente seleccionada, se pide revisar la selección.

Los títulos se cuentan por identidad dentro de ese alcance compatible. Las demás marcas se comparan **por temporada**, sin sumar victorias, puntos o goles de años diferentes. El mínimo de GC solo considera clubes con partidos válidos. La consulta muestra cuántos años se seleccionaron y cuántos aportan marcas; para títulos informa también cuántas temporadas tienen campeón acreditado por el cálculo.

Por defecto se excluyen marcas sin cobertura completa de su fase o con reglas sin verificar. La opción de marcas parciales consulta exclusivamente esas fuentes y las etiqueta como no definitivas. No se mezclan parciales y completas en un mismo ranking. Tener todos los partidos publicados disputados no prueba por sí solo un calendario completo.

Las rachas requieren que **cada encuentro del club en la fase** tenga resultado válido y programación validada por el servicio existente, con fecha, hora y zona horaria explícitas, con instantes distintos. Se ordenan esos instantes, no el orden del arreglo ni el número de jornada. Si faltan datos, no se publica una racha. Son rachas del tiempo reglamentario dentro de la fase y de los partidos guardados; no se unen campañas distintas. Los encuentros pendientes o suspendidos impiden calcularlas para ese alcance.

## Pruebas y validación

Las muestras son sintéticas y aisladas, sin acceso a biblioteca personal ni proveedores remotos. Incluyen campeones y subcampeones, ligas incompletas, empates, copas con penales e ida/vuelta, finales incoherentes, playoffs pendientes, identidades ambiguas, puntuaciones diferentes, duplicados, escenarios locales, marcas parciales, cronología de rachas, actualización por resultado y borradores de navegación.

```powershell
npm test
npm run test:flows
npm run test:e2e
npm run build
```

Resultados registrados el 17 de octubre de 2026:

- `npm test`: **708 pruebas aprobadas en 72 archivos**, 53,52 s. Incluye 33 casos añadidos respecto de las 675 pruebas previas.
- `npm run test:flows`: **62 pruebas aprobadas en 5 archivos**, 37,90 s en la ejecución final.
- `npm run test:e2e -- --workers=3`: **216 pruebas aprobadas**, 8,4 min.
- Tras los ajustes finales de cronología, presentación y confirmación del indicador antiguo de campeón, `npm run test:e2e -- --grep "creación, participantes|palmarés y récords históricos" --workers=3`: **24 pruebas aprobadas**, 2,2 min. Esta selección vuelve a ejecutar los dos recorridos afectados en todos los proyectos; la suite completa no se repitió después de esos ajustes.
- `npm run build`: correcto, sin avisos de tamaño. Panel compartido de palmarés/consultas de 21,22 kB (7,38 kB gzip), cargado con las vistas diferidas. JavaScript principal: 391,36 kB (112,57 kB gzip). Sin dependencias nuevas.

Se ejecutaron Chromium, Firefox y WebKit en resoluciones de escritorio 1440×900, notebook 1366×768, tablet 768×1024 y móvil 390×844. Son ventanas automatizadas, no dispositivos físicos. Las comprobaciones inspeccionan errores de consola, solicitudes fallidas inesperadas y ancho del documento. Se revisaron capturas de escritorio y móvil; el selector de fase se ajustó para usar el tamaño de los demás controles, y la lista no asigna puestos ordinales distintos a valores empatados.

El recorrido nuevo selecciona expresamente dos años, compara títulos y puntos sin sumarlos entre temporadas, conserva filtros al navegar, abre el palmarés desde el historial y abre directamente su torneo de respaldo. Comprueba que no cambian los resultados persistidos. La regresión de cobertura parcial del indicador antiguo falló antes de la corrección y aprobó después, sin modificar el servicio de cálculo.

El informe HTML y las capturas de Playwright reflejan la última selección de 24 pruebas; ejecutar el comando completo regenera el informe general. Se reutilizó la infraestructura de [pruebas de navegador](browser-audit.md), con servidor local dedicado y contextos aislados. No hubo túnel público, acceso a la biblioteca personal ni certificación de datos reales de proveedores.

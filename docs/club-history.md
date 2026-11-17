# Historial deportivo y trayectoria de clubes

## Auditoría y alcance

`Team` ya dispone de `id`, `name`, `averageIdentity` y grupo. Las comparaciones de temporadas y los promedios usan distintas relaciones: una posible coincidencia nominal de una comparación no prueba identidad. Las transiciones entre divisiones conservan referencias a torneos, pero algunos cambios de IDs solo conservan nombres de participantes; esos nombres no sirven para vincular clubes desde esta vista.

La proyección reutiliza `calculateStandings`, sus empates irresueltos, `getFinalStandings`, las validaciones de resultados, los servicios de Segunda División, transiciones registradas, promedios e internacionalización. No vuelve a implementar fórmulas deportivas ni altera reglamentos, simulaciones, importadores o resultados.

## Identidad y perfil

En **Biblioteca → Centro de competiciones y temporadas → Historial deportivo de clubes**, busca y selecciona un registro. Se muestran sus nombres registrados, IDs conocidos, identidades históricas expresas, competiciones y temporadas, incluidas las archivadas.

Solo se enlazan registros mediante:

- El mismo identificador de equipo.
- Un valor explícito igual de `averageIdentity` (se quitan espacios exteriores, no se compara por parecido de nombres).
- Una incorporación continental registrada, activa y con referencias exactas al participante de destino y al equipo/torneo de origen.

Las revisiones documentales de nóminas existentes, las coincidencias nominales y las incorporaciones copiadas que requieren revisión no conceden nuevas relaciones de identidad. Un vínculo continental conserva su valor como referencia histórica de IDs aunque su clasificación deportiva quede desactualizada; esa falta de vigencia se muestra por separado.

Si una componente de identidad reúne dos participantes distintos del mismo torneo o identidades históricas contradictorias, todos esos registros se mantienen separados y se advierte la ambigüedad. Los homónimos sin vínculo permanecen separados, aunque sus nombres coincidan exactamente. No se inventan identificadores federativos ni se resuelven colisiones de IDs arbitrariamente.

Si una transición solo conserva nombres y genera IDs nuevos, no se reconstruye la trayectoria por esos nombres. Se necesitan los vínculos explícitos ya disponibles. El perfil expresa las relaciones registradas en Cancha; no certifica por sí mismo identidad federativa.

## Cronología y métricas

La trayectoria se ordena por año explícito; los registros sin año aparecen al final. Cada participación muestra competición, país/categoría cuando están registrados, procedencia, estado del torneo, cobertura y un enlace para abrir el original. Una nómina de planificación sin partidos no se presenta como participación disputada.

Los partidos se separan por fase registrada y grupo. Las fases eliminatorias se identifican por sus etapas declaradas, resolución de cruces o los formatos de Segunda/Primera argentina 2026 ya reconocidos. Un tipo de fase desconocido queda como no acreditado; no se adivina una final por su nombre. No se añade una supuesta clasificación final global de una copa.

PJ, G/E/P, GF, GC y puntos proceden del servicio de tablas. **Son cifras del tiempo reglamentario**: una victoria en prórroga puede conservar un empate en G/E/P; las tandas no suman goles. Las eliminatorias y fases de tipo no acreditado no muestran puntos ni posición de liga. Para validar una vuelta se conserva todo el calendario original como contexto del agregado.

Los empates irresueltos no reciben una posición numérica arbitraria. La etiqueta de posición final exige información suficiente del servicio existente y criterios de tabla verificados para el año. En Segunda puede confirmarse la tabla de fase regular con el calendario completo sin fingir que el playoff pendiente terminó. Los demás órdenes conservan su carácter provisional. Una posición calculada no certifica resultados oficiales.

## Acumulados de selección expresa

No hay un total general automático. El usuario marca registros concretos y puede limpiar la selección. Para sumarlos se exige:

- Misma competición por ID, fase, grupo, formato, sistema de puntos, criterios y estado de verificación de tabla.
- Misma clase de procedencia: escenario local, proveedor sin certificación oficial o procedencia no acreditada.
- Un registro por año explícito. Las versiones duplicadas de una temporada se rechazan.

Las copias independientes conservan su identidad de competición y no se mezclan con el original. Las cifras parciales solo se acumulan por selección expresa y el total informa cuántas fuentes son parciales o no tienen cobertura acreditada. Se muestran años e IDs de los torneos incluidos. No son tasas históricas oficiales ni una reconstrucción de toda la carrera del club.

Si desaparece una fuente seleccionada, se pide revisar y limpiar la selección en lugar de sumarla silenciosamente con las restantes. Los resultados editados se reflejan de nuevo al recalcular.

## Movimientos, copas y cupos

Los ascensos y descensos actuales se consultan con los servicios deportivos existentes. Las transiciones entre Primera y Segunda se consultan cuando hay una relación registrada, sin elegir una pareja por nombres o por coincidencia de año. Los promedios se usan cuando existe su configuración. Los movimientos registrados al preparar una temporada se etiquetan con ese contexto histórico, separados del cálculo actual y sus bloqueos.

Las participaciones en copas nacionales y continentales proceden de sus nóminas guardadas. Los cupos internacionales actuales reutilizan su servicio, conservan estados confirmados por cálculo, provisionales y pendientes, y no inventan el año continental. Las referencias documentales conservan edición, estado al registrar, fuente, decisión y vigencia de dependencias; se puede abrir la copa vinculada. La falta de un cupo registrado no se interpreta como exclusión deportiva.

Las resoluciones oficiales y sus revisiones permanecen en los torneos originales. Esta consulta no altera ni reinterpreta esas decisiones. Los pendientes de movimientos y cupos se conservan visibles.

## Arquitectura, integridad y persistencia

`application/services/club-history.ts` construye identidades, cronología y acumulados de consulta. El panel React se carga bajo demanda, utiliza el catálogo del centro y los borradores en memoria existentes. La búsqueda, el club y la selección del acumulado sobreviven a navegar; no se guardan en el respaldo y una recarga inicia otra sesión de borradores.

No se agregan campos a `Tournament` ni a `Team`, repositorios, bases de datos o migraciones. Se mantiene JSON v7 y se leen torneos antiguos sin inventar país, categoría o año. La vista no escribe resultados ni historiales. Los datos se derivan de las versiones guardadas actuales; las decisiones documentales conservan sus snapshots y avisos de desactualización.

La auditoría detectó y reprodujo una corrección de procedencia: una revisión documental continental, por sí sola, no convierte los resultados publicados en datos simulados. El servicio compartido ahora mantiene esa distinción; una planificación incorporada, una copia pendiente de revisión o una actividad deportiva local siguen marcándose como locales.

## Validación

Pruebas sintéticas para cronología, homónimos, identidad expresa y ambigua, referencias continentales, versiones duplicadas, etapas, vueltas, prórrogas, movimientos, cupos, datos parciales, cambios de resultados, respaldos antiguos y borradores.

```powershell
npm test
npm run test:flows
npm run test:e2e
npm run build
```

El recorrido nuevo de navegador abre el historial desde el centro, distingue dos clubes homónimos, acumula dos años elegidos, vuelve al torneo con un marcador sin guardar y comprueba que no se alteraron los resultados persistidos. Después guarda expresamente ese resultado desde el calendario: el historial actualiza sus cifras y rechaza el acumulado que mezcla la temporada editada con datos de proveedor. Usa los contextos aislados y el servidor local de [la auditoría de navegador](browser-audit.md), sin biblioteca personal ni túnel público.

Resultados de ejecución (17 de octubre de 2026):

- `npm test`: **675 pruebas aprobadas en 70 archivos** (53,80 s), con la configuración normal.
- `npm run test:flows`: **62 pruebas aprobadas en 5 archivos** (27,71 s).
- `npm run build`: correcto; TypeScript y Vite sin aviso de tamaño. El panel se genera como fragmento diferido de 15,26 kB (5,40 kB gzip); el JavaScript principal mide 391,70 kB (112,83 kB gzip).
- `npm run test:e2e -- --workers=3`: **204 pruebas aprobadas** (8,3 min).
- `npm run test:e2e -- --grep "historial de clubes desde el centro" --workers=3`: **12 pruebas aprobadas** (1,3 min), después de ampliar el recorrido para guardar el resultado y comprobar su efecto en el historial.

Se ejecutaron Chromium, Firefox y WebKit con ventanas de escritorio (1440×900), notebook (1366×768), tablet (768×1024) y móvil (390×844). Son navegadores automatizados con esas resoluciones, no pruebas en dispositivos físicos. El recorrido comprueba el ancho del documento y se revisaron capturas de escritorio y móvil sin solapamientos ni desbordamiento horizontal observado en la ficha. El HTML de Playwright conserva la última ejecución focalizada; el comando completo regenera el informe de toda la suite.

Durante una ejecución inicial de la suite general falló la prueba preexistente de timeout de `dev:public` por su presupuesto de 50 ms (una sola consulta alcanzada en vez de varias). Una ejecución con dos workers aprobó 674 pruebas antes de añadir el último caso de interfaz; la ejecución final normal aprobó las 675. No se modificó el túnel ni su prueba para sortear ese fallo temporal.

No se consultaron proveedores remotos para estas pruebas ni se certificaron resultados oficiales: los fixtures son sintéticos. La biblioteca personal no se abrió ni se modificó.

## Palmarés y récords

Consulta el [palmarés y los récords históricos](club-honours.md), derivados de los torneos guardados con selección expresa y separación de procedencias.

## Enfrentamientos directos

Consulta el [historial H2H entre clubes](head-to-head.md), con identidad expresa, filtros y fuentes seleccionadas.

## Rendimiento deportivo

Consulta el [panel de rendimiento y evolución de clubes](club-performance.md), con gráficos accesibles y comparación de participaciones compatibles.

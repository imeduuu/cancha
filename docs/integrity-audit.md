# Auditoría funcional e integridad deportiva

Fecha: 16 de octubre de 2026. Alcance: código local, contratos de proveedores, pruebas automatizadas y compilación de producción. No se revalidaron reglamentos contra nuevas publicaciones ni se importaron partidos reales. Las correcciones se limitan a conservación de datos, coherencia entre servicios, comprobaciones de temporada y estados de verificación; no introducen criterios deportivos nuevos.

## Hallazgos corregidos

| Prioridad | Problema reproducido | Causa y corrección | Evidencia |
| --- | --- | --- | --- |
| Alta | Una actualización que conserva resultados perdía jugadores, inscripciones, alineaciones, sustituciones, reglamentos y procedencia de temporada | Se reconstruía el torneo sin esos campos. Ahora se conservan los campos locales, reglas guardadas, identidad histórica del club y el estado archivado; se mantienen los metadatos del partido coincidente | `import-official-tournament.test.ts`: memoria y guardado/restauración con localStorage |
| Alta | Un proveedor podía omitir un partido con resultado y borrarlo en modo conservador | La unión solo recorría los partidos publicados. La actualización ahora se rechaza antes de escribir si desaparece o cambia de participantes un partido con datos locales. Las fases locales de promoción mantienen su reconciliación existente | `import-official-tournament.test.ts`: fuente sin un resultado registrado |
| Alta | Reimportar podía volver a contar un marcador suspendido; importar un calendario posterior podía reemplazar una suspensión sin marcador por el estado final del proveedor | Se preservaba el resultado pero no todos los estados operativos. Ahora las interrupciones locales se mantienen, con o sin marcador, y siguen excluidas de los cálculos finales | `import-official-tournament.test.ts`, `season-preparation.test.ts` |
| Alta | Cupos internacionales confirmados con reglas de tabla pendientes o calendario de cobertura parcial/desconocida | Se comprobaban solo las reglas de cupos y los partidos presentes. Se incluyen la verificación de la tabla y la cobertura declarada antes de confirmar | `international-qualification.test.ts`: tres casos inicialmente fallidos |
| Alta | Los promedios podían mezclar otra competición del mismo año o elegir arbitrariamente uno de dos historiales | La selección se hacía solo por año. Ahora se delimita por competición, se detecta ambigüedad histórica y se mantiene provisional cualquier resultado que dependa de ella | `relegation-averages.test.ts` |
| Alta | Promedios confirmados con cobertura incompleta; partidos eliminatorios incluidos en el total argentino | Se contaban todos los partidos presentes. Se revisan cobertura, existencia de encuentros, verificación de tabla y temporadas; en LPF se usa el mismo alcance regular que ya emplean la tabla anual y la transición | `relegation-averages.test.ts`: cobertura, competición y fase regular |
| Alta | Ascensos, descensos y puestos de playoff confirmados con reglas guardadas explícitamente pendientes | Los motores no revisaban siempre esos indicadores. Un guard compartido impide confirmar; las configuraciones ausentes siguen siendo válidas para torneos locales antiguos | `second-division-progression.test.ts`, `placement-classification.test.ts`, `tournament-statistics.test.ts` |
| Media | ESPN podía devolver explícitamente un año distinto y etiquetarse como 2026 en Primera o copas continentales | Se confiaba en el parámetro de consulta. Ahora se rechaza el año explícito incompatible, manteniendo compatibilidad con las respuestas antiguas que no traen ese campo | Pruebas de ambos adaptadores ESPN, con respuestas sintéticas de otro año |
| Media | Nuevos participantes de un cruce heredaban la cobertura de eventos verificada del anterior | Se eliminaban los eventos pero quedaba `eventsCoverage`. Ahora también se reinicia esa marca al reconciliar participantes | `knockout-fixture-reconciliation.test.ts` |
| Media | La edición anual ofrecía criterios que la tabla genérica descarta | Se usaba la lista completa de criterios de todos los torneos. El editor y el caso de uso admiten únicamente los criterios configurables soportados; no se extienden reglas de tarjetas o numeración a otros campeonatos | `season-preparation.test.ts`: criterio no soportado rechazado |
| Media | Un módulo diferido rechazado podía desmontar todo el espacio de trabajo | `Suspense` solo cubría la espera. Cada panel tiene ahora un límite de error que informa el fallo y deja utilizables los demás paneles; recargar es una acción explícita | `deferred-panel.test.tsx`: rechazo de módulo y edición conservada en un panel vecino |
| Media | El historial describía las importaciones ESPN como una fuente oficial | El texto y la procedencia estaban fijados a `official`. Ahora se registra el proveedor declarado y su URL sin certificarlo como federación | `import-official-tournament.test.ts`: actividad persistida |

Las pruebas añadidas para conservación, coberturas, temporadas, reconciliación y bloqueos se ejecutaron primero contra la implementación anterior y reprodujeron los fallos. Las pruebas adicionales de integración cubren las correcciones completas.

## Revisión de arquitectura

Se inspeccionaron las importaciones estáticas de los módulos de producción en las cuatro capas. No se detectaron dependencias de `domain` hacia las capas superiores ni de `application` hacia infraestructura o presentación. Los adaptadores implementan puertos; la presentación compone los proveedores y llama casos de uso. Las pruebas que importan varias capas se excluyeron de esta comprobación.

Hay ciclos de tipos entre entidades y entre entrada/validación; también un ciclo de funciones entre tablas y el programa de desempate oficial. No se reestructuraron: no se reprodujo un fallo de inicialización y las pruebas de esas rutas se conservan. Las declaraciones `lazy` siguen fuera de `App`; los proveedores se cargan mediante `import()` únicamente al solicitarlos.

Las tablas, resoluciones, transición y estadísticas continúan consumiendo los servicios deportivos existentes. La discrepancia de alcance de promedios sí se corrigió porque producía totales diferentes de la tabla anual.

## Cobertura de la revisión

| Área | Comprobaciones revisadas y ejercitadas |
| --- | --- |
| Tablas y desempates | Criterios ordenados, enfrentamiento directo, cobertura de tarjetas, numeración, empates sin resolver y exclusión de estados no finales |
| Grupos y eliminatorias | Calendarios continentales, cruces únicos, ida/vuelta, global, prórroga, penales y limpieza de datos cuando cambian los clasificados |
| Simulación | Modos pendientes/sobrescritura, resultados válidos, estados suspendidos/cancelados excluidos, generación progresiva de fases y aleatoriedad inyectada |
| Argentina y Brasil 2026 | Final por el primer ascenso, Reducido, reordenamientos y prioridad reglamentaria; playoffs de Série B; descensos y transición coordinada |
| Resoluciones oficiales | Participantes exactos, fuentes AFA/CBF, verificación manual, snapshots de dependencias, invalidación, revisiones y programa explícito de descenso múltiple |
| Temporadas | Misma competición/año, snapshots desactualizados, nuevos participantes, reglas pendientes, confirmación de discrepancias y conservación de temporadas anteriores |
| Importadores | ANFP, ANFA, copas nacionales, ESPN nacional/continental y calendarios posteriores; formato, duplicados, participantes, estados y errores HTTP/JSON |
| Persistencia | localStorage, validación antes de guardar, rollback de escrituras coordinadas, archivos JSON v7 y anteriores, datos dañados preservados, recuperación e historial |
| Interfaz | Biblioteca, navegación a módulos diferidos, filtros y ediciones de calendario conservadas, fallos de carga aislados, paneles con torneos antiguos |

## Límites y decisiones conservadas

- La auditoría comprueba la implementación y sus contratos con datos sintéticos. No certifica documentos ni garantiza que un proveedor externo conserve su formato.
- Cuando un adaptador antiguo no publica el año explícito, se mantiene la compatibilidad existente. Un año explícito incorrecto se rechaza; el importador de calendarios posteriores exige acreditar el año tanto en partidos como en nómina.
- La falta de configuración opcional no invalida un torneo antiguo. Un estado de verificación explícitamente pendiente sí impide confirmar los resultados que dependan de él.
- Los formatos futuros siguen sin inferirse; registrar un documento anual no implementa automáticamente playoffs ni habilita transiciones desconocidas.
- La liguilla chilena conserva su advertencia de formato provisional. No se la promovió a reglamento oficial verificado.
- Las operaciones de simulación siguen siendo síncronas y la simulación completa persiste por etapas. No se añadieron workers, cachés ni transacciones nuevas sin una reproducción que justificara ese cambio.
- localStorage no ofrece transacciones entre claves. Se mantienen las restauraciones de valores anteriores y el error explícito si también falla el rollback; no se promete atomicidad frente al cierre abrupto del navegador.
- No se cambiaron el esquema JSON v7, los criterios oficiales de 2026 ni el umbral de tamaño de Vite.

## Validación reproducible

Ejecutar `npm test`, `npm run build` y, para comprobar las fronteras de carga, `npm run analyze:bundle`. Las pruebas de cada hallazgo se encuentran en los archivos indicados en la tabla. Los resultados finales de esta ejecución se comunican junto con el informe.


## Resultado de esta ejecución

- `npm test`: **518 pruebas aprobadas en 57 archivos**. No se aumentaron los tiempos límite para obtener este resultado.
- `npm run build`: TypeScript y Vite completados, sin aviso de fragmentos mayores de 500 kB.
- Análisis de producción: **421,23 kB de JavaScript inicial**, incluidas sus dependencias estáticas; **121,37 kB gzip** con Node. Total disponible con fragmentos diferidos: **601,11 kB**. Las comprobaciones y el aislamiento de errores añaden aproximadamente 2,19 kB a la carga inicial frente a la medición anterior de 419,04 kB.
- No se modificaron dependencias ni el formato JSON v7. Las pruebas de compatibilidad, restauración e historial existentes siguen pasando.

Durante la validación se ajustó el guard de campeón para depender de la tabla verificada, sin supeditarlo a cupos provisionales independientes. Un dato del test histórico de sistemas de puntos se corrigió para que el año del reglamento coincidiera con la temporada que pretendía representar; se mantuvieron sus aserciones de incompatibilidad. La suite final se ejecutó sin compilar en paralelo para evitar los tiempos de espera observados en las pruebas de interfaz bajo carga concurrente.

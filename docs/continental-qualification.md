# Clasificación internacional entre temporadas

## Auditoría de la implementación

La aplicación ya calcula cupos con `calculateInternationalQualifications`, utilizado por la tabla de posiciones. El servicio consume reglas explícitas de `competitionRules.internationalQualification`: posiciones, campeones de copas referidos por ID y corrimiento `next-eligible-position` únicamente cuando está configurado. Comprueba temporada de liga y copa, resultados, cobertura, verificación y empates irresueltos. No equipara clubes de competiciones diferentes por parecido de sus nombres.

Las franjas de `placementRules` son otra cosa: representan posiciones base con `classifyPosition`. Ahora se convierten en entradas posicionales provisionales para el mismo servicio internacional, que también conserva sus bloqueos por empate. No se inventan corrimientos ni derechos para el campeón de una franja.

Estado encontrado en los presets del código, sin convertirlo en una nueva verificación reglamentaria:

| Competición | Situación de los cupos |
| --- | --- |
| Primera argentina 2026 | Posiciones base y condiciones pendientes por campeones de Apertura, Clausura y Copa Argentina. Se consulta la tabla anual de fases regulares, sin sumar playoffs. |
| Série A 2026 | Posiciones base; criterios de tabla pendientes y corrimientos por copa sin verificar. |
| Primera chilena 2026 | Tabla pendiente y posiciones provisionales con condiciones de copa/Chile 4. |
| Copas nacionales y Copa de la Liga chilena | Un campeonato no otorga automáticamente un cupo: necesita referencia explícita en una regla de clasificación. |
| Segundas divisiones | No se agregan derechos internacionales que su configuración no contenga. |
| Libertadores y Sudamericana | Son destinos; no se usan como fuentes nacionales ni se heredan sus reglas a futuras ediciones. |

No había metadatos que asociaran automáticamente cada temporada nacional a una edición continental ni un registro persistente de procedencia de participantes. Se agregó esa relación documental sin modificar los presets deportivos.

## Uso desde el centro

En **Biblioteca → Centro de competiciones y temporadas**, selecciona una competición y abre **Clasificación internacional y ediciones continentales** en su temporada.

1. Elige Libertadores o Sudamericana, la temporada nacional de origen y la edición continental. Desde una temporada nacional, el campo de edición empieza vacío: no se supone que todos los países clasifican a la misma edición por una fórmula anual.
2. Selecciona las competiciones nacionales de origen. Se muestran clasificados confirmados por cálculo verificado, provisionales, pendientes y sus dependencias. Las zonas sin una tabla anual única registrada no se combinan.
3. Selecciona los equipos elegibles. Los pendientes y los conflictos de identidad permanecen bloqueados. Un provisional puede incorporarse a una planificación local con advertencia expresa; no se transforma en clasificación definitiva.
4. Registra URL HTTPS y una decisión documental que explique la relación entre temporadas, las fuentes y las discrepancias. La URL no se descarga ni se certifica automáticamente.
5. Revisa y confirma en el diálogo. La revisión se comprueba otra vez frente a los datos guardados antes de escribir.

Si la edición no existe, se crea una copa de **planificación local**, únicamente con los seleccionados, sin zonas, fases, cruces, calendario, plantillas copiadas ni reglamentos futuros heredados. Su reglamento queda pendiente.

Si ya existe, la operación registra **solo una revisión documental**, conservando participantes, plantillas, calendario y resultados. Muestra previstos ausentes, participantes fuera de esa selección parcial y coincidencias nominales por revisar. Una selección parcial no acredita que el resto de los participantes publicados sea incorrecto. Cuando hay varias copas guardadas de la misma edición, hay que abrir el destino concreto: no se elige uno arbitrariamente. Este flujo no reemplaza ni amplía la nómina de una edición existente.

Desde una copa nacional también se identifican las ligas que la referencian expresamente por ID para otorgar un cupo; se puede consultar el cálculo de esas ligas. Desde la temporada nacional se pueden abrir las ediciones vinculadas. Desde la copa se consultan las revisiones, estados al registrar, fuentes y competición/temporada de procedencia. Se conservan los nombres históricos y los IDs cuando falta un origen. Sin una relación registrada no se atribuye procedencia por coincidencia de nombres.

## Integridad y procedencia

- El estado **confirmado** significa que el cálculo satisface las reglas verificadas registradas. No certifica que los resultados ni la lista de participantes sean oficiales.
- Los eventos de simulación o edición de la liga o de la copa de origen identifican escenarios locales. Los proveedores externos y los datos sin historial suficiente quedan sin certificación oficial; la planificación creada siempre es local.
- Los destinos se vinculan mediante los identificadores explícitos existentes (`conmebol-libertadores`, `libertadores`, `libertadores-qualifying`, `conmebol-sudamericana`, `sudamericana`). Los textos desconocidos no se interpretan por similitud.
- IDs de club repetidos, identidades normalizadas ambiguas y cupos incompatibles se informan sin fusionar clubes. No hay un botón para conceder un cupo ignorando el conflicto: hay que revisar los datos/reglas de origen.
- Las proyecciones de consulta se recalculan. Cada revisión guardada conserva dependencias de sus ligas y copas, incluyendo ausencia de una copa referenciada. Si cambian resultados, estados operativos, tarjetas, participantes, reglamentos u otros datos deportivos capturados, se muestra **desactualizada**. La copa nunca se modifica como consecuencia automática.
- Se pueden registrar revisiones sucesoras; los registros anteriores y sus pendientes al registrar permanecen disponibles. La vigencia se calcula por comparación con el estado actual, no equivale a una certificación federativa ni a una invalidación irreversible.

## Arquitectura y compatibilidad

`domain/services/international-qualification.ts` conserva el cálculo deportivo y añade únicamente el ID explícito de origen a su resultado. `continental-plan.ts` valida la estructura del registro documental y su edición. La proyección en `application/services` reutiliza los servicios deportivos; el caso de uso controla revisión, concurrencia, confirmación y escritura coordinada con actividad. El panel React se carga al abrirlo y usa los borradores de sesión existentes.

La extensión opcional `Tournament.continentalPlans` usa esquema interno 1. Se mantiene **JSON v7** y se aceptan respaldos anteriores sin esa extensión. Se validan los campos, referencias internas, documentación y snapshots antes de persistir/restaurar. Los snapshots se serializan de forma canónica para que un respaldo completo no cambie su vigencia por el orden de propiedades JSON.

Las copias remapean referencias a los participantes de destino cuando cambian IDs y quedan marcadas para revisión. Las reimportaciones conservan el historial continental; una revisión con el mismo ID no puede sobrescribirse con contenido distinto. No se trasladan registros automáticamente a otra temporada. La restauración completa de biblioteca sigue sus modos y confirmaciones existentes.

Se reutilizan los eventos `season-created` para la nueva planificación y `regulations-updated` para la revisión documental de una copa existente; sus resúmenes y contenido identifican la operación. No se añade una base de datos ni sincronización remota.

## Pruebas y ejecución

Fixtures sintéticos deterministas, sin acceder a la biblioteca personal ni a proveedores. Se prueban reglas verificadas/provisionales/pendientes, empates, reasignación por copa, procedencia simulada, conflictos, años incompatibles, cambios antes/después de confirmar, conservación de copas, copias, JSON v7/respaldos antiguos, escrituras fallidas, borradores y navegación real desde el centro.

```powershell
npm test
npm run test:flows
npm run test:e2e
npm run build
```

Los navegadores usan el servidor local y contextos aislados de [la auditoría de navegador](browser-audit.md). El caso nuevo comprueba la confirmación antes de escribir, la procedencia tras recargar y el ancho del documento. No se usa Cloudflare ni se verifica una lista federativa real con estos fixtures.

Resultados finales del 17 de octubre de 2026:

| Comando | Resultado |
| --- | --- |
| `npm test` | 646 pruebas aprobadas, 68 archivos |
| `npm run test:flows` | 62 recorridos aprobados, 5 archivos |
| `npm run test:e2e -- --workers=3` | 192 pruebas aprobadas, sin reintentos, 6,8 minutos |
| `npm run build` | TypeScript y Vite correctos, sin aviso de tamaño |

Después de los últimos ajustes de procedencia y validación se repitió el caso continental con `npm run test:e2e -- --grep "clasificación internacional documentada" --workers=3`: sus 12 proyectos pasaron. Se ejecutaron Chromium, Firefox y WebKit en 1440×900, 1366×768, 768×1024 y 390×844; son resoluciones automatizadas, no pruebas en dispositivos físicos. Se inspeccionaron capturas de escritorio y móvil; la prueba controla además el ancho del documento, errores de consola y solicitudes fallidas. El informe HTML de Playwright corresponde a la última ejecución específica; la suite completa regenera su informe completo.

Se agregaron 32 casos unitarios/de componentes y un recorrido de navegador ejecutado en 12 proyectos. La detección de escenarios locales se comparte con el centro e incluye las decisiones explícitas de importar un archivo como copia. Se comprobaron registros inválidos de respaldo, incluidos snapshots ilegibles, referencias/documentos incompatibles, identidades repetidas y supuestas incorporaciones sin participante de destino o con un cupo pendiente.

Estas pruebas no verifican nuevas reglas oficiales ni listas federativas publicadas: utilizan datos sintéticos. Los presets de 2026 conservan su estado anterior. Las copas existentes se mantienen como destinos de revisión documental; el flujo no reemplaza ni amplía sus participantes.

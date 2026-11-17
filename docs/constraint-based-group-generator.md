# Generador local de grupos con restricciones

## Auditoría inicial y reutilización

La implementación previa ya tenía `DrawConfiguration` y su guard en `domain/entities/draw-configuration.ts`, validación estructural y de distribuciones manuales en `application/services/draw-configuration.ts`, revisión/confirmación de configuraciones en `configure-stage-draw.ts`, y preparación de grupos/calendarios en `prepare-stage-draw.ts`.

| Área auditada | Reutilización |
| --- | --- |
| Participantes y grupos | `Team.id` identifica participantes. `Team.groupName` sigue siendo la única composición persistida. Los grupos y sus capacidades se leen de `inspectDrawPreparation`; no se crean nuevos grupos. |
| Bombos y restricciones | El mismo `DrawConfiguration` y la misma actividad `draw-configuration-recorded`; no se añade otro modelo de bombos ni otra biblioteca. |
| Admisión, reglas, dependencias | `inspectDrawPreparation`, `validateDrawConfiguration`, integridad y bloqueos de los servicios deportivos actuales. Una fuente pendiente, asignaciones incompletas o fundamentos desactualizados bloquean la generación definitiva. |
| Distribución manual | Se reutiliza `validateManualDrawConfiguration`. Se extrae su comprobación previa de grupos, capacidades y participantes a `validateRegisteredGroupDistribution`, compartida por la revisión manual y el generador. |
| Revisión y confirmación | `reviewStageDraw` y `confirmStageDraw`; no hay un segundo mecanismo de guardado. La revisión deportiva completa se ejecuta también al terminar una búsqueda con solución. |
| Sorteos anteriores | Se bloquea cualquier registro previo, aunque esté desactualizado; no se sobrescribe. Los encuentros o resultados existentes conservan sus bloqueos anteriores. |
| Actividad y v7 | `StageDrawRecord` se conserva en `stage-draw-confirmed`. La extensión opcional de procedencia pasa por su guard y `isActivityEvent`. El formato de respaldo sigue en versión 7. |
| Coordinación | La confirmación de la interfaz usa `LibraryWriteContext`, `repository.coordinate` y el Web Lock global existente `cancha.save-checkpoints`. La búsqueda y la revisión solo leen. |
| Calendario y simulación | El mismo flujo de revisión y confirmación de calendario; el generador no programa ni simula. |

Los formatos particulares que antes exigían sus servicios específicos mantienen `manualBlocker`: no se habilitan automáticamente sorteos continentales, de divisiones especiales, eliminatorias, copas sin grupos ni formatos desconocidos. Las asociaciones siguen sin identidades verificables y continúan no soportadas. No se consultan fuentes externas.

## Arquitectura

- `constraint-group-generator.ts`: búsqueda acotada y reproducible sobre referencias de la configuración existente.
- `generate-local-groups.ts`: inspección de compatibilidad, instantánea, ejecución asíncrona, propuesta transitoria vinculada mediante token privado y acceso a la revisión deportiva existente.
- `local-group-generator.tsx`: acciones explícitas y vista previa dentro de la etapa de grupos del Centro de sorteos.
- `prepare-stage-draw.ts`: valida la modalidad generada y conserva su procedencia; la confirmación existente no importa ni llama al solucionador.

No se busca al abrir el Centro ni al consultar información. La inspección de compatibilidad y las validaciones estructurales no son búsquedas de distribuciones. Los límites de tamaño se comprueban antes de la validación adicional potencialmente costosa de la configuración. Si exceden los recursos admitidos, la validación completa y la búsqueda quedan sin determinar y no se produce una propuesta.

## Algoritmo elegido

Backtracking de asignación de **participantes a grupos**, con selección MRV del participante que tenga menos grupos disponibles. La semilla determina el orden de desempate de participantes y de exploración de grupos, sin cambiar restricciones ni elegir identidades por nombre.

Cada nodo:

1. Comprueba cancelación, tiempo y presupuesto de nodos.
2. Calcula los dominios de los participantes restantes. Descarta grupos llenos, grupos distintos del exigido por una posición fija, cuotas de bombo ya completas y grupos que contengan incompatibles.
3. Poda si un participante no tiene dominio; si un grupo no tiene suficientes candidatos para sus plazas; si una cuota no tiene candidatos suficientes; o si las cuotas restantes exceden las plazas restantes.
4. Asigna el participante más restringido a cada grupo permitido, explora y deshace el estado al retroceder.
5. Al completar la asignación, materializa posiciones explícitas y vuelve a ejecutar las validaciones compartidas de participantes, grupos, capacidades y restricciones.

Las incompatibilidades se compilan como máscaras `BigInt`, con una máscara de ocupación por grupo. Los recuentos de grupo y de bombo se actualizan y deshacen en cada rama. No se usan intentos aleatorios repetidos ni reinicios hasta acertar. Los grupos conservan su identidad; no se fusionan estados basándose en nombres o supuestas equivalencias reglamentarias.

### Posiciones y exhaustividad

El catálogo solo exige posiciones **fijas**; no contiene otras relaciones ordinales ejecutables. Por eso basta explorar la pertenencia a grupos. Los participantes con posición fija solo pueden entrar al grupo indicado. Una vez asignados todos, se reservan esas plazas y se rellenan las libres en un orden explícito derivado de la semilla. La validación estructural previa garantiza que las plazas fijas existen y no colisionan. Una composición válida siempre puede completar sus plazas libres sin otra búsqueda ordinal.

Las podas son condiciones necesarias, no estimaciones de viabilidad. Si se termina de explorar todo el árbol sin solución, se demuestra imposibilidad para el catálogo soportado. Si se interrumpe antes, no se afirma imposibilidad.

Las cabezas de serie solo tienen las restricciones explícitas registradas. Ser cabeza de serie, campeón o primer integrante de un bombo no añade separación, posición ni privilegio.

## Estados de viabilidad

| Estado | Significado |
| --- | --- |
| **Viable** | Se encontró una distribución y pasó la validación completa compartida, incluida la revisión deportiva existente. |
| **Imposible** | La configuración permitió iniciar la búsqueda y se exploró completamente el espacio pertinente sin solución. |
| **No determinado** | Se alcanzó un límite, se canceló o se excedió el tamaño soportado; no hay prueba de imposibilidad. |
| **Configuración inválida** | Hay errores estructurales, datos pendientes, restricciones no soportadas, incompatibilidad de formato, una revisión desactualizada o cambio de biblioteca. No se utiliza como fundamento definitivo. |

Las contradicciones estructurales ya detectables por `validateDrawConfiguration` se presentan como configuración inválida antes de buscar. El fixture de imposibilidad usa un ciclo impar de incompatibilidades que supera esa validación estructural y requiere explorar asignaciones.

## Presupuestos y respuesta de la interfaz

Valores de producción:

| Recurso | Límite |
| --- | --- |
| Nodos | 100.000 |
| Comprobaciones de dominio | 2.000.000 |
| Tiempo de búsqueda | 1.500 ms con reloj monotónico |
| Lote | 2.048 comprobaciones; después se cede al bucle de eventos con `setTimeout` |
| Participantes | 96 |
| Grupos | 32 |
| Restricciones | 256 |
| Relaciones previas de incompatibilidad | 100.000, contando el cuadrado del tamaño de las listas |

Los límites son conservadores y no acreditan viabilidad. No se añade una biblioteca de optimización ni un Worker: los lotes cooperativos y los límites permiten devolver el control y cancelar sin introducir otro protocolo. El presupuesto temporal es un límite cooperativo, no una garantía de latencia exacta: un lote, la validación previa/final, el navegador o la recolección de memoria pueden añadir tiempo. Se registran nodos, comprobaciones, lotes y milisegundos del solucionador.

Las pruebas de complejidad usan reloj y cooperación controlados, verificando presupuestos de operaciones y terminación sin umbrales temporales ajustados. La medición separada usa el reloj y la planificación de producción y registra sus resultados sin una aserción frágil sobre milisegundos exactos.

## Semillas y propuestas repetidas

El método versionado es `constraint-groups-v1`. Utiliza hash FNV-1a sobre las unidades UTF-16 de la semilla y un PRNG de 32 bits tipo Mulberry32 para Fisher–Yates. Las identidades se ordenan por código antes de variar el orden; no se toma el orden de pantalla, tablas o `Team[]` como identidad ni posición.

La misma configuración y semilla reproducen la misma propuesta cuando el presupuesto permite alcanzar la solución. Un límite temporal puede producir «No determinado» bajo otra carga, sin devolver una propuesta distinta como si fuera el mismo resultado. Semillas diferentes pueden producir la misma distribución o distribuciones distintas. No se garantiza uniformidad, cobertura de todas las soluciones ni independencia estadística.

**Generar otra propuesta** cambia de forma visible la semilla mediante un sufijo consecutivo y ejecuta otra búsqueda explícita. No implementa una búsqueda de alternativa que excluya la solución anterior: por eso no acredita que exista otra solución ni que la anterior sea única. Compara la identidad de los grupos sin contar meras permutaciones de sus integrantes cuando no hay posiciones fijas. Cuando hay posiciones explícitas, también compara los ordinales. Si coincide, lo informa y conserva la propuesta anterior con su semilla original.

## Interfaz, vista previa y confirmación

La sección de la etapa muestra competición, año, universo, participantes, bombos, condiciones, cabezas de serie, revisión documental y viabilidad. Incluye:

- **Comprobar viabilidad**: análisis explícito sin publicar todavía una propuesta visual.
- **Generar distribución local** y **Generar otra propuesta**: propuestas en memoria.
- **Cancelar búsqueda**: cancela sin registrar hechos deportivos.
- **Revisar distribución**: obtiene la revisión vigente del flujo de sorteos.
- **Descartar propuesta local**: elimina solo el borrador de memoria.

Las tarjetas muestran grupo, plazas, clubes, bombo y orden explícito. Informan las restricciones comprobadas y la advertencia de procedencia local. La generación no cambia `Team.groupName`, no crea encuentros ni asigna fechas o estadios. La vista previa de confirmación muestra la semilla y la revisión utilizada.

Durante una revisión pendiente se bloquean los controles de generación. Cambiar la biblioteca invalida el trabajo en memoria y cancela búsquedas; cambiar de universo desmonta el contexto incompatible o impide revisar. Los tokens privados de propuesta se vinculan a contenido e instantánea: no se pueden restaurar, clonar o alterar para convertirlos en confirmaciones válidas.

La confirmación toma el Web Lock global mediante el coordinador de App, comprueba su instantánea y llama a `confirmStageDraw`. Este caso de uso revalida universo, competición, año, participantes, configuración y revisión, fuentes, restricciones y conflictos. Confirma exactamente los grupos revisados, sin ejecutar de nuevo el solucionador, regenerar semilla ni consumir azar deportivo. El UUID del evento sigue perteneciendo al servicio existente de actividad.

## Procedencia, persistencia y protección deportiva

Extensión mínima de `StageDrawRecord` versión interna 1:

```ts
mode: "generated";
configurationRevision: number;
generation: {
  method: "constraint-groups-v1";
  seed: string;
};
```

`generation` solo se permite para esa modalidad, únicamente con grupos, semilla explícita de 1–128 caracteres y revisión positiva. Los registros anteriores sin estos metadatos conservan su validez. La fuente de una configuración documental verificada se conserva como referencia; no convierte la distribución local en un sorteo oficial.

Se mantiene `stage-draw-confirmed`, sin otra acción de guardado. La actividad diferencia `manual`, `documented`, `local` del servicio predeterminado y `generated`. Los eventos anteriores, reglas, encuentros y resultados no se cambian. La configuración utilizada queda protegida por los bloqueos existentes después de confirmar.

El respaldo completo y la restauración siguen en JSON **v7**. `isStageDrawRecord` valida los metadatos y `isActivityEvent` los exige al leer la actividad. Se conserva `configurationRevision`; una configuración distinta o retirada impide programar desde ese vínculo. Los sorteos históricos sin vínculo no reciben reglas retroactivas.

El flujo posterior sigue siendo distribución confirmada → revisión de encuentros → confirmación de calendario → simulación explícita. La revisión de calendario contrasta otra vez los grupos y su configuración, sin buscar otra distribución.

## Pruebas y errores de desarrollo

Pruebas nuevas:

- `generate-local-groups.test.ts`: estados, capacidades, cuotas, incompatibilidades, posiciones, participantes ausentes/duplicados, bombos incompletos, fuentes, cabezas de serie, semillas, repetición de una solución única, búsquedas sin escrituras, confirmación sin solucionador/azar, obsolescencia, universo, concurrencia, protección de resultados, v7, restauración, calendario y simulación.
- `local-group-generator.test.tsx`: consulta sin búsqueda, generación/revisión sin escrituras, propuesta idéntica declarada honestamente, controles bloqueados e invalidación externa.
- `constraint-group-generator.performance.test.ts`: mediciones controladas para 8, 32, 64 y 96 participantes.
- Cuatro recorridos Playwright, ejecutados con los navegadores y tamaños existentes: configurar/generar/revisar/confirmar/calendario, imposibilidad sin escritura, dos pestañas y cambio de universo sin compartir bombos.

Los resultados exactos se conservan en `docs/validation/constraint-based-group-generator/`. No se cambian timeouts ni reintentos. Las capturas revisadas de la vista previa están en `generator-desktop.png` y `generator-mobile.png`.

La última ejecución focalizada aprobó **78 pruebas en 4 archivos** (6,88 s), incluyendo la cancelación de una búsqueda cuando otra revisión queda pendiente. La ejecución focalizada corregida de Chromium aprobó **8/8 E2E** en escritorio y móvil (45,3 s). Se conservan `focused-final.log` y `e2e-focused-corrected.log`.

Mediciones de búsqueda con reloj y planificación reales de esa ejecución, semilla sintética fija y cuotas explícitas; no son garantías de latencia:

| Participantes | Grupos | Estado | Nodos | Comprobaciones | Lotes | Tiempo |
| --- | --- | --- | --- | --- | --- | --- |
| 8 | 2 | Viable | 9 | 72 | 0 | 1,67 ms |
| 32 | 8 | Viable | 33 | 4.224 | 2 | 7,33 ms |
| 64 | 8 | Viable | 65 | 16.640 | 8 | 88,82 ms |
| 96 | 16 | Viable | 97 | 74.496 | 36 | 518,05 ms |

Resultados completos de validación del 11 de noviembre de 2026:

| Ejecución | Resultado |
| --- | --- |
| `npm test` | **Falló**: 107 archivos aprobados y 2 fallidos; 1.177 pruebas aprobadas y 2 fallidas, 1.179 totales; 101,63 s. `npm-test.log`. |
| `npm test -- --maxWorkers=4` | **Aprobó**: 109 archivos y 1.179 pruebas; 127,11 s. `npm-test-maxWorkers4.log`. |
| `npm run test:flows` | **Falló**: 9 archivos aprobados y 1 fallido; 91 pruebas aprobadas y 1 fallida; 58,58 s. Timeout de 5.000 ms en el recorrido documental de `app-decisions`. `test-flows.log`. |
| `npm run test:e2e` | **Aprobó**: 600/600 casos, 26,9 minutos, sin reintentos. Incluye 48 recorridos nuevos: cuatro casos en cada una de las doce combinaciones existentes de navegador y tamaño. `test-e2e.log`. |
| `npm run build` | **Aprobó**: comprobación completa de TypeScript y compilación de producción. `build.log`. |
| Primera ejecución E2E focalizada de desarrollo | **Falló**: 6 aprobados y 2 fallidos; 1,6 minutos. El selector de universo no estaba disponible sin abrir la Biblioteca. `e2e-focused.log`. Tras corregir ese paso, 8/8 aprobados en 45,3 s (`e2e-focused-corrected.log`); no se añadieron reintentos. |
| Calendario aislado: `npx vitest run src/presentation/app.test.tsx -t opens.the.selected.season.calendar --maxWorkers=1` | **Aprobó**: 1 prueba, 34 excluidas por el filtro; 8,72 s. `calendar-isolated.log`. |

En la ejecución predeterminada fallaron el recorrido documental de `app-decisions` por timeout de 5.000 ms y el acceso al calendario en `app.test` al no aparecer la región «Calendario de Liga Uno». Este segundo caso se investigó por separado: pasó tanto en la suite completa con cuatro workers como en su ejecución aislada. No se modificó el calendario ni sus esperas, no se atribuye automáticamente el fallo a antecedentes históricos y la ejecución predeterminada sigue documentada como fallida. Ninguna prueba nueva falló en estas suites completas.

Durante el desarrollo se corrigieron dos fallos propios de las pruebas: opciones `exact` de Playwright utilizadas por error en consultas de Testing Library, detectadas por TypeScript; y un E2E de cambio de universo que intentaba seleccionar el universo sin abrir la Biblioteca. Este último produjo dos fallos reales, investigados con su contexto, en la primera ejecución focalizada de Chromium. Se conservan `e2e-focused.log` y los dos `failed-universe-*.md`; no se atribuyeron a intermitencia histórica. También se conservó la palabra «bombos» en la explicación del bloqueo anterior para mantener su comprobación existente.

## Limitaciones pendientes

No hay restricciones geográficas, rankings implícitos ni reglamentos nuevos. No se soportan restricciones fuera del catálogo ni las condiciones de formatos que los servicios actuales declaran incompatibles. Las cabezas de serie no tienen una semántica implícita adicional. No se promete uniformidad, una alternativa diferente, encontrar todas las soluciones ni demostrar imposibilidad cuando se agotan recursos. Los límites grandes y el uso de lotes son deliberados; no hay un solucionador general para todo formato deportivo.

## Archivos modificados

Implementación: `src/application/services/constraint-group-generator.ts`, `src/application/use-cases/generate-local-groups.ts`, `src/presentation/components/local-group-generator.tsx`, `src/application/services/draw-configuration.ts`, `src/application/services/draw-and-bracket.ts`, `src/application/use-cases/prepare-stage-draw.ts`, `src/domain/entities/stage-draw.ts` y `src/presentation/components/draw-and-bracket-center.tsx`.

Pruebas y fixtures: `src/test-utils/group-generator-fixtures.ts`, `src/application/use-cases/generate-local-groups.test.ts`, `src/application/services/constraint-group-generator.performance.test.ts`, `src/presentation/components/local-group-generator.test.tsx` y `e2e/cancha.e2e.ts`. Documentación: este archivo, la nota de ampliación en `draw-pots-and-restrictions.md` y las evidencias de validación.

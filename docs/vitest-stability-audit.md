# Auditoría de estabilidad de Vitest

Fecha: 6 de noviembre de 2026.

## Estado y alcance

No se reprodujeron los fallos históricos en esta auditoría. La causa permanece pendiente: las ejecuciones aprobadas no demuestran que la intermitencia esté corregida. No se cambió código de producción, configuración global ni pruebas para convertir una hipótesis en una supuesta solución.

Antecedentes aportados en `docs/save-recovery-center.md`: dos suites fallidas, 860/862 y 861/862, con fallos en `app.test.tsx` y `app-lazy.test.tsx`. No se dispone aquí del error íntegro ni del DOM de esas ejecuciones; no se reconstruyen ni se inventan.

## Entorno y configuración auditados

- Windows x64, Node v22.18.0, Vitest 5.0.4, React 18.3.1.
- `os.availableParallelism()`: 8. El código instalado de Vitest calcula 7 workers como máximo predeterminado para `run` (procesadores menos uno). Es un límite, no una medición de ocupación constante.
- `vitest.config.ts` solo configura el entorno predeterminado `node`. Los archivos afectados declaran `@vitest-environment jsdom`.
- Sin `setupFiles`, cambios globales de Testing Library, reintentos ni límites de workers personalizados. `VITEST_MAX_WORKERS`, `CI` y `RTL_SKIP_AUTO_CLEANUP` no estaban definidos.
- Aislamiento por archivo habilitado y globals deshabilitados por defecto. No se encontraron tests `concurrent`, timers falsos ni `resetModules` en los archivos afectados. No hay configuración de ejecución concurrente dentro de estos archivos.
- Testing Library usa `asyncUtilTimeout: 1000`. Sus consultas asíncronas observan mutaciones del DOM y vuelven a consultar; no son esperas fijas.
- No existe repositorio Git disponible en este directorio: `git status --short` devuelve “not a git repository”. La lista de modificaciones de esta auditoría se registra explícitamente abajo.

## Montaje, limpieza y estado compartido

`app.test.tsx` ejecuta `localStorage.clear()` antes de cada prueba y `cleanup()` seguido de `vi.restoreAllMocks()` después. Guarda y restaura los descriptores de `URL.createObjectURL`, `HTMLDialogElement.showModal` y `close`. Hay una asimetría real: define `URL.revokeObjectURL` mediante `Object.defineProperty` sin restaurar su descriptor. No se encontró una relación causal con los fallos de carga; no se modificó como supuesto remedio.

`app-lazy.test.tsx` limpia almacenamiento y llamadas a mocks antes de su única prueba y desmonta mediante `afterEach(cleanup)`. Su mock del cargador oficial es local al archivo aislado y se configura explícitamente antes de utilizarse. `clearAllMocks` no restablece implementaciones; en este archivo de una prueba no demuestra contaminación.

Los efectos de foco y desplazamiento de `App` cancelan sus `requestAnimationFrame` al limpiarse. No se identificaron intervalos ni suscripciones sin limpiar en el recorrido auditado. No se demostró contaminación de almacenamiento ni persistencia indebida de mocks entre archivos.

## Qué espera la prueba del calendario

`opens the selected season calendar and returns to its tournament without switching context`:

1. Guarda Liga Uno y la selecciona en el repositorio local; monta `App`.
2. Espera el heading “Liga Uno”, que confirma la selección inicial, pero no garantiza que todos los módulos diferidos estén resueltos.
3. Pulsa “Centro de calendario”.
4. Espera la región accesible “Calendario de Liga Uno”. Esta es la sección con `aria-label` de `MatchCalendar`, no el fallback de Suspense.
5. Edita y guarda 3–1 y comprueba la persistencia y el torneo activo.
6. Deja una edición 9 sin guardar, vuelve al torneo, abre otra vez el calendario y comprueba que conserva el 9 en pantalla y el 3 guardado.

`MatchCalendar` se declara con `React.lazy(() => import(...))`; su importación incluye `FixtureList`. `DeferredPanel` contiene Suspense y un error boundary que muestra un alert ante rechazo. La condición observable de disponibilidad es la región accesible montada y visible tras resolver el módulo y confirmar React su render. No basta con que desaparezca un texto de carga. No se ocultan errores del boundary.

El calendario solo empieza a montarse cuando `calendarInitialized` es verdadero y luego permanece montado dentro de un contenedor con `hidden={!calendarView}`, conservando la edición local al navegar. El resumen y su editor siguen montados. Las pruebas focalizadas verificaron este recorrido.

La prueba de `app-lazy.test.tsx` navega Biblioteca → importador diferido → torneo y comprueba que el cargador externo solo se invoca al solicitar la importación, además del partido y las estadísticas.

## Hipótesis y evidencia

- Importación dinámica todavía pendiente al agotarse los 1000 ms de la consulta: plausible, pero no demostrada sin un fallo capturado y su DOM.
- Saturación o contención de recursos: no demostrada. Pasan tanto 7 como 2 workers; 2 fue más lento.
- Carrera, limpieza incompleta, mocks persistentes o regresión funcional: no demostrados como origen de estos fallos.
- Las consultas existentes ya esperan estados observables. No se sustituyeron por timeouts mayores, reintentos, pausas fijas ni precarga de módulos.
- `vi.dynamicImportSettled()` sería una herramienta diagnóstica si se captura una importación pendiente; no se añadió preventivamente porque podría cambiar el escenario sin demostrar la causa.

## Reproducción controlada

Las ejecuciones se realizaron por orden, esperando la terminación de cada proceso. Excepción registrada: la primera suite completa se inició aproximadamente cinco segundos antes de terminar la primera ejecución conjunta. Esa suite se considera exploratoria, no una comparación estrictamente aislada ni parte de las tres validaciones finales.

| Comando | Máximo workers / archivos simultáneos | Duración Vitest | Resultado |
| --- | --- | --- | --- |
| `npm test -- src/presentation/app.test.tsx -t "opens the selected season calendar"` | 7 / 1 | 10,34 s | 1 aprobada, 34 omitidas por filtro |
| `npm test -- src/presentation/app-lazy.test.tsx` | 7 / 1 | 6,35 s | 1/1 |
| `npm test -- src/presentation/app.test.tsx src/presentation/app-lazy.test.tsx` | 7 / 2 | 27,19 s | 36/36 |
| `npm test` (exploratoria; solapamiento indicado) | 7 / hasta 7 | 69,44 s | 862/862, 85 archivos |
| `npm test -- --maxWorkers=2` | 2 / hasta 2 | 129,42 s | 862/862, 85 archivos |
| `npm test -- src/presentation/app.test.tsx src/presentation/app-lazy.test.tsx --no-file-parallelism` | 1 / 1 | 30,89 s | 36/36 |

No hubo errores ni DOM de fallo en estas ejecuciones. No se afirma que el DOM de los fallos históricos mostrara Suspense: ese dato no está disponible.

## Validación final

Ejecutadas consecutivamente, sin procesos de pruebas solapados y sin modificar configuración entre ellas:

| Orden | Comando | Máximo workers | Duración Vitest | Resultado |
| --- | --- | --- | --- | --- |
| 1 | `npm test` | 7 | 66,42 s | 85 archivos; 862/862 aprobadas |
| 2 | `npm run test` | 7 | 67,38 s | 85 archivos; 862/862 aprobadas |
| 3 | `npm run test` | 7 | 61,59 s | 85 archivos; 862/862 aprobadas |
| 4 | `npm run build` | No aplica | Vite: 668 ms; duración total no instrumentada | TypeScript y build aprobados; salida 0 |

Ninguna de las ejecuciones finales falló. No hubo errores ni DOM de fallo que capturar. No se omitieron pruebas en las suites completas.

## Correcciones y archivos modificados

Único archivo creado: `docs/vitest-stability-audit.md`. No se aplicó una corrección funcional ni se limitó el paralelismo porque no se demostró la causa. No se añadieron dependencias ni se tocaron reglas deportivas, resultados, JSON v7 o datos persistidos de usuario.

No se modifica `docs/save-recovery-center.md`: no hay un hallazgo causal que afecte al Centro y se conservan sus resultados históricos.

## Regresión y riesgos pendientes

Las suites completas incluyen los tests existentes de calendarios, simulación, dashboard, universos, planificación, guardado y recuperación, y navegación diferida. Los resultados anteriores de E2E no se presentan como nuevas ejecuciones de esta auditoría.

El fallo original sigue pendiente de explicación. Las ejecuciones finales aprobadas validan este estado del proyecto, pero no prueban una corrección de intermitencia. Ante una nueva reproducción se debe conservar el error íntegro y el DOM antes del desmontaje, distinguir fallback, alert de carga y región oculta/ausente, y registrar importaciones pendientes junto al máximo de workers. Solo entonces corresponde elegir una corrección causal.

Referencias oficiales para las opciones empleadas: [maxWorkers](https://vitest.dev/config/maxworkers) y [fileParallelism](https://vitest.dev/config/fileparallelism). Los valores predeterminados mencionados arriba se comprobaron también en el código instalado de Vitest y Testing Library.


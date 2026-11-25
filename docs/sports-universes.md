# Universos deportivos

Los universos organizan torneos y temporadas guardados en la biblioteca sin
copiarlos ni alterar sus reglas deportivas. No se crean universos de ejemplo
automáticamente.

## Auditoría y modelo existente

La biblioteca ya conserva torneos y permite duplicar un torneo individual. El
Centro de competiciones, la planificación y la progresión son proyecciones de
consulta sobre colecciones de torneos; usan relaciones explícitas de temporada,
clasificación continental y planes documentales. El historial de clubes vincula
ocurrencias mediante IDs locales, tokens históricos y referencias continentales,
no por coincidencias de nombres. El historial de actividad es una colección
local separada. No existía un mecanismo de universos.

La duplicación individual existente no constituye una copia íntegra de una
partida: puede necesitar revisar planes, identificadores y resoluciones. Por
eso esta funcionalidad no ofrece una copia de universo que pudiera parecer
independiente sin remapear y validar todas las relaciones, reglas, identidades y
eventos del historial.

## Alcance e integridad

Los controles para elegir y administrar universos, y el panel principal del universo, están agrupados en «Más herramientas de biblioteca». El selector también está disponible en el Centro de competiciones.
La opción «Biblioteca anterior · sin asignar» mantiene visibles las bibliotecas
antiguas y los torneos nuevos que aún no se organizaron. Crear un universo lo
activa; luego se pueden incorporar varios torneos sin asignar, retirarlos o
editar sus metadatos. Cambiar o eliminar un universo nunca elimina los torneos.
Eliminarlo requiere confirmación y deja sus torneos sin asignar.

Cada torneo puede pertenecer a un solo universo. Las operaciones de asignación
y retiro requieren confirmación. Si una relación explícita entre temporadas,
una clasificación, un plan continental o una revisión documental quedaría
dividida entre universos, se rechaza la reorganización. Se pueden seleccionar
juntas las temporadas relacionadas. Referencias a torneos ausentes permanecen
sin resolver; no se reconstruyen por país, año o nombre.

Estadísticas, clasificaciones, relaciones, planificación, progresión, historial
de clubes, palmarés, H2H, rendimiento, comparaciones e historial de actividad
reciben únicamente torneos y eventos del alcance activo. Los eventos nuevos se
atribuyen al universo registrado cuando corresponde. Los cálculos y reglas
deportivas existentes no cambian.

Las operaciones de creación desde el contexto activo asignan los nuevos torneos
a ese universo cuando sus referencias son compatibles. Las importaciones
individuales se validan con el mismo límite. Una biblioteca v7 antigua sin
metadatos no se reparte automáticamente: sus torneos quedan sin asignar.

## Persistencia y respaldos

Los metadatos se guardan en la extensión local opcional
`cancha.sportsUniverses`, versión 1. El documento de torneo no cambia. El
respaldo JSON v7 puede incluir la extensión opcional `extensions.sportsUniverses`, que conserva
universos, asignaciones y universo activo. Los respaldos anteriores que no la
incluyen siguen siendo válidos; al reemplazar la biblioteca, se restauran sin
asignaciones, mientras que al combinar se conservan los metadatos locales y se
añaden solo las asignaciones de torneos realmente importados.

La extensión valida nombres e IDs únicos, universo activo y referencias a
torneos presentes en el mismo respaldo. La sustitución de biblioteca y su copia
local de recuperación incluyen los metadatos; una restauración de respaldo
antiguo conserva el comportamiento anterior. Al borrar un torneo, su asignación
se retira coordinadamente y el evento de eliminación conserva el universo de
origen.

## Límites deliberados

- Los universos no son copias físicas; sus torneos siguen en una sola biblioteca.
- Los IDs de torneo siguen siendo globalmente únicos, como en la biblioteca
  actual. No se cambian para permitir duplicados de una competición/temporada
  entre universos.
- No se permite una dependencia explícita entre universos. Para mover temporadas
  relacionadas, selecciona el conjunto completo.
- Los universos siguen en la biblioteca de LocalStorage, sin sincronización ni
  servicios remotos. Los [puntos de control manuales](save-checkpoints.md) guardan
  copias completas de todos los universos en IndexedDB; no son nuevos universos.

## Validación

La auditoría encontró y corrigió estos defectos:

- La progresión encadenada continental consultaba el repositorio global, por lo
  que podía considerar temporadas de otros universos. Las operaciones
  deportivas y la progresión ahora consultan el repositorio acotado al universo
  activo.
- El repositorio acotado filtraba lecturas, pero aceptaba algunas escrituras
  sobre torneos ajenos o después de cambiar el universo activo. Ahora valida el
  ámbito de cada escritura y rechaza callbacks obsoletos.
- Algunas rutas de persistencia e importación no comprobaban que las relaciones
  explícitas quedaran dentro de un solo universo. La validación se ejecuta al
  guardar metadatos locales y al importar/restaurar respaldos, antes de
  escribir.
- Los borradores de planificación, progresión, historial de clubes,
  comparaciones y récords podían reutilizar selecciones al cambiar de universo.
  Ahora se aíslan por universo; la Biblioteca también descarta confirmaciones
  pendientes y los controles verifican el ámbito original.
- Los torneos creados desde el universo activo y las importaciones oficiales
  ahora conservan ese ámbito. Los perfiles no combinan clubes con IDs locales
  repetidos entre universos.

Las pruebas de regresión añadidas cubren escrituras ajenas y obsoletas,
relaciones cruzadas en metadatos y respaldos, creación en el universo activo,
confirmaciones pendientes al cambiar de universo, borradores y clubes con IDs
locales ambiguos. También se verificó que los respaldos antiguos sin extensión
siguen siendo válidos y dejan los torneos sin asignar.

### Ejecuciones de auditoría

| Comando | Resultado |
|---|---|
| `npm test` | Aprobado: 83 archivos, 843 pruebas. |
| `npm run test:flows` | Aprobado: 5 archivos, 65 pruebas. |
| `npm run test:e2e` | Aprobado: 300 pruebas en 14,2 minutos; incluye Chromium, Firefox y WebKit. |
| `npm run build` | Aprobado: `tsc -b` y `vite build`. |

El fallo intermitente anterior ocurrió en WebKit al esperar que reapareciera un
panel después de inducir una respuesta HTTP 503 para un chunk diferido. En la
ejecución completa de esta auditoría, ese mismo caso (`fallo HTTP de un chunk
aísla el panel y permite recuperar con las acciones disponibles`) pasó en
WebKit desktop en 7,0 segundos, y pasaron los 300 casos sin reintentos ni
aumentar esperas. La evidencia disponible no identifica la causa exacta del
fallo anterior; por tanto, se registra como no reproducido, no como una
condición de carrera ya resuelta.

La ruta de recuperación local valida la estructura del snapshot y vuelve a
validar las relaciones antes de restaurar; si una escritura falla, restaura
los valores anteriores. No se halló un fallo reproducible que justifique
cambios adicionales en esa ruta. Las limitaciones pendientes son la causa no
determinada de aquel fallo WebKit y la imposibilidad deliberada de duplicar
universos íntegramente con el modelo actual. No se cambió el formato v7, las
reglas deportivas ni resultados existentes.

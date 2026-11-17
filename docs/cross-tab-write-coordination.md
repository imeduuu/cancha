# Coordinación de escrituras entre pestañas

## Problema y auditoría

Una pestaña podía guardar un objeto de temporada anterior y reemplazar resultados que otra acababa de simular. La exclusión de IndexedDB protegía los puntos de control, pero los escritores de LocalStorage no participaban. La auditoría abarca los escritores del repositorio, sus consumidores de Application y las entradas de Presentation, incluidas las migraciones que persistían durante una lectura y que se detectaron al integrar el protocolo.

| Camino auditado | Clasificación y tratamiento |
| --- | --- |
| `save`, `saveWithActivity`, `saveManyWithActivity`, `recordActivity` | Datos deportivos e historial. Exigen una sección coordinada; conservan sus validaciones y compensación. |
| Crear, duplicar, renombrar, archivar, eliminar y crear temporadas | Escritura deportiva. El comando incluye la operación existente, la asignación al universo y las escrituras relacionadas. |
| Importar competición o archivo individual | Escritura deportiva. Se obtiene/lee la fuente antes del bloqueo; el constructor y guardado existentes se ejecutan dentro. El rechazo documental se registra como resultado fallido del comando, sin presentarlo como importación exitosa. |
| Resultados, goleadores, alineaciones, eventos, sustituciones y estado operativo | Escritura deportiva e historial. El editor entra en el mismo límite antes de llamar a los casos de uso. |
| Simular partido, jornada, rueda, mitad argentina, campeonato o alcance revisado | Escritura deportiva. Exclusión y comprobación de instantánea antes del motor existente, sin volver a generar azar al rechazar. |
| Horarios de un partido, programación local y calendario publicado | Escritura deportiva. La consulta de fuente y los diálogos quedan fuera. Las revisiones conservan además sus comprobaciones deportivas. |
| Sorteos documentados, desempates, afiliación, reglamentos y preparación | Escritura deportiva. Paneles de resoluciones, segunda división y preparación usan el límite compartido. |
| Progresión, temporadas vinculadas, planificación y clasificación continental | Escritura de uno o varios torneos. Se mantiene el mismo bloqueo durante el comando y las asignaciones; no se cambian reglas ni algoritmos. |
| Crear, renombrar, eliminar, asignar o seleccionar universos | Metadatos de biblioteca que determinan el alcance deportivo. Se coordinan globalmente, también su actividad relacionada. |
| Reemplazar/combinar JSON v7 y recuperar copia local | Escritura de biblioteca completa. Mismo bloqueo, validaciones, copia previa y compensación existentes. |
| Restaurar un punto de control | Mismo bloqueo y un permiso vigente de esa adquisición; no se solicita un segundo bloqueo anidado. |
| Crear, editar y eliminar puntos | IndexedDB, con exclusión compartida cuando existe Web Locks y sus transacciones/CAS originales. |
| `findAllWithRecoveryReport` | Se encontró una escritura implícita de migraciones. Con el repositorio protegido, la lectura migra en memoria y solo persiste dentro de una sección coordinada. La progresión de arranque también entra en el protocolo. |
| Selección del torneo abierto (`cancha.activeTournamentId`) | Preferencia de interfaz. No invalida una revisión deportiva; su recuperación durante un reemplazo conserva el comportamiento existente. |
| Filtros, búsqueda, pestañas de interfaz y borradores | Estado de interfaz/sesión, sin escritores deportivos adicionales. No se someten indiscriminadamente al bloqueo. |
| Tablas, estadísticas, dashboard, historial, palmarés, revisiones, exportación | Lecturas/proyecciones. No generan resultados. Las incidencias de proveedores que una consulta pueda registrar se coordinan expresamente. |

La búsqueda de escrituras persistentes encontró las llamadas a `localStorage.setItem/removeItem` concentradas en `LocalStorageTournamentRepository`. Los puntos manuales permanecen en `IndexedDbSaveCheckpointStore`. No se añade un repositorio deportivo alternativo.

## Protocolo implementado

`library-write-lock.ts` conserva el nombre histórico **`cancha.save-checkpoints`** como bloqueo exclusivo de toda la biblioteca. No se divide por torneo ni universo. Los puntos de control y las escrituras deportivas lo solicitan mediante la misma función.

El repositorio exige coordinación por defecto. `coordinate(expected, action)` adquiere Web Locks y después compara una instantánea exacta de los valores crudos de `cancha.tournaments`, `cancha.activity`, `cancha.sportsUniverses` y `cancha.recovery`. Incluir toda la biblioteca es conservador: una modificación de otra temporada o universo también puede invalidar el comando. No se modifica JSON v7 ni se añade una revisión al modelo deportivo.

El adaptador emite un permiso opaco registrado en un `WeakSet` mientras posee el bloqueo. `commitUnderLibraryLock` exige ese permiso vigente, repite la comparación y habilita el repositorio únicamente durante un callback síncrono. Se rechazan callbacks deportivos que devuelvan promesas; una continuación posterior no conserva permiso para escribir. El permiso se revoca y Web Locks se libera tanto al terminar como al fallar. Las comprobaciones de pertenencia, integridad, revisiones y dependencias de los casos de uso siguen ejecutándose dentro del comando.

El callback nativo devuelve un resultado que distingue éxito/error; un error del comando se propaga al llamador después de salir del bloqueo. Se verificó en el Firefox 157 instalado que rechazar directamente el callback producía `pageerror` incluso con `request()` capturado. Una reproducción mínima conserva ambos casos en `firefox-web-locks-diagnostic.json`: rechazo capturado con un error global frente a resultado fallido capturado con cero errores globales. No se ignoran errores en la auditoría de navegador ni se cambia el rechazo deportivo. Esta observación concreta no explica el fallo histórico de puntero de Firefox móvil de la funcionalidad anterior.

`LibraryWriteContext` conecta los puntos de confirmación de los paneles con el coordinador de App. Los métodos deportivos y los consumidores internos conservan su contrato síncrono. Los manejadores que entran en el límite esperan la promesa y gestionan el error antes de cerrar formularios o mostrar éxito. Las consultas de proveedores y las confirmaciones del usuario ocurren fuera del bloqueo. Se extrajo `importOfficialSeason` del mismo importador para ejecutar la parte síncrona después de consultar la fuente; el importador asíncrono original la reutiliza.

La instantánea reconocida por una pestaña avanza únicamente después de su propio comando confirmado o de una reapertura explícita de datos actuales. Nunca se reconoce una escritura ajena por recibir un evento `storage`. La instantánea resultante se captura dentro de la sección coordinada, para no atribuir a la pestaña una escritura posterior de otra.

## Obsolescencia, avisos y borradores

Una confirmación antigua se rechaza antes de invocar su callback. No escribe, no mezcla cambios y no vuelve a tirar resultados aleatorios. Las revisiones especializadas de simulación, calendario, planificación y puntos conservan además sus tokens, identidad y validaciones originales.

App escucha `storage`, incluyendo borrado de claves, solo para avisar de cambios. El aviso y el error de guardado no desmontan el editor ni borran su borrador. **Actualizar biblioteca conservando borradores** vuelve a leer las listas y actividad sin reconocer la instantánea para continuar guardando un editor antiguo. Abrir explícitamente una competición desde la biblioteca lee su versión actual y comprueba que la lectura no atravesó otro cambio.

**Abrir biblioteca actual y cerrar formularios** pide una confirmación que explica el cierre de formularios y revisiones. Reconoce los datos actuales, actualiza el universo y vuelve a la biblioteca. No vacía el almacén de borradores de sesión. Los borradores cuyo partido cambió se resuelven al reabrir con la política de versiones ya existente. Los estados locales de formularios cerrados no se presentan como conservados. No hay recarga automática de toda la aplicación.

El canal de notificaciones de puntos de control sigue siendo independiente como aviso de metadatos. Ni `storage` ni BroadcastChannel sustituyen el bloqueo o la comprobación de instantánea.

## Restauración y fallos

La restauración JSON y la recuperación local pasan por el mismo comando. Restaurar desde IndexedDB utiliza el permiso que recibe del almacén tras adquirir el bloqueo compartido; valida nuevamente el punto y la biblioteca antes de escribir, sin anidar adquisiciones. La creación de puntos mantiene la comprobación de biblioteca durante su revisión y confirmación, y las operaciones IndexedDB conservan su transacción nativa, comparación de registro y espera de `oncomplete`.

Se reutiliza `restoreStorageValue` para extender la compensación a las claves afectadas por el comando completo. Se conserva la copia automática de recuperación del reemplazo. Un fallo de escritura registrado por los métodos privados también hace fallar el comando aunque un manejador interior lo haya capturado. Si la compensación falla, el mensaje indica expresamente que el almacenamiento puede estar incompleto y remite a exportación/recuperación. No se añade un segundo archivo de recuperación, diario persistente ni motor de restauración.

Sin Web Locks se bloquean las escrituras deportivas y las restauraciones, incluida JSON. La biblioteca sigue siendo consultable y exportable. Crear/editar/eliminar puntos puede mantener el respaldo transaccional/CAS de IndexedDB, pues esas operaciones no reemplazan datos deportivos; restaurarlos requiere Web Locks. Un fallo de IndexedDB o Web Crypto mantiene los errores y alternativas de descarga existentes.

Se comprobó también el cierre de una pestaña que mantenía adquirido un bloqueo, con otra pestaña del mismo origen esperando: Chromium 156, Firefox 157 y WebKit 27.2 permitieron continuar al segundo solicitante después del cierre. El diagnóstico usa una concesión confirmada y una promesa pendiente, sin pausas fijas; el resultado se conserva en `tab-close-lock-diagnostic.json`. Esto comprueba liberación del bloqueo, no atomicidad de las escrituras que hubiera alcanzado a realizar una pestaña cerrada.

## Garantías y límites reales

- Las entradas de escritura de la aplicación actual y el repositorio protegido comparten exclusión global; los escritores sin sección vigente se rechazan. No se identificó un escritor deportivo de la interfaz que deba quedar habilitado fuera del protocolo.
- Los dobles/semillas de pruebas usan explícitamente `new LocalStorageTournamentRepository(false)`. Esa desactivación deliberada no proporciona garantías de coordinación y no se utiliza en la aplicación.
- Las pestañas con una versión antigua de Cancha, herramientas que escriban directamente en LocalStorage y código que desactive deliberadamente el guardián no participan. No se promete protección frente a ellos. Conviene cerrar versiones antiguas antes de trabajar en varias pestañas.
- Varias claves de LocalStorage **no forman una transacción atómica**. Web Locks impide intercalaciones entre escritores participantes; no proporciona aislamiento a lectores sin bloqueo ni durabilidad transaccional ante la terminación del proceso. Un lector puede ver un estado intermedio y deberá volver a consultar. Un cierre abrupto entre claves puede requerir la recuperación o un JSON externo; la compensación en memoria no se ejecuta después de matar el proceso.
- La protección se limita al mismo origen, perfil y almacenamiento del navegador. No sincroniza dispositivos ni ofrece respaldo ante eliminación de datos del sitio.
- No se añaden reglas, resultados, sorteos, clasificación, remapeo de IDs, dependencias o cambios de esquema. Los servicios deportivos siguen decidiendo qué progresión está autorizada.
- Las instantáneas completas consumen memoria proporcional a la biblioteca. No se implementa paginación ni un sistema de revisiones persistentes.

## Validación

Las pruebas de coordinación usan promesas y barreras, sin pausas fijas: comandos simultáneos del mismo/diferente torneo, duplicación, simulación frente a edición manual sin nuevo azar, calendario obsoleto, reemplazo, universos, compensación de varias temporadas, cuota, liberación, permisos vencidos, lecturas con migración, callbacks asíncronos y ausencia de Web Locks. Los flujos existentes verifican las reglas, referencias, progresión continental, persistencia, recuperación y respaldos. Los recorridos nuevos usan dos páginas del mismo contexto y Web Locks/LocalStorage/IndexedDB reales.

Las confirmaciones simultáneas de dos páginas se activan mediante eventos DOM después de comprobar que ambos botones están visibles y habilitados; esto evita competir por un puntero físico y conserva los handlers y almacenamiento nativos. Las demás interacciones de estos recorridos usan clics y campos reales. Se conservan trazas de fallos y no se modifican workers, timeouts ni reintentos.

Los registros de desarrollo y de validación final se conservan en [validation/cross-tab-write-coordination](validation/cross-tab-write-coordination/). La comparación histórica de Vitest y el fallo anterior de Firefox permanecen documentados en sus registros originales: no se atribuyen a esta implementación ni se declara una causa histórica demostrada.

Durante el desarrollo, Chromium aprobó los tres recorridos después de corregir dos selectores: se identificó el aviso global por su nombre accesible y se usó el botón de regreso del torneo activo. La primera matriz nueva completa obtuvo 24 aprobados y 12 fallos de auditoría en Firefox por el rechazo del callback nativo descrito arriba; se conservan las trazas y se corrigió el adaptador. Las ejecuciones anteriores a esa corrección llevan el prefijo `before-firefox-fix` cuando corresponden a validaciones generales. Incluyen un timeout de 5000 ms en `app-lazy` con la configuración predeterminada y una ejecución aprobada con 4 workers, sin demostrar una causa única de la diferencia.

La primera invocación completa posterior se interrumpió deliberadamente al reproducir una expectativa antigua de texto en el recorrido de planificación continental: esperaba «desactualizada» del validador especializado, mientras el guardián global rechazaba antes con «La biblioteca cambió». La traza confirma el rechazo. Se actualizó únicamente esa expectativa, conservando las comprobaciones exactas de equipos, encuentros y planes; no se modificó la aplicación ni la configuración de pruebas. El registro y las trazas de la invocación interrumpida se conservan como `npm-test-e2e-full-attempt1-interrupted*` y `e2e-full-attempt1-failures`, sin declararla aprobada.

El segundo intento completo terminó con **383 aprobados, un fallo y salida 1 en 16,3 minutos**. La auditoría de WebKit móvil detectó tres solicitudes de módulos canceladas durante la recarga inicial de preparación del test de administración de puntos. La traza sitúa esas solicitudes entre 957373 y 957387 ms y la primera recarga en 957399 ms; las cancelaciones terminaron después de esa recarga, mientras la recarga posterior de persistencia completó los módulos con respuesta 200. Se corrigió la preparación para sembrar torneos, actividad y universos en la página de almacenamiento antes de abrir la aplicación. Se conserva la recarga posterior que prueba persistencia, todas las aserciones y la auditoría estricta de solicitudes. Los registros y trazas permanecen en `npm-test-e2e-full-attempt2-failed*` y `e2e-full-attempt2-failures`. No se atribuye este caso a la intermitencia histórica de otro navegador.

El recorrido corregido aprobó los doce proyectos en una ejecución focalizada. La nueva invocación completa posterior aprobó **384 casos en 18,5 minutos, salida 0**, en una sola ejecución, y `.last-run.json` terminó en `passed`, sin pruebas fallidas. Son 32 casos por cada uno de los doce proyectos existentes. Los intentos anteriores no se suman a este resultado ni se reclasifican como aprobados.

| Validación de la versión corregida | Resultado |
| --- | --- |
| `npm test` | 92 archivos: 91 aprobados y uno fallido; 953 pruebas aprobadas y un timeout de 5000 ms en `app-lazy` (954 totales), 94,22 s, salida 1. |
| `npm test -- --maxWorkers=4` | 92 archivos, 954 pruebas aprobadas, 87,58 s, salida 0. |
| `npm run test:flows` | 6 archivos, 80 pruebas aprobadas, 38,96 s, salida 0. |
| `npm run build` | TypeScript y Vite aprobados, salida 0. |
| `npm run test:e2e` | 384 casos aprobados en una ejecución completa, 18,5 minutos, salida 0; registro final `passed`. |

La ejecución predeterminada fallida se conserva como tal. Que la misma prueba pase dentro de la suite de 4 workers y de los flujos no convierte esa invocación en aprobada ni demuestra una causa del timeout. No se modifican aislamiento, límites de workers del proyecto, timeouts ni reintentos. El número de procesos creados por archivo a lo largo de Vitest no equivale a concurrencia simultánea.

El timeout de `app-lazy` en la suite predeterminada queda pendiente de resolver: esta entrega no declara todas las validaciones verdes. La lista de archivos está en `changed-files.txt`; `validated-source-sha256.json` y `source-verification.json` identifican los archivos comprobados. Las correcciones finales de expectativas y preparación E2E no cambiaron los fuentes de la aplicación que aprobaron las pruebas generales y la compilación.

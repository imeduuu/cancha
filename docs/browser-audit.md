# Auditoría de navegador y diseño adaptable

Revisión del 17 de octubre de 2026, America/Santiago.

## Base y alcance

La revisión inicial encontró React 18, TypeScript 5.7, Vite 8 y CSS propio; componentes diferidos con `React.lazy`/`Suspense` y un límite de errores por panel. Los borradores de `session-drafts.tsx` viven en memoria durante la sesión: navegar no debe descartarlos; recargar sí. No se modificó ese diseño.

`docs/functional-flows.md` corresponde a la revisión anterior: sus 570 pruebas y 62 recorridos de jsdom no incluían el acceso público posterior. El informe posterior del acceso público registraba 589 pruebas; esos recuentos son históricos. El recuento vigente se verifica de nuevo en los resultados finales. No había Playwright, Selenium ni infraestructura de navegador instalada. Se agregó `@playwright/test` como herramienta de desarrollo, con sus dependencias transitivas y `@types/node` para declarar `fs`/`Buffer` en los recorridos TypeScript, para comprobar renderizado, foco, diálogos, descargas y carga HTTP reales. Las pruebas jsdom se conservan para cobertura exhaustiva de reglas y casos de uso.

## Aislamiento y ejecución en Windows

```powershell
npm ci
npx playwright install chromium firefox webkit
npm run test:e2e
```

`test:e2e` comprueba primero los tipos de sus pruebas con `tsconfig.e2e.json`; no cambia la compilación de la aplicación. La configuración `playwright.config.mjs` compila con el comando de build existente y arranca Vite preview en **http://127.0.0.1:4179**, con `--strictPort` y `reuseExistingServer: false`. Si el puerto está ocupado, falla; no reutiliza la sesión de desarrollo. Playwright cierra su servidor al terminar. No se usa Cloudflare Tunnel.

Cada prueba obtiene un contexto de navegador nuevo y no persistente. No se abre ningún perfil personal ni se lee el localStorage del navegador del usuario. Solo se inicializa y limpia el almacenamiento de esos contextos aislados. Las descargas se leen del directorio temporal de Playwright; la restauración usa archivos proporcionados por la prueba, sin abrir documentos personales.

Los participantes y resultados son sintéticos, reutilizando los fixtures existentes y el generador de calendario del dominio. Las simulaciones del navegador usan una secuencia pseudoaleatoria con semilla fija; no se modifica el motor de producción. Los proveedores no se consultan: se bloquean las rutas de proxy y las solicitudes externas no previstas. La hoja de fuentes de Google se sustituye por una respuesta CSS vacía para usar las fuentes de sistema y evitar diferencias por red. Esto no certifica la disponibilidad o la apariencia exacta de las fuentes remotas.

Comandos opcionales:

```powershell
npm run test:e2e -- --project=chromium-desktop
npm run test:e2e -- --project=firefox-mobile
npm run test:e2e -- --project=webkit-tablet --headed
npx playwright show-report
npm run test:flows
npm test
npm run build
```

Los navegadores administrados por Playwright se instalan fuera del proyecto; no forman parte del paquete de producción. Para actualizar Playwright, deben instalarse de nuevo sus binarios compatibles. Véase la [instalación oficial](https://playwright.dev/docs/intro) y la [gestión de navegadores](https://playwright.dev/docs/browsers).

## Matriz ejecutada

Versiones realmente ejecutadas con Playwright 1.64.1:

| Motor | Versión | Casos aprobados |
| --- | --- | --- |
| Chromium | 156.0.8078.4 | 56 |
| Firefox | 157.0 | 56 |
| WebKit | 27.2 | 56 |

Cada uno de los 14 recorridos se ejecuta en Chromium, Firefox y WebKit a estas resoluciones CSS:

| Proyecto | Resolución |
| --- | --- |
| desktop | 1440 × 900 |
| notebook | 1366 × 768 |
| tablet | 768 × 1024 |
| mobile | 390 × 844 |

Hay además dos casos de ventana baja a **667 × 375** en cada proyecto. Las variantes mobile de Chromium y WebKit usan emulación móvil y táctil; Firefox comprueba la resolución con su motor de escritorio. Las ejecuciones registradas son headless: navegadores reales ejecutados en Windows con perfiles aislados, **no teléfonos, tablets ni Safari físicos**. WebKit de Playwright no certifica Safari/iOS completo.

## Recorridos añadidos

| Recorrido | Evidencia y límites |
| --- | --- |
| Biblioteca y creación | Agregar/quitar/editar participantes, puntos personalizados, dos ruedas y fixture generado desde el formulario. Borrador de creación conservado al ir a biblioteca. |
| Resultados y simulación | Guardar y editar un marcador, comprobar sus puntos en la tabla, simular un encuentro pendiente y una fecha, abrir estadísticas y recargar datos guardados. |
| Rueda específica | Simular la segunda rueda y exigir que la primera siga íntegramente igual, sin resultados nuevos. |
| Navegación y borradores | Resumen → calendario → biblioteca → otro torneo → regreso; el marcador sin guardar se conserva solo en su torneo y desaparece en una recarga real. |
| Respaldo JSON v7 | Descarga nativa, lectura del archivo real, rechazo de JSON corrupto, foco de cancelación, Tab/Shift+Tab, Escape, restauración confirmada y recarga. No se automatiza el selector del sistema operativo. |
| Grupos y eliminatorias | Libertadores sintética con ocho grupos completos, selector de fase y encuentro de octavos generado por los servicios existentes. Se abre y simula ese encuentro. No se repite el cierre íntegro de todas las copas ya cubierto por jsdom. |
| Copas nacionales | Semifinales sintéticas de Copa Argentina y Copa do Brasil, partido único/ida y vuelta, simulación de encuentro y apertura del calendario. |
| Segundas divisiones | Primera Nacional y Série B con cobertura parcial intencionada; paneles de movimientos y resoluciones oficiales visibles y transición deshabilitada. No se fuerzan ascensos ni se resuelven sorteos. |
| Temporada futura | Série A 2027 de planificación, sin encuentros ni reglas verificadas; se navega con un borrador del reglamento sin convertirlo en verificado ni guardarlo. |
| Incidencias | Expediente automático sintético, originales visibles, formulario documentado y borrador conservado al navegar; ninguna corrección se aplica ni se sustituye un torneo. La revisión deportiva exhaustiva sigue cubierta por los flujos anteriores. |
| Carga lenta | Se retiene la solicitud real del chunk de calendario, se comprueba su estado de carga y después se libera; mantiene la edición del marcador. |
| Fallo de módulo | Se responde HTTP 503 sin caché exclusivamente para el chunk de estadísticas. El panel informa el error; tabla y guardado siguen funcionando. Al permitir la descarga se recuperan estadísticas y resultado con recarga en Chromium/Firefox y con la alternativa de pestaña nueva en WebKit. |
| Ventanas bajas | Restauración con nombre de archivo largo y diálogo de alcance de simulación; acciones alcanzables, teclado y datos conservados al cancelar. |

Cada recorrido registra errores de consola, excepciones y solicitudes fallidas; falla ante errores inesperados. El caso del módulo con HTTP 503 acepta únicamente solicitudes fallidas del chunk de estadísticas y sus errores de carga. No atribuye esos fallos provocados a proveedores.

## Problemas reproducidos y correcciones

El diálogo de confirmación tenía `overflow: visible`. Un respaldo con nombre largo, en 667 × 375, produjo **1158 px de contenido para 438 px disponibles**; el contenido vertical también excedió su altura (**424 frente a 335 px**) y los botones quedaron fuera de pantalla. La captura y la prueba fallaron antes de corregirlo.

El ajuste del diálogo queda limitado a `.confirmation-dialog` y su descripción en `src/styles.css`: ajuste de palabras largas, altura máxima respecto del viewport dinámico y desplazamiento interno. La restauración, sus validaciones y confirmaciones no cambian. La regresión comprueba ancho, desplazamiento vertical cuando es necesario, posición alcanzable y cancelación sin mutación.

También se reprodujo un fallo a **768 × 1024** con Libertadores: el umbral anterior de 760 px mantenía dos columnas y dejaba demasiado estrechos los controles de fase y el editor de encuentros. El documento alcanzó **771 px para 768 px disponibles** y la captura mostró botones recortados dentro del listado. Se aplica una columna a la zona activa hasta 900 px, conservando el diseño de escritorio y la configuración de creación. El recorrido de grupos/eliminatorias en tablet comprueba la regresión. En WebKit móvil, el mínimo intrínseco de la cuadrícula de simulación también produjo **392 px de documento para 390 px disponibles**. Se limita su columna con `minmax(0, 1fr)` y se permite encoger las etiquetas; la misma aserción de ancho comprueba la regresión, sin aumentar tolerancias ni ocultar el overflow.

Al guardar también se confirmó un salto horizontal del panel activo: el aviso de persistencia pasaba a ocupar la primera celda de la cuadrícula y enviaba el panel de **x≈104 a x≈744** en escritorio. Los avisos de persistencia/error ahora abarcan su propia fila. Al revisar ese ajuste, se comprobó que el `gap` vertical porcentual existente provocaba desbordamiento de filas: el panel terminaba en y≈1104 mientras el pie empezaba en y≈988. Se conserva la separación horizontal de 8,5 % y se fija la vertical en 16 px. La regresión exige conservar la posición y el ancho del panel, y que el pie quede debajo de él tras guardar.

También se comprobó que **WebKit reutiliza un módulo fallido tras una recarga normal**, incluso al restablecer la respuesta y navegar a otra URL del mismo sitio. En un contexto aislado, abrir una pestaña nueva del mismo origen sí recuperó el módulo y conservó la biblioteca. Un enlace directo que abre un popup también reutilizó el fallo en esta ejecución; no se conservó esa solución. El mensaje del panel indica abrir una pestaña vacía desde el navegador y pegar la dirección actual, además de mantener la recarga y el recordatorio de guardar las ediciones. La regresión crea esa pestaña vacía con la API del navegador, navega a la misma URL, vigila también sus errores y comprueba el marcador guardado. No automatiza los controles de la barra de pestañas del sistema operativo. **No se afirma que la recarga normal de WebKit resuelva ese caso.** Los borradores de memoria no se trasladan a la pestaña nueva.

El diálogo de alcance de simulación se comprobó por separado y no necesitó cambios. No se alteraron estilos generales para ocultar desbordamientos, reglas deportivas, importadores, persistencia ni JSON v7.

## Evidencias e informe

`playwright-report/index.html` muestra los recorridos y versiones de navegador en sus anotaciones. Las capturas del área visible y de tablas relevantes se adjuntan al informe; los errores de consola/red se adjuntan como JSON. `test-results/` conserva capturas y trazas de fallos. Ambos directorios son generados, están excluidos del repositorio y se reemplazan al volver a ejecutar.

Para inspeccionar una traza fallida:

```powershell
npx playwright show-trace "test-results\ruta-del-caso\trace.zip"
```

Una captura completa de grupos en WebKit móvil superó su límite de 32.767 píxeles; se usan capturas acotadas del área visible y de secciones, manteniendo la aserción del ancho de todo el documento. No se cambió la aplicación para superar ese límite de la herramienta. Las capturas se revisan para superposiciones y legibilidad; las aserciones comprueban el ancho del documento y el acceso real a controles, además del foco y los límites del diálogo. No son comparaciones pixel a pixel ni una auditoría WCAG completa. No se han medido contraste exhaustivo, lectores de pantalla, teclado virtual móvil, zoom del sistema, HMR de desarrollo ni todos los calendarios completos en todas las competiciones. Los proveedores y los reglamentos conservan sus verificaciones previas.

## Resultado de ejecución

| Comando | Resultado |
| --- | --- |
| `npm test` | **601 pruebas aprobadas**, 63 archivos. |
| `npm run test:flows` | **62 pruebas aprobadas**, 5 archivos. |
| `npm run test:e2e -- --workers=3` | **168 aprobadas**, 12 proyectos; 0 fallos, 0 omitidas y 0 casos flaky, sin reintentos. Incluye comprobación TypeScript previa. |
| `npm run build` | TypeScript y Vite correctos; carga diferida conservada, sin advertencia de tamaño. |

El comando de navegador usa dos workers por defecto; la ejecución completa registrada usó tres y duró aproximadamente 7,4 minutos. Las 168 comprobaciones corresponden a 14 recorridos × 3 motores × 4 resoluciones; los dos casos de ventana baja cambian expresamente su viewport a 667 × 375.

Una ejecución previa de `test:flows` agotó el límite de cinco segundos en `app-lazy.test.tsx` al coincidir con una compilación. Su repetición aislada aprobó las 62 pruebas; no se elevaron límites ni se relajaron validaciones. La suite general también aprobó ese recorrido. Las capturas inicialmente demasiado largas y el registro de errores de Firefox se corrigieron en la infraestructura de pruebas, sin atribuirlos a errores deportivos de Cancha.

El informe HTML final confirma 168 resultados esperados, ninguno inesperado y las tres versiones anteriores. No hubo errores inesperados de consola o red; el HTTP 503 del caso de recuperación está provocado y documentado. Al terminar se comprobó que los puertos locales de pruebas **4179 y 4180** ya no tenían servidores activos. No se utilizó el túnel público ni la biblioteca real.


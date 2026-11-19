# Cancha — Simulador de campeonatos

[![CI](https://github.com/imeduuu/cancha/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/imeduuu/cancha/actions/workflows/ci.yml)

Aplicación web para configurar campeonatos de fútbol y generar sus calendarios. Esta primera versión permite definir equipos, ruedas y orden de desempate; los campeonatos creados se guardan en el navegador. Con una cuenta (opcional), la biblioteca se guarda en el servidor y se abre desde cualquier navegador: ver [Cuenta y biblioteca en el servidor](#cuenta-y-biblioteca-en-el-servidor).

## Empezar

```bash
npm install
npm run dev
```

## Arquitectura

El repositorio es un monorepo con npm workspaces. Las órdenes `npm` se ejecutan desde la raíz.

| Paquete | Contenido |
| --- | --- |
| `packages/core` (`@cancha/core`) | `src/domain/` (equipos, campeonato, criterios de desempate, calendarios y progresiones) y `src/application/` (casos de uso, servicios y puertos que conectan las reglas con el almacenamiento). TypeScript puro: compila sin DOM ni APIs del navegador o de servidor. `src/test-utils/` contiene fixtures de pruebas reutilizables. |
| `apps/web` (`@cancha/web`) | La aplicación React/Vite: `src/infrastructure/` (persistencia en `localStorage`/IndexedDB, bloqueo entre pestañas e importadores), `src/presentation/` (React), `src/integration/` (pruebas de casos de uso contra los adaptadores reales), `e2e/` (Playwright) y `scripts/`. |
| `apps/api` (`@cancha/api`) | API NestJS 12 (compilada con el CLI de Nest) sobre `@cancha/core` compilado: configuración validada y `GET /health`. Ver [API](#api). |

La web importa el núcleo como `@cancha/core/<ruta>` (por ejemplo `@cancha/core/domain/entities/tournament`) y lo consume como código fuente, sin paso de compilación: Vite, Vitest y `tsc` de la web usan la condición de exportación `source` (`src/*.ts`). Para Node (`apps/api`), `npm run build -w @cancha/core` compila el núcleo con [tsdown](https://tsdown.dev) a `packages/core/dist` (ESM + `.d.ts`, un archivo por módulo), que es lo que resuelve Node con la condición `default`; el build termina con una prueba de humo que importa todos los módulos desde Node puro. `@cancha/core/test-utils/*` apunta siempre a la fuente (sólo lo usan las pruebas). `npm run lint` comprueba las reglas de capas: el núcleo no puede importar React, Node ni otros paquetes, ni usar `localStorage`, `window` u otros globales del navegador o de Node, y `domain` no puede depender de `application`.

Consulta [la arquitectura en detalle](docs/ARCHITECTURE.md): capas, regla de dependencias, puertos de persistencia y formato JSON v7 de los respaldos.

El calendario acepta cualquier cantidad de equipos y de 1 a 20 ruedas; con una cantidad impar de equipos, cada uno queda libre una fecha por rueda. La numeración de fechas continúa durante todo el campeonato: por ejemplo, en una liga de 20 equipos, la segunda rueda empieza en la fecha 20 y termina en la 38, no vuelve a la fecha 1. El límite de ruedas evita calendarios desproporcionados. Los nombres de torneo y equipo tienen límites de 80 y 40 caracteres, respectivamente. Los criterios de desempate se guardan en el orden elegido.

La configuración valida nombres obligatorios y duplicados (sin distinguir mayúsculas ni espacios repetidos), ruedas enteras, criterios de desempate únicos y formatos inválidos. Las reglas se verifican tanto en la interfaz como en el caso de uso para que no puedan omitirse al crear el campeonato.

Cada partido permite ingresar y guardar manualmente goles enteros de 0 a 99, sin imponer un límite a la diferencia del marcador. En cualquier encuentro se puede habilitar una definición opcional por penales o prórroga y penales; en partidos eliminatorios, la simulación genera automáticamente la definición si el marcador queda igualado. Si una tanda continúa empatada, la simulación sigue con muerte súbita hasta que haya un ganador, sin límite artificial de rondas ni goles añadidos.

Las simulaciones de fechas, ruedas y campeonato completo respetan el modo seleccionado: simular solo encuentros pendientes o volver a sortearlos todos, sobrescribiendo resultados existentes. Los resultados se guardan en el navegador. La biblioteca lista los campeonatos guardados y recuerda por identificador cuál se abrió por última vez, incluso después de recargar la aplicación.

Antes de guardar o importar, se comprueban los identificadores y nombres de equipos, las referencias y unicidad de partidos, los marcadores, las fechas y la coherencia de las fases eliminatorias declaradas. Al recuperar datos, un campeonato inválido se informa con su nombre y el primer motivo detectado; los demás campeonatos válidos siguen disponibles. El registro dañado se conserva sin modificaciones para evitar pérdida automática de datos. Si el documento completo de `localStorage` no se puede leer o interpretar, la aplicación informa del error y no lo sobrescribe.

Desde la biblioteca se puede abrir, renombrar, duplicar o eliminar cada torneo. Al duplicar, la opción predeterminada reinicia los resultados; también se puede pedir explícitamente conservarlos. Las copias tienen identificadores nuevos y sus equipos, calendario, reglas y resultados no comparten objetos mutables con el original. La eliminación pide confirmación mostrando el nombre y solo borra el torneo seleccionado. Se muestra la fecha de creación; el modelo todavía no registra una fecha de última modificación.

La simulación genera goles con distribuciones de Poisson independientes: un promedio de 1,55 goles esperados para el local y 1,15 para la visita introduce una ventaja local moderada y hace que los marcadores habituales sean mucho más probables que los extremos. Es un modelo probabilístico inicial, no una predicción basada en planteles o estadísticas reales.

La tabla de posiciones se recalcula con cada resultado guardado o simulado, aunque la fecha siga incompleta. Suma 3 puntos por victoria, 1 por empate y 0 por derrota; muestra partidos jugados, ganados, empatados, perdidos, goles, diferencia y puntos. Los empates en puntos se resuelven usando los criterios en el orden configurado. Para enfrentamiento directo se calcula una minitabla entre los equipos empatados con los resultados disponibles: puntos, diferencia de goles y goles a favor en sus duelos. El botón “Ir al partido” lleva directamente al primer encuentro pendiente y cambia automáticamente de rueda o etapa si es necesario.

El panel de estadísticas resume el torneo activo y permite cambiarlo desde la biblioteca, así como filtrar por fase y grupo cuando están definidos. Solo considera resultados válidos; muestra por separado partidos pendientes e incompletos o inválidos, y no interpreta los pendientes como empates. El estado operativo (sin programar, programado, en juego, finalizado, aplazado, suspendido o cancelado) se almacena aparte del marcador: solo los resultados válidos finalizados cuentan para las estadísticas y la progresión de copas. Un partido aplazado, suspendido o cancelado no recibe un resultado ni puntos administrativos automáticos; los datos deportivos guardados se conservan y pueden requerir confirmación al cambiar su estado. No se simulan partidos en juego, aplazados, suspendidos o cancelados ni partidos marcados como finalizados sin resultado. Los partidos históricos sin estado explícito mantienen su interpretación anterior a partir del resultado y la programación registrados; no se infiere que hayan sido suspendidos o cancelados. El campeón se confirma únicamente al completarse una liga con líder único en puntos o una final de copa reconocible y resuelta.

Las transiciones permitidas son: sin programar → programado; programado → sin programar, en juego, aplazado o cancelado; en juego → suspendido o finalizado; finalizado → aplazado, suspendido o cancelado; aplazado → sin programar, programado o cancelado; suspendido → en juego, finalizado, aplazado o cancelado. Cancelado es terminal. Programar requiere fecha y hora locales completas; aplazar no asigna otra fecha y la reprogramación se hace aparte. La interfaz confirma cada cambio, explica sus consecuencias y conserva marcador, programación, alineaciones, eventos y sustituciones; si hay un resultado guardado que dejará de contar como final, solicita confirmación. Se registra la fecha de modificación y la observación es opcional; no hay historial de transiciones. La versión 7 de los respaldos incluye el estado explícito y el historial; los respaldos versión 6 y anteriores siguen siendo legibles y no reciben estados ni eventos históricos inventados.

El historial de actividad registra cambios realizados desde su incorporación, incluidos marcadores, simulaciones, programación, estados operativos, autores, alineaciones, sustituciones y eventos, reglamentos, plantillas, temporadas, archivo/restauración, importaciones, renombres y eliminaciones. Los eventos contienen tipo, fecha, temporada/competición, referencia de entidad cuando se conoce, resumen y valores anterior/nuevo para los campos modificados; no se atribuyen a usuarios. Las importaciones rechazadas se etiquetan como tales. Un evento de eliminación conserva el nombre e identificador como snapshot, sin ofrecer un enlace a un torneo que ya no existe. La consulta es de solo lectura y se abre desde la biblioteca y los partidos. No se generan eventos retroactivos; los eventos recuperados desde un respaldo se marcan como importados. Los registros son editables fuera de la aplicación y no constituyen una auditoría inviolable. Se guardan en almacenamiento local y crecen hasta que se eliminen los datos del navegador; no hay retención automática ni sincronización.

Los autores de goles son opcionales y se editan desde cada partido, sin modificar su marcador. Se registra equipo, nombre, minuto opcional y tipo opcional (normal, penal o autogol); la validación limita el jugador a los equipos participantes. Los torneos históricos sin autores siguen siendo válidos y se muestra que no hay información suficiente para una tabla de goleadores. Si los registros no coinciden con los goles del marcador (incluida la prórroga, sin contar penales de definición), aparece una advertencia sin ajustar el resultado automáticamente.

La gestión de plantillas también es opcional y está disponible en el panel de estadísticas de cada temporada. Cada perfil usa un ID estable y sus registros de equipo/número/estado pertenecen al torneo guardado; las transferencias en otra temporada conservan el perfil y la plantilla anterior. Crear una temporada no copia jugadores automáticamente: la opción de copiar la plantilla debe activarse expresamente. Retirar o transferir jugadores conserva sus pertenencias históricas y los autores de goles ya registrados. Al editar un autor se puede seleccionar un jugador de la plantilla o escribir un nombre manual; el segundo caso no se vincula a una identidad. Las apariciones, asistencias, tarjetas y minutos no se deducen porque el simulador no guarda esos datos.

El panel de importación permite elegir entre Chile, Argentina, Brasil o la categoría separada **Continentales**. Para Chile consulta las páginas oficiales de [Liga de Primera 2026](https://www.campeonatochileno.cl/ligas/liga-de-primera-mercado-libre/), [Copa Chile](https://www.campeonatochileno.cl/competition/copa-chile-coca-cola-zero-azucar/), [Primera B / Campeonato de Ascenso 2026](https://www.campeonatochileno.cl/competition/campeonato-de-ascenso-caixun-2026/), [Segunda División 2026](https://www.campeonatochileno.cl/competition/liga-de-segunda-division-panini/) y las competencias de [ANFA Tercera División](https://anfaterceradivision.cl/assets/php/home.php). También permite importar la temporada anual de Primera División de Argentina (Apertura, Clausura y fases finales publicadas) y la [Série A de Brasil](https://www.espn.com/soccer/fixtures/_/league/bra.1) desde la API pública de ESPN; para Argentina la fuente es su [calendario de Liga Profesional](https://www.espn.com/soccer/fixtures/_/league/arg.1). La categoría Continentales ofrece la [Copa Libertadores](https://www.espn.com/soccer/fixtures/_/league/conmebol.libertadores) y la [Copa Sudamericana](https://www.espn.com/soccer/fixtures/_/league/conmebol.sudamericana) desde esa misma API. ESPN es un proveedor externo, no una fuente oficial de las federaciones. Las copas nacionales usan sus sitios oficiales: el [fixture de Copa Argentina](https://www.copaargentina.org/es/fixture.html) y las fases/partidos de Copa do Brasil publicados por la [CBF](https://www.cbf.com.br/futebol-brasileiro/tabelas/copa-do-brasil/masculino/2026). Los calendarios se consultan en línea al importar o actualizar y no están guardados en el código. Cada competición se conserva como torneo local independiente. Al reimportar se ofrece crear una copia, actualizar conservando los marcadores locales coincidentes, reemplazar expresamente los datos por los de la fuente o cancelar.

Primera y Primera B se importan como ligas por ruedas usando la numeración de fechas publicada. Copa Chile conserva sus grupos y las rondas eliminatorias de ida y vuelta de octavos, cuartos y semifinales; la final se juega a partido único. Las etapas se muestran sin numeración de fecha, las tablas se ocultan durante las eliminatorias y las semifinales/final se generan al completar la ronda anterior. En la vuelta, la aplicación calcula el global con el resultado de ida y pide/simula penales cuando el marcador agregado queda empatado; importa también las tandas publicadas por ANFP. Al importar Segunda División se elige entre Zona de Ascenso y Zona de Descenso; cada opción guarda una copia independiente, con sus partidos y su tabla propios. La fuente oficial publica estas zonas como “Fase final Campeón” y “Fase final descenso”; la liguilla separada no se mezcla con ninguna de ellas. Tercera A se importa como campeonato nacional; para Tercera B se puede elegir Zona Norte o Zona Sur. La fuente ANFA publica sus calendarios por jornada, por lo que la importación consulta todas las jornadas disponibles y mantiene cada torneo zonal separado. Argentina conserva el Apertura, los playoffs y el Clausura como etapas separadas dentro del torneo anual. Copa Argentina importa las rondas y los resultados oficiales, incluidos los penales; sus cruces son a partido único y las rondas futuras se generan al completar la anterior. Copa do Brasil importa las fases y jornadas que publica la CBF, usando la ida/vuelta indicada para cada fase; muestra los partidos por etapa, calcula los globales y genera la ronda siguiente al completarse la actual. Libertadores y Sudamericana importan fases, grupos, partidos y resultados desde ESPN; excluyen equipos todavía por definir. Al completarse los seis partidos de cada uno de los ocho grupos, Libertadores avanza primero y segundo a octavos y envía a los terceros al playoff de Sudamericana; Sudamericana avanza a sus primeros a octavos y a sus segundos al playoff contra esos terceros. Los cruces publicados por ESPN se mantienen. Si ESPN todavía no entrega un cruce con equipos, se genera uno reproducible con los clasificados disponibles, sin emparejar en octavos de Libertadores equipos del mismo grupo; este emparejamiento de respaldo no sustituye el sorteo oficial. Los ganadores del playoff pasan a octavos de Sudamericana. Las eliminatorias a dos partidos se resuelven por global y penales; completar o sobrescribir marcadores vuelve a calcular los cruces generados y limpia resultados de rondas dependientes cuando cambian los clasificados. En todas las copas se oculta “Fecha NN” y las etapas futuras se mantienen visibles aunque todavía no tengan cruces. Como la API de ESPN no entrega el número oficial de jornada de Brasil, la Serie A se organiza en una secuencia coherente de 38 jornadas de ida y vuelta a partir de los cruces entre equipos; no representa el orden oficial de fechas. Un partido aplazado brasileño se incorpora solo si a esa pareja de clubes le falta uno de sus dos cruces activos; así no se duplica un partido que ya fue reprogramado.

La tabla de Primera de Chile destaca al 1.º como campeón y marca los puestos base: 1.º–2.º a Libertadores (fase de grupos), 3.º para el partido por Chile 4 ante el campeón de Copa Chile (cupo de Libertadores fase previa; el perdedor clasifica a Sudamericana) y 4.º–6.º a Sudamericana. El campeón de Copa de la Liga ocupa Chile 3. La aplicación no calcula los resultados de esas copas ni del partido por Chile 4, o los corrimientos que puedan producir. También marca los dos últimos puestos como descenso. En Primera B, marca al 1.º como campeón/ascenso directo, del 2.º al 8.º como playoff y al último como descenso. En Segunda División, el primer lugar de Zona de Ascenso se destaca como campeón y no se señalan descensos en esa zona; en Zona de Descenso se resaltan los dos últimos puestos. En Tercera A se marca al 1.º como ascenso directo, del 2.º al 5.º para playoff, al 11.º y 12.º en playoff de descenso y a los dos últimos como descenso directo. En cada zona de Tercera B, el 1.º asciende directamente, 2.º–3.º juegan playoff y los dos últimos descienden. En Brasil se destacan el campeón, los puestos base 1.º–4.º de Libertadores (fase de grupos), 5.º–6.º de Libertadores (fase previa), 7.º–12.º de Sudamericana y los cuatro últimos de descenso; los cupos internacionales pueden correrse si los campeones de copa ya clasificaron. Estas zonas se calculan sobre la clasificación de la etapa importada y se actualizan al editar o simular marcadores.

Para Argentina 2026, los partidos de fase regular se asignan a las zonas oficiales A y B; la tabla de cada zona incorpora los resultados de sus partidos interzonales. El selector de clasificación permite consultar Zona A, Zona B o la tabla anual, que suma Apertura y Clausura y excluye todos los playoffs. Al pulsar “Simular fase” desde la liga regular de Apertura o Clausura puedes elegir entre simular solo la liga o completar también sus playoffs. Al completar los 240 partidos y las 16 fechas se crea el cuadro de octavos con los ocho primeros de cada zona (1.º A–8.º B, 2.º A–7.º B y viceversa); las rondas siguientes se generan al terminar la anterior. Octavos, cuartos, semifinales y final son a partido único, con prórroga y penales en caso de empate. “Simular campeonato” completa de forma secuencial las rondas que se van creando, y los resultados manuales también avanzan el cuadro. En eliminatorias Apertura importadas, la fuente distingue las definiciones con prórroga y penales de los partidos definidos directamente por penales; los cruces pendientes se simulan con prórroga y penales. La API no publica un número de fecha fiable para Argentina, así que sus jornadas se reagrupan para que cada equipo juegue como máximo una vez por fecha; la secuencia puede diferir del calendario oficial.

La configuración de un campeonato tiene una pantalla dedicada, separada de la tabla y del calendario. Desde ella puedes importar una competición existente o crear una personalizada con los equipos, el número de ruedas y el orden de desempate que elijas.

En la tabla anual argentina se destaca al líder como Campeón de Liga; los puestos base 2.º, 3.º y 4.º–9.º corresponden respectivamente a Libertadores (fase de grupos), Libertadores (fase previa) y Sudamericana. Esas son las plazas base por tabla: pueden correrse si los campeones de Apertura, Clausura o Copa Argentina ya clasificaron por otra vía, ajuste que la aplicación aún no calcula. Descienden el último por promedios de las tres temporadas recientes y el último de la tabla anual; si ambos puestos corresponden al mismo equipo, también desciende el penúltimo anual. La aplicación aún no calcula promedios históricos, por lo que solo marca el último puesto anual y explica esa limitación en la tabla. El formato de zonas se basa en el [anuncio de Liga Profesional](https://www.ligaprofesional.ar/notas/primera/2025/12/10/se-definen-las-zonas-para-la-temporada-20226/), la clasificación a copas en la [distribución de plazas 2027](https://www.tycsports.com/liga-profesional-de-futbol/tabla-anual-2026-clasificacion-libertadores-sudamericana-2027-id751165.html) y los descensos en el [reglamento citado por ESPN](https://www.espn.com.ar/futbol/argentina/nota/_/id/12190419/liga-de-argentina-como-quedo-tabla-descenso-promedios).

Las bases oficiales consultadas para estos puestos están publicadas por la [ANFP para Primera B 2026](https://www.anfp.cl/wp-content/uploads/2026/01/Bases-Primera-B-2026_VF_1.pdf) y [Segunda División 2026](https://www.anfp.cl/wp-content/uploads/2026/03/Bases-Segunda-Division-2026-2.pdf).

Campeonato Chileno (ANFP), ANFA Tercera División, Copa Argentina y CBF no habilitan CORS, así que la web los consulta por el mismo origen en `/official-source`, `/third-division-source`, `/argentina-cup-source` y `/brazil-cup-source`. Las sirve siempre el mismo proxy cerrado, `@cancha/official-source-proxy`, con destino fijo por sitio, sólo GET, sin cabeceras del cliente, timeout, tamaño máximo, caché y rate limit:
- en producción, la API (el *rewrite* de la web debe incluir esas cuatro rutas, además de `/graphql`);
- en `npm run dev` y `npm run preview`, un plugin de `apps/web/vite.config.ts` con el mismo módulo, así que el modo sin sesión importa sin levantar la API.

La API de ESPN sí admite consultas desde el navegador y no pasa por el proxy. Ver [docs/official-source-proxy.md](docs/official-source-proxy.md).

## Reglas de clasificación y verificación

Los torneos personalizados permiten configurar puntos por victoria, empate y derrota, además del orden de desempate. El enfrentamiento directo se puede ordenar por puntos, diferencia de goles y goles a favor; cada criterio se recalcula solo sobre el subconjunto que permanece empatado. El criterio legado “Enfrentamiento directo · minitabla completa” conserva el comportamiento histórico.

Las reglas asociadas a temporadas importadas guardan la temporada, fuentes consultadas y un estado independiente para tabla y clasificación: verificadas, provisionales o pendientes. Si la temporada no tiene un desempate verificado, el orden que se muestra es orientativo y la interfaz lo advierte explícitamente; no se presenta como clasificación oficial. Los torneos históricos sin esta metadata conservan los 3/1/0 y criterios guardados antes de esta versión.

La configuración 2026 de Primera de Chile, Ascenso, Segunda, ANFA, Argentina, Brasil y fases de grupos continentales todavía no tiene desempates reglamentarios confirmados en el proyecto: sus tablas se señalan como pendientes. Los puestos argentinos, chilenos y brasileños sujetos a campeones de copa se mantienen provisionales. El dominio ahora admite cupos internacionales configurados por destino y posición, campeones de copas jugables y corrimientos explícitos a la siguiente posición elegible; solo los calcula cuando esas reglas se incorporan a la configuración estacional, y mantiene como pendientes los destinos afectados por copas inconclusas. Actualmente no hay una asignación de corrimientos configurada como regla verificada.

El cálculo reutilizable de promedios recibe las temporadas configuradas, suma puntos y partidos efectivamente disputados, y permite identificar historiales incompletos, como clubes recién ascendidos. Puede resolver empates únicamente con criterios configurados y señala empates limítrofes sin desempate suficiente como provisionales. La aplicación solo integra esta vista cuando una competición contiene esa configuración. Para Argentina no se han fijado todavía las temporadas exactas ni la configuración verificada del promedio, y faltan sus datos históricos en el almacenamiento; por ello no se producen descensos definitivos por promedios. Tampoco se activan promedios en torneos cuyo modelo no los configure.

Los campos nuevos de identidad estable de un club (`averageIdentity`) y de reglas dinámicas son opcionales. Los torneos antiguos guardados en LocalStorage siguen siendo válidos y conservan el cálculo previo. En Ascenso, el cuadro 2026 continúa identificado como provisional porque su estructura se basa en el formato ANFP documentado para 2025. Los playoffs de Tercera A/B y sus desempates permanecen pendientes de verificar. Los indicadores y las fuentes están en los detalles de cada tabla.

## Validaciones

```bash
npm test
npm run lint
npm run build
```

`npm test` ejecuta las pruebas de todos los workspaces: las unitarias de `packages/core` (entorno Node, sin DOM), las de `apps/api` (chequeo de tipos + Vitest) y las de `apps/web`, incluidas las pruebas React de interacción real. El archivo `apps/web/src/presentation/app.test.tsx` usa React Testing Library, `user-event` y el entorno jsdom mediante la anotación de Vitest; no hace falta una orden adicional. `npm run build` primero comprueba los tipos de `packages/core` sin la biblioteca DOM, lo compila a `packages/core/dist` para Node y luego compila la web en `apps/web/dist` (la web no usa `packages/core/dist`).

## API

`apps/api` es una API NestJS 12 que consume `@cancha/core` compilado (`packages/core/dist`) y persiste en MongoDB. Expone los casos de uso de core por GraphQL en `/graphql`, ejecutados mediante una unidad de trabajo. Desde la fase 4 exige una sesión: cuentas con email y contraseña, access token JWT y refresh token rotativo en una cookie HttpOnly.

```bash
npm run db:up                             # MongoDB 8.0 en Docker como replica set de un nodo (espera al healthcheck)
cp apps/api/.env.example apps/api/.env   # ajusta MONGODB_URI si hace falta
npm run dev:api                           # compila core y arranca Nest en modo watch
curl http://localhost:3000/health
npm run db:reset                          # BORRA el volumen de MongoDB y levanta una base vacía
```

- **Configuración**: `@nestjs/config` valida al arrancar `NODE_ENV`, `PORT` (3000), `MONGODB_URI` (obligatoria), `MONGODB_DB` (`cancha`) y las variables de autenticación (`JWT_ACCESS_SECRET`, `CORS_ORIGINS`, `AUTH_COOKIE_SAMESITE`, `AUTH_COOKIE_SECURE`, `REFRESH_TOKEN_TTL_DAYS`, `AUTH_RATE_LIMIT`, `AUTH_RATE_TTL_SECONDS`, `TRUST_PROXY`) y del proxy de fuentes oficiales (`OFFICIAL_SOURCE_*`). `TRUST_PROXY` es siempre un número de saltos (0 a 10), nunca `true`. Si algo es inválido la API no inicia y enumera todos los problemas. En producción, `JWT_ACCESS_SECRET` (≥ 32 caracteres, distinto del valor de desarrollo) y `CORS_ORIGINS` son obligatorias. Ver `apps/api/.env.example`.
- **Fuentes oficiales** (fase 6, `apps/api/src/official-sources/` sobre el paquete `@cancha/official-source-proxy`): `GET /official-source/*`, `/third-division-source/*`, `/argentina-cup-source/*` y `/brazil-cup-source/*` reenvían a ANFP, ANFA, Copa Argentina y CBF. Son públicas (la web sin sesión también importa), con destino fijo por prefijo, sin cabeceras del cliente, sin redirecciones a otros hosts, timeout, tamaño máximo, caché en memoria y rate limit por IP. Un fallo del origen responde 502 (504 si no responde a tiempo) con un mensaje en español. Ver [docs/official-source-proxy.md](docs/official-source-proxy.md).
- **Autenticación** (`apps/api/src/auth/`):
  - `register(input: { email, password })` y `login(input)` devuelven `{ accessToken, accessTokenExpiresAt, user }` y fijan la cookie del refresh token. `refreshToken` la canjea y la rota; `logout` cierra la sesión actual; `me` devuelve el usuario.
  - El email se guarda normalizado (sin espacios, en minúsculas) y es único. La contraseña tiene entre 12 y 256 caracteres y se guarda con argon2id. Los mensajes de validación están en español.
  - Un login fallido responde siempre "Email o contraseña incorrectos" y tarda lo mismo exista o no el email. El registro sí informa que el email ya está en uso.
  - **Access token**: JWT HS256 de 15 minutos, en `Authorization: Bearer <token>`. El cliente lo guarda sólo en memoria.
  - **Refresh token**: de un solo uso, en la cookie `cancha_refresh` (`HttpOnly`, `Secure`, `Path=/graphql`, `SameSite=Lax` por defecto, configurable). En Mongo sólo se guarda su hash. Si se reutiliza uno ya usado, se revoca la sesión completa (su familia de tokens y su access token); las demás sesiones del usuario siguen activas.
  - Cada petición verifica la firma, el vencimiento y que la sesión no esté revocada: tras `logout`, el access token deja de servir al instante.
  - Todo exige sesión salvo `GET /health`, `register`, `login` y `refreshToken`. Esas tres mutaciones tienen rate limit por IP (10 por minuto por defecto).
  - **CORS** con credenciales sólo para `CORS_ORIGINS`. `refreshToken` y `logout` rechazan además un `Origin` que no esté en la lista.
- **`GET /health`**: `200` con `{ status: "ok", app: { status, version, uptimeSeconds }, mongo: { status: "up", latencyMs } }`; `503` con el mismo formato y `mongo: { status: "down", error }` si MongoDB no responde al `ping` en 2 s. La API arranca aunque MongoDB no esté disponible.
- **GraphQL (`POST /graphql`)**: esquema *code-first* con `@nestjs/graphql` y Apollo.
  - GraphiQL (`GET /graphql` en el navegador), introspección y *stack traces* sólo con `NODE_ENV=development`.
  - **Límites**: profundidad máxima de 10 niveles por consulta y cuerpo JSON de hasta 32 MB (un respaldo realista de 60 torneos simulados pesa unos 8 MB dentro de la petición).
  - Consultas: `library` (versión de la biblioteca y torneo activo), `tournaments(includeArchived)`, `tournament(id)`, `activeTournament` y `activity(tournamentId, limit)`.
  - Mutaciones: `createTournament`, `updateMatchResult`, `simulateMatchday`, `simulateLeg`, `simulateChampionship`, `renameTournament`, `duplicateTournament`, `setTournamentArchived`, `deleteTournament` y `setActiveTournament`.
  - **Tipos**: el listado, el calendario, la tabla y la actividad tienen tipos GraphQL. El documento completo del torneo va en `Tournament.document` como escalar `JSON`, con el tipo `Tournament` de `@cancha/core`.
  - **Versiones**: cada torneo trae `version`. Las mutaciones sobre un torneo exigen `expectedVersion`; si otro cliente lo cambió, responden `CONFLICT`.
  - **Errores (`extensions.code`)**:
    - `VALIDATION`: regla de dominio, con el mensaje en español;
    - `NOT_FOUND`;
    - `CONFLICT`: incluye `tournamentId`, `expectedVersion` y `currentVersion`;
    - `UNAUTHENTICATED`: sin sesión o con un token inválido, vencido o revocado;
    - `FORBIDDEN`: `Origin` no permitido en `refreshToken` o `logout`;
    - `TOO_MANY_REQUESTS`: rate limit de autenticación superado;
    - `INTERNAL_SERVER_ERROR`: mensaje genérico; el detalle queda sólo en el log.

  ```graphql
  mutation { register(input: { email: "ana@ejemplo.cl", password: "una contraseña larga" }) { accessToken } }
  mutation { createTournament(input: { name: "Liga", teamNames: ["A", "B", "C", "D"], legs: 2, tieBreakers: ["goalDifference"] }) { id version } }
  mutation { simulateChampionship(tournamentId: "<id>", expectedVersion: 1) { simulatedCount tournament { version standings { position teamName points } } } }
  ```
- **JSON v7 en el servidor**: se usa el mismo parseo y la misma validación que la web. Nada se importa a medias: un archivo inválido o de una versión futura se rechaza sin escribir.
  - Exportar: `exportTournament(id)` devuelve un archivo `cancha-tournament` y `exportLibrary` un respaldo `cancha-backup` con el historial.
  - `importTournament(archive, decision: ADD | COPY | UPDATE)` recibe el texto del archivo. Si falla, sólo se registra el evento `tournament-import-rejected`.
  - `restoreBackup(backup, mode: MERGE | REPLACE)` agrega los torneos nuevos o reemplaza la biblioteca y el historial, en una sola transacción.
  - Los universos deportivos del respaldo se restauran con la misma regla que la web, y `exportLibrary` los incluye. Diferencia con la web: el servidor no guarda automáticamente una copia de recuperación antes de reemplazar; para tener una, crea antes un punto de guardado. `restoreBackup` acepta `expectedLibraryVersion` para no reemplazar una biblioteca que cambió.
- **Biblioteca con sesión** (fase 5): `librarySnapshot` devuelve la biblioteca completa del usuario y `commitLibraryChanges(changes, expectedLibraryVersion)` confirma los cambios que la web calculó sobre su copia en memoria. El servidor valida todo lo que llega (torneos, eventos, referencias y universos) y lo escribe en una transacción; si la biblioteca cambió, responde `CONFLICT` sin escribir. Ver [docs/session-library.md](docs/session-library.md).
- **Esquema publicado**: `apps/api/schema.graphql`. Una prueba exige que coincida con el esquema real; regenéralo con `UPDATE_GRAPHQL_SCHEMA=1 npm test -w @cancha/api -- src/graphql/schema-snapshot.e2e.test.ts`. La web valida contra él todas sus operaciones.
- **Puntos de guardado** (por usuario): `createSaveCheckpoint(name, description)` guarda una copia completa de la biblioteca y su historial (respaldo JSON v7 con huella SHA-256). `saveCheckpoints` los lista, `saveCheckpointContent(id)` descarga el respaldo verificado y `deleteSaveCheckpoint(id, expectedVersion)` elimina uno.
  - Para restaurar: `saveCheckpointPreview(id)` verifica el punto, lo compara con la biblioteca actual y devuelve la versión del punto y la de la biblioteca. Después, `restoreSaveCheckpoint(id, expectedVersion, expectedLibraryVersion)` reemplaza la biblioteca en una sola transacción.
  - Si la biblioteca o el punto cambiaron desde la vista previa, responde `CONFLICT` sin escribir nada. Un punto alterado en la base no pasa la verificación (`VALIDATION`).
  - Límite: 20 puntos por usuario, de hasta 15 MB cada uno.
- `dev:api` vuelve a compilar core sólo al iniciar: si cambias `packages/core`, reinícialo. `npm run build` compila core antes que la API.
- `npm run lint` impide que `apps/api` importe `apps/web` o rutas relativas a `packages/`.

### Casos de uso expuestos por GraphQL (fase 3)

| Caso de uso de core (`application/use-cases/`) | Operación GraphQL |
| --- | --- |
| `create-tournament` | `createTournament` |
| `update-match-result` | `updateMatchResult` |
| `simulate-tournament-selection` (nuevo; usa `simulate-fixtures` y `persist-tournament-progress`) | `simulateMatchday`, `simulateLeg` |
| `simulate-championship` | `simulateChampionship` |
| `manage-tournaments` (`renameTournament`, `duplicateTournament`) | `renameTournament`, `duplicateTournament` |
| `set-tournament-archived` | `setTournamentArchived` |
| `import-tournament-archive` (+ `parseTournamentArchive`) | `importTournament` |
| `restore-tournament-backup` (nuevo; plan en `services/library-restore`) | `restoreBackup` |
| Puerto: `deleteById`, `setActiveTournamentId` | `deleteTournament`, `setActiveTournament` |
| Servicios: `createTournamentArchive`, `createTournamentBackup` | `exportTournament`, `exportLibrary` |
| Consultas: `calculateStandingsWithResolution`, `seasonOverview` y lectura del puerto | `library`, `tournaments`, `tournament`, `activeTournament`, `activity` |

`advance-tournament-progress` y `persist-tournament-progress` se ejecutan dentro de las simulaciones.

### Sin operación GraphQL propia

La web con sesión no los necesita: los ejecuta sobre su copia en memoria y envía los cambios con `commitLibraryChanges`. Siguen pendientes sólo para clientes que quieran que el servidor haga el cálculo.

| Grupo | Casos de uso | Qué falta |
| --- | --- | --- |
| Edición de partidos | `update-fixture-details`, `update-fixture-schedule`, `update-fixture-operational-state`, `update-match-goal-scorers` | Son síncronos y directos: tipos de entrada (alineaciones, eventos, horario) y una mutación cada uno. |
| Reglas y registros | `update-season-rules`, `update-tournament-records` (reglamentos y plantel), `update-team-affiliation`, `register-national-cup-regulation` | Entradas grandes y versionadas: decidir entre tipos de entrada o un `JSON` validado por core. |
| Resoluciones oficiales | `record-official-resolution` (registrar y revocar) | Entrada de resolución y política de `advanceProgression`. |
| Temporadas | `create-tournament-season`, `create-linked-division-seasons`, `simulate-argentina-half` | Síncronos; requieren definir sus entradas (selección de copa nacional, equipos entrantes). |
| Revisar → confirmar | `plan-season`, `prepare-continental-edition`, `prepare-stage-draw` (sorteo y calendario), `configure-stage-draw`, `confirm-season-closure`, `record-club-affiliation`, `review-sports-resolution`, `simulate-season-scope`, `program-season-calendar` | La revisión se ata a la confirmación con un `WeakMap` en memoria, así que no puede repartirse entre dos peticiones HTTP. Opciones: revisar y confirmar en la misma unidad de trabajo, o un token de revisión firmado con la versión de la biblioteca. |
| Asíncronos | `import-official-tournament`, `import-planned-season-calendar`, `generate-local-groups` | La unidad de trabajo sólo admite casos de uso síncronos. Además, las fuentes oficiales (`OfficialLeagueSource`) se consultan desde el navegador a través del proxy de fuentes oficiales (fase 6); ejecutarlos en el servidor exigiría adaptadores `OfficialLeagueSource` de Node. |

### MongoDB

- `docker-compose.yml` (raíz): imagen `mongo:8.0.38` con `--replSet rs0`, volumen `cancha-mongo-data` y un healthcheck que inicia el replica set la primera vez. Las transacciones de MongoDB exigen un replica set. `npm run db:up` lo levanta y espera a que esté sano; `npm run db:down` lo detiene sin borrar el volumen; `npm run db:reset` borra el volumen y levanta una base vacía. El miembro se anuncia como `localhost:27017`, válido para conectarse desde el host con `directConnection=true`.
- `MongoTournamentRepository` (`apps/api/src/infrastructure/persistence/`) guarda la biblioteca de torneos con las mismas validaciones y garantías que el adaptador de `localStorage`, pero con transacciones reales: `saveWithActivity`, `saveManyWithActivity`, `recordActivity` y `deleteById` escriben el torneo y su evento de actividad en una sola transacción o no escriben nada.
- **Biblioteca por usuario**: cada usuario tiene su propia biblioteca, historial, torneo activo y versión de biblioteca. Todos los documentos llevan `_id: { userId, id }`, y el usuario sale siempre de la sesión, nunca de un argumento. Un torneo de otro usuario responde `NOT_FOUND`, igual que uno inexistente, para no revelar que existe. Dos usuarios pueden tener torneos con el mismo nombre e incluso el mismo id (al importar el archivo del otro) sin interferir.
- Colecciones: `tournaments` (un documento por torneo, `_id` = `{ userId, id }`, `_version`, `_saveSeq`, `_savedAt`), `activity` (`_id` = `{ userId, id del evento }`, `_seq` = orden de registro), `counters` (secuencias por usuario) y `library_state` (torneo activo y versión de la biblioteca de cada usuario). Índices por usuario: `tournaments` por `_id.userId` + `_saveSeq`, `activity` por `_id.userId` + `_seq` (único) y por `_id.userId` + `tournamentId` + `_seq`; se crean al arrancar la API. Autenticación: `users` (email único), `sessions` (una por login, revocable) y `refresh_tokens` (hash del token, un solo uso); sus índices, incluidos los TTL que limpian lo vencido, se crean antes del primer registro o login.
- **Datos anteriores a la fase 4B**: la biblioteca global de antes (documentos con `_id` de texto) no la ve ningún usuario, y la API avisa al arrancar si quedan. No hay migración: para conservarla, expórtala con `exportLibrary` usando una versión anterior, vacía la base con `npm run db:reset` y restáurala en tu cuenta con `restoreBackup(mode: REPLACE)`.
- **Concurrencia optimista**: cada torneo tiene una versión. Si dos clientes leen la misma versión y ambos guardan, el segundo recibe `TournamentVersionConflictError` ("otro cliente lo modificó (versión esperada N, versión actual M). Recarga el torneo y vuelve a aplicar tus cambios.") y su transacción completa se descarta.
- **Unidad de trabajo** (`apps/api/src/library/library-unit-of-work.ts`): `LibraryUnitOfWork.run(casoDeUso, { expectedVersions })` funciona así:
  1. Carga la biblioteca de Mongo en un `InMemoryTournamentRepository`.
  2. Ejecuta el caso de uso de core sin cambios.
  3. Escribe todos los cambios (torneos, eliminaciones, eventos y torneo activo) en una sola transacción. Verifica la versión de cada torneo y la de la biblioteca, para evitar decidir con datos que otro cliente cambió.

  Si el caso de uso lanza, no se escribe nada; sólo se conservan los eventos de rechazo. Un conflicto sólo de biblioteca se reintenta hasta 3 veces.
- **Suite de contrato**: `packages/core/src/test-utils/tournament-repository-contract.ts` define en 13 casos lo que debe cumplir cualquier repositorio de la biblioteca: guardar y leer sin pérdidas, escrituras coordinadas con el historial, operaciones de varios torneos sin escrituras parciales, eliminación y torneo activo. Se ejecuta contra `LocalStorageTournamentRepository` (web), `MongoTournamentRepository` e `InMemoryTournamentRepository` (API); los tres la cumplen completa.
- Pruebas: `npm test` usa, una sola vez por corrida, [mongodb-memory-server](https://github.com/typegoose/mongodb-memory-server) (`mongod` real en modo replica set), sin Docker. La versión del binario está fijada en `config.mongodbMemoryServer.version` de `apps/api/package.json` (la misma que la imagen de Docker; cámbialas juntas). La primera ejecución descarga el binario (~80 MB) a `~/.cache/mongodb-binaries`; en CI conviene cachear esa carpeta o fijarla con `MONGOMS_DOWNLOAD_DIR`.

## Importadores: cobertura, validación y reimportación

| Importador | Fuente y campeonatos/temporadas | Datos y límites conocidos |
| --- | --- | --- |
| ANFP | HTML de Campeonato Chileno 2026 vía proxy `/official-source`: Primera, Primera B, zonas de Segunda y Copa Chile. | Extrae fechas/fases, equipos y marcadores publicados; Copa Chile incluye grupos y rondas disponibles. No recibe necesariamente fechas de calendario ni una lista maestra independiente de equipos. |
| ANFA | HTML de calendarios de Tercera A y Tercera B Norte/Sur 2026 vía `/third-division-source`; consulta jornadas disponibles con concurrencia limitada. | Extrae participantes y resultados visibles por jornada. No importa lista separada de clubes ni fechas exactas de partido. |
| ESPN ligas | JSON público de ESPN: Primera de Argentina y Série A de Brasil 2026. | Importa partidos, marcadores y fases; la tabla se calcula localmente. La API no certifica exhaustividad ni se ofrecen temporadas históricas seleccionables. Brasil se organiza en secuencia local de 38 fechas, no en el orden oficial de jornadas. |
| ESPN continentales | JSON público de ESPN para Libertadores y Sudamericana 2026. | Importa grupos, partidos y resultados de fases previas/eliminatorias. Los desempates de grupos siguen pendientes de verificación. |
| Copa Argentina | Endpoints JSON consumidos desde el sitio oficial; edición publicada y fixture. | Importa rondas, equipos, resultados y penales publicados. No dispone de temporadas históricas seleccionables. |
| Copa do Brasil | Segmentos JSON de navegación RSC del sitio CBF; la temporada consultada usa el año actual del equipo cliente. | Extrae fases, partidos y marcadores publicados. La estructura puede cambiar; las respuestas no parseables se rechazan. |

Antes de guardar, se validan temporada e identificador, nombres y unicidad de equipos, fechas/rondas, identificadores y duplicados de partidos, pertenencia de participantes a la lista de equipos cuando la fuente la proporciona, y marcadores completos dentro del rango permitido. También se ejecuta la validación de integridad del dominio. Las fuentes actuales suelen derivar los equipos de los encuentros y no certifican que sus calendarios sean exhaustivos; por ello la cobertura permanece `unknown` si no viene expresamente informada. Una fuente inaccesible o con formato inesperado produce un error, no una importación exitosa parcial. No hay importación desde archivos locales.

Los torneos nuevos guardan la temporada explícitamente en `season`; los registros históricos sin ese campo siguen siendo válidos y la biblioteca conserva su extracción desde el nombre. Al reimportar, se compara el identificador/temporada real publicado y el usuario puede crear una copia, actualizar conservando marcadores de partidos con el mismo ID y participantes, reemplazar expresamente todos los datos o cancelar. La actualización no arrastra marcadores a encuentros retirados o con participantes cambiados. La fuente no distingue resultados editados manualmente de los importados, por lo que el modo de conservación preserva todos los resultados locales coincidentes; el reemplazo advierte explícitamente que usa los resultados de la fuente.

## Exportar e importar campeonatos

La biblioteca permite exportar un torneo como JSON, exportar todos los torneos como respaldo, importar un torneo y restaurar un respaldo. El esquema vigente usa `format: "cancha-tournament"` para un campeonato o `format: "cancha-backup"` para una biblioteca, ambos con `version: 7` y `exportedAt`. Incluye el modelo deportivo completo (identificadores, equipos, fixture, marcadores/penales, temporada, formato, puntos, desempates, reglas y su verificación), perfiles de jugadores, pertenencias por temporada, datos opcionales de alineaciones, sustituciones, eventos, programación y estado operativo por partido, reglas versionadas y el historial de actividad en el respaldo completo; no contiene datos de usuario ni estados de interfaz.

Cada partido puede incluir, de forma opcional, `schedule` con `date` (`AAAA-MM-DD`), `time` (`HH:mm`, reloj de 24 horas local), `venue` y `logisticsNotes`. Fecha y hora son valores locales sin zona horaria: no se interpretan como instantes UTC ni se convierten al guardar, mostrar o exportar. Los campos ausentes significan que ese dato no se registró. Esta extensión opcional se conserva en los archivos versión 5; los torneos y respaldos históricos sin `schedule` siguen representando partidos sin programación.

Los archivos se validan como JSON, estructura, versión, resultados y referencias de equipos, jugadores, plantillas, detalles de partido y reglamentos, y pasan la validación de integridad antes de guardar. Se aceptan torneos históricos sin alineaciones, eventos, plantillas, reglamentos ni otros campos opcionales actuales; también se leen versiones anteriores del respaldo y el formato legado sin envoltorio de torneo (versión 0), manteniendo los datos disponibles. Los campos de regla vacíos significan “sin configurar” y se distinguen de cero; una infracción deportiva produce una advertencia y conserva los registros. Si faltan reglas explícitas de alineación, se mantiene la validación anterior de once titulares por equipo; las sustituciones no tienen límite sin una configuración. Un reglamento copiado a otra temporada queda pendiente de verificación. Las estadísticas de minutos quedan como no disponibles hasta registrar la duración del partido. Los IDs de perfiles deben ser únicos dentro de cada torneo; el mismo ID puede aparecer en snapshots de temporadas distintas para conservar la identidad histórica. Versiones posteriores o estructuras inválidas se rechazan sin importación parcial.

Si el ID de un torneo importado ya existe, se puede cancelar, generar una copia con ID de torneo/equipos/partidos nuevos o actualizar explícitamente el existente. La restauración primero valida todos los torneos: **Agregar** conserva la biblioteca y omite colisiones de ID sin reemplazarlas; **Reemplazar biblioteca** reemplaza el conjunto completo tras confirmación y permite recuperar una biblioteca local dañada. Si el respaldo entrante no es válido, no se modifica nada; la opción de agregar también se bloquea si la biblioteca actual está dañada para no descartar registros. La colección y la selección activa se escriben con reversión si falla el almacenamiento. La exportación del respaldo se desactiva cuando se detectaron registros locales dañados, para no presentar una copia incompleta como completa. No se realizan transferencias a servidores externos.

## Cuenta y biblioteca en el servidor

Crear una cuenta es opcional. Sin sesión, todo sigue igual que antes: la biblioteca vive en este navegador.

- **Cuenta** (cabecera): crear una cuenta con email y contraseña (al menos 12 caracteres), ingresar y cerrar sesión. La sesión se recuerda en este navegador.
- **Llevar la biblioteca del navegador a la cuenta**: al ingresar, si este navegador tiene torneos, se ofrece subirlos (cuenta vacía), agregarlos o reemplazar la biblioteca de la cuenta. Reemplazar pide confirmación y guarda antes un punto de guardado en la cuenta. La biblioteca del navegador no se borra ni se modifica, y vuelve a aparecer al cerrar sesión.
- **Con sesión**, todas las funciones trabajan sobre la biblioteca de la cuenta, que se guarda en el servidor después de cada operación. El centro de guardado usa los puntos de la cuenta (hasta 20).
- **Dos pestañas o dispositivos**: si otro cambió la biblioteca, la escritura no se aplica y aparece el aviso de cambios externos para actualizar la vista; nada se sobrescribe a ciegas.
- Con sesión no se puede trabajar sin conexión: una operación sin red no se guarda.
- Para desarrollar con cuenta, levanta la API (`npm run db:up`, `npm run dev:api`) y la web (`npm run dev`): Vite reenvía `/graphql` a la API.

Detalles, decisiones y verificación: [docs/session-library.md](docs/session-library.md).

## Guardado, estado de persistencia y recuperación

Sin sesión, las operaciones confirmadas se escriben inmediatamente en `localStorage` (con sesión, en el servidor: ver la sección anterior); no existe una cola de guardado diferido ni una segunda escritura de auto-guardado. La interfaz indica que un cambio quedó guardado solo después de que la operación de escritura termina correctamente. Al fallar, muestra un estado de error y conserva el estado previo en memoria; `localStorage` ofrece escrituras síncronas por clave, pero no una transacción nativa entre torneo, actividad y selección.

Sin sesión, el adaptador de persistencia de la aplicación es `LocalStorageTournamentRepository` (con sesión, la réplica de la biblioteca de la cuenta: ver [docs/session-library.md](docs/session-library.md)). Los casos de uso auditados requieren `saveWithActivity`; un repositorio sin esa capacidad falla antes de guardar el torneo, en vez de usar el fallback no atómico `save` seguido por `recordActivity`. El adaptador local escribe torneo e historial coordinadamente y trata de revertir ambos valores si falla una escritura. Si el propio rollback falla, el error lo informa explícitamente. Esto no equivale a una transacción del navegador ni a una garantía centralizada.

Antes de una restauración explícita que reemplace la biblioteca, se guarda `cancha.recovery` solo si la biblioteca y su historial previos pasan la validación. Desde la biblioteca se ofrece recuperar esa copia tras una confirmación explícita, mediante el mismo flujo validado y transaccional. La copia solo está disponible mientras torneos, actividad y selección activa sigan coincidiendo exactamente con el estado creado por ese reemplazo; una escritura posterior la invalida para evitar restaurar sobre trabajo nuevo. No se crea copia recuperable desde datos previos corruptos o inválidos. Si el almacenamiento está lleno y no se puede crear la copia de una biblioteca válida, el reemplazo no comienza. La importación/restauración conserva su validación integral y no modifica parcialmente los datos ante respaldo inválido.

Los errores de almacenamiento inaccesible, JSON dañado, datos inválidos y cuota llena se presentan sin vaciar automáticamente el almacenamiento. Los respaldos completos manuales siguen incluyendo temporadas, reglamentos, plantillas, programación, estados operativos y actividad; la descarga solo ocurre por acción explícita. Como las escrituras del modelo son síncronas, no hay cambios persistentes pendientes que puedan recuperarse tras cerrar o interrumpir la página. Los datos que nunca alcanzaron una escritura exitosa no pueden recuperarse; el navegador tampoco garantiza retención frente a borrado de datos, fallas del dispositivo o modificaciones externas.


## Segundas divisiones de Argentina y Brasil (2026)

El selector de importación incorpora **Primera Nacional** (`argentina-nacional`, ESPN `arg.2`) y **Série B** (`brasil-serie-b`, ESPN `bra.2`). ESPN se identifica como proveedor externo. Se consultan el calendario y, para Argentina, las zonas de su endpoint de tablas con temporada explícita. Las jornadas se reorganizan localmente: no se presentan como el orden oficial. Se omiten encuentros con participantes TBD; fases desconocidas, años incorrectos o zonas inconsistentes rechazan la importación, sin fabricar participantes ni resultados. La cobertura sigue siendo desconocida y la progresión verifica los cruces necesarios, no solo el número de partidos publicado.

Reglas consultadas:

- [AFA, boletín especial 6823, Primera Nacional 2026](https://assets1.afa.com.ar/2025/LEA-2026/ENERO/Boletin-Especial-6823---Reglamento-del-Campeonato-de-Primera-Nacional-2026.pdf), puntos 2, 5, 6 y 7; [Reglamento General AFA](https://www.afa.com.ar/upload/torneo/Reglamento_General_AFA.pdf), artículos 111 y 112.
- [CBF, REC Série B 2026](https://stcbfsiteprdimgbrs.blob.core.windows.net/img-site/cdn/REC_Brasileiro_Serie_B_2026_85d55b9f72.pdf), artículos 5, 11, 12 y 13.
- Para conectar con Primera: [LPF 2026](https://www.ligaprofesional.ar/wp-content/uploads/2026/01/Reglamento-Torneos-LPF-Primera-2026-1.pdf), artículos 24 y 26; [Estatuto AFA, 28/10/2025](https://assets1.afa.com.ar/2025/GAIOLI---septoct/Estatuto----28.10.2025.pdf), artículo 93; [REC Série A 2026](https://stcbfsiteprdimgbrs.blob.core.windows.net/img-site/cdn/REC_Brasileiro_Serie_A_2026_c984f8cf05.pdf).

Primera Nacional conserva dos zonas de 18 y computa los interzonales en sus tablas. Se exigen los 36 partidos válidos por club y las dos localías de cada cruce intrazonal. Los primeros juegan una final neutral, con prórroga y penales. El Reducido comienza con siete cruces únicos, con ventaja para el mejor ubicado; el perdedor de la primera final entra como cabeza de serie a cuartos. Cuartos y semifinales usan ida/vuelta y ventaja deportiva. Se reordena por posición de zona, puntos, DG y GF; la final es ida/vuelta y penales si persiste igualdad. Los sorteos exigidos que todavía no tienen información quedan pendientes, sin elegir por orden alfabético.

Los últimos dos de cada zona descienden. Si un empate en puntos atraviesa el límite de descenso, dos clubes generan un partido neutral con prórroga y penales. Los desempates entre más de dos clubes se registran desde el panel de resoluciones oficiales: requieren la programación publicada por AFA y resultados con referencias; no se genera automáticamente un minitorneo. El destino se determina mediante afiliación directa (Primera B) o indirecta (Federal A), registrada por el usuario junto con una fuente HTTPS de AFA. No se deduce la afiliación del nombre o la ciudad.

Série B exige veinte clubes y 380 encuentros regulares válidos. Sus criterios son victorias, DG, GF, resultado agregado directo (solo entre dos clubes), menos rojas, menos amarillas y sorteo. Las tarjetas requieren cobertura completa; sin ella no se inventa un desempate. Primero y segundo ascienden directamente; tercero/sexto y cuarto/quinto disputan dos playoffs independientes. El mejor juega la vuelta en casa; se resuelve por puntos, DG y posición regular, sin penales, prórroga ni final adicional. Los cuatro últimos bajan a Série C.

Las fases generadas se reconcilian al cambiar resultados o estados operativos; se limpian datos deportivos de cruces cuyos participantes cambian. En la final del Reducido se invalida además una vuelta que deje de respetar el global después de editar la ida. La reimportación con conservación retiene resultados de playoffs coincidentes y las afiliaciones registradas; el reemplazo explícito usa la fuente. La simulación de partidos programados de estas dos competiciones los marca como finalizados. Para marcadores manuales, el estado operativo se gestiona por separado y debe estar finalizado para contar.

El panel permite seleccionar una Primera guardada del mismo país y año y revisar los movimientos. La transición brasileña calcula los últimos cuatro con el REC Série A. La argentina requiere los finales de Apertura/Clausura y los datos regulares completos de 2024–2026 para promedios; toma el último promedio y luego el último anual excluyendo al ya descendido. Se bloquea ante empates decisivos, cobertura histórica no acreditada, playoffs o resultados pendientes. Los cuatro ingresantes desde categorías inferiores se registran expresamente con una fuente; sus categorías no se simulan.

**Alcance de la próxima temporada:** se crean conjuntamente dos snapshots de planificación con los nuevos participantes y un evento de actividad, manteniendo intactas las temporadas anteriores. No contienen fixture ni zonas inventadas; el reglamento del año siguiente queda pendiente. Los sorteos y desempates pendientes de 2026 se administran en el panel de resoluciones oficiales; la incorporación de calendarios oficiales de años posteriores no forma parte de este flujo. Las reglas deportivas automáticas de este módulo solo se aplican a 2026.

La persistencia mantiene JSON versión 7. Los campos opcionales de equipo `afaAffiliation` y `affiliationSourceUrl` se validan y conservan al copiar, respaldar y restaurar; su ausencia sigue siendo válida en archivos anteriores. Las pruebas cubren progresión, ventajas, descenso, reconciliación, importadores, reimportación, interfaz, temporadas y almacenamiento.


## Registro manual de sorteos y desempates oficiales

El panel **Sorteos y desempates oficiales** identifica los participantes y el motivo pendiente, permite registrar una publicación, revisar sus datos y conservar sus revisiones. Las verificaciones son manuales: **pendiente**, **provisional** o **verificado por el usuario**. Solo un registro verificado, con referencia documental y URL HTTPS del organismo correspondiente, puede resolver la clasificación. La aplicación valida la coherencia deportiva y de datos; no descarga ni certifica el contenido del documento. Los sitios de ESPN no se aceptan como actas oficiales AFA/CBF.

- **Série B:** el sorteo de la tabla final solo está disponible después de completar la liga y agotar los criterios del REC. Si faltan tarjetas verificadas se informa el problema y no se permite sustituirlo por un sorteo. Se registra el orden publicado completo, sin repeticiones ni clubes ajenos al empate. El orden se aplica a tablas, playoffs, ascensos, descensos y al bloqueo de transición.
- **Primera Nacional, Reducido:** se registran los sorteos de ordenamiento entre zonas cuando posición, puntos, DG y GF no separan a los clubes. Se incluyen el orden entre los quintos y los reordenamientos posteriores; la prioridad reglamentaria del perdedor de la primera final se conserva. Los empates de una tabla zonal siguen el art. 112 y no se sustituyen por estos sorteos.
- **Primera Nacional, descenso múltiple:** se elige el formato que publica AFA, su referencia y la cantidad de encuentros dispuesta; cada cruce se agrega expresamente. Para el todos contra todos neutral del art. 111 se comprueba una sola reunión por pareja y se calcula la tabla del desempate con 3/1/0, DG y GF. Si persiste una igualdad, hace falta una conclusión AFA independiente, que no puede invertir posiciones deportivas ya resueltas. Para otro formato expresamente dispuesto por AFA se exige su descripción y una conclusión publicada con el orden completo; no se infiere una llave ni se inventan reglas de desempate. Los encuentros pueden registrarse pendientes. Cada resultado requiere su propia fuente AFA; no se simulan estos partidos ni se incorporan puntos a la fase regular.

El formulario no propone ganadores ni genera cruces. Un programa verificado no equivale a un desempate resuelto: faltando partidos, resultados o la conclusión necesaria, se mantienen los bloqueos. La tabla de la zona conserva sus puntos regulares y refleja el orden del desempate de descenso cuando no invade los primeros ocho puestos. Si un empate amplio también afecta clasificaciones, estas siguen resolviéndose independientemente por el art. 112 y no por una decisión limitada al descenso; el cuadro registrado tiene una tabla aparte. Ascensos, descensos y transición consumen la misma resolución.

Cada registro usa la extensión opcional `officialResolutions`, con esquema interno 1. Incluye participantes y nombres históricos, alcance, fuente, verificación, fecha, orden o programación/resultados y un snapshot de sus dependencias deportivas. Ante cambios en resultados, estados, tarjetas, criterios o participantes relevantes, se revisa su aplicabilidad. Una resolución incompatible queda invalidada y no se reactiva automáticamente si se revierte el cambio; debe registrarse una revisión nueva. Los antecedentes, partidos, fuentes y motivos se conservan. La corrección de un registro crea una revisión sucesora y la revocación pide un motivo; los cruces dependientes se reconcilian con los servicios existentes.

La actividad registra altas y revocaciones; las operaciones deportivas que invalidan resoluciones incluyen sus registros afectados en el evento coordinado. Al abrir/restaurar datos con dependencias desactualizadas, la reconciliación registra también la invalidación. Se mantiene JSON versión 7 y la ausencia de la extensión en respaldos anteriores sigue siendo válida. Los registros y sus referencias se validan íntegramente antes de persistir/restaurar. Las copias conservan los antecedentes, remapean referencias cuando cambian IDs y dejan sus resoluciones inactivas para revisión. No se trasladan automáticamente a temporadas futuras.


## Calendarios y reglamentos de las temporadas planificadas

La confirmación de transición muestra las nóminas completas propuestas para ambas divisiones. Las temporadas nuevas conservan su procedencia y los participantes planificados en la extensión opcional `seasonPreparation` (esquema 1), compatible con respaldos JSON versión 7. Las reglas de desempate de 2026 tampoco se copian: la tabla futura empieza con criterios pendientes.

En Argentina y Brasil, las temporadas posteriores a 2026 tienen un panel **Calendario y reglamento**. Se consulta ESPN por competición y año y se exige una nómina publicada que acredite ese año. Se muestran todos los participantes, las ausencias y los clubes agregados antes de guardar. Las discrepancias requieren confirmación y justificación documental; la comparación y su fuente permanecen en el historial de revisiones y actividad. Si la consulta no publica calendario o nómina verificable por año, no se modifica la temporada. No se infieren zonas ni formatos; se conservan los grupos y las fases publicados y se numera localmente cada evento para consultarlo, sin presentar esa numeración como jornadas oficiales.

La actualización conserva identificadores de clubes coincidentes y resultados/detalles locales de partidos coincidentes. Si el proveedor omite partidos existentes, o existen resoluciones o inscripciones que requieren revisión, se rechaza la actualización para evitar pérdidas. Los marcadores futuros con prórroga o penales requieren revisión específica y no se interpretan usando reglas de 2026.

El reglamento anual permite registrar puntos, criterios ordenados, referencias documentales oficiales y estados pendiente, provisional o verificado por el usuario para tabla y clasificaciones. Esta verificación es manual; la aplicación no descarga ni certifica documentos. Los motores de ascensos, descensos y transición siguen limitados a los formatos deportivos verificados de 2026: documentar una temporada futura no implementa automáticamente sus playoffs ni habilita transiciones desconocidas. Las temporadas históricas y sus resoluciones no se modifican.


## Paquete JavaScript y carga diferida

Los paneles de partidos, calendario, estadísticas, segundas divisiones, preparación de temporadas e importación se cargan con `React.lazy` y `Suspense`. Los proveedores externos se descargan únicamente al solicitar la importación correspondiente. La biblioteca y los servicios compartidos siguen en la carga inicial.

La medición inicial bajó de 589,23 kB a 419,04 kB de JavaScript (28,9 %), incluyendo todas las dependencias estáticas de arranque. El total disponible, con todos los fragmentos diferidos, es 597,02 kB. El build no necesita elevar el límite de advertencia de Vite. Ejecuta `npm run analyze:bundle` para repetir la medición; consulta [el análisis de tamaños y las decisiones de carga](docs/bundle-performance.md).


## Auditoría de integridad

La [auditoría funcional e integridad deportiva](docs/integrity-audit.md) documenta los problemas reproducidos, sus correcciones y las pruebas asociadas. Las actualizaciones conservadoras protegen los datos locales completos y rechazan pérdidas implícitas; las clasificaciones y los promedios revisan también la cobertura y la verificación de sus dependencias. Los errores de paneles diferidos quedan aislados y se informan sin cerrar los demás paneles.


## Verificación con proveedores reales

La [verificación de importadores](docs/live-importers-verification.md) registra consultas reales para Argentina, Brasil, copas continentales y categorías chilenas. Se comprobaron 17 rutas de competición/zona: 16 importaciones pasaron en un repositorio aislado; Tercera A se rechazó por una localía repetida publicada por ANFA. No se accedió a la biblioteca del usuario.

`npm run verify:live` repite las consultas y genera el informe JSON técnico; es optativo, requiere red y devuelve código 1 si detecta un rechazo o cambios inesperados. Las pruebas habituales siguen siendo offline y usan muestras públicas minimizadas. ESPN se trata como proveedor externo, no como fuente oficial de una federación.

## Incidencias de fuentes externas

Las importaciones rechazadas por inconsistencias identificables conservan un expediente en **Incidencias de fuentes externas**. Permite documentar y confirmar correcciones de equipos o marcadores para encuentros concretos; solo las verificadas manualmente se aplican antes de repetir toda la validación deportiva. No se invierten localías ni resultados automáticamente. Si cambia el registro del proveedor, su corrección queda inactiva.

Los originales y las revisiones se guardan en el historial incluido en los respaldos de biblioteca JSON v7, incluso sin torneo guardado. Registrar una revisión no modifica temporadas existentes ni evita las confirmaciones de reimportación. [Funcionamiento, límites y verificación real](docs/source-incidents.md).

## Recorridos funcionales de interfaz

`npm run test:flows` ejecuta recorridos de App con Vitest, React Testing Library y almacenamiento jsdom aislado: creación, edición y simulación, importación conservadora, incidencias, respaldos, recarga, progresiones y transiciones. No requiere instalar un navegador ni accede a la biblioteca real. [Cobertura, correcciones y límites de la verificación](docs/functional-flows.md).

Los borradores de los formularios revisados se conservan en memoria al navegar durante la sesión; una recarga descarta lo no guardado. No se incorporan a la persistencia ni a los respaldos JSON v7.

## Compartir temporalmente por Internet

En Windows, instala una vez el cliente oficial de Cloudflare desde el [catálogo de Microsoft](https://github.com/microsoft/winget-pkgs/tree/master/manifests/c/Cloudflare/cloudflared):

```powershell
winget install --id Cloudflare.cloudflared --exact
```

Abre otra terminal, entra a `CONMEBOL` y ejecuta:

```powershell
npm run dev:public
```

Comparte la dirección HTTPS que aparezca junto a **URL PÚBLICA LISTA PARA COMPARTIR**. Déjalo abierto; **Ctrl+C** cierra Vite y el túnel. El enlace cambia con cada ejecución. `npm run dev` conserva su funcionamiento normal en localhost.

Es acceso de desarrollo para personas de confianza: cualquiera con el enlace puede entrar mientras esté activo y el código de la interfaz es accesible. No abre puertos del router ni comparte tu biblioteca: cada navegador y cada origen guardan sus propios torneos en localStorage. Para pasarlos a tu amigo, exporta y envía un respaldo JSON expresamente. [Instalación alternativa, firewall, privacidad y comprobaciones](docs/public-development.md).


## Pruebas en navegadores reales

```powershell
npx playwright install chromium firefox webkit
npm run test:e2e
```

Playwright ejecuta los recorridos en perfiles aislados con un servidor local dedicado, sin túnel público ni acceso a la biblioteca personal. `npm run test:e2e:session` prueba en Chromium la biblioteca con sesión contra la API real (compilada, con MongoDB en memoria y sin Docker). Incluye Chromium, Firefox y WebKit en resoluciones de escritorio, notebook, tablet y móvil. `npm run test:flows` conserva los recorridos de integración con jsdom. [Instalación, cobertura, correcciones visuales y límites](docs/browser-audit.md).

## Integración continua (CI)

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) se ejecuta en cada `push` y `pull_request` a `main`, con permisos de sólo lectura (`contents: read`). Una corrida nueva de la misma rama o PR cancela la anterior.

| Job | Qué hace |
| --- | --- |
| `checks` | `npm ci`, `npm run lint`, `npm run build` y `npm test`, que incluye los recorridos de `test:flows` y la API contra un MongoDB en memoria. El binario de `mongod` se cachea con la versión de `config.mongodbMemoryServer.version` de `apps/api/package.json` como clave. |
| `e2e` | Playwright sólo en `chromium-desktop` y `chromium-mobile`, con los navegadores cacheados por versión de Playwright. Si falla, sube `playwright-report/` y `test-results/` como artefacto `playwright-report` (14 días). |

Firefox, WebKit y las demás resoluciones (`npm run test:e2e`) y `test:e2e:session` se siguen ejecutando en local. Para validar el workflow sin instalar nada: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.7` (en Git Bash de Windows, con `MSYS_NO_PATHCONV=1` y `$(pwd -W)`).

## Centro de competiciones y temporadas

Desde **Biblioteca → Centro de competiciones y temporadas** puedes consultar los torneos activos y archivados por país/confederación, competición y año, con su cobertura, reglamento, procedencia y pendientes. Las relaciones y discrepancias utilizan los antecedentes registrados; los escenarios locales se distinguen de las importaciones. No se duplica almacenamiento ni cambia JSON v7. Consulta [el alcance y la verificación](docs/competition-center.md).

## Vinculación de clasificación internacional

El Centro de competiciones permite consultar cupos de Libertadores y Sudamericana, elegir expresamente la edición de destino y conservar la competición y temporada de origen. La preparación requiere documentación y confirmación: crea una planificación local sin fixture ni reglas futuras; si la copa existe, conserva su nómina y registra únicamente una revisión. Los cambios nacionales marcan las dependencias guardadas como desactualizadas. Se mantiene JSON v7 mediante la extensión opcional `continentalPlans`. Consulta [el alcance, las reglas reutilizadas y la validación](docs/continental-qualification.md).

## Historial deportivo de clubes

Desde **Centro de competiciones → Historial deportivo de clubes** puedes consultar la trayectoria cronológica por identidades registradas, fases, movimientos y cupos, y abrir los torneos originales. Los homónimos sin vínculo se mantienen separados. Los acumulados requieren una selección expresa de fuentes compatibles, sin duplicar temporadas ni mezclar escenarios. Es una proyección de consulta: no añade almacenamiento ni cambia JSON v7. Consulta [el alcance de las métricas y la validación](docs/club-history.md).

## Palmarés y récords

Consulta el [palmarés y los récords históricos](docs/club-honours.md), derivados de los torneos guardados con selección expresa y separación de procedencias.

## Enfrentamientos directos

Consulta el [historial H2H entre clubes](docs/head-to-head.md), con identidad expresa, filtros y fuentes seleccionadas.

## Rendimiento deportivo

Consulta el [panel de rendimiento y evolución de clubes](docs/club-performance.md), con gráficos accesibles y comparación de participaciones compatibles.

## Planificación de temporadas futuras

Desde **Biblioteca → Centro → Planificación de temporadas** puedes revisar nóminas locales, movimientos entre divisiones y cupos continentales, con sus dependencias, conflictos y procedencia. La creación requiere revisión y confirmación; reutiliza los flujos existentes y conserva los destinos ya guardados. No genera calendarios ni reglamentos futuros. Consulta [el funcionamiento, los límites y la validación](docs/season-planning-center.md).

## Preparación de copas nacionales

El Centro de planificación permite registrar la admisión documentada por edición y preparar nóminas locales de copas nacionales cuando todos los criterios y cupos están resueltos. Requiere verificación manual, revisión y confirmación; conserva los destinos existentes y no genera partidos. Consulta [el alcance y las pruebas](docs/national-cup-planning.md).

# Verificación de importadores con fuentes reales

Consultas realizadas el **16 de octubre de 2026 en America/Santiago**, entre 01:28 y 01:48 UTC del 17 de octubre. Última ejecución completa: `2026-10-17T01:48:14.130Z`. Los datos pueden cambiar, especialmente los encuentros en juego.

## Resultado

**17 rutas de competición/zona consultadas; 16 importaciones completas comprobadas en memoria y 1 rechazo de integridad justificado.** Las 103 solicitudes de la última ejecución devolvieron HTTP 200. Ninguna de las fuentes de competición quedó sin consultar por falta de acceso. HTTP 200 no se interpretó como calendario completo.

Tercera A fue consultada y parseada, pero no se considera una importación comprobada: su calendario repite una localía incompatible. No se corrigió esa localía ni se omitió el partido para conseguir una importación aparente.

## Método y protección de la biblioteca

Se ejecutaron los adaptadores originales mediante Vite SSR y DOMParser de jsdom. Las rutas relativas se resolvieron con los mismos destinos HTTPS de los proxies configurados en Vite. Se mantuvo la validación TLS con los certificados del sistema. Las solicitudes fueron GET, sin cuentas ni credenciales.

### Por dónde pasan las consultas (fase 6)

`npm run verify:live` acepta `--via` para las cuatro fuentes sin CORS (ESPN va siempre directo):

```bash
npm run verify:live                                   # --via=direct: a los sitios oficiales, como en la ejecución de octubre
npm run verify:live -w @cancha/web -- --via=proxy     # @cancha/official-source-proxy en el mismo proceso (misma política que la API, sin levantarla)
npm run verify:live -w @cancha/web -- --via=api       # a través de la API en CANCHA_API_URL o http://127.0.0.1:3000 (npm run dev:api)
npm run verify:live -w @cancha/web -- --via=api=https://api.example.cl --only=primera,copa-brasil --output=/tmp/live.json
```

El informe registra `via` en la raíz y en cada solicitud. Con `proxy` o `api` también registra `sourceCache` (`hit`/`miss`, de `X-Cancha-Source-Cache`). Un fallo del origen aparece como HTTP 502 o 504 del proxy, igual que lo vería la web.

Comprobación parcial del 19 de noviembre de 2026 con `--via=proxy`:
- Pasaron Copa Argentina (63 partidos), Copa do Brasil (155 partidos, con `RSC: 1` a través del proxy) y ANFP Primera (240 partidos). La respuesta mayor midió 1,40 MB, por debajo del máximo de 5 MiB.
- ANFA Tercera A falló: `calendario_ta.php` respondió **404 también con `--via=direct`**. Es un cambio del sitio, no del proxy, y queda pendiente revisar el importador de ANFA.
- Ese informe no reemplazó `live-importers-results.json`.

Comprobación completa del 20 de noviembre de 2026 con `--via=direct` y `--via=proxy`: [live-importers-2026-11-20-direct.json](live-importers-2026-11-20-direct.json) y [live-importers-2026-11-20-proxy.json](live-importers-2026-11-20-proxy.json). Tampoco reemplazan `live-importers-results.json`.
- Los dos modos dan el mismo resultado: **11 importaciones comprobadas y 6 fallos** de 17 rutas. Hubo 25 solicitudes: 23 con HTTP 200 y 2 hacia ANFA, que respondieron 404 directo o 502 a través del proxy.
- **ANFA Tercera A, Tercera B Norte y Tercera B Sur: el sitio está en mantenimiento.** `anfaterceradivision.cl/` responde 200 con una página "Sitio en mantenimiento" (sólo dirección y correos, sin enlaces) y todos los `assets/php/*.php` (`calendario.php`, `calendario_ta.php?j=…`, `perfil_campeonato_*.php`) responden 404 con cualquier User-Agent. No hay URLs nuevas ni otro formato publicado. El importador conserva el formato anterior y sus validaciones: si el sitio vuelve igual, importa sin cambios. Mientras tanto, ante un 404 explica que ANFA no publica el calendario, y la interfaz muestra «Fuente en mantenimiento» en las dos tarjetas de Tercera, con el botón «Intentar importar» activo.
- Rechazos de validación, sin relación con el acceso. No se debilitó ninguna validación:
  - Primera Nacional (ESPN): `La fase torneo-reducido---first-round de ESPN requiere verificar su correspondencia reglamentaria.`
  - Série B (ESPN): `ESPN publicó más de dos partidos entre Criciúma y Fortaleza.`
  - Primera B (ANFP): `La fuente oficial publicó partidos sin una fecha identificable.`
  Quedan pendientes de revisión aparte.

Cada respuesta aceptada pasó por `importOfficialTournament`, las validaciones deportivas y la progresión existentes, con un repositorio aislado que no guarda datos. No se abrió `LocalStorageTournamentRepository`, no se accedió a localStorage y no se modificaron torneos, resultados ni actividad del usuario. Solo se escribieron código, documentación y muestras de pruebas. También se compararon los participantes y marcadores publicados con el resultado de la importación: en las 16 importaciones aceptadas no quedaron encuentros publicados cambiados u omitidos después de las correcciones.

Las capturas técnicas están en [live-importers-results.json](live-importers-results.json), con URL de cada solicitud, hora, HTTP, tamaño y resumen de estructura. [live-importers-before.json](live-importers-before.json) conserva la primera ejecución anterior a las correcciones. No se guardaron respuestas completas con jugadores, fotos u otros campos innecesarios.

## Revisión ANFP del 22 de noviembre de 2026

La verificación actual se ejecutó por acceso directo y por el proxy compartido con `--only=primera-b,primera,segunda,copa-chile,copa-liga`. Los informes técnicos completos están en `docs/validation/live-anfp-direct-after.json` y `docs/validation/live-anfp-proxy-after.json` (artefactos locales ignorados por Git).

La Primera B importó **246 partidos**: 240 de `Fixture` y seis de `Liguilla Ascenso`, organizados en tres llaves de ida y vuelta. La página pone el encabezado `Liguilla Ascenso` y luego tres contenedores sin título `Fecha N`; las seis tarjetas sí tienen fecha/hora ISO válida. El fallo original confundía el nombre de la jornada con la fecha de calendario y aplicaba el parser de la fase regular.

| Ida | Vuelta | Fecha publicada |
| --- | --- | --- |
| `63078` Deportes Recoleta ? Santiago Wanderers | `63083` Santiago Wanderers ? Deportes Recoleta | 20 y 26 de noviembre |
| `63079` Deportes Copiapó ? Deportes Antofagasta | `63082` Deportes Antofagasta ? Deportes Copiapó | 21 y 27 de noviembre |
| `63080` San Marcos de Arica ? Magallanes | `63081` Magallanes ? San Marcos de Arica | 22 y 28 de noviembre |

El adaptador ahora toma los contenedores como llaves de la etapa explícita, exige dos partidos con equipos recíprocos y fechas/horas válidas, y ordena cada ida/vuelta por el inicio publicado. La importación comprueba los 246 partidos sin cambiar los seis IDs oficiales. `advanceChileanAscensoPlayoff` conserva la Liguilla publicada y no la sustituye por el bracket local provisional.

En ambos modos, las otras fuentes chilenas también importaron sin cambios: Liga de Primera (240), Segunda División (42 en cada zona), Copa Chile (120) y Copa de la Liga (53). No se observó HTTP 403/429/5xx en estas pasadas; el nuevo reintento de una vez ante esos estados del origen está implementado y probado en `@cancha/official-source-proxy`.

El `npm run verify:live` completo todavia devuelve codigo 1 por validaciones independientes en Primera Nacional y Serie B, y por los 404 de mantenimiento de ANFA Tercera A/B Norte/Sur. El subconjunto ANFP descrito arriba pasa en directo y por proxy.

La muestra mínima reproducible está en [`apps/web/src/test-utils/fixtures/live/primera-b-liguilla-2026.json`](../apps/web/src/test-utils/fixtures/live/primera-b-liguilla-2026.json); no se guarda el HTML completo de 1,4 MB.

## Resultado por competición

Todos los resultados de esta tabla proceden de **consultas reales**, no de los mocks de las pruebas. Los partidos son los normalizados por el adaptador; los descartes respecto de los registros brutos se detallan después.

| Competición | Fuente consultada | Año | Equipos | Partidos | Fases/grupos identificados | Resultado | Observaciones |
| --- | --- | ---: | ---: | ---: | --- | --- | --- |
| Argentina · Primera División | [ESPN (API pública)](https://www.espn.com/soccer/fixtures/_/league/arg.1) | 2026 | 30 | 495 | Torneo Apertura · Fase regular; Torneo Apertura · Octavos de final; Torneo Apertura · Cuartos de final; Torneo Apertura · Semifinales; Torneo Apertura · Final; Torneo Clausura · Fase regular | Importación real comprobada | Conserva los 495 encuentros, participantes y resultados publicados. Clausura sin eliminatorias publicadas. |
| Argentina · Primera Nacional | [ESPN (proveedor externo, API pública)](https://www.espn.com/soccer/fixtures/_/league/arg.2) | 2026 | 36 | 647 | Fase regular | Importación real comprobada | Se excluye un evento marcado ABANDONED; no se inventa su resultado ni se confirma la fase regular. |
| Brasil · Série A | [ESPN (API pública)](https://www.espn.com/soccer/fixtures/_/league/bra.1) | 2026 | 20 | 380 | Brasileirão Série A | Importación real comprobada | Tres entradas aplazadas redundantes se excluyen frente a sus partidos activos; permanece un aplazado. |
| Brasil · Série B | [ESPN (proveedor externo, API pública)](https://www.espn.com/soccer/fixtures/_/league/bra.2) | 2026 | 20 | 380 | Fase regular | Importación real comprobada | Cuatro partidos con TBD se excluyen; no se crean clubes ficticios. |
| Copa Libertadores | [ESPN (API pública)](https://www.espn.com/soccer/fixtures/_/league/conmebol.libertadores) | 2026 | 47 | 154 | Copa Libertadores · Fase de grupos; Copa Libertadores · Fase previa 1 · Ida; Copa Libertadores · Fase previa 1 · Vuelta; Copa Libertadores · Fase previa 2 · Ida; Copa Libertadores · Fase previa 2 · Vuelta; Copa Libertadores · Fase previa 3 · Ida; Copa Libertadores · Fase previa 3 · Vuelta; Copa Libertadores · Octavos de final · Ida; Copa Libertadores · Octavos de final · Vuelta; Copa Libertadores · Cuartos de final · Ida; Copa Libertadores · Cuartos de final · Vuelta; Copa Libertadores · Semifinales · Ida; Copa Libertadores · Semifinales · Vuelta | Importación real comprobada | Se excluye una final TBD; se conservan grupos, fases previas, eliminatorias y fechas. |
| Copa Sudamericana | [ESPN (API pública)](https://www.espn.com/soccer/fixtures/_/league/conmebol.sudamericana) | 2026 | 56 | 156 | Copa Sudamericana · Fase de grupos; Copa Sudamericana · Primera fase; Copa Sudamericana · Playoff de octavos · Ida; Copa Sudamericana · Playoff de octavos · Vuelta; Copa Sudamericana · Octavos de final · Ida; Copa Sudamericana · Octavos de final · Vuelta; Copa Sudamericana · Cuartos de final · Ida; Copa Sudamericana · Cuartos de final · Vuelta; Copa Sudamericana · Semifinales · Ida; Copa Sudamericana · Semifinales · Vuelta | Importación real comprobada | Se excluye una final TBD; se conservan grupos, primera fase, playoff y eliminatorias. |
| Copa Argentina | [Copa Argentina (sitio oficial)](https://www.copaargentina.org/es/fixture.html) | 2026 | 64 | 62 | Copa Argentina · 32avos de Final; Copa Argentina · 16avos de Final; Copa Argentina · Octavos de Final; Copa Argentina · Cuartos de Final; Copa Argentina · Semifinales | Importación real comprobada | 60 con marcador y 2 pendientes; sin fechas normalizadas ni estado operativo explícito en la salida actual. |
| Copa do Brasil | [CBF (sitio oficial)](https://www.cbf.com.br/futebol-brasileiro/tabelas/copa-do-brasil/masculino/2026) | 2026 | 126 | 154 | Copa do Brasil · 1ª Fase; Copa do Brasil · 2ª Fase; Copa do Brasil · 3ª Fase; Copa do Brasil · 4ª fase; Copa do Brasil · 5ª Fase; Copa do Brasil · Oitavas de Final; Copa do Brasil · Quartas de Final; Copa do Brasil · Semi Finais | Importación real comprobada | 126 clubes por identidad; 150 marcadores y 4 pendientes. No se añade una final no publicada. |
| Chile · Primera División | [Campeonato Chileno](https://www.campeonatochileno.cl/ligas/liga-de-primera-mercado-libre/) | 2026 | 16 | 240 | Sin fase | Importación real comprobada | 191 marcadores, 1 cancelado y 48 sin estado explícito; sin horarios normalizados. |
| Chile · Primera B | [Campeonato Chileno](https://www.campeonatochileno.cl/competition/campeonato-de-ascenso-caixun-2026/) | 2026 | 16 | 240 | Sin fase | Importación real comprobada | 216 marcadores y 24 pendientes; sin horarios normalizados. |
| Chile · Segunda, ascenso | [Campeonato Chileno](https://www.campeonatochileno.cl/competition/liga-de-segunda-division-panini/) | 2026 | 7 | 42 | Zona de Ascenso | Importación real comprobada | 24 marcadores y 18 pendientes en cada zona; las zonas se consultan por separado. |
| Chile · Segunda, descenso | [Campeonato Chileno](https://www.campeonatochileno.cl/competition/liga-de-segunda-division-panini/) | 2026 | 7 | 42 | Zona de Descenso | Importación real comprobada | 24 marcadores y 18 pendientes en cada zona; las zonas se consultan por separado. |
| Copa Chile | [Campeonato Chileno](https://www.campeonatochileno.cl/competition/copa-chile-coca-cola-zero-azucar/) | 2026 | 32 | 120 | Copa Chile · Grupo A; Copa Chile · Grupo B; Copa Chile · Grupo C; Copa Chile · Grupo D; Copa Chile · Grupo E; Copa Chile · Grupo F; Copa Chile · Grupo G; Copa Chile · Grupo H; Copa Chile · Octavos de final · Ida; Copa Chile · Octavos de final · Vuelta; Copa Chile · Cuartos de Final · Ida; Copa Chile · Cuartos de Final · Vuelta | Importación real comprobada | 116 marcadores; 1 aplazado y 3 sin estado explícito; fases posteriores no completadas. |
| Copa de la Liga (adicional) | [Campeonato Chileno](https://www.campeonatochileno.cl/competition/copa-de-la-liga/) | 2026 | 16 | 53 | Copa de la Liga · Grupo A; Copa de la Liga · Grupo B; Copa de la Liga · Grupo C; Copa de la Liga · Grupo D; Copa de la Liga · Semifinales · Ida; Copa de la Liga · Semifinales · Vuelta; Copa de la Liga · Final | Importación real comprobada | 52 marcadores y final aplazada; verificación adicional al alcance pedido. |
| Chile · Tercera A | [ANFA Tercera División](https://anfaterceradivision.cl/assets/php/calendario_ta.php) | 2026 | 14 | 182 | Sin fase | Rechazo de integridad | Adaptador: 182 encuentros; importación rechazada por localía repetida en jornadas 10 y 23. |
| Chile · Tercera B Norte | [ANFA Tercera División](https://anfaterceradivision.cl/assets/php/perfil_campeonato_tbn.php) | 2026 | 14 | 182 | Sin fase | Importación real comprobada | 182 marcadores; validación estructural correcta, sin certificar cupos ni reglamentos. |
| Chile · Tercera B Sur | [ANFA Tercera División](https://anfaterceradivision.cl/assets/php/perfil_campeonato_tbs.php) | 2026 | 14 | 182 | Sin fase | Importación real comprobada | 182 marcadores; validación estructural correcta, sin certificar cupos ni reglamentos. |

## Registros brutos ESPN y tratamiento de entradas incompletas

ESPN es un **proveedor externo**, no una fuente oficial AFA/CBF/CONMEBOL. Sus estados y fases se verificaron como datos del proveedor. Los IDs de evento no estaban duplicados; los aplazamientos pueden usar otro ID para el encuentro reprogramado.

| Endpoint consultado | Registros recibidos | Encuentros normalizados | Diferencia observada |
| --- | ---: | ---: | --- |
| [arg.1](https://site.api.espn.com/apis/site/v2/sports/soccer/arg.1/scoreboard?dates=2026&limit=1000) | 495 | 495 | Conserva los 495 encuentros, participantes y resultados publicados. Clausura sin eliminatorias publicadas. |
| [arg.2](https://site.api.espn.com/apis/site/v2/sports/soccer/arg.2/scoreboard?dates=2026&limit=1000) | 648 | 647 | Se excluye un evento marcado ABANDONED; no se inventa su resultado ni se confirma la fase regular. |
| [bra.1](https://site.api.espn.com/apis/site/v2/sports/soccer/bra.1/scoreboard?dates=2026&limit=1000) | 383 | 380 | Tres entradas aplazadas redundantes se excluyen frente a sus partidos activos; permanece un aplazado. |
| [bra.2](https://site.api.espn.com/apis/site/v2/sports/soccer/bra.2/scoreboard?dates=2026&limit=1000) | 384 | 380 | Cuatro partidos con TBD se excluyen; no se crean clubes ficticios. |
| [conmebol.libertadores](https://site.api.espn.com/apis/site/v2/sports/soccer/conmebol.libertadores/scoreboard?dates=2026&limit=1000) | 155 | 154 | Se excluye una final TBD; se conservan grupos, fases previas, eliminatorias y fechas. |
| [conmebol.sudamericana](https://site.api.espn.com/apis/site/v2/sports/soccer/conmebol.sudamericana/scoreboard?dates=2026&limit=1000) | 157 | 156 | Se excluye una final TBD; se conservan grupos, primera fase, playoff y eliminatorias. |

El resultado `ABANDONED` se mantiene como limitación del adaptador actual: el evento no se incorpora como partido final ni se lo transforma arbitrariamente en cancelado/suspendido. Primera Nacional conserva 647 partidos normalizados frente a 648 eventos recibidos, con la cobertura no acreditada como completa. La validación de fase regular no puede confirmar el torneo a partir de ese calendario.

Las finales continentales y los cuatro cruces TBD de Série B no se importan como enfrentamientos entre clubes inventados. La ausencia de esos registros y la existencia de partidos pendientes impiden interpretar los recuentos como una temporada resuelta. Las jornadas reconstruidas localmente desde ESPN tampoco se presentan como numeración oficial.

## Errores reproducidos y correcciones

1. **Argentina: pérdida y reasignación de cruces reales.** Antes, 495 partidos recibidos terminaban en 489 y algunos IDs quedaban asociados a otros clubes. La reconciliación usaba el índice cronológico como posición del cuadro. Ahora reserva los enfrentamientos existentes por participantes; las rondas posteriores ya publicadas se conservan cuando contienen exactamente los ganadores válidos, sin repeticiones. Los cruces locales siguen su algoritmo existente y un participante eliminado sigue provocando limpieza de su resultado anterior. La repetición real final conserva los 495 encuentros sin cambios de participantes o marcador.
2. **Libertadores: entradas directas en Fase 2.** El importador exigía que todos provinieran de Fase 1. Se corrigió el metadato de avance automático de Fase 1 para conservar el cuadro publicado con sus entradas directas. Esto corresponde al formato existente, no a una nueva regla: véase el [Manual de clubes CONMEBOL 2026, sección 2.2.1.3](https://cdn.conmebol.com/wp-content/uploads/2025/12/Manual-de-Clubes-CONMEBOL-Libertadores-2026-ESP.pdf). La búsqueda del documento oficial permitió contrastar esa sección; su descarga directa mediante la herramienta web devolvió 403.
3. **CBF: tres clubes homónimos.** Los clubes publicados con nombre `Operário` e IDs `20041`, `20106` y `35079` se fusionaban. Se usa el identificador CBF para desambiguar su etiqueta local cuando el nombre coincide. La etiqueta `Operário (CBF …)` no pretende ser un nuevo nombre oficial. El recuento pasa de 123 nombres fusionados a 126 identidades distintas.
4. **CBF: penales por global.** Ceará–Atlético Mineiro publicó una vuelta 2–1, global empatado y tanda 2–4. El adaptador descartaba la tanda porque la vuelta no era empate. Ahora conserva la tanda publicada y deja que la validación por global compruebe su coherencia; no la convierte en una definición a partido único.
5. **CBF: avance con nuevas incorporaciones y final no publicada.** Se señalan las interrupciones del avance automático de 2026 cuando se incorporan clubes en fases 2, 3 y 5. No se genera el cuadro con solo los ganadores de la fase anterior. Se retiró la final de dos partidos que se añadía como supuesto: solo se declaran fases y cantidad de partidos publicadas. Referencias oficiales: [sorteo y composición de fases iniciales](https://www.cbf.com.br/futebol-brasileiro/noticias/undefined/iape-x-uniao/sorteio-da-copa-do-brasil-sera-nesta-quarta-feira-confira-os-criterios), [tercera fase](https://www.cbf.com.br/futebol-brasileiro/noticias/undefined/vitoria-x-crb/cbf-detalha-terceira-fase-da-copa-betano-do-brasil-2026), [quinta fase](https://www.cbf.com.br/futebol-brasileiro/noticias/undefined/guarany-de-sobral-x-csa/sorteio-da-copa-do-brasil-define-confrontos-da-5-fase). No se trasladan esos metadatos automáticamente a otros años.
6. **ANFA: marcador pendiente `VS`.** El token real provocaba un error de marcador. Se interpreta como ausencia de resultado, conservando clubes y sin inventar goles. Esto permitió revisar las 26 jornadas de Tercera A, donde luego se detectó la inconsistencia de localía independiente.
7. **Copas continentales: fechas descartadas.** ESPN publicaba fecha y zona horaria, pero el adaptador las utilizaba solo para ordenar. Ahora reutiliza el analizador ya existente de las ligas ESPN para conservar fecha, hora y offset publicado. Se comprobaron 154 horarios en Libertadores y 156 en Sudamericana.

Estas correcciones no modifican criterios de desempate, puntos, ascensos, descensos ni el esquema JSON v7. La corrección de metadatos evita que una suposición local invalide o sustituya partidos publicados.

## Inconsistencia de Tercera A que se mantiene bloqueada

La fuente presenta **Comunal Cabrero como local contra Aguará** tanto en [jornada 10](https://anfaterceradivision.cl/assets/php/calendario_ta.php?j=10) (1–0) como en [jornada 23](https://anfaterceradivision.cl/assets/php/calendario_ta.php?j=23) (2–3). La pareja no respeta las localías de las dos ruedas esperadas por este importador. La validación existente lo rechaza antes de guardar.

El token `VS` era un problema corregible del adaptador; esta repetición es un dato publicado cuya localía correcta no se puede deducir. No se invirtieron equipos, no se cambiaron goles ni se descartó una jornada. Se necesita una corrección o aclaración del proveedor para completar esa importación.

## Temporada, estados y limitaciones

- ESPN publica `season.year = 2026` en las respuestas consultadas. Primera Nacional consulta además sus zonas en el endpoint de standings con `season=2026`. Copa Argentina identifica la edición mediante su feed; CBF usa la ruta anual y las fases publicadas. ANFP/ANFA declaran 2026 en sus adaptadores: las páginas HTML no ofrecen el mismo contrato explícito de temporada que ESPN y no se certifican como un API de año parametrizable.
- Se observaron partidos en juego en Argentina, aplazados en Série A y Copa Chile, una final aplazada en Copa de la Liga y registros de participantes TBD. Los partidos marcados explícitamente como no finales no se incorporan como resultados deportivos resueltos.
- Los adaptadores de copas nacionales, ANFP y ANFA todavía no normalizan todos los campos de fecha/hora de sus páginas. Los valores `not-published` del informe significan que el adaptador no emitió un estado operativo explícito; no significan que el sitio carezca de cualquier texto de estado. Cuando hay marcador válido y no estado explícito se mantiene la interpretación heredada; sin marcador el partido permanece pendiente. No se inventaron zonas horarias.
- Todos los casos conservan cobertura `unknown` en esta verificación: una estructura válida y HTTP 200 no certifican el total de temporada, el cierre de sus fases ni sus reglamentos.
- La ejecución usa Node con los destinos de los proxies y DOMParser de jsdom. No sustituye una prueba en todos los navegadores, orígenes o redes; el acceso futuro y los formatos de los proveedores pueden cambiar.

## Muestras reales y pruebas sintéticas

Las muestras minimizadas están en [src/test-utils/fixtures/live](../src/test-utils/fixtures/live/README.md). Se conservan identificadores de partidos y clubes, nombres de clubes, resultados, fases y fechas necesarias, sin plantillas de jugadores ni fotografías. Los snapshots normalizados de Argentina y Libertadores se recortaron a las fases necesarias para reproducir el fallo.

`live-provider-samples.test.ts` reproduce los errores con esas muestras. Los envoltorios mínimos de HTML/RSC y el caso de metadatos de Libertadores son arneses sintéticos declarados en el test; los clubes, marcadores y problemas proceden de las consultas reales. Los casos negativos de temporada, ID duplicado y plantilla de participantes incompleta son alteraciones sintéticas de un snapshot real y verifican que no se guarde nada.

Las pruebas sintéticas existentes siguen cubriendo errores HTTP/JSON, años incompatibles, estados desconocidos, referencias inválidas y actualizaciones conservadoras. No se etiquetan como nuevas consultas reales.

## Reproducción

- `npm run verify:live`: consultas de red optativas y repositorio aislado. Escribe el JSON técnico en `docs/live-importers-results.json`. Devuelve código 1 si una importación se rechaza o cambia un encuentro publicado; **en esta ejecución el código 1 corresponde al rechazo justificado de Tercera A**. No forma parte de `npm test`.
- `node --use-system-ca scripts/verify-live-importers.mjs --only=libertadores,copa-brasil`: comprobación parcial; el JSON resultante contiene solo las rutas solicitadas.
- `npm test`: pruebas offline, incluidas las muestras reales guardadas y las mutaciones sintéticas.
- `npm run build`: TypeScript y paquete de producción.

No se añadieron dependencias ni migraciones. Los resultados finales de pruebas y compilación se registran al completar la validación.

## Validación final

- `npm test`: **528 pruebas aprobadas en 58 archivos**.
- Tras sustituir la lectura de muestras con `node:fs` por importaciones JSON soportadas por la configuración existente, las **10 pruebas de muestras reales** se ejecutaron de nuevo y pasaron.
- `npm run build`: TypeScript y Vite completados, sin aviso de fragmentos mayores de 500 kB. Las muestras de pruebas no se incluyen en el paquete de la aplicación.
- `npm run verify:live`: **16 importaciones comprobadas y 1 rechazo justificado**, con código de salida 1 por Tercera A, no por una escritura o fallo de acceso a la biblioteca.

La desambiguación de nombres CBF puede cambiar el identificador local derivado del nombre respecto de una importación anterior. El modo conservador sigue rechazando cambios de participantes en partidos con datos locales; no se añadió una migración silenciosa ni se reemplazaron torneos guardados.

## Seguimiento de incidencias externas

Se añadió un registro de incidencias y correcciones documentadas; véase [gestión de incidencias](source-incidents.md). La nueva consulta aislada de Tercera A a las `2026-10-17T02:03:04.816Z` conserva el rechazo por localía repetida y registra automáticamente ambos encuentros como incidencia pendiente. No se aplicó ninguna corrección ni se modificó la biblioteca. El informe separado [source-incidents-live-results.json](source-incidents-live-results.json) conserva los datos y las consultas de esta comprobación; el informe completo de 17 rutas permanece intacto.

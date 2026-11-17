# Muestras mínimas de proveedores reales

Capturadas el 16 de octubre de 2026 (America/Santiago), 17 de octubre UTC. El informe completo, las URLs y las horas por consulta están en [docs/live-importers-verification.md](../../../../docs/live-importers-verification.md).

- `argentina-apertura-2026.json`: salida real normalizada del adaptador ESPN, capturada alrededor de 01:31 UTC. Se conservaron solo Apertura (255 encuentros) y los campos necesarios; se quitaron Clausura y los horarios para aislar la reconciliación del cuadro. No es un nuevo fixture inventado ni una respuesta JSON cruda de ESPN.
- `libertadores-preliminary-2026.json`: salida real normalizada, capturada alrededor de 01:31 UTC; solo Fases 1 y 2, para reproducir las incorporaciones directas. El test toma los metadatos del adaptador actual mediante un arnés mínimo sintético.
- `anfa-pending.json`: clubes, token `VS`, jornada y URL reales. El test usa un HTML mínimo de una jornada para reproducir ese token; no afirma que el HTML de prueba sea una página completa descargada.
- `anfa-repeated-home.json`: dos filas reales de las jornadas 10 y 23, con URL y hora de captura. Se usa para comprobar el rechazo de localías incompatibles.
- `cbf-homonyms.json`: subconjunto de las fases CBF 1996 y 1997; solo IDs, nombres, goles y penales necesarios para distinguir clubes homónimos. No contiene jugadores ni fotos.
- `cbf-aggregate-penalties.json`: ida y vuelta reales de Atlético Mineiro/Ceará en la fase 1999, con tanda publicada tras empate global.
- `espn-continental-schedule.json`: dos eventos reales de Sudamericana, reducidos a fecha, fase, estado, clubes y marcador cuando existe.

Los JSON con `capturedAt` y `sourceUrl` conservan su procedencia. Las respuestas completas pueden incluir información de jugadores y fotografías que no se guarda aquí. El capturador auxiliar `scripts/capture-live-import-samples.mjs` exige que los casos sigan presentes y falla si no los encuentra; no fabrica un reemplazo. Los snapshots usados por `npm test` no requieren red.

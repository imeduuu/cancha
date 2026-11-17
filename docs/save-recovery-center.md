# Centro de guardado y recuperación

## Arquitectura

El Centro se integra en la Biblioteca y se puede abrir desde el dashboard del
universo activo. Reutiliza el exportador/restaurador existentes y conserva JSON v7.
Los [puntos de control manuales](save-checkpoints.md) amplían este mismo Centro
con almacenamiento local en IndexedDB. La biblioteca activa permanece en
LocalStorage y `cancha.recovery` mantiene su función; no hay servicios remotos.

- El respaldo completo se genera con `createTournamentBackup` y se valida con
  `parseTournamentBackupWithActivity`, manteniendo el sobre JSON v7
  `cancha-backup`.
- La exportación incluye todos los torneos de la biblioteca, el historial y la
  extensión opcional `extensions.sportsUniverses`. La vista previa muestra
  cantidades, formato, alcance y fecha de generación. Descargar no escribe en
  LocalStorage ni cambia resultados.
- Los respaldos por universo no están disponibles. Separar temporadas podría
  omitir referencias, identidades, reglas e historial necesarios para restaurar
  una partida completa; la opción segura es exportar la biblioteca completa.
- La restauración valida el archivo antes de mostrar la confirmación. La vista
  previa informa torneos entrantes y locales, IDs coincidentes, coincidencias
  de competición/temporada, metadatos de universos, actividad y si la extensión
  de universos está presente.
- Combinar conserva torneos locales con IDs coincidentes sin reemplazar sus
  resultados. Las coincidencias de competición/temporada con IDs diferentes se
  señalan, pero se mantiene el comportamiento existente de combinación por ID:
  no se actualizan ni fusionan automáticamente esos registros.
- Una colisión de metadatos de universos bloquea la combinación. Las relaciones
  explícitas se validan de nuevo en el repositorio antes de escribir; si no son
  compatibles, la operación falla en lugar de remapear IDs o referencias.
- El mecanismo local puede conservar una única versión previa en
  `cancha.recovery` al reemplazar, si los datos previos son válidos. Si se
  intenta escribir esa copia o cualquier parte del reemplazo y la escritura
  falla, la operación se aborta/revierte cuando es posible. Si el estado previo
  no se puede validar, se indica que no se garantiza una copia restaurable y se
  ofrece exportar los datos originales. El Centro no crea copias adicionales
  en LocalStorage.

## Compatibilidad y restricciones

- Los respaldos antiguos siguen validándose mediante el lector existente. Si un
  respaldo no contiene metadatos de universos, sus torneos quedan sin asignar
  cuando se reemplaza la biblioteca. Al combinar, se conservan los universos
  locales y los torneos incorporados no reciben asignaciones inventadas.
- Si no hay fecha de exportación en un archivo antiguo, la vista previa la
  muestra como no disponible; no deduce fechas.
- El historial importado mantiene referencias originales. Las referencias a
  torneos ausentes no se reconstruyen por nombres ni por IDs locales ambiguos.
- El archivo de datos originales ofrecido durante una recuperación de daños
  sigue identificado como contenido no validado, no como respaldo restaurable.
- La recuperación local disponible corresponde al último reemplazo compatible
  y deja de ofrecerse si el estado actual ya no coincide con el estado que
  reemplazó.

## Validación

La suite cubre metadatos de JSON v7 y archivos antiguos, apertura desde el
dashboard, exportación completa sin escrituras, conflictos de IDs y universos,
conservación de resultados al combinar, restauración antigua sin asignaciones
inventadas, recuperación local y fallos de escritura existentes.

### Hallazgos y correcciones

- El flujo E2E de confirmaciones en una ventana baja todavía buscaba la
  exportación directamente en la Biblioteca. Al moverla al Centro de guardado,
  el flujo quedó desactualizado y expiraba esperando el botón. Se corrigió para
  abrir el Centro y buscar allí las acciones; el caso aislado y la suite completa
  pasan.
- En dos ejecuciones completas de `npm test`, el test de calendario diferido de
  `app.test.tsx` no encontró la región dentro del tiempo de consulta. La primera
  ejecución también expiró en `app-lazy.test.tsx`; ambos tests pasan ejecutados
  por separado y los cinco archivos de flujos pasan juntos. No se modificaron
  esperas ni se ocultó el fallo. La causa del comportamiento bajo la ejecución
  completa no quedó demostrada, por lo que la suite unitaria completa no se
  considera aprobada.

### Resultados exactos

- `npm test` — **falló** en la primera ejecución: 83 archivos pasaron y 2
  fallaron; 860/862 pruebas pasaron (`app.test.tsx` y `app-lazy.test.tsx`).
- `npm test` — **falló** en la segunda ejecución: 84 archivos pasaron y 1
  falló; 861/862 pruebas pasaron (`app.test.tsx`, calendario diferido).
- `npm test -- src/presentation/app.test.tsx -t "opens the selected season calendar"`
  — **pasó**, 1 prueba.
- `npm test -- src/presentation/app-lazy.test.tsx` — **pasó**, 1 prueba.
- `npm test -- src/presentation/app.test.tsx` — **pasó**, 35 pruebas.
- `npm run test:flows` — **pasó**, 5 archivos y 70 pruebas.
- `npm exec -- playwright test --project=chromium-desktop --grep "confirmaciones con nombres largos"`
  — **pasó**, 1 prueba tras corregir su navegación.
- `npm run test:e2e` — **pasó**, 300 pruebas en 12 combinaciones de navegador y
  viewport; incluye WebKit, sin reintentos configurados.
- `npm run build` — **pasó**, TypeScript y compilación de producción Vite.

### Riesgos y limitaciones pendientes

- La ejecución completa de Vitest mantiene un fallo intermitente alrededor de
  la carga diferida del calendario. Las ejecuciones focalizadas no lo
  reproducen; no se atribuye a un defecto funcional ni se declara resuelto sin
  una causa verificable.
- La exportación individual por universo sigue deshabilitada porque no se
  garantiza el cierre de todas sus referencias, identidades e historial.

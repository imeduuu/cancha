# Incidencias de fuentes externas

## Alcance y arquitectura

La auditoría encontró que `validateOfficialSeason` ya rechazaba la repetición de localías mediante `validateFixturePairings`; el formulario solo mostraba el error y no quedaba un expediente consultable si la temporada no llegaba a guardarse. No se modificaron esas reglas, los adaptadores ni los formatos deportivos.

- `domain/entities/source-incident.ts`: esquema interno 1, snapshots publicados, correcciones acotadas y validación de los payloads.
- `application/services/source-incidents.ts`: detección de rechazos, registro de revisiones, confirmación, revocación y comparación con publicaciones posteriores.
- `import-official-tournament.ts`: aplica correcciones antes de la validación y ejecuta íntegramente las comprobaciones deportivas existentes. También registra rechazos de integridad posteriores a la normalización.
- `import-planned-season-calendar.ts`: su repositorio temporal consulta y registra incidencias en la biblioteca real cuando se le proporciona el repositorio; nunca guarda un torneo durante la previsualización.
- Infraestructura: reutiliza las escrituras del historial, su tratamiento de errores y su exportación/restauración.
- Presentación: panel de incidencias en la importación y en la preparación de temporadas futuras. El estado de edición se conserva durante los rerenders.

## Uso

1. Intentar importar normalmente. Un calendario rechazado con un sobre identificable registra una incidencia automática, aunque no exista un torneo guardado.
2. Abrir **Incidencias de fuentes externas**. Consultar competición, año, proveedor, URL, motivo, encuentros originales, jornada/fase, estado y correcciones previas.
3. Seleccionar expresamente el encuentro y escribir los equipos y, si corresponde, los goles corregidos. El formulario empieza con los datos originales: no propone ganadores ni invierte marcadores. No modifica IDs, fechas, fases, prórrogas ni penales.
4. Añadir URL documental HTTPS, referencia y motivo. Confirmar expresamente la revisión. Sin la casilla de contraste documental queda provisional y no se aplica. Cancha valida la coherencia de datos y conserva la afirmación de verificación del usuario; no descarga ni certifica la fuente. ESPN sigue siendo un proveedor externo, sin carácter oficial por este registro.
5. Volver a importar. Una revisión verificada solo se aplica al mismo ID de competición, año, proveedor, URL, ID de encuentro, jornada, fase y contenido publicado. La validación deportiva final sigue pudiendo rechazar el calendario.
6. Para varios encuentros, registrar cada uno expresamente. Cada corrección conserva su documento; la nueva revisión incluye las correcciones anteriores del expediente. Es posible revocar indicando motivo y confirmando expresamente.

Si el proveedor cambia el registro, la revisión queda inactiva. Si publica exactamente los valores corregidos con la misma identidad, se marca como corregida por el proveedor; cualquier otra variación exige otra revisión. Una publicación que vuelve al dato anterior no reactiva una revisión inactiva: el rechazo genera un expediente nuevo. Un cambio de ID también invalida la correspondencia; no se adivina una nueva identidad por equipos o marcador.

Las revisiones contradictorias del mismo encuentro bloquean la importación. Los intentos repetidos con iguales datos y motivo no duplican un expediente activo. Un formulario con una revisión antigua se rechaza. Una corrección verificada que no resuelva la inconsistencia tampoco permite superar las validaciones.

## Persistencia y protección

El registro independiente del torneo es el payload opcional `after` de eventos `source-incident-reviewed`, con esquema interno 1. Cada evento contiene una revisión inmutable completa. Su estructura, documentación y alcance se validan al persistir y al leer respaldos. No se incorpora una clave global nueva ni se cambia JSON v7. Los respaldos de biblioteca anteriores sin incidencias siguen siendo válidos; las versiones anteriores a v7 siguen su migración existente.

Usar **respaldo de biblioteca**, que incluye el historial, para transportar expedientes y documentos. El archivo individual de un torneo conserva su comportamiento previo y no transporta el registro global de incidencias. El respaldo de biblioteca también admite expedientes sin ningún torneo guardado. La interfaz actualiza el historial exportable después de un rechazo o revisión, sin requerir recargar la página.

Registrar, revisar, revocar o invalidar un expediente no escribe torneos. La importación conserva sus modos de copia, actualización conservadora y reemplazo confirmado. Una corrección que cambie participantes de un encuentro con datos locales no permite sobrescribirlos en modo conservador. El evento de importación identifica las revisiones aplicadas. No se altera la historia de temporadas anteriores.

Un fallo de almacenamiento impide guardar la revisión y no autoriza la corrección. Los errores de transporte o respuestas sin identidad utilizable continúan mostrándose como errores de importación; no se inventa una competición, año o encuentro para hacerlos corregibles.

## Verificación real

Ejecución del 17 de octubre de 2026 a las 02:03 UTC (16 de octubre en Chile):

```sh
npm run verify:live -- --only=tercera-a --output=docs/source-incidents-live-results.json
```

ANFA respondió HTTP 200 a las 27 consultas. Se normalizaron 14 equipos y 182 encuentros, 175 con marcador. La validación rechazó Comunal Cabrero–Aguará como localía repetida en jornadas 10 (1–0) y 23 (2–3). Quedó una incidencia automática pendiente con ambos registros, sin correcciones. El código de salida 1 es el rechazo esperado, no una importación exitosa. Repositorio aislado en memoria; ningún acceso a la biblioteca del usuario.

El informe parcial está en `source-incidents-live-results.json`; no reemplaza el informe completo anterior de las 17 rutas. Las pruebas de correcciones utilizan una liga sintética y documentos de prueba: no afirman que exista una rectificación oficial para este encuentro de ANFA.

## Pruebas

Se cubren detección real capturada y sintética, deduplicación, originales, documentación/confirmación obligatorias, revisión provisional, corrección verificada, validación deportiva posterior, alcance por año/competición, cambio del proveedor y su URL, no reactivación, formularios antiguos, escritura fallida, conservación de resultados, rechazo de cambios de participantes con datos locales, respaldo/restauración v7 y respaldos anteriores, y la interfaz de revisión.

Validación final: `npm test` — **543 pruebas aprobadas en 60 archivos** (15 pruebas nuevas). `npm run build` — compilación TypeScript y Vite correctas, sin aumentar el límite de tamaño ni agregar dependencias.

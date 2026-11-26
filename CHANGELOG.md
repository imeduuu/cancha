# Changelog

## [1.0.0] - 2026-11-25

Primera versión estable de Cancha. El producto pasó de crear ligas locales a cubrir la preparación, simulación, archivo y conservación de temporadas de fútbol, con reglas transparentes y persistencia opcional en cuenta.

### Fases 1–10

1. **Campeonatos configurables:** crear ligas con participantes, ruedas, calendario y criterios de desempate.
2. **Simulación y progresión deportiva:** registrar resultados, simular partidos, fechas y temporadas, consultar tablas y estadísticas, y avanzar copas y divisiones.
3. **Núcleo y API:** separar las reglas deportivas en `@cancha/core`; exponer operaciones por GraphQL y persistir cambios del servidor con MongoDB y control de concurrencia.
4. **Cuentas y aislamiento:** añadir registro e inicio de sesión, sesiones seguras, bibliotecas por usuario, respaldos y controles de versión en el servidor.
5. **Biblioteca con sesión y universos:** sincronizar la biblioteca de la cuenta con el cliente y organizar temporadas independientes en universos deportivos.
6. **Fuentes oficiales:** unificar las consultas sin CORS mediante un proxy cerrado reutilizado en producción y desarrollo.
7. **Centros deportivos:** incorporar importación y planificación de temporadas, sorteos y cruces, decisiones, cierres, archivo histórico, historial, palmarés y análisis de clubes.
8. **Entrega y operación:** añadir CI, compilación de la API, despliegue documentado y controles de configuración para Vercel, Render y MongoDB Atlas.
9. **Diseño visual:** establecer «Estadio nocturno», temas claro y oscuro, tokens compartidos y ajustes de accesibilidad y pantallas pequeñas.
10. **Revisión de producto:** corregir recorridos de producción, reforzar integridad, trazabilidad y avisos cuando los datos o reglas no permiten afirmar una clasificación oficial.

### Esta hoja: puntos de guardado y escrituras entre pestañas

- Guardar y administrar puntos manuales con una copia completa de la biblioteca en IndexedDB; revisar el alcance antes de confirmar y verificar SHA-256, formato, cantidades y diferencias.
- Descargar, comparar, renombrar, eliminar y restaurar puntos. La restauración vuelve a validar la biblioteca y descarta borradores de edición que ya no correspondan.
- Coordinar escrituras deportivas entre pestañas con Web Locks, conservar borradores locales y avisar de cambios externos. Las confirmaciones obsoletas se invalidan para evitar sobrescribir una edición más reciente.
- Mantener separados los puntos locales, el respaldo JSON v7, la recuperación automática existente y los universos deportivos.

Más detalle: [puntos de guardado](docs/save-checkpoints.md), [coordinación entre pestañas](docs/cross-tab-write-coordination.md) y [README](README.md).

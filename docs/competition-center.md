# Centro de competiciones y temporadas

En **Biblioteca → Centro de competiciones y temporadas**, selecciona el país/confederación y una competición para consultar todas sus temporadas guardadas, incluidas las archivadas. Abrir una temporada, su calendario o sus pendientes utiliza la navegación existente. La selección del centro se conserva durante la sesión, igual que los borradores; no se persiste en el respaldo.

## Identidad y procedencia

La vista usa `competitionId`. Para registros antiguos sin ese campo, solo reconoce los identificadores completos del catálogo de proveedores, eliminando el sufijo anual con el servicio existente. Los demás registros permanecen separados por ID; nombres semejantes no crean relaciones. Los datos sin país, categoría o año se muestran como no registrados. Las copias con identidad nueva permanecen independientes.

Cada temporada muestra participantes, estado calculado por los servicios deportivos existentes, partidos válidos sobre partidos programados, cobertura declarada y verificación del reglamento para su año. La cobertura completa no certifica resultados oficiales. ESPN se identifica como proveedor, sin atribuirle autoridad federativa.

Los eventos de simulación, edición de resultados, copia o creación de temporada identifican escenarios locales. `seasonPreparation` identifica la planificación incluso si ya se incorporó un calendario. Cuando falta historial no se reconstruye la procedencia: se advierte que puede ser incompleto y nunca se certifican resultados oficiales.

## Relaciones y antecedentes

Las relaciones proceden exclusivamente de `seasonPreparation.sourceTournamentIds` y de los eventos `season-created` existentes. Se pueden abrir los orígenes y las temporadas derivadas. Un origen ausente conserva su ID visible.

Si las referencias identifican Primera y Segunda, se muestran coordinadas con los movimientos registrados al prepararlas (cuando el evento sigue disponible) y la situación actual calculada por `getDivisionTransition`, explícitamente diferenciadas. No se preparan temporadas ni se completan participantes desde este centro. Las revisiones de calendario muestran faltantes, incorporaciones, fuente y motivo documentados.

El centro es una proyección de consulta en la capa de aplicación y un componente de presentación. No hay repositorio, migración, duplicación de torneos ni campos nuevos. Se mantienen JSON v7, respaldos anteriores, resoluciones oficiales, promedios y antecedentes sin reescrituras.

## Verificación

Pruebas específicas: `src/application/services/competition-center.test.ts` y `src/presentation/components/competition-center.test.tsx`. Incluyen identidad, temporadas archivadas, origen explícito, escenarios locales, reglamento con año incompatible, movimientos históricos y lectura de un respaldo v1 sin extensiones recientes.

El recorrido de navegador añadido en `e2e/cancha.e2e.ts` comprueba filtros, navegación entre años, conservación de selección y borrador de resultado, ausencia de cambios en los partidos guardados y ancho adaptable. Usa el servidor local y los contextos aislados descritos en [la auditoría de navegador](browser-audit.md).

```powershell
npm test
npm run test:flows
npm run test:e2e
npm run build
```

Resultados finales del 17 de octubre de 2026:

| Comando | Resultado |
| --- | --- |
| `npm test` | 614 pruebas aprobadas, 65 archivos |
| `npm run test:flows` | 62 recorridos aprobados, 5 archivos |
| `npm run test:e2e -- --workers=3` | 180 pruebas aprobadas, sin reintentos, 7,7 minutos |
| `npm run build` | TypeScript y Vite correctos; sin aviso de tamaño |

Los navegadores ejecutados fueron Chromium, Firefox y WebKit, cada uno en 1440×900, 1366×768, 768×1024 y 390×844. Son navegadores automatizados con esas resoluciones, no dispositivos físicos. La repetición específica del centro (`npm run test:e2e -- --grep "centro de competiciones" --workers=3`) pasó sus 12 casos con el catálogo final y capturas de las tarjetas. Se inspeccionaron capturas de escritorio y móvil, además de comprobar el ancho del documento y los errores de consola en los recorridos. El informe HTML corresponde a la última ejecución específica; ejecutar la suite completa vuelve a generar su informe completo.

Se agregaron 13 casos de pruebas unitarias/componentes y un recorrido de navegador que se ejecuta en 12 proyectos. Las zonas chilenas se reconocen por los IDs reales `anfp-liga-segunda-ascenso` y `anfp-liga-segunda-descenso`, con pruebas para ambos.

Durante la preparación, la prueba nueva buscó inicialmente el centro desde la pantalla de torneo; se corrigió el recorrido para abrir la biblioteca. Una ejecución simultánea de suites hizo fallar la expectativa temporal de una prueba existente de `dev:public`; las ejecuciones completas posteriores, separadas de los navegadores, pasaron sin cambiar esa prueba ni el script del túnel. No se utilizó acceso público ni la biblioteca personal. El servidor local de pruebas quedó cerrado al terminar.

Limitación de procedencia: los respaldos sin actividad suficiente no permiten reconstruir cuáles resultados fueron simulados. Se conserva esa incertidumbre explícitamente; la presencia de una fuente externa nunca certifica los resultados como oficiales.

La ampliación de clasificación internacional y su validación se documentan en [Clasificación internacional entre temporadas](continental-qualification.md). Permite seguir relaciones expresas entre ligas, copas nacionales y ediciones continentales sin inferir continuidad oficial.

## Historial de clubes

El centro incorpora una consulta de [historial deportivo y trayectoria de clubes](club-history.md), derivada de los mismos torneos guardados y sin otro almacenamiento.

## Palmarés y récords

Consulta el [palmarés y los récords históricos](club-honours.md), derivados de los torneos guardados con selección expresa y separación de procedencias.

## Enfrentamientos directos

Consulta el [historial H2H entre clubes](head-to-head.md), con identidad expresa, filtros y fuentes seleccionadas.

## Rendimiento deportivo

Consulta el [panel de rendimiento y evolución de clubes](club-performance.md), con gráficos accesibles y comparación de participaciones compatibles.

## Planificación de temporadas

El [Centro de planificación de temporadas futuras](season-planning-center.md) reúne las vistas previas de nóminas locales, transiciones entre divisiones y ediciones continentales. Reutiliza los casos existentes, distingue dependencias y exige revisión y confirmación antes de escribir.

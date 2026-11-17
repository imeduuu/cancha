# Preparación de futuras ediciones de copas nacionales

## Auditoría y arquitectura

Se revisaron el Centro de planificación, `createTournamentSeason`, las transiciones entre divisiones, los reglamentos anuales, los formatos de copas y sus importadores, las tablas, campeones, identidades y las validaciones y restauraciones v7. Las reglas anteriores de competición describían tablas, movimientos y cupos internacionales; no existía una configuración estructurada de admisión nacional por edición. Los reglamentos anuales de Argentina/Brasil y los importadores siguen atendiendo sus funciones anteriores.

La implementación reutiliza el Centro, su confirmación explícita y su snapshot de revisión. La creación y la revisión de destinos pasan por **`createTournamentSeason`**, ampliado mediante una opción documental adicional; no se incorpora un segundo creador de torneos ni otro repositorio. Sus consumidores anteriores conservan sus opciones y comportamiento.

- `domain/entities/national-cup-planning.ts`: configuración documental de admisión, criterios, participantes y revisiones. Estos datos no son reglas nuevas de partidos.
- `domain/services/national-cup-planning.ts`: validación de la extensión y snapshots de dependencias.
- `application/services/national-cup-planning.ts`: proyección sobre los torneos actuales. Reutiliza los servicios de tablas, empates, campeonato terminado, campeón y perfiles de clubes.
- `application/use-cases/register-national-cup-regulation.ts`: añade un registro documental, con confirmación y actividad coordinada. Conserva los anteriores; no cambia resultados ni las reglas deportivas del origen.
- `plan-season.ts` y `createTournamentSeason`: revisión, revalidación actual y ejecución mediante los flujos existentes.
- `presentation/components/national-cup-regulation-editor.tsx`: formulario dentro del Centro diferido, con borradores de sesión y el diálogo de confirmación existente.

No se añaden dependencias, servicios remotos ni bases de datos. Ningún reglamento real nuevo se suministra de forma predeterminada. Registrar una disposición requiere que el usuario aporte y revise su documentación.

## Acceso y registro

**Biblioteca → Centro de competiciones y temporadas → Planificación de temporadas**.

1. Selecciona una copa nacional guardada como referencia y el año/edición de destino.
2. Elige **Copa nacional con admisión documentada**.
3. Abre **Registrar reglamento de admisión para esta edición**. Introduce el total documentado, la referencia HTTPS, la decisión y la verificación manual del reglamento.
4. Añade cada criterio con descripción, cantidad de cupos, estado y documento. El origen se selecciona por torneo guardado, competición y temporada explícitos. Las invitaciones usan IDs de clubes registrados, sin crear nombres nuevos.
5. Revisa y confirma el registro documental. Esta operación guarda documentación y actividad, pero no crea la edición ni cambia sus partidos.
6. Selecciona el reglamento aplicable, revisa los participantes y dependencias y continúa con **Revisar planificación y continuar → Confirmar preparación**.

Los documentos pendientes o provisionales pueden conservarse para completar la investigación. Para preparar una nómina se exige un reglamento **verificado manualmente**, con todos sus criterios verificados, cantidades coherentes y cupos resueltos. Cada criterio verificado y el reglamento necesitan una referencia HTTPS sin credenciales. Una URL no descarga, comprueba ni certifica el contenido del documento.

Un registro nuevo para la misma edición sustituye operativamente al anterior de ese origen, conservándolo en el historial. Las revisiones que dependían del registro anterior pasan a señalar dependencia desactualizada. No se utiliza el reglamento de otra edición ni se elige uno por semejanza de nombres. Las distintas versiones guardadas de una copa continúan siendo orígenes explícitos distintos; no se fusionan sus documentos.

## Criterios admitidos

| Criterio documentado | Condición necesaria |
| --- | --- |
| Nómina de división | El documento prevé expresamente esa nómina y su cantidad. El origen es una liga con cobertura completa registrada; no se presupone que cualquier división tenga derecho a participar. |
| Posiciones | Posiciones y cantidad explícitas. Se requiere una tabla final acreditada, cobertura suficiente y reglamento de origen verificado. Se reutiliza la fase regular reconocida para las segundas divisiones, sin aplanar eliminatorias. |
| Campeón | Una plaza, origen explícito y campeón resuelto por el servicio deportivo existente, con competición terminada y reglamento/cobertura suficientes. |
| Clubes invitados o incorporados | Selección expresa de IDs de clubes de un torneo y temporada registrados, cantidad y evidencia documental. No requiere terminar partidos que no condicionan esa invitación. |
| Cupos pendientes | Cantidad y motivo documentados. Se conservan pendientes y bloquean la preparación, sin atribuirlos a clubes ficticios. |

Una tabla que el servicio existente no pueda acreditar permanece pendiente. Esto incluye formatos especiales sin una tabla final aplicable. Los empates que afectan posiciones elegidas bloquean este criterio; no se resuelven por orden alfabético ni mediante una reasignación nueva. Si un reglamento exige condiciones que estos criterios no pueden representar, se registran como pendientes y no se crea la edición.

No se infiere qué copa corresponde a qué país o división por los nombres de los torneos. Los identificadores de competición registrados y las referencias históricas reconocidas se reutilizan; los orígenes sin temporada suficiente quedan pendientes. Las nóminas de planificación con cobertura desconocida no se consideran automáticamente divisiones completas.

## Vista previa y conflictos

Se muestra club, ID registrado, competición y torneo de procedencia, temporada, criterio, condición confirmada/provisional/pendiente, procedencia local/de proveedor/desconocida y fuente documental. Los cupos todavía sin club se muestran por cantidad y motivo. La vista previa no escribe ni altera torneos.

**Confirmado por cálculo** significa que los datos y la regla registrada permiten atribuir la plaza. No convierte un escenario local o un resultado de proveedor en confirmación federativa. La edición preparada siempre se identifica como planificación local.

Se bloquean:

- Reglamentos de otra edición, sustituidos, pendientes o provisionales.
- Fuentes ausentes, temporadas/competiciones incompatibles y cantidades incompletas.
- Cupos sin resolver, tablas o campeones pendientes y desempates relevantes.
- Referencias a clubes que ya no están disponibles.
- Identidades ambiguas o contradictorias y participantes duplicados, aunque procedan de dos criterios diferentes.
- Copias documentales que requieren revisión y destinos incompatibles o sin selección expresa.

No se fusionan clubes por sus nombres. También se conservan las restricciones de nombres duplicados del creador existente: un conflicto no se corrige renombrando o reasignando clubes automáticamente. Los vínculos con una edición existente se comparan mediante las identidades del historial; los homónimos sin vínculo se presentan como diferencias de identidad.

Los estados generales del Centro pueden coexistir. Algunos describen el origen completo: una copa de referencia puede tener partidos pendientes que no condicionan una invitación documentada. La lista de bloqueos de admisión muestra qué impide efectivamente crear la nómina. Ninguna confirmación genérica permite saltar un bloqueo de ese criterio.

## Creación y revisión de un destino

La revisión en memoria utiliza la copia y el snapshot canónico de la biblioteca y actividad del Centro existente. Se exige confirmación explícita y se vuelven a consultar los datos actuales. Una revisión alterada o desactualizada se rechaza antes de guardar. El creador vuelve a proyectar los requisitos documentales y deportivos, incluso si se invoca directamente con la nueva opción.

La edición nueva contiene únicamente los participantes registrados y sus referencias. Mantiene IDs estables y los tokens históricos explícitos cuando existen. No copia grupos, números de competición, planteles, partidos, sorteos, cruces, resultados ni fases. El calendario y el reglamento de juego quedan pendientes; el reglamento de admisión documentado no equivale a un reglamento futuro de partidos verificado.

Si la edición ya está guardada, se debe elegir el destino concreto. La operación añade una **revisión documental**, conserva sus participantes, calendario, resultados, plantel y configuración y muestra las discrepancias. No se permite crear otra versión accidentalmente ni reemplazar su nómina mediante esta confirmación. Las diferencias no se resuelven automáticamente.

Las operaciones utilizan `saveWithActivity`: alta documental, creación de temporada o revisión documental, según corresponda. Una escritura fallida conserva la reversión coordinada con el historial que ya ofrece el repositorio.

## Actualización y antecedentes

La proyección consulta los resultados, participantes, reglamentos y estados actuales. Las revisiones guardadas incluyen el reglamento empleado, sus participantes y snapshots de los orígenes. Un resultado, identidad, configuración o procedencia incompatible marca la revisión como desactualizada. Sustituir el reglamento de esa edición también invalida su coincidencia. Se conserva la revisión y no se modifica la copa de destino.

Los snapshots excluyen el historial documental de copa nacional para evitar referencias recursivas y que añadir una revisión se invalide a sí mismo. El reglamento aplicado se compara por separado con el registro vigente de su origen. La confirmación efímera del Centro sigue siendo más conservadora: cualquier cambio de biblioteca o actividad después de revisar exige otra revisión.

Los borradores del formulario usan claves por copa y edición. Navegar conserva campos, criterios añadidos y selecciones durante la sesión. Las confirmaciones abiertas no se convierten en decisiones persistidas. Una recarga conserva los documentos guardados, pero inicia otra sesión de borradores.

## Persistencia y compatibilidad

Se mantiene JSON **versión 7** con una sola extensión opcional: `Tournament.nationalCupPlanning`, esquema interno 1. Contiene registros de reglamento y revisiones documentales; no duplica calendarios ni historiales deportivos. Se valida antes de guardar, restaurar y aceptar datos locales. Los respaldos anteriores sin la extensión siguen siendo válidos.

Los snapshots de exportación conservan la extensión completa. Las copias conservan antecedentes, con `requiresReview`, y no reactivan sus reglas por una confirmación de otro flujo. El registro de nuevas disposiciones se realiza desde el origen documental válido; no se reconstruyen referencias de una copia por coincidencias nominales.

Los modos de reimportación conservador y de reemplazo mantienen la documentación anterior de la misma competición; sus posibles cambios deportivos dejan desactualizadas las dependencias correspondientes. Una importación como copia no hereda el registro del torneo original. No cambia la normalización deportiva del proveedor ni el comportamiento de los importadores.

La aplicación no consulta Internet para validar estos documentos ni aporta reglamentos futuros reales. No se accede a bibliotecas ajenas ni se comparte localStorage. Las reglas oficiales y los calendarios existentes conservan su comportamiento.

## Validación

```powershell
npm test
npm run test:flows
npm run test:e2e
npm run build
```

Las pruebas nuevas cubren reglas completas e incompletas, división, posiciones, campeón, invitados registrados, cupos pendientes, documentación HTTPS, identidad, duplicados, confirmación, cambio de dependencias, sustitución de reglamentos, conservación de destinos con partidos, respaldos antiguos/v7, documentos inválidos, copias inactivas, reversión por almacenamiento fallido y conservación durante reimportaciones.

El recorrido nuevo de navegador registra la disposición desde la interfaz, conserva el borrador al navegar, cancela una confirmación sin escribir, crea una edición vacía, revisa un destino existente sin sustituirlo y comprueba los documentos tras recargar. Utiliza datos sintéticos y perfiles aislados, sin proveedores reales ni túnel público.

### Resultados definitivos — 28 de octubre de 2026

| Comando ejecutado | Resultado |
| --- | --- |
| `npm test` | **818 pruebas aprobadas en 80 archivos**, 55,15 s, configuración normal, ejecución final sin compilación simultánea. |
| `npm run test:flows` | **62 pruebas aprobadas en 5 archivos**, 34,00 s. |
| `npm run test:e2e -- --workers=3` | **288 pruebas aprobadas**, 10,4 min, sin reintentos. |
| `npm run build` | **Correcto**, TypeScript y Vite, sin aviso de tamaño. |

Se añadieron **25 pruebas de aplicación/persistencia** (19 de aplicación y 6 de persistencia/reimportación) y un recorrido E2E ejecutado en los doce proyectos: **12 comprobaciones nuevas**. Se ejecutó la suite completa, incluidas las 276 comprobaciones de navegador anteriores. El recorrido nuevo también aprobó por separado en Chromium móvil antes de la ejecución general.

Se ejecutaron **Chromium, Firefox y WebKit**, cada uno en escritorio **1440×900**, notebook **1366×768**, tablet **768×1024** y móvil **390×844**. Son resoluciones de navegador representativas, no pruebas en dispositivos físicos. Se revisaron las capturas nuevas de escritorio y móvil. No hubo errores inesperados de consola/solicitudes ni desbordamiento horizontal del documento. Los fallos de módulo provocados intencionadamente por los recorridos anteriores conservaron sus comprobaciones específicas. El informe HTML y las capturas de Playwright corresponden a las 288 pruebas.

En el primer intento de `npm test`, ejecutado junto a la compilación, aprobaron 817 pruebas y falló una prueba anterior de `scripts/dev-public.test.mjs`: su plazo real de 50 ms terminó antes de observar un segundo intento de una solicitud detenida. La repetición completa de `npm test` sin la compilación simultánea aprobó las 818 pruebas. No se modificaron el script del túnel, sus pruebas ni sus plazos; queda registrada esa sensibilidad a la carga del entorno.

El Centro y su editor documental permanecen diferidos: **24,63 kB** (**6,61 kB gzip**) para su fragmento. El JavaScript principal mide **384,66 kB** (**110,27 kB gzip**). No se incorporaron paquetes ni se elevó el límite de advertencia de Vite.

La verificación utilizó datos sintéticos deterministas y contextos aislados con servidor local dedicado. No se consultaron fuentes reales ni se certificó un reglamento de ninguna federación, no se utilizó Cloudflare y no se accedió a la biblioteca personal. El escenario de copa de prueba se preparó con el servicio de fases existente; no se modificaron los reglamentos, cálculos de resultados ni las validaciones deportivas para aprobarlo.

Los límites operativos siguen visibles: una regla que no se pueda representar suficientemente, un origen sin cobertura o identidad acreditada, una clasificación incompleta o un cupo pendiente bloquean la preparación. Los formatos especiales sin una tabla aplicable no se convierten en ligas planas; las diferencias con ediciones existentes se conservan para revisión. La aplicación no certifica automáticamente documentos ni completa un calendario futuro.

# Acceso público temporal

## Windows: una instalación y un comando

Instalar el cliente nativo:

```powershell
winget install --id Cloudflare.cloudflared --exact
```

El identificador figura en el [catálogo de Microsoft](https://github.com/microsoft/winget-pkgs/tree/master/manifests/c/Cloudflare/cloudflared). Cerrar y abrir la terminal permite recoger el PATH actualizado. Comprobar con `cloudflared --version`.

Alternativa: descargar el ejecutable para Windows desde las [descargas oficiales de Cloudflare](https://developers.cloudflare.com/tunnel/downloads/), guardarlo fuera del repositorio y proporcionar su ruta en PowerShell:

```powershell
$env:CLOUDFLARED_PATH = "C:\Tools\cloudflared-windows-amd64.exe"
npm run dev:public
```

Con el cliente disponible, desde `CONMEBOL`:

```powershell
npm run dev:public
```

Esperar **URL PÚBLICA LISTA PARA COMPARTIR**, copiar la URL HTTPS generada y mantener la terminal abierta. Antes de ese mensaje, una URL en los logs de Cloudflare puede seguir propagándose. El script verifica que HTTPS alcanza este servidor concreto, no solo que devuelve HTTP 200.

**Ctrl+C** detiene el cliente y cierra Vite. Cerrar la terminal también termina la sesión; no se instala un servicio. Los Quick Tunnels generan nombres aleatorios y no tienen garantía de disponibilidad, por eso el enlace puede ser diferente cada vez. No requieren cuenta ni dominio propio. [Documentación de Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

## Firewall y errores

No abrir puertos en el router ni desactivar Windows Firewall. Vite escucha exclusivamente en `127.0.0.1`. El túnel usa conexiones salientes del ejecutable oficial; si la red las bloquea, permitir esa salida según la política del equipo o consultar al administrador. Cloudflare documenta salida al puerto 7844, UDP para QUIC o TCP para HTTP/2; no es una regla de entrada para publicar Vite. [Requisitos oficiales de firewall](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/).

- **No se encontró cloudflared:** instalarlo, reabrir la terminal o establecer `CLOUDFLARED_PATH` al `.exe` nativo. El script no instala ni descarga clientes por su cuenta.
- **Vite no inicia:** revisar el error mostrado. Se conserva la elección de puerto de Vite: si el habitual está ocupado, el túnel utiliza el puerto real elegido.
- **Sin URL / conexión fallida:** revisar Internet, DNS, VPN y firewall. Se muestran los logs del cliente; si no genera URL dentro del plazo, se cierran ambos recursos. Una vez generada la URL, la comprobación HTTPS reintenta durante hasta 3 minutos, con hasta 10 segundos por solicitud y pausas de 3 segundos. Informa errores DNS, TLS, conexión, timeout y respuestas HTTP (incluido rechazo 403 o falta del identificador de Cancha). Si agota los reintentos, el enlace queda sin confirmar y ambos recursos siguen activos: abrir la URL manualmente y decidir entre mantener la terminal abierta o pulsar Ctrl+C para cerrar. Una conexión QUIC solo confirma el transporte de cloudflared, no el acceso HTTPS desde el equipo.
- **Desconexión después de iniciarse:** consultar los logs de reconexión de cloudflared; no se promete disponibilidad continua. Si el cliente o Vite terminan, se cierra la otra parte.

## Privacidad y datos

Cualquier persona que conozca el enlace puede acceder mientras esté activo. Usarlo solo para pruebas con personas de confianza. Es un servidor de desarrollo: el código frontend y las dependencias necesarias llegan al navegador. No colocar secretos en código que importe la interfaz ni considerarlo un alojamiento de producción.

Solo `dev:public` aplica estas restricciones:

- Lista explícita de hosts `.trycloudflare.com`, además de los locales admitidos por Vite. No se usa `allowedHosts: true`.
- Archivos `.env` sin cargar (`envDir: false`) y sin prefijos de variables públicas (`envPrefix: []`). No se serializan variables del sistema al cliente.
- Sin publicación automática del directorio `public`. El middleware permite la entrada de Cancha, módulos registrados en el grafo de Vite y las cuatro rutas de proxy existentes. Rechaza documentación, scripts, pruebas, datos de test, archivos ocultos, lecturas arbitrarias y rutas ajenas a la aplicación.
- Restricción de archivos de Vite al proyecto y WebSocket de desarrollo por el puerto HTTPS público 443. No cambia puertos de producción ni permite hosts indiscriminados.
- Configuración de cloudflared vacía en un directorio temporal propio; no se modifica la configuración habitual del usuario ni se reutilizan variables `TUNNEL_*`/`CLOUDFLARED_*` para iniciar túneles autenticados. No hay tokens ni secretos nuevos en el repositorio.

Estas medidas reducen la superficie de un servidor de desarrollo; no convierten Vite en un servidor de producción ni garantizan ocultar código que la propia aplicación necesita enviar al navegador. `npm run dev`, preview, producción, proxies e importadores mantienen su configuración existente.

La aplicación sigue guardando los torneos exclusivamente en localStorage del navegador. No existe sincronización ni almacenamiento compartido por el túnel. `localhost`, una URL del túnel, otra URL de una ejecución nueva y el navegador de tu amigo son orígenes/almacenamientos separados. Para compartir datos, exportar el respaldo JSON v7 y enviarlo explícitamente; cada persona lo restaura en su propia biblioteca. Exportar antes de detener el túnel permite conservar fácilmente los datos introducidos en ese origen temporal.

## Implementación y pruebas

`scripts/dev-public.mjs` usa la API de Vite para escuchar y conocer su puerto real; el proceso Node administra ese servidor y un proceso hijo nativo de cloudflared, sin shell ni ventanas adicionales. Antes de iniciar el túnel comprueba el cliente y el origen local. Procesa stdout y stderr por líneas, distingue URL generada de URL accesible y gestiona SIGINT, SIGTERM, SIGHUP, errores y salidas inesperadas. Al cerrar, termina el cliente, cierra el servidor y elimina únicamente su configuración temporal.

```powershell
npm test -- --run scripts/dev-public.test.mjs
npm test
npm run build
```

Las pruebas incluyen puerto ocupado y Vite real, carga recursiva de más de 60 módulos (incluidos imports dinámicos), conservación de proxies, hosts rechazados/admitidos, bloqueo de archivos del proyecto, ausencia de variables VITE privadas en el cliente, falta de cloudflared, fallo de Vite, errores del cliente y de conectividad, URL fragmentada en logs, timeout, cancelación durante el arranque y cierre coordinado/forzado.

## Comprobación real

El 17 de octubre de 2026, aproximadamente a las 04:17 America/Santiago, se descargó temporalmente el ejecutable oficial **cloudflared 2026.10.1** y se verificó su SHA256 con el digest publicado por GitHub. No se instaló en el sistema ni se modificó el PATH.

Cloudflare generó `https://ejemplo-aleatorio.trycloudflare.com`. La comprobación automática recibió el identificador del servidor y una solicitud HTTPS adicional devolvió **HTTP 200** con el HTML de Cancha. Después se cerraron Vite y cloudflared y se eliminó el ejecutable temporal. **Ese enlace de prueba ya no está activo ni debe usarse para compartir.** Esto comprueba acceso HTTP real; no certifica una sesión completa de navegador remoto ni todas las interacciones HMR.

También se ejecutó `npm run dev:public` sin cliente instalado: terminó con un mensaje de instalación, sin abrir un túnel ni inventar un enlace.

Validación final: `npm test` aprobó **589 pruebas en 63 archivos**, incluidas **19 pruebas** del acceso público; `npm run build` terminó correctamente. El JavaScript de entrada de producción se mantiene en **370,82 kB**.

Si aparece `Cierre incompleto`, revisar el proceso indicado en el Administrador de tareas: el script informa el fallo y no afirma que los procesos hayan terminado.

## Corrección del cierre por comprobación HTTPS (17 de octubre de 2026)

La comprobación anterior ocultaba la causa de cada fallo y cerraba ambos recursos al agotar 60 segundos, con solo 3 segundos por solicitud. Ahora distingue DNS, TLS, conexión, timeout y respuestas HTTP, reintenta durante hasta 180 segundos y conserva el túnel si HTTPS queda sin confirmar. Mantener la terminal abierta permite probar manualmente; Ctrl+C cierra ambos recursos. La promesa interna ready rechaza si no se confirma HTTPS, pero esa comprobación pública no resuelve done ni inicia el cierre. Los errores de arranque local y la terminación inesperada de cualquiera de los recursos siguen cerrando la sesión.

En la nueva prueba real con cloudflared 2026.10.1 se reprodujeron los PASS y la conexión QUIC mientras HTTPS fallaba por DNS. Tras 20 intentos fallidos, el mismo enlace se recuperó: se verificó el identificador de Cancha y una solicitud HTTPS adicional devolvió HTTP 200 con el HTML de la aplicación. Después se cerraron ambos recursos; ese enlace de prueba ya no está activo. No se desactivó TLS ni se cambiaron DNS, firewall, hosts permitidos o proxies.

Validación de esta corrección: npm test aprobó 601 pruebas en 63 archivos, incluidas 31 pruebas del acceso público; npm run build terminó correctamente. Se cubren éxito HTTPS, recuperación temporal, timeout real de solicitud, HTTP inválido, clasificación DNS/TLS/conexión, conservación de recursos tras agotar comprobaciones, Ctrl+C durante HTTPS y cierres inesperados.

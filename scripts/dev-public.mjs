import { spawn, execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const proxyPrefixes = ["/official-source/", "/third-division-source/", "/argentina-cup-source/", "/brazil-cup-source/"];
const pause = (ms, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) return reject(signal.reason);
  const cancel = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, ms);
  signal.addEventListener("abort", cancel, { once: true });
});

/** Only the public command installs this middleware. Normal dev/preview/build are unchanged. */
export function publicFilesPlugin(marker) {
  return { name: "cancha-public-development-files", configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      try {
        const raw = (req.url ?? "/").split("?")[0];
        const path = decodeURIComponent(raw).replaceAll("\\", "/");
        if (path.split("/").some(part => part === ".." || (part.startsWith(".") && !(part === ".vite" && path.startsWith("/node_modules/.vite/"))))
          || /(?:^|\/)(?:test-utils|docs|scripts)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(path)) {
          res.writeHead(403); res.end("Archivo no disponible en el acceso temporal."); return;
        }
        const basic = ["/", "/index.html", "/src/main.tsx", "/@vite/client", "/@react-refresh"].includes(path);
        const proxy = proxyPrefixes.some(prefix => path.startsWith(prefix));
        const candidate = path.startsWith("/src/") || path.startsWith("/node_modules/.vite/") || path.startsWith("/@id/")
          || path.endsWith("/node_modules/vite/dist/client/env.mjs");
        const module = candidate ? await server.moduleGraph.getModuleByUrl(req.url) : undefined;
        if (!basic && !proxy && !module) { res.writeHead(403); res.end("Ruta no disponible en el acceso temporal."); return; }
        // No raw/url/inline reads of arbitrary files: serve only imports known to Vite's module graph.
        res.setHeader("X-Cancha-Dev", marker);
        next();
      } catch { res.writeHead(400); res.end("Solicitud no válida."); }
    });
  } };
}

export function httpDiagnostic(error) {
  const codes = [error, error?.cause, ...(error?.cause?.errors ?? [])].filter(Boolean).flatMap(e => [e.code, e.name].filter(Boolean));
  if (codes.some(c => /^(ENOTFOUND|EAI_AGAIN|EAI_FAIL)$/.test(c))) return "DNS: no se pudo resolver el nombre del túnel";
  if (codes.some(c => /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(c))) return "TLS: no se pudo verificar el certificado; revisa certificados del sistema, fecha y proxy HTTPS";
  if (codes.some(c => /Timeout|TIMEOUT|TIMEDOUT/.test(c))) return "timeout: la solicitud superó su plazo";
  if (codes.some(c => /ECONN|ENET|EHOST|UND_ERR_SOCKET/.test(c))) return "conexión: no se pudo completar la conexión HTTPS";
  return "solicitud: " + (error?.cause?.message ?? error?.message ?? String(error));
}

export async function waitForHttp(url, {
  signal, marker, timeoutMs = 180000, requestTimeoutMs = 10000, retryMs = 3000,
  fetcher = fetch, onAttempt = () => {},
}) {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0, diagnostic = "timeout: se agotó el plazo de comprobación";
  while (!signal.aborted && Date.now() < deadline) {
    attempts++;
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Math.min(requestTimeoutMs, deadline - Date.now())))]);
    try {
      const response = await fetcher(url, { signal: requestSignal, redirect: "manual" });
      const valid = response.ok && response.headers.get("X-Cancha-Dev") === marker;
      diagnostic = !response.ok
        ? `HTTP ${response.status}: ${response.status === 403 ? "acceso rechazado; revisa Host y restricciones de Vite" : "respuesta no válida del túnel/origen"}`
        : "HTTP: falta el identificador de esta instancia de Cancha";
      await response.body?.cancel();
      if (valid) return;
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      diagnostic = httpDiagnostic(error);
    }
    onAttempt({ attempts, diagnostic });
    const remaining = deadline - Date.now();
    if (remaining > 0) await pause(Math.min(retryMs, remaining), signal);
  }
  if (signal.aborted) throw signal.reason;
  throw new Error(`No respondió Cancha en ${url} tras ${attempts} intentos (plazo ${timeoutMs} ms). Último diagnóstico: ${diagnostic}.`);
}

export async function checkCloudflared(executable, signal) {
  try { await promisify(execFile)(executable, ["--version"], { windowsHide: true, timeout: 8000, signal }); }
  catch (error) {
    if (signal.aborted) throw signal.reason;
    throw new Error(error.code === "ENOENT"
      ? "No se encontró cloudflared. Instálalo con: winget install --id Cloudflare.cloudflared --exact. Abre otra terminal y vuelve a intentar."
      : "No se pudo ejecutar cloudflared --version. Revisa su instalación o CLOUDFLARED_PATH.", { cause: error });
  }
}

export async function stopTunnel(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    let settled = false, forceTimer, exitTimer;
    const finish = error => {
      if (settled) return; settled = true;
      clearTimeout(forceTimer); clearTimeout(exitTimer); child.removeListener("exit", onExit);
      if (error) reject(error); else resolve();
    };
    const onExit = () => finish();
    child.once("exit", onExit);
    forceTimer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch (error) { finish(error); return; }
      if (!settled) exitTimer = setTimeout(() => finish(new Error(`cloudflared no confirmó su cierre (PID ${child.pid ?? "desconocido"}).`)), 2000);
    }, 3000);
    try { child.kill("SIGTERM"); } catch (error) { finish(error); }
  });
}

export async function startPublicDevelopment({
  createViteServer = createServer, spawnProcess = spawn, checkClient = checkCloudflared,
  checkHttp = waitForHttp, signals = process, logger = console,
  executable = process.env.CLOUDFLARED_PATH || "cloudflared", urlTimeoutMs = 60000,
} = {}) {
  const abort = new AbortController();
  const marker = randomUUID();
  let server, tunnel, configDirectory, urlTimer, stopping, publicUrl;
  let resolveDone, resolveReady, rejectReady;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  ready.catch(() => {}); // CLI/tests may be waiting for startup rather than the public URL yet.
  const interrupt = () => { void close(0); };
  const onHttpClose = () => { if (!stopping) void fail(new Error("Vite se cerró inesperadamente.")); };
  const onHttpError = error => { if (!stopping) void fail(new Error(`Falló Vite: ${error.message}`)); };
  async function close(code = 0) {
    if (stopping) return stopping;
    // Set the flag before killing children; their exit callbacks must not start another shutdown.
    let finish;
    stopping = new Promise(resolve => { finish = resolve; });
    abort.abort(new Error("Acceso temporal detenido."));
    rejectReady(abort.signal.reason); clearTimeout(urlTimer);
    const results = await Promise.allSettled([stopTunnel(tunnel), server?.close()]);
    try {
      if (configDirectory && dirname(configDirectory) === resolve(tmpdir()) && basename(configDirectory).startsWith("cancha-tunnel-")) {
        await rm(configDirectory, { recursive: true, force: true });
      }
    } catch (error) { logger.error(`No se pudo limpiar la configuración temporal: ${error.message}`); code = 1; }
    const incomplete = results.some(result => result.status === "rejected");
    if (incomplete) {
      for (const result of results) if (result.status === "rejected") logger.error(`Cierre incompleto: ${result.reason?.message ?? result.reason}`);
      code = 1;
    }
    signals.removeListener("SIGINT", interrupt); signals.removeListener("SIGTERM", interrupt);
    signals.removeListener("SIGHUP", interrupt);
    server?.httpServer?.removeListener("close", onHttpClose); server?.httpServer?.removeListener("error", onHttpError);
    if (!incomplete) logger.log("Acceso temporal detenido; Vite y cloudflared cerrados.");
    resolveDone(code); finish();
    return stopping;
  }
  async function fail(error) {
    if (stopping) return;
    logger.error(error.message); rejectReady(error); await close(1);
  }
  signals.on("SIGINT", interrupt); signals.on("SIGTERM", interrupt); signals.on("SIGHUP", interrupt);
  const controller = { ready, done, close, get server() { return server; }, get tunnel() { return tunnel; } };
  try {
    if (/\.(?:cmd|bat)$/i.test(executable)) throw new Error("CLOUDFLARED_PATH debe apuntar al ejecutable nativo cloudflared.exe, no a un script de shell.");
    await checkClient(executable, abort.signal);
    if (abort.signal.aborted) return controller;
    logger.log("Iniciando Cancha en localhost…");
    server = await createViteServer({ root, envDir: false, envPrefix: [], publicDir: false,
      plugins: [publicFilesPlugin(marker)],
      server: { host: "127.0.0.1", allowedHosts: [".trycloudflare.com"], ws: { clientPort: 443 }, forwardConsole: false,
        fs: { strict: true, allow: [root] } } });
    if (abort.signal.aborted) { await server.close(); return controller; }
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string" || address.address !== "127.0.0.1") throw new Error("Vite no abrió un puerto en localhost.");
    const localUrl = `http://127.0.0.1:${address.port}`;
    await checkHttp(localUrl, { signal: abort.signal, marker, timeoutMs: 10000 });
    if (abort.signal.aborted) return controller;
    server.httpServer.on("close", onHttpClose); server.httpServer.on("error", onHttpError);
    logger.log(`Vite listo: ${localUrl}. Solicitando un Quick Tunnel temporal…`);
    configDirectory = await mkdtemp(join(resolve(tmpdir()), "cancha-tunnel-"));
    await writeFile(join(configDirectory, "config.yml"), "{}\n", { mode: 0o600 });
    if (abort.signal.aborted) {
      await rm(configDirectory, { recursive: true, force: true }); return controller;
    }
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:TUNNEL_|CLOUDFLARED_)/i.test(key)));
    tunnel = spawnProcess(executable, ["tunnel", "--config", join(configDirectory, "config.yml"), "--no-autoupdate", "--url", localUrl],
      { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env });
    tunnel.on("error", error => { void fail(new Error(`No se pudo iniciar Cloudflare Tunnel: ${error.message}`)); });
    tunnel.on("exit", (code, signal) => {
      if (!stopping) void fail(new Error(`Cloudflare Tunnel terminó inesperadamente (${signal ?? code}). Revisa conexión, firewall e instalación.`));
    });
    urlTimer = setTimeout(() => { void fail(new Error("Cloudflare no generó una URL a tiempo. Revisa Internet, DNS y firewall; vuelve a ejecutar npm run dev:public.")); }, urlTimeoutMs);
    async function generated(url) {
      if (publicUrl || stopping) return;
      publicUrl = url; clearTimeout(urlTimer);
      logger.log(`Cloudflare generó ${url}; comprobando acceso HTTPS…`);
      try {
        await checkHttp(url, { signal: abort.signal, marker,
          onAttempt: ({ attempts, diagnostic }) => logger.log(`Comprobación HTTPS, intento ${attempts}: ${diagnostic}. Reintentando mientras se propaga el túnel…`),
        });
        if (!stopping) { logger.log(`\nURL PÚBLICA LISTA PARA COMPARTIR: ${url}\nSolo personas de confianza. Ctrl+C detiene ambos procesos.\n`); resolveReady(url); }
      } catch (error) {
        if (!stopping) {
          logger.error(error.message);
          logger.log(`Acceso HTTPS sin confirmar: ${url}\nVite y cloudflared siguen activos para probar el enlace manualmente. Puedes mantener esta terminal abierta o pulsar Ctrl+C para cerrar ambos procesos. Una conexión QUIC no confirma que HTTPS funcione desde esta red.`);
          rejectReady(error);
        }
      }
    }
    for (const stream of [tunnel.stdout, tunnel.stderr]) {
      let pending = "";
      stream.setEncoding("utf8");
      stream.on("data", chunk => {
        pending += chunk;
        const lines = pending.split(/\r?\n/); pending = lines.pop().slice(-16384);
        for (const line of lines) {
          logger.log(`[cloudflared] ${line}`);
          const match = line.match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com(?=[\s/|]|$)/i);
          if (match) void generated(new URL(match[0]).origin);
        }
      });
    }
    return controller;
  } catch (error) {
    if (abort.signal.aborted && stopping) return controller;
    await close(1); throw new Error(`No se pudo iniciar el acceso público: ${error.message}`, { cause: error });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const session = await startPublicDevelopment(); process.exitCode = await session.done; }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

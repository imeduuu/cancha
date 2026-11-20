import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { officialSourcePrefixes, type OfficialSourceTargets } from "@cancha/official-source-proxy";

export interface FakeOfficialSource {
  /** Los cuatro prefijos apuntan a este servidor local (OFFICIAL_SOURCE_TARGETS). */
  readonly targets: OfficialSourceTargets;
  /** Consultas recibidas por el origen, con sus cabeceras. */
  readonly hits: { readonly url: string; readonly headers: IncomingHttpHeaders }[];
  stop(): Promise<void>;
}

/**
 * Origen falso para las pruebas del proxy en la API (sin red):
 * `/`, `/ok` y `/ok/` responden HTML con la ruta pedida (con su query), `/fail` responde 500 y
 * `/redirect-foreign` redirige a otro host.
 */
export async function startFakeOfficialSource(): Promise<FakeOfficialSource> {
  const hits: { url: string; headers: IncomingHttpHeaders }[] = [];
  const server: Server = createServer((req, res) => {
    hits.push({ url: req.url ?? "", headers: req.headers });
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/" || path === "/ok" || path === "/ok/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "set-cookie": "origen=1" });
      res.end(`<p>${req.url}</p>`);
    } else if (path === "/fail") {
      res.writeHead(500);
      res.end("error");
    } else if (path === "/redirect-foreign") {
      res.writeHead(302, { location: "https://evil.example/" });
      res.end();
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const targets = Object.fromEntries(officialSourcePrefixes.map(prefix => [prefix, url])) as unknown as OfficialSourceTargets;
  return {
    targets,
    hits,
    stop: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

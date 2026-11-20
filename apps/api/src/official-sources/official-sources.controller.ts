import { All, Controller, Inject, Req, Res } from "@nestjs/common";
import type { OfficialSourceProxy } from "@cancha/official-source-proxy";
import type { Request, Response } from "express";
import { Public } from "../auth/auth.guard.js";
import { OFFICIAL_SOURCE_PROXY } from "./official-sources.tokens.js";

/**
 * Las cuatro rutas de fuentes oficiales, con los mismos prefijos que usaba el
 * proxy de Vite (los importadores de la web no cambian). Públicas: la web sin
 * sesión también importa. Todo método llega aquí para que el proxy responda 405
 * a lo que no sea GET; la política completa vive en @cancha/official-source-proxy.
 */
@Public()
@Controller()
export class OfficialSourcesController {
  constructor(@Inject(OFFICIAL_SOURCE_PROXY) private readonly proxy: OfficialSourceProxy) {}

  // `{/*path}` (path-to-regexp v8) hace opcional la subruta: con `/*path` el prefijo
  // solo (`/official-source` o `/official-source/`) respondía 404 sin llegar al proxy.
  @All(["official-source{/*path}", "third-division-source{/*path}", "argentina-cup-source{/*path}", "brazil-cup-source{/*path}"])
  async forward(@Req() req: Request, @Res() res: Response): Promise<void> {
    // req.ip respeta TRUST_PROXY (número de saltos): el proxy nunca lee X-Forwarded-For.
    await this.proxy.handle(req, res, { clientKey: req.ip, url: req.originalUrl });
  }
}

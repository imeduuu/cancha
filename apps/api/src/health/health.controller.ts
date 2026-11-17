import { Controller, Get, HttpException, HttpStatus, Inject } from "@nestjs/common";
import { HealthService, type HealthReport } from "./health.service.js";

@Controller("health")
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  /** 200 si la app y Mongo responden; 503 con el mismo cuerpo si Mongo no responde. */
  @Get()
  async check(): Promise<HealthReport> {
    const report = await this.health.check();
    if (report.status !== "ok") throw new HttpException(report, HttpStatus.SERVICE_UNAVAILABLE);
    return report;
  }
}

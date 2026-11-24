import type { Tournament } from "../../domain/entities/tournament";

/** Traducciones únicas para valores del modelo que aparecen en la interfaz. */
export const userFacingLabels = {
  competitionFormat(format: Tournament["format"] | undefined): string {
    if (format === "round-robin") return "Todos contra todos";
    if (format === "staged") return "Por etapas";
    return "No registrado";
  },
  competitionType(type: Tournament["competitionType"] | undefined): string {
    if (type === "league") return "Liga";
    if (type === "cup") return "Copa por eliminación";
    return "No registrado";
  },
  verificationStatus(status: string): string {
    if (status === "verified" || status === "confirmed") return "confirmado";
    if (status === "provisional") return "provisional";
    if (status === "pending") return "pendiente";
    return status;
  },
  destination(destination: string): string {
    const labels: Record<string, string> = {
      libertadores: "Libertadores · fase de grupos",
      "libertadores-qualifying": "Libertadores · fase previa",
      sudamericana: "Sudamericana",
      "conmebol-libertadores": "Libertadores",
      "conmebol-sudamericana": "Sudamericana",
    };
    return labels[destination] ?? destination;
  },
} as const;

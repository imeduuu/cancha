import type { Tournament } from "../entities/tournament";

export const NACIONAL_ID = "arg-primera-nacional-2026";
export const SERIE_B_ID = "brasileirao-serie-b-2026";
export const REGULAR_PHASE = "Fase regular";
export const NACIONAL_RULES_URL = "https://assets1.afa.com.ar/2025/LEA-2026/ENERO/Boletin-Especial-6823---Reglamento-del-Campeonato-de-Primera-Nacional-2026.pdf";
export const SERIE_B_RULES_URL = "https://stcbfsiteprdimgbrs.blob.core.windows.net/img-site/cdn/REC_Brasileiro_Serie_B_2026_85d55b9f72.pdf";
export const LPF_RULES_URL = "https://www.ligaprofesional.ar/wp-content/uploads/2026/01/Reglamento-Torneos-LPF-Primera-2026-1.pdf";

export function secondDivisionKind(tournament: Tournament): "argentina" | "brasil" | undefined {
  if (tournament.season !== 2026) return undefined;
  const identity = tournament.competitionId ?? tournament.id.replace(/-2026$/, "");
  if (identity === NACIONAL_ID.replace(/-2026$/, "")) return "argentina";
  if (identity === SERIE_B_ID.replace(/-2026$/, "")) return "brasil";
  return undefined;
}

export function isSecondDivisionRegularPhase(phaseName?: string): boolean {
  return phaseName === REGULAR_PHASE;
}

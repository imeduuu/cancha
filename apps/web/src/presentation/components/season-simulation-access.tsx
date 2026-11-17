import { createContext, useContext } from "react";
import type { Tournament } from "@cancha/core/domain/entities/tournament";

export const SeasonSimulationNavigation = createContext<((tournament?: Tournament) => void) | null>(null);

export function SeasonSimulationAccess({ tournament }: { tournament?: Tournament }) {
  const open = useContext(SeasonSimulationNavigation);
  return open ? <button type="button" className="small-action" onClick={() => open(tournament)}>Abrir Centro de simulación</button> : null;
}

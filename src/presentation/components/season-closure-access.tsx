import { createContext, useContext } from "react";
import type { Tournament } from "../../domain/entities/tournament";

export const SeasonClosureNavigation = createContext<((tournament?: Tournament) => void) | null>(null);
export function SeasonClosureAccess({tournament}: {tournament?: Tournament}) {
  const open = useContext(SeasonClosureNavigation);
  return open ? <button type="button" className="small-action" onClick={() => open(tournament)}>Revisar cierre de temporada</button> : null;
}

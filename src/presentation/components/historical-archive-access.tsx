import {createContext, useContext} from "react";
export const HistoricalArchiveNavigation = createContext<(() => void) | null>(null);
export function HistoricalArchiveAccess() {
  const open = useContext(HistoricalArchiveNavigation);
  return open ? <button type="button" className="small-action" onClick={open}>Archivo histórico</button> : null;
}

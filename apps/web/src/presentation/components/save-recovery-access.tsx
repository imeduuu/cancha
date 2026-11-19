import { createContext, useContext } from "react";
import type { CheckpointService } from "../../infrastructure/persistence/checkpoint-service";

export interface SaveRecoveryRequest { id: number; name: string }
export const SaveRecoveryNavigation = createContext<{
  service: CheckpointService;
  open: (suggestedName?: string) => void;
  request: SaveRecoveryRequest | null;
  acknowledge: () => void;
  returnToOrigin?: () => void;
} | null>(null);

export function SaveRecoveryAccess({suggestedName, label = "Centro de guardado y recuperación"}: {suggestedName?: string; label?: string}) {
  const navigation = useContext(SaveRecoveryNavigation);
  return navigation ? <button type="button" className="small-action" onClick={() => navigation.open(suggestedName)}>{label}</button> : null;
}

import {createContext,useContext} from "react";
import type {Tournament} from "@cancha/core/domain/entities/tournament";
export const DrawCenterNavigation=createContext<((t?:Tournament)=>void)|null>(null);
export function DrawCenterAccess({tournament}:{tournament?:Tournament}){
  const open=useContext(DrawCenterNavigation);
  return open?<button type="button" className="small-action" onClick={()=>open(tournament)}>Sorteos, grupos y cruces</button>:null;
}

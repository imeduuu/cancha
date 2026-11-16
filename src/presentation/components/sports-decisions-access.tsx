import {createContext,useContext} from "react";
import type {Tournament} from "../../domain/entities/tournament";
export const SportsDecisionsNavigation=createContext<((t?:Tournament)=>void)|null>(null);
export function SportsDecisionsAccess({tournament}:{tournament?:Tournament}){
 const open=useContext(SportsDecisionsNavigation);
 return open?<button type="button" className="small-action" onClick={()=>open(tournament)}>Decisiones deportivas</button>:null;
}

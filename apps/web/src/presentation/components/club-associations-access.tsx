import {createContext,useContext} from "react";
import type {Tournament} from "@cancha/core/domain/entities/tournament";
export const ClubAssociationsNavigation=createContext<{universeId:string|null;open:(t?:Tournament,teamId?:string)=>void}|null>(null);
export function ClubAssociationsAccess({tournament,teamId}:{tournament?:Tournament;teamId?:string}){
  const navigation=useContext(ClubAssociationsNavigation);
  return navigation?<button type="button" className="small-action" onClick={()=>navigation.open(tournament,teamId)}>Asociaciones y afiliaciones</button>:null;
}

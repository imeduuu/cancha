import {lazy} from "react";
import type {Tournament} from "@cancha/core/domain/entities/tournament";
import type {ActivityEvent} from "@cancha/core/domain/entities/activity-event";
import {useSessionDraft} from "../session-drafts";
import {DeferredPanel} from "./deferred-panel";
const Panel=lazy(()=>import("./club-history-panel").then(module=>({default:module.ClubHistoryPanel})));
export function ClubHistoryAccess(props:{tournaments:readonly Tournament[];activity:readonly ActivityEvent[];onOpen:(t:Tournament)=>void;contextKey?:string;initialClub?:string;initiallyOpen?:boolean}){
 const contextKey=props.contextKey ?? "club-history";
 const [open,setOpen]=useSessionDraft(`${contextKey}:open`,props.initiallyOpen ?? false);
 return <><button className="small-action" type="button" aria-expanded={open} onClick={()=>setOpen(!open)}>Historial deportivo de clubes</button>
   {open && <DeferredPanel fallback={<p role="status">Cargando historial de clubes…</p>}><Panel {...props} contextKey={contextKey}/></DeferredPanel>}
 </>;
}

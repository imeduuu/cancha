import {lazy, useEffect} from "react";
import {useSessionDraft} from "../session-drafts";
import {DeferredPanel} from "./deferred-panel";
import type {PlanningCenterProps} from "./season-planning-center";
const Panel=lazy(()=>import("./season-planning-center").then(m=>({default:m.SeasonPlanningCenter})));
export function SeasonPlanningAccess(props:PlanningCenterProps & {contextKey?:string;openRequest?:number}){
 const [open,setOpen]=useSessionDraft(props.contextKey ?? "season-planning-open",false);
 useEffect(()=>{if(props.openRequest)setOpen(true)},[props.openRequest,setOpen]);
 return <><button type="button" className="small-action" aria-expanded={open} onClick={()=>setOpen(!open)}>Planificación de temporadas</button>{open && <DeferredPanel fallback={<p role="status">Cargando planificación…</p>}><Panel {...props}/></DeferredPanel>}</>;
}

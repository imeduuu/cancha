import {lazy} from "react";
import {useSessionDraft} from "../session-drafts";
import {DeferredPanel} from "./deferred-panel";
import type {PerformanceProps} from "./club-performance-panel";
const Panel=lazy(()=>import("./club-performance-panel").then(m=>({default:m.ClubPerformancePanel})));
export function ClubPerformanceAccess(props:PerformanceProps){
 const [open,setOpen]=useSessionDraft(`${props.contextKey}:open`,false);
 return <><button className="small-action" type="button" aria-expanded={open} onClick={()=>setOpen(!open)}>Rendimiento deportivo de clubes</button>{open && <DeferredPanel fallback={<p role="status">Cargando rendimiento…</p>}><Panel {...props}/></DeferredPanel>}</>;
}

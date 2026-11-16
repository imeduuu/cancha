import {lazy} from "react";
import type {Tournament} from "../../domain/entities/tournament";
import type {ActivityEvent} from "../../domain/entities/activity-event";
import {useSessionDraft} from "../session-drafts";
import {DeferredPanel} from "./deferred-panel";
const Panel=lazy(()=>import("./club-honours-panel").then(m=>({default:m.HistoricalRecordsPanel})));
export function HistoricalRecordsAccess(props:{tournaments:readonly Tournament[];activity:readonly ActivityEvent[];onOpen:(t:Tournament)=>void;contextKey?:string}){
 const contextKey=props.contextKey ?? "historical-records";
 const [open,setOpen]=useSessionDraft(`${contextKey}:open`,false);
 return <><button type="button" className="small-action" aria-expanded={open} onClick={()=>setOpen(!open)}>Palmarés y récords históricos</button>{open && <DeferredPanel fallback={<p role="status">Cargando récords…</p>}><Panel {...props} contextKey={contextKey}/></DeferredPanel>}</>;
}

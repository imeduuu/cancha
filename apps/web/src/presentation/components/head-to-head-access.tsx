import {lazy} from "react";
import {useSessionDraft} from "../session-drafts";
import {DeferredPanel} from "./deferred-panel";
import type {HeadToHeadProps} from "./head-to-head-panel";
const Panel=lazy(()=>import("./head-to-head-panel").then(m=>({default:m.HeadToHeadPanel})));
export function HeadToHeadAccess(props:HeadToHeadProps & {initiallyOpen?:boolean}){
 const [open,setOpen]=useSessionDraft(`${props.contextKey}:open`,props.initiallyOpen ?? false);
 return <><button className="small-action" type="button" aria-expanded={open} onClick={()=>setOpen(!open)}>Enfrentamientos directos (H2H)</button>
 {open && <DeferredPanel fallback={<p role="status">Cargando enfrentamientos…</p>}><Panel {...props}/></DeferredPanel>}</>;
}

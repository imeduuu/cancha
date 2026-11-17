import { lazy, useEffect, useState } from "react";
import type { ContinentalPanelProps } from "./continental-qualification-panel";
import { DeferredPanel } from "./deferred-panel";
const Panel=lazy(() => import("./continental-qualification-panel").then(module => ({default:module.ContinentalQualificationPanel})));
export function ContinentalQualificationAccess(props: ContinentalPanelProps & {openRequest?:number}) {
  const [open,setOpen]=useState(Boolean(props.openRequest));
  useEffect(()=>{if(props.openRequest)setOpen(true)},[props.openRequest]);
  return <details open={open} onToggle={e => setOpen(e.currentTarget.open)}><summary>Clasificación internacional y ediciones continentales</summary>
    {open && <DeferredPanel fallback={<p role="status">Cargando clasificación internacional…</p>}><Panel {...props}/></DeferredPanel>}
  </details>;
}

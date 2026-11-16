// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { lazy,useState } from "react";
import { cleanup,render,screen,fireEvent } from "@testing-library/react";
import { afterEach,describe,it,expect,vi } from "vitest";
import { DeferredPanel } from "./deferred-panel";
const expectedError = (event: ErrorEvent) => { if (event.error?.message === "Failed to fetch dynamically imported module") event.preventDefault(); };
afterEach(()=>{cleanup();vi.restoreAllMocks();window.removeEventListener("error",expectedError);});
describe("DeferredPanel",()=>{
 it("communicates a rejected module without losing edits in another panel",async()=>{
  window.addEventListener("error",expectedError);
  vi.spyOn(console,"error").mockImplementation(()=>{});
  let fail!: (error:Error)=>void;
  const Loading=lazy(()=>new Promise<{default:()=>JSX.Element}>((_,reject)=>{fail=reject;}));
  function Workspace(){const [text,setText]=useState("");return <><label>Edición local<input value={text} onChange={e=>setText(e.target.value)}/></label><DeferredPanel fallback={<p role="status">Cargando panel</p>}><Loading/></DeferredPanel></>;}
  render(<Workspace/>);fireEvent.change(screen.getByLabelText("Edición local"),{target:{value:"Dato sin guardar"}});
  expect(screen.getByRole("status")).toHaveTextContent("Cargando panel");
  fail(new Error("Failed to fetch dynamically imported module"));
  expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo abrir este panel");
  expect(screen.getByLabelText("Edición local")).toHaveValue("Dato sin guardar");
  expect(screen.getByRole("button",{name:"Recargar la aplicación"})).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("abre una pestaña vacía desde el navegador");
 });
 it("replaces the loading message with the resolved module",async()=>{
  let finish!: (module:{default:()=>JSX.Element})=>void;
  const Loading=lazy(()=>new Promise<{default:()=>JSX.Element}>(resolve=>{finish=resolve;}));
  render(<DeferredPanel fallback={<p role="status">Cargando panel</p>}><Loading/></DeferredPanel>);
  finish({default:()=> <h2>Panel disponible</h2>});
  expect(await screen.findByRole("heading",{name:"Panel disponible"})).toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
 });
 it("recovers in a fresh application mount when the module becomes available",async()=>{
   window.addEventListener("error",expectedError);vi.spyOn(console,"error").mockImplementation(()=>{});
   const Failed=lazy(async()=>{throw new Error("Failed to fetch dynamically imported module");});
   const failed=render(<DeferredPanel fallback={<p role="status">Cargando panel</p>}><Failed/></DeferredPanel>);
   expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo abrir este panel");
   failed.unmount();
   // A browser reload creates fresh lazy modules; jsdom models that lifecycle explicitly.
   const Available=lazy(async()=>({default:()=> <h2>Panel recuperado</h2>}));
   render(<DeferredPanel fallback={<p role="status">Cargando panel</p>}><Available/></DeferredPanel>);
   expect(await screen.findByRole("heading",{name:"Panel recuperado"})).toBeInTheDocument();
   expect(screen.queryByRole("alert")).not.toBeInTheDocument();
 });

});

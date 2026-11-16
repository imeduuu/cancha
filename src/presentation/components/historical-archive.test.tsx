// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {afterEach,it,expect,vi} from "vitest";
import {act,cleanup,render,screen,fireEvent,within} from "@testing-library/react";
import {HistoricalArchive} from "./historical-archive";
import {closureLeague,closureCup} from "../../test-utils/season-closure-fixtures";
import {emptySportsUniverseLibrary} from "../../application/services/sports-universes";
import type {Tournament} from "../../domain/entities/tournament";
afterEach(()=>cleanup());
function setup(tournaments:Tournament[]=[closureLeague()]) {
  const data={tournaments,activity:[],library:emptySportsUniverseLibrary()};
  const actions={onOpen:vi.fn(),onCalendar:vi.fn(),onClosure:vi.fn(),onPlanning:vi.fn(),onQualification:vi.fn(),onCompetitions:vi.fn(),onClose:vi.fn()};
  render(<HistoricalArchive read={()=>data} {...actions}/>);return {data,actions};
}
it("offers combined accessible filters, yearbooks and native historical queries",()=>{
  const t={...closureLeague(),competitionId:"anfp-liga-primera"};setup([t,{...closureCup(),name:"Other cup"}]);
  expect(screen.getByRole("heading",{name:"Archivo histórico"})).toHaveFocus();
  fireEvent.change(screen.getByRole("combobox",{name:"País"}),{target:{value:"Chile"}});
  fireEvent.change(screen.getByRole("searchbox",{name:"Buscar clubes y competiciones"}),{target:{value:"Alfa"}});
  expect(screen.getByRole("article",{name:`Ficha histórica de ${t.name}`})).toBeInTheDocument();
  expect(screen.queryByRole("article",{name:"Ficha histórica de Other cup"})).not.toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Historial deportivo de clubes"})).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Palmarés y récords históricos"})).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Rendimiento deportivo de clubes"})).toBeInTheDocument();
});
it("navigates to existing sources without creating an editor or confirming anything",()=>{
  const t=closureLeague(),{actions}=setup([t]),card=screen.getByRole("article",{name:`Ficha histórica de ${t.name}`});
  for(const [name,handler] of [["Abrir temporada original",actions.onOpen],["Calendario",actions.onCalendar],["Revisar cierre",actions.onClosure],["Clasificación internacional",actions.onQualification],["Planificación de temporadas",actions.onPlanning]] as const){fireEvent.click(within(card).getByRole("button",{name}));expect(handler).toHaveBeenCalledWith(t);}
  expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();expect(screen.queryByRole("button",{name:"Confirmar cierre deportivo"})).not.toBeInTheDocument();
});
it("external result edits refresh the projection without retaining the former champion",()=>{
  const t=closureLeague(),{data}=setup([t]);expect(screen.getByText("Campeón: Alfa")).toBeInTheDocument();
  data.tournaments=[{...t,matchdays:[]}];fireEvent(window,new StorageEvent("storage",{key:"cancha.tournaments"}));
  expect(screen.queryByText("Campeón: Alfa")).not.toBeInTheDocument();expect(screen.getByText("Sin calendario",{selector:"p"})).toBeInTheDocument();
});
it("changing universes discards incompatible filters, identities and query panels",()=>{
  const a=closureLeague("a"),b={...closureLeague("b"),name:"Other world"},{data}=setup([a,b]);
  data.library={version:1,activeUniverseId:"u",universes:[{id:"u",name:"First"},{id:"v",name:"Second"}],assignments:{a:"u",b:"v"}};
  fireEvent(window,new StorageEvent("storage",{key:"cancha.sportsUniverses"}));
  fireEvent.change(screen.getByRole("searchbox"),{target:{value:a.name}});
  data.library={...data.library,activeUniverseId:"v"};fireEvent(window,new StorageEvent("storage",{key:"cancha.sportsUniverses"}));
  expect(screen.getByRole("searchbox")).toHaveValue("");expect(screen.getByText("Other world",{selector:"h4"})).toBeInTheDocument();
  expect(screen.queryByText(a.name,{selector:"h4"})).not.toBeInTheDocument();
});
it("a participant opens the existing club history with the exact registered identity",async()=>{
  const t=closureLeague();setup([t,{...closureLeague("homonym"),name:"Other season"}]);
  const card=screen.getByRole("article",{name:`Ficha histórica de ${t.name}`});
  fireEvent.click(within(card).getByText(`Clasificación, fases y decisiones de ${t.name}`));
  await act(async()=>{fireEvent.click(within(card).getByRole("button",{name:"Ver historial de Alfa"}));await import("./club-history-panel");});
  const panel=await screen.findByRole("region",{name:"Historial deportivo de clubes"});
  expect(within(panel).getByRole("combobox",{name:"Club registrado"})).toHaveValue(JSON.stringify([t.id,t.teams[0].id]));
});

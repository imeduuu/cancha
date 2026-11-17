// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {act,cleanup,fireEvent,screen,within} from "@testing-library/react";
import {App} from "./app";
import {renderApplication} from "../test-utils/render-application";
import {installTestWebLocks} from "../test-utils/web-locks";
import {drawCup,drawGroups} from "@cancha/core/test-utils/stage-draw-fixtures";
import {LocalStorageTournamentRepository} from "../infrastructure/persistence/local-storage-tournament-repository";
import {libraryStorageSnapshot} from "../infrastructure/persistence/library-write-lock";
beforeEach(()=>{localStorage.clear();installTestWebLocks();});afterEach(()=>{cleanup();vi.restoreAllMocks();});
async function open(){await act(async()=>{fireEvent.click(document.getElementById("open-draw-center")!);await import("./components/draw-and-bracket-center");});return screen.findByRole("region",{name:"Centro de sorteos y cruces"});}
it("requires separate explicit draw and calendar confirmations, preserving reviewed pairs",async()=>{
  const t=drawCup(),repo=new LocalStorageTournamentRepository(false);repo.save(t);await renderApplication(<App/>);const before=libraryStorageSnapshot(),center=await open();
  expect(libraryStorageSnapshot()).toEqual(before);fireEvent.click(within(center).getByRole("button",{name:"Revisar Semifinal"}));
  for(const [name,id] of [["Local o local de ida · Cruce 1",t.teams[0].id],["Visitante o local de vuelta · Cruce 1",t.teams[1].id],["Local o local de ida · Cruce 2",t.teams[2].id],["Visitante o local de vuelta · Cruce 2",t.teams[3].id]])fireEvent.change(within(center).getByRole("combobox",{name}),{target:{value:id}});
  fireEvent.click(within(center).getByRole("button",{name:"Revisar distribución y cruces"}));expect(libraryStorageSnapshot()).toEqual(before);
  fireEvent.click(within(center).getByRole("button",{name:"Confirmar distribución y cruces"}));await within(center).findByText(/Distribución confirmada\./);
  expect(repo.findAll()[0].matchdays.flatMap(d=>d.fixtures)).toEqual([]);expect(repo.findActivity().filter(e=>e.action==="stage-draw-confirmed")).toHaveLength(1);
  const afterDraw=libraryStorageSnapshot();fireEvent.click(within(center).getByRole("button",{name:"Revisar creación de encuentros"}));expect(libraryStorageSnapshot()).toEqual(afterDraw);
  fireEvent.click(within(center).getByRole("button",{name:"Confirmar creación de encuentros"}));await within(center).findByText(/Encuentros creados\./);
  expect(repo.findAll()[0].matchdays[0].fixtures).toHaveLength(2);expect(repo.findAll()[0].matchdays[0].fixtures[0].homeTeamId).toBe(t.teams[0].id);expect(repo.findAll()[0].matchdays.flatMap(d=>d.fixtures).every(f=>!f.result)).toBe(true);
});
it("manual groups preserve registered capacities and expose the existing calendar navigation",async()=>{
  const t=drawGroups(),repo=new LocalStorageTournamentRepository(false);repo.save(t);await renderApplication(<App/>);const center=await open();
  fireEvent.click(within(center).getByRole("button",{name:"Revisar Grupos registrados"}));
  fireEvent.change(within(center).getByRole("combobox",{name:`Grupo de ${t.teams[1].name}`}),{target:{value:"B"}});fireEvent.change(within(center).getByRole("combobox",{name:`Grupo de ${t.teams[2].name}`}),{target:{value:"A"}});
  fireEvent.click(within(center).getByRole("button",{name:"Revisar distribución y cruces"}));fireEvent.click(within(center).getByRole("button",{name:"Confirmar distribución y cruces"}));await within(center).findByText(/Distribución confirmada\./);
  expect(repo.findAll()[0].teams[2].groupName).toBe("A");expect(repo.findAll()[0].matchdays).toEqual([]);
  await act(async()=>{fireEvent.click(within(center).getByRole("button",{name:"Abrir calendario"}));await import("./components/match-calendar");});
  await screen.findByRole("region",{name:`Calendario de ${t.name}`});
});
it("scopes participants and activity to the active universe and keeps random drawing blocked",async()=>{
  const a=drawCup(),b={...drawGroups(),name:"Hidden universe groups"},repo=new LocalStorageTournamentRepository(false);repo.importTournaments([a,b],"replace",[],false,{version:1,activeUniverseId:"u",universes:[{id:"u",name:"One"},{id:"v",name:"Two"}],assignments:{[a.id]:"u",[b.id]:"v"}});
  await renderApplication(<App/>);const center=await open();expect(within(center).queryByRole("option",{name:/Hidden universe/})).not.toBeInTheDocument();expect(within(center).getByRole("button",{name:"Sorteo aleatorio no disponible"})).toBeDisabled();expect(repo.findActivity().filter(e=>e.action==="stage-draw-confirmed")).toEqual([]);
});

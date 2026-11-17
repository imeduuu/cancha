// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { App } from "./app";
import { renderApplication } from "../test-utils/render-application";
import { installTestWebLocks } from "../test-utils/web-locks";
import { closureLeague } from "@cancha/core/test-utils/season-closure-fixtures";
import { LocalStorageTournamentRepository } from "../infrastructure/persistence/local-storage-tournament-repository";

beforeEach(() => {localStorage.clear();installTestWebLocks();});
afterEach(() => {cleanup();vi.restoreAllMocks();});
async function open() {
  fireEvent.click(screen.getByRole("button",{name:"Centro de cierre"}));
  return screen.findByRole("region",{name:"Centro de cierre de temporadas"});
}
it("reviews without writing, confirms only explicitly and navigates to the existing planning flow", async () => {
  const repo = new LocalStorageTournamentRepository(false);repo.save(closureLeague());
  await renderApplication(<App/>);const tournaments = JSON.stringify(repo.findAll()), activity = JSON.stringify(repo.findActivity());
  const center = await open();expect(within(center).getByText(/Lista para revisión final/)).toBeInTheDocument();
  expect(JSON.stringify(repo.findActivity())).toBe(activity);
  fireEvent.click(within(center).getByRole("button",{name:"Revisar cierre deportivo"}));
  expect(JSON.stringify(repo.findActivity())).toBe(activity);expect(JSON.stringify(repo.findAll())).toBe(tournaments);
  fireEvent.click(within(center).getByRole("button",{name:"Confirmar cierre deportivo"}));
  await within(center).findByText(/Estado: Cierre confirmado/);
  expect(JSON.stringify(repo.findAll())).toBe(tournaments);
  expect(repo.findActivity().filter(e=>e.action==="season-closure-confirmed")).toHaveLength(1);
  fireEvent.click(within(center).getByRole("button",{name:"Preparar siguiente edición en planificación"}));
  await screen.findByRole("region",{name:"Centro de planificación de temporadas"});
  expect(JSON.stringify(repo.findAll())).toBe(tournaments);
  fireEvent.click(screen.getByRole("button",{name:"Planificación de temporadas"}));
  fireEvent.click(screen.getByRole("button",{name:"Crear torneo"}));
  fireEvent.click(screen.getByRole("button",{name:"Biblioteca"}));
  await screen.findByRole("heading",{name:"Biblioteca de torneos"});
  expect(screen.queryByRole("region",{name:"Centro de planificación de temporadas"})).not.toBeInTheDocument();
});
it("a result edited later marks the closure stale, retains history and permits the existing editor", async () => {
  const repo = new LocalStorageTournamentRepository(false);repo.save(closureLeague());
  await renderApplication(<App/>);const center = await open();
  fireEvent.click(within(center).getByRole("button",{name:"Revisar cierre deportivo"}));fireEvent.click(within(center).getByRole("button",{name:"Confirmar cierre deportivo"}));
  await within(center).findByText(/Estado: Cierre confirmado/);
  const t = repo.findAll()[0];repo.save({...t,matchdays:t.matchdays.map((day,index)=>index?day:{...day,fixtures:day.fixtures.map(f=>({...f,result:{homeGoals:6,awayGoals:1}}))})});
  fireEvent(window,new StorageEvent("storage",{key:"cancha.tournaments"}));
  await within(center).findByText(/Estado: Cierre desactualizado/);
  expect(repo.findActivity().filter(e=>e.action==="season-closure-confirmed")).toHaveLength(1);
  fireEvent.click(within(center).getByRole("button",{name:"Abrir edición de temporada"}));
  await screen.findByRole("heading",{name:"Liga nacional de prueba"});
  expect(screen.queryByRole("region",{name:"Centro de cierre de temporadas"})).not.toBeInTheDocument();
});
it("scopes the selector and confirmation to the active universe", async () => {
  const one=closureLeague("one"),two={...closureLeague("two"),name:"Other universe"};
  const repo=new LocalStorageTournamentRepository(false);
  repo.importTournaments([one,two],"replace",[],false,{version:1,activeUniverseId:"u1",universes:[{id:"u1",name:"First game"},{id:"u2",name:"Second game"}],assignments:{one:"u1",two:"u2"}});
  await renderApplication(<App/>);const center=await open();
  expect(within(center).queryByRole("option",{name:/Other universe/})).not.toBeInTheDocument();
  fireEvent.click(within(center).getByRole("button",{name:"Revisar cierre deportivo"}));fireEvent.click(within(center).getByRole("button",{name:"Confirmar cierre deportivo"}));
  await waitFor(()=>expect(repo.findActivity().filter(e=>e.action==="season-closure-confirmed")).toHaveLength(1));
  expect(repo.findAll().find(t=>t.id==="two")).toEqual(two);
  expect(repo.findActivity().find(e=>e.action==="season-closure-confirmed")?.universeId).toBe("u1");
});

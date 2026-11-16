// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {afterEach,beforeEach,it,expect,vi} from "vitest";
import {act,cleanup,fireEvent,screen,within} from "@testing-library/react";
import {App} from "./app";
import {renderApplication} from "../test-utils/render-application";
import {installTestWebLocks} from "../test-utils/web-locks";
import {closureLeague} from "../test-utils/season-closure-fixtures";
import {LocalStorageTournamentRepository} from "../infrastructure/persistence/local-storage-tournament-repository";
import {libraryStorageSnapshot} from "../infrastructure/persistence/library-write-lock";
beforeEach(()=>{localStorage.clear();installTestWebLocks();});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
async function open(){
  await act(async()=>{fireEvent.click(document.getElementById("open-historical-archive")!);await import("./components/historical-archive");});
  return screen.findByRole("region",{name:"Archivo histórico del universo"});
}
it("reads and filters the legacy archive without sports writes, and opens the original calendar",async()=>{
  const t=closureLeague(),repo=new LocalStorageTournamentRepository(false);repo.save(t);repo.setActiveTournamentId(t.id);
  await renderApplication(<App/>);const before=libraryStorageSnapshot(),archive=await open();
  expect(within(archive).getByRole("region",{name:"Anuario 2026"})).toBeInTheDocument();
  fireEvent.change(within(archive).getByRole("searchbox"),{target:{value:"Alfa"}});expect(libraryStorageSnapshot()).toEqual(before);
  const card=within(archive).getByRole("article",{name:`Ficha histórica de ${t.name}`});
  // Synchronize the real lazy module with React; loading latency is covered by the existing browser journeys.
  await act(async()=>{fireEvent.click(within(card).getByRole("button",{name:"Calendario"}));await import("./components/match-calendar");});
  await screen.findByRole("region",{name:`Calendario de ${t.name}`});expect(libraryStorageSnapshot()).toEqual(before);
});
it("opens closure and existing international planning from the archive without creating records",async()=>{
  const t=closureLeague(),repo=new LocalStorageTournamentRepository(false);repo.save(t);await renderApplication(<App/>);const before=libraryStorageSnapshot();
  let archive=await open(),card=within(archive).getByRole("article",{name:`Ficha histórica de ${t.name}`});
  fireEvent.click(within(card).getByRole("button",{name:"Revisar cierre"}));await screen.findByRole("region",{name:"Centro de cierre de temporadas"});expect(libraryStorageSnapshot()).toEqual(before);
  archive=await open();card=within(archive).getByRole("article",{name:`Ficha histórica de ${t.name}`});
  fireEvent.click(within(card).getByRole("button",{name:"Planificación de temporadas"}));await screen.findByRole("region",{name:"Centro de planificación de temporadas"});expect(libraryStorageSnapshot()).toEqual(before);
});
it("provides library access and scopes its archive to the current universe",async()=>{
  const one=closureLeague("one"),two={...closureLeague("two"),name:"Hidden rival universe"},repo=new LocalStorageTournamentRepository(false);
  repo.importTournaments([one,two],"replace",[],false,{version:1,activeUniverseId:"u",universes:[{id:"u",name:"First"},{id:"v",name:"Second"}],assignments:{one:"u",two:"v"}});
  await renderApplication(<App/>);const archive=await open();expect(within(archive).queryByText(/Hidden rival universe/)).not.toBeInTheDocument();
  fireEvent.click(within(archive).getByRole("button",{name:"Centro de competiciones"}));await screen.findByRole("heading",{name:"Centro de competiciones y temporadas"});
  expect(screen.getAllByRole("button",{name:"Archivo histórico"}).length).toBeGreaterThan(1);
});

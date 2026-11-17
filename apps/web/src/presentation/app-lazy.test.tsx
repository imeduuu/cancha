import { renderApplication } from "../test-utils/render-application";
import { installTestWebLocks } from "../test-utils/web-locks";
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup,screen,within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { App } from "./app";
import { loadOfficialLeagueSource } from "../infrastructure/external-services/load-official-league-source";
vi.mock("../infrastructure/external-services/load-official-league-source",()=>({loadOfficialLeagueSource:vi.fn(),publishedSeasonSource:{fetchPublishedSeason:vi.fn()}}));
beforeEach(()=>{
  installTestWebLocks();localStorage.clear();vi.clearAllMocks();});
afterEach(cleanup);
describe("application deferred screens",()=>{
 it("starts in the library, loads the import screen on navigation and imports only on request",async()=>{
   const fetchSeason=vi.fn(async()=>({id:"demo-import-2026",name:"Importación de prueba",season:2026,sourceUrl:"https://espn.com/",
     teams:[{name:"Club A"},{name:"Club B"}],matchdays:[{number:1,matches:[{id:"demo-match",homeTeamName:"Club A",awayTeamName:"Club B"}]}]}));
   vi.mocked(loadOfficialLeagueSource).mockResolvedValue({fetchSeason});
   const user=userEvent.setup();await renderApplication(<App/>);
   expect(await screen.findByRole("heading",{name:"Biblioteca de torneos"})).toBeInTheDocument();
   expect(loadOfficialLeagueSource).not.toHaveBeenCalled();
   await user.click(await screen.findByRole("button",{name:"Crear o importar torneo"}));
   const importer=await screen.findByRole("region",{name:"Importar campeonatos"});
   expect(loadOfficialLeagueSource).not.toHaveBeenCalled();
   await user.click(within(importer).getByRole("button",{name:"Argentina"}));
   const card=within(importer).getByRole("heading",{name:"Primera Nacional Argentina 2026"}).closest("article")!;
   await user.click(within(card).getByRole("button",{name:"Importar / actualizar"}));
   expect(await screen.findByRole("heading",{name:"Importación de prueba 2026"})).toBeInTheDocument();
   expect(loadOfficialLeagueSource).toHaveBeenCalledWith("argentina-nacional");
   expect(fetchSeason).toHaveBeenCalledWith("argentina-nacional",undefined);
   expect(await screen.findByRole("group",{name:"Club A contra Club B"})).toBeInTheDocument();
   expect(await screen.findByRole("region",{name:"Estadísticas del campeonato"})).toBeInTheDocument();
   await user.click(screen.getByRole("button",{name:"Biblioteca"}));
   expect(await screen.findByRole("heading",{name:"Biblioteca de torneos"})).toBeInTheDocument();
 });
});

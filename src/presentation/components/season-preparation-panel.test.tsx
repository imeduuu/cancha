// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup,render,screen,fireEvent,waitFor } from "@testing-library/react";
import { afterEach,describe,it,expect,vi } from "vitest";
import type { Tournament } from "../../domain/entities/tournament";
import { SeasonPreparationPanel } from "./season-preparation-panel";
import { memoryRepository } from "../../test-utils/official-resolution-fixtures";
afterEach(cleanup);
const t: Tournament={id:"future",competitionId:"brasileirao-serie-b",season:2027,name:"B 2027",teams:[{id:"a",name:"Club A"},{id:"b",name:"Club B"}],legs:1,tieBreakers:[],matchdays:[],createdAt:"2026-01-01T00:00:00Z",format:"staged"};
describe("SeasonPreparationPanel",()=>{
 it("shows discrepancies and requires review plus a reason before updating",async()=>{
   const repository=memoryRepository(t),onChange=vi.fn();
   const source={fetchPublishedSeason:vi.fn(async()=>({id:"brasileirao-serie-b-2027",name:"B 2027",season:2027,sourceUrl:"https://espn.com/calendar",teams:[{name:"Club A"},{name:"Club C"}],format:"staged" as const,
     matchdays:[{number:1,matches:[{id:"new",homeTeamName:"Club A",awayTeamName:"Club C"}]}]}))};
   render(<SeasonPreparationPanel tournament={t} repository={repository} source={source} onChange={onChange}/>);
   fireEvent.click(screen.getByRole("button",{name:"Consultar calendario publicado en ESPN"}));
   const button=await screen.findByRole("button",{name:"Incorporar calendario conservando resultados locales"});
   expect(button).toBeDisabled();expect(repository.save).not.toHaveBeenCalled();
   fireEvent.click(screen.getByRole("checkbox"));expect(button).toBeDisabled();
   fireEvent.change(screen.getByLabelText("Justificación documental de las diferencias"),{target:{value:"Acta CBF de prueba: corrección de nómina"}});
   expect(button).toBeEnabled();fireEvent.click(button);await waitFor(()=>expect(onChange).toHaveBeenCalledOnce());
   expect(repository.save).toHaveBeenCalledOnce();
 });
 it("does not render annual editing for historical 2026",()=>{
   render(<SeasonPreparationPanel tournament={{...t,season:2026}} repository={memoryRepository(t)} source={{fetchPublishedSeason:vi.fn()}} onChange={vi.fn()}/>);
   expect(screen.queryByRole("heading",{name:/Calendario y reglamento/})).not.toBeInTheDocument();
 });
});

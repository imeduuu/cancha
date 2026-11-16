// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {afterEach,it,expect} from "vitest";
import {cleanup,fireEvent,render,screen,within} from "@testing-library/react";
import {DrawConfigurationEditor} from "./draw-configuration-editor";
import {drawGroups} from "../../test-utils/stage-draw-fixtures";
import {LocalStorageTournamentRepository} from "../../infrastructure/persistence/local-storage-tournament-repository";
afterEach(()=>{cleanup();localStorage.clear();});
it("previews without writes, requires confirmation and rejects exceeded capacity",async()=>{
  const t=drawGroups(),repo=new LocalStorageTournamentRepository(false);repo.save(t);
  render(<DrawConfigurationEditor tournament={t} repository={repo} universeId={null} getUniverseId={()=>null} onChanged={()=>{}}/>);
  fireEvent.click(screen.getByRole("button",{name:"Configurar bombos y restricciones"}));
  fireEvent.change(screen.getByRole("combobox",{name:"Procedencia"}),{target:{value:"documented"}});
  fireEvent.change(screen.getByRole("textbox",{name:"URL HTTPS de las restricciones"}),{target:{value:"http://example.org/incomplete"}});
  fireEvent.change(screen.getByRole("combobox",{name:"Procedencia"}),{target:{value:"local"}});
  fireEvent.click(screen.getByRole("button",{name:"Crear bombo"}));
  for(const team of t.teams)fireEvent.change(screen.getByRole("combobox",{name:`Bombo de ${team.name}`}),{target:{value:(screen.getAllByRole("option").find(o=>o.textContent==="Bombo 1") as HTMLOptionElement).value}});
  fireEvent.click(screen.getByRole("button",{name:"Revisar bombos y restricciones"}));expect(screen.queryByRole("region",{name:"Vista previa de bombos"})).not.toBeInTheDocument();expect(repo.findActivity()).toEqual([]);
  fireEvent.change(screen.getByRole("spinbutton",{name:"Capacidad de Bombo 1"}),{target:{value:"4"}});
  const before=localStorage.getItem("cancha.activity");fireEvent.click(screen.getByRole("button",{name:"Revisar bombos y restricciones"}));
  const preview=screen.getByRole("region",{name:"Vista previa de bombos"});expect(localStorage.getItem("cancha.activity")).toBe(before);
  fireEvent.click(within(preview).getByRole("button",{name:"Confirmar bombos y restricciones"}));await screen.findByText(/Configuración registrada\. Se conservaron/);
  expect(repo.findActivity()).toHaveLength(1);expect(repo.findAll()[0]).toEqual(t);
});

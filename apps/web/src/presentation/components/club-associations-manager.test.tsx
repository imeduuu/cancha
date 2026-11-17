// @vitest-environment jsdom
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,within} from "@testing-library/react";
import {ClubAssociationsManager} from "./club-associations-manager";
import {ClubHistoryPanel} from "./club-history-panel";
import {ClubAssociationCatalog} from "./club-association-catalog";
import {generatorScenario} from "@cancha/core/test-utils/group-generator-fixtures";
import {clubAssociationScenario} from "@cancha/core/test-utils/club-association-fixtures";
import {clubOccurrenceKey} from "@cancha/core/application/services/club-history";
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it("registers an association through a pure preview and explicit confirmation",async()=>{
  const s=generatorScenario(),before=JSON.stringify(s.state);render(<ClubAssociationsManager tournament={s.t} repository={s.repository} universeId={null} getUniverseId={()=>null} onChanged={()=>{}} onClose={()=>{}}/>);
  expect(JSON.stringify(s.state)).toBe(before);fireEvent.click(screen.getByRole("button",{name:"Registrar asociación"}));fireEvent.change(screen.getByRole("textbox",{name:"Nombre de la asociación"}),{target:{value:"Organización ficticia"}});fireEvent.click(screen.getByRole("button",{name:"Revisar registro de asociación o afiliación"}));
  expect(screen.getByRole("region",{name:"Vista previa de asociación o afiliación"})).toBeInTheDocument();expect(JSON.stringify(s.state)).toBe(before);
  fireEvent.click(screen.getByRole("button",{name:"Confirmar registro de asociación o afiliación"}));await screen.findByText(/Registro confirmado\. Se conservaron/);expect(s.state.activity.at(-1)?.action).toBe("association-recorded");expect(s.state.tournaments[0]).toEqual(s.t);
});
it("requires an explicit check before marking documentary data verified",async()=>{
  const s=generatorScenario();render(<ClubAssociationsManager tournament={s.t} repository={s.repository} universeId={null} getUniverseId={()=>null} onChanged={()=>{}} onClose={()=>{}}/>);
  fireEvent.click(screen.getByRole("button",{name:"Registrar asociación"}));fireEvent.change(screen.getByRole("textbox",{name:"Nombre de la asociación"}),{target:{value:"Asociación ficticia"}});fireEvent.change(screen.getByRole("combobox",{name:"Procedencia de la asociación"}),{target:{value:"documented"}});
  fireEvent.change(screen.getByRole("textbox",{name:"URL HTTPS de la asociación"}),{target:{value:"https://example.org/association"}});fireEvent.change(screen.getByRole("textbox",{name:"Referencia de la asociación"}),{target:{value:"Fuente ficticia"}});fireEvent.change(screen.getByRole("combobox",{name:"Estado documental de la asociación"}),{target:{value:"verified"}});
  fireEvent.click(screen.getByRole("button",{name:"Revisar registro de asociación o afiliación"}));expect(screen.queryByRole("region",{name:"Vista previa de asociación o afiliación"})).not.toBeInTheDocument();expect(s.state.activity).toHaveLength(1);
  fireEvent.click(screen.getByRole("checkbox",{name:/Contrasté los documentos/}));fireEvent.click(screen.getByRole("button",{name:"Revisar registro de asociación o afiliación"}));expect(screen.getByRole("region",{name:"Vista previa de asociación o afiliación"})).toBeInTheDocument();
});
it("corrects an affiliation without changing its participant or historical season",async()=>{
  const s=clubAssociationScenario();render(<ClubAssociationsManager tournament={s.t} repository={s.repository} universeId={null} getUniverseId={()=>null} initialTeamId={s.ids[0]} onChanged={()=>{}} onClose={()=>{}}/>);
  fireEvent.click(screen.getByRole("button",{name:"Registrar o revisar afiliación de temporada"}));fireEvent.change(screen.getByRole("combobox",{name:"Estado de la relación"}),{target:{value:"unknown"}});fireEvent.change(screen.getByRole("combobox",{name:"Procedencia de la afiliación"}),{target:{value:"local"}});
  const before=JSON.stringify(s.state.tournaments);fireEvent.click(screen.getByRole("button",{name:"Revisar registro de asociación o afiliación"}));fireEvent.click(screen.getByRole("button",{name:"Confirmar registro de asociación o afiliación"}));await screen.findByText(/Registro confirmado\. Se conservaron/);expect(JSON.stringify(s.state.tournaments)).toBe(before);
  const summary=screen.getByRole("region",{name:"Afiliación de Participante 1 en 2026"});expect(within(summary).getByText(/2026 .* Desconocida/,{selector:"p"})).toBeInTheDocument();expect(within(summary).getByText("Historial de afiliaciones de esta aparición (2)")).toBeInTheDocument();
});
it("shows verified and unknown appearances separately in the existing club history without writes",()=>{
  const s=clubAssociationScenario(),next={...s.t,id:"future",season:2027};s.state.tournaments.push(next);const before=JSON.stringify(s.state);
  render(<ClubHistoryPanel tournaments={s.state.tournaments} activity={s.state.activity} onOpen={()=>{}}/>);fireEvent.change(screen.getByRole("combobox",{name:"Club registrado"}),{target:{value:clubOccurrenceKey(s.t.id,s.ids[0])}});
  expect(screen.getByRole("region",{name:"Afiliación de Participante 1 en 2026"})).toHaveTextContent("Verificada por el usuario");expect(screen.getByRole("region",{name:"Afiliación de Participante 1 en 2027"})).toHaveTextContent("Desconocida");expect(JSON.stringify(s.state)).toBe(before);
});
it("keeps the catalog readable without a current tournament or a replacement club database",()=>{const s=clubAssociationScenario(),before=JSON.stringify(s.state);render(<ClubAssociationCatalog activity={s.state.activity} universeId={null}/>);expect(screen.getByRole("region",{name:"Catálogo de asociaciones del universo"})).toHaveTextContent("Asociación ficticia A");expect(JSON.stringify(s.state)).toBe(before);});

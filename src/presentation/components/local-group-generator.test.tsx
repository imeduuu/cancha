// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {afterEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {LocalGroupGenerator} from "./local-group-generator";
import {generatorScenario} from "../../test-utils/group-generator-fixtures";
afterEach(()=>{cleanup();vi.restoreAllMocks();});
function setup(unique=false,teams=4,groups=2){
  const s=generatorScenario(teams,groups),onReview=vi.fn();
  if(unique)s.configuration.restrictions=s.ids.map((id,i)=>({id:`fixed-${i}`,type:"fixed-position",teamId:id,group:i<2?"G1":"G2",position:i%2+1}));
  const props={tournament:s.t,stage:s.input.stage,universeId:null,universeName:"Principal",getUniverseId:()=>null,repository:s.repository,disabled:false,onReview};
  return {...s,props,onReview};
}
it("does not search on open; checks, generates and reviews without writes",async()=>{
  const s=setup(),before=JSON.stringify(s.state);render(<LocalGroupGenerator {...s.props}/>);
  expect(screen.queryByText(/Viabilidad:/)).not.toBeInTheDocument();expect(JSON.stringify(s.state)).toBe(before);
  fireEvent.click(screen.getByRole("button",{name:"Comprobar viabilidad"}));await screen.findByText("Viabilidad: Viable");expect(screen.queryByRole("region",{name:"Propuesta local de grupos"})).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox",{name:"Semilla de generación local"}),{target:{value:"keyboard-seed"}});
  fireEvent.click(screen.getByRole("button",{name:"Generar distribución local"}));await screen.findByRole("region",{name:"Propuesta local de grupos"});
  expect(JSON.stringify(s.state)).toBe(before);fireEvent.click(screen.getByRole("button",{name:"Revisar distribución"}));expect(s.onReview).toHaveBeenCalledOnce();expect(s.onReview.mock.calls[0][0].record.generation.seed).toBe("keyboard-seed");expect(JSON.stringify(s.state)).toBe(before);
});
it("reports an identical repeated proposal honestly and locks controls during a pending review",async()=>{
  const s=setup(true),view=render(<LocalGroupGenerator {...s.props}/>);
  fireEvent.click(screen.getByRole("button",{name:"Generar distribución local"}));await screen.findByRole("region",{name:"Propuesta local de grupos"});
  fireEvent.click(screen.getByRole("button",{name:"Generar otra propuesta"}));await screen.findByText(/El resultado coincide/);
  view.rerender(<LocalGroupGenerator {...s.props} disabled/>);expect(screen.getByRole("button",{name:"Generar otra propuesta"})).toBeDisabled();expect(screen.getByRole("textbox",{name:"Semilla de generación local"})).toBeDisabled();
});
it("discards a proposal when the library changes without starting a search",async()=>{
  const s=setup(),view=render(<LocalGroupGenerator {...s.props}/>);
  fireEvent.click(screen.getByRole("button",{name:"Generar distribución local"}));await screen.findByRole("region",{name:"Propuesta local de grupos"});
  s.state.tournaments=[{...s.t,name:"Cambio externo"}];view.rerender(<LocalGroupGenerator {...s.props}/>);
  await waitFor(()=>expect(screen.queryByRole("region",{name:"Propuesta local de grupos"})).not.toBeInTheDocument());expect(screen.getByRole("button",{name:"Generar distribución local"})).toBeDisabled();expect(s.state.activity).toHaveLength(1);
});
it("cancels in-flight work when another distribution review becomes pending",async()=>{
  const s=setup(false,64,8),before=JSON.stringify(s.state),view=render(<LocalGroupGenerator {...s.props}/>);
  fireEvent.click(screen.getByRole("button",{name:"Generar distribución local"}));
  view.rerender(<LocalGroupGenerator {...s.props} disabled/>);
  await waitFor(()=>expect(screen.queryByText(/Búsqueda en curso/)).not.toBeInTheDocument());
  expect(screen.queryByRole("region",{name:"Propuesta local de grupos"})).not.toBeInTheDocument();expect(JSON.stringify(s.state)).toBe(before);
});

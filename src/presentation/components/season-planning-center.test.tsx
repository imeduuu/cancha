// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {it,expect,vi,afterEach,beforeAll} from "vitest";
import {render,screen,fireEvent,cleanup,within} from "@testing-library/react";
import {SeasonPlanningCenter} from "./season-planning-center";
import {SessionDraftProvider} from "../session-drafts";
import {continentalLeague} from "../../test-utils/continental-qualification-fixtures";
import type {Tournament} from "../../domain/entities/tournament";
import type {ActivityEvent} from "../../domain/entities/activity-event";
import type {TournamentRepository} from "../../application/ports/tournament-repository";
import {reviewSeasonPlanning,confirmSeasonPlanning} from "../../application/use-cases/plan-season";
const source=continentalLeague();
beforeAll(()=>{HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");};});
afterEach(cleanup);
function memory(){const data=[source],activity:ActivityEvent[]=[];const repo:TournamentRepository={findAll:()=>data,findActivity:()=>activity,save:vi.fn(t=>{const i=data.findIndex(s=>s.id===t.id);if(i<0)data.push(t);else data[i]=t;}),saveWithActivity(t,e){repo.save(t);activity.push(e);}};return {repo,data,activity};}
function props(m:ReturnType<typeof memory>){return {tournaments:m.data as readonly Tournament[],activity:m.activity,onOpen:vi.fn(),onCalendar:vi.fn(),onAlerts:vi.fn(),onProgramCalendar:vi.fn(),onReviewPlanning:vi.fn(input=>reviewSeasonPlanning(input,m.repo)),onConfirmPlanning:vi.fn(review=>confirmSeasonPlanning(review,m.repo,true))};}
function select(){fireEvent.change(screen.getByLabelText("Competición de planificación"),{target:{value:source.competitionId}});fireEvent.change(screen.getByLabelText("Temporada de origen de planificación"),{target:{value:source.id}});fireEvent.change(screen.getByLabelText("Año o edición de destino"),{target:{value:"2027"}});fireEvent.click(screen.getByLabelText(/Propongo expresamente/));}
it("previews without writing and creates only after the existing confirmation dialog",()=>{
 const m=memory(),p=props(m);render(<SessionDraftProvider><SeasonPlanningCenter {...p}/></SessionDraftProvider>);select();expect(within(screen.getByRole("region",{name:"Vista previa de temporada"})).getByText(/4 participantes seleccionados/)).toBeVisible();expect(m.repo.save).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"Revisar planificación y continuar"}));expect(screen.getByRole("dialog",{name:"Confirmar planificación local"})).toBeVisible();expect(m.repo.save).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"Confirmar preparación"}));expect(m.data).toHaveLength(2);expect(m.data[1].matchdays).toEqual([]);expect(p.onConfirmPlanning).toHaveBeenCalledTimes(1);
});
it("preserves the planning form during navigation without retaining an unconfirmed write",()=>{
 const m=memory(),p=props(m);const {rerender}=render(<SessionDraftProvider><SeasonPlanningCenter {...p}/></SessionDraftProvider>);select();rerender(<SessionDraftProvider><p>Otra vista</p></SessionDraftProvider>);rerender(<SessionDraftProvider><SeasonPlanningCenter {...p}/></SessionDraftProvider>);expect(screen.getByLabelText("Año o edición de destino")).toHaveValue(2027);expect(screen.getByLabelText(/Propongo expresamente/)).toBeChecked();expect(m.repo.save).not.toHaveBeenCalled();
});
it("blocks confirming a stale preview after current props and dependencies change",()=>{
 const m=memory(),p=props(m);const {rerender}=render(<SessionDraftProvider><SeasonPlanningCenter {...p}/></SessionDraftProvider>);select();fireEvent.click(screen.getByRole("button",{name:"Revisar planificación y continuar"}));m.data[0]={...source,name:"Origen cambiado"};rerender(<SessionDraftProvider><SeasonPlanningCenter {...p} tournaments={[...m.data]}/></SessionDraftProvider>);expect(screen.getAllByText(/Dependencia desactualizada/).length).toBeGreaterThan(0);fireEvent.click(screen.getByRole("button",{name:"Confirmar preparación"}));expect(p.onConfirmPlanning).not.toHaveBeenCalled();expect(screen.getByRole("alert")).toHaveTextContent("desactualizada");expect(m.data).toHaveLength(1);
});
it("keeps undocumented national cup future participants pending and offers no creation",()=>{
 const m=memory(),p=props(m),cup={...source,competitionType:"cup" as const};render(<SeasonPlanningCenter {...p} tournaments={[cup]}/>);select();expect(screen.getByRole("button",{name:"Revisar planificación y continuar"})).toBeDisabled();expect(within(screen.getByRole("list",{name:"Participantes previstos"})).queryAllByRole("listitem")).toHaveLength(0);
});
it("opens a valid source using the existing navigation callbacks",()=>{
 const m=memory(),p=props(m);render(<SeasonPlanningCenter {...p}/>);select();fireEvent.click(screen.getAllByRole("button",{name:`Abrir origen: ${source.name}`})[0]);expect(p.onOpen).toHaveBeenCalledWith(source);fireEvent.click(screen.getAllByRole("button",{name:`Calendario: ${source.name}`})[0]);expect(p.onCalendar).toHaveBeenCalledWith(source);
});
it("opens the calendar programming center from season planning",()=>{
 const m=memory(),p=props(m);render(<SessionDraftProvider><SeasonPlanningCenter {...p}/></SessionDraftProvider>);
 fireEvent.click(screen.getByRole("button",{name:"Abrir Centro de programación de calendarios"}));
 expect(p.onProgramCalendar).toHaveBeenCalledOnce();
});

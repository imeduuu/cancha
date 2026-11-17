// @vitest-environment jsdom
import {afterEach,it,expect,vi} from "vitest";
import {cleanup,render,screen,fireEvent,within} from "@testing-library/react";
import {ClubHistoryPanel} from "./club-history-panel";
import {SessionDraftProvider} from "../session-drafts";
import {buildClubProfiles} from "@cancha/core/application/services/club-history";
import {continentalLeague} from "@cancha/core/test-utils/continental-qualification-fixtures";
const source=continentalLeague();const next={...source,id:"next",season:2027,competitionRules:{...source.competitionRules!,season:2027}};
const key=buildClubProfiles([source,next]).find(p=>p.teamIds.includes(source.teams[0].id))!.key;
afterEach(cleanup);
it("selects a club, accumulates explicit seasons and opens an original tournament",()=>{
 const open=vi.fn();render(<ClubHistoryPanel tournaments={[source,next]} activity={[]} onOpen={open}/>);
 fireEvent.change(screen.getByLabelText("Club registrado"),{target:{value:key}});
 const totals=screen.getByRole("region",{name:"Estadísticas acumuladas del club"});expect(within(totals).getByText(/no se suman torneos automáticamente/)).toBeVisible();
 screen.getAllByRole("checkbox").forEach(box=>fireEvent.click(box));expect(within(totals).getByText(/6 PJ · 6 G/)).toBeVisible();
 fireEvent.click(screen.getAllByRole("button",{name:"Abrir torneo de origen"})[0]);expect(open).toHaveBeenCalledWith(source);
});
it("preserves club selection and accumulated sources across session navigation",()=>{
 const props={tournaments:[source,next],activity:[],onOpen:vi.fn()};const {rerender}=render(<SessionDraftProvider><ClubHistoryPanel {...props}/></SessionDraftProvider>);
 fireEvent.change(screen.getByLabelText("Club registrado"),{target:{value:key}});fireEvent.click(screen.getAllByRole("checkbox")[0]);
 rerender(<SessionDraftProvider><p>Otra vista</p></SessionDraftProvider>);rerender(<SessionDraftProvider><ClubHistoryPanel {...props}/></SessionDraftProvider>);
 expect(screen.getByLabelText("Club registrado")).toHaveValue(key);expect(screen.getAllByRole("checkbox")[0]).toBeChecked();
});
it("does not reuse club drafts when the same local IDs belong to another universe",()=>{
 const first={...source,id:"universe-a-season"};
 const second={...next,id:"universe-b-season",teams:next.teams.map(team=>({...team,name:`Otro ${team.name}`}))};
 const firstProfile=buildClubProfiles([first]).find(profile=>profile.teamIds.includes(first.teams[0].id));
 const firstKey=firstProfile!.key;
 const {rerender}=render(<SessionDraftProvider><ClubHistoryPanel contextKey="universe-a" tournaments={[first]} activity={[]} onOpen={vi.fn()}/></SessionDraftProvider>);
 fireEvent.change(screen.getByLabelText("Club registrado"),{target:{value:firstKey}});
 expect(screen.getByRole("heading",{name:firstProfile!.names[firstProfile!.names.length-1]})).toBeVisible();
 rerender(<SessionDraftProvider><ClubHistoryPanel contextKey="universe-b" tournaments={[second]} activity={[]} onOpen={vi.fn()}/></SessionDraftProvider>);
 expect(screen.getByLabelText("Club registrado")).toHaveValue("");
 expect(screen.queryByRole("heading",{name:firstProfile!.names[firstProfile!.names.length-1]})).not.toBeInTheDocument();
});
it("updates derived totals after results change and warns when a selected source disappears",()=>{
 const open=vi.fn();const {rerender}=render(<SessionDraftProvider><ClubHistoryPanel tournaments={[source,next]} activity={[]} onOpen={open}/></SessionDraftProvider>);
 fireEvent.change(screen.getByLabelText("Club registrado"),{target:{value:key}});screen.getAllByRole("checkbox").forEach(box=>fireEvent.click(box));
 const modified={...source,matchdays:source.matchdays.map(d=>({...d,fixtures:d.fixtures.map(f=>({...f,result:{homeGoals:0,awayGoals:0}}))}))};
 rerender(<SessionDraftProvider><ClubHistoryPanel tournaments={[modified,next]} activity={[]} onOpen={open}/></SessionDraftProvider>);
 expect(within(screen.getByRole("region",{name:"Estadísticas acumuladas del club"})).getByText(/12 puntos/)).toBeVisible();
 rerender(<SessionDraftProvider><ClubHistoryPanel tournaments={[modified]} activity={[]} onOpen={open}/></SessionDraftProvider>);
 expect(screen.getByRole("alert")).toHaveTextContent("ya no están disponibles");fireEvent.click(screen.getByRole("button",{name:"Limpiar selección acumulada"}));expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
it("shows equally named clubs as separate selectable identities",()=>{
 render(<ClubHistoryPanel tournaments={[source,continentalLeague("other")]} activity={[]} onOpen={vi.fn()}/>);
 expect(screen.getByLabelText("Club registrado").querySelectorAll("option")).toHaveLength(9);
 fireEvent.change(screen.getByLabelText("Club registrado"),{target:{value:buildClubProfiles([source])[0].key}});
 expect(screen.getByText(/Hay otros registros con el mismo nombre/)).toBeVisible();
});

it("distinguishes ambiguous profiles with the same name and ID by their source tournament",()=>{
 const a={...source,teams:source.teams.map(team=>({...team,averageIdentity:`first-${team.id}`}))};
 const b={...next,teams:next.teams.map(team=>({...team,averageIdentity:`second-${team.id}`}))};
 render(<ClubHistoryPanel tournaments={[a,b]} activity={[]} onOpen={vi.fn()}/>);
 const labels=Array.from(screen.getByLabelText("Club registrado").querySelectorAll("option"),option=>option.textContent);
 expect(new Set(labels).size).toBe(labels.length);
});

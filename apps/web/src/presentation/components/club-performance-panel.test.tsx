import type {ActivityEvent} from "@cancha/core/domain/entities/activity-event";
// @vitest-environment jsdom
import {it,expect,afterEach,vi} from "vitest";
import {render,screen,fireEvent,within,cleanup} from "@testing-library/react";
import {ClubPerformancePanel} from "./club-performance-panel";
import {ClubHistoryPanel} from "./club-history-panel";
import {SessionDraftProvider} from "../session-drafts";
import {continentalLeague} from "@cancha/core/test-utils/continental-qualification-fixtures";
import {buildClubProfiles} from "@cancha/core/application/services/club-history";
const a=continentalLeague(),b={...a,id:"next",season:2027,competitionRules:{...a.competitionRules!,season:2027}},profile=buildClubProfiles([a,b]).find(p=>p.teamIds.includes(a.teams[0].id))!;
const props={tournaments:[a,b],activity:[],onOpen:vi.fn(),contextKey:"test-performance",label:"Prueba",initialClub:profile.key};
function select(){fireEvent.change(screen.getByLabelText("Competición para rendimiento"),{target:{value:a.competitionId}});const scope=screen.getByLabelText("Temporada y fase de rendimiento") as HTMLSelectElement;fireEvent.change(scope,{target:{value:scope.options[1].value}});}
afterEach(cleanup);
it("shows accessible metrics and charts and opens the actual source",()=>{
 const open=vi.fn();render(<ClubPerformancePanel {...props} onOpen={open}/>);select();expect(screen.getByText(/Promedio de goles a favor por partido: 2,00/)).toBeVisible();expect(screen.getByRole("figure",{name:"Resultados generales de Alfa"})).toBeVisible();expect(screen.getByRole("columnheader",{name:"GF/PJ"})).toBeVisible();fireEvent.click(screen.getByRole("button",{name:"Abrir origen del rendimiento"}));expect(open).toHaveBeenCalledWith(a);
});
it("compares general performance and plots explicit evolution without auto selection",()=>{
 render(<ClubPerformancePanel {...props}/>);select();expect(screen.queryByRole("region",{name:"Evolución entre temporadas"})).not.toBeInTheDocument();
 const other=buildClubProfiles([a,b]).find(p=>p.teamIds.includes(a.teams[1].id))!;fireEvent.change(screen.getByLabelText("Segundo club para comparar rendimiento"),{target:{value:other.key}});
 expect(screen.getByRole("region",{name:"Comparación de rendimiento general"})).toBeVisible();screen.getAllByRole("checkbox").forEach(box=>fireEvent.click(box));expect(screen.getByRole("region",{name:"Evolución entre temporadas"})).toBeVisible();
});
it("preserves choices while navigating and updates when saved scores change",()=>{
 const {rerender}=render(<SessionDraftProvider><ClubPerformancePanel {...props}/></SessionDraftProvider>);select();fireEvent.click(screen.getAllByRole("checkbox")[0]);rerender(<SessionDraftProvider><p>Otra vista</p></SessionDraftProvider>);rerender(<SessionDraftProvider><ClubPerformancePanel {...props}/></SessionDraftProvider>);expect(screen.getAllByRole("checkbox")[0]).toBeChecked();
 const changed={...a,matchdays:a.matchdays.map(d=>({...d,fixtures:d.fixtures.map(f=>({...f,result:{homeGoals:0,awayGoals:0}}))}))};rerender(<SessionDraftProvider><ClubPerformancePanel {...props} tournaments={[changed,b]}/></SessionDraftProvider>);expect(screen.getByText(/Promedio de goles a favor por partido: 0,00/)).toBeVisible();
});
it("warns if a selected evolution source disappears",()=>{
 const {rerender}=render(<SessionDraftProvider><ClubPerformancePanel {...props}/></SessionDraftProvider>);select();screen.getAllByRole("checkbox").forEach(box=>fireEvent.click(box));rerender(<SessionDraftProvider><ClubPerformancePanel {...props} tournaments={[a]}/></SessionDraftProvider>);expect(screen.getByRole("alert")).toHaveTextContent("ya no está disponible");
});
it("opens from the existing club history with the selected identity",async()=>{
 render(<SessionDraftProvider><ClubHistoryPanel tournaments={[a]} activity={[]} onOpen={vi.fn()}/></SessionDraftProvider>);const p=buildClubProfiles([a]).find(p=>p.teamIds.includes(a.teams[0].id))!;fireEvent.change(screen.getByLabelText("Club registrado"),{target:{value:p.key}});fireEvent.click(screen.getByRole("button",{name:"Rendimiento deportivo de clubes"}));const panel=await screen.findByRole("region",{name:"Rendimiento deportivo · Perfil de club"});expect(within(panel).getByLabelText("Club para rendimiento")).toHaveValue(p.key);
});

it("labels local scenarios inside evolution charts even without an opened season card",()=>{
 const events:ActivityEvent[]=[a,b].map(t=>({id:"sim-"+t.id,tournamentId:t.id,tournamentName:t.name,occurredAt:t.createdAt,action:"matches-simulated",summary:"Synthetic simulation"}));
 render(<ClubPerformancePanel {...props} activity={events}/>);fireEvent.change(screen.getByLabelText("Competición para rendimiento"),{target:{value:a.competitionId}});screen.getAllByRole("checkbox").forEach(box=>fireEvent.click(box));
 expect(within(screen.getByRole("region",{name:"Evolución entre temporadas"})).getAllByText(/Escenario local, editado o simulado/).length).toBeGreaterThan(0);
});

it("distinguishes equal club names in comparison series with their registered IDs",()=>{
 const sameNames={...a,teams:a.teams.map((team,i)=>i===1?{...team,name:a.teams[0].name}:team)};
 render(<ClubPerformancePanel {...props} tournaments={[sameNames]}/>);select();const p=buildClubProfiles([sameNames]).find(p=>p.teamIds.includes(a.teams[1].id))!;fireEvent.change(screen.getByLabelText("Segundo club para comparar rendimiento"),{target:{value:p.key}});
 const comparison=within(screen.getByRole("region",{name:"Comparación de rendimiento general"}));expect(comparison.getAllByText(new RegExp(`ID ${a.teams[0].id}`)).length).toBeGreaterThan(0);expect(comparison.getAllByText(new RegExp(`ID ${a.teams[1].id}`)).length).toBeGreaterThan(0);
});

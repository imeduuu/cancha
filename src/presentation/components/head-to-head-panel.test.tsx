// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {afterEach,it,expect,vi} from "vitest";
import {cleanup,render,screen,fireEvent,within} from "@testing-library/react";
import {HeadToHeadPanel} from "./head-to-head-panel";
import {ClubHistoryPanel} from "./club-history-panel";
import {SessionDraftProvider} from "../session-drafts";
import {buildClubProfiles} from "../../application/services/club-history";
import {continentalLeague} from "../../test-utils/continental-qualification-fixtures";
const t=continentalLeague(),n={...t,id:"h2h-next",season:2027,competitionRules:{...t.competitionRules!,season:2027}};
const profiles=buildClubProfiles([t,n]),a=profiles.find(p=>p.teamIds.includes(t.teams[0].id))!,b=profiles.find(p=>p.teamIds.includes(t.teams[1].id))!;
const props={tournaments:[t,n],activity:[],onOpen:vi.fn(),contextKey:"test-h2h",label:"Prueba",initialA:a.key,initialB:b.key};
afterEach(cleanup);
it("accumulates only explicit sources and opens an original meeting",()=>{
 const open=vi.fn();render(<HeadToHeadPanel {...props} onOpen={open}/>);
 expect(screen.queryByRole("region",{name:"Acumulado H2H"})).not.toBeInTheDocument();
 screen.getAllByRole("checkbox").forEach(box=>fireEvent.click(box));
 expect(within(screen.getByRole("region",{name:"Acumulado H2H"})).getByText(/2 PJ · A: 2 victorias/)).toBeVisible();
 fireEvent.click(screen.getAllByRole("button",{name:"Abrir torneo del encuentro"})[0]);expect(open).toHaveBeenCalledWith(n);
});
it("filters local and visitor results and preserves choices across navigation",()=>{
 const {rerender}=render(<SessionDraftProvider><HeadToHeadPanel {...props}/></SessionDraftProvider>);
 screen.getAllByRole("checkbox").forEach(box=>fireEvent.click(box));fireEvent.change(screen.getByLabelText("Localía del club A"),{target:{value:"away"}});
 rerender(<SessionDraftProvider><p>Otra vista</p></SessionDraftProvider>);rerender(<SessionDraftProvider><HeadToHeadPanel {...props}/></SessionDraftProvider>);
 expect(screen.getByLabelText("Localía del club A")).toHaveValue("away");expect(screen.getByRole("region",{name:"Acumulado H2H"})).toBeVisible();
});
it("updates after scores change and rejects a missing selected source",()=>{
 const {rerender}=render(<SessionDraftProvider><HeadToHeadPanel {...props}/></SessionDraftProvider>);
 screen.getAllByRole("checkbox").forEach(box=>fireEvent.click(box));
 const changed={...t,matchdays:t.matchdays.map(d=>({...d,fixtures:d.fixtures.map(f=>({...f,result:{homeGoals:0,awayGoals:0}}))}))};
 rerender(<SessionDraftProvider><HeadToHeadPanel {...props} tournaments={[changed,n]}/></SessionDraftProvider>);
 expect(within(screen.getByRole("region",{name:"Acumulado H2H"})).getByText(/2 PJ · A: 1 victorias/)).toBeVisible();
 rerender(<SessionDraftProvider><HeadToHeadPanel {...props} tournaments={[changed]}/></SessionDraftProvider>);expect(screen.getByRole("alert")).toHaveTextContent("ya no está disponible");
});
it("shows separate same-name identities and blocks ambiguous ones",()=>{
 const other={...n,teams:t.teams.map(team=>({...team,averageIdentity:"new-"+team.id}))};const first={...t,teams:t.teams.map(team=>({...team,averageIdentity:"old-"+team.id}))};
 const ps=buildClubProfiles([first,other]);render(<HeadToHeadPanel {...props} tournaments={[first,other]} initialA={ps[0].key} initialB={ps[1].key}/>);expect(screen.getByRole("alert")).toHaveTextContent("Identidad ambigua");expect(screen.queryByRole("article")).not.toBeInTheDocument();
});
it("opens a comparison from the existing club profile with club A preselected",async()=>{
 render(<SessionDraftProvider><ClubHistoryPanel tournaments={[t]} activity={[]} onOpen={vi.fn()}/></SessionDraftProvider>);
 fireEvent.change(screen.getByLabelText("Club registrado"),{target:{value:buildClubProfiles([t]).find(p=>p.teamIds.includes(t.teams[0].id))!.key}});
 fireEvent.click(screen.getByRole("button",{name:"Enfrentamientos directos (H2H)"}));
 const panel=await screen.findByRole("region",{name:"Enfrentamientos directos (H2H) · Perfil de club"});expect(within(panel).getByLabelText("Club A")).not.toHaveValue("");
});

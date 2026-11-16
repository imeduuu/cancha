// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {afterEach,it,expect,vi} from "vitest";
import {cleanup,render,screen,fireEvent,within} from "@testing-library/react";
import {HistoricalRecordsPanel,SeasonHonours} from "./club-honours-panel";
import {ClubHistoryPanel} from "./club-history-panel";
import {buildClubProfiles} from "../../application/services/club-history";
import {SessionDraftProvider} from "../session-drafts";
import {continentalLeague} from "../../test-utils/continental-qualification-fixtures";
const t=continentalLeague(),n={...t,id:"next",season:2027,competitionRules:{...t.competitionRules!,season:2027}};
afterEach(cleanup);
it("selects years expressly, shows trophies and opens their backing season",()=>{
 const open=vi.fn();render(<HistoricalRecordsPanel tournaments={[t,n]} activity={[]} onOpen={open}/>);
 fireEvent.change(screen.getByLabelText("Competición para récords"),{target:{value:t.competitionId}});
 expect(screen.getByText(/Selecciona temporadas expresamente/)).toBeVisible();
 screen.getAllByRole("checkbox").forEach(box=>fireEvent.click(box));
 expect(screen.getByText("Alfa: 2")).toBeVisible();expect(screen.getByText(/Temporadas seleccionadas: 2/)).toBeVisible();
 fireEvent.click(screen.getAllByRole("button",{name:/Abrir respaldo/})[0]);expect(open).toHaveBeenCalledWith(n);
});
it("preserves comparison choices while navigating and recalculates changed titles",()=>{
 const props={tournaments:[t],activity:[],onOpen:vi.fn()};const {rerender}=render(<SessionDraftProvider><HistoricalRecordsPanel {...props}/></SessionDraftProvider>);
 fireEvent.change(screen.getByLabelText("Competición para récords"),{target:{value:t.competitionId}});fireEvent.click(screen.getByRole("checkbox"));
 rerender(<SessionDraftProvider><p>Otra vista</p></SessionDraftProvider>);rerender(<SessionDraftProvider><HistoricalRecordsPanel {...props}/></SessionDraftProvider>);expect(screen.getByRole("checkbox")).toBeChecked();
 const changed={...t,matchdays:[]};rerender(<SessionDraftProvider><HistoricalRecordsPanel {...props} tournaments={[changed]}/></SessionDraftProvider>);
 expect(screen.queryByText("Alfa: 1")).not.toBeInTheDocument();expect(screen.getByText(/Sin marcas elegibles/)).toBeVisible();
});
it("includes honours within the existing club identity profile",()=>{
 render(<ClubHistoryPanel tournaments={[t]} activity={[]} onOpen={vi.fn()}/>);
 const profile=buildClubProfiles([t]).find(p=>p.teamIds.includes(t.teams[0].id))!;
 fireEvent.change(screen.getByLabelText("Club registrado"),{target:{value:profile.key}});
 expect(within(screen.getByRole("region",{name:"Palmarés y récords del club"})).getByText("Campeón: Alfa")).toBeVisible();
});
it("labels incomplete season marks and explains missing streak chronology",()=>{
 render(<SeasonHonours tournament={{...t,matchdays:t.matchdays.slice(1)}}/>);
 expect(screen.queryByText("Campeón: Alfa")).not.toBeInTheDocument();expect(screen.getAllByText(/Marca parcial, no definitiva/).length).toBeGreaterThan(0);
 fireEvent.click(screen.getAllByRole("group")[0].querySelector("summary")!);
 expect(screen.getAllByText(/Rachas no disponibles/)[0]).toBeVisible();
});

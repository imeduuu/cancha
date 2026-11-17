// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {afterEach,it,expect,vi} from "vitest";
import {cleanup,render,screen,fireEvent} from "@testing-library/react";
import {ContinentalQualificationPanel} from "./continental-qualification-panel";
import {continentalLeague} from "@cancha/core/test-utils/continental-qualification-fixtures";
import {SessionDraftProvider} from "../session-drafts";
afterEach(cleanup);
it("shows provenance and keeps a documentary draft while the panel is closed",()=>{
 const t=continentalLeague();const props={tournament:t,tournaments:[t],activity:[],onOpen:vi.fn()};
 const {rerender}=render(<SessionDraftProvider><ContinentalQualificationPanel {...props}/></SessionDraftProvider>);
 expect(screen.getByText(/Alfa · Confirmado por reglas verificadas/)).toBeVisible();
 fireEvent.change(screen.getByLabelText("Referencia documental HTTPS"),{target:{value:"https://www.conmebol.com/prueba"}});
 rerender(<SessionDraftProvider><p>Otra vista</p></SessionDraftProvider>);
 rerender(<SessionDraftProvider><ContinentalQualificationPanel {...props}/></SessionDraftProvider>);
 expect(screen.getByLabelText("Referencia documental HTTPS")).toHaveValue("https://www.conmebol.com/prueba");
 expect(screen.getByText(/no certifican cupos oficiales/)).toBeVisible();
});

it("finds a national cup qualification through its exact configured league reference",()=>{
 const league=continentalLeague();const cup={...league,id:"domestic-cup",competitionId:"domestic",name:"Copa nacional",competitionRules:undefined};
 const owner={...league,competitionRules:{...league.competitionRules!,internationalQualification:{...league.competitionRules!.internationalQualification!,cupChampions:[{sourceTournamentId:cup.id,destination:"conmebol-libertadores"}]}}};
 render(<ContinentalQualificationPanel tournament={cup} tournaments={[cup,owner]} activity={[]} onOpen={vi.fn()}/>);
 expect(screen.getByText("Cupo registrado en el reglamento de:",{exact:false})).toBeVisible();
 expect(screen.getByLabelText(/Liga nacional de prueba · 2026 · national-2026/)).toBeChecked();
});

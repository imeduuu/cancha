// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { CompetitionCenter } from "./competition-center";
import type { Tournament } from "../../domain/entities/tournament";
const base: Tournament = {id:"origin", competitionId:"brasileirao-serie-a", name:"Série A",season:2026,teams:[],legs:1,tieBreakers:[],matchdays:[],createdAt:"2026-01-01T00:00:00.000Z"};
afterEach(cleanup);
it("navigates saved seasons and explicit division origins, including missing records and discrepancies", () => {
 const lower={...base,id:"lower",competitionId:"brasileirao-serie-b",name:"Série B"};
 const future: Tournament={...base,id:"future",season:2027,seasonPreparation:{schemaVersion:1,sourceTournamentIds:[base.id,lower.id,"missing"],plannedParticipants:["Alfa"],calendarReviews:[{at:base.createdAt,sourceUrl:"https://example.com/calendar",publishedParticipants:["Beta"],missing:["Alfa"],added:["Beta"],discrepancyReason:"Cambio documentado"}]}};
 const open=vi.fn(); render(<CompetitionCenter tournaments={[base,lower,future]} activity={[]} onOpen={open} onCalendar={vi.fn()} onAlerts={vi.fn()}/>);
 fireEvent.change(screen.getByLabelText("País o confederación"),{target:{value:"Brasil"}});
 fireEvent.change(screen.getByLabelText("Competición guardada"),{target:{value:base.competitionId}});
 const season=screen.getByRole("article",{name:"Temporada 2027: Série A"});
 fireEvent.click(within(season).getByRole("button",{name:"Abrir temporada"})); expect(open).toHaveBeenLastCalledWith(future);
 expect(within(season).getByText("Origen no disponible: missing")).toBeTruthy();
 expect(within(season).getByText("Cambio documentado")).toBeTruthy();
 fireEvent.click(within(season).getByRole("button",{name:"Série B · 2026"}));expect(open).toHaveBeenLastCalledWith(lower);
});

it("opens the existing planning flow when requested by the universe dashboard", async () => {
 render(<CompetitionCenter centerRequest={{kind:"planning",request:1}} tournaments={[base]} activity={[]} onOpen={vi.fn()} onCalendar={vi.fn()} onAlerts={vi.fn()}/>);
 expect(await screen.findByRole("region",{name:"Centro de planificación de temporadas"})).toBeTruthy();
});

it("opens the existing international-qualification panel from a dashboard recommendation", async () => {
 const league: Tournament = {...base, teams:[{id:"a",name:"Club A"},{id:"b",name:"Club B"}],
   competitionRules:{season:2026,verification:{standings:"pending",placements:"pending"},
     internationalQualification:{verification:"pending",slots:[]}}};
 render(<CompetitionCenter tournaments={[league]} activity={[]} onOpen={vi.fn()} onCalendar={vi.fn()} onAlerts={vi.fn()}/>);
 fireEvent.click(screen.getByRole("button",{name:"Panel principal del universo"}));
 const dashboard=screen.getByRole("region",{name:"Panel del universo deportivo"});
 const action=within(dashboard).getByText("Consultar clasificación internacional · Série A").closest("li")!;
 fireEvent.click(within(action).getByRole("button",{name:"Abrir flujo"}));
 expect(await screen.findByText(/Los estados describen el cálculo deportivo/)).toBeTruthy();
});

it("opens calendar programming from the universe dashboard", async () => {
 const onConfirmCalendarProgramming=vi.fn();
 render(<CompetitionCenter tournaments={[base]} activity={[]} onOpen={vi.fn()} onCalendar={vi.fn()} onAlerts={vi.fn()} onConfirmCalendarProgramming={onConfirmCalendarProgramming}/>);
 fireEvent.click(screen.getByRole("button",{name:"Panel principal del universo"}));
 fireEvent.click(screen.getByRole("button",{name:"Programar calendario"}));
 expect(await screen.findByRole("region",{name:"Centro de programación de calendarios"})).toBeTruthy();
 expect((screen.getByLabelText("Temporada del universo activo") as HTMLSelectElement).value).toBe(base.id);
});

it("opens programming directly from a competition center request", async () => {
 render(<CompetitionCenter centerRequest={{kind:"programming",tournamentId:base.id,request:1}} tournaments={[base]} activity={[]} onOpen={vi.fn()} onCalendar={vi.fn()} onAlerts={vi.fn()} onConfirmCalendarProgramming={vi.fn()}/>);
 expect(await screen.findByRole("region",{name:"Centro de programación de calendarios"})).toBeTruthy();
 expect((screen.getByLabelText("Temporada del universo activo") as HTMLSelectElement).value).toBe(base.id);
});

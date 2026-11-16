import {simulateFixtures} from "../../application/use-cases/simulate-fixtures";
import {projectSeasonProgression} from "../../application/services/season-progression";
// @vitest-environment jsdom
import {it,expect,vi,afterEach} from "vitest";
import {render,screen,fireEvent,cleanup,within} from "@testing-library/react";
import {SeasonProgressionPanel} from "./season-progression-panel";
import {continentalLeague} from "../../test-utils/continental-qualification-fixtures";
import {reviewSeasonPlanning,confirmSeasonPlanning} from "../../application/use-cases/plan-season";
import {LocalStorageTournamentRepository} from "../../infrastructure/persistence/local-storage-tournament-repository";
afterEach(()=>{cleanup();localStorage.clear();vi.restoreAllMocks();});
it("opens without simulation and delegates calendar, decisions and preparation navigation",()=>{
 const t=continentalLeague(),calendar=vi.fn(),open=vi.fn(),alerts=vi.fn();
 const before=JSON.stringify(t);
 render(<SeasonProgressionPanel tournaments={[t]} activity={[]} onCalendar={calendar} onOpen={open} onAlerts={alerts}/>);
 fireEvent.click(screen.getByRole("checkbox"));expect(calendar).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"Ir a simulación en calendario"}));expect(calendar).toHaveBeenCalledWith(t);
 fireEvent.click(screen.getAllByRole("button",{name:"Revisar tablas y resoluciones"})[0]);expect(alerts).toHaveBeenCalledWith(t);
 fireEvent.click(screen.getAllByRole("button",{name:"Abrir temporada y preparación"})[0]);expect(open).toHaveBeenCalledWith(t);
 expect(JSON.stringify(t)).toBe(before);
});
it("reuses confirmed creation, shows linked local seasons and keeps both intact on write failure",()=>{
 const t=continentalLeague(),repo=new LocalStorageTournamentRepository(false);repo.save(t);
 const input={sourceId:t.id,targetSeason:2027,mode:"roster" as const,carryRoster:true};
 const review=reviewSeasonPlanning(input,repo),original=Storage.prototype.setItem;
 const fail=vi.spyOn(Storage.prototype,"setItem").mockImplementation(function(this:Storage,key,value){
  if(key==="cancha.activity")throw new Error("write failure");original.call(this,key,value);
 });
 const before=JSON.stringify(repo.findAll());
 expect(()=>confirmSeasonPlanning(review,repo,true)).toThrow();
 expect(JSON.stringify(repo.findAll())).toBe(before);
 fail.mockRestore();
 const [next]=confirmSeasonPlanning(review,repo,true),open=vi.fn();
 render(<SeasonProgressionPanel tournaments={repo.findAll()} activity={repo.findActivity()} onCalendar={vi.fn()} onOpen={open} onAlerts={vi.fn()}/>);
 fireEvent.click(screen.getByRole("checkbox",{name:/2026/}));
 fireEvent.click(screen.getByRole("checkbox",{name:/2027/}));
 expect(screen.getByText(/Temporada creada con origen registrado/)).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:`${next.name} · 2027`}));expect(open).toHaveBeenCalledWith(next);
 fireEvent.click(screen.getByRole("button",{name:"Consultar actividad de las temporadas seleccionadas"}));
 expect(within(screen.getByRole("region",{name:"Historial de actividad"})).getByText(/Se creó la temporada/)).toBeTruthy();
 expect(screen.getByText(/Planificación · escenario local/)).toBeTruthy();
 expect(()=>confirmSeasonPlanning(reviewSeasonPlanning(input,repo),repo,true)).toThrow();
});

it("simulates only through an explicit existing use case and preserves scenario labels",()=>{
 const base=continentalLeague(),t={...base,matchdays:base.matchdays.map(d=>({...d,fixtures:d.fixtures.map(f=>({...f,result:undefined}))}))};
 const repo=new LocalStorageTournamentRepository(false);repo.save(t);
 expect(projectSeasonProgression([t.id],repo.findAll(),repo.findActivity()).rows[0].overview.played).toBe(0);
 expect(repo.findActivity()).toEqual([]);
 const first=t.matchdays[0].fixtures[0];
 simulateFixtures(t,[first.id],"pendingOnly",repo,()=>0.25);
 const row=projectSeasonProgression([t.id],repo.findAll(),repo.findActivity()).rows[0];
 expect(row.overview.played).toBe(1);expect(row.overview.provenance).toContain("Escenario local");
 expect(repo.findActivity().map(e=>e.action)).toContain("matches-simulated");
});

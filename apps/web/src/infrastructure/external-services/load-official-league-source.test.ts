import { afterEach,describe,expect,it,vi } from "vitest";
import { loadOfficialLeagueSource,publishedSeasonSource } from "./load-official-league-source";
import { AnfpOfficialLeagueSource } from "./anfp-official-league-source";
import { AnfaThirdDivisionSource } from "./anfa-third-division-source";
import { EspnSouthAmericanLeagueSource } from "./espn-south-american-league-source";
import { EspnContinentalCupSource } from "./espn-continental-cup-source";
import { CopaArgentinaOfficialSource,CopaDoBrasilOfficialSource } from "./south-american-cup-sources";
import type { OfficialLeagueId } from "@cancha/core/application/ports/official-league-source";
afterEach(()=>vi.restoreAllMocks());
describe("deferred official sources",()=>{
  it.each([
    ["primera",AnfpOfficialLeagueSource],["primera-b",AnfpOfficialLeagueSource],["segunda",AnfpOfficialLeagueSource],
    ["copa-chile",AnfpOfficialLeagueSource],["copa-liga",AnfpOfficialLeagueSource],
    ["tercera-a",AnfaThirdDivisionSource],["tercera-b",AnfaThirdDivisionSource],
    ["argentina-nacional",EspnSouthAmericanLeagueSource],["argentina-primera",EspnSouthAmericanLeagueSource],
    ["brasil-primera",EspnSouthAmericanLeagueSource],["brasil-serie-b",EspnSouthAmericanLeagueSource],
    ["libertadores",EspnContinentalCupSource],["sudamericana",EspnContinentalCupSource],
    ["copa-argentina",CopaArgentinaOfficialSource],["copa-brasil",CopaDoBrasilOfficialSource],
  ] as const)("loads the original provider for %s",async(league,constructor)=>{
    expect(await loadOfficialLeagueSource(league as OfficialLeagueId)).toBeInstanceOf(constructor);
  });
  it("delegates the future competition and year without changing the returned calendar",async()=>{
    const season={id:"brasileirao-serie-b-2027",season:2027,name:"B 2027",sourceUrl:"https://espn.com/",matchdays:[]};
    const fetch=vi.spyOn(EspnSouthAmericanLeagueSource.prototype,"fetchPublishedSeason").mockResolvedValue(season);
    expect(await publishedSeasonSource.fetchPublishedSeason("brasil-serie-b",2027)).toBe(season);
    expect(fetch).toHaveBeenCalledWith("brasil-serie-b",2027);
  });
  it("propagates provider errors to the existing import error handling",async()=>{
    vi.spyOn(EspnSouthAmericanLeagueSource.prototype,"fetchPublishedSeason").mockRejectedValue(new Error("Proveedor no disponible"));
    await expect(publishedSeasonSource.fetchPublishedSeason("argentina-nacional",2027)).rejects.toThrow("Proveedor no disponible");
  });
});

import type { OfficialLeagueId, OfficialLeagueSource, PublishedSeasonSource } from "../../application/ports/official-league-source";

/** Load only the provider selected by the user. Module imports are cached by the browser. */
export async function loadOfficialLeagueSource(league: OfficialLeagueId): Promise<OfficialLeagueSource> {
  if (league === "copa-argentina" || league === "copa-brasil") {
    const sources = await import("./south-american-cup-sources");
    return league === "copa-argentina" ? new sources.CopaArgentinaOfficialSource() : new sources.CopaDoBrasilOfficialSource();
  }
  if (league === "libertadores" || league === "sudamericana") {
    const { EspnContinentalCupSource } = await import("./espn-continental-cup-source");
    return new EspnContinentalCupSource();
  }
  if (league === "tercera-a" || league === "tercera-b") {
    const { AnfaThirdDivisionSource } = await import("./anfa-third-division-source");
    return new AnfaThirdDivisionSource();
  }
  if (league === "argentina-primera" || league === "brasil-primera" || league === "argentina-nacional" || league === "brasil-serie-b") {
    const { EspnSouthAmericanLeagueSource } = await import("./espn-south-american-league-source");
    return new EspnSouthAmericanLeagueSource();
  }
  const { AnfpOfficialLeagueSource } = await import("./anfp-official-league-source");
  return new AnfpOfficialLeagueSource();
}

export const publishedSeasonSource: PublishedSeasonSource = {
  async fetchPublishedSeason(league, year) {
    const { EspnSouthAmericanLeagueSource } = await import("./espn-south-american-league-source");
    return new EspnSouthAmericanLeagueSource().fetchPublishedSeason(league, year);
  },
};

import type { TournamentPlacementRules } from "../entities/tournament";

/**
 * Única definición de los puestos base de la Liga de Primera 2026 (cupos 2027).
 * La usan el importador ANFP y la actualización de reglas al leer torneos guardados.
 */
export const chileanPrimera2026PlacementRules: TournamentPlacementRules = {
  championPlaces: 1,
  libertadoresPlaces: { from: 1, to: 2 },
  libertadoresQualifyingPlaces: { from: 3, to: 3 },
  sudamericanaPlaces: { from: 4, to: 6 },
  relegationPlaces: 2,
  note: "Cupos base 2027: 1.º y 2.º de liga a Libertadores; 3.º disputa un partido único contra el campeón de Copa Chile por el cupo Chile 4, cuyo perdedor va a Sudamericana. 4.º–6.º clasifican a Sudamericana. El campeón de Copa de la Liga obtiene Chile 3. La app no calcula esos campeones, el partido por Chile 4 ni los corrimientos de cupos.",
};

export const tieBreakerOptions = [
  { value: "goalDifference", label: "Diferencia de goles" },
  { value: "goalsFor", label: "Goles a favor" },
  { value: "wins", label: "Partidos ganados" },
  { value: "awayGoals", label: "Goles de visita" },
  { value: "redCards", label: "Menor cantidad de tarjetas rojas" },
  { value: "yellowCards", label: "Menor cantidad de tarjetas amarillas" },
  { value: "competitionNumber", label: "Numeración oficial del torneo" },
  { value: "headToHeadPoints", label: "Enfrentamiento directo · puntos" },
  { value: "headToHeadGoalDifference", label: "Enfrentamiento directo · diferencia de goles" },
  { value: "headToHeadGoalsFor", label: "Enfrentamiento directo · goles a favor" },
  { value: "headToHead", label: "Enfrentamiento directo · minitabla completa (legado)" },
] as const;

export const configurableTieBreakerOptions = tieBreakerOptions.filter(
  (option) => !["awayGoals", "redCards", "yellowCards", "competitionNumber"].includes(option.value),
);

export type TieBreaker = (typeof tieBreakerOptions)[number]["value"];

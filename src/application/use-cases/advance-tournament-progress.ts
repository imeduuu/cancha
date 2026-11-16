import type { Tournament } from "../../domain/entities/tournament";
import { advanceArgentinaPlayoffProgress } from "../../domain/services/argentina-clausura-playoffs";
import { advanceContinentalCupProgression } from "../../domain/services/continental-cup-progression";
import { advanceOfficialCupProgression } from "../../domain/services/official-cup-progression";
import { advanceChileanAscensoPlayoff } from "../../domain/services/chilean-ascenso-playoff-progression";
import type { TournamentRepository } from "../ports/tournament-repository";

import { advanceSecondDivision } from "../../domain/services/second-division-progression";

export function advanceTournamentProgress(
  tournament: Tournament,
  repository?: TournamentRepository,
): Tournament {
  const advanced = advanceOfficialCupProgression(
    advanceArgentinaPlayoffProgress(advanceChileanAscensoPlayoff(advanceSecondDivision(tournament))),
  );
  if (!repository || !tournament.id.startsWith("conmebol-")) return advanced;

  if (advanced !== tournament) repository.save(advanced);
  const savedTournaments = repository.findAll();
  const knownIds = new Set(savedTournaments.map(({ id }) => id));
  const tournamentSet = knownIds.has(advanced.id)
    ? savedTournaments.map((saved) => saved.id === advanced.id ? advanced : saved)
    : [advanced, ...savedTournaments];
  const progressedTournaments = advanceContinentalCupProgression(tournamentSet);
  for (const progressed of progressedTournaments) {
    const saved = savedTournaments.find(({ id }) => id === progressed.id);
    if (!saved || JSON.stringify(saved) !== JSON.stringify(progressed)) {
      repository.save(progressed);
    }
  }
  return progressedTournaments.find(({ id }) => id === advanced.id) ?? advanced;
}

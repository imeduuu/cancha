import { describeTournamentRepositoryContract } from "@cancha/core/test-utils/tournament-repository-contract";
import {
  emptyInMemoryLibrary,
  InMemoryTournamentRepository,
  type InMemoryLibraryState,
} from "./in-memory-tournament-repository.js";

// `reopen` crea otra instancia sobre el mismo estado, como otra pestaña sobre el mismo localStorage.
let state: InMemoryLibraryState = emptyInMemoryLibrary();

describeTournamentRepositoryContract("InMemoryTournamentRepository", {
  create: () => {
    state = emptyInMemoryLibrary();
    return new InMemoryTournamentRepository(state);
  },
  reopen: () => new InMemoryTournamentRepository(state),
});

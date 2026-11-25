import { DomainError } from "../domain-error.js";
import type {
  Player,
  PlayerRegistration,
  Tournament,
} from "../entities/tournament";

export function validateTournamentPlayerData(tournament: Tournament): string | undefined {
  const players = tournament.players ?? [];
  const registrations = tournament.playerRegistrations ?? [];
  const playerIds = new Set<string>();
  for (const player of players) {
    if (!player.id.trim() || playerIds.has(player.id)) {
      return `El identificador de jugador "${player.id}" está vacío o duplicado.`;
    }
    playerIds.add(player.id);
    if (!player.firstName.trim() || !player.lastName.trim()) {
      return `El jugador "${player.id}" debe tener nombre y apellido.`;
    }
    if (player.birthDate !== undefined && !isValidDate(player.birthDate)) {
      return `La fecha de nacimiento del jugador "${player.id}" no es válida.`;
    }
  }

  const teamIds = new Set(tournament.teams.map(({ id }) => id));
  const registeredPlayerTeams = new Set<string>();
  const activeRegistrations = new Set<string>();
  const activeNumbers = new Set<string>();
  for (const registration of registrations) {
    if (!playerIds.has(registration.playerId)) {
      return `La plantilla referencia al jugador inexistente "${registration.playerId}".`;
    }
    if (!teamIds.has(registration.teamId)) {
      return `La plantilla referencia al equipo inexistente "${registration.teamId}".`;
    }
    const playerTeamKey = `${registration.playerId}:${registration.teamId}`;
    if (registeredPlayerTeams.has(playerTeamKey)) {
      return `El jugador "${registration.playerId}" tiene una pertenencia duplicada en esta temporada.`;
    }
    registeredPlayerTeams.add(playerTeamKey);
    if (registration.status !== "released") {
      if (activeRegistrations.has(registration.playerId)) {
        return `El jugador "${registration.playerId}" tiene más de una pertenencia activa en esta temporada.`;
      }
      activeRegistrations.add(registration.playerId);
    }
    if (registration.shirtNumber !== undefined
      && (!Number.isSafeInteger(registration.shirtNumber)
        || registration.shirtNumber < 1 || registration.shirtNumber > 99)) {
      return `El número de camiseta del jugador "${registration.playerId}" debe estar entre 1 y 99.`;
    }
    if (registration.status !== undefined
      && registration.status !== "active" && registration.status !== "released") {
      return `El estado de plantilla del jugador "${registration.playerId}" no es válido.`;
    }
    if (registration.shirtNumber !== undefined && registration.status !== "released") {
      const key = `${registration.teamId}:${registration.shirtNumber}`;
      if (activeNumbers.has(key)) {
        return `El número ${registration.shirtNumber} está duplicado en la plantilla del equipo.`;
      }
      activeNumbers.add(key);
    }
  }

  for (const fixture of tournament.matchdays.flatMap(({ fixtures }) => fixtures)) {
    for (const scorer of fixture.goalScorers ?? []) {
      if (scorer.playerId === undefined) continue;
      if (!playerIds.has(scorer.playerId)) {
        return `El gol referencia al jugador inexistente "${scorer.playerId}".`;
      }
      const historicalRegistration = registrations.some((registration) =>
        registration.playerId === scorer.playerId && registration.teamId === scorer.teamId);
      if (!historicalRegistration) {
        return `El jugador "${scorer.playerId}" no pertenece a ese equipo en esta temporada.`;
      }
    }
  }
  return undefined;
}

export function saveTournamentPlayer(
  tournament: Tournament,
  input: Omit<Player, "id"> & { readonly id?: string },
  createId: () => string = () => crypto.randomUUID(),
): Tournament {
  const player: Player = {
    id: input.id ?? createId(),
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    ...(input.birthDate?.trim() ? { birthDate: input.birthDate.trim() } : {}),
    ...(input.nationality?.trim() ? { nationality: input.nationality.trim() } : {}),
    ...(input.usualPosition?.trim() ? { usualPosition: input.usualPosition.trim() } : {}),
  };
  const players = [...(tournament.players ?? [])];
  const existingIndex = players.findIndex(({ id }) => id === player.id);
  if (input.id !== undefined && existingIndex < 0) {
    throw new DomainError("No se encontró el jugador que quieres editar.");
  }
  if (input.id === undefined && existingIndex >= 0) {
    throw new DomainError("Ya existe un jugador con ese identificador.");
  }
  if (existingIndex >= 0) players[existingIndex] = player;
  else players.push(player);
  const updated = { ...tournament, players };
  const error = validateTournamentPlayerData(updated);
  if (error) throw new DomainError(error);
  return updated;
}

export function registerTournamentPlayer(
  tournament: Tournament,
  playerId: string,
  teamId: string,
  shirtNumber?: number,
): Tournament {
  if (!(tournament.players ?? []).some(({ id }) => id === playerId)) {
    throw new DomainError("No se puede agregar un jugador que no está registrado en esta temporada.");
  }
  if (!tournament.teams.some(({ id }) => id === teamId)) {
    throw new DomainError("No se puede asociar el jugador a un equipo inexistente.");
  }
  if (shirtNumber !== undefined
    && (!Number.isSafeInteger(shirtNumber) || shirtNumber < 1 || shirtNumber > 99)) {
    throw new DomainError("El número de camiseta debe ser un entero entre 1 y 99.");
  }
  const registrations = [...(tournament.playerRegistrations ?? [])];
  const index = registrations.findIndex(({ playerId: id, teamId: existingTeamId }) =>
    id === playerId && existingTeamId === teamId);
  const activeRegistration = registrations.find(({ playerId: id, status }) =>
    id === playerId && status !== "released");
  if (activeRegistration && activeRegistration.teamId !== teamId) {
    throw new DomainError("El jugador ya tiene una pertenencia en esta temporada; usa la acción explícita de transferencia.");
  }
  const registration: PlayerRegistration = {
    playerId,
    teamId,
    ...(shirtNumber !== undefined ? { shirtNumber } : {}),
    status: "active",
  };
  if (index >= 0) registrations[index] = registration;
  else registrations.push(registration);
  const updated = { ...tournament, playerRegistrations: registrations };
  const error = validateTournamentPlayerData(updated);
  if (error) throw new DomainError(error);
  return updated;
}

export function transferTournamentPlayer(
  tournament: Tournament,
  playerId: string,
  teamId: string,
  shirtNumber?: number,
): Tournament {
  const current = (tournament.playerRegistrations ?? [])
    .find(({ playerId: registeredId, status }) =>
      registeredId === playerId && status !== "released");
  if (!current) return registerTournamentPlayer(tournament, playerId, teamId, shirtNumber);
  if (!tournament.teams.some(({ id }) => id === teamId)) {
    throw new DomainError("No se puede asociar el jugador a un equipo inexistente.");
  }
  if (current.teamId === teamId) {
    return registerTournamentPlayer(tournament, playerId, teamId, shirtNumber);
  }
  const registrations = (tournament.playerRegistrations ?? []).map((registration) =>
    registration.playerId === playerId && registration.status !== "released"
      ? { ...registration, status: "released" as const }
      : registration);
  const destinationIndex = registrations.findIndex((registration) =>
    registration.playerId === playerId && registration.teamId === teamId);
  const destination: PlayerRegistration = {
    playerId,
    teamId,
    ...(shirtNumber !== undefined ? { shirtNumber } : {}),
    status: "active",
  };
  if (destinationIndex >= 0) registrations[destinationIndex] = destination;
  else registrations.push(destination);
  const updated = { ...tournament, playerRegistrations: registrations };
  const error = validateTournamentPlayerData(updated);
  if (error) throw new DomainError(error);
  return updated;
}

export function releaseTournamentPlayer(
  tournament: Tournament,
  playerId: string,
): Tournament {
  const registrations = [...(tournament.playerRegistrations ?? [])];
  const index = registrations.findIndex(({ playerId: id, status }) =>
    id === playerId && status !== "released");
  if (index < 0) throw new DomainError("El jugador no pertenece a la plantilla de esta temporada.");
  registrations[index] = { ...registrations[index], status: "released" };
  return { ...tournament, playerRegistrations: registrations };
}

export function copyTournamentSquad(
  source: Tournament,
  target: Tournament,
): Tournament {
  if (target.players?.length || target.playerRegistrations?.length) {
    throw new DomainError("La plantilla de destino ya tiene datos; no se sobrescribió.");
  }
  const targetTeams = new Set(target.teams.map(({ id }) => id));
  if ((source.playerRegistrations ?? []).some(({ teamId }) => !targetTeams.has(teamId))) {
    throw new DomainError("Los equipos no coinciden entre temporadas; no se copió la plantilla.");
  }
  const copied: Tournament = {
    ...target,
    ...(source.players ? { players: source.players.map((player) => ({ ...player })) } : {}),
    ...(source.playerRegistrations
      ? { playerRegistrations: source.playerRegistrations.map((entry) => ({ ...entry })) }
      : {}),
  };
  const error = validateTournamentPlayerData(copied);
  if (error) throw new DomainError(error);
  return copied;
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

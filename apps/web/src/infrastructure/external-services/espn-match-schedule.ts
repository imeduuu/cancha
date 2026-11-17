import type { OfficialMatch } from "@cancha/core/application/ports/official-league-source";
import { isValidLocalDate } from "@cancha/core/domain/services/match-scheduling";

export function parseEspnSchedule(date: string, matchId: string): NonNullable<OfficialMatch["schedule"]> {
  const dateOnly = /^(\d{4}-\d{2}-\d{2})$/.exec(date);
  if (dateOnly && isValidLocalDate(dateOnly[1])) return { date: dateOnly[1] };

  const dateTime = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)?$/.exec(date);
  if (!dateTime || !isValidLocalDate(dateTime[1])
    || (/^[+-]14:(?!00)/.test(dateTime[4] ?? ""))) {
    throw new Error(`La API de ESPN publicó una fecha inválida para el partido ${matchId}.`);
  }
  return {
    date: dateTime[1],
    time: `${dateTime[2]}:${dateTime[3]}`,
    ...(dateTime[4] ? { utcOffset: dateTime[4] } : {}),
  };
}


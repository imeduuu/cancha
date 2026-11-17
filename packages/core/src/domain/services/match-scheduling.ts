import type { MatchSchedule } from "../entities/tournament";

export function validateMatchSchedule(value: unknown): string | undefined {
  if (!isRecord(value)) return "La programación del partido no tiene un formato válido.";
  const allowedFields = new Set(["date", "time", "utcOffset", "venue", "logisticsNotes", "provenance"]);
  if (Object.keys(value).length === 0
    || Object.keys(value).some((key) => !allowedFields.has(key))
    || !Object.values(value).some((field) => field !== undefined)) {
    return "La programación debe incluir al menos un dato reconocido.";
  }

  if (value.date !== undefined && !isValidLocalDate(value.date)) {
    return "La fecha debe existir y usar el formato AAAA-MM-DD.";
  }
  if (value.time !== undefined
    && (typeof value.time !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.time))) {
    return "La hora debe usar el formato local de 24 horas HH:mm.";
  }
  if (value.utcOffset !== undefined
    && (typeof value.utcOffset !== "string"
      || !/^(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value.utcOffset)
      || (/^[+-]14:(?!00)/.test(value.utcOffset)))) {
    return "La zona horaria debe usar Z o un desfase UTC válido ±HH:mm.";
  }
  if (value.venue !== undefined
    && (typeof value.venue !== "string" || value.venue.trim().length === 0 || value.venue.length > 120)) {
    return "El estadio debe tener entre 1 y 120 caracteres si se especifica.";
  }
  if (value.logisticsNotes !== undefined
    && (typeof value.logisticsNotes !== "string"
      || value.logisticsNotes.trim().length === 0
      || value.logisticsNotes.length > 500)) {
    return "La observación logística debe tener entre 1 y 500 caracteres si se especifica.";
  }
  if (value.provenance !== undefined
    && value.provenance !== "official-import"
    && value.provenance !== "local-generated"
    && value.provenance !== "manual") {
    return "La procedencia de la programación no es válida.";
  }
  return undefined;
}

export function isValidLocalDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

export function createMatchSchedule(
  input: {
    date: string;
    time: string;
    venue: string;
    logisticsNotes: string;
  },
): MatchSchedule | null {
  const schedule: MatchSchedule = {
    ...(input.date ? { date: input.date } : {}),
    ...(input.time ? { time: input.time } : {}),
    ...(input.venue.trim() ? { venue: input.venue.trim() } : {}),
    ...(input.logisticsNotes.trim() ? { logisticsNotes: input.logisticsNotes.trim() } : {}),
  };
  return Object.keys(schedule).length > 0 ? schedule : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

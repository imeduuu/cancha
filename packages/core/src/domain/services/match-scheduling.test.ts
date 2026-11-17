import { describe, expect, it } from "vitest";
import { createMatchSchedule, isValidLocalDate, validateMatchSchedule } from "./match-scheduling";

describe("match scheduling", () => {
  it("accepts a real local date and 24-hour time without converting either value", () => {
    const schedule = createMatchSchedule({
      date: "2026-10-14",
      time: "21:42",
      venue: "Estadio Central",
      logisticsNotes: "Ingreso por el acceso norte",
    });

    expect(schedule).toEqual({
      date: "2026-10-14",
      time: "21:42",
      venue: "Estadio Central",
      logisticsNotes: "Ingreso por el acceso norte",
    });
    expect(validateMatchSchedule(schedule)).toBeUndefined();
    expect(isValidLocalDate("2026-10-14")).toBe(true);
  });

  it.each([
    {},
    { kickoff: "2026-10-14T20:00:00" },
    { date: "2026-02-30" },
    { date: "14-10-2026" },
    { time: "24:00" },
    { time: "9:30" },
    { utcOffset: "+14:30" },
    { venue: "  " },
    { logisticsNotes: "x".repeat(501) },
  ])("rejects invalid schedule values: %o", (partial) => {
    expect(validateMatchSchedule(partial)).toBeDefined();
  });
});

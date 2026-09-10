import { describe, expect, it } from "vitest";
import {
  EASTERN_TIMEZONE,
  formatContestClock,
  formatContestTime,
  formatInChicago,
  formatInEastern,
  parseChicagoDateTimeLocal,
  RANKIQ_TIMEZONE,
  toChicagoDateTimeLocal,
  zonedLocalToUtc,
} from "@/lib/timing/chicago";

describe("RankEyeQ timezone display + persist", () => {
  it("maps Week 1 Sunday 10:00 AM Central to 2026-09-13T15:00:00Z", () => {
    const lock = zonedLocalToUtc(2026, 9, 13, 10, 0);
    expect(lock.toISOString()).toBe("2026-09-13T15:00:00.000Z");
  });

  it("renders 15:00Z as 10:00 AM CDT in America/Chicago", () => {
    const lock = new Date("2026-09-13T15:00:00.000Z");
    expect(formatInChicago(lock, {
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    })).toMatch(/10:00\s*AM\s*CDT/i);
    expect(formatContestTime(lock)).toMatch(/10:00\s*AM\s*CDT/i);
    expect(formatContestClock(lock)).toMatch(/10:00\s*AM\s*CDT/i);
    expect(formatContestClock(lock)).not.toMatch(/EST/i);
    expect(formatContestClock(lock)).not.toMatch(/6:00/i);
  });

  it("renders 15:00Z as 11:00 AM EDT in America/New_York", () => {
    const lock = new Date("2026-09-13T15:00:00.000Z");
    expect(formatInEastern(lock, {
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    })).toMatch(/11:00\s*AM\s*EDT/i);
    expect(formatInEastern(lock, {
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    })).not.toMatch(/EST/i);
    expect(formatInEastern(lock, {
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    })).not.toMatch(/6:00/i);
  });

  it("admin datetime-local 10:00 Central persists as 15:00Z (not 10:00Z)", () => {
    const parsed = parseChicagoDateTimeLocal("2026-09-13T10:00");
    expect(parsed?.toISOString()).toBe("2026-09-13T15:00:00.000Z");
    expect(toChicagoDateTimeLocal(parsed!)).toBe("2026-09-13T10:00");
  });

  it("does not treat a naive 10:00Z as the Sunday lock", () => {
    // Bug pattern: datetime-local "10:00" parsed as UTC → 6:00 AM EDT.
    const wrong = new Date("2026-09-13T10:00:00.000Z");
    expect(
      formatInEastern(wrong, {
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }),
    ).toMatch(/6:00\s*AM\s*EDT/i);
    expect(RANKIQ_TIMEZONE).toBe("America/Chicago");
    expect(EASTERN_TIMEZONE).toBe("America/New_York");
  });
});

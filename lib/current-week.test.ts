import { describe, expect, it } from "vitest";
import { selectCurrentWeek } from "@/lib/current-week";

const week = (weekNumber: number, status: string) => ({
  id: `w${weekNumber}`,
  weekNumber,
  status,
});

describe("selectCurrentWeek", () => {
  it("picks the latest COMPLETE week between Finalize and Open", () => {
    const weeks = [
      week(1, "COMPLETE"),
      week(2, "COMPLETE"),
      week(3, "COMPLETE"),
      week(4, "COMPLETE"),
      week(5, "UPCOMING"),
    ];
    expect(selectCurrentWeek(weeks)?.id).toBe("w4");
    expect(selectCurrentWeek([...weeks].reverse())?.id).toBe("w4");
  });

  it("prefers OPEN over LOCKED over COMPLETE", () => {
    expect(
      selectCurrentWeek([
        week(4, "COMPLETE"),
        week(5, "LOCKED"),
        week(6, "OPEN"),
      ])?.id,
    ).toBe("w6");
    expect(
      selectCurrentWeek([week(4, "COMPLETE"), week(5, "LOCKED"), week(6, "UPCOMING")])
        ?.id,
    ).toBe("w5");
  });

  it("falls back to the earliest week when nothing has started", () => {
    expect(
      selectCurrentWeek([week(2, "UPCOMING"), week(1, "UPCOMING")])?.id,
    ).toBe("w1");
  });

  it("returns null for no weeks", () => {
    expect(selectCurrentWeek([])).toBeNull();
  });
});

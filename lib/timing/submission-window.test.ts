import { describe, expect, it } from "vitest";
import { rankingEditWindowError } from "@/lib/timing/submission-window";
import { zonedLocalToUtc } from "@/lib/timing/chicago";

const openAt = zonedLocalToUtc(2026, 9, 8, 0, 0);
const fullLock = zonedLocalToUtc(2026, 9, 13, 10, 0);
const beforeLock = zonedLocalToUtc(2026, 9, 13, 9, 0);
const afterLock = zonedLocalToUtc(2026, 9, 13, 11, 0);

describe("rankingEditWindowError", () => {
  it("blocks submit after Sunday full lock even when contest is OPEN", () => {
    const error = rankingEditWindowError({
      contestStatus: "OPEN",
      weekStatus: "OPEN",
      rankingsOpenAt: openAt,
      fullLockAt: fullLock,
      now: afterLock,
      action: "submit",
    });
    expect(error).toMatch(/Sunday full lock/i);
  });

  it("allows submit before Sunday full lock when contest is OPEN", () => {
    const error = rankingEditWindowError({
      contestStatus: "OPEN",
      weekStatus: "OPEN",
      rankingsOpenAt: openAt,
      fullLockAt: fullLock,
      now: beforeLock,
      action: "submit",
    });
    expect(error).toBeNull();
  });

  it("blocks submit when contest is LOCKED", () => {
    const error = rankingEditWindowError({
      contestStatus: "LOCKED",
      weekStatus: "OPEN",
      rankingsOpenAt: openAt,
      fullLockAt: fullLock,
      now: beforeLock,
      action: "submit",
    });
    expect(error).toMatch(/Contest is not open/i);
  });

  it("blocks submit before rankings open", () => {
    const error = rankingEditWindowError({
      contestStatus: "OPEN",
      weekStatus: "OPEN",
      rankingsOpenAt: openAt,
      fullLockAt: fullLock,
      now: zonedLocalToUtc(2026, 9, 7, 23, 0),
      action: "submit",
    });
    expect(error).toMatch(/not open yet/i);
  });
});

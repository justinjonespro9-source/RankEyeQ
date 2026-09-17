import { describe, expect, it } from "vitest";
import {
  HISTORICAL_SOURCE_REQUIRED,
  competitiveCaptureTimestamp,
  historicalBackfillAuditFlags,
  isCompetitivelyLate,
  isOfficiallyCompetitiveBackfill,
} from "@/lib/benchmarks/historical-backfill";
import { isLateCapture } from "@/lib/benchmarks/merge";
import { mergeSundayWithThursdayLocks } from "@/lib/benchmarks/merge";
import { validatePartialLockEdit } from "@/lib/timing/partial-lock";
import {
  parseChicagoDateTimeLocal,
  zonedLocalToUtc,
} from "@/lib/timing/chicago";

const fullLock = zonedLocalToUtc(2026, 9, 13, 10, 0);
const thursdayKickoff = zonedLocalToUtc(2026, 9, 10, 19, 20);
const fridayNow = zonedLocalToUtc(2026, 9, 11, 12, 0);
const thursdayPublish = zonedLocalToUtc(2026, 9, 10, 15, 0);
const afterLockPublish = zonedLocalToUtc(2026, 9, 13, 11, 0);

describe("A. Normal Human kickoff lock", () => {
  it("cannot add a player after kickoff", () => {
    const result = validatePartialLockEdit({
      previous: [],
      nextRankedIds: ["bills-qb", null, null],
      kickoffByEntryId: new Map([["bills-qb", thursdayKickoff]]),
      now: fridayNow,
      fullLockAt: fullLock,
      rankingsOpenAt: zonedLocalToUtc(2026, 9, 8, 0, 0),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/after their game has started/i);
    }
  });
});

describe("historical backfill competitive clock", () => {
  it("B. ordinary admin entry stays late when wall-clock capturedAt is after lock", () => {
    expect(isLateCapture(fridayNow, fullLock)).toBe(false);
    expect(isLateCapture(afterLockPublish, fullLock)).toBe(true);
    expect(
      isCompetitivelyLate(
        competitiveCaptureTimestamp({
          historicalBackfill: false,
          sourcePublishedAt: thursdayPublish,
          capturedAt: afterLockPublish,
        }),
        fullLock,
      ),
    ).toBe(true);
  });

  it("C. backfill evaluates Thursday kickoff locks against source time, not Friday transcription", () => {
    const merged = mergeSundayWithThursdayLocks({
      rankingDepth: 2,
      now: thursdayPublish, // historical source time before kickoff
      thursday: null,
      sunday: {
        capturedAt: thursdayPublish,
        selected: [
          {
            rankableEntryId: "bills-rb",
            sourceRank: 1,
            rankIqRank: 1,
            kickoffAt: thursdayKickoff,
            rawName: "Bills RB",
          },
          {
            rankableEntryId: "lions-rb",
            sourceRank: 2,
            rankIqRank: 2,
            kickoffAt: zonedLocalToUtc(2026, 9, 14, 12, 0),
            rawName: "Lions RB",
          },
        ],
      },
    });
    expect(merged.complete).toBe(true);
    expect(merged.slots.filter(Boolean)).toHaveLength(2);

    const tooLate = mergeSundayWithThursdayLocks({
      rankingDepth: 1,
      now: fridayNow, // wall clock after Thursday kickoff, no Thursday snapshot
      thursday: null,
      sunday: {
        capturedAt: fridayNow,
        selected: [
          {
            rankableEntryId: "bills-rb",
            sourceRank: 1,
            rankIqRank: 1,
            kickoffAt: thursdayKickoff,
            rawName: "Bills RB",
          },
        ],
      },
    });
    expect(tooLate.complete).toBe(false);
  });

  it("D. backfilled Expert with Thursday source before lock is officially competitive", () => {
    expect(
      isOfficiallyCompetitiveBackfill({
        historicalBackfill: true,
        sourcePublishedAt: thursdayPublish,
        capturedAt: fridayNow,
        fullLockAt: fullLock,
      }),
    ).toBe(true);
  });

  it("E. backfilled Expert with source after lock is tracking-only", () => {
    expect(
      isOfficiallyCompetitiveBackfill({
        historicalBackfill: true,
        sourcePublishedAt: afterLockPublish,
        capturedAt: afterLockPublish,
        fullLockAt: fullLock,
      }),
    ).toBe(false);
  });

  it("requires sourcePublishedAt in backfill mode", () => {
    expect(() =>
      competitiveCaptureTimestamp({
        historicalBackfill: true,
        sourcePublishedAt: null,
        capturedAt: fridayNow,
      }),
    ).toThrow(HISTORICAL_SOURCE_REQUIRED);
  });

  it("F. audit flags Week COMPLETE + after full lock without implying consensus rewrite", () => {
    const flags = historicalBackfillAuditFlags({
      historicalBackfill: true,
      wallClockNow: zonedLocalToUtc(2026, 9, 16, 12, 0),
      fullLockAt: fullLock,
      weekStatus: "COMPLETE",
    });
    expect(flags.historicalBackfill).toBe(true);
    expect(flags.enteredAfterFullLock).toBe(true);
    expect(flags.enteredAfterWeekComplete).toBe(true);
    expect(flags.backfilledAt?.toISOString()).toBe(
      zonedLocalToUtc(2026, 9, 16, 12, 0).toISOString(),
    );
  });

  it("H. Chicago datetime-local stores the correct UTC instant", () => {
    const parsed = parseChicagoDateTimeLocal("2026-09-17T18:30");
    expect(parsed).not.toBeNull();
    // Sep 17 2026 is CDT (UTC-5) → 18:30 CT = 23:30 UTC
    expect(parsed!.toISOString()).toBe("2026-09-17T23:30:00.000Z");
  });
});

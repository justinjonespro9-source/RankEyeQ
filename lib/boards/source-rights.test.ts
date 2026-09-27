import { describe, expect, it } from "vitest";
import {
  boardShowsCaptureProvenance,
  capturedBoardSourceRestricted,
  snapshotRestrictsPublicBoard,
} from "@/lib/boards/source-rights";
import { boardAppearsOnPublicWeekSurface } from "@/lib/competitor-visibility";

const captured = { authority: null, picks: [{ sourceRank: 1 }, { sourceRank: 2 }] };
const ownerLegacy = { authority: null, picks: [{ sourceRank: null }] };
const restricted = { status: "LOCKED" as const, publicBoardAllowed: false };
const notAvailable = { status: "NOT_AVAILABLE" as const, publicBoardAllowed: false };
const allowed = { status: "LOCKED" as const, publicBoardAllowed: true };

describe("captured-source rights restriction", () => {
  it("applies publicBoardAllowed=false / NOT_AVAILABLE to captured boards only", () => {
    expect(snapshotRestrictsPublicBoard(null)).toBe(false);
    expect(snapshotRestrictsPublicBoard(allowed)).toBe(false);
    expect(snapshotRestrictsPublicBoard(restricted)).toBe(true);
    expect(snapshotRestrictsPublicBoard(notAvailable)).toBe(true);

    for (const profileType of ["CREATOR", "BENCHMARK"] as const) {
      expect(
        capturedBoardSourceRestricted({ profileType, submission: captured, latestSnapshot: restricted }),
      ).toBe(true);
      expect(
        capturedBoardSourceRestricted({ profileType, submission: captured, latestSnapshot: allowed }),
      ).toBe(false);
    }
  });

  it("never restricts OWNER_AUTHORED boards (explicit or legacy-inferred) or non-capture profiles", () => {
    expect(
      capturedBoardSourceRestricted({
        profileType: "CREATOR",
        submission: { authority: "OWNER_AUTHORED", picks: [{ sourceRank: 1 }] },
        latestSnapshot: notAvailable,
      }),
    ).toBe(false);
    expect(
      capturedBoardSourceRestricted({ profileType: "CREATOR", submission: ownerLegacy, latestSnapshot: notAvailable }),
    ).toBe(false);
    for (const profileType of ["HUMAN", "AI"] as const) {
      expect(boardShowsCaptureProvenance({ profileType, submission: captured })).toBe(false);
      expect(
        capturedBoardSourceRestricted({ profileType, submission: captured, latestSnapshot: restricted }),
      ).toBe(false);
    }
  });
});

describe("boardAppearsOnPublicWeekSurface", () => {
  const w1 = { id: "w1", seasonId: "s", weekNumber: 1, startsAt: new Date("2026-09-10"), isTest: false };
  const w2 = { id: "w2", seasonId: "s", weekNumber: 2, startsAt: new Date("2026-09-17"), isTest: false };
  const test = { ...w2, id: "wt", isTest: true };
  const base = { competitorActive: true, publicVisible: true, publicFromWeekId: null };

  it("reuses canonical profile visibility and the publicFromWeek gate", () => {
    expect(boardAppearsOnPublicWeekSurface({ ...base, profileType: "HUMAN" }, w1)).toBe(true);
    expect(boardAppearsOnPublicWeekSurface({ ...base, profileType: "HUMAN", publicVisible: false }, w1)).toBe(false);
    expect(boardAppearsOnPublicWeekSurface({ ...base, profileType: "BENCHMARK", competitorActive: false }, w1)).toBe(false);
    expect(boardAppearsOnPublicWeekSurface({ ...base, profileType: "CREATOR", publicVisible: false }, w1)).toBe(false);
    const gated = { ...base, profileType: "CREATOR" as const, publicFromWeekId: "w2", publicFromWeek: w2 };
    expect(boardAppearsOnPublicWeekSurface(gated, w1)).toBe(false);
    expect(boardAppearsOnPublicWeekSurface(gated, w2)).toBe(true);
  });

  it("excludes test weeks unless explicitly included", () => {
    expect(boardAppearsOnPublicWeekSurface({ ...base, profileType: "HUMAN" }, test)).toBe(false);
    expect(
      boardAppearsOnPublicWeekSurface({ ...base, profileType: "HUMAN" }, test, { includeTest: true }),
    ).toBe(true);
  });
});

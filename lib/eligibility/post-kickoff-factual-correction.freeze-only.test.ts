import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findUniqueAvail,
  findUniqueRankable,
  updateManyPicks,
  countPicks,
  findManyContests,
  createAudit,
  upsertStore,
} = vi.hoisted(() => ({
  findUniqueAvail: vi.fn(),
  findUniqueRankable: vi.fn(),
  updateManyPicks: vi.fn(),
  countPicks: vi.fn(),
  findManyContests: vi.fn(),
  createAudit: vi.fn(),
  upsertStore: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    playerWeekAvailability: { findUnique: findUniqueAvail },
    rankableEntry: { findUnique: findUniqueRankable },
    rankingPick: { updateMany: updateManyPicks, count: countPicks },
    rankIQContest: { findMany: findManyContests },
    adminAuditLog: { create: createAudit },
  },
}));

vi.mock("@/lib/admin/audit", () => ({
  logAdminAction: (input: unknown) => createAudit(input),
}));

vi.mock("@/lib/eligibility/player-week-availability-store", () => ({
  upsertPlayerWeekAvailability: (...args: unknown[]) => upsertStore(...args),
}));

import { applyPostKickoffFactualCorrection } from "@/lib/eligibility/post-kickoff-factual-correction";
import { deriveEffectiveBoard } from "@/lib/reserves/effective-board";

const kickoff = new Date("2026-11-01T21:25:00Z");
const afterKickoff = new Date("2026-11-03T15:00:00Z");
const sourceBefore = new Date("2026-11-01T15:27:00Z");
const sourceInGame = new Date("2026-11-01T22:00:00Z");

function stubPlayer(id = "aj-brown", name = "A.J. Brown") {
  findUniqueRankable.mockResolvedValue({
    id,
    name,
    contestEntries: [
      {
        contestId: "contest-wr",
        game: { startsAt: kickoff, weekId: "week-8" },
      },
    ],
  });
}

describe("post-kickoff freeze-only gap (already OUT)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubPlayer();
    findManyContests.mockResolvedValue([
      { id: "contest-wr", position: "WR", status: "LOCKED" },
    ]);
    createAudit.mockImplementation(async (input: object) => ({
      id: "audit-freeze",
      ...input,
    }));
    countPicks.mockResolvedValue(0);
    updateManyPicks.mockResolvedValue({ count: 8 });
  });

  it("existing OUT + missing freeze: stamps freezes, skips PWA rewrite", async () => {
    findUniqueAvail.mockResolvedValue({ designation: "OUT" });
    const result = await applyPostKickoffFactualCorrection({
      weekId: "week-8",
      rankableEntryId: "aj-brown",
      designation: "OUT",
      reason: "Pregame OUT — missing freeze",
      sourceReference: "https://patriots.com/out",
      sourcePublishedAt: sourceBefore,
      adminUserId: "admin",
      now: afterKickoff,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.freezeOnlyCorrection).toBe(true);
    expect(result.availabilityUpsertStatus).toBe("skipped_already_correct");
    expect(result.freezePicksUpdated).toBe(8);
    expect(upsertStore).not.toHaveBeenCalled();
  });

  it("existing OUT + correct freeze: idempotent nothing_to_correct", async () => {
    findUniqueAvail.mockResolvedValue({ designation: "OUT" });
    updateManyPicks.mockResolvedValue({ count: 0 });
    countPicks.mockResolvedValue(11);
    const result = await applyPostKickoffFactualCorrection({
      weekId: "week-8",
      rankableEntryId: "aj-brown",
      designation: "OUT",
      reason: "rerun",
      sourceReference: "https://patriots.com/out",
      sourcePublishedAt: sourceBefore,
      adminUserId: "admin",
      now: afterKickoff,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("nothing_to_correct");
    expect(createAudit).not.toHaveBeenCalled();
  });

  it("rejects in-game injury source (after kickoff)", async () => {
    findUniqueAvail.mockResolvedValue({ designation: "OUT" });
    const result = await applyPostKickoffFactualCorrection({
      weekId: "week-8",
      rankableEntryId: "lamar",
      designation: "OUT",
      reason: "Injured during game",
      sourceReference: "https://example.com/in-game",
      sourcePublishedAt: sourceInGame,
      adminUserId: "admin",
      now: afterKickoff,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("source_not_before_kickoff");
    expect(updateManyPicks).not.toHaveBeenCalled();
  });

  it("rejects missing source evidence on freeze-only path", async () => {
    findUniqueAvail.mockResolvedValue({ designation: "OUT" });
    const result = await applyPostKickoffFactualCorrection({
      weekId: "week-8",
      rankableEntryId: "aj-brown",
      designation: "OUT",
      reason: "no pub time",
      sourceReference: "https://patriots.com/out",
      adminUserId: "admin",
      now: afterKickoff,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("missing_source_published_at");
  });

  it("designation path accepts updated_context_only from store", async () => {
    findUniqueAvail.mockResolvedValue({ designation: "QUESTIONABLE" });
    upsertStore.mockResolvedValue({ status: "updated_context_only" });
    updateManyPicks.mockResolvedValue({ count: 3 });
    const result = await applyPostKickoffFactualCorrection({
      weekId: "week-8",
      rankableEntryId: "player",
      designation: "INACTIVE",
      reason: "Official inactive",
      sourceReference: "https://example.com/inactive",
      sourcePublishedAt: sourceBefore,
      adminUserId: "admin",
      now: afterKickoff,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.freezeOnlyCorrection).toBe(false);
    expect(result.availabilityUpsertStatus).toBe("updated_context_only");
    expect(result.freezePicksUpdated).toBe(3);
    expect(upsertStore).toHaveBeenCalled();
  });

  it("designation path still fails on skipped_kickoff from store", async () => {
    findUniqueAvail.mockResolvedValue({ designation: "QUESTIONABLE" });
    upsertStore.mockResolvedValue({ status: "skipped_kickoff" });
    const result = await applyPostKickoffFactualCorrection({
      weekId: "week-8",
      rankableEntryId: "player",
      designation: "OUT",
      reason: "should fail",
      sourceReference: "https://example.com/out",
      sourcePublishedAt: sourceBefore,
      adminUserId: "admin",
      now: afterKickoff,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("availability_write_failed");
    expect(updateManyPicks).not.toHaveBeenCalled();
  });
});

describe("effective board: dual WR unavailability + OUT R1 with R2", () => {
  const depth = 15;
  const now = afterKickoff;

  it("double-hit WR board: AJ + DeVonta displace; R1 then R2 promote to trailing slots", () => {
    const picks = [
      ...Array.from({ length: 13 }, (_, i) => ({
        rankableEntryId: `wr-${i + 1}`,
        predictedRank: i + 1,
        availability: "ACTIVE",
        kickoffAt: kickoff,
        wasUnavailableAtKickoff: false,
      })),
      {
        rankableEntryId: "aj-brown",
        predictedRank: 14,
        availability: "OUT",
        kickoffAt: kickoff,
        wasUnavailableAtKickoff: true,
      },
      {
        rankableEntryId: "devonta-smith",
        predictedRank: 15,
        availability: "OUT",
        kickoffAt: kickoff,
        wasUnavailableAtKickoff: true,
      },
      {
        rankableEntryId: "reserve-r1",
        predictedRank: 16,
        availability: "ACTIVE",
        kickoffAt: kickoff,
        wasUnavailableAtKickoff: false,
        reserveEligiblePredecessorIds: ["aj-brown", "devonta-smith"],
      },
      {
        rankableEntryId: "reserve-r2",
        predictedRank: 17,
        availability: "ACTIVE",
        kickoffAt: kickoff,
        wasUnavailableAtKickoff: false,
        reserveEligiblePredecessorIds: ["aj-brown", "devonta-smith"],
      },
    ];
    const board = deriveEffectiveBoard({ picks, scoringDepth: depth, now });
    expect(board.displaced.map((d) => d.rankableEntryId).sort()).toEqual([
      "aj-brown",
      "devonta-smith",
    ]);
    expect(board.effective).toHaveLength(15);
    expect(board.effective.map((e) => e.rankableEntryId)).toContain(
      "reserve-r1",
    );
    expect(board.effective.map((e) => e.rankableEntryId)).toContain(
      "reserve-r2",
    );
    expect(board.effective.map((e) => e.rankableEntryId)).not.toContain(
      "aj-brown",
    );
    expect(board.effective.map((e) => e.rankableEntryId)).not.toContain(
      "devonta-smith",
    );
    expect(board.activations).toHaveLength(2);
  });

  it("OUT R1 with eligible R2: R1 skipped, R2 promotes", () => {
    const picks = [
      ...Array.from({ length: 14 }, (_, i) => ({
        rankableEntryId: `wr-${i + 1}`,
        predictedRank: i + 1,
        availability: "ACTIVE",
        kickoffAt: kickoff,
        wasUnavailableAtKickoff: false,
      })),
      {
        rankableEntryId: "aj-brown",
        predictedRank: 15,
        availability: "OUT",
        kickoffAt: kickoff,
        wasUnavailableAtKickoff: true,
      },
      {
        rankableEntryId: "reserve-r1-out",
        predictedRank: 16,
        availability: "OUT",
        kickoffAt: kickoff,
        wasUnavailableAtKickoff: true,
        reserveEligiblePredecessorIds: ["aj-brown"],
      },
      {
        rankableEntryId: "reserve-r2",
        predictedRank: 17,
        availability: "ACTIVE",
        kickoffAt: kickoff,
        wasUnavailableAtKickoff: false,
        reserveEligiblePredecessorIds: ["aj-brown"],
      },
    ];
    const board = deriveEffectiveBoard({ picks, scoringDepth: depth, now });
    expect(board.activations.map((a) => a.reserveEntryId)).toEqual([
      "reserve-r2",
    ]);
    expect(board.effective.map((e) => e.rankableEntryId)).toContain(
      "reserve-r2",
    );
    expect(board.effective.map((e) => e.rankableEntryId)).not.toContain(
      "reserve-r1-out",
    );
  });

  it("Lamar in-game injury: freeze false/null → remains on effective board", () => {
    const picks = [
      {
        rankableEntryId: "lamar",
        predictedRank: 1,
        availability: "UNKNOWN",
        kickoffAt: kickoff,
        wasUnavailableAtKickoff: false,
      },
      ...Array.from({ length: 9 }, (_, i) => ({
        rankableEntryId: `qb-${i + 2}`,
        predictedRank: i + 2,
        availability: "ACTIVE",
        kickoffAt: kickoff,
        wasUnavailableAtKickoff: false,
      })),
      {
        rankableEntryId: "qb-r1",
        predictedRank: 11,
        availability: "ACTIVE",
        kickoffAt: kickoff,
        wasUnavailableAtKickoff: false,
      },
    ];
    const board = deriveEffectiveBoard({
      picks,
      scoringDepth: 10,
      now,
    });
    expect(board.displaced).toHaveLength(0);
    expect(board.effective[0]?.rankableEntryId).toBe("lamar");
    expect(board.activations).toHaveLength(0);
  });

  it("Breece INACTIVE with freeze true: displaced from effective", () => {
    const picks = [
      ...Array.from({ length: 7 }, (_, i) => ({
        rankableEntryId: `rb-${i + 1}`,
        predictedRank: i + 1,
        availability: "ACTIVE",
        kickoffAt: kickoff,
        wasUnavailableAtKickoff: false,
      })),
      {
        rankableEntryId: "breece",
        predictedRank: 8,
        availability: "INACTIVE",
        kickoffAt: kickoff,
        wasUnavailableAtKickoff: true,
      },
      {
        rankableEntryId: "rb-9",
        predictedRank: 9,
        availability: "ACTIVE",
        kickoffAt: kickoff,
        wasUnavailableAtKickoff: false,
      },
      {
        rankableEntryId: "rb-10",
        predictedRank: 10,
        availability: "ACTIVE",
        kickoffAt: kickoff,
        wasUnavailableAtKickoff: false,
      },
      {
        rankableEntryId: "rb-r1",
        predictedRank: 11,
        availability: "ACTIVE",
        kickoffAt: kickoff,
        wasUnavailableAtKickoff: false,
        reserveEligiblePredecessorIds: ["breece"],
      },
    ];
    const board = deriveEffectiveBoard({
      picks,
      scoringDepth: 10,
      now,
    });
    expect(board.displaced.map((d) => d.rankableEntryId)).toEqual(["breece"]);
    expect(board.effective.map((e) => e.rankableEntryId)).toContain("rb-r1");
    expect(board.effective.map((e) => e.rankableEntryId)).not.toContain(
      "breece",
    );
  });
});

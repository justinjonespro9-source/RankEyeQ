import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findUniqueAvail,
  upsertAvail,
  updateRankable,
  findFirstSeason,
  findUniqueRankable,
  updateManyPicks,
  findManyContests,
  createAudit,
  findUniqueAudit,
} = vi.hoisted(() => ({
  findUniqueAvail: vi.fn(),
  upsertAvail: vi.fn(),
  updateRankable: vi.fn(),
  findFirstSeason: vi.fn(),
  findUniqueRankable: vi.fn(),
  updateManyPicks: vi.fn(),
  findManyContests: vi.fn(),
  createAudit: vi.fn(),
  findUniqueAudit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    playerWeekAvailability: {
      findUnique: findUniqueAvail,
      upsert: upsertAvail,
    },
    rankableEntry: {
      findUnique: findUniqueRankable,
      update: updateRankable,
    },
    seasonPlayer: {
      findFirst: findFirstSeason,
    },
    rankingPick: {
      updateMany: updateManyPicks,
    },
    rankIQContest: {
      findMany: findManyContests,
    },
    adminAuditLog: {
      create: createAudit,
      findUnique: findUniqueAudit,
    },
  },
}));

vi.mock("@/lib/admin/audit", () => ({
  logAdminAction: (input: unknown) => createAudit(input),
}));

import { upsertPlayerWeekAvailability } from "@/lib/eligibility/player-week-availability-store";
import {
  applyPostKickoffFactualCorrection,
  POST_KICKOFF_FACTUAL_CORRECTION_ACTION,
  resolveContestsForPostKickoffCorrectionRegrade,
} from "@/lib/eligibility/post-kickoff-factual-correction";

const kickoff = new Date("2026-09-22T00:20:00Z");
const afterKickoff = new Date("2026-09-22T06:00:00Z");
const beforeKickoff = new Date("2026-09-21T18:00:00Z");

describe("ordinary admin OUT after kickoff remains blocked", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueAvail.mockResolvedValue(null);
    findFirstSeason.mockResolvedValue({ nflStatus: "ACTIVE" });
    findUniqueRankable.mockResolvedValue({
      gameStartsAt: null,
      game: null,
      contestEntries: [
        { game: { startsAt: kickoff, weekId: "week-mnf" } },
      ],
    });
  });

  it("returns skipped_kickoff and does not write", async () => {
    const result = await upsertPlayerWeekAvailability({
      weekId: "week-mnf",
      rankableEntryId: "puka",
      designation: "OUT",
      sourceType: "MANUAL",
      setManualOverride: true,
      respectManualOverride: false,
      now: afterKickoff,
    });
    expect(result.status).toBe("skipped_kickoff");
    expect(upsertAvail).not.toHaveBeenCalled();
  });
});

describe("authorized post-kickoff factual correction write path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUniqueAvail.mockResolvedValue({
      designation: "QUESTIONABLE",
      injuryDescription: null,
      sourceUrl: null,
      sourcePublishedAt: null,
      manualOverride: false,
      sourceType: "NFL_SYNC",
    });
    findFirstSeason.mockResolvedValue({ nflStatus: "ACTIVE" });
    upsertAvail.mockResolvedValue({});
    updateRankable.mockResolvedValue({});
    updateManyPicks.mockResolvedValue({ count: 42 });
    findManyContests.mockResolvedValue([
      { id: "contest-wr", position: "WR", status: "FINAL" },
    ]);
    createAudit.mockImplementation(async (input: { metadata?: unknown }) => ({
      id: "audit-1",
      ...((input as object) ?? {}),
    }));

    // RankableEntry.findUnique is used both for correction load and upsert kickoff probe.
    findUniqueRankable.mockImplementation(async (args: {
      select?: Record<string, unknown>;
    }) => {
      const select = args?.select ?? {};
      if ("name" in select) {
        return {
          id: "puka",
          name: "Puka Nacua",
          contestEntries: [
            {
              contestId: "contest-wr",
              game: { startsAt: kickoff, weekId: "week-mnf" },
            },
          ],
        };
      }
      return {
        gameStartsAt: null,
        game: null,
        contestEntries: [
          { game: { startsAt: kickoff, weekId: "week-mnf" } },
        ],
      };
    });
  });

  it("succeeds, revises freeze only, flags requiresRegrade, does not touch predictedRank", async () => {
    const result = await applyPostKickoffFactualCorrection({
      weekId: "week-mnf",
      rankableEntryId: "puka",
      designation: "OUT",
      reason: "Officially inactive — did not play MNF",
      sourceReference: "https://www.nfl.com/inactives",
      adminUserId: "admin-1",
      now: afterKickoff,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.previousDesignation).toBe("QUESTIONABLE");
    expect(result.correctedDesignation).toBe("OUT");
    expect(result.freezePicksUpdated).toBe(42);
    expect(result.affectedContestIds).toEqual(["contest-wr"]);
    expect(result.requiresRegrade).toBe(true);
    expect(result.auditLogId).toBe("audit-1");

    expect(upsertAvail).toHaveBeenCalled();
    expect(updateManyPicks).toHaveBeenCalledWith({
      where: {
        rankableEntryId: "puka",
        submission: {
          contest: { weekId: "week-mnf" },
        },
      },
      data: { wasUnavailableAtKickoff: true },
    });
    const data = updateManyPicks.mock.calls[0]![0].data as Record<
      string,
      unknown
    >;
    expect(data.predictedRank).toBeUndefined();
    expect(data.reserveEligiblePredecessorIds).toBeUndefined();
    expect(Object.keys(data)).toEqual(["wasUnavailableAtKickoff"]);

    expect(createAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "week_status.post_kickoff_factual_correction",
        adminUserId: "admin-1",
        metadata: expect.objectContaining({
          regradeOccurred: false,
          requiresRegrade: true,
          reason: "Officially inactive — did not play MNF",
        }),
      }),
    );
  });

  it("rejects when kickoff has not passed", async () => {
    const result = await applyPostKickoffFactualCorrection({
      weekId: "week-mnf",
      rankableEntryId: "puka",
      designation: "OUT",
      reason: "too early",
      sourceReference: "note",
      adminUserId: "admin-1",
      now: beforeKickoff,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("kickoff_not_passed");
    expect(updateManyPicks).not.toHaveBeenCalled();
  });

  it("rejects missing reason or source", async () => {
    const noReason = await applyPostKickoffFactualCorrection({
      weekId: "week-mnf",
      rankableEntryId: "puka",
      designation: "OUT",
      reason: "   ",
      sourceReference: "note",
      adminUserId: "admin-1",
      now: afterKickoff,
    });
    expect(noReason.ok).toBe(false);

    const noSource = await applyPostKickoffFactualCorrection({
      weekId: "week-mnf",
      rankableEntryId: "puka",
      designation: "OUT",
      reason: "valid",
      sourceReference: "",
      adminUserId: "admin-1",
      now: afterKickoff,
    });
    expect(noSource.ok).toBe(false);
  });

  it("rejects QUESTIONABLE as a correction designation", async () => {
    const result = await applyPostKickoffFactualCorrection({
      weekId: "week-mnf",
      rankableEntryId: "puka",
      // @ts-expect-error intentional invalid
      designation: "QUESTIONABLE",
      reason: "nope",
      sourceReference: "note",
      adminUserId: "admin-1",
      now: afterKickoff,
    });
    expect(result.ok).toBe(false);
  });
});

describe("resolveContestsForPostKickoffCorrectionRegrade server authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("re-derives week+player contests from correction audit; ignores browser IDs", async () => {
    findUniqueAudit.mockResolvedValue({
      id: "audit-1",
      action: POST_KICKOFF_FACTUAL_CORRECTION_ACTION,
      entityId: "week-mnf",
      metadata: {
        weekId: "week-mnf",
        rankableEntryId: "puka",
        affectedContestIds: ["spoofed-other-week"],
      },
    });
    findManyContests.mockResolvedValue([
      { id: "contest-wr" },
      { id: "contest-flex" },
    ]);

    const resolved = await resolveContestsForPostKickoffCorrectionRegrade({
      weekId: "week-mnf",
      correctionAuditLogId: "audit-1",
    });

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.contestIds).toEqual(["contest-wr", "contest-flex"]);
    expect(resolved.rankableEntryId).toBe("puka");
    expect(findManyContests).toHaveBeenCalledWith({
      where: {
        weekId: "week-mnf",
        entries: { some: { rankableEntryId: "puka" } },
      },
      select: { id: true },
    });
  });

  it("rejects wrong week, wrong action, or missing audit", async () => {
    findUniqueAudit.mockResolvedValueOnce(null);
    const missing = await resolveContestsForPostKickoffCorrectionRegrade({
      weekId: "week-mnf",
      correctionAuditLogId: "nope",
    });
    expect(missing.ok).toBe(false);

    findUniqueAudit.mockResolvedValueOnce({
      id: "audit-2",
      action: "something.else",
      entityId: "week-mnf",
      metadata: { rankableEntryId: "puka", weekId: "week-mnf" },
    });
    const wrongAction = await resolveContestsForPostKickoffCorrectionRegrade({
      weekId: "week-mnf",
      correctionAuditLogId: "audit-2",
    });
    expect(wrongAction.ok).toBe(false);

    findUniqueAudit.mockResolvedValueOnce({
      id: "audit-3",
      action: POST_KICKOFF_FACTUAL_CORRECTION_ACTION,
      entityId: "week-other",
      metadata: { rankableEntryId: "puka", weekId: "week-other" },
    });
    const wrongWeek = await resolveContestsForPostKickoffCorrectionRegrade({
      weekId: "week-mnf",
      correctionAuditLogId: "audit-3",
    });
    expect(wrongWeek.ok).toBe(false);
    expect(findManyContests).not.toHaveBeenCalled();
  });
});

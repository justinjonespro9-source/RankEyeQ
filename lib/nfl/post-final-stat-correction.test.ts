import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  calculateDefenseLiveFantasyPoints,
  calculatePlayerLiveFantasyPoints,
} from "@/lib/admin/live-scoring-shared";
import {
  applyPostFinalStatCorrection,
  defenseFactsFromRecord,
  diffNumericFacts,
  normalizeDefenseFactualStats,
  normalizePlayerFactualStats,
  playerFactsFromRecord,
  POST_FINAL_STAT_CORRECTION_ACTION,
  previewPostFinalStatCorrection,
  projectPositionRanksAfterFantasyChange,
} from "@/lib/nfl/post-final-stat-correction";

const {
  findUniquePlayerStat,
  findUniqueDefenseStat,
  findUniqueContest,
  findFirstContestEntry,
  findManyEntries,
  updatePlayerStat,
  updateDefenseStat,
  updateContestEntry,
  createAudit,
  transaction,
  calculateFinishes,
  gradeContestMock,
  reopenLiveGameMock,
} = vi.hoisted(() => ({
  findUniquePlayerStat: vi.fn(),
  findUniqueDefenseStat: vi.fn(),
  findUniqueContest: vi.fn(),
  findFirstContestEntry: vi.fn(),
  findManyEntries: vi.fn(),
  updatePlayerStat: vi.fn(),
  updateDefenseStat: vi.fn(),
  updateContestEntry: vi.fn(),
  createAudit: vi.fn(),
  transaction: vi.fn(),
  calculateFinishes: vi.fn(),
  gradeContestMock: vi.fn(),
  reopenLiveGameMock: vi.fn(),
}));

/** Loose Prisma find args used by contest/weekStat mocks in this file. */
type MockFindArgs = {
  where?: {
    id?: string;
    weekId_position?: unknown;
  };
  include?: {
    entries?: unknown;
    submissions?: unknown;
  };
};

type MockAuditCreateArgs = {
  data?: unknown;
};

type MockTx = {
  playerWeekStat: { update: typeof updatePlayerStat };
  defenseWeekStat: { update: typeof updateDefenseStat };
  contestEntry: { update: typeof updateContestEntry };
  adminAuditLog: {
    create: (args: MockAuditCreateArgs) => Promise<{ id: string }>;
  };
};

vi.mock("@/lib/db", () => ({
  prisma: {
    playerWeekStat: {
      findUnique: findUniquePlayerStat,
      update: updatePlayerStat,
    },
    defenseWeekStat: {
      findUnique: findUniqueDefenseStat,
      update: updateDefenseStat,
    },
    rankIQContest: {
      findUnique: findUniqueContest,
      findUniqueOrThrow: findUniqueContest,
    },
    contestEntry: {
      findFirst: findFirstContestEntry,
      findUnique: findFirstContestEntry,
      findUniqueOrThrow: findFirstContestEntry,
      findMany: findManyEntries,
      update: updateContestEntry,
    },
    week: {
      findUniqueOrThrow: vi.fn(async () => ({ status: "COMPLETE" })),
    },
    adminAuditLog: {
      create: createAudit,
    },
    $transaction: transaction,
  },
}));

vi.mock("@/lib/admin/audit", () => ({
  logAdminAction: (input: unknown) => createAudit(input),
}));

vi.mock("@/lib/nfl/actual-finishes", () => ({
  calculateLeagueActualFinishesForContest: (...args: unknown[]) =>
    calculateFinishes(...args),
}));

vi.mock("@/lib/grading", () => ({
  gradeContest: (...args: unknown[]) => gradeContestMock(...args),
}));

vi.mock("@/lib/admin/live-scoring", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin/live-scoring")>(
    "@/lib/admin/live-scoring",
  );
  return {
    ...actual,
    reopenLiveGame: (...args: unknown[]) => reopenLiveGameMock(...args),
  };
});

function basePlayerStat(overrides: Record<string, unknown> = {}) {
  return {
    id: "pws-1",
    provider: "manual",
    weekId: "week-2",
    gameId: "game-1",
    rankableEntryId: "player-a",
    fantasyPoints: 10,
    leagueActualRank: 5,
    scoringVersion: "FANTASYTRACK_NFL_HALF_PPR_V2",
    passingYards: 0,
    passingTds: 0,
    interceptions: 0,
    rushingYards: 0,
    rushingTds: 0,
    receptions: 5,
    receivingYards: 50,
    receivingTds: 1,
    twoPointConversions: 0,
    fumblesLost: 0,
    returnTds: 0,
    week: {
      id: "week-2",
      label: "Week 2",
      status: "COMPLETE",
      seasonId: "season-1",
      fantasyScoringVersion: "FANTASYTRACK_NFL_HALF_PPR_V2",
      season: {
        fantasyScoringVersion: "FANTASYTRACK_NFL_HALF_PPR_V2",
      },
    },
    rankableEntry: {
      id: "player-a",
      name: "Player A",
      team: "BUF",
      position: "WR",
    },
    ...overrides,
  };
}

describe("post-FINAL factual correction — pure scoring + projection", () => {
  it("recalculates Half-PPR from corrected player factual fields", () => {
    const facts = normalizePlayerFactualStats({
      receptions: 8,
      receivingYards: 120,
      receivingTds: 2,
    });
    const pts = calculatePlayerLiveFantasyPoints(facts);
    // Canonical V2 Half-PPR (+ yardage bonuses when applicable)
    expect(pts).toBe(
      calculatePlayerLiveFantasyPoints({
        receptions: 8,
        receivingYards: 120,
        receivingTds: 2,
      }),
    );
    expect(pts).toBeGreaterThan(20);
  });

  it("uses canonical DEF scoring including pointsAllowed", () => {
    const facts = normalizeDefenseFactualStats({
      sacks: 3,
      interceptions: 1,
      pointsAllowed: 6,
    });
    const pts = calculateDefenseLiveFantasyPoints(facts);
    // 3*1 + 1*2 + PA(6)=7 → 3+2+7=12 (V2 tiers)
    expect(pts).toBeGreaterThan(0);
    expect(
      calculateDefenseLiveFantasyPoints({
        ...facts,
        pointsAllowed: 35,
      }),
    ).toBeLessThan(pts);
  });

  it("projects rank reorder for only the affected position pool", () => {
    const result = projectPositionRanksAfterFantasyChange({
      entries: [
        {
          rankableEntryId: "a",
          name: "A",
          fantasyPoints: 20,
          actualRank: 1,
        },
        {
          rankableEntryId: "b",
          name: "B",
          fantasyPoints: 15,
          actualRank: 2,
        },
        {
          rankableEntryId: "c",
          name: "C",
          fantasyPoints: 10,
          actualRank: 3,
        },
      ],
      targetRankableEntryId: "c",
      newFantasyPoints: 25,
    });
    expect(result.projectedActualRank).toBe(1);
    expect(result.rankChanges.length).toBeGreaterThanOrEqual(2);
    expect(
      result.projectedRanks.find((r) => r.rankableEntryId === "a")?.newRank,
    ).toBe(2);
  });

  it("moves player into Top N", () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({
      rankableEntryId: `p${i}`,
      name: `P${i}`,
      fantasyPoints: 30 - i,
      actualRank: i + 1,
    }));
    const result = projectPositionRanksAfterFantasyChange({
      entries,
      targetRankableEntryId: "p11",
      newFantasyPoints: 40,
    });
    expect(result.projectedActualRank).toBe(1);
    expect(result.projectedActualRank!).toBeLessThanOrEqual(10);
  });

  it("moves player out of Top N", () => {
    const result = projectPositionRanksAfterFantasyChange({
      entries: [
        { rankableEntryId: "a", name: "A", fantasyPoints: 30, actualRank: 1 },
        { rankableEntryId: "b", name: "B", fantasyPoints: 20, actualRank: 2 },
        { rankableEntryId: "c", name: "C", fantasyPoints: 10, actualRank: 3 },
      ],
      targetRankableEntryId: "a",
      newFantasyPoints: 5,
    });
    expect(result.projectedActualRank).toBe(3);
  });

  it("creates a tie with competition-rank 1224 semantics", () => {
    const result = projectPositionRanksAfterFantasyChange({
      entries: [
        { rankableEntryId: "a", name: "A", fantasyPoints: 20, actualRank: 1 },
        { rankableEntryId: "b", name: "B", fantasyPoints: 15, actualRank: 2 },
        { rankableEntryId: "c", name: "C", fantasyPoints: 10, actualRank: 3 },
      ],
      targetRankableEntryId: "c",
      newFantasyPoints: 20,
    });
    const a = result.projectedRanks.find((r) => r.rankableEntryId === "a")!;
    const c = result.projectedRanks.find((r) => r.rankableEntryId === "c")!;
    expect(a.newRank).toBe(1);
    expect(c.newRank).toBe(1);
    expect(
      result.projectedRanks.find((r) => r.rankableEntryId === "b")?.newRank,
    ).toBe(3);
  });

  it("removes a tie when scores diverge", () => {
    const result = projectPositionRanksAfterFantasyChange({
      entries: [
        { rankableEntryId: "a", name: "A", fantasyPoints: 20, actualRank: 1 },
        { rankableEntryId: "b", name: "B", fantasyPoints: 20, actualRank: 1 },
        { rankableEntryId: "c", name: "C", fantasyPoints: 10, actualRank: 3 },
      ],
      targetRankableEntryId: "b",
      newFantasyPoints: 25,
    });
    expect(
      result.projectedRanks.find((r) => r.rankableEntryId === "b")?.newRank,
    ).toBe(1);
    expect(
      result.projectedRanks.find((r) => r.rankableEntryId === "a")?.newRank,
    ).toBe(2);
  });

  it("diffNumericFacts lists only changed keys", () => {
    expect(
      diffNumericFacts(
        playerFactsFromRecord({ receptions: 5, receivingYards: 50 }),
        playerFactsFromRecord({ receptions: 8, receivingYards: 50 }),
      ),
    ).toEqual(["receptions"]);
  });
});

describe("post-FINAL correction validation + preview write-free", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUniquePlayerStat.mockResolvedValue(basePlayerStat());
    findUniqueContest.mockImplementation(async (args?: MockFindArgs) => {
      if (args?.where?.id === "contest-wr") {
        return {
          id: "contest-wr",
          weekId: "week-2",
          position: "WR",
          status: "FINAL",
          rankingDepth: 15,
          entries: [
            {
              rankableEntryId: "player-a",
              fantasyPoints: 10,
              actualRank: 5,
              rankableEntry: { name: "Player A" },
            },
            {
              rankableEntryId: "player-b",
              fantasyPoints: 20,
              actualRank: 1,
              rankableEntry: { name: "Player B" },
            },
          ],
          submissions: [{ id: "sub-1" }, { id: "sub-2" }],
        };
      }
      if (args?.where?.weekId_position) {
        return {
          id: "contest-wr",
          weekId: "week-2",
          position: "WR",
          status: "FINAL",
          rankingDepth: 15,
        };
      }
      return {
        id: "contest-wr",
        weekId: "week-2",
        position: "WR",
        status: "FINAL",
        rankingDepth: 15,
        entries: [],
        submissions: [],
      };
    });
    findFirstContestEntry.mockResolvedValue({
      id: "ce-1",
      actualRank: 5,
      fantasyPoints: 10,
    });
  });

  it("rejects missing reason", async () => {
    const result = await applyPostFinalStatCorrection({
      weekStatId: "pws-1",
      kind: "player",
      proposedStats: { receptions: 8, receivingYards: 50, receivingTds: 1 },
      reason: "  ",
      sourceReference: "https://example.com",
      adminUserId: "admin-1",
      confirmHighImpact: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("missing_reason");
    expect(updatePlayerStat).not.toHaveBeenCalled();
  });

  it("rejects missing source/reference", async () => {
    const result = await applyPostFinalStatCorrection({
      weekStatId: "pws-1",
      kind: "player",
      proposedStats: { receptions: 8, receivingYards: 50, receivingTds: 1 },
      reason: "Box score typo",
      sourceReference: "",
      adminUserId: "admin-1",
      confirmHighImpact: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("missing_source");
  });

  it("rejects without high-impact confirmation", async () => {
    const result = await applyPostFinalStatCorrection({
      weekStatId: "pws-1",
      kind: "player",
      proposedStats: { receptions: 8, receivingYards: 50, receivingTds: 1 },
      reason: "Box score typo",
      sourceReference: "official box score",
      adminUserId: "admin-1",
      confirmHighImpact: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("missing_confirmation");
  });

  it("preview performs zero writes", async () => {
    const result = await previewPostFinalStatCorrection({
      weekStatId: "pws-1",
      kind: "player",
      proposedStats: {
        receptions: 8,
        receivingYards: 120,
        receivingTds: 2,
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.preview.position).toBe("WR");
      expect(result.preview.unrelatedPositionsUnaffected).toBe(true);
      expect(result.preview.contestRemainsFinal).toBe(true);
      expect(result.preview.newFantasyPoints).toBe(
        calculatePlayerLiveFantasyPoints({
          receptions: 8,
          receivingYards: 120,
          receivingTds: 2,
        }),
      );
      expect(result.preview.gradedSubmissionCount).toBe(2);
    }
    expect(updatePlayerStat).not.toHaveBeenCalled();
    expect(updateContestEntry).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(calculateFinishes).not.toHaveBeenCalled();
    expect(gradeContestMock).not.toHaveBeenCalled();
  });

  it("rejects ordinary OPEN contest through post-FINAL path", async () => {
    findUniqueContest.mockImplementation(async (args?: MockFindArgs) => {
      if (args?.where?.weekId_position) {
        return {
          id: "contest-wr",
          weekId: "week-2",
          position: "WR",
          status: "OPEN",
          rankingDepth: 15,
        };
      }
      return {
        id: "contest-wr",
        status: "OPEN",
        rankingDepth: 15,
        entries: [],
        submissions: [],
      };
    });
    const result = await previewPostFinalStatCorrection({
      weekStatId: "pws-1",
      kind: "player",
      proposedStats: { receptions: 1 },
    });
    expect(result.ok).toBe(false);
  });
});

describe("post-FINAL apply orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findUniquePlayerStat.mockResolvedValue(basePlayerStat());
    findUniqueContest.mockImplementation(async (args?: MockFindArgs) => {
      if (args?.where?.id === "contest-wr" || args?.include?.entries) {
        return {
          id: "contest-wr",
          weekId: "week-2",
          position: "WR",
          status: "FINAL",
          rankingDepth: 15,
          entries: [
            {
              rankableEntryId: "player-a",
              fantasyPoints: 10,
              actualRank: 5,
              rankableEntry: { name: "Player A" },
            },
            {
              rankableEntryId: "player-b",
              fantasyPoints: 20,
              actualRank: 1,
              rankableEntry: { name: "Player B" },
            },
          ],
          submissions: [
            {
              id: "sub-1",
              status: "GRADED",
              universalProfileId: "prof-1",
              normalizedScore: 40,
              picks: [],
            },
          ],
        };
      }
      return {
        id: "contest-wr",
        weekId: "week-2",
        position: "WR",
        status: "FINAL",
        rankingDepth: 15,
      };
    });
    findFirstContestEntry.mockResolvedValue({
      id: "ce-1",
      actualRank: 5,
      fantasyPoints: 10,
    });
    findManyEntries.mockResolvedValue([
      {
        rankableEntryId: "player-a",
        actualRank: 1,
        fantasyPoints: 28,
        rankableEntry: { name: "Player A" },
      },
      {
        rankableEntryId: "player-b",
        actualRank: 2,
        fantasyPoints: 20,
        rankableEntry: { name: "Player B" },
      },
    ]);
    transaction.mockImplementation(async (fn: (tx: MockTx) => Promise<unknown>) =>
      fn({
        playerWeekStat: { update: updatePlayerStat },
        defenseWeekStat: { update: updateDefenseStat },
        contestEntry: { update: updateContestEntry },
        adminAuditLog: {
          create: async (args: MockAuditCreateArgs) => {
            createAudit(args.data ?? args);
            return { id: "audit-1" };
          },
        },
      }),
    );
    calculateFinishes.mockResolvedValue({
      contestId: "contest-wr",
      position: "WR",
      ranked: 2,
      tiedGroups: 0,
      contestEntriesRanked: 2,
      contestEntriesWithPoints: 2,
      poolCount: 2,
    });
    gradeContestMock.mockResolvedValue({
      contestId: "contest-wr",
      position: "WR",
      status: "FINAL",
      graded: 22,
      skipped: 0,
      skips: [],
    });
    createAudit.mockResolvedValue({ id: "audit-recalc" });
    // After apply, findFirst for entryAfter
    findFirstContestEntry
      .mockResolvedValueOnce({
        id: "ce-1",
        actualRank: 5,
        fantasyPoints: 10,
      })
      .mockResolvedValue({
        id: "ce-1",
        actualRank: 1,
        fantasyPoints: 28,
      });
  });

  it("applies WeekStat + finishes + grade and keeps FINAL", async () => {
    const result = await applyPostFinalStatCorrection({
      weekStatId: "pws-1",
      kind: "player",
      proposedStats: {
        receptions: 8,
        receivingYards: 120,
        receivingTds: 2,
      },
      reason: "Corrected receiving line from box score",
      sourceReference: "https://www.nfl.com/games/example",
      adminUserId: "admin-1",
      confirmHighImpact: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(updatePlayerStat).toHaveBeenCalled();
    expect(updateContestEntry).toHaveBeenCalled();
    expect(calculateFinishes).toHaveBeenCalledWith("contest-wr");
    expect(gradeContestMock).toHaveBeenCalledWith("contest-wr");
    expect(result.contestStatus).toBe("FINAL");
    expect(result.weekStatus).toBe("COMPLETE");
    expect(result.submissionsRegraded).toBe(22);
    expect(createAudit).toHaveBeenCalled();
    const auditPayloads = createAudit.mock.calls.map(
      (call: unknown[]) => call[0],
    );
    expect(
      JSON.stringify(auditPayloads).includes(POST_FINAL_STAT_CORRECTION_ACTION) ||
        JSON.stringify(auditPayloads).includes("beforeFacts") ||
        JSON.stringify(auditPayloads).includes("stats_applied"),
    ).toBe(true);
  });

  it("identical correction does not compound and still regrades safely", async () => {
    // Same stats as current → identicalNoOp
    const identicalPts = calculatePlayerLiveFantasyPoints({
      receptions: 8,
      receivingYards: 120,
      receivingTds: 2,
    });
    findUniquePlayerStat.mockResolvedValue(
      basePlayerStat({
        receptions: 8,
        receivingYards: 120,
        receivingTds: 2,
        fantasyPoints: identicalPts,
      }),
    );
    findFirstContestEntry.mockResolvedValue({
      id: "ce-1",
      actualRank: 1,
      fantasyPoints: identicalPts,
    });
    findManyEntries.mockResolvedValue([
      {
        rankableEntryId: "player-a",
        actualRank: 1,
        fantasyPoints: identicalPts,
        rankableEntry: { name: "Player A" },
      },
    ]);

    const result = await applyPostFinalStatCorrection({
      weekStatId: "pws-1",
      kind: "player",
      proposedStats: {
        receptions: 8,
        receivingYards: 120,
        receivingTds: 2,
        passingYards: 0,
        passingTds: 0,
        interceptions: 0,
        rushingYards: 0,
        rushingTds: 0,
        twoPointConversions: 0,
        fumblesLost: 0,
        returnTds: 0,
      },
      reason: "Re-run identical correction",
      sourceReference: "same source",
      adminUserId: "admin-1",
      confirmHighImpact: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.identicalNoOp).toBe(true);
    expect(calculateFinishes).toHaveBeenCalledTimes(1);
    expect(gradeContestMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces partial failure without hiding state", async () => {
    calculateFinishes.mockRejectedValue(new Error("finish boom"));
    const result = await applyPostFinalStatCorrection({
      weekStatId: "pws-1",
      kind: "player",
      proposedStats: {
        receptions: 8,
        receivingYards: 120,
        receivingTds: 2,
      },
      reason: "Corrected receiving line",
      sourceReference: "box score",
      adminUserId: "admin-1",
      confirmHighImpact: true,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("apply_failed");
    expect(result.partialState?.weekStatUpdated).toBe(true);
    expect(result.partialState?.finishesRecalculated).toBe(false);
    expect(result.partialState?.graded).toBe(false);
  });
});

describe("source guards — ordinary reopen remains gated; FINAL restore fixed", () => {
  it("ordinary reopenLiveGame still documents FINAL block", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/admin/live-scoring.ts"),
      "utf8",
    );
    expect(source).toMatch(/Cannot reopen/);
    expect(source).toMatch(/already FINAL/);
  });

  it("gradeContest restores prior FINAL on failure", () => {
    const source = readFileSync(join(process.cwd(), "lib/grading.ts"), "utf8");
    expect(source).toMatch(/priorStatus === "GRADING" \? "LOCKED" : priorStatus/);
    expect(source).not.toMatch(
      /priorStatus === "GRADING" \|\| priorStatus === "FINAL"\s*\n\s*\? "LOCKED"/,
    );
  });

  it("correction module does not mutate predictedRank", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/nfl/post-final-stat-correction.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/rankingPick\.update/);
    expect(source).not.toMatch(/data:\s*\{[\s\S]*reserveEligiblePredecessorIds/);
    expect(source).toMatch(/Does NOT mutate RankingPick\.predictedRank/);
    expect(source).toContain("calculateLeagueActualFinishesForContest");
    expect(source).toContain("gradeContest");
    expect(source).toContain("calculatePlayerLiveFantasyPoints");
    expect(source).toContain("calculateDefenseLiveFantasyPoints");
  });
});

describe("defenseFactsFromRecord", () => {
  it("normalizes defense factual snapshot", () => {
    expect(defenseFactsFromRecord({ sacks: 2.5, pointsAllowed: -1 }).pointsAllowed).toBe(0);
    expect(defenseFactsFromRecord({ sacks: 2.5 }).sacks).toBe(2.5);
  });
});


describe("admin action authorization wiring", () => {
  it("server actions assertAdmin before preview/apply", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/admin-post-final-stat-actions.ts"),
      "utf8",
    );
    expect(source).toContain("assertAdmin");
    expect(source.match(/assertAdmin/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("UI distinguishes ordinary live editing from post-FINAL correction", () => {
    const ui = readFileSync(
      join(process.cwd(), "components/admin/PostFinalStatCorrectionPanel.tsx"),
      "utf8",
    );
    const consoleSource = readFileSync(
      join(process.cwd(), "components/admin/LiveScoringConsole.tsx"),
      "utf8",
    );
    expect(ui).toContain("Correct Final Stats");
    expect(ui).toContain("Preview Impact");
    expect(ui).toContain("Apply Correction");
    expect(consoleSource).toContain("PostFinalStatCorrectionPanel");
    expect(consoleSource).toContain("Weekly FINAL — use Correct Final Stats");
  });
});

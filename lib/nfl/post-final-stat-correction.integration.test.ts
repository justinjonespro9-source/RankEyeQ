import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  calculatePlayerLiveFantasyPoints,
  LIVE_MANUAL_PROVIDER,
} from "@/lib/admin/live-scoring-shared";
import { saveLivePlayerStats } from "@/lib/admin/live-scoring";
import { prisma } from "@/lib/db";
import { FANTASYTRACK_NFL_HALF_PPR_V2 } from "@/lib/fantasy/scoring-config";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import { gradeContest } from "@/lib/grading";
import { calculateLeagueActualFinishesForContest } from "@/lib/nfl/actual-finishes";
import {
  applyPostFinalStatCorrection,
  POST_FINAL_STAT_CORRECTION_ACTION,
  PRE_GRADE_STAT_CORRECTION_ACTION,
  PRE_GRADE_STAT_CORRECTION_RECALCULATED_ACTION,
  previewPostFinalStatCorrection,
} from "@/lib/nfl/post-final-stat-correction";

const suffix = `scv${Date.now().toString(36)}`;
const seasonYear = 3960 + (Date.now() % 30);

type StatLine = { receptions: number; receivingYards: number; receivingTds: number };

/**
 * Week 3 shape: Week OPEN, contests LOCKED and ungraded, one game FINALIZED
 * with verified stats (one line entered wrong), one game still live.
 */
describe("verified stat correction lifecycle (local DB)", () => {
  let seasonId = "";
  let weekId = "";
  let adminUserId = "";
  let ownerUserId = "";
  let profileId = "";
  let verifiedGameId = "";
  let liveGameId = "";
  let wrContestId = "";
  let teContestId = "";
  let wrSubmissionId = "";
  const wr: { entryId: string; contestEntryId: string; weekStatId: string }[] = [];
  const te: { entryId: string; contestEntryId: string; weekStatId: string }[] = [];

  const typo: StatLine = { receptions: 5, receivingYards: 50, receivingTds: 10 };
  const corrected: StatLine = { receptions: 5, receivingYards: 50, receivingTds: 1 };

  async function addPlayer(
    position: ContestPosition,
    contestId: string,
    index: number,
    line: StatLine,
    gameId: string,
    verified: boolean,
  ) {
    const entry = await prisma.rankableEntry.create({
      data: {
        provider: "manual",
        externalId: `${suffix}-${position}-${index}`,
        type: "PLAYER",
        name: `${position} Player ${index}`,
        shortName: `${position}${index}`,
        team: verified ? "AAA" : "CCC",
        opponent: "vs OPP",
        position,
        gameId,
        active: true,
      },
    });
    const fantasyPoints = calculatePlayerLiveFantasyPoints(line);
    const contestEntry = await prisma.contestEntry.create({
      data: { contestId, rankableEntryId: entry.id, gameId, fantasyPoints, excluded: false },
    });
    const weekStat = await prisma.playerWeekStat.create({
      data: {
        provider: LIVE_MANUAL_PROVIDER,
        weekId,
        rankableEntryId: entry.id,
        gameId,
        externalPlayerId: entry.externalId,
        scoringVersion: FANTASYTRACK_NFL_HALF_PPR_V2,
        ...line,
        fantasyPoints,
        isProvisional: !verified,
      },
    });
    return { entryId: entry.id, contestEntryId: contestEntry.id, weekStatId: weekStat.id };
  }

  async function createLockedSubmission(contestId: string, entryIds: string[]) {
    const lockedAt = new Date("2098-09-20T17:00:00Z");
    return prisma.rankingSubmission.create({
      data: {
        contestId,
        universalProfileId: profileId,
        status: "LOCKED",
        authority: "OWNER_AUTHORED",
        submittedAt: new Date("2098-09-18T12:00:00Z"),
        lockedAt,
        picks: {
          create: entryIds.map((rankableEntryId, i) => ({
            rankableEntryId,
            predictedRank: i + 1,
            committedAt: new Date("2098-09-18T12:00:00Z"),
            lockedAt,
            lockedRank: i + 1,
            slotLocked: true,
            reserveEligiblePredecessorIds: i === 0 ? [] : [entryIds[i - 1]],
            wasUnavailableAtKickoff: false,
          })),
        },
      },
    });
  }

  /** Competitive truth, board history, kickoff freezes and lifecycle. */
  async function protectedSnapshot() {
    return JSON.stringify({
      week: await prisma.week.findUniqueOrThrow({ where: { id: weekId } }),
      contests: await prisma.rankIQContest.findMany({ where: { weekId }, orderBy: { id: "asc" } }),
      games: await prisma.nflGame.findMany({ where: { weekId }, orderBy: { id: "asc" } }),
      submissions: await prisma.rankingSubmission.findMany({
        where: { contest: { weekId } },
        include: { picks: { orderBy: { predictedRank: "asc" } } },
        orderBy: { id: "asc" },
      }),
      versions: await prisma.officialBoardVersion.findMany({
        where: { contest: { weekId } },
        include: { picks: { orderBy: { boardRank: "asc" } } },
        orderBy: { id: "asc" },
      }),
      publications: await prisma.officialBoardPublication.findMany({
        where: { contest: { weekId } },
        orderBy: { id: "asc" },
      }),
    });
  }

  beforeAll(async () => {
    adminUserId = (
      await prisma.user.create({ data: { email: `scv-admin-${suffix}@rankiq.local`, role: "ADMIN" } })
    ).id;
    const profile = await prisma.universalProfile.create({
      data: { username: `scv_${suffix}`.slice(0, 30), displayName: "Owner", profileType: "HUMAN" },
    });
    profileId = profile.id;
    ownerUserId = (
      await prisma.user.create({
        data: { email: `scv-owner-${suffix}@rankiq.local`, universalProfileId: profileId },
      })
    ).id;

    seasonId = (
      await prisma.season.create({
        data: {
          year: seasonYear,
          sport: `NFL-SCV-${suffix}`,
          active: false,
          fantasyScoringVersion: FANTASYTRACK_NFL_HALF_PPR_V2,
        },
      })
    ).id;
    weekId = (
      await prisma.week.create({
        data: {
          seasonId,
          weekNumber: 3,
          label: `[TEST] Verified correction ${suffix}`,
          startsAt: new Date("2098-09-17T00:00:00Z"),
          endsAt: new Date("2098-09-23T00:00:00Z"),
          status: "OPEN",
          isTest: true,
          fantasyScoringVersion: FANTASYTRACK_NFL_HALF_PPR_V2,
          fullLockAt: new Date("2098-09-20T17:00:00Z"),
        },
      })
    ).id;
    verifiedGameId = (
      await prisma.nflGame.create({
        data: {
          provider: "manual",
          externalId: `${suffix}-g-final`,
          seasonId,
          weekId,
          seasonYear,
          weekNumber: 3,
          homeTeam: "AAA",
          awayTeam: "BBB",
          startsAt: new Date("2098-09-20T17:00:00Z"),
          status: "FINAL",
          statsFinalizedAt: new Date("2098-09-20T21:00:00Z"),
        },
      })
    ).id;
    liveGameId = (
      await prisma.nflGame.create({
        data: {
          provider: "manual",
          externalId: `${suffix}-g-live`,
          seasonId,
          weekId,
          seasonYear,
          weekNumber: 3,
          homeTeam: "CCC",
          awayTeam: "DDD",
          startsAt: new Date("2098-09-20T20:25:00Z"),
          status: "IN_PROGRESS",
        },
      })
    ).id;

    wrContestId = (
      await prisma.rankIQContest.create({
        data: { seasonId, weekId, position: "WR", title: "WR Top 3", rankingDepth: 3, status: "LOCKED" },
      })
    ).id;
    wr.push(await addPlayer("WR", wrContestId, 0, typo, verifiedGameId, true));
    wr.push(await addPlayer("WR", wrContestId, 1, { receptions: 7, receivingYards: 90, receivingTds: 1 }, verifiedGameId, true));
    wr.push(await addPlayer("WR", wrContestId, 2, { receptions: 6, receivingYards: 70, receivingTds: 0 }, verifiedGameId, true));
    wr.push(await addPlayer("WR", wrContestId, 3, { receptions: 3, receivingYards: 30, receivingTds: 0 }, verifiedGameId, true));
    wr.push(await addPlayer("WR", wrContestId, 4, { receptions: 2, receivingYards: 20, receivingTds: 0 }, liveGameId, false));

    const wrSubmission = await createLockedSubmission(wrContestId, [wr[0].entryId, wr[1].entryId, wr[2].entryId]);
    wrSubmissionId = wrSubmission.id;
    const boardPicks = [wr[0], wr[1], wr[2]].map((row, i) => ({
      rankableEntryId: row.entryId,
      boardRank: i + 1,
      isReserve: false,
      displayName: `WR Player ${i}`,
      displayTeam: "AAA",
      slotLocked: true,
      lockedAt: new Date("2098-09-20T17:00:00Z"),
      lockedRank: i + 1,
      committedAt: new Date("2098-09-18T12:00:00Z"),
    }));
    const published = await prisma.officialBoardVersion.create({
      data: {
        submissionId: wrSubmissionId,
        contestId: wrContestId,
        profileId,
        kind: "PUBLISHED",
        versionNumber: 1,
        authorUserId: ownerUserId,
        rankingDepth: 3,
        reserveCount: 0,
        fingerprint: `fp-published-${suffix}`,
        picks: { create: boardPicks },
      },
    });
    await prisma.officialBoardVersion.create({
      data: {
        submissionId: wrSubmissionId,
        contestId: wrContestId,
        profileId,
        kind: "FINAL",
        versionNumber: 1,
        rankingDepth: 3,
        reserveCount: 0,
        fingerprint: `fp-final-${suffix}`,
        boardLockedAt: new Date("2098-09-20T17:00:00Z"),
        picks: { create: boardPicks },
      },
    });
    await prisma.officialBoardPublication.create({
      data: {
        submissionId: wrSubmissionId,
        contestId: wrContestId,
        profileId,
        firstPublishedAt: new Date("2098-09-18T12:00:00Z"),
        lastPublishedAt: new Date("2098-09-18T12:00:00Z"),
        latestPublishedVersionId: published.id,
      },
    });

    // An already-graded position (FINAL) for the post-FINAL regression.
    teContestId = (
      await prisma.rankIQContest.create({
        data: { seasonId, weekId, position: "TE", title: "TE Top 3", rankingDepth: 3, status: "LOCKED" },
      })
    ).id;
    te.push(await addPlayer("TE", teContestId, 0, { receptions: 6, receivingYards: 80, receivingTds: 1 }, verifiedGameId, true));
    te.push(await addPlayer("TE", teContestId, 1, { receptions: 5, receivingYards: 60, receivingTds: 0 }, verifiedGameId, true));
    te.push(await addPlayer("TE", teContestId, 2, { receptions: 4, receivingYards: 40, receivingTds: 0 }, verifiedGameId, true));
    te.push(await addPlayer("TE", teContestId, 3, { receptions: 1, receivingYards: 10, receivingTds: 0 }, verifiedGameId, true));
    await createLockedSubmission(teContestId, [te[0].entryId, te[1].entryId, te[2].entryId]);
    await calculateLeagueActualFinishesForContest(teContestId);
    await gradeContest(teContestId);
  });

  afterAll(async () => {
    await prisma.officialBoardPublication.deleteMany({ where: { contest: { weekId } } });
    await prisma.officialBoardVersion.deleteMany({ where: { contest: { weekId } } });
    await prisma.adminAuditLog.deleteMany({ where: { adminUserId } });
    await prisma.rankingPick.deleteMany({ where: { submission: { contest: { weekId } } } });
    await prisma.rankingSubmission.deleteMany({ where: { contest: { weekId } } });
    await prisma.contestEntry.deleteMany({ where: { contest: { weekId } } });
    await prisma.playerWeekStat.deleteMany({ where: { weekId } });
    await prisma.rankIQContest.deleteMany({ where: { weekId } });
    await prisma.nflGame.deleteMany({ where: { weekId } });
    await prisma.rankableEntry.deleteMany({ where: { externalId: { startsWith: `${suffix}-` } } });
    await prisma.week.deleteMany({ where: { id: weekId } });
    await prisma.season.deleteMany({ where: { id: seasonId } });
    await prisma.user.deleteMany({ where: { id: { in: [adminUserId, ownerUserId] } } });
    await prisma.universalProfile.deleteMany({ where: { id: profileId } });
    await prisma.$disconnect();
  });

  it("fixture starts as Week 3: LOCKED, ungraded, verified typo, FINAL TE regrade baseline", async () => {
    const contest = await prisma.rankIQContest.findUniqueOrThrow({ where: { id: wrContestId } });
    expect(contest.status).toBe("LOCKED");
    expect(calculatePlayerLiveFantasyPoints(typo)).toBeGreaterThan(60);
    const te = await prisma.rankIQContest.findUniqueOrThrow({ where: { id: teContestId } });
    expect(te.status).toBe("FINAL");
  });

  it("live/unverified line: correction refused, ordinary Live Scoring editing still works", async () => {
    const live = wr[4];
    const preview = await previewPostFinalStatCorrection({
      weekStatId: live.weekStatId,
      kind: "player",
      proposedStats: { receptions: 3, receivingYards: 25, receivingTds: 0 },
    });
    expect(preview.ok).toBe(false);
    if (!preview.ok) expect(preview.error).toBe("stat_not_verified");

    const saved = await saveLivePlayerStats({
      contestEntryId: live.contestEntryId,
      stats: { receptions: 3, receivingYards: 25, receivingTds: 0 },
      adminUserId,
    });
    expect(saved.skipped).toBe(false);
    const stat = await prisma.playerWeekStat.findUniqueOrThrow({ where: { id: live.weekStatId } });
    expect(stat.receptions).toBe(3);
    expect(stat.isProvisional).toBe(true);
  });

  it("verified line: ordinary Live Scoring stays locked (no unlock of finalized fields)", async () => {
    const saved = await saveLivePlayerStats({
      contestEntryId: wr[0].contestEntryId,
      stats: corrected,
      adminUserId,
    });
    expect(saved.skipped).toBe(true);
    expect(saved.reason).toContain("Correct Verified Stats");
    const stat = await prisma.playerWeekStat.findUniqueOrThrow({ where: { id: wr[0].weekStatId } });
    expect(stat.receivingTds).toBe(10);
  });

  it("previews a pre-grade correction with zero writes", async () => {
    const before = await protectedSnapshot();
    const statBefore = await prisma.playerWeekStat.findUniqueOrThrow({ where: { id: wr[0].weekStatId } });
    const entriesBefore = await prisma.contestEntry.findMany({ where: { contestId: wrContestId }, orderBy: { id: "asc" } });
    const auditBefore = await prisma.adminAuditLog.count({ where: { adminUserId } });

    const result = await previewPostFinalStatCorrection({
      weekStatId: wr[0].weekStatId,
      kind: "player",
      proposedStats: corrected,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.mode).toBe("PRE_GRADE");
    expect(result.preview.regradeWillRun).toBe(false);
    expect(result.preview.ranksProvisional).toBe(true);
    expect(result.preview.changedFields).toEqual(["receivingTds"]);
    expect(result.preview.oldFantasyPoints).toBe(calculatePlayerLiveFantasyPoints(typo));
    expect(result.preview.newFantasyPoints).toBe(calculatePlayerLiveFantasyPoints(corrected));
    expect(result.preview.oldActualRank).toBe(1);

    expect(await protectedSnapshot()).toBe(before);
    expect(await prisma.playerWeekStat.findUniqueOrThrow({ where: { id: wr[0].weekStatId } })).toEqual(statBefore);
    expect(
      await prisma.contestEntry.findMany({ where: { contestId: wrContestId }, orderBy: { id: "asc" } }),
    ).toEqual(entriesBefore);
    expect(await prisma.adminAuditLog.count({ where: { adminUserId } })).toBe(auditBefore);
  });

  it("applies a pre-grade correction: facts + FP change, nothing competitive moves", async () => {
    const before = await protectedSnapshot();
    const gradedBefore = await prisma.rankingSubmission.count({
      where: { contestId: wrContestId, OR: [{ status: "GRADED" }, { normalizedScore: { not: null } }] },
    });
    expect(gradedBefore).toBe(0);

    const result = await applyPostFinalStatCorrection({
      weekStatId: wr[0].weekStatId,
      kind: "player",
      proposedStats: corrected,
      reason: "Rec TD entered as 10; official box score shows 1",
      sourceReference: "https://www.nfl.com/games/example-box-score",
      adminUserId,
      confirmHighImpact: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("PRE_GRADE");
    expect(result.regradeOccurred).toBe(false);
    expect(result.finishesRecalculated).toBe(false);
    expect(result.submissionsRegraded).toBe(0);
    expect(result.contestStatus).toBe("LOCKED");
    expect(result.weekStatus).toBe("OPEN");

    const correctedPoints = calculatePlayerLiveFantasyPoints(corrected);
    const stat = await prisma.playerWeekStat.findUniqueOrThrow({ where: { id: wr[0].weekStatId } });
    expect(stat.receivingTds).toBe(1);
    expect(stat.fantasyPoints).toBe(correctedPoints);
    expect(stat.isProvisional).toBe(false);
    expect(stat.leagueActualRank).toBeNull();

    const entry = await prisma.contestEntry.findUniqueOrThrow({ where: { id: wr[0].contestEntryId } });
    expect(entry.fantasyPoints).toBe(correctedPoints);
    expect(
      await prisma.contestEntry.count({ where: { contestId: wrContestId, actualRank: { not: null } } }),
    ).toBe(0);

    // Game stays FINALIZED/VERIFIED; submissions, picks + kickoff freezes, board
    // versions/publications, Week and contest lifecycle are byte-identical.
    expect(await protectedSnapshot()).toBe(before);
    const game = await prisma.nflGame.findUniqueOrThrow({ where: { id: verifiedGameId } });
    expect(game.status).toBe("FINAL");
    expect(game.statsFinalizedAt).not.toBeNull();
    expect(
      await prisma.rankingSubmission.count({
        where: { contestId: wrContestId, OR: [{ status: "GRADED" }, { normalizedScore: { not: null } }] },
      }),
    ).toBe(0);
    expect(
      await prisma.officialBoardVersion.count({ where: { submissionId: wrSubmissionId, kind: "FINAL" } }),
    ).toBe(1);

    const audits = await prisma.adminAuditLog.findMany({
      where: { adminUserId, action: { in: [PRE_GRADE_STAT_CORRECTION_ACTION, PRE_GRADE_STAT_CORRECTION_RECALCULATED_ACTION] } },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((row) => row.action)).toEqual([
      PRE_GRADE_STAT_CORRECTION_ACTION,
      PRE_GRADE_STAT_CORRECTION_RECALCULATED_ACTION,
    ]);
    expect(audits[0].entityId).toBe(wr[0].weekStatId);
    expect(audits[0].metadata).toMatchObject({
      mode: "PRE_GRADE",
      contestStatus: "LOCKED",
      statVerified: true,
      reason: "Rec TD entered as 10; official box score shows 1",
      sourceReference: "https://www.nfl.com/games/example-box-score",
      beforeFacts: expect.objectContaining({ receivingTds: 10 }),
      afterFacts: expect.objectContaining({ receivingTds: 1 }),
    });
    expect(audits[1].metadata).toMatchObject({ regradeOccurred: false, submissionsRegraded: 0 });
  });

  it("corrected result feeds normal grading later", async () => {
    const finish = await calculateLeagueActualFinishesForContest(wrContestId);
    expect(finish.contestEntriesRanked).toBe(5);
    const entry = await prisma.contestEntry.findUniqueOrThrow({ where: { id: wr[0].contestEntryId } });
    expect(entry.fantasyPoints).toBe(calculatePlayerLiveFantasyPoints(corrected));
    expect(entry.actualRank).toBe(2);
  });

  it("FINAL contest keeps the existing post-FINAL targeted regrade", async () => {
    const submissionBefore = await prisma.rankingSubmission.findFirstOrThrow({
      where: { contestId: teContestId },
      include: { picks: { orderBy: { predictedRank: "asc" } } },
    });
    expect(submissionBefore.status).toBe("GRADED");
    const wrBefore = await prisma.rankingSubmission.findUniqueOrThrow({
      where: { id: wrSubmissionId },
      include: { picks: { orderBy: { predictedRank: "asc" } } },
    });

    // Unpicked TE4 jumps to 1st → a picked TE falls out of the Top 3.
    const result = await applyPostFinalStatCorrection({
      weekStatId: te[3].weekStatId,
      kind: "player",
      proposedStats: { receptions: 9, receivingYards: 150, receivingTds: 2 },
      reason: "Stat correction from league",
      sourceReference: "NFL stat correction feed",
      adminUserId,
      confirmHighImpact: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("POST_FINAL");
    expect(result.regradeOccurred).toBe(true);
    expect(result.submissionsRegraded).toBe(1);
    expect(result.contestStatus).toBe("FINAL");
    expect(result.newActualRank).toBe(1);

    const submissionAfter = await prisma.rankingSubmission.findFirstOrThrow({
      where: { contestId: teContestId },
      include: { picks: { orderBy: { predictedRank: "asc" } } },
    });
    expect(submissionBefore.picks.map((pick) => pick.actualRank)).toEqual([1, 2, 3]);
    expect(submissionAfter.picks.map((pick) => pick.actualRank)).toEqual([2, 3, 4]);
    expect(submissionAfter.normalizedScore).toBeLessThan(submissionBefore.normalizedScore!);
    expect(submissionAfter.picks.map((pick) => pick.predictedRank)).toEqual(
      submissionBefore.picks.map((pick) => pick.predictedRank),
    );
    expect(submissionAfter.picks.map((pick) => pick.lockedAt)).toEqual(
      submissionBefore.picks.map((pick) => pick.lockedAt),
    );
    expect(
      await prisma.adminAuditLog.count({ where: { adminUserId, action: POST_FINAL_STAT_CORRECTION_ACTION } }),
    ).toBe(1);

    // Targeted: the WR position (not yet graded) is untouched by the TE regrade.
    expect(
      await prisma.rankingSubmission.findUniqueOrThrow({
        where: { id: wrSubmissionId },
        include: { picks: { orderBy: { predictedRank: "asc" } } },
      }),
    ).toEqual(wrBefore);
    const wrContest = await prisma.rankIQContest.findUniqueOrThrow({ where: { id: wrContestId } });
    expect(wrContest.status).toBe("LOCKED");
  });
});

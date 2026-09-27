import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { ProfileType } from "@/lib/generated/prisma/client";
import { gradeContest } from "@/lib/grading";
import { FANTASYTRACK_NFL_HALF_PPR_V2 } from "@/lib/fantasy/scoring-config";
import { applyPostKickoffFactualCorrection } from "@/lib/eligibility/post-kickoff-factual-correction";
import { buildContestWeekKickoffMap } from "@/lib/reserves/contest-week-kickoffs";
import { deriveEffectiveBoardFromPicks } from "@/lib/reserves/from-submission";
import { stampKickoffFreezesForContest } from "@/lib/reserves/stamp-kickoff-freezes";
import { applyKickoffLocksToSubmission } from "@/lib/timing/apply-locks";

const suffix = `kfz${Date.now()}`;

// Past Sunday slate so the grading backstop (real clock) sees every kickoff.
const fullLockAt = new Date("2025-09-14T15:00:00.000Z");
const collinsOutAt = new Date("2025-09-14T15:30:00.000Z");
const earlyKickoff = new Date("2025-09-14T17:00:00.000Z");
const afterEarly = new Date("2025-09-14T18:00:00.000Z");
const lateOutAt = new Date("2025-09-14T21:00:00.000Z");
const snfKickoff = new Date("2025-09-15T00:20:00.000Z");
const afterSnf = new Date("2025-09-15T01:00:00.000Z");
const rosterSyncAfterSlate = new Date("2025-09-16T01:35:00.000Z");
const preseason = new Date("2025-09-01T00:00:00.000Z");

const WR_DEPTH = 15;
const WR_BOARD = 17;
const IDX = { brownShape: 2, late: 4, collins: 13, mcconkey: 15, r2: 16 };

describe("kickoff freeze integrity (stamp + locks + grading backstop)", () => {
  let seasonId = "";
  let weekId = "";
  let wrContestId = "";
  let teContestId = "";
  let adminUserId = "";
  let earlyGameId = "";
  let snfGameId = "";
  const wrEntryIds: string[] = [];
  const teEntryIds: string[] = [];
  const profileIds: Record<string, string> = {};
  const wrBoards: Record<string, string> = {};
  const teBoards: Record<string, string> = {};

  async function createProfile(key: string, profileType: ProfileType) {
    const profile = await prisma.universalProfile.create({
      data: {
        username: `${key}-${suffix}`,
        displayName: `${key} ${suffix}`,
        profileType,
        publicVisible: true,
        competitorActive: true,
      },
    });
    profileIds[key] = profile.id;
    return profile.id;
  }

  async function createBoard(input: {
    contestId: string;
    profileId: string;
    entryIds: string[];
    size: number;
    status?: "LOCKED" | "SUBMITTED" | "GRADED";
    freezes?: Record<number, boolean>;
  }) {
    const submission = await prisma.rankingSubmission.create({
      data: {
        contestId: input.contestId,
        universalProfileId: input.profileId,
        status: input.status ?? "LOCKED",
        lockedAt: fullLockAt,
      },
    });
    for (let i = 0; i < input.size; i += 1) {
      await prisma.rankingPick.create({
        data: {
          submissionId: submission.id,
          rankableEntryId: input.entryIds[i]!,
          predictedRank: i + 1,
          wasUnavailableAtKickoff: input.freezes?.[i] ?? null,
        },
      });
    }
    return submission.id;
  }

  async function freezesByIndex(submissionId: string, entryIds: string[]) {
    const picks = await prisma.rankingPick.findMany({
      where: { submissionId },
      orderBy: { predictedRank: "asc" },
    });
    return picks.map((pick) => ({
      index: entryIds.indexOf(pick.rankableEntryId),
      freeze: pick.wasUnavailableAtKickoff,
      slotLocked: pick.slotLocked,
      predecessors: pick.reserveEligiblePredecessorIds,
      totalPoints: pick.totalPoints,
    }));
  }

  async function loadBoardForEffective(submissionId: string, contestId: string) {
    const [picks, entries] = await Promise.all([
      prisma.rankingPick.findMany({
        where: { submissionId },
        include: { rankableEntry: { include: { game: true } } },
        orderBy: { predictedRank: "asc" },
      }),
      prisma.contestEntry.findMany({
        where: { contestId },
        include: { game: true },
      }),
    ]);
    return {
      picks,
      kickoffByEntryId: buildContestWeekKickoffMap({ weekId, entries }),
    };
  }

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: {
        year: 2091,
        sport: `KFZ-${suffix}`,
        active: false,
        fantasyScoringVersion: FANTASYTRACK_NFL_HALF_PPR_V2,
      },
    });
    seasonId = season.id;
    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 3,
        label: `[TEST] Kickoff freeze ${suffix}`,
        startsAt: new Date("2025-09-11T00:15:00.000Z"),
        endsAt: new Date("2025-09-16T04:00:00.000Z"),
        status: "OPEN",
        isTest: true,
        fantasyScoringVersion: FANTASYTRACK_NFL_HALF_PPR_V2,
        rankingsOpenAt: new Date("2025-09-09T12:00:00.000Z"),
        fullLockAt,
      },
    });
    weekId = week.id;

    const early = await prisma.nflGame.create({
      data: {
        provider: "test",
        externalId: `kfz-early-${suffix}`,
        seasonId,
        weekId,
        seasonYear: 2091,
        weekNumber: 3,
        homeTeam: "HOU",
        awayTeam: "LAC",
        startsAt: earlyKickoff,
      },
    });
    earlyGameId = early.id;
    const snf = await prisma.nflGame.create({
      data: {
        provider: "test",
        externalId: `kfz-snf-${suffix}`,
        seasonId,
        weekId,
        seasonYear: 2091,
        weekNumber: 3,
        homeTeam: "DEN",
        awayTeam: "KC",
        startsAt: snfKickoff,
      },
    });
    snfGameId = snf.id;

    const wr = await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId,
        position: "WR",
        title: "WR Top 15",
        rankingDepth: WR_DEPTH,
        reserveCount: 2,
        status: "LOCKED",
      },
    });
    wrContestId = wr.id;
    const te = await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId,
        position: "TE",
        title: "TE Top 4",
        rankingDepth: 4,
        reserveCount: 0,
        status: "LOCKED",
      },
    });
    teContestId = te.id;

    const wrNames = Array.from({ length: 20 }, (_, i) => `WR ${i + 1}`);
    wrNames[IDX.brownShape] = "Brown Shape";
    wrNames[IDX.late] = "Late Game WR";
    wrNames[IDX.collins] = "Nico Collins";
    wrNames[IDX.mcconkey] = "Ladd McConkey";
    for (let i = 0; i < wrNames.length; i += 1) {
      const entry = await prisma.rankableEntry.create({
        data: {
          provider: "manual",
          externalId: `kfz-${suffix}-wr-${i}`,
          type: "PLAYER",
          name: wrNames[i]!,
          shortName: `WR${i}`,
          team: i === IDX.late ? "DEN" : "HOU",
          opponent: "vs OPP",
          position: "WR",
          active: true,
        },
      });
      wrEntryIds.push(entry.id);
      await prisma.contestEntry.create({
        data: {
          contestId: wrContestId,
          rankableEntryId: entry.id,
          gameId: i === IDX.late ? snfGameId : earlyGameId,
          actualRank: i + 1,
          fantasyPoints: 40 - i,
        },
      });
    }
    for (let i = 0; i < 6; i += 1) {
      const entry = await prisma.rankableEntry.create({
        data: {
          provider: "manual",
          externalId: `kfz-${suffix}-te-${i}`,
          type: "PLAYER",
          name: i === 1 ? "Puka Shape" : `TE ${i + 1}`,
          shortName: `TE${i}`,
          team: "HOU",
          opponent: "vs OPP",
          position: "TE",
          active: true,
        },
      });
      teEntryIds.push(entry.id);
      await prisma.contestEntry.create({
        data: {
          contestId: teContestId,
          rankableEntryId: entry.id,
          gameId: earlyGameId,
          actualRank: i + 1,
          fantasyPoints: 20 - i,
        },
      });
    }

    // Collins: official OUT synced after full lock, before his own kickoff.
    await prisma.playerWeekAvailability.create({
      data: {
        weekId,
        rankableEntryId: wrEntryIds[IDX.collins]!,
        designation: "OUT",
        sourceType: "NFL_SYNC",
        sourceUrl: "https://www.nfl.com/injuries/",
        sourcePublishedAt: collinsOutAt,
        observedAt: collinsOutAt,
        createdAt: collinsOutAt,
        updatedAt: collinsOutAt,
      },
    });
    // Late-game WR: OUT only known after the early games but before SNF.
    await prisma.playerWeekAvailability.create({
      data: {
        weekId,
        rankableEntryId: wrEntryIds[IDX.late]!,
        designation: "OUT",
        sourceType: "NFL_SYNC",
        observedAt: lateOutAt,
        createdAt: lateOutAt,
        updatedAt: lateOutAt,
      },
    });
    // Brown/Dart/Njoku shape: roster IR persisted only after the slate.
    for (const [index, nflStatus, updatedAt] of [
      [IDX.brownShape, "IR", rosterSyncAfterSlate],
      [IDX.mcconkey, "ACTIVE", preseason],
    ] as const) {
      await prisma.seasonPlayer.create({
        data: {
          seasonId,
          rankableEntryId: wrEntryIds[index]!,
          displayName: wrNames[index]!,
          team: "HOU",
          position: "WR",
          nflStatus,
          activeOnNFLRoster: nflStatus === "ACTIVE",
          createdAt: preseason,
          updatedAt,
        },
      });
    }

    const admin = await prisma.user.create({
      data: { email: `kfz-admin-${suffix}@example.test`, role: "ADMIN" },
    });
    adminUserId = admin.id;

    await createProfile("human", "HUMAN");
    await createProfile("ai", "AI");
    await createProfile("expert", "BENCHMARK");
    await createProfile("creator", "CREATOR");
    await createProfile("prestamped", "HUMAN");

    for (const key of ["human", "ai", "expert", "creator"]) {
      wrBoards[key] = await createBoard({
        contestId: wrContestId,
        profileId: profileIds[key]!,
        entryIds: wrEntryIds,
        size: WR_BOARD,
      });
      teBoards[key] = await createBoard({
        contestId: teContestId,
        profileId: profileIds[key]!,
        entryIds: teEntryIds,
        size: 4,
      });
    }
    // Existing non-null freezes that disagree with the evidence must survive.
    wrBoards.prestamped = await createBoard({
      contestId: wrContestId,
      profileId: profileIds.prestamped!,
      entryIds: wrEntryIds,
      size: WR_BOARD,
      freezes: { [IDX.collins]: false, [IDX.brownShape]: true },
    });
  }, 180_000);

  afterAll(async () => {
    await prisma.rankingPick.deleteMany({
      where: { submission: { contest: { weekId } } },
    });
    await prisma.rankingSubmission.deleteMany({
      where: { contest: { weekId } },
    });
    await prisma.contestEntry.deleteMany({ where: { contest: { weekId } } });
    await prisma.rankIQContest.deleteMany({ where: { weekId } });
    await prisma.playerWeekAvailability.deleteMany({ where: { weekId } });
    await prisma.seasonPlayer.deleteMany({ where: { seasonId } });
    await prisma.nflGame.deleteMany({ where: { weekId } });
    await prisma.week.deleteMany({ where: { id: weekId } });
    await prisma.season.deleteMany({ where: { id: seasonId } });
    await prisma.rankableEntry.deleteMany({
      where: { externalId: { startsWith: `kfz-${suffix}-` } },
    });
    await prisma.universalProfile.deleteMany({
      where: { id: { in: Object.values(profileIds) } },
    });
    await prisma.adminAuditLog.deleteMany({ where: { adminUserId } });
    await prisma.user.deleteMany({ where: { id: adminUserId } });
    await prisma.$disconnect();
  });

  it("persists evidence write times as given (fixture sanity)", async () => {
    const row = await prisma.seasonPlayer.findFirstOrThrow({
      where: { seasonId, rankableEntryId: wrEntryIds[IDX.brownShape]! },
    });
    expect(row.updatedAt.toISOString()).toBe(rosterSyncAfterSlate.toISOString());
    const pwa = await prisma.playerWeekAvailability.findFirstOrThrow({
      where: { weekId, rankableEntryId: wrEntryIds[IDX.collins]! },
    });
    expect(pwa.updatedAt.toISOString()).toBe(collinsOutAt.toISOString());
  });

  it("A: full lock before a later kickoff locks slots but leaves freezes NULL", async () => {
    const atFullLock = new Date("2025-09-14T15:10:00.000Z");
    await applyKickoffLocksToSubmission(wrBoards.human!, atFullLock);
    const picks = await freezesByIndex(wrBoards.human!, wrEntryIds);
    expect(picks.every((pick) => pick.slotLocked)).toBe(true);
    expect(picks.every((pick) => pick.freeze === null)).toBe(true);
    const reserves = picks.filter((pick) => pick.index >= WR_DEPTH);
    expect(reserves.every((pick) => Array.isArray(pick.predecessors))).toBe(true);
  });

  it("I: audited post-kickoff factual correction sets TRUE on every board", async () => {
    const result = await applyPostKickoffFactualCorrection({
      weekId,
      rankableEntryId: teEntryIds[1]!,
      designation: "INACTIVE",
      reason: "Officially inactive (test fixture)",
      sourceReference: "https://example.test/inactive",
      adminUserId,
      now: afterEarly,
    });
    expect(result.ok).toBe(true);
    for (const key of ["human", "ai", "expert", "creator"]) {
      const picks = await freezesByIndex(teBoards[key]!, teEntryIds);
      expect(picks.find((pick) => pick.index === 1)?.freeze).toBe(true);
    }
  });

  it("dry run reports candidates without writing", async () => {
    const preview = await stampKickoffFreezesForContest(wrContestId, {
      now: afterEarly,
      dryRun: true,
    });
    expect(preview?.mode).toBe("dry_run");
    expect(preview?.stampedTrue).toBe(0);
    expect(preview?.stampedFalse).toBe(0);
    expect(preview?.predecessorsStamped).toBe(0);
    // 4 never-stamped boards × 16 early-game picks; prestamped board has 2 frozen.
    expect(preview?.candidates).toBe(4 * 16 + 14);
    expect(preview?.candidatesTrue).toBe(4);
    expect(preview?.pendingKickoff).toBe(5);
    const nulls = await prisma.rankingPick.count({
      where: {
        submission: { contestId: wrContestId },
        wasUnavailableAtKickoff: null,
      },
    });
    expect(nulls).toBe(5 * WR_BOARD - 2);
  });

  it("C/D/E/F + K + G: stamp freezes early-game players on every profile type, later players stay NULL", async () => {
    const result = await stampKickoffFreezesForContest(wrContestId, {
      now: afterEarly,
    });
    expect(result?.mode).toBe("apply");
    expect(result?.stampedTrue).toBe(4);
    expect(result?.stampedFalse).toBe(4 * 15 + 14);
    expect(result?.pendingKickoff).toBe(5);

    for (const key of ["human", "ai", "expert", "creator"]) {
      const picks = await freezesByIndex(wrBoards[key]!, wrEntryIds);
      const byIndex = new Map(picks.map((pick) => [pick.index, pick.freeze]));
      expect(byIndex.get(IDX.collins)).toBe(true);
      expect(byIndex.get(IDX.brownShape)).toBe(false);
      expect(byIndex.get(IDX.late)).toBeNull();
      expect(byIndex.get(IDX.mcconkey)).toBe(false);
    }
    const collinsItem = result?.items.find(
      (item) =>
        item.submissionId === wrBoards.creator &&
        item.rankableEntryId === wrEntryIds[IDX.collins],
    );
    expect(collinsItem).toMatchObject({ unavailable: true, source: "weekly_designation", reason: "OUT" });
    const brownItem = result?.items.find(
      (item) =>
        item.submissionId === wrBoards.ai &&
        item.rankableEntryId === wrEntryIds[IDX.brownShape],
    );
    expect(brownItem).toMatchObject({ unavailable: false, ignored: ["roster_updated_after_kickoff"] });
  });

  it("H: existing non-null TRUE/FALSE freezes are never overwritten", async () => {
    const picks = await freezesByIndex(wrBoards.prestamped!, wrEntryIds);
    const byIndex = new Map(picks.map((pick) => [pick.index, pick.freeze]));
    expect(byIndex.get(IDX.collins)).toBe(false);
    expect(byIndex.get(IDX.brownShape)).toBe(true);
  });

  it("J: a second stamping run writes nothing", async () => {
    const again = await stampKickoffFreezesForContest(wrContestId, {
      now: afterEarly,
    });
    expect(again?.candidates).toBe(0);
    expect(again?.stampedTrue).toBe(0);
    expect(again?.stampedFalse).toBe(0);
    expect(again?.predecessorsStamped).toBe(0);
  });

  it("B/M: OUT after full lock but before kickoff removes Collins and promotes McConkey", async () => {
    for (const key of ["human", "ai", "expert", "creator"]) {
      const { picks, kickoffByEntryId } = await loadBoardForEffective(
        wrBoards[key]!,
        wrContestId,
      );
      const board = deriveEffectiveBoardFromPicks({
        picks,
        scoringDepth: WR_DEPTH,
        kickoffByEntryId,
        now: afterEarly,
      });
      expect(board.displaced.map((d) => d.rankableEntryId)).toEqual([
        wrEntryIds[IDX.collins],
      ]);
      expect(board.activations).toHaveLength(1);
      expect(board.activations[0]).toMatchObject({
        reserveEntryId: wrEntryIds[IDX.mcconkey],
        replacedEntryId: wrEntryIds[IDX.collins],
        effectiveRank: WR_DEPTH,
      });
    }
  });

  it("I: stamping never touches the factual correction; a board recaptured after it still resolves TRUE", async () => {
    const recaptured = await createProfile("recaptured", "CREATOR");
    teBoards.recaptured = await createBoard({
      contestId: teContestId,
      profileId: recaptured,
      entryIds: teEntryIds,
      size: 4,
    });
    const result = await stampKickoffFreezesForContest(teContestId, {
      now: afterEarly,
    });
    expect(result?.stampedTrue).toBe(1);
    expect(result?.items.find((item) => item.unavailable)).toMatchObject({
      submissionId: teBoards.recaptured,
      source: "post_kickoff_factual_correction",
      reason: "INACTIVE",
    });
    for (const key of ["human", "ai", "expert", "creator", "recaptured"]) {
      const picks = await freezesByIndex(teBoards[key]!, teEntryIds);
      expect(picks.find((pick) => pick.index === 1)?.freeze).toBe(true);
    }
  });

  it("F: the HUMAN lock path applies the identical rule after each player's own kickoff", async () => {
    await applyKickoffLocksToSubmission(wrBoards.human!, afterSnf);
    await stampKickoffFreezesForContest(wrContestId, { now: afterSnf });
    for (const key of ["human", "ai", "expert", "creator"]) {
      const picks = await freezesByIndex(wrBoards[key]!, wrEntryIds);
      const byIndex = new Map(picks.map((pick) => [pick.index, pick.freeze]));
      expect(byIndex.get(IDX.late)).toBe(true);
      expect(byIndex.get(IDX.collins)).toBe(true);
      expect(byIndex.get(IDX.brownShape)).toBe(false);
    }
  });

  it("C: grading backstop stamps a never-opened AI board and scores it like an identical stamped board", async () => {
    const aiLate = await createProfile("ai-never-opened", "AI");
    wrBoards.aiNeverOpened = await createBoard({
      contestId: wrContestId,
      profileId: aiLate,
      entryIds: wrEntryIds,
      size: WR_BOARD,
    });

    const graded = await gradeContest(wrContestId);
    expect(graded.status).toBe("FINAL");
    expect(graded.kickoffFreezes).toMatchObject({
      mode: "apply",
      candidates: WR_BOARD,
      stampedTrue: 2,
      stampedFalse: WR_BOARD - 2,
      predecessorsStamped: 2,
    });

    const neverOpened = await freezesByIndex(wrBoards.aiNeverOpened!, wrEntryIds);
    const byIndex = new Map(neverOpened.map((pick) => [pick.index, pick]));
    expect(byIndex.get(IDX.collins)?.freeze).toBe(true);
    expect(byIndex.get(IDX.late)?.freeze).toBe(true);
    expect(byIndex.get(IDX.collins)?.totalPoints).toBeNull();
    expect(byIndex.get(IDX.mcconkey)?.totalPoints).not.toBeNull();

    const scores = await prisma.rankingSubmission.findMany({
      where: { id: { in: [wrBoards.ai!, wrBoards.aiNeverOpened!] } },
      select: { normalizedScore: true, rawScore: true, status: true },
    });
    expect(scores.every((s) => s.status === "GRADED")).toBe(true);
    expect(scores[0]!.normalizedScore).toBe(scores[1]!.normalizedScore);
    expect(scores[0]!.rawScore).toBe(scores[1]!.rawScore);
  });

  it("L: FINAL contests are report-only — zero writes, scores unchanged on regrade", async () => {
    const historical = await createProfile("historical", "AI");
    wrBoards.historical = await createBoard({
      contestId: wrContestId,
      profileId: historical,
      entryIds: wrEntryIds,
      size: WR_BOARD,
      status: "GRADED",
    });
    const before = await prisma.rankingSubmission.findMany({
      where: { contestId: wrContestId, id: { not: wrBoards.historical } },
      select: { id: true, normalizedScore: true, rawScore: true },
      orderBy: { id: "asc" },
    });
    const freezesBefore = await prisma.rankingPick.findMany({
      where: { submission: { contestId: wrContestId } },
      select: { id: true, wasUnavailableAtKickoff: true },
      orderBy: { id: "asc" },
    });

    const report = await stampKickoffFreezesForContest(wrContestId);
    expect(report?.mode).toBe("report_only");
    expect(report?.candidates).toBe(WR_BOARD);
    expect(report?.stampedTrue).toBe(0);
    expect(report?.stampedFalse).toBe(0);
    expect(report?.predecessorsStamped).toBe(0);

    const regrade = await gradeContest(wrContestId);
    expect(regrade.kickoffFreezes?.mode).toBe("report_only");
    expect(regrade.kickoffFreezes?.stampedTrue).toBe(0);
    expect(regrade.kickoffFreezes?.stampedFalse).toBe(0);

    const freezesAfter = await prisma.rankingPick.findMany({
      where: { submission: { contestId: wrContestId } },
      select: { id: true, wasUnavailableAtKickoff: true },
      orderBy: { id: "asc" },
    });
    expect(freezesAfter).toEqual(freezesBefore);
    const after = await prisma.rankingSubmission.findMany({
      where: { contestId: wrContestId, id: { not: wrBoards.historical } },
      select: { id: true, normalizedScore: true, rawScore: true },
      orderBy: { id: "asc" },
    });
    expect(after).toEqual(before);

    // An owner opening a FINAL board does not stamp historical freezes either.
    await applyKickoffLocksToSubmission(wrBoards.historical!, afterSnf);
    const historicalPicks = await freezesByIndex(wrBoards.historical!, wrEntryIds);
    expect(historicalPicks.every((pick) => pick.freeze === null)).toBe(true);
  });
});

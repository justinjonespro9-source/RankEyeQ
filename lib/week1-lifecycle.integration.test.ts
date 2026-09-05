import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { archiveWeek, createWeek, ensureFivePositionContests } from "@/lib/admin/weeks";
import { captureBenchmarkSnapshot } from "@/lib/benchmarks/snapshots";
import { extractTopNFromPastedText } from "@/lib/benchmarks/parser";
import { getContestConsensus } from "@/lib/consensus";
import { getConsensusAllMode } from "@/lib/consensus-config";
import { prisma } from "@/lib/db";
import { FANTASYTRACK_NFL_HALF_PPR_V2 } from "@/lib/fantasy/scoring-config";
import {
  getSeasonLeaderboard,
  getWeeklyLeaderboard,
} from "@/lib/leaderboards";
import { finalizeWeek } from "@/lib/nfl/finalize-week";
import { commitManualSchedule, buildDefensePoolFromSchedule } from "@/lib/nfl/manual/schedule-import";
import { commitFantasyPointsPaste } from "@/lib/nfl/manual/results-paste";
import { auditAllPools } from "@/lib/nfl/manual/pool-audit";
import { getWeeklyExceptionReview } from "@/lib/nfl/weekly-exceptions";
import {
  autoSyncWeeklyEligibilityForWeek,
  getWeeklyEligibilitySyncStatus,
} from "@/lib/nfl/weekly-auto-sync";
import {
  deactivateWeeklyPlayer,
  syncWeeklyEligibleFieldFromSeason,
} from "@/lib/nfl/weekly-eligibility";
import { getPlayerPerformanceLeaderboard } from "@/lib/player-performance-queries";
import { resolveScoringConfigForContest } from "@/lib/ranking-scoring-versions";
import { RANKEYEQ_V1_SLUG } from "@/lib/ranking-scoring-version";
import { enrollSeasonPlayer } from "@/lib/season-players";
import { submitRanking } from "@/lib/submissions";
import {
  canViewCurrentWeekBoard,
  isRevealWindowActive,
  isWeekHistoricallyPublic,
} from "@/lib/timing/board-access";
import { ensureWeekFullLock } from "@/lib/timing/apply-locks";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import { CONTEST_POSITIONS, rankingDepthForPosition } from "@/lib/contest-defaults";

const suffix = `w1${Date.now()}`;
const KICKOFF = "2026-09-13 12:00 CT";
const SCHEDULE = `Away | Home | Kickoff
MIN | DET | ${KICKOFF}
GB | CHI | 2026-09-13 15:25 CT
SF | SEA | 2026-09-13 15:25 CT
DAL | PHI | 2026-09-13 15:25 CT
KC | LAR | 2026-09-13 20:20 CT`;

type PlayerRef = { id: string; name: string; position: ContestPosition };

describe("Week 1 lifecycle simulation", () => {
  let seasonId = "";
  let weekId = "";
  let adminUserId = "";
  const contestIds = new Map<ContestPosition, string>();
  const players = new Map<string, PlayerRef>();
  const humanIds: string[] = [];
  const aiIds: string[] = [];
  const expertIds: string[] = [];
  let rbBackupId = "";
  let rbStarId = "";
  let excludedEntryId = "";
  let lockAt: Date;
  let revealStartsAt: Date;
  let publicReleaseAt: Date;

  beforeAll(async () => {
    vi.stubEnv("NFL_DATA_PROVIDER", "manual");

    const admin = await prisma.user.create({
      data: {
        email: `w1-admin-${suffix}@rankiq.local`,
        role: "ADMIN",
        emailVerified: new Date(),
        name: "W1 Admin",
      },
    });
    adminUserId = admin.id;

    const season = await prisma.season.create({
      data: {
        year: 2095,
        sport: `W1-${suffix}`,
        active: false,
        fantasyScoringVersion: FANTASYTRACK_NFL_HALF_PPR_V2,
      },
    });
    seasonId = season.id;

    const startsAt = new Date("2026-09-07T00:00:00Z");
    const endsAt = new Date("2026-09-15T00:00:00Z");
    lockAt = new Date("2026-09-14T15:00:00Z");
    revealStartsAt = new Date("2026-09-14T16:00:00Z");
    publicReleaseAt = new Date("2026-09-14T18:00:00Z");
    const rankingsOpenAt = new Date("2026-09-01T00:00:00Z");

    const week = await createWeek({
      seasonId,
      weekNumber: 1,
      label: `[TEST] Week 1 ${suffix}`,
      startsAt,
      endsAt,
      status: "OPEN",
      rankingsOpenAt,
      fullLockAt: lockAt,
      revealStartsAt,
      publicReleaseAt,
      isTest: true,
    });
    weekId = week.id;

    await commitManualSchedule({ weekId, text: SCHEDULE, adminUserId });
    await ensureFivePositionContests(weekId);

    const rbNames = [
      "Star Runner",
      "Backup Tyler",
      "Mid Rank",
      "Spot Nineteen",
      "Deep Bench",
      "RB Filler 06",
      "RB Filler 07",
      "RB Filler 08",
      "RB Filler 09",
      "RB Filler 10",
      "RB Filler 11",
      "RB Filler 12",
      "RB Filler 13",
      "RB Filler 14",
      "RB Filler 15",
      "RB Filler 16",
      "RB Filler 17",
      "RB Filler 18",
    ];

    async function addPlayer(
      name: string,
      position: ContestPosition,
      team: "MIN" | "DET",
    ) {
      const entry = await prisma.rankableEntry.create({
        data: {
          provider: "manual",
          externalId: `w1-${suffix}-${position}-${name.replace(/\s+/g, "-").toLowerCase()}`,
          type: position === "DEF" ? "DEFENSE" : "PLAYER",
          name,
          shortName: name.split(" ").pop() ?? name,
          team,
          opponent: team === "MIN" ? "@ DET" : "vs MIN",
          position,
          active: true,
        },
      });
      await enrollSeasonPlayer({
        seasonId,
        rankableEntryId: entry.id,
        team,
      });
      players.set(`${position}:${name}`, {
        id: entry.id,
        name,
        position,
      });
      return entry.id;
    }

    for (const [index, name] of rbNames.entries()) {
      const id = await addPlayer(name, "RB", index % 2 === 0 ? "MIN" : "DET");
      if (name === "Backup Tyler") rbBackupId = id;
      if (name === "Star Runner") rbStarId = id;
    }

    for (const position of ["QB", "WR", "TE"] as ContestPosition[]) {
      const count = position === "WR" ? 18 : 14;
      for (let i = 1; i <= count; i += 1) {
        await addPlayer(
          `${position} Player ${String(i).padStart(2, "0")}`,
          position,
          i % 2 === 0 ? "MIN" : "DET",
        );
      }
    }

    for (const position of CONTEST_POSITIONS) {
      if (position === "DEF") continue;
      await syncWeeklyEligibleFieldFromSeason({
        weekId,
        position,
        scheduledTeamsOnly: true,
      });
    }

    await buildDefensePoolFromSchedule({ weekId, adminUserId });

    await prisma.rankIQContest.updateMany({
      where: { weekId },
      data: { status: "OPEN" },
    });

    const contests = await prisma.rankIQContest.findMany({ where: { weekId } });
    for (const contest of contests) {
      contestIds.set(contest.position, contest.id);
    }

    const rbContestId = contestIds.get("RB")!;
    const starEntry = await prisma.contestEntry.findFirstOrThrow({
      where: { contestId: rbContestId, rankableEntryId: rbStarId },
    });
    await deactivateWeeklyPlayer({
      contestEntryId: starEntry.id,
      inactiveReason: "Injury scratch — test exception",
    });
    excludedEntryId = starEntry.id;

    await autoSyncWeeklyEligibilityForWeek(weekId);

    const excludedAfter = await prisma.contestEntry.findUniqueOrThrow({
      where: { id: excludedEntryId },
    });
    expect(excludedAfter.excluded).toBe(true);
    expect(excludedAfter.inactiveReason).toContain("Injury scratch");

    const humanLabels = [
      "Consensus Human",
      "Contrarian Human",
      "Poor Human",
      "Strong Human",
      "Backup Picker",
    ];
    for (const label of humanLabels) {
      const profile = await prisma.universalProfile.create({
        data: {
          username: `w1-h-${label.replace(/\s+/g, "-").toLowerCase()}-${suffix}`,
          displayName: label,
          profileType: "HUMAN",
        },
      });
      humanIds.push(profile.id);
    }

    for (let i = 1; i <= 2; i += 1) {
      const ai = await prisma.universalProfile.create({
        data: {
          username: `w1-ai-${i}-${suffix}`,
          displayName: `AI Model ${i}`,
          profileType: "AI",
        },
      });
      aiIds.push(ai.id);
    }

    for (let i = 1; i <= 2; i += 1) {
      const expert = await prisma.universalProfile.create({
        data: {
          username: `w1-expert-${i}-${suffix}`,
          displayName: `Expert Source ${i}`,
          profileType: "BENCHMARK",
        },
      });
      expertIds.push(expert.id);
    }
  });

  afterAll(async () => {
    await prisma.season.delete({ where: { id: seasonId } }).catch(() => {});
    vi.unstubAllEnvs();
  });

  it("has season universe, schedule sync, and pool readiness", async () => {
    const seasonPlayers = await prisma.seasonPlayer.count({ where: { seasonId } });
    expect(seasonPlayers).toBeGreaterThan(40);

    const syncStatus = await getWeeklyEligibilitySyncStatus(weekId);
    expect(syncStatus.hasSchedule).toBe(true);
    expect(syncStatus.activePoolEntries).toBeGreaterThan(50);

    const audit = await auditAllPools(weekId);
    expect(audit.ready).toBe(true);

    const exceptions = await getWeeklyExceptionReview(weekId);
    expect(
      exceptions.exceptions.some(
        (row) => row.kind === "excluded_player" && row.name === "Star Runner",
      ),
    ).toBe(true);

    for (const position of CONTEST_POSITIONS) {
      const contest = await prisma.rankIQContest.findUniqueOrThrow({
        where: { weekId_position: { weekId, position } },
      });
      expect(contest.rankingDepth).toBe(rankingDepthForPosition(position));
      const scoring = await resolveScoringConfigForContest(contest.id);
      expect(scoring.slug).toBe(RANKEYEQ_V1_SLUG);

      const backupEntry = await prisma.contestEntry.findFirst({
        where: {
          contestId: contest.id,
          rankableEntryId: rbBackupId,
          excluded: false,
        },
      });
      if (position === "RB") {
        expect(backupEntry).not.toBeNull();
      }
    }
  });

  it("accepts human, AI, and expert submissions", async () => {
    const rbContestId = contestIds.get("RB")!;
    const activeRb = await prisma.contestEntry.findMany({
      where: { contestId: rbContestId, excluded: false },
      include: { rankableEntry: true },
      orderBy: { seedRank: "asc" },
    });
    const rbIds = activeRb.map((row) => row.rankableEntryId);
    expect(rbIds).toContain(rbBackupId);
    expect(rbIds).not.toContain(rbStarId);

    const consensusOrder = rbIds.slice(0, 10);
    const contrarianOrder = [
      rbBackupId,
      ...rbIds.filter((id) => id !== rbBackupId).slice(0, 9),
    ];
    const poorOrder = [...rbIds].reverse().slice(0, 10);
    const strongOrder = consensusOrder;
    const backupPickerOrder = [
      rbBackupId,
      ...consensusOrder.filter((id) => id !== rbBackupId).slice(0, 9),
    ];

    const humanOrders = [
      consensusOrder,
      contrarianOrder,
      poorOrder,
      strongOrder,
      backupPickerOrder,
    ];

    for (const [index, profileId] of humanIds.entries()) {
      await submitRanking({
        contestId: rbContestId,
        universalProfileId: profileId,
        rankedEntryIds: humanOrders[index]!,
      });
    }

    for (const profileId of aiIds) {
      await submitRanking({
        contestId: rbContestId,
        universalProfileId: profileId,
        rankedEntryIds: consensusOrder,
      });
    }

    const expertPaste = extractTopNFromPastedText({
      text: activeRb
        .slice(0, 10)
        .map((row, index) => `${index + 1}. ${row.rankableEntry.name}`)
        .join("\n"),
      eligible: activeRb.map((row) => ({
        id: row.rankableEntryId,
        name: row.rankableEntry.name,
        shortName: row.rankableEntry.shortName,
        team: row.rankableEntry.team,
        position: "RB",
      })),
      rankingDepth: 10,
    });
    expect(expertPaste.ready).toBe(true);

    const capturedAt = new Date("2026-09-12T18:00:00Z");
    for (const [index, expertId] of expertIds.entries()) {
      const order =
        index === 0 ? consensusOrder : contrarianOrder;
      await captureBenchmarkSnapshot({
        contestId: rbContestId,
        universalProfileId: expertId,
        adminUserId,
        captureType: "MANUAL_FINAL",
        capturedAt,
        picks: order.map((rankableEntryId, rankIndex) => ({
          sourceRank: rankIndex + 1,
          rawName:
            activeRb.find((row) => row.rankableEntryId === rankableEntryId)
              ?.rankableEntry.name ?? "",
          rankableEntryId,
          rankIqRank: rankIndex + 1,
          excluded: false,
          exclusionReason: null,
          issue: null,
          selected: true,
        })),
        commitOfficial: true,
      });
    }

    const expertSubs = await prisma.rankingSubmission.count({
      where: {
        contestId: rbContestId,
        universalProfile: { profileType: "BENCHMARK" },
        status: { in: ["LOCKED", "SUBMITTED"] },
      },
    });
    expect(expertSubs).toBe(2);

    for (const position of CONTEST_POSITIONS) {
      if (position === "RB") continue;
      const contestId = contestIds.get(position)!;
      const entries = await prisma.contestEntry.findMany({
        where: { contestId, excluded: false },
        orderBy: { seedRank: "asc" },
      });
      const depth = rankingDepthForPosition(position);
      const ranked = entries.slice(0, depth).map((row) => row.rankableEntryId);
      await submitRanking({
        contestId,
        universalProfileId: humanIds[0]!,
        rankedEntryIds: ranked,
      });
      await submitRanking({
        contestId,
        universalProfileId: aiIds[0]!,
        rankedEntryIds: ranked,
      });
    }
  });

  it("builds pre-lock consensus with group-weighted All metrics", async () => {
    expect(getConsensusAllMode()).toBe("group_weighted");

    const rbContestId = contestIds.get("RB")!;
    const human = await getContestConsensus(rbContestId, "HUMAN");
    const expert = await getContestConsensus(rbContestId, "EXPERT");
    const ai = await getContestConsensus(rbContestId, "AI");
    const all = await getContestConsensus(rbContestId, "ALL");

    expect(human.sampleSize).toBe(5);
    expect(expert.sampleSize).toBe(2);
    expect(ai.sampleSize).toBe(2);
    expect(all.sampleSize).toBe(3);

    const backupHuman = human.entries.find(
      (row) => row.rankableEntryId === rbBackupId,
    );
    const backupExpert = expert.entries.find(
      (row) => row.rankableEntryId === rbBackupId,
    );
    const backupAi = ai.entries.find((row) => row.rankableEntryId === rbBackupId);
    const backupAll = all.entries.find(
      (row) => row.rankableEntryId === rbBackupId,
    );

    expect(backupHuman?.selectionRate).toBeGreaterThan(0);
    expect(backupExpert?.selectionRate).toBeGreaterThan(0);
    expect(backupAi?.selectionRate).toBe(1);

    if (
      backupHuman &&
      backupExpert &&
      backupAll &&
      backupHuman.selectionRate != null &&
      backupExpert.selectionRate != null
    ) {
      const expectedAllRate =
        (backupHuman.selectionRate +
          backupExpert.selectionRate +
          (backupAi?.selectionRate ?? 0)) /
        (backupAi?.selectionRate ? 3 : 2);
      expect(backupAll.selectionRate).toBeCloseTo(expectedAllRate, 4);
    }

    const polarizing = human.entries.find(
      (row) =>
        row.selectionRate > 0 &&
        row.selectionRate < 1 &&
        row.averageSelectedRank != null &&
        row.averageSelectedRank > 5,
    );
    expect(polarizing).toBeDefined();
  });

  it("locks week, captures snapshots, and supports reveal window", async () => {
    const afterLock = new Date(lockAt.getTime() + 60_000);
    const lockResult = await ensureWeekFullLock(weekId, afterLock);
    expect(lockResult.lockedContests).toBe(5);
    expect(lockResult.lockedSubmissions).toBeGreaterThan(0);

    const snapshot = await prisma.contestPregameSnapshot.findFirst({
      where: { contest: { weekId, position: "RB" } },
    });
    expect(snapshot).not.toBeNull();
    expect(snapshot?.allConsensusMode).toBe("group_weighted");
    expect(snapshot?.sampleSizeHuman).toBe(5);
    expect(snapshot?.sampleSizeExpert).toBe(2);

    const revealNow = new Date(revealStartsAt.getTime() + 60_000);
    const week = await prisma.week.findUniqueOrThrow({ where: { id: weekId } });
    expect(isRevealWindowActive(week, revealNow)).toBe(true);
    expect(
      canViewCurrentWeekBoard({
        week,
        contest: { status: "LOCKED" },
        viewer: { profileId: humanIds[0]!, isAdmin: false },
        targetProfileId: humanIds[0]!,
        now: revealNow,
      }),
    ).toBe(true);
  });

  it("imports results, finalizes, grades, and archives Week 1", async () => {
    const rbContestId = contestIds.get("RB")!;
    const activeRb = await prisma.contestEntry.findMany({
      where: { contestId: rbContestId, excluded: false },
      include: { rankableEntry: true },
    });

    const pointsByName = new Map<string, number>();
    for (const row of activeRb) {
      const name = row.rankableEntry.name;
      if (name === "Backup Tyler") pointsByName.set(name, 28);
      else if (name === "Star Runner") pointsByName.set(name, 8);
      else if (name === "Mid Rank") pointsByName.set(name, 16);
      else if (name === "Spot Nineteen") pointsByName.set(name, 11.5);
      else if (name === "Deep Bench") pointsByName.set(name, 4);
      else if (name === "RB Filler 06") pointsByName.set(name, 28);
      else pointsByName.set(name, 20 - activeRb.indexOf(row) * 0.5);
    }

    const rbPaste = [...pointsByName.entries()]
      .map(([name, pts]) => `${name} | ${pts}`)
      .join("\n");
    await commitFantasyPointsPaste({
      weekId,
      text: rbPaste,
      adminUserId,
      position: "RB",
    });

    const omitted = await prisma.rankableEntry.create({
      data: {
        provider: "manual",
        externalId: `w1-${suffix}-rb-omitted`,
        type: "PLAYER",
        name: "Omitted League RB",
        shortName: "Omitted",
        team: "MIN",
        opponent: "@ DET",
        position: "RB",
        active: true,
      },
    });
    await prisma.playerWeekStat.create({
      data: {
        provider: "manual",
        weekId,
        rankableEntryId: omitted.id,
        externalPlayerId: omitted.externalId,
        fantasyPoints: 29,
        scoringVersion: FANTASYTRACK_NFL_HALF_PPR_V2,
        isProvisional: false,
      },
    });

    for (const position of CONTEST_POSITIONS) {
      if (position === "RB" || position === "DEF") continue;
      const contestId = contestIds.get(position)!;
      const entries = await prisma.contestEntry.findMany({
        where: { contestId, excluded: false },
        include: { rankableEntry: true },
      });
      const paste = entries
        .map((row, index) => `${row.rankableEntry.name} | ${22 - index}`)
        .join("\n");
      await commitFantasyPointsPaste({
        weekId,
        text: paste,
        adminUserId,
        position,
      });
    }

    const defContestId = contestIds.get("DEF")!;
    const defEntries = await prisma.contestEntry.findMany({
      where: { contestId: defContestId, excluded: false },
      include: { rankableEntry: true },
    });
    const defPaste = defEntries
      .map((row, index) => `${row.rankableEntry.name} | ${18 - index}`)
      .join("\n");
    await commitFantasyPointsPaste({
      weekId,
      text: defPaste,
      adminUserId,
      position: "DEF",
    });

    const result = await finalizeWeek({
      weekId,
      resultsVerified: true,
      adminUserId,
    });
    expect(result.contestsGraded).toBe(5);

    const backupFinish = await prisma.contestEntry.findFirstOrThrow({
      where: { contestId: rbContestId, rankableEntryId: rbBackupId },
    });
    expect(backupFinish.actualRank).not.toBeNull();
    expect(backupFinish.actualRank!).toBeLessThanOrEqual(5);

    const weeklyHumans = await getWeeklyLeaderboard({
      weekId,
      filter: "HUMAN",
      includeTest: true,
    });
    const weeklyExperts = await getWeeklyLeaderboard({
      weekId,
      filter: "EXPERT",
      includeTest: true,
    });
    const weeklyAi = await getWeeklyLeaderboard({
      weekId,
      filter: "AI",
      includeTest: true,
    });
    expect(weeklyHumans.length).toBeGreaterThan(0);
    expect(weeklyExperts.length).toBeGreaterThan(0);
    expect(weeklyAi.length).toBeGreaterThan(0);

    const seasonBoard = await getSeasonLeaderboard({
      seasonId,
      position: "RB",
      filter: "ALL",
      includeTest: true,
    });
    expect(seasonBoard.length).toBeGreaterThan(0);

    const performance = await getPlayerPerformanceLeaderboard({
      seasonId,
      position: "RB",
      window: "week-1",
      includeTest: true,
      currentWeekNumber: 1,
    });
    const backupPerf = performance.rows.find(
      (row) => row.rankableEntryId === rbBackupId,
    );
    expect(backupPerf).toBeDefined();
    expect(backupPerf!.top5Finishes).toBeGreaterThanOrEqual(1);

    const strongSubmission = await prisma.rankingSubmission.findFirst({
      where: {
        universalProfileId: humanIds[3]!,
        status: "GRADED",
      },
    });
    expect(strongSubmission).not.toBeNull();
    expect(strongSubmission?.normalizedScore).not.toBeNull();

    const postConsensus = await getContestConsensus(rbContestId, "HUMAN");
    const backupPost = postConsensus.entries.find(
      (row) => row.rankableEntryId === rbBackupId,
    );
    expect(postConsensus.fromSnapshot).toBe(true);
    expect(backupPost?.actualRank).toBe(backupFinish.actualRank);
    expect(backupPost?.selectionRate).toBeGreaterThan(0);
    expect(backupPost?.selectionRate).toBeLessThan(1);

    await archiveWeek(weekId);
    const archived = await prisma.week.findUniqueOrThrow({ where: { id: weekId } });
    expect(archived.status).toBe("ARCHIVED");
    expect(isWeekHistoricallyPublic(archived, new Date())).toBe(true);
  });

  it("preserves historical Week 1 after post-finalize mutations", async () => {
    const rbContestId = contestIds.get("RB")!;
    const before = await getContestConsensus(rbContestId, "ALL");
    const backupBefore = before.entries.find(
      (row) => row.rankableEntryId === rbBackupId,
    );
    const sampleBefore = before.sampleSize;

    const submission = await prisma.rankingSubmission.findFirstOrThrow({
      where: { contestId: rbContestId, universalProfileId: humanIds[0] },
      include: { picks: true },
    });
    const pickAt1 = submission.picks.find((pick) => pick.predictedRank === 1);
    const pickAt2 = submission.picks.find((pick) => pick.predictedRank === 2);
    if (pickAt1 && pickAt2) {
      await prisma.rankingPick.update({
        where: { id: pickAt1.id },
        data: { predictedRank: 99 },
      });
      await prisma.rankingPick.update({
        where: { id: pickAt2.id },
        data: { predictedRank: 1 },
      });
      await prisma.rankingPick.update({
        where: { id: pickAt1.id },
        data: { predictedRank: 2 },
      });
    }

    await prisma.rankableEntry.update({
      where: { id: rbBackupId },
      data: { team: "DAL" },
    });

    const after = await getContestConsensus(rbContestId, "ALL");
    const backupAfter = after.entries.find(
      (row) => row.rankableEntryId === rbBackupId,
    );

    expect(after.fromSnapshot).toBe(true);
    expect(after.sampleSize).toBe(sampleBefore);
    expect(backupAfter?.selectionRate).toBe(backupBefore?.selectionRate);
    expect(backupAfter?.averageSelectedRank).toBe(
      backupBefore?.averageSelectedRank,
    );
  });
});

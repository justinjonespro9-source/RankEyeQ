import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { logAdminAction } from "@/lib/admin/audit";
import {
  captureBenchmarkSnapshot,
  markBenchmarkNotAvailable,
} from "@/lib/benchmarks/snapshots";
import { filterEligibleConsensusSubmissions } from "@/lib/consensus-filters";
import { prisma } from "@/lib/db";
import { getFinalizeWeekReadiness } from "@/lib/nfl/finalize-week";
import { gradeContest } from "@/lib/grading";
import { getWeeklyLeaderboard } from "@/lib/leaderboards";
import { scoreContest } from "@/lib/scoring";
import { zonedLocalToUtc } from "@/lib/timing/chicago";
import { benchmarkAffiliationDisclaimer } from "@/lib/benchmark-sources";

const suffix = `bm${Date.now()}`;
const thursdayKickoff = zonedLocalToUtc(2026, 9, 10, 19, 20);
const sundayKickoff = zonedLocalToUtc(2026, 9, 13, 12, 0);
const sundayLock = zonedLocalToUtc(2026, 9, 13, 10, 0);

describe("benchmark snapshots, scoring, and leaderboards", () => {
  let seasonId = "";
  let weekId = "";
  let contestId = "";
  let otherContestId = "";
  let adminUserId = "";
  let humanId = "";
  let expertId = "";
  let entryIds: string[] = [];
  const extraProfileIds: string[] = [];

  beforeAll(async () => {
    const season = await prisma.season.create({
      data: {
        year: 2097,
        sport: `BM-${suffix}`,
        active: false,
      },
    });
    seasonId = season.id;

    const week = await prisma.week.create({
      data: {
        seasonId,
        weekNumber: 1,
        label: "Benchmark Test Week",
        startsAt: zonedLocalToUtc(2026, 9, 8, 0, 0),
        endsAt: zonedLocalToUtc(2026, 9, 15, 0, 0),
        status: "OPEN",
        fullLockAt: sundayLock,
        isTest: true,
      },
    });
    weekId = week.id;

    const contest = await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId,
        position: "QB",
        title: "Benchmark QB",
        rankingDepth: 4,
        status: "OPEN",
      },
    });
    contestId = contest.id;

    const other = await prisma.rankIQContest.create({
      data: {
        seasonId,
        weekId,
        position: "RB",
        title: "Benchmark RB",
        rankingDepth: 4,
        status: "OPEN",
      },
    });
    otherContestId = other.id;

    const admin = await prisma.user.create({
      data: {
        email: `bm-admin-${suffix}@rankiq.local`,
        role: "ADMIN",
        emailVerified: new Date(),
        name: "Benchmark Admin",
      },
    });
    adminUserId = admin.id;

    const [human, expert] = await Promise.all([
      prisma.universalProfile.create({
        data: {
          username: `bm_h_${suffix}`,
          displayName: "Benchmark Human",
          profileType: "HUMAN",
        },
      }),
      prisma.universalProfile.create({
        data: {
          username: `bm_ex_${suffix}`,
          displayName: "ESPN Fantasy Test",
          profileType: "BENCHMARK",
        },
      }),
    ]);
    humanId = human.id;
    expertId = expert.id;
    extraProfileIds.push(humanId, expertId);

    entryIds = [];
    for (let i = 1; i <= 6; i += 1) {
      const thursday = i === 2;
      const entry = await prisma.rankableEntry.create({
        data: {
          provider: "test",
          externalId: `bm-${suffix}-${i}`,
          type: "PLAYER",
          name: `Bench QB ${i}`,
          shortName: `BQ${i}`,
          team: "TST",
          opponent: "@ OPP",
          position: "QB",
          gameStartsAt: thursday ? thursdayKickoff : sundayKickoff,
        },
      });
      await prisma.contestEntry.create({
        data: {
          contestId,
          rankableEntryId: entry.id,
          actualRank: i <= 4 ? i : null,
          fantasyPoints: i <= 4 ? 40 - i : null,
        },
      });
      entryIds.push(entry.id);
    }
  });

  afterAll(async () => {
    await prisma.rankingPick.deleteMany({
      where: { submission: { contest: { weekId } } },
    });
    await prisma.rankingSubmission.deleteMany({
      where: { contest: { weekId } },
    });
    await prisma.benchmarkSnapshotPick.deleteMany({
      where: { snapshot: { weekId } },
    });
    await prisma.benchmarkSnapshot.deleteMany({ where: { weekId } });
    await prisma.contestEntry.deleteMany({
      where: { contest: { weekId } },
    });
    await prisma.rankableEntry.deleteMany({
      where: { provider: "test", externalId: { startsWith: `bm-${suffix}-` } },
    });
    await prisma.rankIQContest.deleteMany({ where: { weekId } });
    await prisma.week.delete({ where: { id: weekId } });
    await prisma.season.delete({ where: { id: seasonId } });
    await prisma.adminAuditLog.deleteMany({ where: { adminUserId } });
    await prisma.user.delete({ where: { id: adminUserId } });
    await prisma.universalProfile.deleteMany({
      where: { id: { in: extraProfileIds } },
    });
  });

  it("locks Thursday rank, fills Sunday remainder, and scores with lib/scoring.ts", async () => {
    const thursday = await captureBenchmarkSnapshot({
      contestId,
      universalProfileId: expertId,
      adminUserId,
      captureType: "THURSDAY",
      capturedAt: zonedLocalToUtc(2026, 9, 10, 12, 0),
      rawText: "thursday paste",
      picks: [
        {
          sourceRank: 1,
          rawName: "Bench QB 1",
          rankableEntryId: entryIds[0],
          rankIqRank: 1,
          excluded: false,
          exclusionReason: null,
          issue: null,
          selected: true,
        },
        {
          sourceRank: 2,
          rawName: "Bench QB 2",
          rankableEntryId: entryIds[1],
          rankIqRank: 2,
          excluded: false,
          exclusionReason: null,
          issue: null,
          selected: true,
        },
        {
          sourceRank: 3,
          rawName: "Bench QB 3",
          rankableEntryId: entryIds[2],
          rankIqRank: 3,
          excluded: false,
          exclusionReason: null,
          issue: null,
          selected: true,
        },
        {
          sourceRank: 4,
          rawName: "Bench QB 4",
          rankableEntryId: entryIds[3],
          rankIqRank: 4,
          excluded: false,
          exclusionReason: null,
          issue: null,
          selected: true,
        },
      ],
    });
    expect(thursday.official).toBe(false);
    expect(thursday.snapshot.status).toBe("CAPTURED");

    const sunday = await captureBenchmarkSnapshot({
      contestId,
      universalProfileId: expertId,
      adminUserId,
      captureType: "SUNDAY",
      capturedAt: zonedLocalToUtc(2026, 9, 13, 9, 50),
      rawText: "sunday paste",
      picks: [
        {
          sourceRank: 1,
          rawName: "Bench QB 2",
          rankableEntryId: entryIds[1],
          rankIqRank: 1,
          excluded: false,
          exclusionReason: null,
          issue: null,
          selected: true,
        },
        {
          sourceRank: 2,
          rawName: "Bench QB 5",
          rankableEntryId: entryIds[4],
          rankIqRank: 2,
          excluded: false,
          exclusionReason: null,
          issue: null,
          selected: true,
        },
        {
          sourceRank: 3,
          rawName: "Bench QB 3",
          rankableEntryId: entryIds[2],
          rankIqRank: 3,
          excluded: false,
          exclusionReason: null,
          issue: null,
          selected: true,
        },
        {
          sourceRank: 4,
          rawName: "Bench QB 4",
          rankableEntryId: entryIds[3],
          rankIqRank: 4,
          excluded: false,
          exclusionReason: null,
          issue: null,
          selected: true,
        },
      ],
    });
    expect(sunday.late).toBe(false);
    expect(sunday.official).toBe(true);

    const submission = await prisma.rankingSubmission.findUniqueOrThrow({
      where: {
        contestId_universalProfileId: {
          contestId,
          universalProfileId: expertId,
        },
      },
      include: { picks: { orderBy: { predictedRank: "asc" } } },
    });
    expect(submission.status).toBe("LOCKED");
    expect(submission.picks.find((pick) => pick.rankableEntryId === entryIds[1])?.predictedRank).toBe(
      2,
    );
    expect(
      submission.picks.find((pick) => pick.rankableEntryId === entryIds[1])?.slotLocked,
    ).toBe(true);

    await prisma.rankingSubmission.create({
      data: {
        contestId,
        universalProfileId: humanId,
        status: "LOCKED",
        submittedAt: zonedLocalToUtc(2026, 9, 13, 9, 50),
        lockedAt: zonedLocalToUtc(2026, 9, 13, 9, 50),
        picks: {
          create: submission.picks.map((pick) => ({
            rankableEntryId: pick.rankableEntryId,
            predictedRank: pick.predictedRank,
          })),
        },
      },
    });

    await prisma.rankIQContest.update({
      where: { id: contestId },
      data: { status: "LOCKED" },
    });
    await gradeContest(contestId);

    const [expertSub, humanSub] = await Promise.all([
      prisma.rankingSubmission.findUniqueOrThrow({
        where: {
          contestId_universalProfileId: {
            contestId,
            universalProfileId: expertId,
          },
        },
        include: { picks: { orderBy: { predictedRank: "asc" } } },
      }),
      prisma.rankingSubmission.findUniqueOrThrow({
        where: {
          contestId_universalProfileId: {
            contestId,
            universalProfileId: humanId,
          },
        },
      }),
    ]);
    expect(expertSub.status).toBe("GRADED");
    expect(expertSub.normalizedScore).toBe(humanSub.normalizedScore);
    expect(expertSub.rawScore).toBe(humanSub.rawScore);

    const engine = scoreContest(
      expertSub.picks.map((pick) => ({
        playerId: pick.rankableEntryId,
        playerName: pick.rankableEntryId,
        predictedRank: pick.predictedRank,
        actualRank: pick.actualRank ?? 99,
      })),
      4,
    );
    expect(expertSub.normalizedScore).toBe(engine.rankIqScore);

    const experts = await getWeeklyLeaderboard({
      weekId,
      filter: "EXPERT",
      includeTest: true,
    });
    const humans = await getWeeklyLeaderboard({
      weekId,
      filter: "HUMAN",
      includeTest: true,
    });
    expect(experts.some((row) => row.universalProfileId === expertId)).toBe(true);
    expect(humans.some((row) => row.universalProfileId === expertId)).toBe(false);
    expect(humans.some((row) => row.universalProfileId === humanId)).toBe(true);

    const community = filterEligibleConsensusSubmissions(
      [
        { status: expertSub.status, profileType: "BENCHMARK" as const },
        { status: humanSub.status, profileType: "HUMAN" as const },
      ],
      "ALL",
    );
    expect(community).toHaveLength(1);
    expect(
      filterEligibleConsensusSubmissions(
        [{ status: expertSub.status, profileType: "BENCHMARK" as const }],
        "EXPERT",
      ),
    ).toHaveLength(1);
  });

  it("excludes late captures from official scoring and preserves snapshot history", async () => {
    const lateExpert = await prisma.universalProfile.create({
      data: {
        username: `bm_late_${suffix}`,
        displayName: "Late Source",
        profileType: "BENCHMARK",
      },
    });
    extraProfileIds.push(lateExpert.id);

    const first = await captureBenchmarkSnapshot({
      contestId,
      universalProfileId: lateExpert.id,
      adminUserId,
      captureType: "SUNDAY",
      capturedAt: zonedLocalToUtc(2026, 9, 13, 11, 0),
      rawText: "late",
      picks: entryIds.slice(0, 4).map((id, index) => ({
        sourceRank: index + 1,
        rawName: `Bench QB ${index + 1}`,
        rankableEntryId: id,
        rankIqRank: index + 1,
        excluded: false,
        exclusionReason: null,
        issue: null,
        selected: true,
      })),
    });
    expect(first.late).toBe(true);
    expect(first.official).toBe(false);
    expect(first.warnings.some((warning) => /not eligible for official/.test(warning))).toBe(
      true,
    );

    const submission = await prisma.rankingSubmission.findUnique({
      where: {
        contestId_universalProfileId: {
          contestId,
          universalProfileId: lateExpert.id,
        },
      },
    });
    expect(submission).toBeNull();

    const correction = await captureBenchmarkSnapshot({
      contestId,
      universalProfileId: lateExpert.id,
      adminUserId,
      captureType: "SUNDAY",
      capturedAt: zonedLocalToUtc(2026, 9, 13, 11, 5),
      rawText: "late correction",
      correctionOfId: first.snapshot.id,
      correctionReason: "Transcription error",
      picks: entryIds.slice(0, 4).map((id, index) => ({
        sourceRank: index + 1,
        rawName: `Bench QB ${index + 1}`,
        rankableEntryId: id,
        rankIqRank: index + 1,
        excluded: false,
        exclusionReason: null,
        issue: null,
        selected: true,
      })),
    });
    expect(correction.snapshot.correctionOfId).toBe(first.snapshot.id);

    await logAdminAction({
      adminUserId,
      action: "benchmark.snapshot_corrected",
      entityType: "BenchmarkSnapshot",
      entityId: correction.snapshot.id,
      metadata: { correctionOfId: first.snapshot.id, reason: "Transcription error" },
    });
    const audit = await prisma.adminAuditLog.findFirst({
      where: {
        adminUserId,
        action: "benchmark.snapshot_corrected",
        entityId: correction.snapshot.id,
      },
    });
    expect(audit).toBeTruthy();

    const history = await prisma.benchmarkSnapshot.findMany({
      where: { universalProfileId: lateExpert.id, contestId },
    });
    expect(history.length).toBeGreaterThanOrEqual(2);
  });

  it("cannot add a Thursday-absent player after kickoff", async () => {
    const source = await prisma.universalProfile.create({
      data: {
        username: `bm_thu_${suffix}`,
        displayName: "Thursday Rule Source",
        profileType: "BENCHMARK",
      },
    });
    extraProfileIds.push(source.id);

    await captureBenchmarkSnapshot({
      contestId,
      universalProfileId: source.id,
      adminUserId,
      captureType: "THURSDAY",
      capturedAt: zonedLocalToUtc(2026, 9, 10, 12, 0),
      picks: [0, 2, 3, 4].map((index, rankIndex) => ({
        sourceRank: rankIndex + 1,
        rawName: `Bench QB ${index + 1}`,
        rankableEntryId: entryIds[index],
        rankIqRank: rankIndex + 1,
        excluded: false,
        exclusionReason: null,
        issue: null,
        selected: true,
      })),
    });

    const sunday = await captureBenchmarkSnapshot({
      contestId,
      universalProfileId: source.id,
      adminUserId,
      captureType: "SUNDAY",
      capturedAt: zonedLocalToUtc(2026, 9, 13, 9, 50),
      picks: [1, 0, 2, 3].map((index, rankIndex) => ({
        sourceRank: rankIndex + 1,
        rawName: `Bench QB ${index + 1}`,
        rankableEntryId: entryIds[index],
        rankIqRank: rankIndex + 1,
        excluded: false,
        exclusionReason: null,
        issue: null,
        selected: true,
      })),
    });
    expect(sunday.warnings.some((warning) => /cannot be added/.test(warning))).toBe(
      true,
    );
    const submission = await prisma.rankingSubmission.findUnique({
      where: {
        contestId_universalProfileId: {
          contestId,
          universalProfileId: source.id,
        },
      },
      include: { picks: true },
    });
    expect(
      submission?.picks.some((pick) => pick.rankableEntryId === entryIds[1]),
    ).toBeFalsy();
  });

  it("marks NOT_AVAILABLE without blocking week finalization", async () => {
    const source = await prisma.universalProfile.create({
      data: {
        username: `bm_na_${suffix}`,
        displayName: "Missing TE Source",
        profileType: "BENCHMARK",
      },
    });
    extraProfileIds.push(source.id);
    await markBenchmarkNotAvailable({
      contestId: otherContestId,
      universalProfileId: source.id,
      adminUserId,
      notes: "Source did not publish RB",
    });
    const snapshot = await prisma.benchmarkSnapshot.findFirst({
      where: { contestId: otherContestId, universalProfileId: source.id },
    });
    expect(snapshot?.status).toBe("NOT_AVAILABLE");

    const readiness = await getFinalizeWeekReadiness(weekId);
    expect(readiness.reasons.join(" ")).not.toMatch(/benchmark/i);
    expect(readiness.reasons.join(" ")).not.toMatch(/NOT_AVAILABLE/);
  });

  it("exposes the public source disclaimer", () => {
    expect(benchmarkAffiliationDisclaimer("PFF")).toMatch(
      /This profile is not operated by or affiliated with PFF/,
    );
  });
});

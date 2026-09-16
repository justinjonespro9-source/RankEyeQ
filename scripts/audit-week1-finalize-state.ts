/**
 * Audit production Week 1 post-finalization public state.
 * Usage: dotenv -e .env.production.local -- tsx scripts/audit-week1-finalize-state.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { isScorablePickCount } from "@/lib/contest-defaults";

async function main() {
  const week = await prisma.week.findFirst({
    where: {
      weekNumber: 1,
      isTest: false,
      season: { year: 2026, sport: "NFL" },
    },
    include: {
      season: { select: { year: true, sport: true } },
      contests: {
        orderBy: { position: "asc" },
        include: {
          pregameSnapshot: {
            select: {
              id: true,
              lockedAt: true,
              sampleSizeAll: true,
              sampleSizeHuman: true,
              sampleSizeAi: true,
              sampleSizeExpert: true,
              sampleSizeCreator: true,
              sampleSizePublisher: true,
              allConsensusMode: true,
            },
          },
        },
      },
    },
  });

  if (!week) {
    const any = await prisma.week.findMany({
      where: { weekNumber: 1, isTest: false },
      include: { season: true, contests: true },
      take: 5,
    });
    console.log("No 2026 NFL Week 1 — candidates:", JSON.stringify(any, null, 2));
    return;
  }

  console.log("=== WEEK ===");
  console.log({
    id: week.id,
    label: week.label,
    status: week.status,
    season: week.season,
    fullLockAt: week.fullLockAt,
  });

  for (const contest of week.contests) {
    const submissions = await prisma.rankingSubmission.findMany({
      where: { contestId: contest.id },
      include: {
        picks: { select: { id: true } },
        universalProfile: {
          select: {
            id: true,
            profileType: true,
            username: true,
            displayName: true,
            publicVisible: true,
            competitorActive: true,
            expertSource: { select: { sourceKind: true } },
          },
        },
      },
    });

    const byStatus: Record<string, number> = {};
    const byType: Record<
      string,
      {
        total: number;
        graded: number;
        withScore: number;
        publicVisible: number;
        pickCounts: Record<string, number>;
        scorable: number;
        unscorable: number;
        unscorableExamples: Array<{
          username: string;
          type: string;
          status: string;
          picks: number;
          publicVisible: boolean;
        }>;
      }
    > = {};

    for (const sub of submissions) {
      byStatus[sub.status] = (byStatus[sub.status] ?? 0) + 1;
      const sourceKind = sub.universalProfile.expertSource?.sourceKind;
      const type =
        sourceKind === "PUBLISHER_CONSENSUS" || sourceKind === "SITE_CONSENSUS"
          ? "PUBLISHER_CONSENSUS"
          : sub.universalProfile.profileType;
      if (!byType[type]) {
        byType[type] = {
          total: 0,
          graded: 0,
          withScore: 0,
          publicVisible: 0,
          pickCounts: {},
          scorable: 0,
          unscorable: 0,
          unscorableExamples: [],
        };
      }
      const bucket = byType[type];
      bucket.total += 1;
      if (sub.status === "GRADED") bucket.graded += 1;
      if (sub.normalizedScore != null) bucket.withScore += 1;
      if (sub.universalProfile.publicVisible) bucket.publicVisible += 1;
      const pc = String(sub.picks.length);
      bucket.pickCounts[pc] = (bucket.pickCounts[pc] ?? 0) + 1;
      const scorable = isScorablePickCount(
        sub.picks.length,
        contest.rankingDepth,
        contest.reserveCount ?? 0,
      );
      if (scorable) bucket.scorable += 1;
      else {
        bucket.unscorable += 1;
        if (bucket.unscorableExamples.length < 5) {
          bucket.unscorableExamples.push({
            username: sub.universalProfile.username,
            type: sub.universalProfile.profileType,
            status: sub.status,
            picks: sub.picks.length,
            publicVisible: sub.universalProfile.publicVisible,
          });
        }
      }
    }

    const entries = await prisma.contestEntry.groupBy({
      by: ["excluded"],
      where: { contestId: contest.id },
      _count: true,
    });
    const withPoints = await prisma.contestEntry.count({
      where: { contestId: contest.id, fantasyPoints: { not: null } },
    });
    const withRanks = await prisma.contestEntry.count({
      where: { contestId: contest.id, actualRank: { not: null } },
    });

    console.log(`\n=== ${contest.position} contest ===`);
    console.log(
      JSON.stringify(
        {
          contestId: contest.id,
          status: contest.status,
          rankingDepth: contest.rankingDepth,
          reserveCount: contest.reserveCount,
          entries,
          withPoints,
          withRanks,
          submissionStatus: byStatus,
          byProfileType: byType,
          pregameSnapshot: contest.pregameSnapshot,
        },
        null,
        2,
      ),
    );
  }

  const audits = await prisma.adminAuditLog.findMany({
    where: {
      entityType: "Week",
      entityId: week.id,
      action: {
        in: [
          "week.finalized",
          "week.graded",
          "week.actual_finishes_calculated",
          "week.finalize_manual_verified",
        ],
      },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  console.log("\n=== RECENT WEEK AUDIT LOGS ===");
  for (const row of audits) {
    console.log({
      action: row.action,
      createdAt: row.createdAt,
      metadata: row.metadata,
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

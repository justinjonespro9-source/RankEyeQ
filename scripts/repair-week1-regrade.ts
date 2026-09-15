/**
 * Safe Week 1 repair: set legacy reserveCount=0, regrade all contests,
 * mark week COMPLETE. Does not fabricate reserves or mutate picks/snapshots.
 *
 * Usage:
 *   dotenv -e .env.production.local -- npx tsx scripts/repair-week1-regrade.ts
 *   DRY_RUN=1 ... (report only)
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { gradeContest } from "@/lib/grading";
import { CONTEST_POSITIONS } from "@/lib/contest-defaults";

const DRY_RUN = process.env.DRY_RUN === "1";

async function main() {
  const week = await prisma.week.findFirst({
    where: {
      weekNumber: 1,
      isTest: false,
      season: { year: 2026, sport: "NFL" },
    },
    include: {
      season: true,
      contests: { orderBy: { position: "asc" } },
    },
  });

  if (!week) {
    throw new Error("Production 2026 NFL Week 1 not found");
  }

  console.log("Week", {
    id: week.id,
    label: week.label,
    status: week.status,
    contests: week.contests.map((c) => ({
      position: c.position,
      status: c.status,
      rankingDepth: c.rankingDepth,
      reserveCount: c.reserveCount,
    })),
  });

  if (!DRY_RUN) {
    const updated = await prisma.rankIQContest.updateMany({
      where: { weekId: week.id },
      data: { reserveCount: 0 },
    });
    console.log(`Set reserveCount=0 on ${updated.count} contests`);
  } else {
    console.log("DRY_RUN: would set reserveCount=0 on all Week 1 contests");
  }

  const results = [];
  for (const position of CONTEST_POSITIONS) {
    const contest = week.contests.find((c) => c.position === position);
    if (!contest) {
      results.push({ position, error: "contest missing" });
      continue;
    }

    if (DRY_RUN) {
      const eligible = await prisma.rankingSubmission.findMany({
        where: {
          contestId: contest.id,
          status: { in: ["SUBMITTED", "LOCKED", "GRADED"] },
        },
        include: {
          picks: { select: { id: true } },
          universalProfile: {
            select: { username: true, profileType: true, publicVisible: true },
          },
        },
      });
      results.push({
        position,
        contestId: contest.id,
        status: contest.status,
        reserveCount: contest.reserveCount,
        eligible: eligible.length,
        pickCounts: eligible.reduce<Record<string, number>>((acc, sub) => {
          const key = String(sub.picks.length);
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {}),
      });
      continue;
    }

    try {
      const grade = await gradeContest(contest.id);
      results.push(grade);
    } catch (error) {
      results.push({
        position,
        contestId: contest.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log("Grade results:", JSON.stringify(results, null, 2));

  if (!DRY_RUN) {
    const statuses = await prisma.rankIQContest.findMany({
      where: { weekId: week.id },
      select: { position: true, status: true },
    });
    const allFinal = statuses.every(
      (row) => row.status === "FINAL" || row.status === "ARCHIVED",
    );
    if (!allFinal) {
      throw new Error(
        `Not all contests FINAL after regrade: ${JSON.stringify(statuses)}`,
      );
    }
    await prisma.week.update({
      where: { id: week.id },
      data: { status: "COMPLETE" },
    });
    console.log("Week status set to COMPLETE");
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

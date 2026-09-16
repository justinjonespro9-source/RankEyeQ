/**
 * Safe Week 1 repair — gated.
 *
 * DRY_RUN (default): full read-only planning pass — prints exact snapshot,
 * grading, and lifecycle changes. Executes zero writes.
 *
 * Live (only when explicitly confirmed):
 *   CONFIRM_WEEK1_REPAIR=1 CONFIRM_SNAPSHOT_REBUILD=1 DRY_RUN=0
 *     npx tsx scripts/repair-week1-regrade.ts
 *
 * DO NOT run against production until the DRY_RUN plan matches expected counts.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { gradeContest } from "@/lib/grading";
import { CONTEST_POSITIONS } from "@/lib/contest-defaults";
import { captureContestPregameSnapshotsForWeek } from "@/lib/consensus-snapshot";
import {
  buildWeek1RepairPlan,
  formatWeek1RepairDryRun,
  WEEK1_CANONICAL_LOCK,
} from "@/lib/week1-repair-plan";

const DRY_RUN = process.env.DRY_RUN !== "0";
const CONFIRM = process.env.CONFIRM_WEEK1_REPAIR === "1";
const CONFIRM_SNAPSHOTS = process.env.CONFIRM_SNAPSHOT_REBUILD === "1";

async function main() {
  if (!DRY_RUN && !CONFIRM) {
    throw new Error(
      "Refusing live repair. Re-run DRY_RUN first, then set CONFIRM_WEEK1_REPAIR=1 (and CONFIRM_SNAPSHOT_REBUILD=1 for snapshot rebuild).",
    );
  }

  const plan = await buildWeek1RepairPlan(prisma, {
    canonicalLock: WEEK1_CANONICAL_LOCK,
  });

  // Always print the full plan first (read-only).
  console.log(formatWeek1RepairDryRun(plan, { dryRun: DRY_RUN }));

  if (DRY_RUN || !CONFIRM) {
    console.log(
      "\nDRY_RUN complete — zero writes executed. Review plan above before live repair.",
    );
    return;
  }

  console.log("\n=== LIVE REPAIR STARTING ===");

  if (CONFIRM_SNAPSHOTS) {
    console.log(
      "Rebuilding pregame snapshots at canonical lock from reconstruction-qualified boards…",
    );
    const allowlist = new Set(plan.allQualifyingSubmissionIds);
    const lockAt = WEEK1_CANONICAL_LOCK;
    const captured = await captureContestPregameSnapshotsForWeek(
      plan.weekId,
      lockAt,
      {
        replaceStale: true,
        submissionIdAllowlist: allowlist,
      },
    );
    console.log("Snapshot capture:", captured);
  } else {
    console.log(
      "Skipping snapshot rebuild (set CONFIRM_SNAPSHOT_REBUILD=1 when plan is approved).",
    );
  }

  const updated = await prisma.rankIQContest.updateMany({
    where: { weekId: plan.weekId },
    data: { reserveCount: 0 },
  });
  console.log(`Set reserveCount=0 on ${updated.count} contests`);

  const results = [];
  for (const position of CONTEST_POSITIONS) {
    const contestPlan = plan.gradingPlans.find((p) => p.position === position);
    if (!contestPlan) {
      results.push({ position, error: "contest missing from plan" });
      continue;
    }
    try {
      results.push(await gradeContest(contestPlan.contestId));
    } catch (error) {
      results.push({
        position,
        contestId: contestPlan.contestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  console.log("Grade results:", JSON.stringify(results, null, 2));

  const statuses = await prisma.rankIQContest.findMany({
    where: { weekId: plan.weekId },
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
    where: { id: plan.weekId },
    data: { status: "COMPLETE" },
  });
  console.log("Week status set to COMPLETE");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

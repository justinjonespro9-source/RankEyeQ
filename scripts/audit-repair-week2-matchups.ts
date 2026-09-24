/**
 * Audit / repair Week 2 (or any week) ContestEntry matchup links against that
 * week's NflGame schedule. Defaults to dry-run.
 *
 *   npx tsx scripts/audit-repair-week2-matchups.ts
 *   npx tsx scripts/audit-repair-week2-matchups.ts --apply
 *   npx tsx scripts/audit-repair-week2-matchups.ts --week=2 --year=2026
 *   npx tsx scripts/audit-repair-week2-matchups.ts --import-schedule --apply
 *
 * Does not modify Week 1, ranking picks, or snapshots.
 */
import "dotenv/config";
import { prisma } from "../lib/db";
import { commitManualSchedule } from "../lib/nfl/manual/schedule-import";
import { auditRepairWeekMatchups } from "../lib/nfl/week-matchup-repair";
import { parseWeeklySchedulePaste } from "../lib/nfl/manual/parse-schedule";
import { autoSyncWeeklyEligibilityForWeek } from "../lib/nfl/weekly-auto-sync";
import {
  cleanupOrphanNflGames,
  scheduleKeepExternalIds,
} from "../lib/nfl/orphan-game-cleanup";
import { WEEK2_2026_REAL_SCHEDULE } from "../lib/nfl/week2-2026-schedule";

function maskDbUrl(url: string) {
  return url.replace(/:\/\/([^:/?#]+):([^@]+)@/, "://$1:***@");
}

function parseArgs(argv: string[]) {
  const apply = argv.includes("--apply");
  const importSchedule = argv.includes("--import-schedule");
  const weekArg = argv.find((arg) => arg.startsWith("--week="));
  const yearArg = argv.find((arg) => arg.startsWith("--year="));
  const weekNumber = weekArg ? Number(weekArg.split("=")[1]) : 2;
  const year = yearArg ? Number(yearArg.split("=")[1]) : 2026;
  return { apply, importSchedule, weekNumber, year };
}

async function main() {
  const { apply, importSchedule, weekNumber, year } = parseArgs(process.argv.slice(2));
  console.log("DATABASE_URL:", maskDbUrl(process.env.DATABASE_URL ?? "(not set)"));
  console.log(
    `Mode: ${apply ? "APPLY" : "DRY-RUN"} | week=${weekNumber} year=${year} importSchedule=${importSchedule}`,
  );

  const week = await prisma.week.findFirst({
    where: {
      weekNumber,
      isTest: false,
      season: { year, sport: "NFL", active: true },
    },
    include: { season: true, games: true },
  });
  if (!week) {
    console.error(`No active NFL Week ${weekNumber} for ${year}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Week ${week.weekNumber} ${week.id} status=${week.status} games=${week.games.length}`,
  );

  if (importSchedule) {
    const parsed = parseWeeklySchedulePaste(WEEK2_2026_REAL_SCHEDULE);
    if (!parsed.ready) {
      console.error("Schedule paste invalid:", parsed.blockers);
      process.exitCode = 1;
      return;
    }
    const keepExternalIds = scheduleKeepExternalIds({
      seasonYear: week.season.year,
      weekNumber: week.weekNumber,
      rows: parsed.rows,
    });
    const orphanPlan = await cleanupOrphanNflGames({
      weekId: week.id,
      keepExternalIds,
      apply: false,
    });
    console.log("\n=== Orphan game plan (dry-run; no deletes yet) ===");
    console.log(
      JSON.stringify(
        {
          proposedDeletions: orphanPlan.proposedDeletions,
          conflicts: orphanPlan.conflicts,
        },
        null,
        2,
      ),
    );

    if (!apply) {
      console.log(
        `Would import ${parsed.rows.length} Week ${weekNumber} games and apply safe orphan cleanup (pass --apply with --import-schedule to write).`,
      );
    } else {
      const admin =
        (await prisma.user.findFirst({ where: { role: "ADMIN" } })) ??
        (await prisma.user.findFirst());
      if (!admin) {
        console.error("No admin user for schedule import audit log");
        process.exitCode = 1;
        return;
      }
      const result = await commitManualSchedule({
        weekId: week.id,
        text: WEEK2_2026_REAL_SCHEDULE,
        adminUserId: admin.id,
      });
      console.log("Schedule import:", {
        created: result.created,
        updated: result.updated,
        games: result.games,
      });
      console.log(
        "Orphan cleanup applied:",
        JSON.stringify(result.orphanCleanup, null, 2),
      );
      const sync = await autoSyncWeeklyEligibilityForWeek(week.id);
      console.log("Eligibility sync:", sync.skipped ? "skipped" : sync.byPosition);
    }
  }

  const report = await auditRepairWeekMatchups({
    weekId: week.id,
    apply,
    // Controlled CLI repair may target any week; operator UI paths respect lifecycle.
    respectLifecycle: false,
  });

  console.log("\n=== Matchup repair summary ===");
  console.log(
    JSON.stringify(
      {
        weekId: report.weekId,
        weekNumber: report.weekNumber,
        applied: report.applied,
        gameCount: report.gameCount,
        counts: report.counts,
        byPosition: report.byPosition,
        week1Untouched: report.week1Untouched,
      },
      null,
      2,
    ),
  );

  const sample = report.rows
    .filter((row) => row.status !== "correct")
    .slice(0, 15);
  if (sample.length) {
    console.log("\nSample non-correct rows:");
    for (const row of sample) {
      console.log(
        `  [${row.status}] ${row.position} ${row.name} (${row.team}) ` +
          `${row.currentOpponent} → ${row.proposedOpponent ?? "—"} ` +
          `kickoff ${row.currentKickoffAt ?? "null"} → ${row.proposedKickoffAt ?? "null"}`,
      );
    }
  }

  const puka = report.rows.filter((row) =>
    row.name.toLowerCase().includes("puka"),
  );
  if (puka.length) {
    console.log("\nPuka rows:");
    console.log(JSON.stringify(puka, null, 2));
  }

  if (report.snapshots.length) {
    console.log("\n=== Snapshot audit (no automatic rewrite) ===");
    console.log(JSON.stringify(report.snapshots, null, 2));
  }
  for (const line of report.snapshotGuidance) {
    console.log(`GUIDANCE: ${line}`);
  }

  if (!apply) {
    console.log("\nDry-run only. Re-run with --apply to write ContestEntry/RankableEntry matchups.");
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

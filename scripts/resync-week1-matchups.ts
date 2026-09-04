/**
 * Re-run Week 1 eligibility sync (mutable weeks only) and report pool audit counts.
 * Does not open contests.
 *
 *   DATABASE_URL=... npx tsx scripts/resync-week1-matchups.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { auditAllPools } from "@/lib/nfl/manual/pool-audit";
import { autoSyncWeeklyEligibilityForWeek } from "@/lib/nfl/weekly-auto-sync";
import { validateWeeklyPoolCanonicalUniqueness } from "@/lib/nfl/pool-canonical-uniqueness";

function maskDbUrl(url: string) {
  return url.replace(/:\/\/([^:/?#]+):([^@]+)@/, "://$1:***@");
}

async function main() {
  console.log("DATABASE_URL:", maskDbUrl(process.env.DATABASE_URL ?? "(not set)"));

  const week = await prisma.week.findFirst({
    where: {
      weekNumber: 1,
      isTest: false,
      season: { active: true, sport: "NFL" },
    },
    include: { season: true, games: true },
  });
  if (!week) {
    console.error("No active NFL Week 1");
    process.exitCode = 1;
    return;
  }

  console.log(
    `Week 1 ${week.id} status=${week.status} games=${week.games.length}`,
  );

  const sync = await autoSyncWeeklyEligibilityForWeek(week.id);
  if (sync.skipped) {
    console.log("Sync skipped (week/contests immutable). No changes made.");
  } else {
    console.log("Sync by position:", sync.byPosition);
  }

  const audits = await auditAllPools(week.id);
  for (const audit of audits.audits) {
    const missingOpp = audit.eligibleCount - audit.withOpponent;
    const missingKick = audit.eligibleCount - audit.withKickoff;
    console.log(
      `${audit.position}: eligible=${audit.eligibleCount} missingOpponent=${missingOpp} missingKickoff=${missingKick} ready=${audit.ready}`,
    );
    if (audit.blockers[0]) {
      console.log(`  first blocker: ${audit.blockers[0]}`);
    }
  }

  const canonical = await validateWeeklyPoolCanonicalUniqueness(week.id);
  console.log(
    `Canonical duplicate groups: ${canonical.duplicates.length} ok=${canonical.ok}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

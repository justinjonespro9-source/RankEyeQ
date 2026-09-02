import "dotenv/config";
import { prisma } from "@/lib/db";
import {
  auditPlayerDuplicateGroups,
  consolidateConfirmedPlayerDuplicates,
} from "@/lib/nfl/player-consolidation";
import { validateWeeklyPoolCanonicalUniqueness } from "@/lib/nfl/pool-canonical-uniqueness";
import { autoSyncWeeklyEligibilityForWeek } from "@/lib/nfl/weekly-auto-sync";

async function main() {
  const season = await prisma.season.findFirst({
    where: { year: 2026, sport: "NFL" },
    include: { weeks: true },
  });
  if (!season) throw new Error("2026 NFL season not found");

  const week1 = season.weeks.find((week) => week.weekNumber === 1);
  const before = week1
    ? await validateWeeklyPoolCanonicalUniqueness(week1.id)
    : null;

  const groups = await auditPlayerDuplicateGroups({
    seasonYear: 2026,
    names: [
      "Aaron Jones",
      "A.J. Brown",
      "Bijan Robinson",
      "David Montgomery",
      "Brian Robinson",
    ],
  });

  console.log("Duplicate candidate groups:", groups.length);
  for (const group of groups) {
    console.log(
      `\n[${group.confidence}] ${group.position} ${group.entries.map((e) => `${e.name}@${e.team}/${e.provider}`).join(" | ")}`,
    );
    console.log(`  → ${group.reason}`);
  }

  const report = await consolidateConfirmedPlayerDuplicates({ seasonYear: 2026 });
  console.log("\nConsolidation:", report);

  if (week1) {
    await autoSyncWeeklyEligibilityForWeek(week1.id);
    const after = await validateWeeklyPoolCanonicalUniqueness(week1.id);
    console.log("\nWeek 1 pool duplicates before:", before?.duplicates.length ?? "n/a");
    console.log("Week 1 pool duplicates after:", after.duplicates.length);
    if (after.duplicates.length > 0) {
      console.log(after.blockers.join("\n"));
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import "dotenv/config";
import { prisma } from "@/lib/db";
import { reconcileWeeklyPoolIntegrity } from "@/lib/nfl/weekly-pool-reconcile";

async function main() {
  const week = await prisma.week.findFirst({
    where: {
      weekNumber: 1,
      isTest: false,
      season: { active: true, sport: "NFL" },
    },
  });
  if (!week) {
    console.error("Week 1 not found");
    process.exitCode = 1;
    return;
  }

  const report = await reconcileWeeklyPoolIntegrity(week.id);

  console.log("\n## Reconciliation report\n");
  console.log(`Week: ${report.weekLabel} (${report.weekId})\n`);
  console.log("| Position | Current | Removed | Final |");
  console.log("| -------- | ------: | ------: | ----: |");
  for (const row of report.positions) {
    console.log(
      `| ${row.position} | ${row.before} | ${row.removed} | ${row.final} |`,
    );
  }

  console.log("\n### Removal reasons (excluded entries)\n");
  for (const row of report.positions) {
    const reasonEntries = Object.entries(row.reasons);
    if (reasonEntries.length === 0) continue;
    console.log(`**${row.position}**`);
    for (const [reason, count] of reasonEntries) {
      console.log(`- ${reason}: ${count}`);
    }
  }

  console.log("\n### DEF season consolidation\n", report.defenseSeason);
  console.log("\n### DEF validation\n", report.defenseValidation);
  console.log("\n### Spot checks\n", JSON.stringify(report.spotChecks, null, 2));

  if (!report.defenseValidation.ok) {
    process.exitCode = 1;
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

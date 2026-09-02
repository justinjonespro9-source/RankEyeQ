import "dotenv/config";
import { prisma } from "@/lib/db";
import {
  auditRosterTeamAccuracy,
  reconcileRosterTeamAccuracy,
  summarizeTeamMismatchCauses,
} from "@/lib/nfl/roster-team-audit";
import { NFL_TEAMS } from "@/lib/nfl-schedule";

async function main() {
  const apply = process.argv.includes("--apply");

  const season = await prisma.season.findFirst({
    where: { year: 2026, sport: "NFL", active: true },
  });
  if (!season) {
    console.error("Active 2026 NFL season not found");
    process.exitCode = 1;
    return;
  }

  const week1 = await prisma.week.findFirst({
    where: { seasonId: season.id, weekNumber: 1, isTest: false },
  });

  if (apply) {
    console.log("Applying roster team reconciliation…\n");
    const report = await reconcileRosterTeamAccuracy({
      seasonId: season.id,
      weekId: week1?.id,
      resyncWeek: true,
    });

    console.log(`Corrected: ${report.corrected}`);
    for (const row of report.correctedPlayers) {
      console.log(
        `  ${row.name} (${row.externalId}): ${row.fromTeam} → ${row.toTeam} [${row.cause}]`,
      );
    }
    console.log("\nRemaining mismatches:", report.mismatches.length);
    console.log("Week 1 counts:", report.week1Counts);
    console.log("Pool uniqueness OK:", report.poolUniquenessOk);
    return;
  }

  console.log("Auditing 2026 roster team accuracy (dry run)…\n");
  const report = await auditRosterTeamAccuracy({
    seasonId: season.id,
    weekId: week1?.id,
  });

  console.log(`Season ${report.seasonYear} (${report.seasonId})`);
  console.log(`Source players: ${report.sourcePlayerCount}`);
  console.log(`Active offensive SeasonPlayers: ${report.activeSeasonPlayers}`);
  console.log(`Team mismatches vs source: ${report.mismatches.length}`);
  console.log(`Rankable/Season desync: ${report.rankableSeasonDesync.length}`);
  console.log(`Not on source roster: ${report.notOnSourceRoster.length}`);
  console.log(`Week pool team drift: ${report.weekPoolTeamDrift.length}`);
  console.log("\nMismatch causes:", summarizeTeamMismatchCauses(report.mismatches));

  if (report.mismatches.length > 0) {
    console.log("\n### Mismatches\n");
    for (const row of report.mismatches) {
      console.log(
        `- ${row.name} (${row.externalId}): SP=${row.seasonPlayerTeam} RE=${row.rankableEntryTeam} source=${row.sourceTeam} [${row.cause}] legacy=${row.legacyTeamHint ?? "—"}`,
      );
    }
  }

  console.log("\n### Known players\n");
  for (const [externalId, row] of Object.entries(report.knownPlayers)) {
    console.log(
      `${externalId}: found=${row.found} SP=${row.seasonPlayerTeam} RE=${row.rankableEntryTeam} source=${row.sourceTeam} aligned=${row.aligned}`,
    );
  }

  console.log("\n### Team counts (active offensive)\n");
  for (const team of NFL_TEAMS) {
    const counts = report.teamCounts[team.abbr];
    if (!counts) continue;
    const total = counts.QB + counts.RB + counts.WR + counts.TE;
    if (total === 0 && counts.flags.length === 0) continue;
    console.log(
      `${team.abbr}: QB=${counts.QB} RB=${counts.RB} WR=${counts.WR} TE=${counts.TE}${counts.flags.length ? ` flags=${counts.flags.join(";")}` : ""}`,
    );
  }

  if (report.weekPoolTeamDrift.length > 0) {
    console.log("\n### Week pool drift (first 20)\n");
    for (const row of report.weekPoolTeamDrift.slice(0, 20)) {
      console.log(
        `- ${row.name}: season=${row.seasonPlayerTeam} weekTeam=${row.weekTeam}`,
      );
    }
  }

  console.log("\n### Source quality\n");
  console.log("Primary cause:", report.sourceQuality.primaryCause);
  for (const note of report.sourceQuality.notes) {
    console.log(`- ${note}`);
  }
  if (report.sourceQuality.sourceMultiTeamIds.length > 0) {
    console.log("Multi-team source IDs:");
    for (const row of report.sourceQuality.sourceMultiTeamIds.slice(0, 20)) {
      console.log(`  ${row.name} (${row.externalId}): ${row.teams.join(", ")}`);
    }
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

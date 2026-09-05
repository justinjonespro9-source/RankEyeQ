/**
 * Safely set Season/Week fantasy scoring version before results are graded.
 *
 *   DATABASE_URL=... npx tsx scripts/set-fantasy-scoring-version.ts --week-number=1 --dry-run
 *   DATABASE_URL=... npx tsx scripts/set-fantasy-scoring-version.ts --active-open --apply
 *
 * Refuses weeks that already have PlayerWeekStat / DefenseWeekStat rows or
 * FINAL/ARCHIVED contests.
 */
import "dotenv/config";
import {
  FANTASYTRACK_NFL_FULL_PPR_V1,
  FANTASYTRACK_NFL_HALF_PPR_V2,
  normalizeFantasyScoringVersion,
} from "@/lib/fantasy/scoring-config";
import { prisma } from "@/lib/db";

const TARGET = FANTASYTRACK_NFL_HALF_PPR_V2;

function arg(name: string) {
  const hit = process.argv.find((value) => value.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : null;
}

function hasFlag(name: string) {
  return process.argv.includes(name);
}

async function main() {
  const dryRun = !hasFlag("--apply");
  const activeOpen = hasFlag("--active-open");
  const weekNumber = arg("--week-number");
  const weekId = arg("--week-id");
  const versionRaw = arg("--version") ?? TARGET;
  const version = normalizeFantasyScoringVersion(versionRaw);

  if (dryRun) {
    console.log("DRY RUN — pass --apply to write changes.");
  }
  console.log(`Target fantasy scoring version: ${version}`);

  const season = await prisma.season.findFirst({
    where: { active: true, sport: "NFL" },
  });
  if (!season) {
    throw new Error("No active NFL season found");
  }

  const weeks = await prisma.week.findMany({
    where: {
      seasonId: season.id,
      isTest: false,
      ...(weekId ? { id: weekId } : {}),
      ...(weekNumber ? { weekNumber: Number(weekNumber) } : {}),
      ...(activeOpen && !weekId && !weekNumber
        ? { status: { in: ["OPEN", "UPCOMING", "LOCKED"] } }
        : {}),
    },
    include: {
      contests: { select: { id: true, status: true, position: true } },
    },
    orderBy: { weekNumber: "asc" },
  });

  if (weeks.length === 0) {
    console.log("No matching weeks.");
    return;
  }

  console.log(
    `Season ${season.year}: fantasyScoringVersion=${season.fantasyScoringVersion}`,
  );

  if (season.fantasyScoringVersion !== version) {
    console.log(
      `  Would update season → ${version}${dryRun ? "" : " (applying)"}`,
    );
    if (!dryRun) {
      await prisma.season.update({
        where: { id: season.id },
        data: { fantasyScoringVersion: version },
      });
    }
  }

  for (const week of weeks) {
    const [playerStats, defenseStats] = await Promise.all([
      prisma.playerWeekStat.count({ where: { weekId: week.id } }),
      prisma.defenseWeekStat.count({ where: { weekId: week.id } }),
    ]);
    const terminal = week.contests.filter((c) =>
      ["FINAL", "ARCHIVED"].includes(c.status),
    );

    const blockers: string[] = [];
    if (playerStats > 0 || defenseStats > 0) {
      blockers.push(
        `${playerStats} player + ${defenseStats} defense week-stat rows already imported`,
      );
    }
    if (terminal.length > 0) {
      blockers.push(`${terminal.length} contest(s) already FINAL/ARCHIVED`);
    }

    console.log(
      `\n${week.label} (${week.status}) current=${week.fantasyScoringVersion}`,
    );
    console.log(
      `  contests: ${week.contests.map((c) => `${c.position}:${c.status}`).join(", ")}`,
    );

    if (week.fantasyScoringVersion === version) {
      console.log("  already on target version");
      continue;
    }

    if (blockers.length > 0) {
      console.log(`  BLOCKED: ${blockers.join("; ")}`);
      console.log(
        "  Safe path: leave historical Full PPR, or re-import results after updating the week version.",
      );
      continue;
    }

    console.log(
      `  OK to update → ${version}${dryRun ? " (dry-run)" : " (applying)"}`,
    );
    if (!dryRun) {
      await prisma.week.update({
        where: { id: week.id },
        data: { fantasyScoringVersion: version },
      });
    }
  }

  if (version === FANTASYTRACK_NFL_FULL_PPR_V1) {
    console.log(
      "\nNote: Full PPR is historical. New 2026 weeks should use FANTASYTRACK_NFL_HALF_PPR_V2.",
    );
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

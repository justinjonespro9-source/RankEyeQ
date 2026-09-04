/**
 * Read-only Week 1 eligibility composition audit.
 * Compares SeasonPlayer universe vs active ContestEntry pool.
 *
 *   DATABASE_URL=... npx tsx scripts/audit-week1-eligibility-composition.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { isSeasonPlayerEligibleForWeeklyField } from "@/lib/nfl/eligibility-rules";
import { isProductionWeeklyPoolIdentity } from "@/lib/nfl/pool-source";
import { normalizeTeamAbbr } from "@/lib/nfl/manual/parse-common";

const POSITIONS = ["QB", "RB", "WR", "TE", "DEF"] as const;

type SeasonPlayerWithRankable = Prisma.SeasonPlayerGetPayload<{
  include: { rankableEntry: true };
}>;

type ActiveContestEntry = Prisma.ContestEntryGetPayload<{
  include: { rankableEntry: true };
}>;

function maskDbUrl(url: string) {
  return url.replace(/:\/\/([^:/?#]+):([^@]+)@/, "://$1:***@");
}

function bump(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function printCounts(title: string, map: Map<string, number>) {
  console.log(`\n${title}`);
  const rows = [...map.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  for (const [key, count] of rows) {
    console.log(`  ${key || "(empty)"}: ${count}`);
  }
}

function samplePlayers(rows: SeasonPlayerWithRankable[], n = 8) {
  return rows.slice(0, n).map((player) => ({
    name: player.displayName,
    team: player.team,
    sourceNflStatus: player.sourceNflStatus,
    nflStatus: player.nflStatus,
    activeOnNFLRoster: player.activeOnNFLRoster,
    sourcePosition: player.sourcePosition,
    provider: player.rankableEntry.provider,
  }));
}

async function main() {
  console.log("=== Week 1 eligibility composition (read-only) ===");
  console.log("DATABASE_URL:", maskDbUrl(process.env.DATABASE_URL ?? "(not set)"));

  const week = await prisma.week.findFirst({
    where: {
      weekNumber: 1,
      isTest: false,
      season: { active: true, sport: "NFL" },
    },
    include: {
      season: true,
      games: { select: { homeTeam: true, awayTeam: true } },
    },
  });
  if (!week) {
    console.error("No active NFL Week 1");
    process.exitCode = 1;
    return;
  }

  const scheduled = new Set<string>();
  for (const game of week.games) {
    scheduled.add(normalizeTeamAbbr(game.homeTeam));
    scheduled.add(normalizeTeamAbbr(game.awayTeam));
  }

  console.log(
    `Season ${week.season.year} (${week.seasonId}) Week1 ${week.id} status=${week.status} games=${week.games.length} teams=${scheduled.size}`,
  );

  for (const position of POSITIONS) {
    const seasonPlayers: SeasonPlayerWithRankable[] =
      await prisma.seasonPlayer.findMany({
        where: { seasonId: week.seasonId, position },
        include: { rankableEntry: true },
        orderBy: { displayName: "asc" },
      });

    const contest = await prisma.rankIQContest.findUnique({
      where: { weekId_position: { weekId: week.id, position } },
      include: {
        entries: {
          where: { excluded: false },
          include: { rankableEntry: true },
        },
      },
    });

    const activeEntries: ActiveContestEntry[] = contest?.entries ?? [];
    const activeIds = new Set(
      activeEntries.map((entry) => entry.rankableEntryId),
    );

    const onSchedule = seasonPlayers.filter((player) =>
      scheduled.has(normalizeTeamAbbr(player.team)),
    );

    const bySourceStatus = new Map<string, number>();
    const byNflStatus = new Map<string, number>();
    const byActiveRoster = new Map<string, number>();
    const bySourcePosition = new Map<string, number>();
    const byProvider = new Map<string, number>();

    let ruleEligible = 0;
    let productionIdentity = 0;
    let wouldSync = 0;

    const inPoolSamples: SeasonPlayerWithRankable[] = [];
    const eligibleNotInPool: SeasonPlayerWithRankable[] = [];
    const inPoolButRuleIneligible: SeasonPlayerWithRankable[] = [];
    const practiceSquadInPool: SeasonPlayerWithRankable[] = [];
    const inactiveLikeInPool: SeasonPlayerWithRankable[] = [];

    for (const player of onSchedule) {
      bump(bySourceStatus, player.sourceNflStatus ?? "(null)");
      bump(byNflStatus, player.nflStatus || "(empty)");
      bump(byActiveRoster, player.activeOnNFLRoster ? "true" : "false");
      bump(bySourcePosition, player.sourcePosition ?? "(null)");
      bump(byProvider, player.rankableEntry.provider);

      const ruleOk = isSeasonPlayerEligibleForWeeklyField(player);
      const prodOk = isProductionWeeklyPoolIdentity({
        provider: player.rankableEntry.provider,
        externalId: player.rankableEntry.externalId,
        position: player.rankableEntry.position,
        type: player.rankableEntry.type,
        team: player.team,
        active: player.rankableEntry.active,
      });
      if (ruleOk) ruleEligible += 1;
      if (prodOk) productionIdentity += 1;
      if (ruleOk && prodOk) wouldSync += 1;

      const inPool = activeIds.has(player.rankableEntryId);
      if (inPool) inPoolSamples.push(player);
      if (ruleOk && prodOk && !inPool) eligibleNotInPool.push(player);
      if (inPool && !ruleOk) inPoolButRuleIneligible.push(player);

      const statusBlob =
        `${player.sourceNflStatus ?? ""} ${player.nflStatus}`.toUpperCase();
      if (
        inPool &&
        (/PRACTICE|PS|RESERVE|INACTIVE|RELEASED|CUT|FA|IR|PUP|NFI|SUSPENDED/.test(
          statusBlob,
        ) ||
          !player.activeOnNFLRoster)
      ) {
        if (/PRACTICE|PS/.test(statusBlob)) practiceSquadInPool.push(player);
        else inactiveLikeInPool.push(player);
      }
    }

    const seasonById = new Map(
      seasonPlayers.map((player) => [player.rankableEntryId, player] as const),
    );
    const stalePool = activeEntries.filter((entry) => {
      const seasonPlayer = seasonById.get(entry.rankableEntryId);
      if (!seasonPlayer) return true;
      if (!scheduled.has(normalizeTeamAbbr(seasonPlayer.team))) return true;
      return false;
    });

    console.log(`\n========== ${position} ==========`);
    console.log(
      `SeasonPlayers total=${seasonPlayers.length} onSchedule=${onSchedule.length}`,
    );
    const actOnly = onSchedule.filter(
      (player) => (player.sourceNflStatus ?? "").toUpperCase() === "ACT",
    ).length;
    console.log(
      `ACT sourceNflStatus=${actOnly} Rule-eligible=${ruleEligible} productionIdentity=${productionIdentity} wouldSync=${wouldSync}`,
    );
    console.log(
      `Active ContestEntry=${activeIds.size} eligibleNotInPool=${eligibleNotInPool.length} inPoolButRuleIneligible=${inPoolButRuleIneligible.length} stalePool=${stalePool.length}`,
    );
    console.log(
      `Delta vs local reported targets — compare ACT (${actOnly}) and pool (${activeIds.size}) to production audit eligibleCount`,
    );

    printCounts("Active pool by sourceNflStatus (via SeasonPlayer)", (() => {
      const counts = new Map<string, number>();
      for (const player of inPoolSamples) {
        bump(counts, player.sourceNflStatus ?? "(null)");
      }
      return counts;
    })());
    printCounts("Active pool by nflStatus", (() => {
      const counts = new Map<string, number>();
      for (const player of inPoolSamples) {
        bump(counts, player.nflStatus || "(empty)");
      }
      return counts;
    })());
    printCounts("Active pool by activeOnNFLRoster", (() => {
      const counts = new Map<string, number>();
      for (const player of inPoolSamples) {
        bump(counts, player.activeOnNFLRoster ? "true" : "false");
      }
      return counts;
    })());
    printCounts("Active pool by sourcePosition", (() => {
      const counts = new Map<string, number>();
      for (const player of inPoolSamples) {
        bump(counts, player.sourcePosition ?? "(null)");
      }
      return counts;
    })());
    printCounts("Active pool by provider", (() => {
      const counts = new Map<string, number>();
      for (const player of inPoolSamples) {
        bump(counts, player.rankableEntry.provider);
      }
      return counts;
    })());

    printCounts("On-schedule SeasonPlayer by sourceNflStatus", bySourceStatus);
    printCounts("On-schedule SeasonPlayer by activeOnNFLRoster", byActiveRoster);
    printCounts("On-schedule SeasonPlayer by sourcePosition", bySourcePosition);

    if (practiceSquadInPool.length) {
      console.log("\nPractice-squad-like IN active pool:");
      console.log(samplePlayers(practiceSquadInPool));
    }
    if (inactiveLikeInPool.length) {
      console.log("\nInactive/reserve/released-like IN active pool:");
      console.log(samplePlayers(inactiveLikeInPool, 12));
    }
    if (inPoolButRuleIneligible.length) {
      console.log("\nIN pool but fails isSeasonPlayerEligibleForWeeklyField:");
      console.log(samplePlayers(inPoolButRuleIneligible, 12));
    }
    if (stalePool.length) {
      console.log("\nStale active pool (no matching on-schedule SeasonPlayer):");
      console.log(
        stalePool.slice(0, 12).map((entry) => ({
          name: entry.rankableEntry.name,
          team: entry.weekTeam ?? entry.rankableEntry.team,
          provider: entry.rankableEntry.provider,
          externalId: entry.rankableEntry.externalId,
          seasonPlayer: Boolean(seasonById.get(entry.rankableEntryId)),
        })),
      );
    }

    const skippedInactive = onSchedule.filter(
      (player) => !player.activeOnNFLRoster,
    );
    console.log(
      `\nOn-schedule with activeOnNFLRoster=false: ${skippedInactive.length} (sample)`,
    );
    console.log(samplePlayers(skippedInactive, 10));

    const eligibleOddStatus = onSchedule.filter((player) => {
      if (!isSeasonPlayerEligibleForWeeklyField(player)) return false;
      if (
        !isProductionWeeklyPoolIdentity({
          provider: player.rankableEntry.provider,
          externalId: player.rankableEntry.externalId,
          position: player.rankableEntry.position,
          type: player.rankableEntry.type,
          team: player.team,
          active: player.rankableEntry.active,
        })
      ) {
        return false;
      }
      const status = (player.sourceNflStatus ?? "").toUpperCase();
      return Boolean(status) && status !== "ACT" && status !== "ACTIVE";
    });
    console.log(
      `\nRule-eligible with non-ACT sourceNflStatus: ${eligibleOddStatus.length}`,
    );
    console.log(samplePlayers(eligibleOddStatus, 15));
  }

  console.log("\n=== INTENDED RULE (code) ===");
  console.log(
    "Weekly field requires: scheduled team + activeOnNFLRoster=true + nflStatus not in INELIGIBLE set + production identity (nflcom-bootstrap for players).",
  );
  console.log(
    "Practice squad maps to activeOnNFLRoster=false → must be EXCLUDED.",
  );
  console.log(
    "If production pruned 0 and has higher counts, either SeasonPlayer.activeOnNFLRoster is broader there, or pool still holds rows that sync would not re-add (but also did not prune).",
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

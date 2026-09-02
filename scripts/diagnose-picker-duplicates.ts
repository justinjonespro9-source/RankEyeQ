import "dotenv/config";
import { prisma } from "@/lib/db";
import { getPublicPositionContest } from "@/lib/contests";
import {
  findWeeklyPoolCanonicalDuplicates,
  validateWeeklyPoolCanonicalUniqueness,
} from "@/lib/nfl/pool-canonical-uniqueness";
import { playerIdentityGroupKey } from "@/lib/nfl/player-identity";
import { NFL_COM_BOOTSTRAP_PROVIDER } from "@/lib/providers/nfl/nflcom/fetch-rosters";

const KNOWN = [
  "Aaron Jones",
  "A.J. Brown",
  "Bijan Robinson",
  "David Montgomery",
  "Brian Robinson",
];

function maskDbUrl(url: string) {
  return url.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@");
}

async function main() {
  const dbUrl = process.env.DATABASE_URL ?? "(not set)";
  console.log("=== ENVIRONMENT ===");
  console.log("DATABASE_URL:", maskDbUrl(dbUrl));
  console.log("NODE_ENV:", process.env.NODE_ENV ?? "(unset)");
  console.log("AUTH_URL:", process.env.AUTH_URL ?? "(unset)");

  const season = await prisma.season.findFirst({
    where: { active: true, sport: "NFL" },
    include: { weeks: { where: { weekNumber: 1, isTest: false } } },
  });
  if (!season) {
    console.log("No active NFL season");
    return;
  }
  const week = season.weeks[0];
  if (!week) {
    console.log("No Week 1");
    return;
  }
  console.log("\nSeason:", season.year, season.id);
  console.log("Week 1:", week.label, week.id, week.status);

  const validation = await validateWeeklyPoolCanonicalUniqueness(week.id);
  console.log("\n=== CANONICAL VALIDATOR ===");
  console.log("ok:", validation.ok);
  console.log("duplicate groups:", validation.duplicates.length);
  for (const dup of validation.duplicates) {
    console.log(`  ${dup.position} [${dup.identityKey}]:`, dup.entries);
  }

  const positions = ["qb", "rb", "wr", "te"] as const;
  for (const position of positions) {
    const contest = await getPublicPositionContest(position);
    const names = contest.players.map((p) => p.name);
    const nameCounts = new Map<string, number>();
    for (const n of names) {
      nameCounts.set(n, (nameCounts.get(n) ?? 0) + 1);
    }
    const dupNames = [...nameCounts.entries()].filter(([, c]) => c > 1);

    console.log(`\n=== PICKER ${position.toUpperCase()} (source=${contest.source}) ===`);
    console.log("payload count:", contest.players.length);

    const dbContest = await prisma.rankIQContest.findUnique({
      where: { weekId_position: { weekId: week.id, position: position.toUpperCase() as "QB" } },
      include: {
        entries: {
          where: { excluded: false },
          include: { rankableEntry: true },
        },
      },
    });
    console.log("ContestEntry active:", dbContest?.entries.length ?? 0);

    const dbNameCounts = new Map<string, number>();
    for (const e of dbContest?.entries ?? []) {
      dbNameCounts.set(e.rankableEntry.name, (dbNameCounts.get(e.rankableEntry.name) ?? 0) + 1);
    }
    const dbDupNames = [...dbNameCounts.entries()].filter(([, c]) => c > 1);
    console.log("DB duplicate display names:", dbDupNames.length ? dbDupNames : "none");
    console.log("Payload duplicate display names:", dupNames.length ? dupNames : "none");

    if (dupNames.length > 0 || dbDupNames.length > 0) {
      const targets = new Set([...dupNames.map(([n]) => n), ...dbDupNames.map(([n]) => n)]);
      for (const name of targets) {
        const entries = (dbContest?.entries ?? []).filter((e) => e.rankableEntry.name === name);
        console.log(`\n  -- ${name} (${entries.length} ContestEntry rows) --`);
        for (const e of entries) {
          const sp = await prisma.seasonPlayer.findFirst({
            where: { seasonId: season.id, rankableEntryId: e.rankableEntryId },
          });
          console.log({
            rankableEntryId: e.rankableEntryId,
            contestEntryId: e.id,
            seasonPlayerId: sp?.id ?? null,
            name: e.rankableEntry.name,
            team: e.rankableEntry.team,
            weekTeam: e.weekTeam,
            provider: e.rankableEntry.provider,
            externalId: e.rankableEntry.externalId,
            excluded: e.excluded,
            manuallyAdded: e.manuallyAdded,
            inactiveReason: e.inactiveReason,
            rankableActive: e.rankableEntry.active,
            identityKey: playerIdentityGroupKey(e.rankableEntry.name, e.rankableEntry.position),
            nflcomKey:
              e.rankableEntry.provider === NFL_COM_BOOTSTRAP_PROVIDER
                ? `${e.rankableEntry.position}|nflcom:${e.rankableEntry.externalId}`
                : null,
          });
        }
        const payloadDupes = contest.players.filter((p) => p.name === name);
        console.log(`  payload rows for "${name}":`, payloadDupes.length, payloadDupes.map((p) => p.id));
      }
    }
  }

  console.log("\n=== KNOWN PLAYERS (all identities) ===");
  for (const name of KNOWN) {
    const entries = await prisma.rankableEntry.findMany({
      where: {
        type: "PLAYER",
        OR: [
          { name: { equals: name, mode: "insensitive" } },
          { name: { contains: name.split(" ").pop()!, mode: "insensitive" } },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
    const filtered = entries.filter((e) =>
      e.name.toLowerCase().includes(name.toLowerCase().split(" ").pop()!),
    );
    console.log(`\n${name} (${filtered.length} RankableEntry rows):`);
    for (const e of filtered) {
      const sp = await prisma.seasonPlayer.findFirst({
        where: { seasonId: season.id, rankableEntryId: e.id },
      });
      const ce = await prisma.contestEntry.findFirst({
        where: {
          rankableEntryId: e.id,
          excluded: false,
          contest: { weekId: week.id },
        },
      });
      console.log({
        id: e.id,
        name: e.name,
        team: e.team,
        position: e.position,
        provider: e.provider,
        externalId: e.externalId,
        active: e.active,
        seasonPlayer: Boolean(sp),
        week1Active: Boolean(ce),
      });
    }
  }

  // Layer counts
  console.log("\n=== LAYER DUPLICATE COUNTS (by display name, active Week 1) ===");
  for (const pos of ["QB", "RB", "WR", "TE"] as const) {
    const contest = await prisma.rankIQContest.findUnique({
      where: { weekId_position: { weekId: week.id, position: pos } },
      include: {
        entries: {
          where: { excluded: false },
          include: { rankableEntry: true },
        },
      },
    });
    const names = contest?.entries.map((e) => e.rankableEntry.name) ?? [];
    const dupNameCount = names.length - new Set(names).size;
    const canonicalDup = (await findWeeklyPoolCanonicalDuplicates(week.id)).filter(
      (d) => d.position === pos,
    ).length;
    console.log(
      `${pos}: ContestEntry=${contest?.entries.length} dupNames=${dupNameCount} canonicalDupGroups=${canonicalDup}`,
    );
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

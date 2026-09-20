import "dotenv/config";
import { prisma } from "@/lib/db";

const fixturePatterns = [
  /^test-player-trade$/,
  /^dup-test-pool\d+$/,
  /^rb-canonical-pool-integrity-\d+$/,
  /^mover-player-trade\d+$/,
  /^(?:wr-trade|wr-legacy|wr-weekteam|wr-filter|shared-id|rb-sync)-roster-team-\d+(?:-dup)?$/,
];

function assertLocalDatabase() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is required");
  const url = new URL(value);
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error(`STOP: cleanup is local-only; received database host ${url.hostname}`);
  }
  return { hostname: url.hostname, database: url.pathname.slice(1) };
}

function isFixtureId(value: string) {
  return fixturePatterns.some((pattern) => pattern.test(value));
}

async function main() {
  const apply = process.argv.includes("--apply");
  const target = assertLocalDatabase();
  const entries = (await prisma.rankableEntry.findMany({
    where: { provider: "nflcom-bootstrap", type: "PLAYER" },
    include: {
      _count: {
        select: {
          contestEntries: true,
          seasonPlayers: true,
          picks: true,
          benchmarkSnapshotPicks: true,
          pregameSnapshotEntries: true,
          playerWeekStats: true,
          defenseWeekStats: true,
          weekAvailabilities: true,
        },
      },
      seasonPlayers: { select: { season: { select: { year: true, sport: true } } } },
    },
    orderBy: { externalId: "asc" },
  })).filter((entry) => isFixtureId(entry.externalId));

  if (entries.length === 0) {
    console.log(JSON.stringify({ mode: apply ? "APPLY" : "PREVIEW", ...target, fixtureIdentities: 0 }, null, 2));
    return;
  }

  const unsafe = entries.filter((entry) =>
    entry._count.picks > 0 ||
    entry._count.benchmarkSnapshotPicks > 0 ||
    entry._count.pregameSnapshotEntries > 0 ||
    entry._count.playerWeekStats > 0 ||
    entry._count.defenseWeekStats > 0 ||
    entry._count.weekAvailabilities > 0 ||
    entry._count.contestEntries > 0,
  );
  const non2026Memberships = entries.flatMap((entry) =>
    entry.seasonPlayers.filter((membership) =>
      membership.season.year !== 2026 || membership.season.sport !== "NFL",
    ).map(() => entry.externalId),
  );
  if (unsafe.length > 0 || non2026Memberships.length > 0) {
    throw new Error(
      `STOP: fixture candidates have unexpected references (unsafe=${unsafe.length}, non2026Memberships=${non2026Memberships.length})`,
    );
  }

  const ids = entries.map((entry) => entry.id);
  const memberships = entries.reduce((sum, entry) => sum + entry._count.seasonPlayers, 0);
  console.log(JSON.stringify({
    mode: apply ? "APPLY" : "PREVIEW",
    ...target,
    fixtureIdentities: ids.length,
    seasonMemberships: memberships,
    unsafeHistoricalReferences: unsafe.length,
    non2026Memberships: non2026Memberships.length,
    sampleExternalIds: entries.slice(0, 10).map((entry) => entry.externalId),
  }, null, 2));

  if (!apply) {
    console.log("No records changed. Re-run with --apply after reviewing this boundary.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.seasonPlayer.deleteMany({ where: { rankableEntryId: { in: ids } } });
    const deleted = await tx.rankableEntry.deleteMany({ where: { id: { in: ids } } });
    if (deleted.count !== ids.length) {
      throw new Error(`Delete count mismatch: expected ${ids.length}, received ${deleted.count}`);
    }
  }, { maxWait: 30_000, timeout: 120_000 });

  console.log(JSON.stringify({ deletedFixtureIdentities: ids.length, deletedSeasonMemberships: memberships }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

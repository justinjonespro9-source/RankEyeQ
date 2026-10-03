import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { prisma } from "@/lib/db";
import { buildSngRosterExport } from "@/lib/sng/roster-export";

async function main() {
  const outputPath = resolve(process.argv[2] ?? "exports/sng-nfl-2026-roster.json");
  const season = await prisma.season.findUniqueOrThrow({
    where: { year_sport: { year: 2026, sport: "NFL" } },
    include: {
      seasonPlayers: {
        include: { rankableEntry: true },
        orderBy: [{ team: "asc" }, { position: "asc" }, { displayName: "asc" }],
      },
    },
  });
  const payload = buildSngRosterExport({
    seasonId: season.id,
    seasonYear: season.year,
    sourceSyncedAt: season.rosterSyncedAt,
    exportedAt: new Date(),
    players: season.seasonPlayers,
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({ outputPath, rows: payload.rows.length, contractVersion: payload.contractVersion }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

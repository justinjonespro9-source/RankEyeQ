import "dotenv/config";
import { prisma } from "@/lib/db";
import {
  bootstrapSeasonRosterFromNflCom,
  formatRosterBootstrapSummary,
} from "@/lib/nfl/roster-bootstrap";

async function main() {
  const databaseUrl = process.env.DATABASE_URL ?? "(not set)";
  const maskedUrl = databaseUrl.replace(
    /:\/\/([^:]+):([^@]+)@/,
    "://$1:***@",
  );

  const season =
    (await prisma.season.findFirst({
      where: { year: 2026, sport: "NFL" },
    })) ??
    (await prisma.season.create({
      data: { year: 2026, sport: "NFL", active: true },
    }));

  console.log(`Database: ${maskedUrl}`);
  console.log(`Season: ${season.year} NFL (${season.id})`);
  console.log("Fetching NFL.com rosters…\n");

  const report = await bootstrapSeasonRosterFromNflCom({
    seasonId: season.id,
    runWeeklySync: true,
  });

  console.log(formatRosterBootstrapSummary(report));
  console.log("\nDone.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

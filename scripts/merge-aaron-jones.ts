import "dotenv/config";
import { mergeAaronJonesIdentities } from "@/lib/nfl/merge-player-identity";
import { findWeeklyPoolCanonicalDuplicates } from "@/lib/nfl/pool-canonical-uniqueness";
import { prisma } from "@/lib/db";

async function main() {
  const result = await mergeAaronJonesIdentities();
  console.log("Aaron Jones merge complete:", result);

  const week1 = await prisma.week.findFirst({
    where: {
      weekNumber: 1,
      isTest: false,
      season: { active: true, sport: "NFL" },
    },
  });
  if (week1) {
    const duplicates = await findWeeklyPoolCanonicalDuplicates(week1.id);
    console.log(`Week 1 pool duplicate groups: ${duplicates.length}`);
    if (duplicates.length > 0) {
      console.log(JSON.stringify(duplicates, null, 2));
      process.exitCode = 1;
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

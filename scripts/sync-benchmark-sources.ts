import "dotenv/config";
import { ensureOfficialBenchmarkSources } from "../lib/benchmark-sources-sync";
import { prisma } from "../lib/db";

async function main() {
  const result = await ensureOfficialBenchmarkSources();
  console.log(result);
  const sources = await prisma.universalProfile.findMany({
    where: { profileType: "BENCHMARK" },
    orderBy: { username: "asc" },
    select: {
      username: true,
      displayName: true,
      competitorActive: true,
      status: true,
    },
  });
  console.log(sources);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});

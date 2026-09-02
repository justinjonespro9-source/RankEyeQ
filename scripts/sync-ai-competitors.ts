import "dotenv/config";
import { ensureOfficialAiCompetitors } from "../lib/ai-competitors-sync";
import { prisma } from "../lib/db";

async function main() {
  const result = await ensureOfficialAiCompetitors();
  console.log(result);
  const bots = await prisma.universalProfile.findMany({
    where: { profileType: "AI" },
    orderBy: { username: "asc" },
    select: {
      username: true,
      displayName: true,
      competitorActive: true,
      status: true,
    },
  });
  console.log(bots);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});

import "dotenv/config";
import { prisma } from "../lib/db";

async function main() {
  const weeks = await prisma.week.findMany({
    where: { weekNumber: 1 },
    select: {
      id: true,
      label: true,
      status: true,
      isTest: true,
      _count: {
        select: { games: true, contests: true, playerWeekStats: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  console.log("weeks", JSON.stringify(weeks, null, 2));

  const big = await prisma.contestEntry.groupBy({
    by: ["contestId"],
    where: { fantasyPoints: { not: null } },
    _count: true,
    orderBy: { _count: { contestId: "desc" } },
    take: 10,
  });
  console.log("top contests with points", big);

  for (const row of big.slice(0, 5)) {
    const c = await prisma.rankIQContest.findUnique({
      where: { id: row.contestId },
      select: {
        position: true,
        weekId: true,
        week: { select: { id: true, label: true, isTest: true, status: true } },
        _count: { select: { entries: true } },
      },
    });
    console.log(row.contestId, row._count, c);
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

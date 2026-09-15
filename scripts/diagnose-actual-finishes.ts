import "dotenv/config";
import { prisma } from "../lib/db";

async function main() {
  const week = await prisma.week.findFirst({
    where: { weekNumber: 1, isTest: false },
    orderBy: { createdAt: "desc" },
    include: {
      contests: { select: { id: true, position: true, rankingDepth: true } },
      _count: {
        select: {
          playerWeekStats: true,
          defenseWeekStats: true,
          games: true,
        },
      },
    },
  });
  if (!week) {
    console.log("No week 1 found");
    return;
  }
  console.log(
    JSON.stringify(
      {
        weekId: week.id,
        label: week.label,
        status: week.status,
        games: week._count.games,
        playerWeekStats: week._count.playerWeekStats,
        defenseWeekStats: week._count.defenseWeekStats,
        contests: week.contests,
      },
      null,
      2,
    ),
  );

  for (const contest of week.contests) {
    const entries = await prisma.contestEntry.count({
      where: { contestId: contest.id, excluded: false },
    });
    const withPts = await prisma.contestEntry.count({
      where: {
        contestId: contest.id,
        excluded: false,
        fantasyPoints: { not: null },
      },
    });
    const withRank = await prisma.contestEntry.count({
      where: {
        contestId: contest.id,
        excluded: false,
        actualRank: { not: null },
      },
    });
    const stats =
      contest.position === "DEF"
        ? await prisma.defenseWeekStat.count({
            where: { weekId: week.id, rankableEntryId: { not: null } },
          })
        : await prisma.playerWeekStat.count({
            where: {
              weekId: week.id,
              rankableEntryId: { not: null },
              rankableEntry: { position: contest.position },
            },
          });
    const statsLinked =
      contest.position === "DEF"
        ? await prisma.defenseWeekStat.count({
            where: {
              weekId: week.id,
              rankableEntryId: { not: null },
              leagueActualRank: { not: null },
            },
          })
        : await prisma.playerWeekStat.count({
            where: {
              weekId: week.id,
              leagueActualRank: { not: null },
              rankableEntry: { position: contest.position },
            },
          });
    const sampleStat =
      contest.position === "DEF"
        ? await prisma.defenseWeekStat.findFirst({
            where: { weekId: week.id },
            select: {
              id: true,
              rankableEntryId: true,
              fantasyPoints: true,
              provider: true,
              isProvisional: true,
              leagueActualRank: true,
            },
          })
        : await prisma.playerWeekStat.findFirst({
            where: {
              weekId: week.id,
              rankableEntry: { position: contest.position },
            },
            select: {
              id: true,
              rankableEntryId: true,
              fantasyPoints: true,
              provider: true,
              isProvisional: true,
              leagueActualRank: true,
            },
          });
    const entryIds = await prisma.contestEntry.findMany({
      where: {
        contestId: contest.id,
        excluded: false,
        fantasyPoints: { not: null },
      },
      select: { rankableEntryId: true },
    });
    const entrySet = new Set(entryIds.map((e) => e.rankableEntryId));
    const statIds =
      contest.position === "DEF"
        ? await prisma.defenseWeekStat.findMany({
            where: { weekId: week.id, rankableEntryId: { not: null } },
            select: { rankableEntryId: true },
          })
        : await prisma.playerWeekStat.findMany({
            where: {
              weekId: week.id,
              rankableEntryId: { not: null },
              rankableEntry: { position: contest.position },
            },
            select: { rankableEntryId: true },
          });
    const overlap = statIds.filter(
      (s) => s.rankableEntryId && entrySet.has(s.rankableEntryId),
    ).length;
    console.log(
      JSON.stringify({
        position: contest.position,
        entries,
        withPts,
        withRank,
        weekStatsWithEntryId: stats,
        weekStatsWithLeagueRank: statsLinked,
        overlapStatsInContest: overlap,
        sampleStat,
      }),
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

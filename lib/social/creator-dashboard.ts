import { prisma } from "@/lib/db";
import { getActiveSeasonAndWeek } from "@/lib/leaderboards";
import { evaluateProfileQualification } from "@/lib/social/creator";
import { getFollowCounts } from "@/lib/social/follows";
import { listCreatorLedgerEntries, summarizeCreatorLedger } from "@/lib/social/ledger";
import { listUnlocksForCreator } from "@/lib/social/unlocks";

export async function getCreatorDashboard(profileId: string) {
  const qualification = await evaluateProfileQualification(profileId);
  const followCounts = await getFollowCounts(profileId);
  const context = await getActiveSeasonAndWeek();

  const currentWeekBoards = context?.week
    ? await prisma.rankingSubmission.findMany({
        where: {
          universalProfileId: profileId,
          contest: { weekId: context.week.id },
        },
        include: {
          contest: true,
        },
        orderBy: { contest: { position: "asc" } },
      })
    : [];

  const unlockCounts = currentWeekBoards.length
    ? await prisma.boardUnlockEvent.groupBy({
        by: ["contestId"],
        where: {
          creatorProfileId: profileId,
          contestId: { in: currentWeekBoards.map((row) => row.contestId) },
        },
        _count: { _all: true },
      })
    : [];
  const unlockCountMap = new Map(
    unlockCounts.map((row) => [row.contestId, row._count._all]),
  );

  const [recentFollowers, recentUnlocks, ledger, ledgerSummary] =
    await Promise.all([
      prisma.profileFollow.findMany({
        where: { followedProfileId: profileId },
        orderBy: { createdAt: "desc" },
        take: 12,
        include: {
          follower: {
            select: {
              username: true,
              displayName: true,
              profileType: true,
              avatarUrl: true,
            },
          },
        },
      }),
      listUnlocksForCreator(profileId, 20),
      listCreatorLedgerEntries(profileId, 20),
      summarizeCreatorLedger(profileId),
    ]);

  return {
    qualification,
    followCounts,
    week: context?.week ?? null,
    currentWeekBoards: currentWeekBoards.map((board) => ({
      contestId: board.contestId,
      position: board.contest.position,
      title: board.contest.title,
      status: board.status,
      revealPreference: board.revealPreference,
      unlockCount: unlockCountMap.get(board.contestId) ?? 0,
    })),
    recentFollowers,
    recentUnlocks,
    ledger,
    ledgerSummary,
  };
}

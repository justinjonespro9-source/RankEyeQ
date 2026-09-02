import { prisma } from "@/lib/db";
import { submissionIsEligible } from "@/lib/contest-lifecycle";
import { assignCompetitionRanks } from "@/lib/fantasy/competition-rank";

export type ThursdayReceiptCaller = {
  username: string;
  displayName: string;
};

export type ThursdayReceiptCommitment = {
  rank: number;
  username: string;
  displayName: string;
};

export function committedPicksForKickoff(input: {
  rankableEntryId: string;
  kickoff: Date;
  eligibleBoards: Array<{
    username: string;
    displayName: string;
    picks: Array<{
      rankableEntryId: string;
      predictedRank: number;
      lockedRank: number | null;
      slotLocked: boolean;
      committedAt: Date | null;
      lockedAt: Date | null;
    }>;
  }>;
}): ThursdayReceiptCommitment[] {
  const rows: ThursdayReceiptCommitment[] = [];
  for (const board of input.eligibleBoards) {
    const pick = board.picks.find(
      (item) => item.rankableEntryId === input.rankableEntryId,
    );
    if (!pick) continue;
    const proof = pick.committedAt ?? pick.lockedAt;
    if (!proof || proof.getTime() > input.kickoff.getTime()) continue;
    rows.push({
      rank: pick.lockedRank ?? pick.predictedRank,
      username: board.username,
      displayName: board.displayName,
    });
  }
  return rows;
}

export function summarizeReceiptCommitments(
  committed: ThursdayReceiptCommitment[],
  sampleSize: number,
) {
  const rankedOne = committed.filter((row) => row.rank === 1);
  const denom = sampleSize || committed.length || 1;
  return {
    boardsIncluding: committed.length,
    percentRankedOne: rankedOne.length / denom,
    percentTop3: committed.filter((row) => row.rank <= 3).length / denom,
    averageCommittedRank:
      committed.length === 0
        ? null
        : committed.reduce((sum, row) => sum + row.rank, 0) / committed.length,
    numberOneCallers: rankedOne.slice(0, 8) as ThursdayReceiptCaller[],
  };
}

export type ThursdayReceiptRow = {
  rankableEntryId: string;
  name: string;
  team: string;
  position: string;
  fantasyPoints: number | null;
  provisionalRank: number | null;
  gameStatus: string;
  boardsIncluding: number;
  percentRankedOne: number;
  percentTop3: number;
  averageCommittedRank: number | null;
  numberOneCallers: Array<{
    username: string;
    displayName: string;
  }>;
};

function kickoffOf(entry: {
  game?: { startsAt: Date | null; status: string } | null;
  rankableEntry: {
    gameStartsAt: Date | null;
    game?: { startsAt: Date | null; status: string } | null;
  };
}) {
  return (
    entry.game?.startsAt ??
    entry.rankableEntry.game?.startsAt ??
    entry.rankableEntry.gameStartsAt ??
    null
  );
}

function gameStatusOf(entry: {
  game?: { status: string } | null;
  rankableEntry: { game?: { status: string } | null };
}) {
  return entry.game?.status ?? entry.rankableEntry.game?.status ?? "SCHEDULED";
}

/**
 * Public early-game receipts. Uses only pre-kickoff commitments on official boards.
 * Does not expose remaining Sunday rankings.
 */
export async function getThursdayReceipts(weekId: string): Promise<{
  weekLabel: string;
  rows: ThursdayReceiptRow[];
}> {
  const week = await prisma.week.findUniqueOrThrow({
    where: { id: weekId },
    include: {
      contests: {
        include: {
          entries: {
            where: { excluded: false },
            include: {
              game: true,
              rankableEntry: { include: { game: true } },
            },
          },
          submissions: {
            include: {
              picks: true,
              universalProfile: {
                select: { username: true, displayName: true, profileType: true },
              },
            },
          },
        },
      },
    },
  });

  const rows: ThursdayReceiptRow[] = [];

  for (const contest of week.contests) {
    const completed = contest.entries.filter((entry) => {
      const status = gameStatusOf(entry);
      return status === "FINAL";
    });
    if (completed.length === 0) continue;

    const ranked = assignCompetitionRanks(
      contest.entries.filter((entry) => entry.fantasyPoints != null),
      (entry) => entry.fantasyPoints as number,
    );
    const rankById = new Map(
      ranked.map((row) => [row.item.rankableEntryId, row.rank]),
    );

    const eligible = contest.submissions.filter((submission) =>
      submissionIsEligible(submission.status),
    );
    const sampleSize = eligible.length;

    for (const entry of completed) {
      const kickoff = kickoffOf(entry);
      if (!kickoff) continue;

      const committed = committedPicksForKickoff({
        rankableEntryId: entry.rankableEntryId,
        kickoff,
        eligibleBoards: eligible.map((submission) => ({
          username: submission.universalProfile.username,
          displayName: submission.universalProfile.displayName,
          picks: submission.picks,
        })),
      });
      const summary = summarizeReceiptCommitments(committed, sampleSize);

      rows.push({
        rankableEntryId: entry.rankableEntryId,
        name: entry.rankableEntry.name,
        team: entry.rankableEntry.team,
        position: contest.position,
        fantasyPoints: entry.fantasyPoints,
        provisionalRank: rankById.get(entry.rankableEntryId) ?? null,
        gameStatus: gameStatusOf(entry),
        ...summary,
      });
    }
  }

  rows.sort((a, b) => (b.fantasyPoints ?? -1) - (a.fantasyPoints ?? -1));

  return { weekLabel: week.label, rows };
}

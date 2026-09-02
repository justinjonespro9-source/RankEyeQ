import { prisma } from "@/lib/db";
import { submissionIsEligible } from "@/lib/contest-lifecycle";
import { assignCompetitionRanks } from "@/lib/fantasy/competition-rank";
import { scoreContest } from "@/lib/scoring";
import type { ContestPosition, ProfileType } from "@/lib/generated/prisma/client";

export type LiveRankerRow = {
  universalProfileId: string;
  username: string;
  displayName: string;
  profileType: ProfileType;
  liveRankIqScore: number;
  topNHits: number;
  numberOneHit: boolean;
  contestsCounted: number;
  rank: number;
};

export type LivePlayerStanding = {
  rankableEntryId: string;
  name: string;
  team: string;
  fantasyPoints: number;
  provisionalRank: number;
  gameStatus: "FINAL" | "IN_PROGRESS" | "NOT_STARTED" | "OTHER";
};

function mapGameStatus(status: string | null | undefined): LivePlayerStanding["gameStatus"] {
  if (status === "FINAL") return "FINAL";
  if (status === "IN_PROGRESS") return "IN_PROGRESS";
  if (status === "SCHEDULED") return "NOT_STARTED";
  return "OTHER";
}

/**
 * Provisional actual ranks from current fantasy points (competition ranking).
 * Does not persist or overwrite official actualRank/normalizedScore.
 */
export function provisionalRanksFromPoints(
  entries: Array<{ rankableEntryId: string; fantasyPoints: number | null }>,
) {
  const withPoints = entries.filter(
    (entry): entry is { rankableEntryId: string; fantasyPoints: number } =>
      entry.fantasyPoints != null,
  );
  return assignCompetitionRanks(withPoints, (entry) => entry.fantasyPoints);
}

export async function getLivePlayerStandings(
  contestId: string,
): Promise<LivePlayerStanding[]> {
  const contest = await prisma.rankIQContest.findUniqueOrThrow({
    where: { id: contestId },
    include: {
      entries: {
        where: { excluded: false },
        include: {
          game: true,
          rankableEntry: { include: { game: true } },
        },
      },
    },
  });

  const ranked = provisionalRanksFromPoints(contest.entries);
  return ranked.map((row) => {
    const entry = contest.entries.find(
      (item) => item.rankableEntryId === row.item.rankableEntryId,
    )!;
    return {
      rankableEntryId: entry.rankableEntryId,
      name: entry.rankableEntry.name,
      team: entry.rankableEntry.team,
      fantasyPoints: row.score,
      provisionalRank: row.rank,
      gameStatus: mapGameStatus(
        entry.game?.status ?? entry.rankableEntry.game?.status,
      ),
    };
  });
}

export async function getLiveContestRankerBoard(contestId: string) {
  const contest = await prisma.rankIQContest.findUniqueOrThrow({
    where: { id: contestId },
    include: {
      entries: { where: { excluded: false } },
      submissions: {
        include: {
          picks: true,
          universalProfile: true,
        },
      },
    },
  });

  const ranked = provisionalRanksFromPoints(contest.entries);
  if (ranked.length === 0) return [];

  const actualById = new Map(
    ranked.map((row) => [row.item.rankableEntryId, row.rank]),
  );

  const rows: Omit<LiveRankerRow, "rank">[] = [];
  for (const submission of contest.submissions) {
    if (!submissionIsEligible(submission.status)) continue;
    if (submission.picks.length !== contest.rankingDepth) continue;

    const summary = scoreContest(
      submission.picks.map((pick) => ({
        playerId: pick.rankableEntryId,
        playerName: pick.rankableEntryId,
        predictedRank: pick.predictedRank,
        actualRank:
          actualById.get(pick.rankableEntryId) ?? contest.rankingDepth + 100,
      })),
      contest.rankingDepth,
    );

    rows.push({
      universalProfileId: submission.universalProfileId,
      username: submission.universalProfile.username,
      displayName: submission.universalProfile.displayName,
      profileType: submission.universalProfile.profileType,
      liveRankIqScore: summary.rankIqScore,
      topNHits: summary.topNHits,
      numberOneHit: summary.numberOneHit,
      contestsCounted: 1,
    });
  }

  return rows
    .sort((a, b) => b.liveRankIqScore - a.liveRankIqScore)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export async function getLiveWeekRankerBoard(weekId: string, position?: ContestPosition) {
  const contests = await prisma.rankIQContest.findMany({
    where: position ? { weekId, position } : { weekId },
    select: { id: true },
  });

  const byProfile = new Map<
    string,
    Omit<LiveRankerRow, "rank" | "liveRankIqScore"> & { scores: number[] }
  >();

  for (const contest of contests) {
    const board = await getLiveContestRankerBoard(contest.id);
    for (const row of board) {
      const current = byProfile.get(row.universalProfileId);
      if (!current) {
        byProfile.set(row.universalProfileId, {
          universalProfileId: row.universalProfileId,
          username: row.username,
          displayName: row.displayName,
          profileType: row.profileType,
          topNHits: row.topNHits,
          numberOneHit: row.numberOneHit,
          contestsCounted: 1,
          scores: [row.liveRankIqScore],
        });
      } else {
        current.scores.push(row.liveRankIqScore);
        current.topNHits += row.topNHits;
        current.numberOneHit = current.numberOneHit || row.numberOneHit;
        current.contestsCounted += 1;
      }
    }
  }

  return [...byProfile.values()]
    .map((row) => ({
      ...row,
      liveRankIqScore:
        row.scores.reduce((sum, value) => sum + value, 0) / row.scores.length,
      rank: 0,
    }))
    .sort((a, b) => b.liveRankIqScore - a.liveRankIqScore)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

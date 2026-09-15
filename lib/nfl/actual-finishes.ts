import { prisma } from "@/lib/db";
import { assignCompetitionRanks } from "@/lib/fantasy/competition-rank";
import type { ContestPosition } from "@/lib/generated/prisma/client";

export type ActualFinishResult = {
  contestId: string;
  position: ContestPosition;
  ranked: number;
  tiedGroups: number;
  /** ContestEntry rows with non-null fantasyPoints that received actualRank. */
  contestEntriesRanked: number;
  /** ContestEntry rows with fantasyPoints before this run. */
  contestEntriesWithPoints: number;
};

const OFFENSIVE_POSITIONS: ContestPosition[] = ["QB", "RB", "WR", "TE"];

type ScoredRow = {
  /** ContestEntry id — canonical row being ranked. */
  id: string;
  rankableEntryId: string;
  fantasyPoints: number;
};

/**
 * RankEyeQ weekly positional finishes.
 *
 * Canonical source of truth: ContestEntry.fantasyPoints on the position contest
 * (manual live scoring, manual paste, or provider import all land here).
 *
 * Also mirrors leagueActualRank onto matching PlayerWeekStat / DefenseWeekStat
 * rows when present — does not require WeekStats to compute ranks.
 */
export async function calculateLeagueActualFinishesForWeek(weekId: string) {
  const contests = await prisma.rankIQContest.findMany({
    where: { weekId },
    orderBy: { position: "asc" },
  });

  if (contests.length === 0) {
    throw new Error(`No position contests found for week ${weekId}`);
  }

  const results: ActualFinishResult[] = [];
  for (const contest of contests) {
    results.push(await calculateLeagueActualFinishesForContest(contest.id));
  }

  const totalRanked = results.reduce(
    (sum, row) => sum + row.contestEntriesRanked,
    0,
  );
  const totalWithPoints = results.reduce(
    (sum, row) => sum + row.contestEntriesWithPoints,
    0,
  );

  if (totalWithPoints > 0 && totalRanked === 0) {
    throw new Error(
      `Calculate Actual Finishes produced 0 ranks while ${totalWithPoints} ContestEntry rows have fantasyPoints. Refusing silent no-op.`,
    );
  }

  return results;
}

export async function calculateLeagueActualFinishesForContest(
  contestId: string,
): Promise<ActualFinishResult> {
  const contest = await prisma.rankIQContest.findUniqueOrThrow({
    where: { id: contestId },
    include: {
      entries: {
        where: {
          excluded: false,
          fantasyPoints: { not: null },
        },
        select: {
          id: true,
          rankableEntryId: true,
          fantasyPoints: true,
        },
      },
    },
  });

  const scored: ScoredRow[] = contest.entries.map((entry) => ({
    id: entry.id,
    rankableEntryId: entry.rankableEntryId,
    fantasyPoints: entry.fantasyPoints as number,
  }));

  if (scored.length === 0) {
    throw new Error(
      `No ContestEntry fantasyPoints for ${contest.position} (contest ${contest.id}). Paste/import or finalize live stats before calculating finishes.`,
    );
  }

  const ranked = assignCompetitionRanks(scored, (row) => row.fantasyPoints);

  const scoreCounts = new Map<number, number>();
  for (const row of ranked) {
    scoreCounts.set(row.score, (scoreCounts.get(row.score) ?? 0) + 1);
  }
  const tiedGroups = [...scoreCounts.values()].filter((count) => count > 1)
    .length;

  let contestEntriesRanked = 0;

  await prisma.$transaction(async (tx) => {
    // Clear prior ranks for this contest so removals / re-runs stay deterministic.
    await tx.contestEntry.updateMany({
      where: { contestId: contest.id },
      data: { actualRank: null },
    });

    for (const row of ranked) {
      const updated = await tx.contestEntry.updateMany({
        where: {
          id: row.item.id,
          contestId: contest.id,
        },
        data: {
          actualRank: row.rank,
          fantasyPoints: row.item.fantasyPoints,
        },
      });
      contestEntriesRanked += updated.count;

      if (contest.position === "DEF") {
        await tx.defenseWeekStat.updateMany({
          where: {
            weekId: contest.weekId,
            rankableEntryId: row.item.rankableEntryId,
          },
          data: { leagueActualRank: row.rank },
        });
      } else {
        await tx.playerWeekStat.updateMany({
          where: {
            weekId: contest.weekId,
            rankableEntryId: row.item.rankableEntryId,
          },
          data: { leagueActualRank: row.rank },
        });
      }
    }
  });

  if (contestEntriesRanked === 0) {
    throw new Error(
      `${contest.position}: scored ${scored.length} ContestEntry rows but wrote 0 actualRank values`,
    );
  }

  if (contestEntriesRanked !== scored.length) {
    throw new Error(
      `${contest.position}: expected to rank ${scored.length} ContestEntry rows but wrote ${contestEntriesRanked}`,
    );
  }

  return {
    contestId,
    position: contest.position,
    ranked: ranked.length,
    tiedGroups,
    contestEntriesRanked,
    contestEntriesWithPoints: scored.length,
  };
}

/** @deprecated Use calculateLeagueActualFinishesForWeek — kept as alias. */
export async function calculateActualFinishesForWeek(weekId: string) {
  return calculateLeagueActualFinishesForWeek(weekId);
}

/** @deprecated Use calculateLeagueActualFinishesForContest — kept as alias. */
export async function calculateActualFinishesForContest(contestId: string) {
  return calculateLeagueActualFinishesForContest(contestId);
}

export { OFFENSIVE_POSITIONS };

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
  poolCount: number;
};

const OFFENSIVE_POSITIONS: ContestPosition[] = ["QB", "RB", "WR", "TE"];

/**
 * Per-row interactive transactions (~5s default) timed out after QB on
 * production-sized pools (RB 114 / WR 182). Persist with parallel chunks
 * instead of N sequential updates inside one interactive tx.
 */
const WRITE_CHUNK_SIZE = 40;

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
 *
 * Each position is independent: a failure on one contest does not skip the rest.
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
  const errors: string[] = [];

  for (const contest of contests) {
    try {
      results.push(await calculateLeagueActualFinishesForContest(contest.id));
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "unknown finish error";
      errors.push(`${contest.position} (${contest.id}): ${detail}`);
    }
  }

  if (errors.length > 0) {
    const partial = results
      .map((row) => `${row.position}:${row.contestEntriesRanked}`)
      .join(", ");
    throw new Error(
      `Calculate Actual Finishes failed for ${errors.length} position(s). ` +
        `Completed: [${partial || "none"}]. Errors: ${errors.join(" | ")}`,
    );
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
        },
        select: {
          id: true,
          rankableEntryId: true,
          fantasyPoints: true,
        },
      },
    },
  });

  const poolCount = contest.entries.length;
  const scored: ScoredRow[] = contest.entries
    .filter((entry) => entry.fantasyPoints != null)
    .map((entry) => ({
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

  const contestEntriesRanked = await persistContestActualRanks({
    contestId: contest.id,
    weekId: contest.weekId,
    position: contest.position,
    ranked,
  });

  if (contestEntriesRanked === 0) {
    throw new Error(
      `${contest.position} (${contest.id}): scored ${scored.length} ContestEntry rows but wrote 0 actualRank values`,
    );
  }

  if (contestEntriesRanked !== scored.length) {
    throw new Error(
      `${contest.position} (${contest.id}): expected to rank ${scored.length} ContestEntry rows but wrote ${contestEntriesRanked}`,
    );
  }

  return {
    contestId,
    position: contest.position,
    ranked: ranked.length,
    tiedGroups,
    contestEntriesRanked,
    contestEntriesWithPoints: scored.length,
    poolCount,
  };
}

async function persistContestActualRanks(input: {
  contestId: string;
  weekId: string;
  position: ContestPosition;
  ranked: Array<{ item: ScoredRow; rank: number }>;
}): Promise<number> {
  const { contestId, weekId, position, ranked } = input;

  // Clear then rewrite — deterministic / idempotent on rerun.
  await prisma.contestEntry.updateMany({
    where: { contestId },
    data: { actualRank: null },
  });

  let written = 0;
  for (let i = 0; i < ranked.length; i += WRITE_CHUNK_SIZE) {
    const slice = ranked.slice(i, i + WRITE_CHUNK_SIZE);
    const counts = await Promise.all(
      slice.map(async (row) => {
        const updated = await prisma.contestEntry.updateMany({
          where: { id: row.item.id, contestId },
          data: {
            actualRank: row.rank,
            fantasyPoints: row.item.fantasyPoints,
          },
        });
        return updated.count;
      }),
    );
    written += counts.reduce((sum, count) => sum + count, 0);
  }

  // Mirror onto WeekStats when present (best-effort; ContestEntry is canonical).
  for (let i = 0; i < ranked.length; i += WRITE_CHUNK_SIZE) {
    const slice = ranked.slice(i, i + WRITE_CHUNK_SIZE);
    await Promise.all(
      slice.map(async (row) => {
        if (position === "DEF") {
          await prisma.defenseWeekStat.updateMany({
            where: {
              weekId,
              rankableEntryId: row.item.rankableEntryId,
            },
            data: { leagueActualRank: row.rank },
          });
        } else {
          await prisma.playerWeekStat.updateMany({
            where: {
              weekId,
              rankableEntryId: row.item.rankableEntryId,
            },
            data: { leagueActualRank: row.rank },
          });
        }
      }),
    );
  }

  return written;
}

/** @deprecated Use calculateLeagueActualFinishesForWeek — kept as alias. */
export async function calculateActualFinishesForWeek(weekId: string) {
  return calculateLeagueActualFinishesForWeek(weekId);
}

/** @deprecated Use calculateLeagueActualFinishesForContest — kept as alias. */
export async function calculateActualFinishesForContest(contestId: string) {
  return calculateLeagueActualFinishesForContest(contestId);
}

/** Plain serializable summary for the admin server action / UI. */
export function summarizeActualFinishCounts(results: ActualFinishResult[]): {
  byPosition: Record<string, number>;
  total: number;
  summary: string;
} {
  const byPosition: Record<string, number> = {};
  for (const row of results) {
    byPosition[row.position] = row.contestEntriesRanked;
  }
  const total = results.reduce(
    (sum, row) => sum + row.contestEntriesRanked,
    0,
  );
  const summary = results
    .map((row) => `${row.position}: ${row.contestEntriesRanked} ranked`)
    .join(" · ");
  return { byPosition, total, summary };
}

export { OFFENSIVE_POSITIONS, WRITE_CHUNK_SIZE };

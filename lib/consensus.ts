import { prisma } from "@/lib/db";
import {
  filterEligibleConsensusSubmissions,
  type ConsensusFilter,
} from "@/lib/consensus-filters";
import {
  buildConsensusEntries,
  type ConsensusCallouts,
  type ConsensusEntry,
  type PlayerConfidenceSignals,
} from "@/lib/consensus-math";
import { getConsensusAllMode } from "@/lib/consensus-config";
import {
  buildGroupWeightedAllConsensus,
  resolveAllParticipationFromSnapshot,
} from "@/lib/consensus-group-weighted";

export type { ConsensusFilter } from "@/lib/consensus-filters";
export type { ConsensusCallouts, ConsensusEntry, PlayerConfidenceSignals };
export { buildConsensusEntries, toPlayerConfidenceSignals } from "@/lib/consensus-math";
export { filterEligibleConsensusSubmissions } from "@/lib/consensus-filters";
export {
  formatConsensusParticipationBadge,
  resolveAllParticipationFromSnapshot,
} from "@/lib/consensus-group-weighted";

export type ContestConsensusResult = {
  fieldSize: number;
  /** Qualifying ballots in this view (for All: same as totalEntryCount). */
  sampleSize: number;
  contestStatus: string | null;
  weekLabel: string | null;
  position: string | null;
  entries: ConsensusEntry[];
  callouts: ConsensusCallouts;
  fromSnapshot?: boolean;
  allConsensusMode?: string;
  /** All only: sum of qualifying ballots across non-empty groups. */
  totalEntryCount?: number;
  /** All only: number of non-empty groups in equal-weight blend. */
  contributingGroupCount?: number;
};

type LoadedContest = NonNullable<
  Awaited<ReturnType<typeof loadContestForConsensus>>
>;

async function loadContestForConsensus(contestId: string) {
  return prisma.rankIQContest.findUnique({
    where: { id: contestId },
    include: {
      week: true,
      entries: { include: { rankableEntry: true } },
      submissions: {
        include: {
          picks: true,
          universalProfile: true,
        },
      },
    },
  });
}

function buildLiveSegmentConsensus(
  contest: LoadedContest,
  filter: ConsensusFilter,
) {
  const eligible = filterEligibleConsensusSubmissions(
    contest.submissions.map((submission) => ({
      ...submission,
      profileType: submission.universalProfile.profileType,
    })),
    filter,
  );

  const built = buildConsensusEntries({
    fieldSize: contest.rankingDepth,
    sampleSize: eligible.length,
    actualResultFinal:
      contest.status === "FINAL" || contest.status === "ARCHIVED",
    entries: contest.entries.map((entry) => ({
      rankableEntryId: entry.rankableEntryId,
      name: entry.rankableEntry.name,
      team: entry.rankableEntry.team,
      opponent: entry.rankableEntry.opponent,
      actualRank: entry.actualRank,
      fantasyPoints: entry.fantasyPoints,
      predictedRanks: eligible
        .map(
          (submission) =>
            submission.picks.find(
              (pick) => pick.rankableEntryId === entry.rankableEntryId,
            )?.predictedRank,
        )
        .filter((rank): rank is number => typeof rank === "number"),
    })),
  });

  return {
    fieldSize: contest.rankingDepth,
    sampleSize: eligible.length,
    entries: built.entries,
    callouts: built.callouts,
  };
}

function snapshotEntryToConsensusEntry(input: {
  rankableEntryId: string;
  name: string;
  team: string;
  opponent: string;
  actualRank: number | null;
  fantasyPoints: number | null;
  actualResultFinal: boolean;
  sampleSize: number;
  selectionRate: number;
  averageSelectedRank: number | null;
  consensusRank: number | null;
}): ConsensusEntry {
  return {
    rankableEntryId: input.rankableEntryId,
    name: input.name,
    team: input.team,
    opponent: input.opponent,
    actualRank: input.actualRank,
    fantasyPoints: input.fantasyPoints,
    actualResultFinal: input.actualResultFinal,
    averagePredictedRank: input.averageSelectedRank,
    averageSelectedRank: input.averageSelectedRank,
    consensusRank: input.consensusRank,
    percentRankedOne: 0,
    percentRankedTop3: 0,
    percentRankedTopN: input.selectionRate,
    rankPercent: input.selectionRate,
    selectionRate: input.selectionRate,
    rankPercentRank: null,
    podiumPercent: 0,
    podiumPercentRank: null,
    averageRankRank: null,
    timesRanked: Math.round(input.selectionRate * input.sampleSize),
    sampleSize: input.sampleSize,
    rankStdev: null,
    consensusVsActual:
      input.actualRank != null && input.consensusRank != null
        ? input.actualRank - input.consensusRank
        : null,
  };
}

async function getContestConsensusFromSnapshot(
  contestId: string,
  filter: ConsensusFilter,
) {
  // Creator segment is live-only until snapshot schema stores Creator columns.
  if (filter === "CREATOR") return null;

  const contest = await prisma.rankIQContest.findUnique({
    where: { id: contestId },
    include: {
      week: true,
      pregameSnapshot: { include: { entries: { include: { rankableEntry: true } } } },
      entries: { include: { rankableEntry: true } },
    },
  });

  if (!contest?.pregameSnapshot) return null;

  const snapshot = contest.pregameSnapshot;
  const allParticipation =
    filter === "ALL"
      ? resolveAllParticipationFromSnapshot(snapshot)
      : null;
  const sampleSize =
    filter === "HUMAN"
      ? snapshot.sampleSizeHuman
      : filter === "AI"
        ? snapshot.sampleSizeAi
        : filter === "EXPERT"
          ? snapshot.sampleSizeExpert
          : (allParticipation?.totalEntryCount ?? snapshot.sampleSizeAll);

  const actualByPlayer = new Map(
    contest.entries.map((entry) => [
      entry.rankableEntryId,
      {
        actualRank: entry.actualRank,
        fantasyPoints: entry.fantasyPoints,
        name: entry.rankableEntry.name,
        team: entry.rankableEntry.team,
        opponent: entry.rankableEntry.opponent,
      },
    ]),
  );

  const entries = snapshot.entries.map((row) => {
    const pool = actualByPlayer.get(row.rankableEntryId);
    const selectionRate =
      filter === "HUMAN"
        ? row.selectionRateHuman
        : filter === "AI"
          ? row.selectionRateAi
          : filter === "EXPERT"
            ? row.selectionRateExpert
            : row.selectionRateAll;
    const averageSelectedRank =
      filter === "HUMAN"
        ? row.averageSelectedRankHuman
        : filter === "AI"
          ? row.averageSelectedRankAi
          : filter === "EXPERT"
            ? row.averageSelectedRankExpert
            : row.averageSelectedRankAll;
    const consensusRank =
      filter === "HUMAN"
        ? row.consensusRankHuman
        : filter === "AI"
          ? row.consensusRankAi
          : filter === "EXPERT"
            ? row.consensusRankExpert
            : row.consensusRankAll;

    return snapshotEntryToConsensusEntry({
      rankableEntryId: row.rankableEntryId,
      name: pool?.name ?? row.rankableEntry.name,
      team: pool?.team ?? row.rankableEntry.team,
      opponent: pool?.opponent ?? row.rankableEntry.opponent,
      actualRank: pool?.actualRank ?? null,
      fantasyPoints: pool?.fantasyPoints ?? null,
      actualResultFinal:
        contest.status === "FINAL" || contest.status === "ARCHIVED",
      sampleSize,
      selectionRate,
      averageSelectedRank,
      consensusRank,
    });
  });

  entries.sort((a, b) => {
    const left = a.consensusRank ?? 9999;
    const right = b.consensusRank ?? 9999;
    if (left !== right) return left - right;
    return a.name.localeCompare(b.name);
  });

  return {
    fieldSize: contest.rankingDepth,
    sampleSize,
    contestStatus: contest.status,
    weekLabel: contest.week.label,
    position: contest.position,
    entries,
    callouts: {
      biggestHit: null,
      biggestMiss: null,
      mostPolarizing: null,
    },
    fromSnapshot: true as const,
    allConsensusMode: snapshot.allConsensusMode,
    ...(allParticipation
      ? {
          totalEntryCount: allParticipation.totalEntryCount,
          contributingGroupCount: allParticipation.contributingGroupCount,
        }
      : {}),
  };
}

export type GetContestConsensusOptions = {
  /**
   * Skip frozen pregame snapshot and aggregate from current eligible
   * submissions. Used for admin pre-lock preview so live Expert / Creator / AI
   * ballots are visible even if a partial snapshot exists.
   */
  preferLive?: boolean;
};

/**
 * Community consensus from eligible submitted/locked/graded rankings.
 *
 * ALL segment:
 * - ballot_union (legacy): every Human + AI ballot weighted equally;
 *   Experts and Creators excluded.
 * - group_weighted (default): equal-weight blend of Human, Experts, Creators,
 *   and AI group consensus (empty groups skipped).
 *
 * Configure via RANKEYEQ_CONSENSUS_ALL_MODE=ballot_union|group_weighted
 * (legacy alias: RANKEQ_CONSENSUS_ALL_MODE).
 */
export async function getContestConsensus(
  contestId: string,
  filter: ConsensusFilter = "ALL",
  options?: GetContestConsensusOptions,
): Promise<ContestConsensusResult> {
  if (!options?.preferLive) {
    const snapshotted = await getContestConsensusFromSnapshot(contestId, filter);
    if (snapshotted) return snapshotted;
  }

  const contest = await loadContestForConsensus(contestId);

  if (!contest) {
    return {
      fieldSize: 0,
      sampleSize: 0,
      contestStatus: null,
      weekLabel: null,
      position: null,
      entries: [],
      callouts: {
        biggestHit: null,
        biggestMiss: null,
        mostPolarizing: null,
      },
    };
  }

  const allMode = getConsensusAllMode();

  if (filter === "ALL" && allMode === "group_weighted") {
    const human = buildLiveSegmentConsensus(contest, "HUMAN");
    const ai = buildLiveSegmentConsensus(contest, "AI");
    const expert = buildLiveSegmentConsensus(contest, "EXPERT");
    const creator = buildLiveSegmentConsensus(contest, "CREATOR");
    const merged = buildGroupWeightedAllConsensus({
      fieldSize: contest.rankingDepth,
      human,
      ai,
      expert,
      creator,
      actualResultFinal:
        contest.status === "FINAL" || contest.status === "ARCHIVED",
    });

    return {
      fieldSize: contest.rankingDepth,
      sampleSize: merged.totalEntryCount,
      contestStatus: contest.status,
      weekLabel: contest.week.label,
      position: contest.position,
      entries: merged.entries,
      callouts: {
        biggestHit: null,
        biggestMiss: null,
        mostPolarizing: null,
      },
      allConsensusMode: allMode,
      totalEntryCount: merged.totalEntryCount,
      contributingGroupCount: merged.contributingGroupCount,
    };
  }

  const segment = buildLiveSegmentConsensus(contest, filter);

  return {
    fieldSize: segment.fieldSize,
    sampleSize: segment.sampleSize,
    contestStatus: contest.status,
    weekLabel: contest.week.label,
    position: contest.position,
    entries: segment.entries,
    callouts: segment.callouts,
    allConsensusMode: filter === "ALL" ? allMode : undefined,
    ...(filter === "ALL"
      ? {
          totalEntryCount: segment.sampleSize,
          contributingGroupCount: segment.sampleSize > 0 ? 1 : 0,
        }
      : {}),
  };
}

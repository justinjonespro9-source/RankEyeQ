import { prisma } from "@/lib/db";
import {
  buildConsensusEntries,
  type ConsensusEntry,
} from "@/lib/consensus-math";
import {
  filterEligibleConsensusSubmissions,
  type ConsensusFilter,
} from "@/lib/consensus-filters";
import { getConsensusAllMode } from "@/lib/consensus-config";
import { buildGroupWeightedAllConsensus } from "@/lib/consensus-group-weighted";
import {
  isAnalystExpertSource,
  isPublisherConsensusSource,
} from "@/lib/expert-identity";
import type { ProfileType, SubmissionStatus } from "@/lib/generated/prisma/client";

export type SegmentMetrics = {
  sampleSize: number;
  selectionRate: number;
  averageSelectedRank: number | null;
  consensusRank: number | null;
};

function buildSegmentConsensus(input: {
  contest: {
    rankingDepth: number;
    entries: {
      rankableEntryId: string;
      rankableEntry: { name: string; team: string; opponent: string };
      actualRank: number | null;
      fantasyPoints: number | null;
    }[];
    submissions: {
      status: SubmissionStatus;
      profileType: ProfileType;
      sourceKind?: string | null;
      picks: { rankableEntryId: string; predictedRank: number }[];
    }[];
  };
  filter: ConsensusFilter;
}) {
  const eligible = filterEligibleConsensusSubmissions(
    input.contest.submissions,
    input.filter,
  );
  const sampleSize = eligible.length;
  const fieldSize = input.contest.rankingDepth;

  const built = buildConsensusEntries({
    fieldSize,
    sampleSize,
    entries: input.contest.entries.map((entry) => ({
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

  return { sampleSize, entries: built.entries };
}

/**
 * Capture immutable pregame selection + consensus metrics at Sunday full lock.
 * Idempotent — skips contests that already have a snapshot.
 */
export async function captureContestPregameSnapshotsForWeek(
  weekId: string,
  lockedAt: Date,
) {
  const contests = await prisma.rankIQContest.findMany({
    where: { weekId },
    include: {
      week: true,
      pregameSnapshot: true,
      entries: { include: { rankableEntry: true } },
      submissions: {
        include: {
          picks: true,
          universalProfile: {
            include: { expertSource: true, publicFromWeek: true },
          },
        },
      },
    },
  });

  let captured = 0;
  let skipped = 0;

  for (const contest of contests) {
    if (contest.pregameSnapshot) {
      skipped += 1;
      continue;
    }

    const contestInput = {
      rankingDepth: contest.rankingDepth,
      entries: contest.entries.map((entry) => ({
        rankableEntryId: entry.rankableEntryId,
        rankableEntry: entry.rankableEntry,
        actualRank: entry.actualRank,
        fantasyPoints: entry.fantasyPoints,
      })),
      submissions: contest.submissions.map((submission) => ({
        status: submission.status,
        profileType: submission.universalProfile.profileType,
        sourceKind: submission.universalProfile.expertSource?.sourceKind ?? null,
        competitorActive: submission.universalProfile.competitorActive,
        publicVisible: submission.universalProfile.publicVisible,
        publicFromWeekId: submission.universalProfile.publicFromWeekId,
        publicFromWeek: submission.universalProfile.publicFromWeek
          ? {
              id: submission.universalProfile.publicFromWeek.id,
              seasonId: submission.universalProfile.publicFromWeek.seasonId,
              weekNumber: submission.universalProfile.publicFromWeek.weekNumber,
              startsAt: submission.universalProfile.publicFromWeek.startsAt,
            }
          : null,
        week: {
          id: contest.week.id,
          seasonId: contest.week.seasonId,
          weekNumber: contest.week.weekNumber,
          startsAt: contest.week.startsAt,
        },
        picks: submission.picks,
      })),
    };

    const human = buildSegmentConsensus({ contest: contestInput, filter: "HUMAN" });
    const ai = buildSegmentConsensus({ contest: contestInput, filter: "AI" });
    const expert = buildSegmentConsensus({
      contest: contestInput,
      filter: "EXPERT",
    });
    const creator = buildSegmentConsensus({
      contest: contestInput,
      filter: "CREATOR",
    });
    const publisher = buildSegmentConsensus({
      contest: contestInput,
      filter: "PUBLISHER",
    });

    const allMode = getConsensusAllMode();
    let allEntries: ConsensusEntry[];
    let sampleSizeAll: number;
    if (allMode === "group_weighted") {
      const all = buildGroupWeightedAllConsensus({
        fieldSize: contest.rankingDepth,
        human,
        ai,
        expert,
        creator,
      });
      allEntries = all.entries;
      sampleSizeAll = all.totalEntryCount;
    } else {
      const all = buildSegmentConsensus({
        contest: contestInput,
        filter: "ALL",
      });
      allEntries = all.entries;
      sampleSizeAll = all.sampleSize;
    }

    const byId = (entries: ConsensusEntry[]) =>
      new Map(entries.map((entry) => [entry.rankableEntryId, entry]));

    const allById = byId(allEntries);
    const humanById = byId(human.entries);
    const aiById = byId(ai.entries);
    const expertById = byId(expert.entries);
    const creatorById = byId(creator.entries);
    const publisherById = byId(publisher.entries);

    const playerIds = new Set([
      ...contest.entries.map((entry) => entry.rankableEntryId),
    ]);

    await prisma.contestPregameSnapshot.create({
      data: {
        contestId: contest.id,
        lockedAt,
        sampleSizeAll,
        sampleSizeHuman: human.sampleSize,
        sampleSizeAi: ai.sampleSize,
        sampleSizeExpert: expert.sampleSize,
        sampleSizeCreator: creator.sampleSize,
        sampleSizePublisher: publisher.sampleSize,
        allConsensusMode: allMode,
        entries: {
          create: [...playerIds].map((rankableEntryId) => {
            const allEntry = allById.get(rankableEntryId);
            const humanEntry = humanById.get(rankableEntryId);
            const aiEntry = aiById.get(rankableEntryId);
            const expertEntry = expertById.get(rankableEntryId);
            const creatorEntry = creatorById.get(rankableEntryId);
            const publisherEntry = publisherById.get(rankableEntryId);

            return {
              rankableEntryId,
              selectionRateAll: allEntry?.selectionRate ?? 0,
              averageSelectedRankAll: allEntry?.averageSelectedRank ?? null,
              selectionRateHuman: humanEntry?.selectionRate ?? 0,
              averageSelectedRankHuman:
                humanEntry?.averageSelectedRank ?? null,
              selectionRateAi: aiEntry?.selectionRate ?? 0,
              averageSelectedRankAi: aiEntry?.averageSelectedRank ?? null,
              selectionRateExpert: expertEntry?.selectionRate ?? 0,
              averageSelectedRankExpert:
                expertEntry?.averageSelectedRank ?? null,
              selectionRateCreator: creatorEntry?.selectionRate ?? 0,
              averageSelectedRankCreator:
                creatorEntry?.averageSelectedRank ?? null,
              selectionRatePublisher: publisherEntry?.selectionRate ?? 0,
              averageSelectedRankPublisher:
                publisherEntry?.averageSelectedRank ?? null,
              selectedCountAll: allEntry?.timesRanked ?? 0,
              selectedCountHuman: humanEntry?.timesRanked ?? 0,
              selectedCountAi: aiEntry?.timesRanked ?? 0,
              selectedCountExpert: expertEntry?.timesRanked ?? 0,
              selectedCountCreator: creatorEntry?.timesRanked ?? 0,
              selectedCountPublisher: publisherEntry?.timesRanked ?? 0,
              consensusRankAll: allEntry?.consensusRank ?? null,
              consensusRankHuman: humanEntry?.consensusRank ?? null,
              consensusRankAi: aiEntry?.consensusRank ?? null,
              consensusRankExpert: expertEntry?.consensusRank ?? null,
              consensusRankCreator: creatorEntry?.consensusRank ?? null,
              consensusRankPublisher: publisherEntry?.consensusRank ?? null,
            };
          }),
        },
      },
    });

    captured += 1;
  }

  return { captured, skipped };
}

export { segmentForProfile };

function segmentForProfile(
  profileType: ProfileType,
  sourceKind?: string | null,
): "HUMAN" | "AI" | "EXPERT" | "CREATOR" | "PUBLISHER" | null {
  if (profileType === "HUMAN") return "HUMAN";
  if (profileType === "AI") return "AI";
  if (profileType === "CREATOR") return "CREATOR";
  if (profileType === "BENCHMARK") {
    if (isPublisherConsensusSource(sourceKind)) return "PUBLISHER";
    if (isAnalystExpertSource(sourceKind)) return "EXPERT";
    return null;
  }
  return null;
}

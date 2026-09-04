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
import type { ProfileType, SubmissionStatus } from "@/lib/generated/prisma/client";

export type SegmentMetrics = {
  sampleSize: number;
  selectionRate: number;
  averageSelectedRank: number | null;
  consensusRank: number | null;
};

function segmentForProfile(profileType: ProfileType): "HUMAN" | "AI" | "EXPERT" | "CREATOR" | null {
  if (profileType === "HUMAN") return "HUMAN";
  if (profileType === "AI") return "AI";
  if (profileType === "BENCHMARK") return "EXPERT";
  if (profileType === "CREATOR") return "CREATOR";
  return null;
}

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
      pregameSnapshot: true,
      entries: { include: { rankableEntry: true } },
      submissions: {
        include: {
          picks: true,
          universalProfile: true,
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
        picks: submission.picks,
      })),
    };

    const human = buildSegmentConsensus({ contest: contestInput, filter: "HUMAN" });
    const ai = buildSegmentConsensus({ contest: contestInput, filter: "AI" });
    const expert = buildSegmentConsensus({
      contest: contestInput,
      filter: "EXPERT",
    });

    const allMode = getConsensusAllMode();
    const all =
      allMode === "group_weighted"
        ? buildGroupWeightedAllConsensus({
            fieldSize: contest.rankingDepth,
            human,
            ai,
            expert,
          })
        : buildSegmentConsensus({ contest: contestInput, filter: "ALL" });

    const byId = (entries: ConsensusEntry[]) =>
      new Map(entries.map((entry) => [entry.rankableEntryId, entry]));

    const allById = byId(all.entries);
    const humanById = byId(human.entries);
    const aiById = byId(ai.entries);
    const expertById = byId(expert.entries);

    const playerIds = new Set([
      ...contest.entries.map((entry) => entry.rankableEntryId),
    ]);

    await prisma.contestPregameSnapshot.create({
      data: {
        contestId: contest.id,
        lockedAt,
        sampleSizeAll: all.sampleSize,
        sampleSizeHuman: human.sampleSize,
        sampleSizeAi: ai.sampleSize,
        sampleSizeExpert: expert.sampleSize,
        allConsensusMode: allMode,
        entries: {
          create: [...playerIds].map((rankableEntryId) => {
            const allEntry = allById.get(rankableEntryId);
            const humanEntry = humanById.get(rankableEntryId);
            const aiEntry = aiById.get(rankableEntryId);
            const expertEntry = expertById.get(rankableEntryId);

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
              consensusRankAll: allEntry?.consensusRank ?? null,
              consensusRankHuman: humanEntry?.consensusRank ?? null,
              consensusRankAi: aiEntry?.consensusRank ?? null,
              consensusRankExpert: expertEntry?.consensusRank ?? null,
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

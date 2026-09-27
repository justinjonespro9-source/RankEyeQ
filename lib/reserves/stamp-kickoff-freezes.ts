import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { submissionIsEligible } from "@/lib/contest-lifecycle";
import { buildContestWeekKickoffMap } from "@/lib/reserves/contest-week-kickoffs";
import { snapshotReservePredecessors } from "@/lib/reserves/effective-board";
import {
  loadKickoffFreezeEvidence,
  resolveKickoffFreezeFromEvidence,
} from "@/lib/reserves/kickoff-freeze-evidence-store";
import type {
  KickoffFreezeIgnoredEvidence,
  KickoffFreezeSource,
} from "@/lib/reserves/kickoff-freeze-evidence";
import { kickoffHasPassed } from "@/lib/timing/partial-lock";
import { getWeekTimingState } from "@/lib/timing/week-windows";

/** Historical contests are never re-stamped by the normal path. */
const REPORT_ONLY_CONTEST_STATUSES = new Set(["FINAL", "ARCHIVED"]);

export type KickoffFreezeStampItem = {
  submissionId: string;
  universalProfileId: string;
  pickId: string;
  rankableEntryId: string;
  predictedRank: number;
  kickoffAt: string;
  unavailable: boolean;
  source: KickoffFreezeSource;
  reason: string | null;
  ignored: KickoffFreezeIgnoredEvidence[];
};

export type KickoffFreezeStampResult = {
  contestId: string;
  weekId: string;
  contestStatus: string;
  mode: "apply" | "dry_run" | "report_only";
  eligibleSubmissions: number;
  picksExamined: number;
  alreadyFrozen: number;
  pendingKickoff: number;
  kickoffUnknown: number;
  /** Null freezes whose kickoff has passed (would be / were stamped). */
  candidates: number;
  candidatesTrue: number;
  candidatesFalse: number;
  stampedTrue: number;
  stampedFalse: number;
  predecessorCandidates: number;
  predecessorsStamped: number;
  items: KickoffFreezeStampItem[];
};

export type KickoffFreezeStampSummary = Omit<KickoffFreezeStampResult, "items">;

export function summarizeKickoffFreezeStamp(
  result: KickoffFreezeStampResult,
): KickoffFreezeStampSummary {
  const summary: Partial<KickoffFreezeStampResult> = { ...result };
  delete summary.items;
  return summary as KickoffFreezeStampSummary;
}

/**
 * Fill NULL wasUnavailableAtKickoff for every eligible submission in a contest
 * (all profile types) whose player's week-scoped kickoff has passed, using
 * kickoff-time evidence only. Also fills missing reserve predecessor snapshots
 * once the reserve slot is locked. Never overwrites a non-null value; every
 * write is guarded on NULL so concurrent or repeated runs are idempotent.
 *
 * FINAL / ARCHIVED contests are report-only (zero writes).
 */
export async function stampKickoffFreezesForContest(
  contestId: string,
  options: { now?: Date; dryRun?: boolean } = {},
): Promise<KickoffFreezeStampResult | null> {
  const now = options.now ?? new Date();

  const contest = await prisma.rankIQContest.findUnique({
    where: { id: contestId },
    include: {
      week: true,
      entries: {
        select: {
          rankableEntryId: true,
          game: {
            select: {
              id: true,
              weekId: true,
              homeTeam: true,
              awayTeam: true,
              startsAt: true,
            },
          },
        },
      },
      submissions: {
        select: {
          id: true,
          status: true,
          universalProfileId: true,
          picks: {
            select: {
              id: true,
              rankableEntryId: true,
              predictedRank: true,
              wasUnavailableAtKickoff: true,
              reserveEligiblePredecessorIds: true,
            },
            orderBy: { predictedRank: "asc" },
          },
        },
      },
    },
  });
  if (!contest) return null;

  const reportOnly = REPORT_ONLY_CONTEST_STATUSES.has(contest.status);
  const mode: KickoffFreezeStampResult["mode"] = reportOnly
    ? "report_only"
    : options.dryRun
      ? "dry_run"
      : "apply";

  const kickoffByEntryId = buildContestWeekKickoffMap({
    weekId: contest.weekId,
    entries: contest.entries,
  });
  const timing = getWeekTimingState({
    rankingsOpenAt: contest.week.rankingsOpenAt,
    fullLockAt: contest.week.fullLockAt,
    revealStartsAt: contest.week.revealStartsAt,
    publicReleaseAt: contest.week.publicReleaseAt,
    weekStatus: contest.week.status,
    now,
  });

  const eligible = contest.submissions.filter((submission) =>
    submissionIsEligible(submission.status),
  );
  const evidence = await loadKickoffFreezeEvidence({
    weekId: contest.weekId,
    seasonId: contest.week.seasonId,
    rankableEntryIds: eligible.flatMap((submission) =>
      submission.picks.map((pick) => pick.rankableEntryId),
    ),
  });

  const result: KickoffFreezeStampResult = {
    contestId: contest.id,
    weekId: contest.weekId,
    contestStatus: contest.status,
    mode,
    eligibleSubmissions: eligible.length,
    picksExamined: 0,
    alreadyFrozen: 0,
    pendingKickoff: 0,
    kickoffUnknown: 0,
    candidates: 0,
    candidatesTrue: 0,
    candidatesFalse: 0,
    stampedTrue: 0,
    stampedFalse: 0,
    predecessorCandidates: 0,
    predecessorsStamped: 0,
    items: [],
  };

  const trueIds: string[] = [];
  const falseIds: string[] = [];
  const predecessorWrites: Array<{ pickId: string; ids: string[] }> = [];
  const scoringDepth = contest.rankingDepth;

  for (const submission of eligible) {
    for (const pick of submission.picks) {
      result.picksExamined += 1;
      const kickoff = kickoffByEntryId.get(pick.rankableEntryId) ?? null;
      const kickedOff = kickoffHasPassed(kickoff, now);

      if (
        pick.predictedRank > scoringDepth &&
        pick.reserveEligiblePredecessorIds == null &&
        (timing.fullBoardLocked || kickedOff)
      ) {
        result.predecessorCandidates += 1;
        predecessorWrites.push({
          pickId: pick.id,
          ids: snapshotReservePredecessors({
            picks: submission.picks,
            reservePredictedRank: pick.predictedRank,
            scoringDepth,
          }),
        });
      }

      if (pick.wasUnavailableAtKickoff != null) {
        result.alreadyFrozen += 1;
        continue;
      }
      if (!kickoff) {
        result.kickoffUnknown += 1;
        continue;
      }
      if (!kickedOff) {
        result.pendingKickoff += 1;
        continue;
      }

      const decision = resolveKickoffFreezeFromEvidence(
        evidence,
        pick.rankableEntryId,
        kickoff,
      );
      result.candidates += 1;
      if (decision.unavailable) {
        result.candidatesTrue += 1;
        trueIds.push(pick.id);
      } else {
        result.candidatesFalse += 1;
        falseIds.push(pick.id);
      }
      result.items.push({
        submissionId: submission.id,
        universalProfileId: submission.universalProfileId,
        pickId: pick.id,
        rankableEntryId: pick.rankableEntryId,
        predictedRank: pick.predictedRank,
        kickoffAt: kickoff.toISOString(),
        unavailable: decision.unavailable,
        source: decision.source,
        reason: decision.reason,
        ignored: decision.ignored,
      });
    }
  }

  if (mode !== "apply") return result;

  if (trueIds.length > 0) {
    const written = await prisma.rankingPick.updateMany({
      where: { id: { in: trueIds }, wasUnavailableAtKickoff: null },
      data: { wasUnavailableAtKickoff: true },
    });
    result.stampedTrue = written.count;
  }
  if (falseIds.length > 0) {
    const written = await prisma.rankingPick.updateMany({
      where: { id: { in: falseIds }, wasUnavailableAtKickoff: null },
      data: { wasUnavailableAtKickoff: false },
    });
    result.stampedFalse = written.count;
  }
  for (const write of predecessorWrites) {
    const written = await prisma.rankingPick.updateMany({
      where: {
        id: write.pickId,
        reserveEligiblePredecessorIds: { equals: Prisma.DbNull },
      },
      data: { reserveEligiblePredecessorIds: write.ids },
    });
    result.predecessorsStamped += written.count;
  }

  return result;
}

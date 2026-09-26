import { prisma } from "@/lib/db";
import { getWeekTimingState } from "@/lib/timing/week-windows";
import { kickoffHasPassed } from "@/lib/timing/partial-lock";
import { captureContestPregameSnapshotsForWeek } from "@/lib/consensus-snapshot";
import { isStalePregameSnapshot } from "@/lib/consensus-snapshot-rebuild";
import { snapshotReservePredecessors } from "@/lib/reserves/effective-board";
import { freezeUnavailableFromWeekStatus } from "@/lib/reserves/kickoff-freeze";
import { loadResolvedStatusesForWeek } from "@/lib/eligibility/player-week-availability-store";
import { logServerEvent } from "@/lib/log";
import { resolveWeekScopedKickoff } from "@/lib/timing/resolve-contest-kickoff";
import { Prisma } from "@/lib/generated/prisma/client";

/**
 * Persist slot locks when kickoff/full-lock has occurred.
 * Does not grade and does not convert drafts into competitors.
 *
 * Kickoff freeze uses week-scoped resolvePlayerWeekStatus (PWA OUT/INACTIVE +
 * roster hard-unavailable + Admin override). Never RankableEntry.availability
 * alone. Already non-null freezes are immutable during normal locking.
 */
export async function applyKickoffLocksToSubmission(
  submissionId: string,
  now = new Date(),
) {
  const submission = await prisma.rankingSubmission.findUnique({
    where: { id: submissionId },
    include: {
      contest: {
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
        },
      },
      picks: {
        include: { rankableEntry: true },
      },
    },
  });
  if (!submission) return null;

  const week = submission.contest.week;
  const timing = getWeekTimingState({
    rankingsOpenAt: week.rankingsOpenAt,
    fullLockAt: week.fullLockAt,
    revealStartsAt: week.revealStartsAt,
    publicReleaseAt: week.publicReleaseAt,
    weekStatus: week.status,
    now,
  });

  const gameByEntry = new Map(
    submission.contest.entries.map((entry) => [
      entry.rankableEntryId,
      entry.game,
    ]),
  );

  const scoringDepth = submission.contest.rankingDepth;

  const weekStatuses = await loadResolvedStatusesForWeek({
    weekId: week.id,
    seasonId: week.seasonId,
    rankableEntryIds: submission.picks.map((pick) => pick.rankableEntryId),
  });

  for (const pick of submission.picks) {
    // Week-scoped ContestEntry.game only — never RankableEntry master kickoffs.
    const kickoff = resolveWeekScopedKickoff({
      weekId: week.id,
      contestGame: gameByEntry.get(pick.rankableEntryId) ?? null,
    });
    const lockNow =
      timing.fullBoardLocked || kickoffHasPassed(kickoff, now);

    // Clear premature locks (e.g. stale RankableEntry / wrong-week kickoffs) on
    // every authenticated read. Preserve ordering; only unlock when the
    // week-scoped kickoff has not actually occurred and full board is open.
    // Do not clear an already-frozen historical answer after kickoff.
    if (!lockNow) {
      if (
        pick.slotLocked ||
        pick.lockedAt != null ||
        pick.lockedRank != null ||
        pick.wasUnavailableAtKickoff != null ||
        pick.reserveEligiblePredecessorIds != null
      ) {
        await prisma.rankingPick.update({
          where: { id: pick.id },
          data: {
            slotLocked: false,
            lockedAt: null,
            lockedRank: null,
            reserveEligiblePredecessorIds: Prisma.DbNull,
            wasUnavailableAtKickoff: null,
          },
        });
      }
      continue;
    }

    const isReserve = pick.predictedRank > scoringDepth;
    const needsPredecessorSnapshot =
      isReserve && pick.reserveEligiblePredecessorIds == null;
    // Immutable once stamped — only fill null during normal locking.
    const needsUnavailableFreeze = pick.wasUnavailableAtKickoff == null;
    if (pick.slotLocked && !needsPredecessorSnapshot && !needsUnavailableFreeze) {
      continue;
    }

    const predecessorIds = needsPredecessorSnapshot
      ? snapshotReservePredecessors({
          picks: submission.picks,
          reservePredictedRank: pick.predictedRank,
          scoringDepth,
        })
      : undefined;

    const weekStatus = weekStatuses.get(pick.rankableEntryId);

    await prisma.rankingPick.update({
      where: { id: pick.id },
      data: {
        slotLocked: true,
        lockedAt: pick.lockedAt
          ? pick.lockedAt
          : timing.fullBoardLocked
            ? (week.fullLockAt ?? now)
            : (kickoff ?? now),
        lockedRank: pick.lockedRank ?? pick.predictedRank,
        committedAt: pick.committedAt ?? pick.lockedAt ?? now,
        ...(needsUnavailableFreeze
          ? {
              wasUnavailableAtKickoff: weekStatus
                ? freezeUnavailableFromWeekStatus(weekStatus)
                : false,
            }
          : {}),
        ...(predecessorIds
          ? { reserveEligiblePredecessorIds: predecessorIds }
          : {}),
      },
    });
  }

  if (
    timing.fullBoardLocked &&
    submission.status === "SUBMITTED"
  ) {
    await prisma.rankingSubmission.update({
      where: { id: submission.id },
      data: {
        status: "LOCKED",
        lockedAt: submission.lockedAt ?? week.fullLockAt ?? now,
      },
    });
  }

  return prisma.rankingSubmission.findUniqueOrThrow({
    where: { id: submissionId },
    include: {
      picks: {
        include: { rankableEntry: { include: { game: true } } },
        orderBy: { predictedRank: "asc" },
      },
      universalProfile: true,
      contest: true,
    },
  });
}

/** Lock all SUBMITTED boards for a week once Sunday full lock has passed. */
export async function ensureWeekFullLock(weekId: string, now = new Date()) {
  const week = await prisma.week.findUnique({ where: { id: weekId } });
  if (!week?.fullLockAt || now < week.fullLockAt) {
    return { lockedContests: 0, lockedSubmissions: 0 };
  }

  const contests = await prisma.rankIQContest.findMany({
    where: { weekId, status: { in: ["OPEN", "DRAFT"] } },
  });

  let lockedContests = 0;
  let lockedSubmissions = 0;
  for (const contest of contests) {
    await prisma.rankIQContest.update({
      where: { id: contest.id },
      data: { status: "LOCKED", locksAt: week.fullLockAt },
    });
    const result = await prisma.rankingSubmission.updateMany({
      where: { contestId: contest.id, status: "SUBMITTED" },
      data: { status: "LOCKED", lockedAt: week.fullLockAt },
    });
    lockedContests += 1;
    lockedSubmissions += result.count;
  }

  await captureContestPregameSnapshotsForWeek(weekId, week.fullLockAt);

  return { lockedContests, lockedSubmissions };
}

/**
 * Reopen contests/submissions that were prematurely LOCKED before Week.fullLockAt.
 * Prefer Week.fullLockAt over stale Contest.status / Contest.locksAt.
 */
export async function healPrematureWeekLocks(weekId: string, now = new Date()) {
  const empty = {
    reopenedContests: 0,
    reopenedSubmissions: 0,
    clearedPickLocks: 0,
    stalePregameSnapshots: 0,
  };
  const week = await prisma.week.findUnique({
    where: { id: weekId },
    include: {
      contests: { include: { pregameSnapshot: { select: { id: true, lockedAt: true } } } },
    },
  });
  if (!week?.fullLockAt) {
    return empty;
  }

  // Always surface stale snapshots when week timing was corrected, even after lock.
  let stalePregameSnapshots = 0;
  for (const contest of week.contests) {
    if (!contest.pregameSnapshot) continue;
    if (
      !isStalePregameSnapshot({
        snapshotLockedAt: contest.pregameSnapshot.lockedAt,
        weekFullLockAt: week.fullLockAt,
      })
    ) {
      continue;
    }
    stalePregameSnapshots += 1;
    logServerEvent(
      "consensus.pregame_snapshot_stale",
      {
        weekId,
        contestId: contest.id,
        position: contest.position,
        snapshotLockedAt: contest.pregameSnapshot.lockedAt.toISOString(),
        weekFullLockAt: week.fullLockAt.toISOString(),
        source: "healPrematureWeekLocks",
      },
      "warn",
    );
  }

  if (now >= week.fullLockAt) {
    return {
      reopenedContests: 0,
      reopenedSubmissions: 0,
      clearedPickLocks: 0,
      stalePregameSnapshots,
    };
  }
  if (week.status === "COMPLETE" || week.status === "ARCHIVED") {
    return {
      reopenedContests: 0,
      reopenedSubmissions: 0,
      clearedPickLocks: 0,
      stalePregameSnapshots,
    };
  }

  const contests = await prisma.rankIQContest.updateMany({
    where: {
      weekId,
      status: "LOCKED",
    },
    data: {
      status: "OPEN",
      locksAt: week.fullLockAt,
    },
  });

  const submissions = await prisma.rankingSubmission.updateMany({
    where: {
      contest: { weekId },
      status: "LOCKED",
    },
    data: {
      status: "SUBMITTED",
      lockedAt: null,
    },
  });

  // Clear slot locks that were applied without a real week-scoped kickoff/full-lock.
  const prematurePicks = await prisma.rankingPick.findMany({
    where: {
      slotLocked: true,
      submission: { contest: { weekId } },
    },
    include: {
      submission: {
        include: {
          contest: {
            select: {
              weekId: true,
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
            },
          },
        },
      },
    },
  });

  let clearedPickLocks = 0;
  for (const pick of prematurePicks) {
    const contestGame =
      pick.submission.contest.entries.find(
        (entry) => entry.rankableEntryId === pick.rankableEntryId,
      )?.game ?? null;
    const kickoff = resolveWeekScopedKickoff({
      weekId: pick.submission.contest.weekId,
      contestGame,
    });
    // Keep lock only when the week-scoped kickoff has actually passed.
    if (kickoff && now >= kickoff) continue;
    await prisma.rankingPick.update({
      where: { id: pick.id },
      data: {
        slotLocked: false,
        lockedAt: null,
        lockedRank: null,
        reserveEligiblePredecessorIds: Prisma.DbNull,
        wasUnavailableAtKickoff: null,
      },
    });
    clearedPickLocks += 1;
  }

  return {
    reopenedContests: contests.count,
    reopenedSubmissions: submissions.count,
    clearedPickLocks,
    stalePregameSnapshots,
  };
}

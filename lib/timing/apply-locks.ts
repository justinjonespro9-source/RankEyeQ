import { prisma } from "@/lib/db";
import { getWeekTimingState } from "@/lib/timing/week-windows";
import { kickoffHasPassed } from "@/lib/timing/partial-lock";
import { captureContestPregameSnapshotsForWeek } from "@/lib/consensus-snapshot";

function kickoffForPick(input: {
  gameStartsAt: Date | null;
  contestGameStartsAt: Date | null;
  rankableGameStartsAt: Date | null;
}) {
  return (
    input.contestGameStartsAt ??
    input.gameStartsAt ??
    input.rankableGameStartsAt ??
    null
  );
}

/**
 * Persist slot locks when kickoff/full-lock has occurred.
 * Does not grade and does not convert drafts into competitors.
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
          entries: { select: { rankableEntryId: true, game: true } },
        },
      },
      picks: {
        include: { rankableEntry: { include: { game: true } } },
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
      entry.game?.startsAt ?? null,
    ]),
  );

  for (const pick of submission.picks) {
    if (pick.slotLocked) continue;
    const kickoff = kickoffForPick({
      contestGameStartsAt: gameByEntry.get(pick.rankableEntryId) ?? null,
      gameStartsAt: pick.rankableEntry.game?.startsAt ?? null,
      rankableGameStartsAt: pick.rankableEntry.gameStartsAt,
    });
    const lockNow =
      timing.fullBoardLocked || kickoffHasPassed(kickoff, now);
    if (!lockNow) continue;

    await prisma.rankingPick.update({
      where: { id: pick.id },
      data: {
        slotLocked: true,
        lockedAt: timing.fullBoardLocked
          ? (week.fullLockAt ?? now)
          : (kickoff ?? now),
        lockedRank: pick.predictedRank,
        committedAt: pick.committedAt ?? pick.lockedAt ?? now,
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
  };
  const week = await prisma.week.findUnique({ where: { id: weekId } });
  if (!week?.fullLockAt) {
    return empty;
  }
  if (now >= week.fullLockAt) {
    return empty;
  }
  if (week.status === "COMPLETE" || week.status === "ARCHIVED") {
    return empty;
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

  // Clear slot locks that were applied without a real kickoff/full-lock.
  const prematurePicks = await prisma.rankingPick.findMany({
    where: {
      slotLocked: true,
      submission: { contest: { weekId } },
    },
    include: {
      rankableEntry: { include: { game: true } },
      submission: {
        include: {
          contest: {
            include: {
              entries: { select: { rankableEntryId: true, game: true } },
            },
          },
        },
      },
    },
  });

  let clearedPickLocks = 0;
  for (const pick of prematurePicks) {
    const contestGame = pick.submission.contest.entries.find(
      (entry) => entry.rankableEntryId === pick.rankableEntryId,
    )?.game?.startsAt;
    const kickoff =
      contestGame ??
      pick.rankableEntry.game?.startsAt ??
      pick.rankableEntry.gameStartsAt ??
      null;
    if (kickoff && now >= kickoff) continue;
    await prisma.rankingPick.update({
      where: { id: pick.id },
      data: {
        slotLocked: false,
        lockedAt: null,
        lockedRank: null,
      },
    });
    clearedPickLocks += 1;
  }

  return {
    reopenedContests: contests.count,
    reopenedSubmissions: submissions.count,
    clearedPickLocks,
  };
}

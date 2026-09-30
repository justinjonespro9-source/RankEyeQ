import { prisma } from "@/lib/db";
import { readWaiverClock } from "@/lib/waivers/clock";
import { ensureWaiverContestLocked } from "@/lib/waivers/contests";
import { isWaiverRevealAllowed } from "@/lib/waivers/lock-time";

/** Aggregate counts only — never calls, players or per-player counts. Safe for admins before lock. */
export async function getWaiverContestSubmissionCounts(contestId: string) {
  const submitted = await prisma.waiverSubmission.count({
    where: { contestId, status: { in: ["SUBMITTED", "LOCKED"] } },
  });
  const drafts = await prisma.waiverSubmission.count({ where: { contestId, status: "DRAFT" } });
  return { submitted, drafts };
}

export type RevealableWaiverBoard = {
  submissionId: string;
  universalProfileId: string;
  lockedRevisionId: string;
  abstention: boolean;
  calls: Array<{ slot: number; rankableEntryId: string }>;
};

/**
 * Competitive boards as locked, for future authorized reveal surfaces. Before
 * locksAt returns nothing for anyone. Uses each board's locked revision;
 * drafts are never returned.
 */
export async function loadRevealableWaiverBoards(
  contestId: string,
): Promise<{ revealed: false; boards: [] } | { revealed: true; boards: RevealableWaiverBoard[] }> {
  const contest = await prisma.waiverContest.findUnique({ where: { id: contestId }, select: { locksAt: true } });
  if (!contest) return { revealed: false, boards: [] };
  const now = await readWaiverClock();
  if (!isWaiverRevealAllowed(contest.locksAt, now)) return { revealed: false, boards: [] };

  await ensureWaiverContestLocked(contestId);
  const submissions = await prisma.waiverSubmission.findMany({
    where: { contestId, status: "LOCKED", lockedRevisionId: { not: null } },
    orderBy: { id: "asc" },
    select: {
      id: true,
      universalProfileId: true,
      lockedRevision: {
        select: {
          id: true,
          callCount: true,
          calls: {
            orderBy: { slot: "asc" },
            select: { slot: true, snapshotEntry: { select: { rankableEntryId: true } } },
          },
        },
      },
    },
  });
  return {
    revealed: true,
    boards: submissions.flatMap((submission) => {
      const revision = submission.lockedRevision;
      if (!revision) return [];
      return [
        {
          submissionId: submission.id,
          universalProfileId: submission.universalProfileId,
          lockedRevisionId: revision.id,
          abstention: revision.callCount === 0,
          calls: revision.calls.map((call) => ({ slot: call.slot, rankableEntryId: call.snapshotEntry.rankableEntryId })),
        },
      ];
    }),
  };
}

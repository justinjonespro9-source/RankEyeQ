import type { ContestPosition, Prisma, WaiverCorrectionPolicy } from "@/lib/generated/prisma/client";
import { exclusiveLockWaiverContest, readWaiverClock, type WaiverDb } from "@/lib/waivers/clock";
import { assertWaiverAdminUser, loadWaiverPool, WaiverContestError } from "@/lib/waivers/contests";

export type WaiverCorrectionImpact = {
  affectedSubmissionIds: string[];
  affectedCallIds: string[];
};

/**
 * Boards whose CURRENT revision calls a player who is not an eligible
 * candidate of `snapshotId` at the contest position. Read-only: revisions and
 * calls are never changed; the owner decides whether to revise before lock.
 */
export async function computeWaiverCorrectionImpact(
  db: WaiverDb,
  input: { contestId: string; position: ContestPosition; snapshotId: string },
): Promise<WaiverCorrectionImpact> {
  const pool = await loadWaiverPool(db, { snapshotId: input.snapshotId, position: input.position });
  const eligible = new Set(pool.map((row) => row.rankableEntryId));
  const submissions = await db.waiverSubmission.findMany({
    where: { contestId: input.contestId, currentRevisionId: { not: null } },
    orderBy: { id: "asc" },
    select: {
      id: true,
      currentRevision: {
        select: {
          calls: {
            orderBy: { slot: "asc" },
            select: { id: true, snapshotEntry: { select: { rankableEntryId: true } } },
          },
        },
      },
    },
  });
  const impact: WaiverCorrectionImpact = { affectedSubmissionIds: [], affectedCallIds: [] };
  for (const submission of submissions) {
    const affected = (submission.currentRevision?.calls ?? []).filter(
      (call) => !eligible.has(call.snapshotEntry.rankableEntryId),
    );
    if (affected.length === 0) continue;
    impact.affectedSubmissionIds.push(submission.id);
    impact.affectedCallIds.push(...affected.map((call) => call.id));
  }
  return impact;
}

export type WaiverRepinOutcome =
  | ({
      contestId: string;
      position: ContestPosition;
      outcome: "REPINNED";
      policy: Extract<WaiverCorrectionPolicy, "NO_BOARD_EFFECT" | "AFFECTED_BOARDS_FLAGGED">;
    } & WaiverCorrectionImpact)
  | {
      contestId: string;
      position: ContestPosition;
      outcome: "POLICY_DECISION_REQUIRED";
      policy: Extract<WaiverCorrectionPolicy, "POLICY_DECISION_REQUIRED">;
    };

/**
 * Contest side of an authorized snapshot supersession; runs inside the
 * caller's (future snapshot-correction) transaction. Before lock each contest
 * pinned to the superseded version is re-pinned and its affected boards are
 * identified. At or after lock nothing changes: POLICY_DECISION_REQUIRED.
 */
export async function repinWaiverContestsOnSupersession(
  tx: Prisma.TransactionClient,
  input: { fromSnapshotId: string; toSnapshotId: string; adminUserId: string },
): Promise<WaiverRepinOutcome[]> {
  await assertWaiverAdminUser(tx, input.adminUserId);
  const target = await tx.waiverSnapshot.findUnique({
    where: { id: input.toSnapshotId },
    select: { id: true, weekId: true, supersedesId: true, currentForWeekId: true },
  });
  if (!target || target.supersedesId !== input.fromSnapshotId || target.currentForWeekId !== target.weekId) {
    throw new WaiverContestError(
      "SNAPSHOT_NOT_CURRENT",
      "Re-pin target must be the current snapshot that directly supersedes the pinned version",
    );
  }

  const contests = await tx.waiverContest.findMany({
    where: { snapshotId: input.fromSnapshotId },
    orderBy: { position: "asc" },
    select: { id: true },
  });
  const outcomes: WaiverRepinOutcome[] = [];
  for (const { id } of contests) {
    await exclusiveLockWaiverContest(tx, id);
    const contest = await tx.waiverContest.findUniqueOrThrow({
      where: { id },
      select: { id: true, position: true, locksAt: true, snapshotId: true },
    });
    const now = await readWaiverClock(tx);
    if (now.getTime() >= contest.locksAt.getTime()) {
      outcomes.push({
        contestId: contest.id,
        position: contest.position,
        outcome: "POLICY_DECISION_REQUIRED",
        policy: "POLICY_DECISION_REQUIRED",
      });
      continue;
    }
    await tx.waiverContest.update({ where: { id: contest.id }, data: { snapshotId: target.id } });
    const impact = await computeWaiverCorrectionImpact(tx, {
      contestId: contest.id,
      position: contest.position,
      snapshotId: target.id,
    });
    outcomes.push({
      contestId: contest.id,
      position: contest.position,
      outcome: "REPINNED",
      policy: impact.affectedSubmissionIds.length > 0 ? "AFFECTED_BOARDS_FLAGGED" : "NO_BOARD_EFFECT",
      ...impact,
    });
  }

  await tx.adminAuditLog.create({
    data: {
      adminUserId: input.adminUserId,
      action: "waivers.contests_repinned",
      entityType: "WaiverSnapshot",
      entityId: target.id,
      metadata: { fromSnapshotId: input.fromSnapshotId, outcomes } satisfies Prisma.InputJsonValue,
    },
  });
  return outcomes;
}

import { canAccessAdmin } from "@/lib/admin/access";
import { prisma } from "@/lib/db";
import type { ContestPosition, Prisma } from "@/lib/generated/prisma/client";
import {
  exclusiveLockWaiverContest,
  readWaiverClock,
  type WaiverDb,
} from "@/lib/waivers/clock";
import {
  WAIVER_EYEQ_V1,
  WAIVER_MAX_CALLS,
  WAIVER_POSITIONS,
  WAIVER_RESULT_FIELD_SIZE,
  type WaiverPosition,
} from "@/lib/waivers/constants";
import { effectiveMaxCalls } from "@/lib/waivers/board-shape";
import { resolveWaiverLocksAt, validateWaiverOpeningWindow } from "@/lib/waivers/lock-time";

export type WaiverContestErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "SNAPSHOT_NOT_CURRENT"
  | "NO_SCHEDULE"
  | "LOCK_NOT_BEFORE_FIRST_KICKOFF"
  | "WINDOW_ORDER";

export class WaiverContestError extends Error {
  constructor(
    readonly code: WaiverContestErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WaiverContestError";
  }
}

export type WaiverPoolRow = {
  snapshotEntryId: string;
  rankableEntryId: string;
  displayName: string;
  team: string | null;
};

/** ELIGIBLE CANDIDATE rows of one snapshot version at one position — the Waiver pool. */
export async function loadWaiverPool(
  db: WaiverDb,
  input: { snapshotId: string; position: ContestPosition },
): Promise<WaiverPoolRow[]> {
  const rows = await db.waiverSnapshotEntry.findMany({
    where: {
      snapshotId: input.snapshotId,
      position: input.position,
      evidenceRole: "CANDIDATE",
      eligibility: "ELIGIBLE",
    },
    orderBy: { inputLineNumber: "asc" },
    select: { id: true, rankableEntryId: true, displayNameAtFreeze: true, teamAtFreeze: true },
  });
  return rows.map((row) => ({
    snapshotEntryId: row.id,
    rankableEntryId: row.rankableEntryId,
    displayName: row.displayNameAtFreeze,
    team: row.teamAtFreeze,
  }));
}

export async function assertWaiverAdminUser(db: WaiverDb, userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user || !canAccessAdmin(user.role)) {
    throw new WaiverContestError("FORBIDDEN", "Admin access required");
  }
}

export type OpenWaiverContestsResult = {
  weekId: string;
  snapshotId: string;
  locksAt: Date;
  opened: Array<{ position: WaiverPosition; contestId: string; availableSlots: number }>;
  existing: Array<{ position: WaiverPosition; contestId: string }>;
  refused: Array<{ position: WaiverPosition; reason: "EMPTY_ELIGIBLE_POOL" }>;
};

/**
 * Manually opens the week's Waiver Podiums against the current frozen snapshot.
 * Lock = Tuesday 7:00 PM America/Chicago before the first kickoff, with no
 * override. A position with no eligible players is refused, never opened.
 */
export async function openWaiverContestsForWeek(input: {
  adminUserId: string;
  weekId: string;
  snapshotId: string;
  positions?: ReadonlyArray<WaiverPosition>;
}): Promise<OpenWaiverContestsResult> {
  const positions = input.positions ?? WAIVER_POSITIONS;
  return prisma.$transaction(async (tx) => {
    await assertWaiverAdminUser(tx, input.adminUserId);

    const snapshot = await tx.waiverSnapshot.findUnique({
      where: { id: input.snapshotId },
      select: { id: true, weekId: true, version: true, status: true, currentForWeekId: true, observedAt: true, frozenAt: true },
    });
    if (!snapshot || snapshot.weekId !== input.weekId) {
      throw new WaiverContestError("NOT_FOUND", "Snapshot not found for this week");
    }
    if (snapshot.status !== "FROZEN" || snapshot.currentForWeekId !== input.weekId) {
      throw new WaiverContestError("SNAPSHOT_NOT_CURRENT", "Only the current frozen snapshot can open Waiver contests");
    }

    const schedule = await tx.nflGame.aggregate({
      where: { weekId: input.weekId, status: { not: "CANCELED" } },
      _min: { startsAt: true },
    });
    const firstKickoff = schedule._min.startsAt;
    if (!firstKickoff) {
      throw new WaiverContestError("NO_SCHEDULE", "The week has no scheduled NFL games");
    }

    const lock = resolveWaiverLocksAt(firstKickoff);
    if (!lock.ok) {
      throw new WaiverContestError(
        "LOCK_NOT_BEFORE_FIRST_KICKOFF",
        "Tuesday 7:00 PM CT is not before the week's first kickoff; Waiver contests cannot open",
      );
    }

    const now = await readWaiverClock(tx);
    const windowErrors = validateWaiverOpeningWindow({
      observedAt: snapshot.observedAt,
      frozenAt: snapshot.frozenAt,
      opensAt: now,
      locksAt: lock.locksAt,
      firstKickoff,
    });
    if (windowErrors.length > 0) {
      throw new WaiverContestError("WINDOW_ORDER", `Waiver contests cannot open: ${windowErrors.join(", ")}`);
    }

    const result: OpenWaiverContestsResult = {
      weekId: input.weekId,
      snapshotId: snapshot.id,
      locksAt: lock.locksAt,
      opened: [],
      existing: [],
      refused: [],
    };

    for (const position of positions) {
      const existing = await tx.waiverContest.findUnique({
        where: { weekId_position: { weekId: input.weekId, position } },
        select: { id: true },
      });
      if (existing) {
        result.existing.push({ position, contestId: existing.id });
        continue;
      }
      const poolSize = await tx.waiverSnapshotEntry.count({
        where: { snapshotId: snapshot.id, position, evidenceRole: "CANDIDATE", eligibility: "ELIGIBLE" },
      });
      if (poolSize === 0) {
        result.refused.push({ position, reason: "EMPTY_ELIGIBLE_POOL" });
        continue;
      }
      const contest = await tx.waiverContest.create({
        data: {
          weekId: input.weekId,
          position,
          snapshotId: snapshot.id,
          maxCalls: WAIVER_MAX_CALLS[position],
          resultFieldSize: WAIVER_RESULT_FIELD_SIZE[position],
          scoringVersion: WAIVER_EYEQ_V1.slug,
          opensAt: now,
          locksAt: lock.locksAt,
          openedByUserId: input.adminUserId,
        },
        select: { id: true },
      });
      result.opened.push({
        position,
        contestId: contest.id,
        availableSlots: effectiveMaxCalls(WAIVER_MAX_CALLS[position], poolSize),
      });
    }

    await tx.adminAuditLog.create({
      data: {
        adminUserId: input.adminUserId,
        action: "waivers.contests_opened",
        entityType: "Week",
        entityId: input.weekId,
        metadata: {
          snapshotId: snapshot.id,
          snapshotVersion: snapshot.version,
          locksAt: lock.locksAt.toISOString(),
          opened: result.opened,
          existing: result.existing,
          refused: result.refused,
        } satisfies Prisma.InputJsonValue,
        createdAt: now,
      },
    });

    return result;
  });
}

export type WaiverLockStampResult = { locked: boolean; stampedSubmissions: number };

/**
 * Idempotent lazy lock stamp. At or after locksAt: contest OPEN → LOCKED, and
 * each SUBMITTED board → LOCKED naming its final SUBMISSION revision created
 * before locksAt, with lockedAt = locksAt (never the time this runs).
 * Drafts stay DRAFT. Before locksAt it does nothing.
 */
export async function ensureWaiverContestLocked(contestId: string): Promise<WaiverLockStampResult> {
  return prisma.$transaction(async (tx) => {
    if (!(await exclusiveLockWaiverContest(tx, contestId))) {
      throw new WaiverContestError("NOT_FOUND", "Waiver contest not found");
    }
    const contest = await tx.waiverContest.findUniqueOrThrow({
      where: { id: contestId },
      select: { id: true, status: true, locksAt: true },
    });
    const now = await readWaiverClock(tx);
    if (now.getTime() < contest.locksAt.getTime()) {
      return { locked: false, stampedSubmissions: 0 };
    }
    if (contest.status === "OPEN") {
      await tx.waiverContest.update({ where: { id: contest.id }, data: { status: "LOCKED" } });
    }
    const submitted = await tx.waiverSubmission.findMany({
      where: { contestId, status: "SUBMITTED" },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    let stampedSubmissions = 0;
    for (const submission of submitted) {
      const finalRevision = await tx.waiverSubmissionRevision.findFirst({
        where: { submissionId: submission.id, kind: "SUBMISSION", createdAt: { lt: contest.locksAt } },
        orderBy: { revisionNumber: "desc" },
        select: { id: true },
      });
      if (!finalRevision) continue;
      await tx.waiverSubmission.update({
        where: { id: submission.id },
        data: { status: "LOCKED", lockedRevisionId: finalRevision.id, lockedAt: contest.locksAt },
      });
      stampedSubmissions += 1;
    }
    return { locked: true, stampedSubmissions };
  });
}

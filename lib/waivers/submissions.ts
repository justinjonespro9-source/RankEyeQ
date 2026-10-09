import { canSubmitFromRankingWorkspace } from "@/lib/auth/participation";
import { prisma } from "@/lib/db";
import { Prisma, type WaiverRevisionKind, type WaiverSubmissionStatus } from "@/lib/generated/prisma/client";
import { effectiveMaxCalls } from "@/lib/waivers/board-shape";
import { describeWaiverBoardErrors, validateWaiverCalls } from "@/lib/waivers/call-validation";
import {
  exclusiveLockWaiverSubmission,
  readWaiverClock,
  shareLockWaiverContest,
} from "@/lib/waivers/clock";
import { waiverSlotLabel, type WaiverSlotLabel } from "@/lib/waivers/constants";
import { ensureWaiverContestLocked, loadWaiverPool } from "@/lib/waivers/contests";
import { waiverBoardFingerprint } from "@/lib/waivers/fingerprint";
import { waiverPhaseAt, type WaiverPhase } from "@/lib/waivers/lock-time";

export type WaiverSubmissionErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "LOCKED"
  | "INVALID_BOARD"
  | "ALREADY_SUBMITTED"
  | "DUPLICATE_ENTRY"
  | "CONFLICT";

export class WaiverSubmissionError extends Error {
  constructor(
    readonly code: WaiverSubmissionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WaiverSubmissionError";
  }
}

export const WAIVER_LOCKED_MESSAGE =
  "This Waiver Podium is locked — boards can no longer be created or changed";

export type WaiverBoardWriteInput = {
  contestId: string;
  /** Session-derived; never client-chosen. */
  universalProfileId: string;
  /** Authenticated login performing the write. */
  userId: string;
  /** RankableEntry id per slot (index 0 = WIN). Blank = null. */
  playerIds: ReadonlyArray<string | null | undefined>;
};

export type WaiverBoardWriteResult = {
  submissionId: string;
  status: WaiverSubmissionStatus;
  revisionNumber: number;
  callCount: number;
  /** false when the board was identical to the current revision (no new revision). */
  changed: boolean;
  submittedAt: Date | null;
};

export function saveWaiverDraft(input: WaiverBoardWriteInput) {
  return writeWaiverBoard(input, "DRAFT");
}

/** Submits (or re-submits) a board with 0..effective-max calls. Zero calls = explicit abstention. */
export function submitWaiverBoard(input: WaiverBoardWriteInput) {
  return writeWaiverBoard(input, "SUBMISSION");
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function mapDatabaseError(error: unknown): unknown {
  if (error instanceof WaiverSubmissionError) return error;
  const message = error instanceof Error ? error.message : "";
  if (message.includes("WAIVER_LOCKED")) return new WaiverSubmissionError("LOCKED", WAIVER_LOCKED_MESSAGE);
  if (message.includes("WAIVER_INVALID") || message.includes("WAIVER_IMMUTABLE")) {
    return new WaiverSubmissionError("CONFLICT", "The Waiver board could not be saved; reload and try again");
  }
  if (isUniqueViolation(error)) {
    return new WaiverSubmissionError("CONFLICT", "The Waiver board changed concurrently; reload and try again");
  }
  return error;
}

async function writeWaiverBoard(
  input: WaiverBoardWriteInput,
  kind: WaiverRevisionKind,
): Promise<WaiverBoardWriteResult> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction((tx) => writeWaiverBoardInTransaction(tx, input, kind));
    } catch (error) {
      // A concurrent first write for the same board: retry once against the new row.
      if (attempt === 0 && isUniqueViolation(error)) continue;
      throw mapDatabaseError(error);
    }
  }
}

async function assertWaiverParticipant(tx: Prisma.TransactionClient, input: WaiverBoardWriteInput) {
  const user = await tx.user.findUnique({
    where: { id: input.userId },
    select: {
      universalProfileId: true,
      universalProfile: { select: { profileType: true, status: true } },
    },
  });
  if (!user || user.universalProfileId !== input.universalProfileId || !user.universalProfile) {
    throw new WaiverSubmissionError("FORBIDDEN", "Cannot submit as another profile");
  }
  if (!canSubmitFromRankingWorkspace(user.universalProfile.profileType)) {
    throw new WaiverSubmissionError("FORBIDDEN", "This profile cannot enter Waiver boards");
  }
  if (user.universalProfile.status !== "ACTIVE") {
    throw new WaiverSubmissionError("FORBIDDEN", "This profile is suspended and cannot enter Waiver boards");
  }
}

async function writeWaiverBoardInTransaction(
  tx: Prisma.TransactionClient,
  input: WaiverBoardWriteInput,
  kind: WaiverRevisionKind,
): Promise<WaiverBoardWriteResult> {
  await assertWaiverParticipant(tx, input);

  if (!(await shareLockWaiverContest(tx, input.contestId))) {
    throw new WaiverSubmissionError("NOT_FOUND", "Waiver contest not found");
  }
  const contest = await tx.waiverContest.findUniqueOrThrow({
    where: { id: input.contestId },
    select: { id: true, position: true, snapshotId: true, status: true, maxCalls: true, locksAt: true },
  });

  const now = await readWaiverClock(tx);
  if (now.getTime() >= contest.locksAt.getTime() || contest.status !== "OPEN") {
    throw new WaiverSubmissionError("LOCKED", WAIVER_LOCKED_MESSAGE);
  }

  const pool = await loadWaiverPool(tx, { snapshotId: contest.snapshotId, position: contest.position });
  const validation = validateWaiverCalls({
    playerIds: input.playerIds,
    pool,
    configuredMaxCalls: contest.maxCalls,
  });
  if (!validation.ok) {
    throw new WaiverSubmissionError("INVALID_BOARD", describeWaiverBoardErrors(validation.errors));
  }

  let submission = await tx.waiverSubmission.findUnique({
    where: { contestId_universalProfileId: { contestId: contest.id, universalProfileId: input.universalProfileId } },
    select: { id: true },
  });
  // One owner-authored board per login; AI boards an admin imported do not count.
  const otherBoardByLogin = await tx.waiverSubmission.findFirst({
    where: {
      contestId: contest.id,
      createdByUserId: input.userId,
      authority: "OWNER_AUTHORED",
      ...(submission ? { id: { not: submission.id } } : {}),
    },
    select: { id: true },
  });
  if (otherBoardByLogin) {
    throw new WaiverSubmissionError(
      "DUPLICATE_ENTRY",
      "This login already has a Waiver board in this contest under another profile",
    );
  }
  if (!submission) {
    submission = await tx.waiverSubmission.create({
      data: {
        contestId: contest.id,
        universalProfileId: input.universalProfileId,
        createdByUserId: input.userId,
        authority: "OWNER_AUTHORED",
      },
      select: { id: true },
    });
  }
  await exclusiveLockWaiverSubmission(tx, submission.id);
  const current = await tx.waiverSubmission.findUniqueOrThrow({
    where: { id: submission.id },
    select: {
      id: true,
      status: true,
      submittedAt: true,
      currentRevision: { select: { kind: true, fingerprint: true, revisionNumber: true, callCount: true } },
    },
  });

  if (kind === "DRAFT" && current.status !== "DRAFT") {
    throw new WaiverSubmissionError(
      "ALREADY_SUBMITTED",
      "This board is already submitted — changes are made by re-submitting",
    );
  }

  const fingerprint = waiverBoardFingerprint({
    contestId: contest.id,
    snapshotId: contest.snapshotId,
    rankableEntryIds: validation.calls.map((call) => call.rankableEntryId),
  });
  if (current.currentRevision && current.currentRevision.kind === kind && current.currentRevision.fingerprint === fingerprint) {
    return {
      submissionId: current.id,
      status: current.status,
      revisionNumber: current.currentRevision.revisionNumber,
      callCount: current.currentRevision.callCount,
      changed: false,
      submittedAt: current.submittedAt,
    };
  }

  const revisionNumber = (current.currentRevision?.revisionNumber ?? 0) + 1;
  const revision = await tx.waiverSubmissionRevision.create({
    data: {
      submissionId: current.id,
      revisionNumber,
      kind,
      snapshotId: contest.snapshotId,
      callCount: validation.calls.length,
      fingerprint,
      authorUserId: input.userId,
      createdAt: now,
    },
    select: { id: true },
  });
  if (validation.calls.length > 0) {
    await tx.waiverCall.createMany({
      data: validation.calls.map((call) => ({
        revisionId: revision.id,
        slot: call.slot,
        snapshotEntryId: call.snapshotEntryId,
      })),
    });
  }

  const updated = await tx.waiverSubmission.update({
    where: { id: current.id },
    data:
      kind === "SUBMISSION"
        ? { status: "SUBMITTED", currentRevisionId: revision.id, submittedAt: now }
        : { currentRevisionId: revision.id },
    select: { status: true, submittedAt: true },
  });

  return {
    submissionId: current.id,
    status: updated.status,
    revisionNumber,
    callCount: validation.calls.length,
    changed: true,
    submittedAt: updated.submittedAt,
  };
}

export type WaiverAffectedCall = {
  slot: number;
  rankableEntryId: string;
  reason: "NOT_ELIGIBLE_IN_CURRENT_SNAPSHOT";
};

export type OwnWaiverBoard = {
  contest: {
    id: string;
    position: string;
    locksAt: Date;
    phase: WaiverPhase;
    maxCalls: number;
    availableSlots: number;
    snapshotId: string;
  };
  board: null | {
    submissionId: string;
    status: WaiverSubmissionStatus;
    /** Submitted/locked boards compete; drafts never do. */
    competitive: boolean;
    /** Competitive board with zero calls. */
    abstention: boolean;
    revisionNumber: number | null;
    snapshotId: string | null;
    calls: Array<{ slot: number; label: WaiverSlotLabel; rankableEntryId: string; displayName: string; team: string | null }>;
    submittedAt: Date | null;
    lockedAt: Date | null;
    /** Calls on players no longer eligible in the contest's pinned snapshot (pre-lock correction). */
    affectedCalls: WaiverAffectedCall[];
    /** Owner should revise before lock: affected calls exist and the contest is still open. */
    needsReview: boolean;
  };
};

/** The owner's own board (current revision). Never exposes other competitors. */
export async function getOwnWaiverBoard(input: {
  contestId: string;
  universalProfileId: string;
}): Promise<OwnWaiverBoard | null> {
  const contestHead = await prisma.waiverContest.findUnique({
    where: { id: input.contestId },
    select: { locksAt: true },
  });
  if (!contestHead) return null;
  const now = await readWaiverClock();
  if (waiverPhaseAt(contestHead.locksAt, now) === "LOCKED") {
    await ensureWaiverContestLocked(input.contestId);
  }

  const contest = await prisma.waiverContest.findUniqueOrThrow({
    where: { id: input.contestId },
    select: { id: true, position: true, locksAt: true, maxCalls: true, snapshotId: true },
  });
  const pool = await loadWaiverPool(prisma, { snapshotId: contest.snapshotId, position: contest.position });
  const phase = waiverPhaseAt(contest.locksAt, now);
  const contestView = {
    id: contest.id,
    position: contest.position,
    locksAt: contest.locksAt,
    phase,
    maxCalls: contest.maxCalls,
    availableSlots: effectiveMaxCalls(contest.maxCalls, pool.length),
    snapshotId: contest.snapshotId,
  };

  const submission = await prisma.waiverSubmission.findUnique({
    where: { contestId_universalProfileId: { contestId: contest.id, universalProfileId: input.universalProfileId } },
    select: {
      id: true,
      status: true,
      submittedAt: true,
      lockedAt: true,
      currentRevision: {
        select: {
          revisionNumber: true,
          snapshotId: true,
          calls: {
            orderBy: { slot: "asc" },
            select: {
              slot: true,
              snapshotEntry: { select: { rankableEntryId: true, displayNameAtFreeze: true, teamAtFreeze: true } },
            },
          },
        },
      },
    },
  });
  if (!submission) return { contest: contestView, board: null };

  const revision = submission.currentRevision;
  const calls = (revision?.calls ?? []).map((call) => ({
    slot: call.slot,
    label: waiverSlotLabel(call.slot),
    rankableEntryId: call.snapshotEntry.rankableEntryId,
    displayName: call.snapshotEntry.displayNameAtFreeze,
    team: call.snapshotEntry.teamAtFreeze,
  }));
  const pinnedIds = new Set(pool.map((row) => row.rankableEntryId));
  const affectedCalls: WaiverAffectedCall[] =
    revision && revision.snapshotId !== contest.snapshotId
      ? calls
          .filter((call) => !pinnedIds.has(call.rankableEntryId))
          .map((call) => ({
            slot: call.slot,
            rankableEntryId: call.rankableEntryId,
            reason: "NOT_ELIGIBLE_IN_CURRENT_SNAPSHOT" as const,
          }))
      : [];
  const competitive = submission.status !== "DRAFT";

  return {
    contest: contestView,
    board: {
      submissionId: submission.id,
      status: submission.status,
      competitive,
      abstention: competitive && calls.length === 0,
      revisionNumber: revision?.revisionNumber ?? null,
      snapshotId: revision?.snapshotId ?? null,
      calls,
      submittedAt: submission.submittedAt,
      lockedAt: submission.lockedAt,
      affectedCalls,
      needsReview: affectedCalls.length > 0 && phase === "OPEN",
    },
  };
}

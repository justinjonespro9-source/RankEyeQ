import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { WAIVER_AI_MODEL_LABEL_MAX, WAIVER_AI_OVERRIDE_REASON_MAX, WAIVER_AI_RESPONSE_MAX_BYTES, WAIVER_AI_SOURCE_REFERENCE_MAX } from "@/lib/waivers/ai/constants";
import { loadWaiverAiContestContext } from "@/lib/waivers/ai/context";
import { strictBoard } from "@/lib/waivers/ai/late-entry";
import { assertWaiverAiAdmin, loadActiveAiCompetitor, WaiverAiError } from "@/lib/waivers/ai/submissions";
import { sha256Utf8, utf8ByteLength } from "@/lib/waivers/ai/text";
import { readWaiverClock, shareLockWaiverContest } from "@/lib/waivers/clock";

/**
 * Admin competitive override (Stage 4B.3C). After the lock, an administrator
 * may enter one AI response as a competitive board without pre-lock
 * evidence. One transaction inserts the immutable override authorization
 * first, then the locked board, its single SUBMISSION revision, its calls and
 * the verbatim response, all at the database's actual time (never
 * backdated). The database admits these post-lock rows only for the override
 * inserted by that transaction and checks the whole board at COMMIT.
 *
 * The board is designated "ADMIN COMPETITIVE OVERRIDE", never verified
 * pre-lock; it records no prompt claim and no stated generation time. Picks
 * are never regenerated, corrected or reordered; an invalid response is
 * refused whole. An existing board is never replaced. Owner-authored boards
 * never pass through here.
 */

export type WaiverAiCompetitiveOverrideInput = {
  adminUserId: string;
  contestId: string;
  universalProfileId: string;
  /** Exact response text; hashed and stored as received. */
  responseText: string;
  /** sha256 the admin's browser computed over the same text. */
  expectedResponseSha256: string;
  /** Ordered RankableEntry ids the admin confirmed in the preview (compared, never written). */
  confirmedRankableEntryIds: ReadonlyArray<string>;
  modelLabel: string;
  reason: string;
  sourceReference: string | null;
  /** Optional historical evidence holding the same response (database-checked). */
  evidenceId: string | null;
  /** The first 12 characters of the response sha256, typed by the admin. */
  confirmation: string;
  /** Explicit confirmation of competitive inclusion. */
  includeInCompetition: boolean;
};

export type WaiverAiCompetitiveOverrideResult = {
  overrideId: string;
  submissionId: string;
  revisionId: string;
  callCount: number;
  noCalls: boolean;
  responseSha256: string;
  importedAt: Date;
};

function mapDatabaseError(error: unknown): unknown {
  if (error instanceof WaiverAiError) return error;
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return new WaiverAiError("CONFLICT", "A board or override for this AI and contest was recorded concurrently; reload and try again");
  }
  const message = error instanceof Error ? error.message : "";
  const guard = /WAIVER_(?:INVALID|IMMUTABLE|LOCKED): ([^\n"]+)/.exec(message);
  if (guard) return new WaiverAiError("CONFLICT", `Refused by the database: ${guard[1]}. Nothing was saved.`);
  return error;
}

function required(value: string, max: number, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new WaiverAiError("INVALID_INPUT", `${label} is required`);
  if (trimmed.length > max) throw new WaiverAiError("INVALID_INPUT", `${label} is too long`);
  return trimmed;
}

export async function overrideWaiverAiBoard(input: WaiverAiCompetitiveOverrideInput): Promise<WaiverAiCompetitiveOverrideResult> {
  const modelLabel = required(input.modelLabel, WAIVER_AI_MODEL_LABEL_MAX, "A model label");
  const reason = required(input.reason, WAIVER_AI_OVERRIDE_REASON_MAX, "An override reason");
  const sourceReference = input.sourceReference?.trim() || null;
  if (sourceReference && sourceReference.length > WAIVER_AI_SOURCE_REFERENCE_MAX) throw new WaiverAiError("INVALID_INPUT", "Source reference is too long");
  const byteLength = utf8ByteLength(input.responseText);
  if (byteLength === 0 || byteLength > WAIVER_AI_RESPONSE_MAX_BYTES) throw new WaiverAiError("INVALID_INPUT", "The response must be 1–65,536 bytes");
  const responseSha256 = sha256Utf8(input.responseText);
  if (responseSha256 !== input.expectedResponseSha256) {
    throw new WaiverAiError("RESPONSE_HASH_MISMATCH", "The response text changed in transit; nothing was saved");
  }
  if (!input.includeInCompetition) throw new WaiverAiError("INVALID_INPUT", "Confirm competitive inclusion to submit an admin competitive override");
  if (input.confirmation.trim().toLowerCase() !== responseSha256.slice(0, 12)) {
    throw new WaiverAiError("INVALID_INPUT", "Type the first 12 characters of the response sha256 to confirm");
  }
  try {
    return await prisma.$transaction((tx) =>
      overrideInTransaction(tx, { ...input, modelLabel, reason, sourceReference, evidenceId: input.evidenceId || null }, responseSha256, byteLength),
    );
  } catch (error) {
    throw mapDatabaseError(error);
  }
}

async function overrideInTransaction(
  tx: Prisma.TransactionClient,
  input: WaiverAiCompetitiveOverrideInput,
  responseSha256: string,
  responseByteLength: number,
): Promise<WaiverAiCompetitiveOverrideResult> {
  await assertWaiverAiAdmin(tx, input.adminUserId);
  if (!(await shareLockWaiverContest(tx, input.contestId))) throw new WaiverAiError("NOT_FOUND", "Waiver contest not found");
  const context = await loadWaiverAiContestContext(tx, input.contestId);
  if (!context) throw new WaiverAiError("NOT_FOUND", "Waiver contest not found");
  const { contest } = context;
  const now = await readWaiverClock(tx);
  if (now.getTime() < contest.locksAt.getTime()) {
    throw new WaiverAiError("INVALID_INPUT", "The contest is still open; submit through the ordinary AI import");
  }
  const profile = await loadActiveAiCompetitor(tx, input.universalProfileId);
  const board = await strictBoard(tx, context, input.responseText);
  if (board.pickIds.length !== input.confirmedRankableEntryIds.length || board.pickIds.some((id, i) => id !== input.confirmedRankableEntryIds[i])) {
    throw new WaiverAiError("PREVIEW_MISMATCH", "The confirmed preview no longer matches the response; parse and preview again");
  }
  const existing = await tx.waiverSubmission.findUnique({
    where: { contestId_universalProfileId: { contestId: contest.id, universalProfileId: profile.id } },
    select: { id: true },
  });
  if (existing) throw new WaiverAiError("CONFLICT", "This AI already has a board for this contest; an override never replaces a board");
  if (await tx.waiverGradeRun.count({ where: { weekId: contest.weekId } })) {
    throw new WaiverAiError("CONFLICT", "This week already has a grade run; an override cannot join a week that has been graded");
  }

  const submissionId = randomUUID();
  const revisionId = randomUUID();
  const override = await tx.waiverAiCompetitiveOverride.create({
    data: {
      contestId: contest.id,
      position: contest.position,
      snapshotId: contest.snapshotId,
      universalProfileId: profile.id,
      evidenceId: input.evidenceId,
      responseSha256,
      boardFingerprint: board.fingerprint,
      callCount: board.calls.length,
      parserVersion: board.parserVersion,
      modelLabel: input.modelLabel,
      reason: input.reason,
      sourceReference: input.sourceReference,
      submissionId,
      revisionId,
      confirmation: responseSha256.slice(0, 12),
      authorizedByUserId: input.adminUserId,
    },
    select: { id: true, authorizedAt: true },
  });
  const importedAt = override.authorizedAt;
  await tx.waiverSubmission.create({
    data: { id: submissionId, contestId: contest.id, universalProfileId: profile.id, createdByUserId: input.adminUserId, authority: "SYSTEM_OPERATED" },
  });
  await tx.waiverSubmissionRevision.create({
    data: {
      id: revisionId,
      submissionId,
      revisionNumber: 1,
      kind: "SUBMISSION",
      snapshotId: contest.snapshotId,
      callCount: board.calls.length,
      fingerprint: board.fingerprint,
      authorUserId: input.adminUserId,
      createdAt: importedAt,
    },
  });
  if (board.calls.length > 0) {
    await tx.waiverCall.createMany({
      data: board.calls.map((call) => ({ revisionId, slot: call.slot, snapshotEntryId: call.snapshotEntryId })),
    });
  }
  await tx.waiverAiResponse.create({
    data: {
      revisionId,
      contestId: contest.id,
      position: contest.position,
      snapshotId: contest.snapshotId,
      universalProfileId: profile.id,
      modelLabel: input.modelLabel,
      promptVersion: null,
      promptSha256: null,
      parserVersion: board.parserVersion,
      responseText: input.responseText,
      responseSha256,
      responseByteLength,
      noCalls: board.noCalls,
      statedGeneratedAt: null,
      sourceReference: `admin competitive override ${override.id}`,
      sourceNote: null,
      importedByUserId: input.adminUserId,
    },
  });
  await tx.waiverSubmission.update({
    where: { id: submissionId },
    data: { status: "LOCKED", currentRevisionId: revisionId, lockedRevisionId: revisionId, submittedAt: importedAt, lockedAt: importedAt },
  });
  await tx.adminAuditLog.create({
    data: {
      adminUserId: input.adminUserId,
      action: "waivers.ai_competitive_override",
      entityType: "WaiverSubmission",
      entityId: submissionId,
      metadata: {
        overrideId: override.id,
        contestId: contest.id,
        position: contest.position,
        universalProfileId: profile.id,
        snapshotId: contest.snapshotId,
        responseSha256,
        boardFingerprint: board.fingerprint,
        callCount: board.calls.length,
        modelLabel: input.modelLabel,
        reason: input.reason,
        evidenceId: input.evidenceId,
        sourceReference: input.sourceReference,
        locksAt: contest.locksAt.toISOString(),
        importedAt: importedAt.toISOString(),
      } satisfies Prisma.InputJsonValue,
      createdAt: importedAt,
    },
  });
  return {
    overrideId: override.id,
    submissionId,
    revisionId,
    callCount: board.calls.length,
    noCalls: board.noCalls,
    responseSha256,
    importedAt,
  };
}

import { canAccessAdmin } from "@/lib/admin/access";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  WAIVEREYEQ_AI_PROMPT_VERSION,
  WAIVER_AI_MODEL_LABEL_MAX,
  WAIVER_AI_NOTE_MAX,
  WAIVER_AI_SOURCE_REFERENCE_MAX,
} from "@/lib/waivers/ai/constants";
import { loadWaiverAiContestContext, type WaiverAiContestContext } from "@/lib/waivers/ai/context";
import { parseWaiverAiResponse, type WaiverAiIssue, type WaiverAiParseResult } from "@/lib/waivers/ai/response-parser";
import { sha256Utf8, utf8ByteLength } from "@/lib/waivers/ai/text";
import { describeWaiverBoardErrors, validateWaiverCalls } from "@/lib/waivers/call-validation";
import { exclusiveLockWaiverSubmission, readWaiverClock, shareLockWaiverContest, type WaiverDb } from "@/lib/waivers/clock";
import { loadWaiverPool } from "@/lib/waivers/contests";
import { waiverBoardFingerprint } from "@/lib/waivers/fingerprint";

/**
 * SYSTEM_OPERATED AI Waiver boards (Stage 4B.3A). An admin imports one AI
 * competitor's response per contest: the server re-parses the exact text
 * against the contest's pinned frozen snapshot, and one transaction writes
 * the board, its append-only SUBMISSION revision, its calls and the verbatim
 * response. Lock authority is the database clock, exactly as for owners.
 * Owner-authored boards never pass through here.
 */

export type WaiverAiErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "LOCKED"
  | "NOT_AI_COMPETITOR"
  | "INVALID_INPUT"
  | "RESPONSE_HASH_MISMATCH"
  | "PROMPT_CHANGED"
  | "PREVIEW_MISMATCH"
  | "INVALID_RESPONSE"
  | "CONFLICT";

export class WaiverAiError extends Error {
  constructor(
    readonly code: WaiverAiErrorCode,
    message: string,
    readonly issues: WaiverAiIssue[] = [],
  ) {
    super(message);
    this.name = "WaiverAiError";
  }
}

export const WAIVER_AI_LOCKED_MESSAGE = "This Waiver Podium is locked — AI boards can no longer be submitted or changed";

export async function assertWaiverAiAdmin(db: WaiverDb, userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user || !canAccessAdmin(user.role)) throw new WaiverAiError("FORBIDDEN", "Admin access required");
}

/** Active AI competitor (SYSTEM_OPERATED boards only exist for these). */
export async function loadActiveAiCompetitor(db: WaiverDb, profileId: string) {
  const profile = await db.universalProfile.findUnique({
    where: { id: profileId },
    select: { id: true, username: true, displayName: true, profileType: true, status: true, competitorActive: true },
  });
  if (!profile) throw new WaiverAiError("NOT_FOUND", "AI competitor not found");
  if (profile.profileType !== "AI" || profile.status !== "ACTIVE" || !profile.competitorActive) {
    throw new WaiverAiError("NOT_AI_COMPETITOR", "Only active AI competitors can have system-operated Waiver boards");
  }
  return profile;
}

export function parseAgainstContext(context: WaiverAiContestContext, responseText: string): WaiverAiParseResult {
  return parseWaiverAiResponse({
    text: responseText,
    position: context.contest.position,
    maxCalls: context.contest.maxCalls,
    rows: context.rows,
  });
}

export type WaiverAiResponsePreview = {
  contestId: string;
  promptVersion: string;
  promptSha256: string;
  responseSha256: string;
  responseByteLength: number;
  parse: WaiverAiParseResult;
};

/** Read-only: parses a response against the contest's pinned frozen snapshot. Writes nothing. */
export async function previewWaiverAiResponse(input: { adminUserId: string; contestId: string; responseText: string }): Promise<WaiverAiResponsePreview> {
  await assertWaiverAiAdmin(prisma, input.adminUserId);
  const context = await loadWaiverAiContestContext(prisma, input.contestId);
  if (!context) throw new WaiverAiError("NOT_FOUND", "Waiver contest not found");
  return {
    contestId: context.contest.id,
    promptVersion: context.prompt.version,
    promptSha256: context.prompt.sha256,
    responseSha256: sha256Utf8(input.responseText),
    responseByteLength: utf8ByteLength(input.responseText),
    parse: parseAgainstContext(context, input.responseText),
  };
}

export type WaiverAiBoardImportInput = {
  adminUserId: string;
  contestId: string;
  universalProfileId: string;
  /** Exact response text; hashed and stored as received. */
  responseText: string;
  /** sha256 the admin's browser computed over the same text. */
  expectedResponseSha256: string;
  /** sha256 of the prompt the admin copied. */
  expectedPromptSha256: string;
  /** Ordered RankableEntry ids the admin confirmed in the preview (compared, never written). */
  confirmedRankableEntryIds: ReadonlyArray<string>;
  modelLabel: string;
  statedGeneratedAt: Date | null;
  sourceReference: string | null;
  sourceNote: string | null;
};

export type WaiverAiBoardImportResult = {
  submissionId: string;
  revisionNumber: number;
  callCount: number;
  noCalls: boolean;
  responseSha256: string;
  /** false when the current revision already holds this exact response (nothing written). */
  changed: boolean;
  submittedAt: Date;
};

function cleanOptional(value: string | null, max: number, label: string): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw new WaiverAiError("INVALID_INPUT", `${label} is too long`);
  return trimmed;
}

function mapDatabaseError(error: unknown): unknown {
  if (error instanceof WaiverAiError) return error;
  const message = error instanceof Error ? error.message : "";
  if (message.includes("WAIVER_LOCKED")) return new WaiverAiError("LOCKED", WAIVER_AI_LOCKED_MESSAGE);
  if (message.includes("WAIVER_INVALID") || message.includes("WAIVER_IMMUTABLE")) {
    return new WaiverAiError("CONFLICT", "The AI Waiver board could not be saved; reload and try again");
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return new WaiverAiError("CONFLICT", "The AI Waiver board changed concurrently; reload and try again");
  }
  return error;
}

export async function importAiWaiverBoard(input: WaiverAiBoardImportInput): Promise<WaiverAiBoardImportResult> {
  const modelLabel = input.modelLabel.trim();
  if (!modelLabel || modelLabel.length > WAIVER_AI_MODEL_LABEL_MAX) throw new WaiverAiError("INVALID_INPUT", "A model label is required");
  const sourceReference = cleanOptional(input.sourceReference, WAIVER_AI_SOURCE_REFERENCE_MAX, "Source reference");
  const sourceNote = cleanOptional(input.sourceNote, WAIVER_AI_NOTE_MAX, "Source note");
  const responseSha256 = sha256Utf8(input.responseText);
  if (responseSha256 !== input.expectedResponseSha256) {
    throw new WaiverAiError("RESPONSE_HASH_MISMATCH", "The response text changed in transit; nothing was saved");
  }

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction((tx) => importInTransaction(tx, { ...input, modelLabel, sourceReference, sourceNote }, responseSha256));
    } catch (error) {
      if (attempt === 0 && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue;
      throw mapDatabaseError(error);
    }
  }
}

async function importInTransaction(
  tx: Prisma.TransactionClient,
  input: WaiverAiBoardImportInput,
  responseSha256: string,
): Promise<WaiverAiBoardImportResult> {
  await assertWaiverAiAdmin(tx, input.adminUserId);
  if (!(await shareLockWaiverContest(tx, input.contestId))) throw new WaiverAiError("NOT_FOUND", "Waiver contest not found");
  const context = await loadWaiverAiContestContext(tx, input.contestId);
  if (!context) throw new WaiverAiError("NOT_FOUND", "Waiver contest not found");
  const { contest } = context;

  const now = await readWaiverClock(tx);
  if (now.getTime() >= contest.locksAt.getTime() || contest.status !== "OPEN") {
    throw new WaiverAiError("LOCKED", WAIVER_AI_LOCKED_MESSAGE);
  }
  const profile = await loadActiveAiCompetitor(tx, input.universalProfileId);
  if (input.statedGeneratedAt && input.statedGeneratedAt.getTime() > now.getTime()) {
    throw new WaiverAiError("INVALID_INPUT", "The stated generation time cannot be in the future");
  }
  if (context.prompt.sha256 !== input.expectedPromptSha256) {
    throw new WaiverAiError("PROMPT_CHANGED", "The contest's frozen pool changed since the prompt was copied; copy the new prompt and re-run the AI");
  }

  const parse = parseAgainstContext(context, input.responseText);
  if (!parse.ok) throw new WaiverAiError("INVALID_RESPONSE", "The AI response is invalid; nothing was saved", parse.issues);
  const pickIds = parse.picks.map((pick) => pick.rankableEntryId);
  if (pickIds.length !== input.confirmedRankableEntryIds.length || pickIds.some((id, index) => id !== input.confirmedRankableEntryIds[index])) {
    throw new WaiverAiError("PREVIEW_MISMATCH", "The confirmed preview no longer matches the response; parse and preview again");
  }

  const pool = await loadWaiverPool(tx, { snapshotId: contest.snapshotId, position: contest.position });
  const validation = validateWaiverCalls({ playerIds: pickIds, pool, configuredMaxCalls: contest.maxCalls });
  if (!validation.ok) throw new WaiverAiError("INVALID_RESPONSE", describeWaiverBoardErrors(validation.errors));

  let submission = await tx.waiverSubmission.findUnique({
    where: { contestId_universalProfileId: { contestId: contest.id, universalProfileId: profile.id } },
    select: { id: true, authority: true },
  });
  if (submission && submission.authority !== "SYSTEM_OPERATED") {
    throw new WaiverAiError("CONFLICT", "This profile already has a Waiver board that is not system-operated");
  }
  if (!submission) {
    submission = await tx.waiverSubmission.create({
      data: { contestId: contest.id, universalProfileId: profile.id, createdByUserId: input.adminUserId, authority: "SYSTEM_OPERATED" },
      select: { id: true, authority: true },
    });
  }
  await exclusiveLockWaiverSubmission(tx, submission.id);
  const current = await tx.waiverSubmission.findUniqueOrThrow({
    where: { id: submission.id },
    select: {
      submittedAt: true,
      currentRevision: { select: { revisionNumber: true, callCount: true, aiResponse: { select: { responseSha256: true, promptSha256: true } } } },
    },
  });
  const currentResponse = current.currentRevision?.aiResponse;
  if (current.currentRevision && current.submittedAt && currentResponse?.responseSha256 === responseSha256 && currentResponse.promptSha256 === context.prompt.sha256) {
    return {
      submissionId: submission.id,
      revisionNumber: current.currentRevision.revisionNumber,
      callCount: current.currentRevision.callCount,
      noCalls: current.currentRevision.callCount === 0,
      responseSha256,
      changed: false,
      submittedAt: current.submittedAt,
    };
  }

  const revisionNumber = (current.currentRevision?.revisionNumber ?? 0) + 1;
  const revision = await tx.waiverSubmissionRevision.create({
    data: {
      submissionId: submission.id,
      revisionNumber,
      kind: "SUBMISSION",
      snapshotId: contest.snapshotId,
      callCount: validation.calls.length,
      fingerprint: waiverBoardFingerprint({
        contestId: contest.id,
        snapshotId: contest.snapshotId,
        rankableEntryIds: validation.calls.map((call) => call.rankableEntryId),
      }),
      authorUserId: input.adminUserId,
      createdAt: now,
    },
    select: { id: true },
  });
  if (validation.calls.length > 0) {
    await tx.waiverCall.createMany({
      data: validation.calls.map((call) => ({ revisionId: revision.id, slot: call.slot, snapshotEntryId: call.snapshotEntryId })),
    });
  }
  await tx.waiverAiResponse.create({
    data: {
      revisionId: revision.id,
      contestId: contest.id,
      position: contest.position,
      snapshotId: contest.snapshotId,
      universalProfileId: profile.id,
      modelLabel: input.modelLabel,
      promptVersion: WAIVEREYEQ_AI_PROMPT_VERSION,
      promptSha256: context.prompt.sha256,
      parserVersion: parse.parserVersion,
      responseText: input.responseText,
      responseSha256,
      responseByteLength: utf8ByteLength(input.responseText),
      noCalls: parse.noCalls,
      statedGeneratedAt: input.statedGeneratedAt,
      sourceReference: input.sourceReference,
      sourceNote: input.sourceNote,
      importedByUserId: input.adminUserId,
    },
  });
  await tx.waiverSubmission.update({
    where: { id: submission.id },
    data: { status: "SUBMITTED", currentRevisionId: revision.id, submittedAt: now },
  });
  await tx.adminAuditLog.create({
    data: {
      adminUserId: input.adminUserId,
      action: "waivers.ai_board_submitted",
      entityType: "WaiverSubmission",
      entityId: submission.id,
      metadata: {
        contestId: contest.id,
        position: contest.position,
        universalProfileId: profile.id,
        revisionNumber,
        callCount: validation.calls.length,
        noCalls: parse.noCalls,
        modelLabel: input.modelLabel,
        promptVersion: WAIVEREYEQ_AI_PROMPT_VERSION,
        promptSha256: context.prompt.sha256,
        responseSha256,
        statedGeneratedAt: input.statedGeneratedAt?.toISOString() ?? null,
      } satisfies Prisma.InputJsonValue,
      createdAt: now,
    },
  });
  return {
    submissionId: submission.id,
    revisionNumber,
    callCount: validation.calls.length,
    noCalls: parse.noCalls,
    responseSha256,
    changed: true,
    submittedAt: now,
  };
}

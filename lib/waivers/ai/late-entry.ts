import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  WAIVER_AI_ARTIFACT_MAX_BYTES,
  WAIVER_AI_ARTIFACT_NAME_MAX,
  WAIVER_AI_ARTIFACT_TIME_TOLERANCE_MS,
  WAIVER_AI_LATE_ENTRY_BASES,
  WAIVER_AI_NOTE_MAX,
  WAIVER_AI_PROMPT_TEXT_MAX_BYTES,
  WAIVER_AI_PROMPT_VERSION_MAX,
  WAIVER_AI_SOURCE_REFERENCE_MAX,
  type WaiverAiLateEntryBasis,
} from "@/lib/waivers/ai/constants";
import { loadWaiverAiContestContext, type WaiverAiContestContext } from "@/lib/waivers/ai/context";
import { inspectProviderArtifact } from "@/lib/waivers/ai/provider-artifact";
import { assertWaiverAiAdmin, loadActiveAiCompetitor, parseAgainstContext, WaiverAiError } from "@/lib/waivers/ai/submissions";
import { describeWaiverBoardErrors, validateWaiverCalls } from "@/lib/waivers/call-validation";
import { readWaiverClock, shareLockWaiverContest, type WaiverDb } from "@/lib/waivers/clock";
import { loadWaiverPool } from "@/lib/waivers/contests";
import { waiverBoardFingerprint } from "@/lib/waivers/fingerprint";

/**
 * Controlled administrative late entry (Stage 4B.3B). An AI prediction whose
 * pre-lock existence is evidenced may become a competitive board after the
 * lock, in two separate admin actions:
 *
 * 1. verify — records an append-only verification of one historical-evidence
 *    record: the exact response re-parsed against the pinned frozen pool, the
 *    evidence basis, the original prompt as known and an attestation. The
 *    database derives the original time, its method, prompt equivalence and
 *    eligibility; nothing competitive is written.
 * 2. approve — in a later transaction, approves the latest eligible
 *    verification and, in the same transaction, creates the locked board from
 *    the stored evidence text. The database admits these post-lock rows only
 *    for the approval inserted by that transaction.
 *
 * Picks are never regenerated, corrected, replaced or reordered; an invalid
 * response is refused whole. Owner-authored boards never pass through here.
 */

const SHA256_HEX = /^[a-f0-9]{64}$/;
/** Mirrors the database: a canonical label is never accepted without the byte-identical prompt text. */
const CANONICAL_PROMPT_LABEL = /^\s*WAIVEREYEQ_AI_V[0-9]/i;

function isBasis(value: string): value is WaiverAiLateEntryBasis {
  return (WAIVER_AI_LATE_ENTRY_BASES as readonly string[]).includes(value);
}

function mapDatabaseError(error: unknown): unknown {
  if (error instanceof WaiverAiError) return error;
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return new WaiverAiError("CONFLICT", "A late entry or verification was recorded concurrently; reload and try again");
  }
  const message = error instanceof Error ? error.message : "";
  const guard = /WAIVER_(?:INVALID|IMMUTABLE|LOCKED): ([^\n"]+)/.exec(message);
  if (guard) return new WaiverAiError("CONFLICT", `Refused by the database: ${guard[1]}. Nothing was saved.`);
  return error;
}

async function loadEvidence(db: WaiverDb, evidenceId: string) {
  const evidence = await db.waiverAiHistoricalEvidence.findUnique({
    where: { id: evidenceId },
    select: {
      id: true,
      contestId: true,
      universalProfileId: true,
      snapshotId: true,
      modelLabel: true,
      responseText: true,
      responseSha256: true,
      recordedAt: true,
    },
  });
  if (!evidence) throw new WaiverAiError("NOT_FOUND", "Historical evidence not found");
  return evidence;
}

export type StrictBoard = {
  pickIds: string[];
  calls: Array<{ slot: number; snapshotEntryId: string; rankableEntryId: string }>;
  noCalls: boolean;
  parserVersion: string;
  fingerprint: string;
};

/** Strict parse + validation of the exact evidence text against the pinned pool. Refuses the whole response if invalid. */
export async function strictBoard(db: WaiverDb, context: WaiverAiContestContext, responseText: string): Promise<StrictBoard> {
  const parse = parseAgainstContext(context, responseText);
  if (!parse.ok) throw new WaiverAiError("INVALID_RESPONSE", "The original response is invalid against the frozen pool; nothing was saved", parse.issues);
  const pickIds = parse.picks.map((pick) => pick.rankableEntryId);
  const pool = await loadWaiverPool(db, { snapshotId: context.contest.snapshotId, position: context.contest.position });
  const validation = validateWaiverCalls({ playerIds: pickIds, pool, configuredMaxCalls: context.contest.maxCalls });
  if (!validation.ok) throw new WaiverAiError("INVALID_RESPONSE", describeWaiverBoardErrors(validation.errors));
  return {
    pickIds,
    calls: validation.calls.map((call) => ({ slot: call.slot, snapshotEntryId: call.snapshotEntryId, rankableEntryId: call.rankableEntryId })),
    noCalls: parse.noCalls,
    parserVersion: parse.parserVersion,
    fingerprint: waiverBoardFingerprint({
      contestId: context.contest.id,
      snapshotId: context.contest.snapshotId,
      rankableEntryIds: validation.calls.map((call) => call.rankableEntryId),
    }),
  };
}

export type WaiverAiLateEntryVerifyInput = {
  adminUserId: string;
  evidenceId: string;
  /** Latest verification sequence the admin saw (0 = none); stale submissions are refused. */
  expectedSequence: number;
  basis: string;
  /**
   * Admin-read or admin-stated original time; never competitive. Ignored for
   * DATABASE_RECORDED_PRE_LOCK; for PROVIDER_ARTIFACT the database replaces it
   * with the provider message timestamp when there is one (and refuses a conflict).
   */
  originalPredictionAt: Date | null;
  sourceReference: string;
  artifact: null | { name: string; bytes: Uint8Array; expectedSha256: string };
  /** sha256 of the current canonical Waivers prompt the admin reviewed against (validation only). */
  expectedPromptSha256: string;
  /** The prompt the AI was actually given, as far as it is known. Never inferred. */
  originalPrompt: { version: string | null; reference: string | null; text: string | null };
  /** Ordered RankableEntry ids the admin confirmed in the preview (compared, never written). */
  confirmedRankableEntryIds: ReadonlyArray<string>;
  attestation: string;
};

export type WaiverAiLateEntryVerifyResult = {
  verificationId: string;
  sequence: number;
  eligible: boolean;
  ineligibleReason: string | null;
  originalPredictionAt: Date | null;
  timestampMethod: string;
  artifactContainsResponse: boolean | null;
  promptEquivalence: string;
  verifiedAt: Date;
};

function originalPromptInput(input: WaiverAiLateEntryVerifyInput["originalPrompt"]) {
  const version = input.version?.trim() || null;
  const reference = input.reference?.trim() || null;
  const text = input.text && input.text.trim() ? input.text : null;
  if (version && version.length > WAIVER_AI_PROMPT_VERSION_MAX) throw new WaiverAiError("INVALID_INPUT", "The original prompt version is too long");
  if (reference && reference.length > WAIVER_AI_SOURCE_REFERENCE_MAX) throw new WaiverAiError("INVALID_INPUT", "The original prompt reference is too long");
  if (text && Buffer.byteLength(text, "utf8") > WAIVER_AI_PROMPT_TEXT_MAX_BYTES) {
    throw new WaiverAiError("INVALID_INPUT", `The original prompt text must be at most ${WAIVER_AI_PROMPT_TEXT_MAX_BYTES} bytes`);
  }
  return { version, reference, text };
}

export async function verifyWaiverAiLateEntry(input: WaiverAiLateEntryVerifyInput): Promise<WaiverAiLateEntryVerifyResult> {
  const sourceReference = input.sourceReference.trim();
  const attestation = input.attestation.trim();
  if (!isBasis(input.basis)) throw new WaiverAiError("INVALID_INPUT", "Choose the evidence basis");
  if (!sourceReference || sourceReference.length > WAIVER_AI_SOURCE_REFERENCE_MAX) throw new WaiverAiError("INVALID_INPUT", "A source reference is required");
  if (!attestation || attestation.length > WAIVER_AI_NOTE_MAX) throw new WaiverAiError("INVALID_INPUT", "An attestation is required");
  if (!Number.isInteger(input.expectedSequence) || input.expectedSequence < 0) throw new WaiverAiError("INVALID_INPUT", "Invalid request");
  if (!SHA256_HEX.test(input.expectedPromptSha256)) throw new WaiverAiError("INVALID_INPUT", "Invalid prompt fingerprint");
  const basis = input.basis;
  const originalPrompt = originalPromptInput(input.originalPrompt);
  const artifact = input.artifact;
  if (artifact) {
    const name = artifact.name.trim();
    if (!name || name.length > WAIVER_AI_ARTIFACT_NAME_MAX) throw new WaiverAiError("INVALID_INPUT", "The provider file needs a name");
    if (artifact.bytes.byteLength === 0 || artifact.bytes.byteLength > WAIVER_AI_ARTIFACT_MAX_BYTES) {
      throw new WaiverAiError("INVALID_INPUT", `The provider file must be 1–${WAIVER_AI_ARTIFACT_MAX_BYTES} bytes`);
    }
    if (createHash("sha256").update(artifact.bytes).digest("hex") !== artifact.expectedSha256) {
      throw new WaiverAiError("RESPONSE_HASH_MISMATCH", "The provider file changed in transit; nothing was saved");
    }
  }
  if (basis === "PROVIDER_ARTIFACT" && !artifact) throw new WaiverAiError("INVALID_INPUT", "This basis requires the original provider file");

  try {
    return await prisma.$transaction(async (tx) => {
      await assertWaiverAiAdmin(tx, input.adminUserId);
      const evidence = await loadEvidence(tx, input.evidenceId);
      const context = await loadWaiverAiContestContext(tx, evidence.contestId);
      if (!context) throw new WaiverAiError("NOT_FOUND", "Waiver contest not found");
      await loadActiveAiCompetitor(tx, evidence.universalProfileId);
      const latest = await tx.waiverAiLateEntryVerification.findFirst({
        where: { evidenceId: evidence.id },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });
      if ((latest?.sequence ?? 0) !== input.expectedSequence) {
        throw new WaiverAiError("CONFLICT", "This evidence was verified by someone else; reload and try again");
      }
      if (context.prompt.sha256 !== input.expectedPromptSha256) {
        throw new WaiverAiError("PROMPT_CHANGED", "The canonical Waivers prompt changed since you reviewed it; reload and review again");
      }
      const originalPromptSha256 = originalPrompt.text ? createHash("sha256").update(originalPrompt.text, "utf8").digest("hex") : null;
      if (originalPrompt.version && CANONICAL_PROMPT_LABEL.test(originalPrompt.version) && originalPromptSha256 !== context.prompt.sha256) {
        throw new WaiverAiError(
          "INVALID_INPUT",
          `“${originalPrompt.version}” may be recorded only with the preserved prompt text, byte-identical to the canonical prompt; leave the version blank or name the prompt actually used`,
        );
      }
      const board = await strictBoard(tx, context, evidence.responseText);
      if (board.pickIds.length !== input.confirmedRankableEntryIds.length || board.pickIds.some((id, i) => id !== input.confirmedRankableEntryIds[i])) {
        throw new WaiverAiError("PREVIEW_MISMATCH", "The confirmed preview no longer matches the evidence; reload and review again");
      }

      const now = await readWaiverClock(tx);
      // A preview only: the database re-derives containment, the time and its method from the stored bytes.
      const inspection = artifact ? inspectProviderArtifact(artifact.bytes, evidence.responseText) : null;
      const enteredAt = basis === "DATABASE_RECORDED_PRE_LOCK" ? null : input.originalPredictionAt;
      if (basis === "PROVIDER_ARTIFACT") {
        if (!inspection?.utf8) throw new WaiverAiError("INVALID_INPUT", "The provider file is not UTF-8 text");
        if (enteredAt && inspection.extractedAt && Math.abs(enteredAt.getTime() - inspection.extractedAt.getTime()) > WAIVER_AI_ARTIFACT_TIME_TOLERANCE_MS) {
          throw new WaiverAiError("INVALID_INPUT", "The entered time conflicts with the provider message's own timestamp");
        }
      }
      if (enteredAt && enteredAt.getTime() > now.getTime()) {
        throw new WaiverAiError("INVALID_INPUT", "The original time cannot be in the future");
      }

      const verification = await tx.waiverAiLateEntryVerification.create({
        data: {
          evidenceId: evidence.id,
          sequence: input.expectedSequence + 1,
          contestId: context.contest.id,
          position: context.contest.position,
          snapshotId: evidence.snapshotId,
          universalProfileId: evidence.universalProfileId,
          responseSha256: evidence.responseSha256,
          basis,
          originalPredictionAt: enteredAt,
          sourceReference,
          sourceArtifact: artifact ? Buffer.from(artifact.bytes) : null,
          sourceArtifactName: artifact ? artifact.name.trim() : null,
          sourceArtifactSha256: artifact ? artifact.expectedSha256 : null,
          sourceArtifactByteLength: artifact ? artifact.bytes.byteLength : null,
          originalPromptVersion: originalPrompt.version,
          originalPromptReference: originalPrompt.reference,
          originalPromptText: originalPrompt.text,
          canonicalPromptVersion: context.prompt.version,
          canonicalPromptSha256: context.prompt.sha256,
          parserVersion: board.parserVersion,
          callCount: board.calls.length,
          boardFingerprint: board.fingerprint,
          attestation,
          // Derived by the database trigger from the evidence and stored bytes; these values are overwritten.
          timestampMethod: "ADMIN_STATED",
          artifactContainsResponse: artifact ? false : null,
          originalPromptSha256,
          promptEquivalence: "UNKNOWN",
          eligible: false,
          ineligibleReason: "PENDING",
          verifiedByUserId: input.adminUserId,
        },
        select: {
          id: true,
          sequence: true,
          eligible: true,
          ineligibleReason: true,
          originalPredictionAt: true,
          timestampMethod: true,
          artifactContainsResponse: true,
          originalPromptSha256: true,
          promptEquivalence: true,
          verifiedAt: true,
        },
      });
      await tx.adminAuditLog.create({
        data: {
          adminUserId: input.adminUserId,
          action: "waivers.ai_late_entry_verified",
          entityType: "WaiverAiHistoricalEvidence",
          entityId: evidence.id,
          metadata: {
            verificationId: verification.id,
            sequence: verification.sequence,
            contestId: context.contest.id,
            universalProfileId: evidence.universalProfileId,
            responseSha256: evidence.responseSha256,
            basis,
            timestampMethod: verification.timestampMethod,
            originalPredictionAt: verification.originalPredictionAt?.toISOString() ?? null,
            artifactSha256: artifact?.expectedSha256 ?? null,
            artifactContainsResponse: verification.artifactContainsResponse,
            originalPromptVersion: originalPrompt.version,
            originalPromptSha256: verification.originalPromptSha256,
            canonicalPromptSha256: context.prompt.sha256,
            promptEquivalence: verification.promptEquivalence,
            boardFingerprint: board.fingerprint,
            eligible: verification.eligible,
            ineligibleReason: verification.ineligibleReason,
          } satisfies Prisma.InputJsonValue,
          createdAt: verification.verifiedAt,
        },
      });
      return {
        verificationId: verification.id,
        sequence: verification.sequence,
        eligible: verification.eligible,
        ineligibleReason: verification.ineligibleReason,
        originalPredictionAt: verification.originalPredictionAt,
        timestampMethod: verification.timestampMethod,
        artifactContainsResponse: verification.artifactContainsResponse,
        promptEquivalence: verification.promptEquivalence,
        verifiedAt: verification.verifiedAt,
      };
    });
  } catch (error) {
    throw mapDatabaseError(error);
  }
}

export type WaiverAiLateEntryApproveInput = {
  adminUserId: string;
  verificationId: string;
  /** First 12 hex digits of the response sha256, typed by the approving admin. */
  confirmation: string;
  /** Ordered RankableEntry ids the admin confirmed (compared, never written). */
  confirmedRankableEntryIds: ReadonlyArray<string>;
  note: string | null;
};

export type WaiverAiLateEntryApproveResult = {
  approvalId: string;
  submissionId: string;
  revisionId: string;
  callCount: number;
  noCalls: boolean;
  approvedAt: Date;
  originalPredictionAt: Date;
};

export async function approveWaiverAiLateEntry(input: WaiverAiLateEntryApproveInput): Promise<WaiverAiLateEntryApproveResult> {
  const note = input.note?.trim() || null;
  if (note && note.length > WAIVER_AI_NOTE_MAX) throw new WaiverAiError("INVALID_INPUT", "Note is too long");
  try {
    return await prisma.$transaction((tx) => approveInTransaction(tx, { ...input, note }));
  } catch (error) {
    throw mapDatabaseError(error);
  }
}

async function approveInTransaction(tx: Prisma.TransactionClient, input: WaiverAiLateEntryApproveInput): Promise<WaiverAiLateEntryApproveResult> {
  await assertWaiverAiAdmin(tx, input.adminUserId);
  const verification = await tx.waiverAiLateEntryVerification.findUnique({
    where: { id: input.verificationId },
    select: {
      id: true,
      evidenceId: true,
      sequence: true,
      contestId: true,
      universalProfileId: true,
      snapshotId: true,
      responseSha256: true,
      boardFingerprint: true,
      callCount: true,
      canonicalPromptSha256: true,
      canonicalPromptVersion: true,
      promptEquivalence: true,
      originalPredictionAt: true,
      eligible: true,
      ineligibleReason: true,
    },
  });
  if (!verification) throw new WaiverAiError("NOT_FOUND", "Verification not found");
  if (!verification.eligible || !verification.originalPredictionAt) {
    throw new WaiverAiError("INVALID_INPUT", "This verification is not eligible for competition; the evidence stays record-only");
  }
  if (input.confirmation.trim().toLowerCase() !== verification.responseSha256.slice(0, 12)) {
    throw new WaiverAiError("INVALID_INPUT", "Type the first 12 characters of the response sha256 to confirm");
  }
  if (!(await shareLockWaiverContest(tx, verification.contestId))) throw new WaiverAiError("NOT_FOUND", "Waiver contest not found");
  const context = await loadWaiverAiContestContext(tx, verification.contestId);
  if (!context) throw new WaiverAiError("NOT_FOUND", "Waiver contest not found");
  const now = await readWaiverClock(tx);
  if (now.getTime() < context.contest.locksAt.getTime()) {
    throw new WaiverAiError("INVALID_INPUT", "The contest is still open; submit through the ordinary AI import");
  }
  const profile = await loadActiveAiCompetitor(tx, verification.universalProfileId);
  const evidence = await loadEvidence(tx, verification.evidenceId);
  if (context.prompt.sha256 !== verification.canonicalPromptSha256) {
    throw new WaiverAiError("PROMPT_CHANGED", "The canonical Waivers prompt changed since this verification; verify again. Nothing was saved");
  }
  // The board names the canonical prompt only when the original prompt is verified to be it.
  const promptVerified = verification.promptEquivalence === "VERIFIED";
  const board = await strictBoard(tx, context, evidence.responseText);
  if (board.fingerprint !== verification.boardFingerprint) {
    throw new WaiverAiError("CONFLICT", "The parsed board no longer matches the verification; nothing was saved");
  }
  if (board.pickIds.length !== input.confirmedRankableEntryIds.length || board.pickIds.some((id, i) => id !== input.confirmedRankableEntryIds[i])) {
    throw new WaiverAiError("PREVIEW_MISMATCH", "The confirmed preview no longer matches the evidence; reload and review again");
  }
  const existing = await tx.waiverSubmission.findUnique({
    where: { contestId_universalProfileId: { contestId: context.contest.id, universalProfileId: profile.id } },
    select: { id: true },
  });
  if (existing) throw new WaiverAiError("CONFLICT", "This AI already has a board for this contest; late entry never replaces a board");
  if (await tx.waiverGradeRun.count({ where: { weekId: context.contest.weekId } })) {
    throw new WaiverAiError("CONFLICT", "This week already has a grade run; a late entry cannot join a week that has been graded");
  }

  const submissionId = randomUUID();
  const revisionId = randomUUID();
  const approval = await tx.waiverAiLateEntryApproval.create({
    data: {
      verificationId: verification.id,
      evidenceId: evidence.id,
      contestId: context.contest.id,
      universalProfileId: profile.id,
      snapshotId: context.contest.snapshotId,
      responseSha256: verification.responseSha256,
      boardFingerprint: verification.boardFingerprint,
      callCount: verification.callCount,
      submissionId,
      revisionId,
      confirmation: verification.responseSha256.slice(0, 12),
      note: input.note,
      approvedByUserId: input.adminUserId,
    },
    select: { id: true, approvedAt: true },
  });
  const importedAt = approval.approvedAt;
  await tx.waiverSubmission.create({
    data: { id: submissionId, contestId: context.contest.id, universalProfileId: profile.id, createdByUserId: input.adminUserId, authority: "SYSTEM_OPERATED" },
  });
  await tx.waiverSubmissionRevision.create({
    data: {
      id: revisionId,
      submissionId,
      revisionNumber: 1,
      kind: "SUBMISSION",
      snapshotId: context.contest.snapshotId,
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
      contestId: context.contest.id,
      position: context.contest.position,
      snapshotId: context.contest.snapshotId,
      universalProfileId: profile.id,
      modelLabel: evidence.modelLabel,
      promptVersion: promptVerified ? verification.canonicalPromptVersion : null,
      promptSha256: promptVerified ? verification.canonicalPromptSha256 : null,
      parserVersion: board.parserVersion,
      responseText: evidence.responseText,
      responseSha256: evidence.responseSha256,
      responseByteLength: Buffer.byteLength(evidence.responseText, "utf8"),
      noCalls: board.noCalls,
      statedGeneratedAt: null,
      sourceReference: `late entry ${approval.id}`,
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
      action: "waivers.ai_late_entry_approved",
      entityType: "WaiverSubmission",
      entityId: submissionId,
      metadata: {
        approvalId: approval.id,
        verificationId: verification.id,
        evidenceId: evidence.id,
        contestId: context.contest.id,
        position: context.contest.position,
        universalProfileId: profile.id,
        responseSha256: verification.responseSha256,
        boardFingerprint: board.fingerprint,
        callCount: board.calls.length,
        originalPredictionAt: verification.originalPredictionAt.toISOString(),
        promptEquivalence: verification.promptEquivalence,
        locksAt: context.contest.locksAt.toISOString(),
      } satisfies Prisma.InputJsonValue,
      createdAt: importedAt,
    },
  });
  return {
    approvalId: approval.id,
    submissionId,
    revisionId,
    callCount: board.calls.length,
    noCalls: board.noCalls,
    approvedAt: importedAt,
    originalPredictionAt: verification.originalPredictionAt,
  };
}

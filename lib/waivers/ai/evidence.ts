import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  WAIVER_AI_EVIDENCE_REVIEW_STATUSES,
  WAIVER_AI_EVIDENCE_SOURCES,
  WAIVER_AI_MODEL_LABEL_MAX,
  WAIVER_AI_NOTE_MAX,
  WAIVER_AI_SOURCE_REFERENCE_MAX,
  type WaiverAiEvidenceReviewStatusValue,
  type WaiverAiEvidenceSource,
} from "@/lib/waivers/ai/constants";
import { loadWaiverAiContestContext } from "@/lib/waivers/ai/context";
import type { WaiverAiParseResult } from "@/lib/waivers/ai/response-parser";
import { assertWaiverAiAdmin, parseAgainstContext, WaiverAiError } from "@/lib/waivers/ai/submissions";
import { isStorableText, sha256Utf8, utf8ByteLength } from "@/lib/waivers/ai/text";
import { readWaiverClock } from "@/lib/waivers/clock";

/**
 * Historical AI Waiver evidence (Stage 4B.3A): an append-only record of an
 * AI prediction kept outside the competitive path. Recording never creates
 * or changes a Waiver board, revision, call, grade, approval, consensus or
 * leaderboard input, and no stated source time is treated as proof.
 */

export type WaiverAiEvidencePreview = {
  contestId: string;
  responseSha256: string;
  responseByteLength: number;
  /** Database clock is at or after the contest's lock: recording now is RECORDED AFTER LOCK. */
  afterLock: boolean;
  /** Strict parse against the contest's pinned frozen snapshot, for review only. */
  parse: WaiverAiParseResult;
};

/** Read-only preview against the contest's pinned frozen snapshot. Writes nothing. */
export async function previewWaiverAiEvidence(input: { adminUserId: string; contestId: string; responseText: string }): Promise<WaiverAiEvidencePreview> {
  await assertWaiverAiAdmin(prisma, input.adminUserId);
  const context = await loadWaiverAiContestContext(prisma, input.contestId);
  if (!context) throw new WaiverAiError("NOT_FOUND", "Waiver contest not found");
  const now = await readWaiverClock();
  return {
    contestId: context.contest.id,
    responseSha256: sha256Utf8(input.responseText),
    responseByteLength: utf8ByteLength(input.responseText),
    afterLock: now.getTime() >= context.contest.locksAt.getTime(),
    parse: parseAgainstContext(context, input.responseText),
  };
}

export type WaiverAiEvidenceRecordInput = {
  adminUserId: string;
  contestId: string;
  universalProfileId: string;
  responseText: string;
  expectedResponseSha256: string;
  modelLabel: string;
  statedSourceAt: Date | null;
  evidenceSource: string;
  evidenceReference: string;
  note: string | null;
};

export type WaiverAiEvidenceRecordResult = {
  evidenceId: string;
  recordedAt: Date;
  recordedAfterLock: boolean;
  responseSha256: string;
};

function isEvidenceSource(value: string): value is WaiverAiEvidenceSource {
  return (WAIVER_AI_EVIDENCE_SOURCES as readonly string[]).includes(value);
}

function mapDatabaseError(error: unknown): unknown {
  if (error instanceof WaiverAiError) return error;
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return new WaiverAiError("CONFLICT", "This exact response is already recorded for this AI and contest");
  }
  const message = error instanceof Error ? error.message : "";
  if (message.includes("WAIVER_INVALID") || message.includes("WAIVER_IMMUTABLE")) {
    return new WaiverAiError("CONFLICT", "The evidence could not be recorded; reload and try again");
  }
  return error;
}

export async function recordWaiverAiEvidence(input: WaiverAiEvidenceRecordInput): Promise<WaiverAiEvidenceRecordResult> {
  const modelLabel = input.modelLabel.trim();
  const evidenceReference = input.evidenceReference.trim();
  const note = input.note?.trim() || null;
  if (!modelLabel || modelLabel.length > WAIVER_AI_MODEL_LABEL_MAX) throw new WaiverAiError("INVALID_INPUT", "A model label is required");
  if (!isEvidenceSource(input.evidenceSource)) throw new WaiverAiError("INVALID_INPUT", "Choose how the original was preserved");
  if (!evidenceReference || evidenceReference.length > WAIVER_AI_SOURCE_REFERENCE_MAX) {
    throw new WaiverAiError("INVALID_INPUT", "An evidence reference is required");
  }
  if (note && note.length > WAIVER_AI_NOTE_MAX) throw new WaiverAiError("INVALID_INPUT", "Note is too long");
  if (!input.responseText || !isStorableText(input.responseText)) throw new WaiverAiError("INVALID_INPUT", "The response text is empty or not valid text");
  const responseSha256 = sha256Utf8(input.responseText);
  if (responseSha256 !== input.expectedResponseSha256) {
    throw new WaiverAiError("RESPONSE_HASH_MISMATCH", "The response text changed in transit; nothing was recorded");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      await assertWaiverAiAdmin(tx, input.adminUserId);
      const contest = await tx.waiverContest.findUnique({
        where: { id: input.contestId },
        select: { id: true, position: true, snapshotId: true },
      });
      if (!contest) throw new WaiverAiError("NOT_FOUND", "Waiver contest not found");
      const profile = await tx.universalProfile.findUnique({ where: { id: input.universalProfileId }, select: { profileType: true } });
      if (!profile || profile.profileType !== "AI") throw new WaiverAiError("NOT_AI_COMPETITOR", "Historical AI evidence belongs to an AI profile");
      const now = await readWaiverClock(tx);
      if (input.statedSourceAt && input.statedSourceAt.getTime() > now.getTime()) {
        throw new WaiverAiError("INVALID_INPUT", "The stated source time cannot be in the future");
      }
      const evidence = await tx.waiverAiHistoricalEvidence.create({
        data: {
          contestId: contest.id,
          position: contest.position,
          snapshotId: contest.snapshotId,
          universalProfileId: input.universalProfileId,
          modelLabel,
          responseText: input.responseText,
          responseSha256,
          responseByteLength: utf8ByteLength(input.responseText),
          statedSourceAt: input.statedSourceAt,
          evidenceSource: input.evidenceSource,
          evidenceReference,
          note,
          // Derived by the database trigger from its clock; this value is overwritten.
          recordedAfterLock: false,
          recordedByUserId: input.adminUserId,
        },
        select: { id: true, recordedAt: true, recordedAfterLock: true },
      });
      await tx.adminAuditLog.create({
        data: {
          adminUserId: input.adminUserId,
          action: "waivers.ai_evidence_recorded",
          entityType: "WaiverAiHistoricalEvidence",
          entityId: evidence.id,
          metadata: {
            contestId: contest.id,
            position: contest.position,
            universalProfileId: input.universalProfileId,
            modelLabel,
            responseSha256,
            recordedAfterLock: evidence.recordedAfterLock,
            statedSourceAt: input.statedSourceAt?.toISOString() ?? null,
            evidenceSource: input.evidenceSource,
          } satisfies Prisma.InputJsonValue,
          createdAt: evidence.recordedAt,
        },
      });
      return { evidenceId: evidence.id, recordedAt: evidence.recordedAt, recordedAfterLock: evidence.recordedAfterLock, responseSha256 };
    });
  } catch (error) {
    throw mapDatabaseError(error);
  }
}

export type WaiverAiEvidenceReviewInput = {
  adminUserId: string;
  evidenceId: string;
  /** The review sequence the admin saw as latest (0 = none); stale reviews are refused. */
  expectedSequence: number;
  status: string;
  note: string;
};

function isReviewStatus(value: string): value is WaiverAiEvidenceReviewStatusValue {
  return (WAIVER_AI_EVIDENCE_REVIEW_STATUSES as readonly string[]).includes(value);
}

export async function reviewWaiverAiEvidence(input: WaiverAiEvidenceReviewInput): Promise<{ sequence: number; reviewedAt: Date }> {
  const note = input.note.trim();
  if (!isReviewStatus(input.status)) throw new WaiverAiError("INVALID_INPUT", "Choose a review status");
  if (!note || note.length > WAIVER_AI_NOTE_MAX) throw new WaiverAiError("INVALID_INPUT", "A review note is required");
  try {
    return await prisma.$transaction(async (tx) => {
      await assertWaiverAiAdmin(tx, input.adminUserId);
      const latest = await tx.waiverAiHistoricalEvidenceReview.findFirst({
        where: { evidenceId: input.evidenceId },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      });
      if ((latest?.sequence ?? 0) !== input.expectedSequence) {
        throw new WaiverAiError("CONFLICT", "The evidence was reviewed by someone else; reload and try again");
      }
      const review = await tx.waiverAiHistoricalEvidenceReview.create({
        data: {
          evidenceId: input.evidenceId,
          sequence: input.expectedSequence + 1,
          status: input.status as WaiverAiEvidenceReviewStatusValue,
          note,
          reviewerUserId: input.adminUserId,
        },
        select: { sequence: true, reviewedAt: true },
      });
      await tx.adminAuditLog.create({
        data: {
          adminUserId: input.adminUserId,
          action: "waivers.ai_evidence_reviewed",
          entityType: "WaiverAiHistoricalEvidence",
          entityId: input.evidenceId,
          metadata: { sequence: review.sequence, status: input.status } satisfies Prisma.InputJsonValue,
          createdAt: review.reviewedAt,
        },
      });
      return review;
    });
  } catch (error) {
    throw mapDatabaseError(error);
  }
}

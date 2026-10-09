"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin } from "@/lib/auth/session";
import { logServerEvent } from "@/lib/log";
import { RATE_LIMITS, rateLimit, rateLimitErrorMessage } from "@/lib/rate-limit";
import { rateLimitKey } from "@/lib/request-ip";
import {
  WAIVER_AI_ARTIFACT_BASE64_MAX,
  WAIVER_AI_ARTIFACT_NAME_MAX,
  WAIVER_AI_MODEL_LABEL_MAX,
  WAIVER_AI_NOTE_MAX,
  WAIVER_AI_PROMPT_TEXT_MAX_BYTES,
  WAIVER_AI_PROMPT_VERSION_MAX,
  WAIVER_AI_RESPONSE_MAX_BYTES,
  WAIVER_AI_SOURCE_REFERENCE_MAX,
} from "@/lib/waivers/ai/constants";
import { previewWaiverAiEvidence, recordWaiverAiEvidence, reviewWaiverAiEvidence } from "@/lib/waivers/ai/evidence";
import { approveWaiverAiLateEntry, verifyWaiverAiLateEntry } from "@/lib/waivers/ai/late-entry";
import { importAiWaiverBoard, previewWaiverAiResponse, WaiverAiError } from "@/lib/waivers/ai/submissions";
import { SHA256_HEX } from "@/lib/waivers/ai/text";
import { parseWaiverObservedAt } from "@/lib/waivers/snapshot/input";

const MAX_ID = 64;
/** UTF-16 length bound; the byte cap is enforced by the parser and the database. */
const MAX_TEXT = WAIVER_AI_RESPONSE_MAX_BYTES;
const MAX_PICKS = 5;

type ActionError = { ok: false; error: string; code: string; issues?: unknown };
const invalid = (error = "Invalid request"): ActionError => ({ ok: false, error, code: "INVALID_INPUT" });

const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= MAX_ID;
const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isSha = (value: unknown): value is string => typeof value === "string" && SHA256_HEX.test(value);

async function adminUserId(): Promise<string | null> {
  try {
    return (await assertAdmin()).user.id;
  } catch {
    return null;
  }
}

async function limited(userId: string): Promise<ActionError | null> {
  const result = rateLimit({ key: await rateLimitKey("admin-waiver-ai", userId), ...RATE_LIMITS.adminParser });
  return result.ok ? null : { ok: false, error: rateLimitErrorMessage(result), code: "RATE_LIMITED" };
}

function failure(error: unknown, event: string): ActionError {
  if (error instanceof WaiverAiError) return { ok: false, error: error.message, code: error.code, issues: error.issues };
  logServerEvent(event, {}, "error");
  return { ok: false, error: "Unexpected error; nothing was saved", code: "UNKNOWN" };
}

/** "" = not stated; otherwise Chicago local (YYYY-MM-DDTHH:MM) or ISO with a zone. */
function statedTime(value: unknown): { ok: true; at: Date | null } | { ok: false } {
  if (!isText(value, 64)) return { ok: false };
  if (!value.trim()) return { ok: true, at: null };
  const at = parseWaiverObservedAt(value);
  return at ? { ok: true, at } : { ok: false };
}

function revalidateBoard(profileId: string, contestId: string) {
  revalidatePath("/admin/ai");
  revalidatePath(`/admin/waivers/ai/${profileId}/${contestId}`);
}

/** Parses an AI response against the contest's pinned frozen snapshot. Writes nothing. */
export async function previewWaiverAiResponseAction(input: unknown) {
  const userId = await adminUserId();
  if (!userId) return { ok: false as const, error: "Admin access required", code: "FORBIDDEN" };
  if (!isObject(input) || !isId(input.contestId) || !isText(input.responseText, MAX_TEXT)) return invalid();
  const rate = await limited(userId);
  if (rate) return rate;
  try {
    const preview = await previewWaiverAiResponse({ adminUserId: userId, contestId: input.contestId, responseText: input.responseText });
    return { ok: true as const, preview };
  } catch (error) {
    return failure(error, "waivers.ai_preview_failed");
  }
}

/** Submits a SYSTEM_OPERATED AI board: the server re-parses the exact text; client ids are only compared. */
export async function submitWaiverAiBoardAction(input: unknown) {
  const userId = await adminUserId();
  if (!userId) return { ok: false as const, error: "Admin access required", code: "FORBIDDEN" };
  if (!isObject(input) || !isId(input.contestId) || !isId(input.profileId) || !isText(input.responseText, MAX_TEXT)) return invalid();
  const { expectedResponseSha256, expectedPromptSha256, confirmedRankableEntryIds, modelLabel, sourceReference, sourceNote } = input;
  if (!isSha(expectedResponseSha256) || !isSha(expectedPromptSha256)) return invalid();
  if (!Array.isArray(confirmedRankableEntryIds) || confirmedRankableEntryIds.length > MAX_PICKS || !confirmedRankableEntryIds.every(isId)) return invalid();
  if (!isText(modelLabel, WAIVER_AI_MODEL_LABEL_MAX) || !modelLabel.trim()) return invalid("A model label is required");
  if (!isText(sourceReference, WAIVER_AI_SOURCE_REFERENCE_MAX) || !isText(sourceNote, WAIVER_AI_NOTE_MAX)) return invalid();
  const stated = statedTime(input.statedGeneratedAt);
  if (!stated.ok) return invalid("Generation time must be Chicago local (YYYY-MM-DDTHH:MM) or ISO with a zone");
  const rate = await limited(userId);
  if (rate) return rate;
  try {
    const result = await importAiWaiverBoard({
      adminUserId: userId,
      contestId: input.contestId,
      universalProfileId: input.profileId,
      responseText: input.responseText,
      expectedResponseSha256,
      expectedPromptSha256,
      confirmedRankableEntryIds: confirmedRankableEntryIds as string[],
      modelLabel,
      statedGeneratedAt: stated.at,
      sourceReference,
      sourceNote,
    });
    revalidateBoard(input.profileId, input.contestId);
    return {
      ok: true as const,
      changed: result.changed,
      revisionNumber: result.revisionNumber,
      callCount: result.callCount,
      noCalls: result.noCalls,
      responseSha256: result.responseSha256,
      submittedAt: result.submittedAt.toISOString(),
    };
  } catch (error) {
    return failure(error, "waivers.ai_submit_failed");
  }
}

/** Parses historical evidence against the contest's pinned frozen snapshot. Writes nothing. */
export async function previewWaiverAiEvidenceAction(input: unknown) {
  const userId = await adminUserId();
  if (!userId) return { ok: false as const, error: "Admin access required", code: "FORBIDDEN" };
  if (!isObject(input) || !isId(input.contestId) || !isText(input.responseText, MAX_TEXT)) return invalid();
  const rate = await limited(userId);
  if (rate) return rate;
  try {
    const preview = await previewWaiverAiEvidence({ adminUserId: userId, contestId: input.contestId, responseText: input.responseText });
    return { ok: true as const, preview };
  } catch (error) {
    return failure(error, "waivers.ai_evidence_preview_failed");
  }
}

/** Records historical AI evidence (record-only; never a board). */
export async function recordWaiverAiEvidenceAction(input: unknown) {
  const userId = await adminUserId();
  if (!userId) return { ok: false as const, error: "Admin access required", code: "FORBIDDEN" };
  if (!isObject(input) || !isId(input.contestId) || !isId(input.profileId) || !isText(input.responseText, MAX_TEXT)) return invalid();
  const { expectedResponseSha256, modelLabel, evidenceSource, evidenceReference, note } = input;
  if (!isSha(expectedResponseSha256)) return invalid();
  if (!isText(modelLabel, WAIVER_AI_MODEL_LABEL_MAX) || !isText(evidenceSource, 64)) return invalid();
  if (!isText(evidenceReference, WAIVER_AI_SOURCE_REFERENCE_MAX) || !isText(note, WAIVER_AI_NOTE_MAX)) return invalid();
  const stated = statedTime(input.statedSourceAt);
  if (!stated.ok) return invalid("Source time must be Chicago local (YYYY-MM-DDTHH:MM) or ISO with a zone");
  const rate = await limited(userId);
  if (rate) return rate;
  try {
    const result = await recordWaiverAiEvidence({
      adminUserId: userId,
      contestId: input.contestId,
      universalProfileId: input.profileId,
      responseText: input.responseText,
      expectedResponseSha256,
      modelLabel,
      statedSourceAt: stated.at,
      evidenceSource,
      evidenceReference,
      note: note || null,
    });
    revalidateBoard(input.profileId, input.contestId);
    return {
      ok: true as const,
      evidenceId: result.evidenceId,
      recordedAt: result.recordedAt.toISOString(),
      recordedAfterLock: result.recordedAfterLock,
      responseSha256: result.responseSha256,
    };
  } catch (error) {
    return failure(error, "waivers.ai_evidence_record_failed");
  }
}

/** Appends a review to historical evidence. Reviews never make evidence competitive. */
export async function reviewWaiverAiEvidenceAction(input: unknown) {
  const userId = await adminUserId();
  if (!userId) return { ok: false as const, error: "Admin access required", code: "FORBIDDEN" };
  if (!isObject(input) || !isId(input.evidenceId) || !isId(input.profileId) || !isId(input.contestId)) return invalid();
  const { expectedSequence, status, note } = input;
  if (typeof expectedSequence !== "number" || !Number.isInteger(expectedSequence) || expectedSequence < 0) return invalid();
  if (!isText(status, 32) || !isText(note, WAIVER_AI_NOTE_MAX)) return invalid();
  const rate = await limited(userId);
  if (rate) return rate;
  try {
    const result = await reviewWaiverAiEvidence({ adminUserId: userId, evidenceId: input.evidenceId, expectedSequence, status, note });
    revalidateBoard(input.profileId, input.contestId);
    return { ok: true as const, sequence: result.sequence, reviewedAt: result.reviewedAt.toISOString() };
  } catch (error) {
    return failure(error, "waivers.ai_evidence_review_failed");
  }
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const isPickIds = (value: unknown): value is string[] => Array.isArray(value) && value.length <= MAX_PICKS && value.every(isId);

/** Late Entry Override step 1: records an append-only verification. Never creates a board. */
export async function verifyWaiverAiLateEntryAction(input: unknown) {
  const userId = await adminUserId();
  if (!userId) return { ok: false as const, error: "Admin access required", code: "FORBIDDEN" };
  if (!isObject(input) || !isId(input.evidenceId) || !isId(input.profileId) || !isId(input.contestId)) return invalid();
  const { expectedSequence, basis, sourceReference, attestation, expectedPromptSha256, confirmedRankableEntryIds, artifact } = input;
  if (typeof expectedSequence !== "number" || !Number.isInteger(expectedSequence) || expectedSequence < 0) return invalid();
  if (!isText(basis, 64) || !isText(sourceReference, WAIVER_AI_SOURCE_REFERENCE_MAX) || !isText(attestation, WAIVER_AI_NOTE_MAX)) return invalid();
  if (!isSha(expectedPromptSha256) || !isPickIds(confirmedRankableEntryIds)) return invalid();
  let file: { name: string; bytes: Uint8Array; expectedSha256: string } | null = null;
  if (artifact !== null && artifact !== undefined) {
    if (!isObject(artifact) || !isText(artifact.name, WAIVER_AI_ARTIFACT_NAME_MAX) || !isSha(artifact.sha256)) return invalid();
    if (!isText(artifact.base64, WAIVER_AI_ARTIFACT_BASE64_MAX) || !BASE64.test(artifact.base64)) return invalid("The provider file is too large or malformed");
    file = { name: artifact.name, bytes: new Uint8Array(Buffer.from(artifact.base64, "base64")), expectedSha256: artifact.sha256 };
  }
  const original = statedTime(input.originalPredictionAt);
  if (!original.ok) return invalid("Original time must be Chicago local (YYYY-MM-DDTHH:MM) or ISO with a zone");
  const { originalPrompt } = input;
  if (!isObject(originalPrompt)) return invalid();
  if (!isText(originalPrompt.version, WAIVER_AI_PROMPT_VERSION_MAX) || !isText(originalPrompt.reference, WAIVER_AI_SOURCE_REFERENCE_MAX)) return invalid();
  if (!isText(originalPrompt.text, WAIVER_AI_PROMPT_TEXT_MAX_BYTES)) return invalid("The original prompt text is too long");
  const rate = await limited(userId);
  if (rate) return rate;
  try {
    const result = await verifyWaiverAiLateEntry({
      adminUserId: userId,
      evidenceId: input.evidenceId,
      expectedSequence,
      basis,
      originalPredictionAt: original.at,
      sourceReference,
      artifact: file,
      expectedPromptSha256,
      originalPrompt: { version: originalPrompt.version || null, reference: originalPrompt.reference || null, text: originalPrompt.text || null },
      confirmedRankableEntryIds,
      attestation,
    });
    revalidateBoard(input.profileId, input.contestId);
    return {
      ok: true as const,
      sequence: result.sequence,
      eligible: result.eligible,
      ineligibleReason: result.ineligibleReason,
      originalPredictionAt: result.originalPredictionAt?.toISOString() ?? null,
      timestampMethod: result.timestampMethod,
      promptEquivalence: result.promptEquivalence,
    };
  } catch (error) {
    return failure(error, "waivers.ai_late_entry_verify_failed");
  }
}

/** Late Entry Override step 2: approves an eligible verification and creates the late-entered board atomically. */
export async function approveWaiverAiLateEntryAction(input: unknown) {
  const userId = await adminUserId();
  if (!userId) return { ok: false as const, error: "Admin access required", code: "FORBIDDEN" };
  if (!isObject(input) || !isId(input.verificationId) || !isId(input.profileId) || !isId(input.contestId)) return invalid();
  const { confirmation, confirmedRankableEntryIds, note } = input;
  if (!isText(confirmation, 64) || !isPickIds(confirmedRankableEntryIds) || !isText(note, WAIVER_AI_NOTE_MAX)) return invalid();
  const rate = await limited(userId);
  if (rate) return rate;
  try {
    const result = await approveWaiverAiLateEntry({
      adminUserId: userId,
      verificationId: input.verificationId,
      confirmation,
      confirmedRankableEntryIds,
      note: note || null,
    });
    revalidateBoard(input.profileId, input.contestId);
    return { ok: true as const, callCount: result.callCount, noCalls: result.noCalls, importedAt: result.approvedAt.toISOString() };
  } catch (error) {
    return failure(error, "waivers.ai_late_entry_approve_failed");
  }
}

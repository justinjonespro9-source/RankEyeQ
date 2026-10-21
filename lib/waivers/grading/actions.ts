"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { logServerEvent } from "@/lib/log";
import { toWaiverGradingError } from "@/lib/waivers/grading/errors";
import { applyWaiverGradeAuthority, approveWaiverGradeRun, publishWaiverWeekGrades, storeWaiverWeekGradingRun } from "@/lib/waivers/grading/lifecycle";
import { buildWaiverGradingReview, type WaiverGradingReview } from "@/lib/waivers/grading/review-model";
import { loadWaiverWeekGradingPreviewFromSource, type WaiverGradingSource } from "@/lib/waivers/grading/source";

/**
 * One server action per grading stage; each re-checks admin access. Only the
 * preview action is SELECT-only. No action performs more than its own stage:
 * Create run does not approve, Approve does not apply, Apply does not publish.
 */

const MAX_ID = 64;
const MAX_FINGERPRINT = 64;
const MAX_REASON = 1_000;

export type WaiverGradingActionError = { ok: false; error: string; code: string; details?: unknown };
const invalid = (error = "Invalid request"): WaiverGradingActionError => ({ ok: false, error, code: "INVALID_INPUT" });
const forbidden = (): WaiverGradingActionError => ({ ok: false, error: "Admin access required", code: "FORBIDDEN" });

const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= MAX_ID;
const isFingerprint = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value) && value.length <= MAX_FINGERPRINT;
const isReason = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= MAX_REASON;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

async function adminUserId(): Promise<string | null> {
  try {
    return (await assertAdmin()).user.id;
  } catch {
    return null;
  }
}

function failure(error: unknown, event: string): WaiverGradingActionError {
  const typed = toWaiverGradingError(error);
  if (typed) return { ok: false, error: typed.message, code: typed.code, details: typed.details ?? null };
  logServerEvent(event, { error }, "error");
  return { ok: false, error: "Unexpected error; nothing was saved", code: "UNKNOWN" };
}

function parseSource(value: unknown): WaiverGradingSource | null {
  if (!isObject(value)) return null;
  if (value.kind === "SNG_ARTIFACT" && isId(value.artifactRowId)) return { kind: "SNG_ARTIFACT", artifactRowId: value.artifactRowId };
  if (value.kind === "RANKEYEQ_SNAPSHOT" && (value.snapshotId === null || value.snapshotId === undefined || isId(value.snapshotId))) {
    return { kind: "RANKEYEQ_SNAPSHOT", snapshotId: (value.snapshotId as string | null | undefined) ?? null };
  }
  return null;
}

function revalidateGrading() {
  revalidatePath("/admin/waivers/grading");
  revalidatePath("/leaderboards");
}

/** Read-only dry run. Writes nothing: no results, runs, approvals, authority, publication or audit rows. */
export async function previewWaiverWeekGradingAction(input: unknown): Promise<{ ok: true; review: WaiverGradingReview } | WaiverGradingActionError> {
  if (!(await adminUserId())) return forbidden();
  if (!isObject(input) || !isId(input.weekId)) return invalid();
  const source = parseSource(input.source);
  if (!source) return invalid();
  try {
    const preview = await loadWaiverWeekGradingPreviewFromSource(prisma, { weekId: input.weekId, source });
    const profileIds = [...new Set(preview.boards.map((b) => b.competitor.universalProfileId))];
    const profiles = profileIds.length ? await prisma.universalProfile.findMany({ where: { id: { in: profileIds } }, select: { id: true, displayName: true } }) : [];
    return { ok: true, review: buildWaiverGradingReview(preview, new Map(profiles.map((p) => [p.id, p.displayName]))) };
  } catch (error) {
    return failure(error, "waivers.grading_preview_failed");
  }
}

/** Stage 1: stores the reviewed READY preview as a new versioned grade run (PROPOSED). */
export async function storeWaiverGradingRunAction(input: unknown) {
  const userId = await adminUserId();
  if (!userId) return forbidden();
  if (!isObject(input) || !isId(input.weekId) || !isFingerprint(input.expectedInputFingerprint) || !isFingerprint(input.expectedOutputFingerprint)) return invalid();
  const source = parseSource(input.source);
  if (!source) return invalid();
  try {
    const result = await storeWaiverWeekGradingRun({
      weekId: input.weekId,
      source,
      adminUserId: userId,
      expectedInputFingerprint: input.expectedInputFingerprint,
      expectedOutputFingerprint: input.expectedOutputFingerprint,
    });
    revalidateGrading();
    return { ok: true as const, ...result };
  } catch (error) {
    return failure(error, "waivers.grading_run_store_failed");
  }
}

/** Stage 2: explicit approval of one stored run. */
export async function approveWaiverGradeRunAction(input: unknown) {
  const userId = await adminUserId();
  if (!userId) return forbidden();
  if (!isObject(input) || !isId(input.gradeRunId) || !isFingerprint(input.expectedOutputFingerprint) || !isReason(input.reason)) return invalid();
  if (typeof input.attested !== "boolean" || typeof input.acknowledgeDefCrosswalk !== "boolean") return invalid();
  const policy = input.policy === "SEPARATE_APPROVER" ? "SEPARATE_APPROVER" : "SINGLE_ADMIN_EXPLICIT";
  try {
    const result = await approveWaiverGradeRun({
      gradeRunId: input.gradeRunId,
      adminUserId: userId,
      expectedOutputFingerprint: input.expectedOutputFingerprint,
      reason: input.reason,
      attested: input.attested,
      acknowledgeDefCrosswalk: input.acknowledgeDefCrosswalk,
      policy,
    });
    revalidateGrading();
    return { ok: true as const, ...result };
  } catch (error) {
    return failure(error, "waivers.grading_run_approve_failed");
  }
}

/** Stage 3: week-atomic authority move to the approved run. Does not publish. */
export async function applyWaiverGradeAuthorityAction(input: unknown) {
  const userId = await adminUserId();
  if (!userId) return forbidden();
  if (!isObject(input) || !isId(input.approvalId) || !isReason(input.reason)) return invalid();
  try {
    const result = await applyWaiverGradeAuthority({ approvalId: input.approvalId, adminUserId: userId, reason: input.reason });
    revalidateGrading();
    return { ok: true as const, ...result };
  } catch (error) {
    return failure(error, "waivers.grading_authority_apply_failed");
  }
}

/** Stage 4: explicit publication of the week's CURRENT authority to public leaderboards. */
export async function publishWaiverWeekGradesAction(input: unknown) {
  const userId = await adminUserId();
  if (!userId) return forbidden();
  if (!isObject(input) || !isId(input.weekId) || !isId(input.expectedChangeId) || !isReason(input.reason)) return invalid();
  try {
    const result = await publishWaiverWeekGrades({ weekId: input.weekId, adminUserId: userId, expectedChangeId: input.expectedChangeId, reason: input.reason });
    revalidateGrading();
    return { ok: true as const, ...result, publishedAt: result.publishedAt.toISOString() };
  } catch (error) {
    return failure(error, "waivers.grading_publish_failed");
  }
}

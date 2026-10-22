"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin } from "@/lib/auth/session";
import { logServerEvent } from "@/lib/log";
import { RankEyeQResultsError } from "@/lib/waivers/rankeyeq-results/errors";
import {
  commitRankEyeQFinalWeekStats,
  previewRankEyeQFinalWeekStats,
  RANKEYEQ_RESULTS_SOURCE_REFERENCE_MAX,
  type RankEyeQResultsPreview,
} from "@/lib/waivers/rankeyeq-results/store";
import { RANKEYEQ_ZERO_POINT_DECISIONS, type RankEyeQZeroPointDecision } from "@/lib/waivers/rankeyeq-results/contract";
import type { RankEyeQParticipationDecisionInput } from "@/lib/waivers/rankeyeq-results/types";

/**
 * Admin server actions for RankEyeQ final-week-stats snapshots.
 * Preview is SELECT-only. Commit creates an immutable ACCEPTED snapshot only —
 * it never grades, applies authority or publishes leaderboards.
 */

const MAX_ID = 64;
const MAX_FINGERPRINT = 64;
const MAX_TEXT = 500;
const MAX_REASON = 1_000;

export type RankEyeQResultsActionError = { ok: false; error: string; code: string; details?: unknown };
const invalid = (error = "Invalid request"): RankEyeQResultsActionError => ({ ok: false, error, code: "INVALID_INPUT" });
const forbidden = (): RankEyeQResultsActionError => ({ ok: false, error: "Admin access required", code: "FORBIDDEN" });

const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= MAX_ID;
const isFingerprint = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value) && value.length <= MAX_FINGERPRINT;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

async function adminUserId(): Promise<string | null> {
  try {
    return (await assertAdmin()).user.id;
  } catch {
    return null;
  }
}

function failure(error: unknown, event: string): RankEyeQResultsActionError {
  if (error instanceof RankEyeQResultsError) {
    return { ok: false, error: error.message, code: error.code, details: error.details ?? null };
  }
  logServerEvent(event, { error }, "error");
  return { ok: false, error: "Unexpected error; nothing was saved", code: "UNKNOWN" };
}

function parseDecisions(value: unknown, decidedByUserId: string): RankEyeQParticipationDecisionInput[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const out: RankEyeQParticipationDecisionInput[] = [];
  for (const row of value) {
    if (!isObject(row) || !isId(row.rankableEntryId)) return null;
    if (!(RANKEYEQ_ZERO_POINT_DECISIONS as readonly string[]).includes(String(row.decision))) return null;
    const decision = row.decision as RankEyeQZeroPointDecision;
    if (decision === "PENDING") {
      out.push({
        rankableEntryId: row.rankableEntryId,
        decision: "PENDING",
        evidenceReference: "",
        reason: "",
        decidedByUserId,
        decidedAt: new Date().toISOString(),
      });
      continue;
    }
    if (typeof row.evidenceReference !== "string" || row.evidenceReference.trim().length === 0 || row.evidenceReference.length > MAX_TEXT) return null;
    if (typeof row.reason !== "string" || row.reason.trim().length === 0 || row.reason.length > MAX_REASON) return null;
    out.push({
      rankableEntryId: row.rankableEntryId,
      decision,
      evidenceReference: row.evidenceReference.trim(),
      reason: row.reason.trim(),
      decidedByUserId,
      decidedAt: typeof row.decidedAt === "string" && row.decidedAt.length > 0 ? row.decidedAt : new Date().toISOString(),
    });
  }
  return out;
}

function revalidateResults(weekId: string) {
  revalidatePath("/admin/waivers/rankeyeq-results");
  revalidatePath(`/admin/waivers/rankeyeq-results?weekId=${weekId}`);
  revalidatePath("/admin/waivers/grading");
}

/** Read-only preview: coverage, zero-point / absent review queue, blockers. Writes nothing. */
export async function previewRankEyeQResultsAction(
  input: unknown,
): Promise<{ ok: true; preview: RankEyeQResultsPreview } | RankEyeQResultsActionError> {
  const userId = await adminUserId();
  if (!userId) return forbidden();
  if (!isObject(input) || !isId(input.weekId)) return invalid();
  const decisions = parseDecisions(input.decisions, userId);
  if (decisions === null) return invalid("Invalid participation decisions");
  try {
    const preview = await previewRankEyeQFinalWeekStats({ weekId: input.weekId, decisions });
    return { ok: true, preview };
  } catch (error) {
    return failure(error, "waivers.rankeyeq_results_preview_failed");
  }
}

/**
 * Commits an immutable ACCEPTED RankEyeQ results snapshot for the week.
 * Does not grade, approve, apply or publish WaiverEyeQ.
 */
export async function commitRankEyeQResultsAction(input: unknown) {
  const userId = await adminUserId();
  if (!userId) return forbidden();
  if (!isObject(input) || !isId(input.weekId) || !isFingerprint(input.previewFingerprint)) return invalid();
  if (input.attested !== true) return { ok: false as const, error: "Attestation is required", code: "ATTESTATION_REQUIRED" };
  if (typeof input.sourceReference !== "string" || input.sourceReference.trim().length === 0 || input.sourceReference.length > RANKEYEQ_RESULTS_SOURCE_REFERENCE_MAX) {
    return invalid("A source reference is required");
  }
  const decisions = parseDecisions(input.decisions, userId);
  if (decisions === null) return invalid("Invalid participation decisions");
  try {
    const result = await commitRankEyeQFinalWeekStats({
      weekId: input.weekId,
      decisions,
      adminUserId: userId,
      previewFingerprint: input.previewFingerprint,
      sourceReference: input.sourceReference.trim(),
      attested: true,
    });
    revalidateResults(input.weekId);
    return { ok: true as const, ...result };
  } catch (error) {
    return failure(error, "waivers.rankeyeq_results_commit_failed");
  }
}

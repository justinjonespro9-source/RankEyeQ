"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin } from "@/lib/auth/session";
import { logServerEvent } from "@/lib/log";
import { WaiverArtifactError } from "@/lib/waivers/artifacts/errors";
import { WAIVER_ARTIFACT_REASON_MAX, WAIVER_ARTIFACT_SOURCE_REFERENCE_MAX } from "@/lib/waivers/artifacts/import-model";
import { withdrawWaiverArtifact } from "@/lib/waivers/artifacts/withdraw";
import { parseWaiverObservedAt } from "@/lib/waivers/snapshot/input";

/** Artifact preview and import travel through the upload route (lib/waivers/artifacts/upload), never a Server Action. */

const MAX_ID = 64;

type ActionError = { ok: false; error: string; code: string; details?: unknown };
const invalid = (error = "Invalid request"): ActionError => ({ ok: false, error, code: "INVALID_INPUT" });

const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= MAX_ID;
const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

async function adminUserId(): Promise<string | null> {
  try {
    return (await assertAdmin()).user.id;
  } catch {
    return null;
  }
}

function failure(error: unknown, event: string): ActionError {
  if (error instanceof WaiverArtifactError) return { ok: false, error: error.message, code: error.code, details: error.details ?? null };
  logServerEvent(event, {}, "error");
  return { ok: false, error: "Unexpected error; nothing was saved", code: "UNKNOWN" };
}

/** Records an operator-attested SNG withdrawal (of an ACCEPTED or SUPERSEDED artifact) as a new event; deletes nothing. */
export async function withdrawWaiverArtifactAction(input: unknown) {
  const userId = await adminUserId();
  if (!userId) return { ok: false as const, error: "Admin access required", code: "FORBIDDEN" };
  if (!isObject(input) || !isId(input.artifactRowId)) return invalid();
  const { reason, sourceReference, sourceObservedAt, expectedSequence, attested } = input;
  if (!isText(reason, WAIVER_ARTIFACT_REASON_MAX) || !isText(sourceReference, WAIVER_ARTIFACT_SOURCE_REFERENCE_MAX) || !isText(sourceObservedAt, 64)) {
    return invalid();
  }
  if (typeof expectedSequence !== "number" || !Number.isInteger(expectedSequence) || expectedSequence < 1 || typeof attested !== "boolean") return invalid();
  const observedAt = sourceObservedAt.trim() ? parseWaiverObservedAt(sourceObservedAt) : null;
  if (sourceObservedAt.trim() && !observedAt) return invalid("Observation time must be Chicago local (YYYY-MM-DDTHH:MM) or ISO with a zone");
  try {
    const result = await withdrawWaiverArtifact({
      artifactRowId: input.artifactRowId,
      adminUserId: userId,
      expectedSequence,
      attested,
      reason,
      sourceReference,
      sourceObservedAt: observedAt,
    });
    revalidatePath("/admin/waivers/artifacts");
    return { ok: true as const, sequence: result.sequence, recordedAt: result.recordedAt.toISOString() };
  } catch (error) {
    return failure(error, "waivers.artifact_withdraw_failed");
  }
}

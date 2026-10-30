/**
 * Client-facing classification of Admin Capture Snapshot results.
 *
 * The DB transaction may commit before the Server Action response reaches the
 * browser (Next.js E394 / non-RSC transport). Catch paths must never claim the
 * save failed, and must never auto-retry.
 */

export const CAPTURE_UNKNOWN_RESULT_MESSAGE =
  "Save could not be confirmed. Your rankings may have been saved. Check Snapshot History before trying again.";

export type CaptureSaveOutcomeKind =
  | "success"
  | "validation_error"
  | "unknown_result";

export type CaptureSaveOutcome = {
  kind: CaptureSaveOutcomeKind;
  message: string;
  snapshotId?: string;
};

export type CaptureActionSuccess = {
  ok: true;
  message: string;
  snapshotId: string;
  warnings?: string[];
  late?: boolean;
  official?: boolean;
  historicalBackfill?: boolean;
};

export type CaptureActionFailure = {
  ok: false;
  error: string;
};

export type CaptureActionResult = CaptureActionSuccess | CaptureActionFailure;

export function classifyCaptureSaveResult(
  result: CaptureActionResult,
): CaptureSaveOutcome {
  if (result.ok) {
    const parts = [result.message, ...(result.warnings ?? [])].filter(Boolean);
    const body = parts.join(" ").trim();
    return {
      kind: "success",
      snapshotId: result.snapshotId,
      message: body
        ? `Saved. ${body} Snapshot ID: ${result.snapshotId}`
        : `Saved. Snapshot ID: ${result.snapshotId}`,
    };
  }
  return {
    kind: "validation_error",
    message: result.error,
  };
}

/**
 * Any thrown error from the Server Action call is treated as UNKNOWN RESULT.
 * The capture may already have committed; do not assert failure or retry.
 */
export function classifyCaptureSaveFailure(error: unknown): CaptureSaveOutcome {
  void error;
  return {
    kind: "unknown_result",
    message: CAPTURE_UNKNOWN_RESULT_MESSAGE,
  };
}

export function isCaptureTransportAmbiguityError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  const lower = msg.toLowerCase();
  return (
    lower.includes("unexpected response was received from the server") ||
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("load failed") ||
    (lower.includes("server action") && lower.includes("not found"))
  );
}

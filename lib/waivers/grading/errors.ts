export type WaiverGradingErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  /** The preview is not READY (blockers, incomplete positions, no run): nothing is stored. */
  | "PREVIEW_BLOCKED"
  /** The reviewed fingerprints no longer match the live inputs or the stored run. */
  | "STALE"
  /** The artifact is no longer the ACCEPTED latest revision of its series. */
  | "SOURCE_SUPERSEDED"
  /** Stored evidence conflicts with the requested write (same inputs, different output). */
  | "CONFLICT"
  | "ATTESTATION_REQUIRED"
  | "NOT_APPROVED"
  | "NOT_APPLIED"
  | "ALREADY_USED"
  | "NOT_IMPLEMENTED"
  /** The grading source can be previewed but not stored/approved (RankEyeQ until dual-source storage lands). */
  | "SOURCE_UNSUPPORTED"
  /** A database guard (WAIVER_INVALID / WAIVER_IMMUTABLE) refused the write. */
  | "DB_GUARD";

export class WaiverGradingError extends Error {
  constructor(
    readonly code: WaiverGradingErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "WaiverGradingError";
  }
}

const GUARD = /(WAIVER_INVALID|WAIVER_IMMUTABLE):\s*([^\n]+)/;

/** Maps database guard failures to a typed error; typed errors pass through; anything else is unknown. */
export function toWaiverGradingError(error: unknown): WaiverGradingError | null {
  if (error instanceof WaiverGradingError) return error;
  const message = error instanceof Error ? error.message : "";
  const guard = GUARD.exec(message);
  if (guard) return new WaiverGradingError("DB_GUARD", `${guard[1]}: ${guard[2].trim()}`);
  return null;
}

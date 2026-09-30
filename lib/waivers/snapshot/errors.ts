export type WaiverSnapshotErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "BLOCKED"
  | "STALE_PREVIEW"
  | "ALREADY_FROZEN"
  | "SNAPSHOT_NOT_CURRENT"
  | "ACKNOWLEDGMENT"
  | "OBSERVED_AFTER_FREEZE"
  | "INVALID_CORRECTION";

export class WaiverSnapshotError extends Error {
  constructor(
    readonly code: WaiverSnapshotErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "WaiverSnapshotError";
  }
}

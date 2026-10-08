export type WaiverArtifactErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "BLOCKED"
  | "STALE_PREVIEW"
  | "ATTESTATION_REQUIRED"
  | "INVALID_TRANSITION";

export class WaiverArtifactError extends Error {
  constructor(
    readonly code: WaiverArtifactErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "WaiverArtifactError";
  }
}

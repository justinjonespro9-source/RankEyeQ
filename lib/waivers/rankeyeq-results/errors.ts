export type RankEyeQResultsErrorCode =
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "BLOCKED"
  | "STALE_PREVIEW"
  | "ATTESTATION_REQUIRED";

export class RankEyeQResultsError extends Error {
  constructor(
    readonly code: RankEyeQResultsErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "RankEyeQResultsError";
  }
}

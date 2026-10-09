/** WaiverEyeQ AI participation constants (Stage 4B.3A). Pure. */

export const WAIVEREYEQ_AI_PROMPT_VERSION = "WAIVEREYEQ_AI_V1";
export const WAIVEREYEQ_AI_PARSER_VERSION = "WAIVEREYEQ_AI_PARSER_V1";

/** UTF-8 byte cap for stored responses (database-checked as well). */
export const WAIVER_AI_RESPONSE_MAX_BYTES = 65_536;
export const WAIVER_AI_MODEL_LABEL_MAX = 120;
export const WAIVER_AI_SOURCE_REFERENCE_MAX = 500;
export const WAIVER_AI_NOTE_MAX = 2000;

export const WAIVER_AI_EVIDENCE_SOURCES = [
  "CHAT_EXPORT",
  "CHAT_SHARE_LINK",
  "COPIED_TEXT",
  "SCREENSHOT_TRANSCRIPTION",
  "OTHER",
] as const;

export type WaiverAiEvidenceSource = (typeof WAIVER_AI_EVIDENCE_SOURCES)[number];

export const WAIVER_AI_EVIDENCE_SOURCE_LABELS: Readonly<Record<WaiverAiEvidenceSource, string>> = {
  CHAT_EXPORT: "Chat export (original file)",
  CHAT_SHARE_LINK: "Chat share link",
  COPIED_TEXT: "Copied text",
  SCREENSHOT_TRANSCRIPTION: "Transcribed from a screenshot (not byte-exact)",
  OTHER: "Other",
};

export const WAIVER_AI_EVIDENCE_REVIEW_STATUSES = ["TEXT_CONFIRMED", "NEEDS_FOLLOW_UP", "REJECTED"] as const;

export type WaiverAiEvidenceReviewStatusValue = (typeof WAIVER_AI_EVIDENCE_REVIEW_STATUSES)[number];

/** Label for historical evidence recorded at or after the contest lock. */
export const WAIVER_AI_LATE_EVIDENCE_LABEL = "RECORDED AFTER LOCK — NOT COMPETITIVE";
/** Label for historical evidence recorded before the lock (still never a board). */
export const WAIVER_AI_EVIDENCE_LABEL = "RECORD ONLY — NOT A SUBMISSION";
/** Stated source and generation times are never proof of timing. */
export const WAIVER_AI_STATED_TIME_NOTE = "Admin-stated, unverified — not proof of when the prediction was made";

// ---------------------------------------------------------------------------
// Controlled administrative late entry (Stage 4B.3B).
// ---------------------------------------------------------------------------

/** Designation of an approved late-entered AI board, wherever it is shown. */
export const WAIVER_AI_LATE_ENTRY_LABEL = "LATE-ENTERED — VERIFIED PRE-LOCK";
/** Original provider file cap (database-checked; fits the 1 MB server action body as base64). */
export const WAIVER_AI_ARTIFACT_MAX_BYTES = 524_288;
export const WAIVER_AI_ARTIFACT_NAME_MAX = 255;
/** Base64 length bound for WAIVER_AI_ARTIFACT_MAX_BYTES. */
export const WAIVER_AI_ARTIFACT_BASE64_MAX = Math.ceil(WAIVER_AI_ARTIFACT_MAX_BYTES / 3) * 4;
/** An admin-entered time may differ from the provider message timestamp by at most this much (database-checked). */
export const WAIVER_AI_ARTIFACT_TIME_TOLERANCE_MS = 60_000;
/** Original prompt text cap (database-checked). */
export const WAIVER_AI_PROMPT_TEXT_MAX_BYTES = 65_536;
export const WAIVER_AI_PROMPT_VERSION_MAX = 100;

export const WAIVER_AI_LATE_ENTRY_BASES = ["DATABASE_RECORDED_PRE_LOCK", "PROVIDER_ARTIFACT", "OPERATOR_ATTESTED"] as const;

export type WaiverAiLateEntryBasis = (typeof WAIVER_AI_LATE_ENTRY_BASES)[number];

export const WAIVER_AI_LATE_ENTRY_BASIS_LABELS: Readonly<Record<WaiverAiLateEntryBasis, string>> = {
  DATABASE_RECORDED_PRE_LOCK: "Recorded in RankEyeQ before the lock (database clock)",
  PROVIDER_ARTIFACT: "Original provider file (competitive only with the response message's own timestamp)",
  OPERATOR_ATTESTED: "Administrator statement only (never competitive)",
};

/** How the original prediction time was established; always derived by the database. */
export const WAIVER_AI_LATE_ENTRY_TIMESTAMP_LABELS: Readonly<Record<string, string>> = {
  DATABASE_CLOCK: "Database clock when the evidence was recorded",
  PROVIDER_MESSAGE: "The provider's own timestamp on the message holding the exact response",
  ADMIN_READ_FROM_ARTIFACT: "Admin-read — the provider file carries no message timestamp (record-only)",
  ADMIN_STATED: "Admin-stated, unverified",
};

/** Whether the AI's original prompt is verified to be the current canonical Waivers prompt (database-derived). */
export const WAIVER_AI_PROMPT_EQUIVALENCE_LABELS: Readonly<Record<string, string>> = {
  VERIFIED: "Verified — the preserved original prompt is byte-identical to the canonical prompt",
  UNKNOWN: "Unknown — the original prompt was not preserved",
  DIFFERENT: "Different — the original prompt is not the canonical prompt",
};

// ---------------------------------------------------------------------------
// Admin competitive override (Stage 4B.3C).
// ---------------------------------------------------------------------------

/** Designation of an AI board entered by admin competitive override, wherever it is shown. */
export const WAIVER_AI_COMPETITIVE_OVERRIDE_LABEL = "ADMIN COMPETITIVE OVERRIDE";
/** Database-checked bound for the required override reason. */
export const WAIVER_AI_OVERRIDE_REASON_MAX = 2000;

/** How a competitive AI board entered the contest (derived from its authorization records). */
export const WAIVER_BOARD_ENTRY_BASES = ["ON_TIME", "VERIFIED_LATE_ENTRY", "ADMIN_COMPETITIVE_OVERRIDE"] as const;

export type WaiverBoardEntryBasis = (typeof WAIVER_BOARD_ENTRY_BASES)[number];

export const WAIVER_BOARD_ENTRY_BASIS_LABELS: Readonly<Record<WaiverBoardEntryBasis, string>> = {
  ON_TIME: "Submitted before the lock",
  VERIFIED_LATE_ENTRY: WAIVER_AI_LATE_ENTRY_LABEL,
  ADMIN_COMPETITIVE_OVERRIDE: WAIVER_AI_COMPETITIVE_OVERRIDE_LABEL,
};

/** Database-derived reasons a verification is not eligible (see the 4B.3B migration). */
export const WAIVER_AI_LATE_ENTRY_INELIGIBLE_LABELS: Readonly<Record<string, string>> = {
  OPERATOR_ATTESTED_ONLY: "Administrator statement only — not independently verifiable",
  SNAPSHOT_MISMATCH: "Recorded against a different frozen pool than the contest's pinned snapshot",
  NO_ORIGINAL_TIME: "No original prediction time",
  NOT_BEFORE_LOCK: "The original prediction time is not before the lock",
  BEFORE_SNAPSHOT_FROZEN: "The original prediction time is before the frozen pool existed",
  ARTIFACT_MISSING_RESPONSE: "The provider file does not contain the exact response text",
  NO_PROVIDER_MESSAGE_TIME: "The provider file has no timestamp of its own on the message holding the response",
  TEXT_NOT_CONFIRMED: "The evidence's latest review is not “Text confirmed”",
  AMBIGUOUS_RESPONSES: "Another unrejected response exists for this AI and contest",
};

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

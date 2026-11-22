/**
 * Client-safe labels/constants for Rankings AI historical entry.
 * Must not import prisma, db, or Node-only modules — used by AiParserForm.
 * Badge text matches HISTORICAL_BACKFILL_BADGE in lib/benchmarks/historical-backfill.
 */

export const AI_HISTORICAL_ENTRY_LABEL = "Historical AI Entry";
export const AI_HISTORICAL_BACKFILL_BADGE = "BACKFILLED";

export const AI_HISTORICAL_ACK_TEXT =
  "I confirm these are the AI model's original rankings from the prediction date and time entered.";

export const AI_HISTORICAL_EVIDENCE_TYPES = [
  "PROVIDER_EXPORT",
  "CHAT_TRANSCRIPT",
  "API_LOG",
  "SCREENSHOT",
  "OTHER",
] as const;

export type AiHistoricalEvidenceTypeUi =
  (typeof AI_HISTORICAL_EVIDENCE_TYPES)[number];

export const AI_HISTORICAL_PROVENANCE_CLASSES = [
  "OWNER_REPORTED",
  "VERIFIED",
] as const;

export type AiHistoricalProvenanceClassUi =
  (typeof AI_HISTORICAL_PROVENANCE_CLASSES)[number];

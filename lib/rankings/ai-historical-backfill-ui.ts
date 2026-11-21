/**
 * Client-safe labels/constants for Rankings AI verified historical entry.
 * Must not import prisma, db, or Node-only modules — used by AiParserForm.
 */
import { HISTORICAL_BACKFILL_BADGE } from "@/lib/benchmarks/historical-backfill";

export const AI_HISTORICAL_ENTRY_LABEL = "Verified historical entry";
export const AI_HISTORICAL_BACKFILL_BADGE = HISTORICAL_BACKFILL_BADGE;

export const AI_HISTORICAL_EVIDENCE_TYPES = [
  "PROVIDER_EXPORT",
  "CHAT_TRANSCRIPT",
  "API_LOG",
  "SCREENSHOT",
  "OTHER",
] as const;

export type AiHistoricalEvidenceTypeUi =
  (typeof AI_HISTORICAL_EVIDENCE_TYPES)[number];

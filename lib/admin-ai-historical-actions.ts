"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin } from "@/lib/auth/session";
import {
  AiHistoricalBackfillError,
  AI_HISTORICAL_EVIDENCE_TYPES,
  commitAiHistoricalBoard,
  previewAiHistoricalBoard,
} from "@/lib/rankings/ai-historical-backfill";
import { RATE_LIMITS, rateLimit, rateLimitErrorMessage } from "@/lib/rate-limit";
import { rateLimitKey } from "@/lib/request-ip";
import { parseChicagoDateTimeLocal } from "@/lib/timing/chicago";

function parseTimestamp(raw: string, label: string): Date {
  const value = String(raw ?? "").trim();
  if (!value) throw new AiHistoricalBackfillError(`${label} is required.`);
  const chicago = parseChicagoDateTimeLocal(value);
  if (chicago) return chicago;
  const asDate = new Date(value);
  if (Number.isNaN(asDate.getTime())) {
    throw new AiHistoricalBackfillError(`${label} must be a valid ISO or Chicago datetime.`);
  }
  return asDate;
}

export async function adminPreviewAiHistoricalBoardAction(input: {
  contestId: string;
  profileId: string;
  weekId?: string;
  rankedEntryIds: string[];
  originalPredictionAt: string;
  evidenceType: string;
  evidenceReference: string;
  sourceIdentifier?: string | null;
  rawResponseText?: string | null;
  attestationAccepted: boolean;
}) {
  try {
    const admin = await assertAdmin();
    const limited = rateLimit({
      key: await rateLimitKey("admin-ai-historical", admin.user.id),
      ...RATE_LIMITS.adminParser,
    });
    if (!limited.ok) {
      return { ok: false as const, error: rateLimitErrorMessage(limited) };
    }

    const originalPredictionAt = parseTimestamp(
      input.originalPredictionAt,
      "Original prediction timestamp",
    );
    const preview = await previewAiHistoricalBoard({
      contestId: input.contestId,
      universalProfileId: input.profileId,
      rankedEntryIds: input.rankedEntryIds,
      originalPredictionAt,
      evidenceType: input.evidenceType,
      evidenceReference: input.evidenceReference,
      sourceIdentifier: input.sourceIdentifier,
      rawResponseText: input.rawResponseText,
      attestationAccepted: Boolean(input.attestationAccepted),
    });

    return {
      ok: true as const,
      preview,
      evidenceTypes: AI_HISTORICAL_EVIDENCE_TYPES,
    };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof AiHistoricalBackfillError
          ? error.message
          : "Unable to preview historical AI board",
      code: error instanceof AiHistoricalBackfillError ? error.code : undefined,
    };
  }
}

export async function adminCommitAiHistoricalBoardAction(input: {
  contestId: string;
  profileId: string;
  weekId?: string;
  rankedEntryIds: string[];
  originalPredictionAt: string;
  evidenceType: string;
  evidenceReference: string;
  sourceIdentifier?: string | null;
  rawResponseText?: string | null;
  attestationAccepted: boolean;
  previewFingerprint: string;
}) {
  try {
    const admin = await assertAdmin();
    const limited = rateLimit({
      key: await rateLimitKey("admin-ai-historical", admin.user.id),
      ...RATE_LIMITS.adminParser,
    });
    if (!limited.ok) {
      return { ok: false as const, error: rateLimitErrorMessage(limited) };
    }

    const originalPredictionAt = parseTimestamp(
      input.originalPredictionAt,
      "Original prediction timestamp",
    );
    const result = await commitAiHistoricalBoard({
      contestId: input.contestId,
      universalProfileId: input.profileId,
      adminUserId: admin.user.id,
      rankedEntryIds: input.rankedEntryIds,
      originalPredictionAt,
      evidenceType: input.evidenceType,
      evidenceReference: input.evidenceReference,
      sourceIdentifier: input.sourceIdentifier,
      rawResponseText: input.rawResponseText,
      attestationAccepted: Boolean(input.attestationAccepted),
      previewFingerprint: input.previewFingerprint,
    });

    revalidatePath(`/admin/ai/${input.profileId}/${input.contestId}`);
    revalidatePath(`/admin/contests/${input.contestId}`);
    if (input.weekId) revalidatePath(`/admin?weekId=${input.weekId}`);

    return {
      ok: true as const,
      ...result,
      message:
        "Verified historical AI board locked. Competitive time = original prediction; capture time retained in provenance audit.",
    };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof AiHistoricalBackfillError
          ? error.message
          : "Unable to commit historical AI board",
      code: error instanceof AiHistoricalBackfillError ? error.code : undefined,
    };
  }
}

/**
 * Contest/week status gate for Rankings AI Historical Entry only.
 * Normal AI / human submission locks are unchanged — they still use
 * contestAllowsRankingEdits / rankingEditWindowError.
 *
 * Allowed: OPEN or LOCKED (historical exception after Sunday lock).
 * HOLD: LIVE / GRADING / FINAL contest, or Week COMPLETE / ARCHIVED.
 * BLOCKED: DRAFT, ARCHIVED contest, or any other unsupported status.
 */

import type { ContestStatus } from "@/lib/generated/prisma/client";

export type AiHistoricalContestGateResult = {
  allowed: boolean;
  /** When not allowed: how Preview should classify the issue. */
  outcome: "HOLD" | "BLOCKED" | null;
  reason: string | null;
};

const POST_RANKING_HOLD_STATUSES: ContestStatus[] = [
  "LIVE",
  "GRADING",
  "FINAL",
];

export function evaluateAiHistoricalContestGate(input: {
  contestStatus: ContestStatus | string;
  weekStatus?: string | null;
}): AiHistoricalContestGateResult {
  const contestStatus = String(input.contestStatus);
  const weekStatus = input.weekStatus ? String(input.weekStatus) : null;

  if (contestStatus === "ARCHIVED") {
    return {
      allowed: false,
      outcome: "BLOCKED",
      reason:
        "Contest is ARCHIVED — historical AI entry is not allowed.",
    };
  }

  if (contestStatus === "DRAFT") {
    return {
      allowed: false,
      outcome: "BLOCKED",
      reason:
        "Historical AI entry requires contest status OPEN or LOCKED.",
    };
  }

  if (POST_RANKING_HOLD_STATUSES.includes(contestStatus as ContestStatus)) {
    return {
      allowed: false,
      outcome: "HOLD",
      reason: `Contest is ${contestStatus} — historical AI entry HOLDs without a separate owner-approved post-ranking policy.`,
    };
  }

  if (contestStatus !== "OPEN" && contestStatus !== "LOCKED") {
    return {
      allowed: false,
      outcome: "BLOCKED",
      reason: `Unsupported contest status ${contestStatus} for historical AI entry.`,
    };
  }

  // OPEN or LOCKED — still HOLD if the week has already completed.
  if (weekStatus === "COMPLETE" || weekStatus === "ARCHIVED") {
    return {
      allowed: false,
      outcome: "HOLD",
      reason: `Week is ${weekStatus} — historical AI entry HOLDs without a separate owner-approved policy.`,
    };
  }

  return { allowed: true, outcome: null, reason: null };
}

export function contestAllowsAiHistoricalEntry(
  contestStatus: ContestStatus | string,
  weekStatus?: string | null,
): boolean {
  return evaluateAiHistoricalContestGate({ contestStatus, weekStatus }).allowed;
}

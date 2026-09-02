"use server";

import { revalidatePath } from "next/cache";
import { trackEvent } from "@/lib/analytics";
import { getAuthContext } from "@/lib/auth/session";
import { assertClientProfileMatchesSession } from "@/lib/auth/participation";
import { logServerEvent } from "@/lib/log";
import { RATE_LIMITS, rateLimit, rateLimitErrorMessage } from "@/lib/rate-limit";
import { rateLimitKey } from "@/lib/request-ip";
import {
  saveSubmissionPicks,
  submitRanking,
  SubmissionError,
} from "@/lib/submissions";

function revalidateSubmissionPaths(contestId: string, position?: string) {
  revalidatePath("/rank");
  if (position) revalidatePath(`/rank/${position.toLowerCase()}`);
  revalidatePath(`/admin/contests/${contestId}`);
  revalidatePath("/leaderboards");
  revalidatePath("/results");
  revalidatePath("/consensus");
}

async function resolveParticipantProfileId() {
  const ctx = await getAuthContext();
  if (!ctx) {
    return {
      ok: false as const,
      error: "Sign in to save rankings",
      code: "SIGNED_OUT" as const,
    };
  }
  if (!ctx.universalProfile) {
    return {
      ok: false as const,
      error: "Finish profile setup to participate",
      code: "NEEDS_SETUP" as const,
    };
  }
  if (ctx.universalProfile.profileType !== "HUMAN") {
    return {
      ok: false as const,
      error: "AI profiles cannot submit from the ranking workspace",
      code: "FORBIDDEN" as const,
    };
  }
  if (ctx.universalProfile.status === "SUSPENDED") {
    return {
      ok: false as const,
      error: "This profile is suspended and cannot submit rankings",
      code: "SUSPENDED" as const,
    };
  }
  return {
    ok: true as const,
    universalProfileId: ctx.universalProfile.id,
  };
}

export async function saveDraftAction(input: {
  contestId: string;
  rankedEntryIds: (string | null)[];
  position: string;
  /** Ignored — profile is derived from the authenticated session. */
  universalProfileId?: string;
}) {
  const participant = await resolveParticipantProfileId();
  if (!participant.ok) {
    return { ok: false as const, error: participant.error, code: participant.code };
  }

  const spoof = assertClientProfileMatchesSession(
    participant.universalProfileId,
    input.universalProfileId,
  );
  if (!spoof.ok) {
    logServerEvent("auth.profile_spoof", { action: "draft_save" }, "warn");
    return { ok: false as const, error: spoof.error, code: "FORBIDDEN" as const };
  }

  const limited = rateLimit({
    key: await rateLimitKey("draft", participant.universalProfileId),
    ...RATE_LIMITS.draftSave,
  });
  if (!limited.ok) {
    return { ok: false as const, error: rateLimitErrorMessage(limited) };
  }

  try {
    const submission = await saveSubmissionPicks({
      contestId: input.contestId,
      universalProfileId: participant.universalProfileId,
      rankedEntryIds: input.rankedEntryIds,
      requireComplete: false,
    });
    revalidateSubmissionPaths(input.contestId, input.position);
    if (submission.status === "DRAFT") {
      trackEvent("ranking_started", { position: input.position });
    }
    return {
      ok: true as const,
      status: submission.status,
      savedAt: submission.updatedAt.toISOString(),
      lockedEntryIds: submission.picks
        .filter((pick) => pick.slotLocked)
        .map((pick) => pick.rankableEntryId),
    };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof SubmissionError
          ? error.message
          : "Unable to save draft",
    };
  }
}

export async function submitRankingsAction(input: {
  contestId: string;
  rankedEntryIds: (string | null)[];
  position: string;
  /** Ignored — profile is derived from the authenticated session. */
  universalProfileId?: string;
}) {
  const participant = await resolveParticipantProfileId();
  if (!participant.ok) {
    return { ok: false as const, error: participant.error, code: participant.code };
  }

  const spoof = assertClientProfileMatchesSession(
    participant.universalProfileId,
    input.universalProfileId,
  );
  if (!spoof.ok) {
    logServerEvent("auth.profile_spoof", { action: "submit" }, "warn");
    return { ok: false as const, error: spoof.error, code: "FORBIDDEN" as const };
  }

  const limited = rateLimit({
    key: await rateLimitKey("submit", participant.universalProfileId),
    ...RATE_LIMITS.submit,
  });
  if (!limited.ok) {
    return { ok: false as const, error: rateLimitErrorMessage(limited) };
  }

  try {
    const submission = await submitRanking({
      contestId: input.contestId,
      universalProfileId: participant.universalProfileId,
      rankedEntryIds: input.rankedEntryIds,
    });
    revalidateSubmissionPaths(input.contestId, input.position);
    trackEvent("ranking_submitted", { position: input.position });
    return {
      ok: true as const,
      status: submission.status,
      submittedAt: submission.submittedAt?.toISOString() ?? null,
      lockedEntryIds: submission.picks
        .filter((pick) => pick.slotLocked)
        .map((pick) => pick.rankableEntryId),
    };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof SubmissionError
          ? error.message
          : "Unable to submit rankings",
    };
  }
}

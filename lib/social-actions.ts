"use server";

import { revalidatePath } from "next/cache";
import { trackEvent } from "@/lib/analytics";
import { getAuthContext, requireUniversalProfile } from "@/lib/auth/session";
import { RATE_LIMITS, rateLimit, rateLimitErrorMessage } from "@/lib/rate-limit";
import { rateLimitKey } from "@/lib/request-ip";
import type { BoardRevealPreference } from "@/lib/generated/prisma/client";
import {
  CreatorError,
  setCreatorOptIn,
  setDefaultRevealPreference,
  setSubmissionRevealPreference,
} from "@/lib/social/creator";
import {
  FollowError,
  followFromSession,
  unfollowFromSession,
} from "@/lib/social/follows";
import { assertUserCannotWriteLedger } from "@/lib/social/ledger";

function revalidateSocial(username?: string) {
  revalidatePath("/following");
  revalidatePath("/rankers");
  revalidatePath("/leaderboards");
  revalidatePath("/creator");
  revalidatePath("/account");
  if (username) revalidatePath(`/profile/${username}`);
}

export async function followProfileAction(followedProfileId: string) {
  const ctx = await getAuthContext();
  const limited = rateLimit({
    key: await rateLimitKey("follow", ctx?.universalProfile?.id),
    ...RATE_LIMITS.follow,
  });
  if (!limited.ok) {
    return { ok: false as const, error: rateLimitErrorMessage(limited) };
  }
  try {
    await followFromSession({
      signedIn: Boolean(ctx),
      followerProfileId: ctx?.universalProfile?.id ?? null,
      followedProfileId,
    });
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof FollowError ? error.message : "Unable to follow",
    };
  }

  revalidateSocial();
  trackEvent("profile_followed");
  return { ok: true as const };
}

export async function unfollowProfileAction(followedProfileId: string) {
  const ctx = await getAuthContext();
  try {
    await unfollowFromSession({
      signedIn: Boolean(ctx),
      followerProfileId: ctx?.universalProfile?.id ?? null,
      followedProfileId,
    });
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof FollowError ? error.message : "Unable to unfollow",
    };
  }
  revalidateSocial();
  return { ok: true as const };
}

export async function setCreatorOptInAction(enabled: boolean) {
  const { universalProfile } = await requireUniversalProfile();
  try {
    await setCreatorOptIn({
      profileId: universalProfile.id,
      enabled,
    });
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof CreatorError
          ? error.message
          : "Unable to update creator mode",
    };
  }
  revalidateSocial(universalProfile.username);
  if (enabled) trackEvent("creator_enabled");
  return { ok: true as const };
}

export async function setDefaultRevealPreferenceAction(
  preference: BoardRevealPreference,
) {
  const { universalProfile } = await requireUniversalProfile();
  try {
    await setDefaultRevealPreference({
      profileId: universalProfile.id,
      preference,
    });
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof CreatorError
          ? error.message
          : "Unable to update reveal preference",
    };
  }
  revalidateSocial(universalProfile.username);
  return { ok: true as const };
}

export async function setBoardRevealPreferenceAction(input: {
  contestId: string;
  preference: BoardRevealPreference;
}) {
  const { universalProfile } = await requireUniversalProfile();
  try {
    await setSubmissionRevealPreference({
      profileId: universalProfile.id,
      contestId: input.contestId,
      preference: input.preference,
    });
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof CreatorError
          ? error.message
          : "Unable to update board reveal preference",
    };
  }
  revalidateSocial(universalProfile.username);
  return { ok: true as const };
}

/** Users may not create ledger entries. */
export async function createUserLedgerEntryAction() {
  assertUserCannotWriteLedger();
}

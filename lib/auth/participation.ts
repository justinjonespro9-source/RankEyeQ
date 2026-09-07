import type { ProfileType } from "@/lib/generated/prisma/client";

export type ParticipationState = "signed-out" | "needs-setup" | "ready";

/** HUMAN and claimed/verified CREATOR accounts may participate when signed in. */
export function canAuthenticateAsParticipant(
  profileType: ProfileType | null | undefined,
): boolean {
  return profileType === "HUMAN" || profileType === "CREATOR";
}

export function resolveParticipationState(input: {
  signedIn: boolean;
  universalProfileId: string | null;
  profileType?: ProfileType | null;
}): ParticipationState {
  if (!input.signedIn) return "signed-out";
  if (!input.universalProfileId) return "needs-setup";
  if (
    input.profileType &&
    !canAuthenticateAsParticipant(input.profileType)
  ) {
    return "needs-setup";
  }
  return "ready";
}

/** Reject client-supplied profile IDs that don't match the session profile. */
export function assertClientProfileMatchesSession(
  sessionProfileId: string,
  clientProfileId: string | undefined | null,
): { ok: true } | { ok: false; error: string } {
  if (clientProfileId && clientProfileId !== sessionProfileId) {
    return { ok: false, error: "Cannot submit as another profile" };
  }
  return { ok: true };
}

export function isAiProfileWithoutAuth(profileType: ProfileType) {
  return profileType === "AI";
}

export function isBenchmarkProfileWithoutAuth(profileType: ProfileType) {
  return profileType === "BENCHMARK";
}

/**
 * CREATOR class can exist as a tracked (imported) identity without an auth User.
 * Verified creators may also sign in — use canAuthenticateAsParticipant for that.
 */
export function isCreatorProfileWithoutAuth(profileType: ProfileType) {
  return profileType === "CREATOR";
}

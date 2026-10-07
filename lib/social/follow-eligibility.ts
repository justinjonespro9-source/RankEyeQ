import type { ProfileStatus, ProfileType } from "@/lib/generated/prisma/client";
import { EXPERT_SOURCE_KIND } from "@/lib/expert-identity";

/**
 * One follow graph for every discipline (Rankings and Waivers). A signed-in
 * human may follow identifiable competitors: Humans, Creators, AI, and
 * Experts whose source is an individual analyst. Publisher / site consensus
 * boards, legacy publisher shells, and unclassified benchmark profiles are
 * aggregate or unidentified sources and are never followable.
 */
export function profileCanFollow(follower: {
  profileType: ProfileType;
  status: ProfileStatus;
}): boolean {
  return follower.profileType === "HUMAN" && follower.status !== "SUSPENDED";
}

export type FollowTargetIdentity = {
  profileType: ProfileType;
  /** ExpertSourceProfile.sourceKind; null when the profile has no source row. */
  expertSourceKind: string | null | undefined;
};

export function profileIsIdentifiableCompetitor(target: FollowTargetIdentity): boolean {
  if (target.profileType !== "BENCHMARK") return true;
  return target.expertSourceKind === EXPERT_SOURCE_KIND.ANALYST;
}

export function profileCanGainFollowers(
  target: FollowTargetIdentity & { status: ProfileStatus },
): boolean {
  return target.status !== "SUSPENDED" && profileIsIdentifiableCompetitor(target);
}

export type FollowViewer = {
  signedIn: boolean;
  profileId: string | null;
  profileType: ProfileType | null;
  status?: ProfileStatus | null;
};

export type FollowControl = "hidden" | "sign-in" | "follow";

/** Which Follow control a profile row or header shows to this viewer. */
export function followControlFor(input: {
  viewer: FollowViewer;
  target: FollowTargetIdentity & { profileId: string; status?: ProfileStatus | null };
}): FollowControl {
  const { viewer, target } = input;
  if (viewer.profileId != null && viewer.profileId === target.profileId) return "hidden";
  if (!profileCanGainFollowers({ ...target, status: target.status ?? "ACTIVE" })) return "hidden";
  if (!viewer.signedIn) return "sign-in";
  if (!viewer.profileId || !viewer.profileType) return "hidden";
  return profileCanFollow({ profileType: viewer.profileType, status: viewer.status ?? "ACTIVE" })
    ? "follow"
    : "hidden";
}

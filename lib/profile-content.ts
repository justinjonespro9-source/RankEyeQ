/**
 * Owner-controlled presentation fields for claimed Expert / Creator profiles.
 * Competitive records are never writable through this module.
 */
import { prisma } from "@/lib/db";
import { ProfileLinkError } from "@/lib/auth/profile-link";
import {
  validateDisplayName,
  validateUsername,
} from "@/lib/username";
import { validatePublicHttpUrl } from "@/lib/creator-verification-shared";
import type { ProfileType } from "@/lib/generated/prisma/client";

const MAX_HEADLINE = 120;
const MAX_AFFILIATION = 120;
const MAX_BIO = 1000;
const MAX_FEATURED_TITLE = 160;

export const PROFILE_CONTENT_URL_FIELDS = [
  "websiteUrl",
  "xUrl",
  "youtubeUrl",
  "instagramUrl",
  "tiktokUrl",
  "podcastUrl",
  "featuredLinkUrl",
] as const;

export type ProfileContentUrlField = (typeof PROFILE_CONTENT_URL_FIELDS)[number];

export type ProfileContentUpdateInput = {
  userId: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string | null;
  headline?: string | null;
  bio?: string | null;
  affiliation?: string | null;
  websiteUrl?: string | null;
  xUrl?: string | null;
  youtubeUrl?: string | null;
  instagramUrl?: string | null;
  tiktokUrl?: string | null;
  podcastUrl?: string | null;
  featuredLinkTitle?: string | null;
  featuredLinkUrl?: string | null;
};

function optionalText(
  value: string | null | undefined,
  max: number,
  label: string,
): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) {
    throw new ProfileLinkError(`${label} is too long.`);
  }
  return trimmed;
}

function optionalUrl(
  value: string | null | undefined,
  label: string,
): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const checked = validatePublicHttpUrl(trimmed, label);
  if (!checked.ok) throw new ProfileLinkError(checked.error);
  return checked.url;
}

/** Public profile URL must stay stable for tracked Expert / linked-claim profiles. */
export function isUsernameLocked(profile: {
  profileType: ProfileType;
  ownershipVerifiedAt?: Date | null;
}): boolean {
  return profile.profileType === "BENCHMARK" || Boolean(profile.ownershipVerifiedAt);
}

export function canOwnerEditProfileContent(
  profileType: ProfileType | null | undefined,
): boolean {
  return (
    profileType === "HUMAN" ||
    profileType === "CREATOR" ||
    profileType === "BENCHMARK"
  );
}

/**
 * Explicit allowlist update for owned presentation fields.
 * Never mutates profileType, scores, submissions, or snapshot provenance.
 */
export async function updateOwnedProfileContent(
  input: ProfileContentUpdateInput,
) {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    include: { universalProfile: true },
  });
  if (!user?.universalProfile) {
    throw new ProfileLinkError("Complete profile setup first.");
  }
  const profile = user.universalProfile;
  if (!canOwnerEditProfileContent(profile.profileType)) {
    throw new ProfileLinkError(
      "AI profiles are admin-managed and cannot edit presentation fields.",
    );
  }

  const data: Record<string, string | null> = {};

  if (input.username !== undefined) {
    const usernameResult = validateUsername(input.username);
    if (!usernameResult.ok) throw new ProfileLinkError(usernameResult.error);
    if (usernameResult.username !== profile.username) {
      // Tracked Expert / linked-claim profiles keep their public URL stable.
      if (isUsernameLocked(profile)) {
        throw new ProfileLinkError(
          "Username is locked for claimed Expert/Creator profiles to keep the public profile URL stable.",
        );
      }
      const taken = await prisma.universalProfile.findUnique({
        where: { username: usernameResult.username },
      });
      if (taken && taken.id !== profile.id) {
        throw new ProfileLinkError("That username is already taken.");
      }
    }
    data.username = usernameResult.username;
  }

  if (input.displayName !== undefined) {
    const displayResult = validateDisplayName(input.displayName);
    if (!displayResult.ok) throw new ProfileLinkError(displayResult.error);
    data.displayName = displayResult.username;
  }

  if (input.avatarUrl !== undefined) {
    data.avatarUrl = input.avatarUrl?.trim() || null;
  }

  if (input.headline !== undefined) {
    data.headline = optionalText(input.headline, MAX_HEADLINE, "Headline");
  }
  if (input.bio !== undefined) {
    data.bio = optionalText(input.bio, MAX_BIO, "Bio");
  }
  if (input.affiliation !== undefined) {
    data.affiliation = optionalText(
      input.affiliation,
      MAX_AFFILIATION,
      "Affiliation",
    );
  }

  if (input.websiteUrl !== undefined) {
    data.websiteUrl = optionalUrl(input.websiteUrl, "Website");
  }
  if (input.xUrl !== undefined) {
    data.xUrl = optionalUrl(input.xUrl, "X");
  }
  if (input.youtubeUrl !== undefined) {
    data.youtubeUrl = optionalUrl(input.youtubeUrl, "YouTube");
  }
  if (input.instagramUrl !== undefined) {
    data.instagramUrl = optionalUrl(input.instagramUrl, "Instagram");
  }
  if (input.tiktokUrl !== undefined) {
    data.tiktokUrl = optionalUrl(input.tiktokUrl, "TikTok");
  }
  if (input.podcastUrl !== undefined) {
    data.podcastUrl = optionalUrl(input.podcastUrl, "Podcast");
  }
  if (input.featuredLinkUrl !== undefined) {
    data.featuredLinkUrl = optionalUrl(input.featuredLinkUrl, "Featured link");
  }
  if (input.featuredLinkTitle !== undefined) {
    data.featuredLinkTitle = optionalText(
      input.featuredLinkTitle,
      MAX_FEATURED_TITLE,
      "Featured title",
    );
  }

  // Featured CTA requires both title + URL when either is set after merge.
  const nextFeaturedUrl =
    data.featuredLinkUrl !== undefined
      ? data.featuredLinkUrl
      : profile.featuredLinkUrl;
  const nextFeaturedTitle =
    data.featuredLinkTitle !== undefined
      ? data.featuredLinkTitle
      : profile.featuredLinkTitle;
  if (nextFeaturedUrl && !nextFeaturedTitle) {
    throw new ProfileLinkError(
      "Featured link needs a title when a URL is set.",
    );
  }
  if (nextFeaturedTitle && !nextFeaturedUrl) {
    throw new ProfileLinkError(
      "Featured title needs a URL when a title is set.",
    );
  }

  return prisma.universalProfile.update({
    where: { id: profile.id },
    data,
  });
}

export {
  buildPublicSocialLinks,
  destinationHostFromUrl,
  resolveFeaturedLink,
  safePublicHref,
  type PublicSocialLink,
} from "@/lib/profile-links";

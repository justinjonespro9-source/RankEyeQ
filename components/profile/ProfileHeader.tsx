import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { ProfileAvatar } from "@/components/ui/ProfileAvatar";
import { CreatorBadge } from "@/components/social/CreatorBadge";
import { FollowButton } from "@/components/social/FollowButton";
import {
  ProfileFeaturedContent,
  ProfileSocialLinks,
} from "@/components/profile/ProfileOutboundLinks";
import { ProfileClaimCta } from "@/components/profile/ProfileClaimCta";
import { benchmarkAffiliationDisclaimer } from "@/lib/benchmark-sources";
import {
  formatCreatorAffiliationBadge,
  formatCreatorPrimaryName,
} from "@/lib/creator-identity";
import {
  formatExpertAffiliationBadge,
  formatExpertPrimaryName,
} from "@/lib/expert-identity";
import {
  buildPublicSocialLinks,
  resolveFeaturedLink,
} from "@/lib/profile-links";
import type { UniversalProfile } from "@/types/user";
import type { ProfileType } from "@/lib/generated/prisma/client";

export function ProfileHeader({
  profile,
  profileId,
  isOwner = false,
  signedIn = false,
  followerCount = 0,
  followingCount = 0,
  follow,
  creator,
  scoringDisclosure = null,
  expertSourceKind = null,
  showClaimCta = false,
}: {
  profile: UniversalProfile;
  profileId: string;
  profileType: ProfileType;
  isOwner?: boolean;
  signedIn?: boolean;
  followerCount?: number;
  followingCount?: number;
  follow?: {
    signedIn: boolean;
    viewerIsFollowing: boolean;
    canFollow: boolean;
    targetProfileId: string;
  };
  creator?: {
    enabled: boolean;
    qualified: boolean;
  };
  /** Benchmark scoring disclosure (publisher consensus / expert sources). */
  scoringDisclosure?: string | null;
  expertSourceKind?: string | null;
  showClaimCta?: boolean;
}) {
  const expertPrimary = profile.isBenchmark
    ? formatExpertPrimaryName({
        displayName: profile.displayName,
        analystName: profile.expertAnalystName,
        publicationName: profile.expertPublicationName,
        sourceKind: expertSourceKind,
      })
    : profile.isCreator
      ? formatCreatorPrimaryName({
          displayName: profile.displayName,
          personName: profile.creatorPersonName,
          brandName: profile.creatorBrandName,
        })
      : profile.displayName;
  const expertBadge = profile.isBenchmark
    ? formatExpertAffiliationBadge({
        displayName: profile.displayName,
        analystName: profile.expertAnalystName,
        publicationName: profile.expertPublicationName,
        sourceKind:
          expertSourceKind ??
          (profile.expertAnalystName ? "ANALYST" : "PUBLISHER"),
      })
    : null;
  const creatorCompetitorBadge = profile.isCreator
    ? formatCreatorAffiliationBadge({
        displayName: profile.displayName,
        personName: profile.creatorPersonName,
        brandName: profile.creatorBrandName,
      })
    : null;
  const disclaimerSource =
    profile.expertPublicationName?.trim() || profile.displayName;
  const isAuthFree = Boolean(profile.isBenchmark || profile.isCreator);
  const ownershipVerified = Boolean(
    profile.ownershipVerified || profile.creatorVerified,
  );
  const affiliation =
    profile.affiliation?.trim() ||
    (profile.isBenchmark ? profile.expertPublicationName : null) ||
    (profile.isCreator ? profile.creatorBrandName : null);
  const socialLinks = buildPublicSocialLinks({
    websiteUrl: profile.websiteUrl,
    xUrl: profile.xUrl,
    youtubeUrl: profile.youtubeUrl,
    instagramUrl: profile.instagramUrl,
    tiktokUrl: profile.tiktokUrl,
    podcastUrl: profile.podcastUrl,
  });
  const showOwnerBio = Boolean(profile.bio?.trim());
  const featured = resolveFeaturedLink({
    featuredLinkTitle: profile.featuredLinkTitle,
    featuredLinkUrl: profile.featuredLinkUrl,
  });
  const claimable = showClaimCta;
  const showFollow = Boolean(follow && !isOwner);
  const identityBadges = (
    <>
      <Badge
        tone={
          profile.isBenchmark || profile.isCreator
            ? "warning"
            : profile.isBot
              ? "neutral"
              : "success"
        }
      >
        {profile.isBenchmark
          ? (expertBadge ?? "EXPERT")
          : profile.isCreator
            ? (creatorCompetitorBadge ?? "CREATOR")
            : profile.isBot
              ? `AI · ${expertPrimary}`
              : "PUBLIC"}
      </Badge>
      {ownershipVerified ? (
        <Badge tone="accent" className="text-[10px] sm:text-xs">
          Verified
        </Badge>
      ) : null}
      {!isAuthFree ? (
        <CreatorBadge
          enabled={creator?.enabled}
          qualified={creator?.qualified}
        />
      ) : null}
      {profile.suspended ? (
        <Badge tone="warning">Unavailable</Badge>
      ) : null}
    </>
  );

  return (
    <header className="rounded-lg border border-border bg-surface-elevated px-5 py-6 sm:px-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <ProfileAvatar
            name={expertPrimary}
            src={profile.avatarUrl}
            size="lg"
          />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-ink">
              Universal profile
            </p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              {expertPrimary}
            </h1>
            <p className="mt-1 text-muted">@{profile.username}</p>
            {/* Mobile: keep competitive identity above owner-supplied presentation. */}
            <div className="mt-2 flex flex-wrap gap-2 sm:hidden">
              {identityBadges}
            </div>
            {profile.headline?.trim() ? (
              <p className="mt-2 text-sm font-medium text-ink">
                {profile.headline.trim()}
                {affiliation ? (
                  <span className="font-normal text-muted">
                    {" "}
                    · {affiliation}
                  </span>
                ) : null}
              </p>
            ) : affiliation ? (
              <p className="mt-2 text-sm text-muted">{affiliation}</p>
            ) : null}
            {showOwnerBio ? (
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
                {profile.bio}
              </p>
            ) : null}
            <ProfileSocialLinks profileId={profileId} links={socialLinks} />
            {featured ? (
              <ProfileFeaturedContent
                profileId={profileId}
                title={featured.title}
                url={featured.url}
              />
            ) : null}
            {profile.isBenchmark && !ownershipVerified ? (
              <div className="mt-3 max-w-2xl space-y-2 text-sm leading-relaxed text-muted">
                <p>{benchmarkAffiliationDisclaimer(disclaimerSource)}</p>
                {scoringDisclosure ? <p>{scoringDisclosure}</p> : null}
              </div>
            ) : profile.isCreator && !ownershipVerified ? (
              <div className="mt-3 space-y-2">
                <p className="max-w-2xl text-sm leading-relaxed text-muted">
                  Tracked creator profiles may include rankings publicly posted
                  before kickoff. Tracking does not imply endorsement or
                  partnership.
                </p>
              </div>
            ) : !isAuthFree ? (
              <p className="mt-3 text-sm text-muted">
                <strong className="font-display text-ink">{followerCount}</strong>{" "}
                followers ·{" "}
                <strong className="font-display text-ink">{followingCount}</strong>{" "}
                following
              </p>
            ) : null}
            {isOwner ? (
              <Link
                href="/account"
                className="mt-4 inline-block text-sm font-medium text-accent-ink hover:underline"
              >
                Edit profile
              </Link>
            ) : null}
            {claimable ? (
              <ProfileClaimCta
                displayName={expertPrimary}
                username={profile.username}
                signedIn={signedIn}
              />
            ) : null}
          </div>
        </div>
        <div
          className={`${showFollow ? "flex" : "hidden sm:flex"} flex-col items-end gap-2`}
        >
          <div className="hidden flex-wrap justify-end gap-2 sm:flex">
            {identityBadges}
          </div>
          {showFollow && follow ? (
            <FollowButton
              targetProfileId={follow.targetProfileId}
              initialFollowing={follow.viewerIsFollowing}
              signedIn={follow.signedIn}
              canFollow={follow.canFollow}
            />
          ) : null}
        </div>
      </div>
    </header>
  );
}

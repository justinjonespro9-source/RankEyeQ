import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { ProfileAvatar } from "@/components/ui/ProfileAvatar";
import { CreatorBadge } from "@/components/social/CreatorBadge";
import { FollowButton } from "@/components/social/FollowButton";
import { BadgeRack } from "@/components/badges/BadgeRack";
import { benchmarkAffiliationDisclaimer } from "@/lib/benchmark-sources";
import {
  formatCreatorAffiliationBadge,
  formatCreatorPrimaryName,
} from "@/lib/creator-identity";
import {
  formatExpertAffiliationBadge,
  formatExpertPrimaryName,
} from "@/lib/expert-identity";
import type { EarnedBadge } from "@/lib/badges/types";
import type { UniversalProfile } from "@/types/user";

export function ProfileHeader({
  profile,
  isOwner = false,
  followerCount = 0,
  followingCount = 0,
  follow,
  creator,
  badges = [],
}: {
  profile: UniversalProfile;
  isOwner?: boolean;
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
  badges?: EarnedBadge[];
}) {
  const expertPrimary = profile.isBenchmark
    ? formatExpertPrimaryName({
        displayName: profile.displayName,
        analystName: profile.expertAnalystName,
        publicationName: profile.expertPublicationName,
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
        sourceKind: profile.expertAnalystName ? "ANALYST" : "PUBLISHER",
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
            {profile.isBenchmark &&
            profile.expertPublicationName &&
            profile.expertAnalystName ? (
              <p className="mt-1 text-sm text-muted">
                {profile.expertPublicationName}
              </p>
            ) : null}
            {profile.isCreator && profile.creatorBrandName ? (
              <p className="mt-1 text-sm text-muted">{profile.creatorBrandName}</p>
            ) : null}
            {profile.isBenchmark ? (
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
                {benchmarkAffiliationDisclaimer(disclaimerSource)}
              </p>
            ) : profile.isCreator ? (
              <div className="mt-3 space-y-2">
                {profile.creatorVerified ? (
                  <p className="inline-flex items-center rounded-md border border-accent/40 bg-accent-soft/60 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-accent-ink">
                    Verified Creator
                  </p>
                ) : null}
                <p className="max-w-2xl text-sm leading-relaxed text-muted">
                  {profile.creatorVerified
                    ? "Verified Creator on RankEyeQ. Brand affiliation is shown for context and is not an endorsement or partnership."
                    : "Tracked creator profiles may include rankings publicly posted before kickoff. Tracking does not imply endorsement or partnership."}
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">
                <strong className="font-display text-ink">{followerCount}</strong>{" "}
                followers ·{" "}
                <strong className="font-display text-ink">{followingCount}</strong>{" "}
                following
              </p>
            )}
            {profile.bio && !isAuthFree ? (
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
                {profile.bio}
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
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap justify-end gap-2">
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
            {profile.isCreator && profile.creatorVerified ? (
              <Badge tone="accent" className="text-[10px] sm:text-xs">
                Verified Creator
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
          </div>
          {follow && !isOwner && !isAuthFree ? (
            <FollowButton
              targetProfileId={follow.targetProfileId}
              initialFollowing={follow.viewerIsFollowing}
              signedIn={follow.signedIn}
              canFollow={follow.canFollow}
            />
          ) : null}
        </div>
      </div>

      <BadgeRack
        badges={badges}
        title="RankEyeQ badges"
        emptyLabel="Badges unlock with qualified season EYEQ, Exact Hits, Podium Calls, and hot streaks."
        size="sm"
      />
    </header>
  );
}

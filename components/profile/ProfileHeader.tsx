import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { CreatorBadge } from "@/components/social/CreatorBadge";
import { FollowButton } from "@/components/social/FollowButton";
import { benchmarkAffiliationDisclaimer } from "@/lib/benchmark-sources";
import type { UniversalProfile } from "@/types/user";

export function ProfileHeader({
  profile,
  isOwner = false,
  followerCount = 0,
  followingCount = 0,
  follow,
  creator,
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
}) {
  return (
    <header className="rounded-lg border border-border bg-surface-elevated px-5 py-6 sm:px-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
            Universal profile
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            {profile.displayName}
          </h1>
          <p className="mt-1 text-muted">@{profile.username}</p>
          {profile.isBenchmark ? (
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
              {benchmarkAffiliationDisclaimer(profile.displayName)}
            </p>
          ) : (
            <p className="mt-3 text-sm text-muted">
              <strong className="font-display text-ink">{followerCount}</strong>{" "}
              followers ·{" "}
              <strong className="font-display text-ink">{followingCount}</strong>{" "}
              following
            </p>
          )}
          {profile.bio && !profile.isBenchmark ? (
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
              {profile.bio}
            </p>
          ) : null}
          {isOwner ? (
            <Link
              href="/account"
              className="mt-4 inline-block text-sm font-medium text-accent hover:underline"
            >
              Edit profile
            </Link>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap justify-end gap-2">
            <Badge
              tone={
                profile.isBenchmark
                  ? "warning"
                  : profile.isBot
                    ? "neutral"
                    : "success"
              }
            >
              {profile.isBenchmark
                ? "Independent Benchmark"
                : profile.isBot
                  ? "AI Competitor"
                  : "Human"}
            </Badge>
            {!profile.isBenchmark ? (
              <CreatorBadge
                enabled={creator?.enabled}
                qualified={creator?.qualified}
              />
            ) : null}
            {profile.suspended ? (
              <Badge tone="warning">Unavailable</Badge>
            ) : null}
          </div>
          {follow && !isOwner && !profile.isBenchmark ? (
            <FollowButton
              targetProfileId={follow.targetProfileId}
              initialFollowing={follow.viewerIsFollowing}
              signedIn={follow.signedIn}
              canFollow={follow.canFollow}
            />
          ) : null}
          <p className="text-xs text-muted">
            {profile.universalUserId
              ? `universalUserId: ${profile.universalUserId}`
              : "Not linked to a universal ID yet"}
          </p>
        </div>
      </div>
    </header>
  );
}

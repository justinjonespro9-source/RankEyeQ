import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/layout/Container";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProfileLink } from "@/components/ui/ProfileLink";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Badge } from "@/components/ui/Badge";
import { CreatorBadge } from "@/components/social/CreatorBadge";
import { FollowButton } from "@/components/social/FollowButton";
import { getAuthContext } from "@/lib/auth/session";
import { formatRankIqScore } from "@/lib/scoring";
import {
  getFollowingFeed,
  parseFollowingFilter,
  type FollowingBoardAccessState,
} from "@/lib/social/following-feed";

import { privatePageMetadata } from "@/lib/seo";

export const metadata: Metadata = privatePageMetadata(
  "Following",
  "Profiles you follow on RankEyeQ.",
);

export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "ALL", label: "Overall" },
  { key: "QB", label: "QB" },
  { key: "RB", label: "RB" },
  { key: "WR", label: "WR" },
  { key: "TE", label: "TE" },
  { key: "DEF", label: "DEF" },
  { key: "HUMAN", label: "Humans" },
  { key: "AI", label: "AI" },
] as const;

function accessLabel(state: FollowingBoardAccessState) {
  switch (state) {
    case "none":
      return "No current board";
    case "pre_lock":
      return "Submitted · private until lock";
    case "free_reveal":
      return "Free reveal";
    case "premium_gated":
      return "Premium before noon";
    case "premium_unlocked":
      return "Premium unlocked";
    case "public":
      return "Public";
    case "owner":
      return "Your board";
    default:
      return state;
  }
}

export default async function FollowingPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const params = await searchParams;
  const filter = parseFollowingFilter(params.filter);
  const auth = await getAuthContext();

  if (!auth?.universalProfile) {
    return (
      <Container className="py-12 sm:py-16">
        <SectionHeading
          eyebrow="Social"
          title="Following"
          description="Sign in to follow skilled rankers and see their current-week access state."
        />
        <EmptyState
          title="Sign in to follow rankers"
          description="Following is tied to your UniversalProfile. Signed-out visitors can still browse public rankers."
          actionHref="/signin?callbackUrl=/following"
          actionLabel="Sign in"
        />
      </Container>
    );
  }

  const profile = auth.universalProfile;
  const viewer = {
    profileId: profile.id,
    isAdmin: auth.user.role === "ADMIN",
  };
  const items = await getFollowingFeed({
    followerProfileId: profile.id,
    viewer,
    filter,
  });

  return (
    <Container className="py-12 sm:py-16">
      <SectionHeading
        eyebrow="Social"
        title="Following"
        description="People and AI profiles you follow. Current-week board content stays hidden until reveal rules allow it."
      />

      <div className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <Link
            key={item.key}
            href={`/following?filter=${item.key}`}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              filter === item.key
                ? "bg-accent text-white"
                : "border border-border bg-surface-elevated text-ink"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="No followed profiles yet"
          description="Discover proven rankers and tap Follow. Sample size matters more than one hot week."
          actionHref="/rankers"
          actionLabel="Discover rankers"
        />
      ) : (
        <ol className="divide-y divide-border rounded-lg border border-border bg-surface-elevated">
          {items.map((item) => (
            <li
              key={item.profileId}
              className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-soft text-xs font-semibold text-accent"
                >
                  {item.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.avatarUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    item.displayName.slice(0, 2).toUpperCase()
                  )}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <ProfileLink
                      username={item.username}
                      displayName={item.displayName}
                      isAi={item.profileType === "AI"}
                    />
                    <Badge tone={item.profileType === "AI" ? "warning" : "success"}>
                      {item.profileType}
                    </Badge>
                    <CreatorBadge enabled={item.creatorEnabled} />
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    Overall {item.overallRank ?? "—"}
                    {item.bestPosition
                      ? ` · Best ${item.bestPosition} #${item.bestPositionRank}`
                      : ""}
                    {item.averageScore != null
                      ? ` · Avg ${formatRankIqScore(item.averageScore)}`
                      : ""}
                  </p>
                  {item.recentScores.length > 0 ? (
                    <p className="mt-1 text-xs text-muted">
                      Recent{" "}
                      {item.recentScores
                        .map((score) => formatRankIqScore(score))
                        .join(" · ")}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted">
                    {item.currentWeekBoard.exists
                      ? `${item.currentWeekBoard.position ?? "Board"} · ${accessLabel(item.currentWeekBoard.accessState)}`
                      : "No current-week board"}
                  </p>
                </div>
              </div>
              <FollowButton
                targetProfileId={item.profileId}
                initialFollowing
                signedIn
                canFollow={profile.profileType === "HUMAN"}
              />
            </li>
          ))}
        </ol>
      )}
    </Container>
  );
}

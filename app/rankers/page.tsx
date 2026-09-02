import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/layout/Container";
import { LeaderboardsSubnav } from "@/components/layout/LeaderboardsSubnav";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProfileLink } from "@/components/ui/ProfileLink";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { CreatorBadge } from "@/components/social/CreatorBadge";
import { FollowButton } from "@/components/social/FollowButton";
import { getAuthContext } from "@/lib/auth/session";
import { formatRankIqScore } from "@/lib/scoring";
import {
  DISCOVERY_MIN_CONTESTS,
  filterDiscoveryByProfileType,
  getRankerDiscovery,
  parseDiscoveryPosition,
} from "@/lib/social/discovery";
import { getFollowingIdSet } from "@/lib/social/follows";

import { canonicalMetadata, PUBLIC_INDEX } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Rankers",
  description:
    "Discover rankers with proven weekly ranking accuracy. Sample size required — one NFL week is not enough.",
  ...PUBLIC_INDEX,
  ...canonicalMetadata("/rankers"),
};

export const dynamic = "force-dynamic";

const POSITIONS = [
  { key: "ALL", label: "Overall" },
  { key: "QB", label: "QB" },
  { key: "RB", label: "RB" },
  { key: "WR", label: "WR" },
  { key: "TE", label: "TE" },
  { key: "DEF", label: "DEF" },
] as const;

const FILTERS = [
  { key: "ALL", label: "All" },
  { key: "HUMAN", label: "Humans" },
  { key: "EXPERT", label: "Experts" },
  { key: "AI", label: "AI" },
] as const;

export default async function RankersPage({
  searchParams,
}: {
  searchParams: Promise<{ position?: string; filter?: string; min?: string }>;
}) {
  const params = await searchParams;
  const position = parseDiscoveryPosition(params.position);
  const filter = filterDiscoveryByProfileType(params.filter);
  const minContests = Math.max(
    1,
    Number(params.min) || DISCOVERY_MIN_CONTESTS,
  );
  const auth = await getAuthContext();
  const viewerId = auth?.universalProfile?.id ?? null;

  const [{ rows, seasonYear }, followingIds] = await Promise.all([
    getRankerDiscovery({ position, filter, minContests }),
    viewerId ? getFollowingIdSet(viewerId) : Promise.resolve(new Set<string>()),
  ]);

  function href(next: { position?: string; filter?: string; min?: string }) {
    const query = new URLSearchParams({
      position: next.position ?? params.position ?? "ALL",
      filter: next.filter ?? filter,
      min: String(next.min ?? minContests),
    });
    return `/rankers?${query.toString()}`;
  }

  return (
    <Container className="py-12 sm:py-16">
      <SectionHeading
        eyebrow="Discovery"
        title="Rankers worth following"
        description="Public accuracy from graded weekly contests. Qualification is sample size and standing — not a one-week ‘elite’ label."
      />
      <LeaderboardsSubnav />

      <div className="mb-4 rounded-md border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-ink">
        Minimum sample: <strong>{minContests} graded weekly contests</strong>
        {seasonYear ? ` · ${seasonYear} season rollup` : ""}. Rankers below this
        threshold are hidden so a single NFL week cannot look like a reputation.
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {POSITIONS.map((item) => (
          <Link
            key={item.key}
            href={href({ position: item.key })}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              (position ?? "ALL") === item.key
                ? "bg-accent-soft text-accent"
                : "border border-border bg-surface-elevated text-ink"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <Link
            key={item.key}
            href={href({ filter: item.key })}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              filter === item.key
                ? "bg-ink text-white"
                : "border border-border bg-surface-elevated text-ink"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No rankers meet the sample-size filter"
          description="Graded contests will populate this list. Lower the minimum only if you understand the small-sample risk."
          actionHref="/leaderboards"
          actionLabel="View full leaderboards"
        />
      ) : (
        <ol className="divide-y divide-border rounded-lg border border-border bg-surface-elevated">
          {rows.map((row) => (
            <li
              key={row.universalProfileId}
              className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="font-display w-6 font-semibold text-ink">
                  {row.rank}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <ProfileLink
                      username={row.username}
                      displayName={row.displayName}
                      isAi={row.profileType === "AI"}
                      isExpert={row.profileType === "BENCHMARK"}
                    />
                    <CreatorBadge
                      enabled={row.creatorEnabled}
                      qualified={row.qualified}
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {row.contestsPlayed} contests · Avg{" "}
                    {formatRankIqScore(row.averageScore)} · Top-N{" "}
                    {Math.round(row.topNHitRate * 100)}% · Exact {row.exactHits}{" "}
                    · #1 {row.numberOneHits} · {row.followerCount} followers
                  </p>
                </div>
              </div>
              {viewerId !== row.universalProfileId &&
              row.profileType !== "BENCHMARK" ? (
                <FollowButton
                  targetProfileId={row.universalProfileId}
                  initialFollowing={followingIds.has(row.universalProfileId)}
                  signedIn={Boolean(auth)}
                  canFollow={
                    !auth || auth.universalProfile?.profileType === "HUMAN"
                  }
                />
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </Container>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/layout/Container";
import { LeaderboardsSubnav } from "@/components/layout/LeaderboardsSubnav";
import { AdPlacement } from "@/components/sponsors/AdPlacement";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProfileLink } from "@/components/ui/ProfileLink";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { FollowButton } from "@/components/social/FollowButton";
import { LeaderboardRowMetrics } from "@/components/leaderboards/LeaderboardRowMetrics";
import { getAuthContext, isAdminRole } from "@/lib/auth/session";
import {
  isAdminTestPreviewRequested,
  resolveIncludeTestWeeks,
} from "@/lib/admin/test-preview";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import { isPublisherConsensusSource } from "@/lib/expert-identity";
import {
  getActiveSeasonAndWeek,
  getSeasonLeaderboard,
  getWeeklyLeaderboard,
  type LeaderboardFilter,
  type LeaderboardRow,
} from "@/lib/leaderboards";
import { prisma } from "@/lib/db";
import { publicPageMetadata } from "@/lib/seo";
import { SEASON_LEADERBOARD_NOTE } from "@/lib/weekly-messaging";
import { getFollowerCountsForProfiles, getFollowingIdSet } from "@/lib/social/follows";
import { logServerEvent } from "@/lib/log";

export const metadata: Metadata = publicPageMetadata({
  title: 'Leaderboards',
  description:
    'Weekly and season EYEQ leaderboards — Public, Experts, Creators, AI, and Publisher Consensus on RankEyeQ.',
  path: '/leaderboards',
});

export const dynamic = "force-dynamic";

const POSITIONS: { key: "ALL" | ContestPosition; label: string }[] = [
  { key: "ALL", label: "Overall" },
  { key: "QB", label: "QB" },
  { key: "RB", label: "RB" },
  { key: "WR", label: "WR" },
  { key: "TE", label: "TE" },
  { key: "DEF", label: "DEF" },
];

const FILTERS: { key: LeaderboardFilter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "HUMAN", label: "Humans" },
  { key: "EXPERT", label: "Experts" },
  { key: "CREATOR", label: "Creators" },
  { key: "AI", label: "AI" },
  { key: "PUBLISHER", label: "Publisher Consensus" },
];

function BoardTable({
  rows,
  follow,
  viewCard,
}: {
  rows: LeaderboardRow[];
  follow?: {
    signedIn: boolean;
    viewerProfileId: string | null;
    followingIds: Set<string>;
    followerCounts: Map<string, number>;
    canFollow: boolean;
  };
  /** Position weekly boards only — never Overall. */
  viewCard?: {
    weekNumber: number;
    position: ContestPosition;
  } | null;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No graded contests yet"
        description="Leaderboards fill in after contests are graded. Contests played will stay visible for thin samples."
        actionHref="/rank"
        actionLabel="Build rankings"
      />
    );
  }

  return (
    <ol className="divide-y divide-border">
      {rows.map((entry) => {
        const cardHref =
          viewCard != null
            ? `/profile/${entry.username}/rankings/${viewCard.weekNumber}/${viewCard.position.toLowerCase()}`
            : null;
        return (
          <li
            key={entry.universalProfileId}
            className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="font-display w-7 shrink-0 text-center text-base font-semibold tabular-nums text-ink sm:w-8">
                {entry.rank}
              </span>
              <div className="min-w-0 flex-1">
                <ProfileLink
                  username={entry.username}
                  displayName={entry.displayName}
                  avatarUrl={entry.avatarUrl}
                  profileType={entry.profileType}
                  isAi={entry.profileType === "AI"}
                  isExpert={
                    entry.profileType === "BENCHMARK" &&
                    !isPublisherConsensusSource(entry.expertSourceKind)
                  }
                  isCreator={entry.profileType === "CREATOR"}
                  expertPublisher={entry.expertPublisher}
                  expertSourceKind={entry.expertSourceKind}
                  creatorBrand={entry.creatorBrand}
                  aiModel={
                    entry.profileType === "AI" ? entry.displayName : null
                  }
                />
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {follow &&
                  entry.profileType !== "BENCHMARK" &&
                  entry.profileType !== "CREATOR" &&
                  entry.profileType !== "AI" ? (
                    <p className="text-xs text-muted">
                      {follow.followerCounts.get(entry.universalProfileId) ??
                        0}{" "}
                      followers
                    </p>
                  ) : null}
                  {cardHref ? (
                    <Link
                      href={cardHref}
                      className="text-xs font-medium text-accent-ink hover:underline"
                    >
                      View Card
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="w-full min-w-0 sm:w-auto sm:shrink-0">
              <LeaderboardRowMetrics row={entry} />
            </div>
            {follow &&
            follow.viewerProfileId !== entry.universalProfileId &&
            entry.profileType !== "BENCHMARK" &&
            entry.profileType !== "CREATOR" ? (
              <FollowButton
                targetProfileId={entry.universalProfileId}
                initialFollowing={follow.followingIds.has(
                  entry.universalProfileId,
                )}
                signedIn={follow.signedIn}
                canFollow={follow.canFollow}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export default async function LeaderboardsPage({
  searchParams,
}: {
  searchParams: Promise<{
    scope?: string;
    position?: string;
    filter?: string;
    test?: string;
    adminTest?: string;
    weekId?: string;
  }>;
}) {
  const params = await searchParams;
  const scope = params.scope === "season" ? "season" : "weekly";

  let auth;
  try {
    auth = await getAuthContext();
  } catch (error) {
    logServerEvent(
      "leaderboards.auth_failed",
      {
        route: "/leaderboards",
        step: "auth",
        message: error instanceof Error ? error.message.slice(0, 160) : "unknown",
      },
      "error",
    );
    throw error;
  }

  const includeTest = resolveIncludeTestWeeks({
    isAdmin: auth?.user?.role ? isAdminRole(auth.user.role) : false,
    adminTestPreview: isAdminTestPreviewRequested(params),
    legacyTestParam: params.test === "1",
  });
  const positionParam = (params.position?.toUpperCase() ?? "ALL") as
    | "ALL"
    | ContestPosition;
  const filter = ([
    "ALL",
    "HUMAN",
    "AI",
    "EXPERT",
    "CREATOR",
    "PUBLISHER",
  ].includes(params.filter ?? "")
    ? params.filter
    : "ALL") as LeaderboardFilter;

  let context;
  try {
    context = await getActiveSeasonAndWeek();
  } catch (error) {
    logServerEvent(
      "leaderboards.context_failed",
      {
        route: "/leaderboards",
        step: "active_season_week",
        scope,
        position: positionParam,
        filter,
        message: error instanceof Error ? error.message.slice(0, 160) : "unknown",
      },
      "error",
    );
    throw error;
  }

  const position =
    positionParam === "ALL" ? undefined : (positionParam as ContestPosition);

  let rows: LeaderboardRow[] = [];
  let title = "Leaderboards";
  const testWeek =
    includeTest && params.weekId
      ? await prisma.week.findUnique({
          where: { id: params.weekId },
          include: { season: true },
        })
      : null;

  try {
    if (testWeek?.isTest) {
      rows = await getWeeklyLeaderboard({
        weekId: testWeek.id,
        position,
        filter,
        includeTest: true,
      });
      title = `[TEST] ${testWeek.label} · ${positionParam === "ALL" ? "Overall" : positionParam}`;
    } else if (context?.week && scope === "weekly") {
      rows = await getWeeklyLeaderboard({
        weekId: context.week.id,
        position,
        filter,
      });
      title = `${context.week.label} · ${positionParam === "ALL" ? "Overall" : positionParam}`;
    } else if (context?.season) {
      rows = await getSeasonLeaderboard({
        seasonId: context.season.id,
        position,
        filter,
      });
      title = `${context.season.year} Season · ${positionParam === "ALL" ? "Overall" : positionParam}`;
    }
  } catch (error) {
    logServerEvent(
      "leaderboards.query_failed",
      {
        route: "/leaderboards",
        step: "leaderboard_query",
        scope,
        position: positionParam,
        filter,
        weekId: testWeek?.id ?? context?.week?.id ?? null,
        message: error instanceof Error ? error.message.slice(0, 160) : "unknown",
      },
      "error",
    );
    throw error;
  }

  const followingIds = auth?.universalProfile
    ? await getFollowingIdSet(auth.universalProfile.id)
    : new Set<string>();
  const followerCounts = await getFollowerCountsForProfiles(
    rows.map((row) => row.universalProfileId),
  );

  const viewCardWeekNumber =
    testWeek?.isTest
      ? testWeek.weekNumber
      : scope === "weekly" && context?.week
        ? context.week.weekNumber
        : null;
  const viewCard =
    viewCardWeekNumber != null && position != null
      ? { weekNumber: viewCardWeekNumber, position }
      : null;

  function href(next: {
    scope?: string;
    position?: string;
    filter?: string;
  }) {
    const query = new URLSearchParams({
      scope: next.scope ?? scope,
      position: next.position ?? positionParam,
      filter: next.filter ?? filter,
    });
    return `/leaderboards?${query.toString()}`;
  }

  return (
    <Container className="py-12 sm:py-16">
      <SectionHeading
        eyebrow="Accuracy ladder"
        title="Leaderboards"
        description="Average EYEQ Score across graded weekly contests. Season view rolls up weekly results — not season-long projection rankings."
      />
      <LeaderboardsSubnav />

      <div className="mb-4 flex flex-wrap gap-2">
        {[
          ["weekly", "Weekly"],
          ["season", "Season"],
        ].map(([key, label]) => (
          <Link
            key={key}
            href={href({ scope: key })}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              scope === key
                ? "bg-accent text-ink"
                : "border border-border bg-surface-elevated text-ink"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {POSITIONS.map((item) => (
          <Link
            key={item.key}
            href={href({ position: item.key })}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              positionParam === item.key
                ? "bg-accent-soft text-ink"
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
                ? "bg-ink text-off-white"
                : "border border-border bg-surface-elevated text-ink"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      <AdPlacement placementKey="leaderboard_inline" className="mb-6" />

      <section className="rounded-lg border border-border bg-surface-elevated">
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-display text-xl font-semibold text-ink">{title}</h2>
          <p className="mt-1 text-sm text-muted">
            {scope === "season"
              ? SEASON_LEADERBOARD_NOTE
              : "Weekly results for the selected NFL week."}{" "}
            {context
              ? position
                ? "Profile opens identity; View Card opens that week’s graded position board."
                : "Click any profile to open their RankEyeQ page."
              : "No active season found."}
          </p>
        </div>
        <BoardTable
          rows={rows}
          viewCard={viewCard}
          follow={{
            signedIn: Boolean(auth),
            viewerProfileId: auth?.universalProfile?.id ?? null,
            followingIds,
            followerCounts,
            canFollow:
              !auth || auth.universalProfile?.profileType === "HUMAN",
          }}
        />
      </section>
    </Container>
  );
}

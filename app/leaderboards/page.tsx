import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Container } from "@/components/layout/Container";
import { LeaderboardsSubnav } from "@/components/layout/LeaderboardsSubnav";
import { AdPlacement } from "@/components/sponsors/AdPlacement";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import {
  BoardTable,
  WaiverBoardTable,
  type RowFollow,
} from "@/components/leaderboards/LeaderboardTables";
import { getAuthContext, isAdminRole } from "@/lib/auth/session";
import {
  isAdminTestPreviewRequested,
  resolveIncludeTestWeeks,
} from "@/lib/admin/test-preview";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import {
  getActiveSeasonAndWeek,
  getLatestGradedWeekId,
  getSeasonLeaderboard,
  getWeeklyLeaderboard,
  leaderboardRowMatchesFilter,
  publicLeaderboardIdentitiesForWeeks,
  type LeaderboardFilter,
  type LeaderboardRow,
} from "@/lib/leaderboards";
import {
  leaderboardWeekOptions,
  parseLeaderboardWeekParam,
  resolveLeaderboardWeek,
} from "@/lib/leaderboard-weeks";
import {
  leaderboardHref,
  parseLeaderboardDiscipline,
  type LeaderboardDiscipline,
} from "@/lib/leaderboard-url";
import { prisma } from "@/lib/db";
import { publicPageMetadata } from "@/lib/seo";
import { SEASON_LEADERBOARD_NOTE } from "@/lib/weekly-messaging";
import { getFollowerCountsForProfiles, getFollowingIdSet } from "@/lib/social/follows";
import { followControlFor } from "@/lib/social/follow-eligibility";
import { formatContestClock } from "@/lib/timing/chicago";
import { logServerEvent } from "@/lib/log";
import {
  aggregateWaiverLeaderboard,
  inauguralWaiverWeek,
  parseWaiverLeaderboardPosition,
  resolveWaiverLeaderboardWeek,
  waiverLeaderboardEmptyCopy,
  waiverLeaderboardState,
  waiverLeaderboardWeekOptions,
  waiverWeekLocksAt,
  type WaiverLeaderboardState,
} from "@/lib/waivers/leaderboard-model";
import {
  loadGradedWaiverBoards,
  loadWaiverLeaderboardWeeks,
  readWaiverLeaderboardClock,
} from "@/lib/waivers/leaderboard-queries";

export const metadata: Metadata = publicPageMetadata({
  title: 'Leaderboards',
  description:
    'Weekly and season EYEQ leaderboards — Public, Experts, Creators, AI, and Publisher Consensus on RankEyeQ.',
  path: '/leaderboards',
});

export const dynamic = "force-dynamic";

type Discipline = LeaderboardDiscipline;

const DISCIPLINES: { key: Discipline; label: string }[] = [
  { key: "rankings", label: "Rankings" },
  { key: "waivers", label: "Waivers" },
];

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

function ChipRow({
  label,
  items,
  className = "mb-4",
}: {
  label: string;
  items: { key: string; label: string; href: string; active: boolean; title?: string; activeClass?: string }[];
  className?: string;
}) {
  return (
    <div className={`${className} flex flex-wrap gap-2`} aria-label={label}>
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          title={item.title}
          aria-current={item.active ? "page" : undefined}
          className={`rounded-md px-3 py-1.5 text-sm font-medium tabular-nums ${
            item.active
              ? (item.activeClass ?? "bg-accent-soft text-ink")
              : "border border-border bg-surface-elevated text-ink"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

export default async function LeaderboardsPage({
  searchParams,
}: {
  searchParams: Promise<{
    discipline?: string;
    scope?: string;
    position?: string;
    filter?: string;
    test?: string;
    adminTest?: string;
    weekId?: string;
    week?: string;
  }>;
}) {
  const params = await searchParams;
  const discipline = parseLeaderboardDiscipline(params.discipline);
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
  const positionParam = (
    discipline === "waivers"
      ? parseWaiverLeaderboardPosition(params.position)
      : (params.position?.toUpperCase() ?? "ALL")
  ) as "ALL" | ContestPosition;
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
  const positionLabel = positionParam === "ALL" ? "Overall" : positionParam;
  const requestedWeekNumber = parseLeaderboardWeekParam(params.week);

  const viewer = {
    signedIn: Boolean(auth),
    profileId: auth?.universalProfile?.id ?? null,
    profileType: auth?.universalProfile?.profileType ?? null,
    status: auth?.universalProfile?.status ?? null,
  };
  const followingIds = viewer.profileId
    ? await getFollowingIdSet(viewer.profileId)
    : new Set<string>();
  const follow: RowFollow = (profile) => ({
    control: followControlFor({
      viewer,
      target: {
        profileId: profile.universalProfileId,
        profileType: profile.profileType,
        expertSourceKind: profile.expertSourceKind,
      },
    }),
    initialFollowing: followingIds.has(profile.universalProfileId),
  });

  let title = "Leaderboards";
  let note = "";
  let board: ReactNode = null;
  let weekChips: { key: string; label: string; href: string; active: boolean; title?: string }[] = [];
  let carriedWeekNumber: number | null = null;

  function href(next: {
    discipline?: Discipline;
    scope?: string;
    position?: string;
    filter?: string;
    week?: number | null;
  }) {
    return leaderboardHref({
      discipline: next.discipline ?? discipline,
      scope: next.scope ?? scope,
      position: next.position ?? positionParam,
      filter: next.filter ?? filter,
      week: next.week === undefined ? carriedWeekNumber : next.week,
    });
  }

  if (discipline === "rankings") {
    let rows: LeaderboardRow[] = [];
    const testWeek =
      includeTest && params.weekId
        ? await prisma.week.findUnique({
            where: { id: params.weekId },
            include: { season: true },
          })
        : null;

    const weekOptions = context
      ? leaderboardWeekOptions(context.season.weeks)
      : [];
    let weeklyWeek = context?.week ?? null;

    try {
      if (testWeek?.isTest) {
        rows = await getWeeklyLeaderboard({
          weekId: testWeek.id,
          position,
          filter,
          includeTest: true,
        });
        title = `[TEST] ${testWeek.label} · ${positionLabel}`;
      } else if (context?.week && scope === "weekly") {
        weeklyWeek =
          resolveLeaderboardWeek({
            options: weekOptions,
            requestedWeekNumber,
            latestGradedWeekId: await getLatestGradedWeekId(context.season.id),
            currentWeekId: context.week.id,
          }) ?? context.week;
        rows = await getWeeklyLeaderboard({
          weekId: weeklyWeek.id,
          position,
          filter,
        });
        title = `${weeklyWeek.label} · ${positionLabel}`;
      } else if (context?.season) {
        rows = await getSeasonLeaderboard({
          seasonId: context.season.id,
          position,
          filter,
        });
        title = `${context.season.year} Season · ${positionLabel}`;
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
          weekId: testWeek?.id ?? weeklyWeek?.id ?? null,
          message: error instanceof Error ? error.message.slice(0, 160) : "unknown",
        },
        "error",
      );
      throw error;
    }

    const followerCounts = await getFollowerCountsForProfiles(
      rows.map((row) => row.universalProfileId),
    );

    const viewCardWeekNumber =
      testWeek?.isTest
        ? testWeek.weekNumber
        : scope === "weekly" && weeklyWeek
          ? weeklyWeek.weekNumber
          : null;
    const viewCard =
      viewCardWeekNumber != null && position != null
        ? { weekNumber: viewCardWeekNumber, position }
        : null;

    const selectedWeekNumber =
      scope === "weekly" ? (weeklyWeek?.weekNumber ?? null) : requestedWeekNumber;
    carriedWeekNumber = weekOptions.some((week) => week.weekNumber === selectedWeekNumber)
      ? selectedWeekNumber
      : null;

    if (scope === "weekly" && !testWeek?.isTest) {
      weekChips = weekOptions.map((week) => ({
        key: week.id,
        label: `W${week.weekNumber}`,
        title: week.label,
        href: href({ week: week.weekNumber }),
        active: weeklyWeek?.id === week.id,
      }));
    }

    note = `${
      scope === "season" ? SEASON_LEADERBOARD_NOTE : "Weekly results for the selected NFL week."
    } ${
      context
        ? position
          ? "Profile opens identity; View Card opens that week’s graded position board."
          : "Click any profile to open their RankEyeQ page."
        : "No active season found."
    }`;
    board = (
      <BoardTable rows={rows} follow={follow} followerCounts={followerCounts} viewCard={viewCard} />
    );
  } else {
    const waiverWeeks = context ? await loadWaiverLeaderboardWeeks(context.season.id) : [];
    const options = waiverLeaderboardWeekOptions(waiverWeeks);
    const gradedBoards = await loadGradedWaiverBoards(options.map((week) => week.id));
    const gradedWeekIds = new Set(gradedBoards.map((b) => b.weekId));
    const week = resolveWaiverLeaderboardWeek({ options, requestedWeekNumber, gradedWeekIds });
    const inaugural = inauguralWaiverWeek(options);
    const waiverPosition = parseWaiverLeaderboardPosition(positionParam);
    const now = await readWaiverLeaderboardClock();

    const weekLocksAt = week ? waiverWeekLocksAt(week, waiverPosition) : null;
    const state: WaiverLeaderboardState = waiverLeaderboardState({
      scope,
      position: waiverPosition,
      options,
      week,
      gradedWeekIds,
      now,
    });

    carriedWeekNumber = scope === "weekly" ? (week?.weekNumber ?? null) : requestedWeekNumber;
    if (!options.some((option) => option.weekNumber === carriedWeekNumber)) carriedWeekNumber = null;
    if (scope === "weekly") {
      weekChips = options.map((option) => ({
        key: option.id,
        label: `W${option.weekNumber}`,
        title: option.label,
        href: href({ week: option.weekNumber }),
        active: week?.id === option.id,
      }));
    }

    title =
      scope === "season"
        ? `${context?.season.year ?? ""} Waivers Season · ${positionLabel}`.trim()
        : `${week ? `${week.label} ` : ""}Waivers · ${positionLabel}`;
    note =
      scope === "season"
        ? `Season standings roll up official graded Waivers weeks only${
            inaugural ? ` — Waivers began in ${inaugural.label}` : ""
          }. Weeks before launch never count against anyone.`
        : "Weekly Waivers results for the selected week. Overall combines every graded position contest.";

    if (state.kind === "GRADED") {
      const scopedBoards =
        scope === "season" ? gradedBoards : gradedBoards.filter((b) => b.weekId === week?.id);
      const visible = await publicLeaderboardIdentitiesForWeeks(scopedBoards);
      const classBoards = visible.entries.filter((b) => {
        const identity = visible.identities.get(b.universalProfileId);
        return identity != null && leaderboardRowMatchesFilter(identity, filter);
      });
      const rows = aggregateWaiverLeaderboard(classBoards, waiverPosition);
      board =
        rows.length > 0 ? (
          <WaiverBoardTable rows={rows} identities={visible.identities} follow={follow} />
        ) : (
          <EmptyState
            title="No graded Waivers boards for this filter"
            description="Try another position or competitor class."
          />
        );
    } else {
      const copy = waiverLeaderboardEmptyCopy(
        state,
        weekLocksAt ? formatContestClock(weekLocksAt) : null,
      );
      board = (
        <EmptyState
          title={copy.title}
          description={copy.description}
          actionHref={state.kind === "LIVE" ? "/waivers" : undefined}
          actionLabel={state.kind === "LIVE" ? "Make your Waiver calls" : undefined}
        />
      );
    }
  }

  return (
    <Container className="py-12 sm:py-16">
      <SectionHeading
        eyebrow="Accuracy ladder"
        title="Leaderboards"
        description={
          discipline === "waivers"
            ? "Average Waiver EyeQ across graded Waivers weeks. Every value comes from official Waivers grading."
            : "Average EYEQ Score across graded weekly contests. Season view rolls up weekly results — not season-long projection rankings."
        }
      />
      <LeaderboardsSubnav />

      <div
        className="mb-5 inline-flex rounded-lg border border-border bg-surface-elevated p-1"
        role="tablist"
        aria-label="Leaderboard discipline"
      >
        {DISCIPLINES.map((item) => (
          <Link
            key={item.key}
            href={href({ discipline: item.key, week: null })}
            role="tab"
            aria-selected={discipline === item.key}
            className={`rounded-md px-4 py-1.5 text-sm font-semibold ${
              discipline === item.key ? "bg-ink text-off-white" : "text-ink hover:bg-surface"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      <ChipRow
        label="Time scope"
        items={[
          ["weekly", "Weekly"],
          ["season", "Season"],
        ].map(([key, label]) => ({
          key,
          label,
          href: href({ scope: key }),
          active: scope === key,
          activeClass: "bg-accent text-ink",
        }))}
      />

      {weekChips.length > 0 ? <ChipRow label="NFL week" items={weekChips} /> : null}

      <ChipRow
        label="Position"
        items={POSITIONS.map((item) => ({
          key: item.key,
          label: item.label,
          href: href({ position: item.key }),
          active: positionParam === item.key,
        }))}
      />

      <ChipRow
        label="Competitor class"
        className="mb-6"
        items={FILTERS.map((item) => ({
          key: item.key,
          label: item.label,
          href: href({ filter: item.key }),
          active: filter === item.key,
          activeClass: "bg-ink text-off-white",
        }))}
      />

      <AdPlacement placementKey="leaderboard_inline" className="mb-6" />

      <section className="rounded-lg border border-border bg-surface-elevated">
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-display text-xl font-semibold text-ink">{title}</h2>
          <p className="mt-1 text-sm text-muted">{note}</p>
        </div>
        {board}
      </section>
    </Container>
  );
}

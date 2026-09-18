import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/layout/Container";
import { AdPlacement } from "@/components/sponsors/AdPlacement";
import { PlayerPerformanceIntro } from "@/components/players/PlayerPerformanceIntro";
import { PlayerPerformanceTable } from "@/components/players/PlayerPerformanceTable";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { getAuthContext, isAdminRole } from "@/lib/auth/session";
import {
  isAdminTestPreviewRequested,
  resolveIncludeTestWeeks,
} from "@/lib/admin/test-preview";
import { prisma } from "@/lib/db";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import {
  getActiveSeasonForPerformance,
  getPlayerPerformanceLeaderboard,
  listSeasonWeeksForPerformance,
} from "@/lib/player-performance-queries";
import {
  parsePlayerPerformanceScope,
  qualificationForPlayerPerformanceScope,
  shouldShowPlayerPerformanceQualificationControls,
  type PlayerPerformanceScope,
  type PlayerPerformanceSortKey,
  type PlayerQualificationFilter,
  type WeekPerformanceSortKey,
} from "@/lib/player-performance";
import { publicPageMetadata } from "@/lib/seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Player Performance",
  description:
    "NFL player finishes and how official RankEyeQ rankers placed them before kickoff.",
  path: "/players",
});

export const dynamic = "force-dynamic";

const POSITIONS: (ContestPosition | "ALL")[] = [
  "ALL",
  "QB",
  "RB",
  "WR",
  "TE",
  "DEF",
];
const QUALIFICATIONS: { key: PlayerQualificationFilter; label: string }[] = [
  { key: "ALL", label: "All players" },
  { key: "MIN_4", label: "4+ weeks" },
  { key: "MIN_8", label: "8+ weeks" },
];

const SCOPES: { key: PlayerPerformanceScope; label: string }[] = [
  { key: "season", label: "Season" },
  { key: "hot", label: "Who’s Hot" },
  { key: "week", label: "Week" },
];

const SEASON_SORT_KEYS: PlayerPerformanceSortKey[] = [
  "averageFinish",
  "medianFinish",
  "weeksRecorded",
  "top3Finishes",
  "top5Finishes",
  "top10Finishes",
  "numberOneFinishes",
  "bestFinish",
  "worstFinish",
  "rankedPct",
  "avgRankedPosition",
  "name",
];

const WEEK_SORT_KEYS: WeekPerformanceSortKey[] = [
  "actualRank",
  "fantasyPoints",
  "rankedPct",
  "avgRankedPosition",
  "consensusRank",
  "consensusSelectedPct",
  "name",
];

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<{
    seasonId?: string;
    position?: string;
    qualification?: string;
    sort?: string;
    sortDirection?: string;
    scope?: string;
    weekId?: string;
    /** @deprecated Prefer scope=hot */
    window?: string;
    adminTest?: string;
  }>;
}) {
  const params = await searchParams;
  const auth = await getAuthContext();
  const includeTest = resolveIncludeTestWeeks({
    isAdmin: auth?.user?.role ? isAdminRole(auth.user.role) : false,
    adminTestPreview: isAdminTestPreviewRequested(params),
  });
  const seasons = await prisma.season.findMany({
    where: { sport: "NFL" },
    orderBy: { year: "desc" },
  });
  const activeSeason = await getActiveSeasonForPerformance();
  const seasonId =
    params.seasonId ?? activeSeason?.id ?? seasons[0]?.id ?? null;

  const scope = parsePlayerPerformanceScope(params.scope ?? params.window);

  const rawPosition = (params.position?.toUpperCase() ??
    (scope === "week" ? "RB" : "ALL")) as ContestPosition | "ALL";
  const position = (
    POSITIONS.includes(rawPosition) ? rawPosition : scope === "week" ? "RB" : "ALL"
  ) as ContestPosition | "ALL";

  const qualificationParam = (
    QUALIFICATIONS.some((item) => item.key === params.qualification)
      ? params.qualification
      : "ALL"
  ) as PlayerQualificationFilter;

  // Season alone applies All / 4+ / 8+. Hot and Week ignore stale qualification=.
  const qualification = qualificationForPlayerPerformanceScope(
    scope,
    qualificationParam,
  );

  const defaultSort = scope === "week" ? "actualRank" : "averageFinish";
  const sortPool = scope === "week" ? WEEK_SORT_KEYS : SEASON_SORT_KEYS;
  const sort = (
    sortPool.includes(params.sort as never) ? params.sort : defaultSort
  ) as string;

  const sortDirection =
    params.sortDirection === "desc"
      ? "desc"
      : params.sortDirection === "asc"
        ? "asc"
        : scope === "week"
          ? "asc"
          : "asc";

  const weeks =
    seasonId != null
      ? await listSeasonWeeksForPerformance({ seasonId, includeTest })
      : [];

  const leaderboard =
    seasonId != null
      ? await getPlayerPerformanceLeaderboard({
          seasonId,
          position,
          qualification,
          sort: sort as PlayerPerformanceSortKey,
          weekSort: sort as WeekPerformanceSortKey,
          sortDirection,
          scope,
          weekId: params.weekId,
          includeTest,
        })
      : null;

  function href(next: Record<string, string>) {
    const query = new URLSearchParams({
      seasonId: seasonId ?? "",
      position,
      scope,
      // Keep qualification= in the URL for Season compatibility even on Hot/Week
      // (those scopes ignore it for calculation).
      qualification: qualificationParam,
      sort,
      sortDirection,
      ...(leaderboard?.weekId ? { weekId: leaderboard.weekId } : {}),
      ...next,
    });
    if (next.scope === "season" || next.scope === "hot") {
      query.delete("weekId");
    }
    return `/players?${query.toString()}`;
  }

  const hotSampleLabel =
    leaderboard && leaderboard.scope === "hot"
      ? leaderboard.hotWeekNumbers.length === 0
        ? "No completed weeks with finalized contests yet."
        : leaderboard.hotWeekNumbers.length < 3
          ? `Last ${leaderboard.hotWeekNumbers.length} completed week${leaderboard.hotWeekNumbers.length === 1 ? "" : "s"} (sample size ${leaderboard.hotWeekNumbers.length}): Weeks ${leaderboard.hotWeekNumbers.join(", ")}.`
          : `Last 3 completed weeks: Weeks ${leaderboard.hotWeekNumbers.join(", ")}.`
      : null;

  return (
    <Container className="py-12 sm:py-16">
      <SectionHeading
        eyebrow="Player Performance"
        title="Player Performance"
        description="Actual NFL positional finishes and official RankEyeQ ranking behavior — Season, Who’s Hot, and Week views."
      />

      <PlayerPerformanceIntro />

      <AdPlacement
        placementKey="player_performance_inline"
        className="mb-8 mt-6"
      />

      {seasons.length === 0 ? (
        <p className="text-sm text-muted">No NFL seasons configured yet.</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            {seasons.map((season) => (
              <Link
                key={season.id}
                href={href({ seasonId: season.id })}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  seasonId === season.id
                    ? "bg-accent text-ink"
                    : "border border-border bg-surface-elevated text-ink"
                }`}
              >
                {season.year}
              </Link>
            ))}
          </div>

          <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="View scope">
            {SCOPES.map((item) => (
              <Link
                key={item.key}
                href={href({
                  scope: item.key,
                  ...(item.key === "week" && position === "ALL"
                    ? { position: "RB" }
                    : {}),
                })}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  scope === item.key
                    ? "bg-ink text-off-white"
                    : "border border-border bg-surface-elevated text-ink"
                }`}
                aria-current={scope === item.key ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </div>

          <div className="mb-3 flex flex-wrap gap-2">
            {(scope === "week"
              ? POSITIONS.filter((pos) => pos !== "ALL")
              : POSITIONS
            ).map((pos) => (
              <Link
                key={pos}
                href={href({ position: pos })}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  position === pos
                    ? "bg-accent-soft text-ink"
                    : "border border-border bg-surface-elevated text-ink"
                }`}
              >
                {pos}
              </Link>
            ))}
          </div>

          {scope === "week" && weeks.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-2">
              {weeks.map((week) => (
                <Link
                  key={week.id}
                  href={href({ weekId: week.id, scope: "week" })}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                    leaderboard?.weekId === week.id
                      ? "bg-accent-soft text-ink"
                      : "border border-border bg-surface-elevated text-ink"
                  }`}
                >
                  {week.label}
                </Link>
              ))}
            </div>
          ) : null}

          {shouldShowPlayerPerformanceQualificationControls(scope) ? (
            <div className="mb-6 flex flex-wrap gap-2">
              {QUALIFICATIONS.map((item) => (
                <Link
                  key={item.key}
                  href={href({ qualification: item.key })}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                    qualificationParam === item.key
                      ? "bg-ink text-off-white"
                      : "border border-border bg-surface-elevated text-ink"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ) : (
            <div className="mb-6" />
          )}

          {scope === "hot" && hotSampleLabel ? (
            <p className="mb-4 text-sm text-muted">{hotSampleLabel}</p>
          ) : null}

          {scope === "week" && leaderboard?.weekUnavailableReason ? (
            <p
              className="mb-4 rounded-lg border border-border bg-surface-elevated px-4 py-3 text-sm text-muted"
              role="status"
            >
              {leaderboard.weekUnavailableReason}
            </p>
          ) : null}

          {scope === "season" ? (
            <p className="mb-4 text-sm text-muted">
              Official season aggregates use FINAL and ARCHIVED contests only.
            </p>
          ) : null}

          {leaderboard ? (
            <PlayerPerformanceTable
              rows={leaderboard.rows}
              weekRows={leaderboard.weekRows}
              scope={leaderboard.scope}
              position={position}
              seasonId={seasonId!}
              qualification={qualificationParam}
              sort={sort}
              sortDirection={sortDirection}
              weekId={leaderboard.weekId}
            />
          ) : null}
        </>
      )}
    </Container>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/layout/Container";
import { PlayerPerformanceMarketScaffold } from "@/components/players/PlayerPerformanceMarketScaffold";
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
} from "@/lib/player-performance-queries";
import type {
  PlayerPerformanceSortKey,
  PlayerQualificationFilter,
} from "@/lib/player-performance";
import { canonicalMetadata, PUBLIC_INDEX } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Player Performance",
  description:
    "The Player Performance Market: NFL player production plus how Humans, Experts, Creators, and AI ranked players before kickoff.",
  ...PUBLIC_INDEX,
  ...canonicalMetadata("/players"),
};

export const dynamic = "force-dynamic";

const POSITIONS: (ContestPosition | "ALL")[] = ["ALL", "QB", "RB", "WR", "TE", "DEF"];
const QUALIFICATIONS: { key: PlayerQualificationFilter; label: string }[] = [
  { key: "ALL", label: "All players" },
  { key: "MIN_4", label: "4+ weeks" },
  { key: "MIN_8", label: "8+ weeks" },
];

const SORT_KEYS: PlayerPerformanceSortKey[] = [
  "averageFinish",
  "medianFinish",
  "weeksRecorded",
  "top3Finishes",
  "top5Finishes",
  "top10Finishes",
  "numberOneFinishes",
  "bestFinish",
  "worstFinish",
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

  const position = (
    POSITIONS.includes((params.position?.toUpperCase() ?? "ALL") as ContestPosition | "ALL")
      ? (params.position?.toUpperCase() ?? "ALL")
      : "ALL"
  ) as ContestPosition | "ALL";

  const qualification = (
    QUALIFICATIONS.some((item) => item.key === params.qualification)
      ? params.qualification
      : "ALL"
  ) as PlayerQualificationFilter;

  const sort = (
    SORT_KEYS.includes(params.sort as PlayerPerformanceSortKey)
      ? params.sort
      : "averageFinish"
  ) as PlayerPerformanceSortKey;

  const sortDirection = params.sortDirection === "desc" ? "desc" : "asc";

  const leaderboard =
    seasonId != null
      ? await getPlayerPerformanceLeaderboard({
          seasonId,
          position,
          qualification,
          sort,
          sortDirection,
          window: params.window,
          includeTest,
        })
      : null;

  function href(next: Record<string, string>) {
    const query = new URLSearchParams({
      seasonId: seasonId ?? "",
      position,
      qualification,
      sort,
      sortDirection,
      ...next,
    });
    return `/players?${query.toString()}`;
  }

  return (
    <Container className="py-12 sm:py-16">
      <SectionHeading
        eyebrow="Player Performance Market"
        title="The Player Performance Market"
        description="RankEyeQ tracks actual player production and how Humans, Experts, Creators, and AI ranked that player before kickoff. Production metrics below use graded contest finishes only — ranking-market history appears when ballots exist."
      />

      <PlayerPerformanceMarketScaffold />

      <h2 className="mb-4 font-display text-xl font-semibold text-ink">
        Production finishes
      </h2>

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
                    ? "bg-accent text-white"
                    : "border border-border bg-surface-elevated text-ink"
                }`}
              >
                {season.year}
              </Link>
            ))}
          </div>

          <div className="mb-3 flex flex-wrap gap-2">
            {POSITIONS.map((pos) => (
              <Link
                key={pos}
                href={href({ position: pos })}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  position === pos
                    ? "bg-accent-soft text-accent"
                    : "border border-border bg-surface-elevated text-ink"
                }`}
              >
                {pos}
              </Link>
            ))}
          </div>

          <div className="mb-6 flex flex-wrap gap-2">
            {QUALIFICATIONS.map((item) => (
              <Link
                key={item.key}
                href={href({ qualification: item.key })}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  qualification === item.key
                    ? "bg-ink text-white"
                    : "border border-border bg-surface-elevated text-ink"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>

          {leaderboard ? (
            <PlayerPerformanceTable
              rows={leaderboard.rows}
              position={position}
              seasonId={seasonId!}
              qualification={qualification}
              sort={sort}
              sortDirection={sortDirection}
            />
          ) : null}
        </>
      )}
    </Container>
  );
}

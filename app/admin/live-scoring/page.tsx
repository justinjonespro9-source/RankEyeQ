import type { Metadata } from "next";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { LiveScoringConsole } from "@/components/admin/LiveScoringConsole";
import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import { SectionHeading } from "@/components/ui/SectionHeading";
import {
  listLiveScoringEntriesForGame,
  listLiveScoringGames,
} from "@/lib/admin/live-scoring";
import { prisma } from "@/lib/db";
import { DEFAULT_FANTASY_SCORING_VERSION } from "@/lib/fantasy/scoring-config";
import { resolveFantasyScoringVersion } from "@/lib/fantasy/shared-engine";

export const metadata: Metadata = {
  title: "Live Scoring",
  description:
    "Manual live stat entry console — raw NFL stats scored by FantasyTrack Half-PPR V2.",
};

export const dynamic = "force-dynamic";

export default async function AdminLiveScoringPage({
  searchParams,
}: {
  searchParams: Promise<{
    seasonId?: string;
    weekId?: string;
    gameId?: string;
  }>;
}) {
  const params = await searchParams;

  const seasons = await prisma.season.findMany({
    where: { sport: "NFL" },
    select: {
      id: true,
      year: true,
      active: true,
      weeks: {
        orderBy: { weekNumber: "asc" },
        select: {
          id: true,
          weekNumber: true,
          label: true,
          status: true,
          fantasyScoringVersion: true,
        },
      },
    },
    orderBy: { year: "desc" },
  });

  const seasonId =
    params.seasonId ??
    seasons.find((season) => season.active)?.id ??
    seasons[0]?.id ??
    "";
  const selectedSeason =
    seasons.find((season) => season.id === seasonId) ?? seasons[0] ?? null;
  const weeks = selectedSeason?.weeks ?? [];
  const weekId =
    params.weekId ??
    weeks.find((week) => week.status === "OPEN")?.id ??
    weeks[0]?.id ??
    "";

  const weekRecord = weekId
    ? await prisma.week.findUnique({
        where: { id: weekId },
        include: { season: true },
      })
    : null;

  const scoringVersion = weekRecord
    ? resolveFantasyScoringVersion({
        weekVersion: weekRecord.fantasyScoringVersion,
        seasonVersion: weekRecord.season.fantasyScoringVersion,
      })
    : DEFAULT_FANTASY_SCORING_VERSION;

  const games = weekId ? await listLiveScoringGames(weekId) : [];
  const gameId =
    params.gameId && games.some((game) => game.id === params.gameId)
      ? params.gameId
      : null;

  const entries =
    weekId && gameId
      ? await listLiveScoringEntriesForGame({ weekId, gameId })
      : [];

  const serializedEntries = entries.map((entry) => ({
    ...entry,
    updatedAt: entry.updatedAt,
    startsAt: entry.startsAt,
  }));

  return (
    <Container className="py-10 sm:py-12">
      <AdminBanner />
      <AdminNav current="/admin/live-scoring" />
      <SectionHeading
        eyebrow="Live ops"
        title="Live scoring console"
        description="Enter raw player and D/ST stats during games. RankEyeQ calculates fantasy points with FANTASYTRACK_NFL_HALF_PPR_V2 and updates the public live scoreboard — without finalizing or grading."
        action={<Badge tone="warning">Manual live</Badge>}
      />

      {!selectedSeason || weeks.length === 0 ? (
        <p className="text-sm text-muted">
          Create an NFL season and week before using live scoring.
        </p>
      ) : (
        <LiveScoringConsole
          seasons={seasons.map((season) => ({
            id: season.id,
            year: season.year,
            weeks: season.weeks.map((week) => ({
              id: week.id,
              weekNumber: week.weekNumber,
              label: week.label,
            })),
          }))}
          seasonId={selectedSeason.id}
          weekId={weekId}
          gameId={gameId}
          games={games}
          entries={serializedEntries}
          scoringVersion={scoringVersion}
        />
      )}
    </Container>
  );
}

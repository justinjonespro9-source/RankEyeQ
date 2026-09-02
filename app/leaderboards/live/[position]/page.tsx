import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { isPosition } from "@/lib/contest";
import { toDbPosition } from "@/lib/contest-defaults";
import { prisma } from "@/lib/db";
import { getLivePlayerStandings } from "@/lib/live-rankiq";
import { isManualNflMode } from "@/lib/providers/nfl";

export const dynamic = "force-dynamic";

const STATUS_LABEL = {
  FINAL: "Final",
  IN_PROGRESS: "In progress",
  NOT_STARTED: "Not started",
  OTHER: "Other",
} as const;

export async function generateMetadata(
  props: PageProps<"/leaderboards/live/[position]">,
): Promise<Metadata> {
  const { position } = await props.params;
  return {
    title: `Live ${position.toUpperCase()} results`,
    description: `Provisional RankEyeQ actual standings for ${position.toUpperCase()}.`,
  };
}

export default async function LivePlayerLeaderboardPage(
  props: PageProps<"/leaderboards/live/[position]">,
) {
  const { position } = await props.params;
  if (!isPosition(position)) notFound();
  const manualMode = isManualNflMode();

  const week = await prisma.week.findFirst({
    where: {
      season: { active: true },
      status: { in: ["OPEN", "LOCKED", "COMPLETE"] },
    },
    orderBy: { weekNumber: "desc" },
  });
  const contest = week
    ? await prisma.rankIQContest.findUnique({
        where: {
          weekId_position: {
            weekId: week.id,
            position: toDbPosition(position),
          },
        },
      })
    : null;
  const standings = contest ? await getLivePlayerStandings(contest.id) : [];

  return (
    <Container className="py-12 sm:py-16">
      <SectionHeading
        eyebrow={manualMode ? "Provisional · Manual" : "Provisional actuals"}
        title={`${position.toUpperCase()} live board`}
        description={
          manualMode
            ? "Operator-entered fantasy points with competition-ranking ties. Not auto-updating from a live sports API. Not official until the week is complete."
            : "Current imported fantasy points with competition-ranking ties. Not official until the week is complete."
        }
        action={
          <Link
            href={`/leaderboards/live?position=${toDbPosition(position)}`}
            className="text-sm font-medium text-accent hover:underline"
          >
            Live ranker board
          </Link>
        }
      />

      {standings.length === 0 ? (
        <EmptyState
          title={
            manualMode
              ? "Live scoring is not available for this week."
              : "No provisional stats yet"
          }
          description={
            manualMode
              ? "An admin can paste provisional fantasy points during games. Prior-week values are not shown as live."
              : "Import player/defense week stats to populate this board."
          }
        />
      ) : (
        <ol className="divide-y divide-border rounded-lg border border-border bg-surface-elevated">
          {standings.map((row) => (
            <li
              key={row.rankableEntryId}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="font-display w-6 font-semibold text-ink">
                  {row.provisionalRank}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{row.name}</p>
                  <p className="text-xs text-muted">{row.team}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="tabular-nums font-medium text-ink">
                  {row.fantasyPoints.toFixed(1)}
                </span>
                <Badge
                  tone={
                    row.gameStatus === "FINAL"
                      ? "success"
                      : row.gameStatus === "IN_PROGRESS"
                        ? "warning"
                        : "neutral"
                  }
                >
                  {STATUS_LABEL[row.gameStatus]}
                </Badge>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Container>
  );
}

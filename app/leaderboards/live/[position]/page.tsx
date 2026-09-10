import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/layout/Container";
import {
  StandingStatusBadge,
  standingRowShellClass,
} from "@/components/live/StandingStatus";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { isPosition } from "@/lib/contest";
import { toDbPosition } from "@/lib/contest-defaults";
import { prisma } from "@/lib/db";
import { provisionalStandingStatus } from "@/lib/live-provisional";
import { getLivePlayerStandings } from "@/lib/live-rankiq";
import { isManualNflMode } from "@/lib/providers/nfl";
import { NO_INDEX } from "@/lib/seo";

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
  const pos = typeof position === "string" ? position.toLowerCase() : "qb";
  return {
    title: `Live ${pos.toUpperCase()} results`,
    description: `Provisional RankEyeQ actual standings for ${pos.toUpperCase()}.`,
    ...NO_INDEX,
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
  const fieldSize = contest?.rankingDepth ?? 10;
  const dbPosition = toDbPosition(position);

  return (
    <Container className="py-12 sm:py-16">
      <SectionHeading
        eyebrow={manualMode ? "Provisional · Manual" : "Provisional actuals"}
        title={`${position.toUpperCase()} live board`}
        description={
          manualMode
            ? "Operator-entered fantasy points with competition-ranking ties. Colors reflect current provisional standing. Not official until the week is complete."
            : "Current imported fantasy points with competition-ranking ties. Colors reflect current provisional standing. Not official until the week is complete."
        }
        action={
          <Link
            href={`/leaderboards/live?position=${dbPosition}`}
            className="text-sm font-medium text-accent-ink hover:underline"
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
              ? "An admin can enter live stats in Live Scoring. Prior-week values are not shown as live."
              : "Import player/defense week stats to populate this board."
          }
        />
      ) : (
        <ol className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface-elevated">
          {standings.map((row) => {
            const status = provisionalStandingStatus(
              row.provisionalRank,
              fieldSize,
            );
            return (
              <li
                key={row.rankableEntryId}
                className={`flex items-center justify-between gap-3 px-4 py-3 ${standingRowShellClass(status)}`}
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
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <span className="tabular-nums font-medium text-ink">
                    {row.fantasyPoints.toFixed(1)}
                  </span>
                  <StandingStatusBadge
                    status={status}
                    fieldSize={fieldSize}
                    currentRank={row.provisionalRank}
                    position={dbPosition}
                    compact
                  />
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
            );
          })}
        </ol>
      )}
    </Container>
  );
}

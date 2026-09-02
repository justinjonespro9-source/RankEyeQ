import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/layout/Container";
import { ResultsSubnav } from "@/components/layout/ResultsSubnav";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProfileLink } from "@/components/ui/ProfileLink";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { prisma } from "@/lib/db";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import { getLiveWeekRankerBoard } from "@/lib/live-rankiq";
import { competitorClassLabel } from "@/lib/profile-labels";
import { formatRankIqScore } from "@/lib/scoring";
import { toUiPosition } from "@/lib/contest-defaults";
import { isManualNflMode } from "@/lib/providers/nfl";
import { canonicalMetadata, PUBLIC_INDEX } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Live EYEQ",
  description:
    "Unofficial live EYEQ standings from provisional fantasy points for this NFL week.",
  ...PUBLIC_INDEX,
  ...canonicalMetadata("/leaderboards/live"),
};

export const dynamic = "force-dynamic";

const POSITIONS: { key: "ALL" | ContestPosition; label: string }[] = [
  { key: "ALL", label: "Overall" },
  { key: "QB", label: "QB" },
  { key: "RB", label: "RB" },
  { key: "WR", label: "WR" },
  { key: "TE", label: "TE" },
  { key: "DEF", label: "DEF" },
];

export default async function LiveLeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ weekId?: string; position?: string }>;
}) {
  const params = await searchParams;
  const manualMode = isManualNflMode();
  const weeks = await prisma.week.findMany({
    where: { season: { active: true, sport: "NFL" }, isTest: false },
    orderBy: { weekNumber: "asc" },
  });
  const weekId =
    params.weekId ??
    weeks.find((week) => week.status === "OPEN" || week.status === "LOCKED")?.id ??
    weeks[0]?.id ??
    null;
  const position = (
    POSITIONS.some((item) => item.key === params.position)
      ? params.position
      : "ALL"
  ) as "ALL" | ContestPosition;

  const provisionalCount = weekId
    ? await prisma.playerWeekStat.count({
        where: { weekId, isProvisional: true },
      }) +
      (await prisma.defenseWeekStat.count({
        where: { weekId, isProvisional: true },
      }))
    : 0;

  const rows = weekId
    ? await getLiveWeekRankerBoard(
        weekId,
        position === "ALL" ? undefined : position,
      )
    : [];

  function href(next: { weekId?: string; position?: string }) {
    const query = new URLSearchParams({
      weekId: next.weekId ?? weekId ?? "",
      position: next.position ?? position,
    });
    return `/leaderboards/live?${query.toString()}`;
  }

  const emptyTitle =
    manualMode && provisionalCount === 0 && rows.length === 0
      ? "Live scoring is not available for this week."
      : "No live standings yet";
  const emptyDescription =
    manualMode && provisionalCount === 0 && rows.length === 0
      ? "Manual mode does not auto-update from a sports feed. An admin can paste provisional fantasy points during games."
      : manualMode
        ? "Paste provisional fantasy points in admin and submit official boards to see live EYEQ."
        : "Import provisional fantasy points and submit official boards to see live EYEQ.";

  return (
    <Container className="py-12 sm:py-16">
      <SectionHeading
        eyebrow={manualMode ? "Unofficial · Manual" : "Live standings"}
        title="LIVE — Unofficial EYEQ"
        description={
          manualMode
            ? "Projected EYEQ from operator-entered provisional fantasy points. Scores are not auto-updating from a live sports API. Official scores are unchanged until Finalize Week."
            : "Projected EYEQ from current provisional fantasy points. Official scores are unchanged until Finalize Week."
        }
        action={
          <Link
            href="/results"
            className="text-sm font-medium text-accent hover:underline"
          >
            Graded results
          </Link>
        }
      />
      <ResultsSubnav />

      <div className="mb-3 flex flex-wrap gap-2">
        {weeks.map((week) => (
          <Link
            key={week.id}
            href={href({ weekId: week.id })}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              week.id === weekId
                ? "bg-accent text-white"
                : "border border-border bg-surface-elevated text-ink"
            }`}
          >
            {week.label}
          </Link>
        ))}
      </div>
      <div className="mb-6 flex flex-wrap gap-2">
        {POSITIONS.map((item) => (
          <Link
            key={item.key}
            href={href({ position: item.key })}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              position === item.key
                ? "bg-ink text-white"
                : "border border-border bg-surface-elevated text-ink"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {position !== "ALL" ? (
        <p className="mb-4 text-sm">
          <Link
            href={`/leaderboards/live/${toUiPosition(position)}`}
            className="font-medium text-accent hover:underline"
          >
            Player live board for {position} →
          </Link>
        </p>
      ) : (
        <p className="mb-4 text-sm text-muted">
          Open a position filter for the provisional player results board.
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title={emptyTitle}
          description={emptyDescription}
          actionHref="/receipts"
          actionLabel="Thursday Receipts"
        />
      ) : (
        <ol className="divide-y divide-border rounded-lg border border-border bg-surface-elevated">
          {rows.map((row) => (
            <li
              key={row.universalProfileId}
              className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="font-display w-6 font-semibold text-ink">
                  {row.rank}
                </span>
                <ProfileLink
                  username={row.username}
                  displayName={row.displayName}
                  isAi={row.profileType === "AI"}
                  isExpert={row.profileType === "BENCHMARK"}
                />
                <Badge
                  tone={
                    row.profileType === "AI" || row.profileType === "BENCHMARK"
                      ? "warning"
                      : "neutral"
                  }
                >
                  {competitorClassLabel(row.profileType)}
                </Badge>
              </div>
              <div className="grid grid-cols-3 gap-3 text-xs text-muted sm:text-right">
                <span>
                  Live EYEQ Score{" "}
                  <strong className="font-display text-base text-ink">
                    {formatRankIqScore(row.liveRankIqScore)}
                  </strong>
                </span>
                <span>
                  Top-N hits{" "}
                  <strong className="text-ink">{row.topNHits}</strong>
                </span>
                <span>
                  #1 hit{" "}
                  <strong className="text-ink">
                    {row.numberOneHit ? "Yes" : "No"}
                  </strong>
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-4 text-xs text-muted">
        {manualMode
          ? "Manual mode: live boards refresh after an admin pastes provisional points. Prior-week values are never shown as live."
          : "Movement vs previous snapshot is omitted until live snapshots are stored. Ready for future polling/revalidation when stats refresh."}
      </p>
    </Container>
  );
}

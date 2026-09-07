import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { BadgeRack } from "@/components/badges/BadgeRack";
import {
  PlayerWeeklyHistoryTable,
  WhoSawItComing,
} from "@/components/players/PlayerWeeklyHistory";
import { evaluateAthleteBadges } from "@/lib/badges";
import { getPlayerDetailById } from "@/lib/player-detail-queries";
import { formatFinishTrend } from "@/lib/player-profile";
import { NO_INDEX, publicPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ playerId: string }>;
}): Promise<Metadata> {
  const { playerId } = await params;
  const detail = await getPlayerDetailById(playerId);
  if (!detail?.entry) {
    return { title: "Player not found", ...NO_INDEX };
  }
  const pathId = detail.profilePathId;
  const name = detail.entry.name;
  return publicPageMetadata({
    title: `${name} Fantasy Performance & Weekly Rankings`,
    description: `${name} fantasy performance and weekly rankings on RankEyeQ — finishes, production, and how the field ranked them.`,
    path: `/players/${pathId}`,
  });
}

export default async function PlayerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ playerId: string }>;
  searchParams: Promise<{ seasonId?: string }>;
}) {
  const { playerId } = await params;
  const query = await searchParams;
  const seasonId = query.seasonId;

  const detail = await getPlayerDetailById(playerId, seasonId);
  if (!detail?.entry) notFound();

  const {
    entry,
    season,
    seasonPlayer,
    summary,
    recentForm,
    weeklyHistory,
    profilePathId,
  } = detail;

  const displayTeam = seasonPlayer?.team ?? entry.team;
  const hasGraded = Boolean(summary && summary.weeksRecorded > 0);
  const athleteBadges = evaluateAthleteBadges({
    summary,
    weeklyHistory,
  });

  return (
    <Container className="py-12 sm:py-16">
      <SectionHeading
        eyebrow="Player Performance"
        title={entry.name}
        description="Actual weekly fantasy production and how Public, Experts, Creators, and AI ranked this player before kickoff."
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{entry.position}</Badge>
        <Badge tone="neutral">{displayTeam}</Badge>
        {entry.type === "DEFENSE" ? (
          <Badge tone="neutral">D/ST</Badge>
        ) : null}
        {seasonPlayer ? (
          <Badge tone={seasonPlayer.activeOnNFLRoster ? "success" : "warning"}>
            {seasonPlayer.activeOnNFLRoster ? "On roster" : "Inactive"} ·{" "}
            {seasonPlayer.nflStatus}
          </Badge>
        ) : null}
        {season ? (
          <span className="text-sm text-muted">{season.year} season</span>
        ) : null}
      </div>

      <div className="mb-8">
        <BadgeRack
          badges={athleteBadges}
          title="Athlete badges"
          emptyLabel={
            hasGraded
              ? "Finish badges unlock with #1, Top 3, Top 10 weeks, and multi-week heaters."
              : "Athlete badges appear after graded weekly finishes."
          }
        />
      </div>

      {entry.headshotUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={entry.headshotUrl}
          alt=""
          className="mb-6 h-20 w-20 rounded-full object-cover"
        />
      ) : null}

      {hasGraded && summary ? (
        <dl className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            [
              "Fantasy PPG",
              summary.fantasyPpg == null ? "—" : summary.fantasyPpg.toFixed(1),
            ],
            [
              "Avg finish",
              summary.averageFinish == null
                ? "—"
                : summary.averageFinish.toFixed(1),
            ],
            [
              "Median finish",
              summary.medianFinish == null
                ? "—"
                : summary.medianFinish.toFixed(1),
            ],
            ["#1 finishes", String(summary.numberOneFinishes)],
            ["Top 3", String(summary.top3Finishes)],
            ["Top 5", String(summary.top5Finishes)],
            ["Top 10", String(summary.top10Finishes)],
            ["Best finish", summary.bestFinish ?? "—"],
            ["Worst finish", summary.worstFinish ?? "—"],
            [
              "Weeks graded",
              `${summary.weeksRecorded} / ${summary.weeksEligible}`,
            ],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-lg border border-border bg-surface-elevated px-4 py-3"
            >
              <dt className="text-xs uppercase tracking-wide text-muted">
                {label}
              </dt>
              <dd className="mt-1 font-display text-xl font-semibold tabular-nums text-ink">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="mb-8 rounded-lg border border-border bg-surface px-5 py-6">
          <h2 className="font-display text-lg font-semibold text-ink">
            Season résumé
          </h2>
          <p className="mt-2 text-sm text-muted">
            Season performance will populate after Week 1 results are graded.
          </p>
        </div>
      )}

      {recentForm ? (
        <section className="mb-8 rounded-lg border border-accent/30 bg-accent-soft/40 px-5 py-5">
          <h2 className="font-display text-lg font-semibold text-ink">
            {recentForm.label}
          </h2>
          <dl className="mt-3 grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">
                Fantasy PPG
              </dt>
              <dd className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink">
                {recentForm.fantasyPpg == null
                  ? "—"
                  : recentForm.fantasyPpg.toFixed(1)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">
                Avg finish
              </dt>
              <dd className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink">
                {recentForm.averageFinish == null
                  ? "—"
                  : recentForm.averageFinish.toFixed(1)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">
                Finish trend
              </dt>
              <dd className="mt-1 text-sm font-medium text-ink">
                {formatFinishTrend(recentForm.finishTrend) ?? "—"}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className="mb-10">
        <h2 className="font-display text-lg font-semibold text-ink">
          Week-by-week performance
        </h2>
        <p className="mt-1 text-sm text-muted">
          Competition ranking (ties share ranks such as 1, 2, 2, 4). Team is the
          week-specific franchise when available.
        </p>
        <PlayerWeeklyHistoryTable
          weeks={weeklyHistory}
          seasonId={season?.id}
        />
      </section>

      <section className="mb-10">
        <h2 className="font-display text-lg font-semibold text-ink">
          Who saw it coming
        </h2>
        <p className="mt-1 text-sm text-muted">
          Pregame selected % by participant class vs actual positional finish —
          from frozen Sunday-lock snapshots only.
        </p>
        <WhoSawItComing weeks={weeklyHistory} />
      </section>

      <p className="text-sm text-muted">
        <Link
          href={
            season
              ? `/players?seasonId=${season.id}&position=${entry.position}`
              : "/players"
          }
          className="text-accent-ink hover:underline"
        >
          ← Back to Player Performance
        </Link>
        {profilePathId !== playerId ? (
          <span className="ml-2 text-xs">· /players/{profilePathId}</span>
        ) : null}
      </p>
    </Container>
  );
}

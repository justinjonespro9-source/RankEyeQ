import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { getPlayerDetailById } from "@/lib/player-detail-queries";
import { PUBLIC_INDEX, canonicalMetadata } from "@/lib/seo";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ playerId: string }>;
}): Promise<Metadata> {
  const { playerId } = await params;
  const detail = await getPlayerDetailById(playerId);
  if (!detail?.entry) {
    return { title: "Player not found" };
  }
  return {
    title: `${detail.entry.name} · Player Performance`,
    description: `Weekly positional finishes for ${detail.entry.name} in RankEyeQ contests.`,
    ...PUBLIC_INDEX,
    ...canonicalMetadata(`/players/${playerId}`),
  };
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

  const { entry, season, seasonPlayer, summary, weeklyHistory } = detail;

  return (
    <Container className="py-12 sm:py-16">
      <SectionHeading
        eyebrow="Player performance"
        title={entry.name}
        description="Historical weekly positional finishes from RankEyeQ contests — separate from ranker leaderboards."
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{entry.position}</Badge>
        <Badge tone="neutral">{seasonPlayer?.team ?? entry.team}</Badge>
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

      {summary ? (
        <dl className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Avg finish", summary.averageFinish?.toFixed(1) ?? "—"],
            ["Median", summary.medianFinish?.toFixed(1) ?? "—"],
            ["Top 10", String(summary.top10Finishes)],
            ["#1 finishes", String(summary.numberOneFinishes)],
            ["Best", summary.bestFinish ?? "—"],
            ["Worst", summary.worstFinish ?? "—"],
            ["Weeks", `${summary.weeksRecorded} / ${summary.weeksEligible}`],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-lg border border-border bg-surface-elevated px-4 py-3"
            >
              <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
              <dd className="mt-1 font-display text-xl font-semibold tabular-nums text-ink">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mb-8 text-sm text-muted">
          No graded weekly appearances recorded yet for this filter.
        </p>
      )}

      <h2 className="font-display text-lg font-semibold text-ink">Weekly history</h2>
      <p className="mt-1 text-sm text-muted">
        Team reflects the NFL week at grading time. Consensus columns appear when
        consensus data is available.
      </p>

      {weeklyHistory.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No recorded weeks yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-surface-elevated">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-3">Week</th>
                <th className="px-3 py-3">Team</th>
                <th className="px-3 py-3">FP</th>
                <th className="px-3 py-3">Finish</th>
                <th className="px-3 py-3">Consensus</th>
                <th className="px-3 py-3">Diff</th>
              </tr>
            </thead>
            <tbody>
              {weeklyHistory.map((row) => (
                <tr
                  key={`${row.weekNumber}-${row.weekLabel}`}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-3 py-3 text-ink">{row.weekLabel}</td>
                  <td className="px-3 py-3 text-ink">{row.team}</td>
                  <td className="px-3 py-3 tabular-nums text-ink">
                    {row.fantasyPoints?.toFixed(1) ?? "—"}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-ink">{row.actualRank}</td>
                  <td className="px-3 py-3 tabular-nums text-muted">—</td>
                  <td className="px-3 py-3 tabular-nums text-muted">—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-6 text-sm text-muted">
        <Link href="/players" className="text-accent hover:underline">
          ← Back to player performance leaderboard
        </Link>
      </p>
    </Container>
  );
}

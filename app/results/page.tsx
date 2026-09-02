import type { Metadata } from "next";
import Link from "next/link";
import { ScoredPlayerRow } from "@/components/rank/ScoredPlayerRow";
import { ScoreSummary } from "@/components/rank/ScoreSummary";
import { Container } from "@/components/layout/Container";
import { ResultsSubnav } from "@/components/layout/ResultsSubnav";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProfileLink } from "@/components/ui/ProfileLink";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { getAuthContext, isAdminRole } from "@/lib/auth/session";
import {
  isAdminTestPreviewRequested,
  resolveIncludeTestWeeks,
} from "@/lib/admin/test-preview";
import { getActiveProfile } from "@/lib/active-profile";
import { prisma } from "@/lib/db";
import { getContestResultsView } from "@/lib/results-view";
import { formatRankIqScore } from "@/lib/scoring";
import { toUiPosition } from "@/lib/contest-defaults";
import { canonicalMetadata, PUBLIC_INDEX } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Results",
  description:
    "Graded weekly contest results: actual fantasy-point finishes, consensus vs actual, and top EYEQ performers for that NFL week.",
  ...PUBLIC_INDEX,
  ...canonicalMetadata("/results"),
};

export const dynamic = "force-dynamic";

export default async function ResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ contestId?: string; adminTest?: string; weekId?: string }>;
}) {
  const params = await searchParams;
  const auth = await getAuthContext();
  const includeTest = resolveIncludeTestWeeks({
    isAdmin: auth?.user?.role ? isAdminRole(auth.user.role) : false,
    adminTestPreview: isAdminTestPreviewRequested(params),
  });
  const activeProfile = await getActiveProfile();

  const contests = await prisma.rankIQContest.findMany({
    where: {
      status: { in: ["FINAL", "ARCHIVED", "GRADING"] },
      week: includeTest
        ? params.weekId
          ? { id: params.weekId, isTest: true }
          : { isTest: true }
        : { isTest: false },
    },
    include: { week: true },
    orderBy: [{ week: { weekNumber: "desc" } }, { position: "asc" }],
  });

  const selectedId = params.contestId ?? contests[0]?.id ?? null;
  const view = selectedId
    ? await getContestResultsView(selectedId, activeProfile?.id)
    : null;

  return (
    <Container className="py-12 sm:py-16">
      <SectionHeading
        eyebrow="Graded weeks"
        title="Results"
        description="Weekly results after grading: actual fantasy-point finishes, consensus comparison, and top EYEQ performers for that NFL week."
      />
      <ResultsSubnav />

      {contests.length === 0 ? (
        <EmptyState
          title="No graded contests yet"
          description="Lock a contest, enter actual ranks, and grade it in Admin to publish results."
          actionHref="/rank"
          actionLabel="Browse challenges"
        />
      ) : (
        <>
          <div className="mb-6 flex flex-wrap gap-2">
            {contests.map((contest) => (
              <Link
                key={contest.id}
                href={`/results?contestId=${contest.id}`}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  selectedId === contest.id
                    ? "bg-accent text-white"
                    : "border border-border bg-surface-elevated text-ink"
                }`}
              >
                {contest.week.label} {contest.position}
              </Link>
            ))}
          </div>

          {view ? (
            <div className="space-y-8">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  tone={
                    view.contest.status === "FINAL" ? "success" : "warning"
                  }
                >
                  {view.contest.status}
                </Badge>
                {view.contest.status !== "FINAL" &&
                view.contest.status !== "ARCHIVED" ? (
                  <Badge tone="warning">Unofficial / provisional</Badge>
                ) : null}
                <Badge tone="neutral">
                  {view.contest.week.label} · {view.contest.position}
                </Badge>
                <Badge tone="neutral">
                  Consensus n={view.consensus.sampleSize}
                </Badge>
                <Link
                  href={`/rank/${toUiPosition(view.contest.position)}`}
                  className="text-sm text-accent hover:underline"
                >
                  Ranking board
                </Link>
                <Link
                  href={`/consensus?weekId=${view.contest.weekId}&position=${view.contest.position}&view=actual`}
                  className="text-sm text-accent hover:underline"
                >
                  Consensus
                </Link>
              </div>

              <section className="rounded-lg border border-border bg-surface-elevated">
                <div className="border-b border-border px-5 py-4">
                  <h2 className="font-display text-xl font-semibold text-ink">
                    {view.contest.status === "FINAL"
                      ? "League-wide actual finishes (Top 40)"
                      : "League-wide finishes (provisional, Top 40)"}
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[52rem] text-left text-sm">
                    <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
                      <tr>
                        <th className="px-4 py-3">Actual</th>
                        <th className="px-4 py-3">Selected %</th>
                        <th className="px-4 py-3">Consensus</th>
                        <th className="px-4 py-3">Δ</th>
                        <th className="px-4 py-3">Player</th>
                        <th className="px-4 py-3">Pts</th>
                        <th className="px-4 py-3">Avg sel rank</th>
                      </tr>
                    </thead>
                    <tbody>
                      {view.leagueResults.map((entry) => (
                          <tr
                            key={entry.rankableEntryId}
                            className="border-b border-border last:border-0"
                          >
                            <td className="px-4 py-3 font-display font-semibold text-ink">
                              {entry.actualRank}
                            </td>
                            <td className="px-4 py-3 tabular-nums text-ink">
                              {entry.selectionRate == null
                                ? "—"
                                : `${(entry.selectionRate * 100).toFixed(1)}%`}
                            </td>
                            <td className="px-4 py-3 tabular-nums text-ink">
                              {entry.consensusRank ?? "—"}
                            </td>
                            <td className="px-4 py-3 tabular-nums text-ink">
                              {entry.consensusVsActual == null
                                ? "—"
                                : entry.consensusVsActual > 0
                                  ? `+${entry.consensusVsActual}`
                                  : entry.consensusVsActual}
                            </td>
                            <td className="px-4 py-3 text-ink">
                              {entry.name}{" "}
                              <span className="text-muted">{entry.team}</span>
                            </td>
                            <td className="px-4 py-3 tabular-nums text-ink">
                              {entry.fantasyPoints.toFixed(1)}
                            </td>
                            <td className="px-4 py-3 tabular-nums text-ink">
                              {entry.averageSelectedRank?.toFixed(1) ?? "—"}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="rounded-lg border border-border bg-surface-elevated">
                <div className="border-b border-border px-5 py-4">
                  <h2 className="font-display text-xl font-semibold text-ink">
                    Top top EYEQ performers
                  </h2>
                </div>
                <ol className="divide-y divide-border">
                  {view.topPerformers.map((row) => (
                    <li
                      key={row.universalProfileId}
                      className="flex items-center justify-between gap-3 px-5 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-display font-semibold text-ink">
                          {row.rank}
                        </span>
                        <ProfileLink
                          username={row.username}
                          displayName={row.displayName}
                          isAi={row.profileType === "AI"}
                        />
                      </div>
                      <span className="font-display font-semibold tabular-nums text-ink">
                        {formatRankIqScore(row.averageScore)}
                      </span>
                    </li>
                  ))}
                  {view.topPerformers.length === 0 ? (
                    <li className="px-5 py-6 text-sm text-muted">
                      No graded submissions for this contest yet.
                    </li>
                  ) : null}
                </ol>
              </section>

              {view.userScore ? (
                <section className="space-y-4">
                  <div>
                    <h2 className="font-display text-xl font-semibold text-ink">
                      Your ranking vs actual
                    </h2>
                    <p className="mt-1 text-sm text-muted">
                      Your board
                      {activeProfile ? ` (@${activeProfile.username})` : ""} ·
                      submission {view.userSubmissionStatus}
                    </p>
                  </div>
                  <ScoreSummary summary={view.userScore} />
                  <div className="rounded-lg border border-border bg-surface-elevated">
                    <ol>
                      {view.userScore.players.map((row) => (
                        <ScoredPlayerRow key={row.playerId} row={row} />
                      ))}
                    </ol>
                  </div>
                </section>
              ) : (
                <EmptyState
                  title="You didn’t submit this contest"
                  description="Public results still show standings and top performers. Select a participating profile to see your breakdown."
                />
              )}
            </div>
          ) : null}
        </>
      )}
    </Container>
  );
}

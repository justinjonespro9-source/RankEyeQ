import type { Metadata } from "next";
import Link from "next/link";
import { ScoredPlayerRow } from "@/components/rank/ScoredPlayerRow";
import { ScoreSummary } from "@/components/rank/ScoreSummary";
import { ResultsVsConsensusTable } from "@/components/results/ResultsVsConsensusTable";
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
import { publicPageMetadata } from "@/lib/seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Results",
  description:
    "Final weekly results vs consensus: actual fantasy finishes, comparison metrics, and top EYEQ performers.",
  path: "/results",
});

export const dynamic = "force-dynamic";

export default async function ResultsPage({
  searchParams,
}: {
  searchParams: Promise<{
    contestId?: string;
    adminTest?: string;
    weekId?: string;
  }>;
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
      status: { in: ["FINAL", "ARCHIVED"] },
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
        eyebrow="Postgame"
        title="Final Results vs Consensus"
        description="What actually finished — fantasy points and league ranks — with pregame consensus as the comparison layer. For market-only Selected % / ballots views, use Consensus."
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
                className={`inline-flex min-h-10 items-center rounded-md px-3 py-2 text-sm font-medium ${
                  selectedId === contest.id
                    ? "bg-accent text-ink"
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
                  Consensus n=
                  {view.consensus.totalEntryCount ?? view.consensus.sampleSize}
                  {view.consensus.contributingGroupCount != null
                    ? ` · ${view.consensus.contributingGroupCount} groups`
                    : ""}
                </Badge>
                <Link
                  href={`/rank/${toUiPosition(view.contest.position)}`}
                  className="inline-flex min-h-10 items-center text-sm text-accent-ink hover:underline"
                >
                  Ranking board
                </Link>
                <Link
                  href={`/consensus?weekId=${view.contest.weekId}&position=${view.contest.position}`}
                  className="inline-flex min-h-10 items-center text-sm text-accent-ink hover:underline"
                >
                  Pregame consensus
                </Link>
              </div>

              <section>
                <div className="mb-3">
                  <h2 className="font-display text-xl font-semibold text-ink">
                    Actual finishes vs pregame consensus
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    Actual positional finish compared with the locked pregame
                    consensus market. Vs Con. = actual − consensus (up = better
                    finish than the crowd, down = worse). Selected % / Avg sel
                    rank are pregame prediction metrics — not live stats.
                  </p>
                </div>

                {view.leagueResults.length === 0 ? (
                  <EmptyState
                    title="No finishes published yet"
                    description="Actual fantasy-point finishes appear here after grading imports complete for this contest."
                  />
                ) : (
                  <ResultsVsConsensusTable rows={view.leagueResults} />
                )}
              </section>

              <section className="rounded-lg border border-border bg-surface-elevated">
                <div className="border-b border-border px-5 py-4">
                  <h2 className="font-display text-xl font-semibold text-ink">
                    Top EYEQ performers
                  </h2>
                </div>
                <ol className="divide-y divide-border">
                  {view.topPerformers.map((row) => (
                    <li
                      key={row.universalProfileId}
                      className="flex items-center justify-between gap-3 px-5 py-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="font-display font-semibold text-ink">
                          {row.rank}
                        </span>
                        <ProfileLink
                          username={row.username}
                          displayName={row.displayName}
                          avatarUrl={row.avatarUrl}
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
                      Your submitted prediction vs actual
                    </h2>
                    <p className="mt-1 text-sm text-muted">
                      Your board
                      {activeProfile ? ` (@${activeProfile.username})` : ""} ·
                      submission {view.userSubmissionStatus}. Compared with
                      actual positional finishes (not the crowd market above).
                    </p>
                  </div>
                  <ScoreSummary summary={view.userScore} />
                  <div className="rounded-lg border border-border bg-surface-elevated">
                    <ol>
                      {view.userScore.players.map((row) => {
                        const meta = view.userPickMeta[row.playerId];
                        return (
                          <ScoredPlayerRow
                            key={row.playerId}
                            row={row}
                            fieldSize={view.userScore?.fieldSize ?? 10}
                            team={meta?.team}
                            opponent={meta?.opponent}
                            fantasyPoints={meta?.fantasyPoints}
                          />
                        );
                      })}
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

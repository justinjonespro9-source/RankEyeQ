import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/layout/Container";
import {
  ConfidenceMetricCell,
  PlayerConfidenceMetricHeader,
} from "@/components/consensus/PlayerConfidenceMetrics";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import {
  getContestConsensus,
  type ConsensusFilter,
} from "@/lib/consensus";
import { prisma } from "@/lib/db";
import { submissionIsEligible } from "@/lib/contest-lifecycle";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import { ensureWeekFullLock } from "@/lib/timing/apply-locks";
import { canViewCurrentWeekConsensus } from "@/lib/timing/board-access";
import { getAuthContext, isAdminRole } from "@/lib/auth/session";
import {
  isAdminTestPreviewRequested,
  resolveIncludeTestWeeks,
} from "@/lib/admin/test-preview";
import { formatInChicago } from "@/lib/timing/chicago";
import { trackEvent } from "@/lib/analytics";
import { canonicalMetadata, PUBLIC_INDEX } from "@/lib/seo";
import { getWeekTimingState } from "@/lib/timing/week-windows";

export const metadata: Metadata = {
  title: "Consensus",
  description:
    "Weekly community consensus: average predicted rank across this week's official RankEyeQ submissions. Not season-long or draft rankings.",
  ...PUBLIC_INDEX,
  ...canonicalMetadata("/consensus"),
};

export const dynamic = "force-dynamic";

const POSITIONS: ContestPosition[] = ["QB", "RB", "WR", "TE", "DEF"];
const FILTERS: { key: ConsensusFilter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "HUMAN", label: "Humans" },
  { key: "EXPERT", label: "Experts" },
  { key: "CREATOR", label: "Creators" },
  { key: "AI", label: "AI" },
];

export default async function ConsensusPage({
  searchParams,
}: {
  searchParams: Promise<{
    weekId?: string;
    position?: string;
    filter?: string;
    view?: string;
    test?: string;
    adminTest?: string;
  }>;
}) {
  const params = await searchParams;
  const auth = await getAuthContext();
  const includeTest = resolveIncludeTestWeeks({
    isAdmin: auth?.user?.role ? isAdminRole(auth.user.role) : false,
    adminTestPreview: isAdminTestPreviewRequested(params),
    legacyTestParam: params.test === "1",
  });
  const filter = (["ALL", "HUMAN", "AI", "EXPERT", "CREATOR"].includes(params.filter ?? "")
    ? params.filter
    : "ALL") as ConsensusFilter;
  const view = params.view === "actual" ? "actual" : "consensus";
  const position = (
    POSITIONS.includes((params.position?.toUpperCase() ?? "") as ContestPosition)
      ? params.position!.toUpperCase()
      : "QB"
  ) as ContestPosition;

  const weeks = await prisma.week.findMany({
    where: {
      season: includeTest ? undefined : { active: true, sport: "NFL" },
      isTest: includeTest ? true : false,
    },
    orderBy: { weekNumber: "asc" },
    include: { season: true },
  });

  const weekId =
    params.weekId ??
    weeks.find((week) => week.status === "OPEN")?.id ??
    weeks[0]?.id ??
    null;

  if (weekId) {
    await ensureWeekFullLock(weekId);
  }

  const selectedWeek = weeks.find((week) => week.id === weekId) ?? null;
  const timing = selectedWeek
    ? getWeekTimingState({
        rankingsOpenAt: selectedWeek.rankingsOpenAt,
        fullLockAt: selectedWeek.fullLockAt,
        revealStartsAt: selectedWeek.revealStartsAt,
        publicReleaseAt: selectedWeek.publicReleaseAt,
        weekStatus: selectedWeek.status,
      })
    : null;
  const consensusVisible = selectedWeek
    ? canViewCurrentWeekConsensus({ week: selectedWeek })
    : false;

  const contest = weekId
    ? await prisma.rankIQContest.findUnique({
        where: {
          weekId_position: { weekId, position },
        },
        include: {
          submissions: { select: { status: true } },
        },
      })
    : null;

  const submissionCount =
    contest?.submissions.filter((row) => submissionIsEligible(row.status))
      .length ?? 0;

  const consensus =
    contest && consensusVisible
      ? await getContestConsensus(contest.id, filter)
      : null;
  const expertConsensus =
    contest && consensusVisible && filter !== "EXPERT"
      ? await getContestConsensus(contest.id, "EXPERT")
      : null;
  if (consensusVisible) {
    trackEvent("consensus_viewed", { position, test: includeTest ? 1 : 0 });
  }

  const showActual =
    view === "actual" &&
    (consensus?.contestStatus === "FINAL" ||
      consensus?.contestStatus === "ARCHIVED");

  function href(next: {
    weekId?: string;
    position?: string;
    filter?: string;
    view?: string;
  }) {
    const query = new URLSearchParams({
      weekId: next.weekId ?? weekId ?? "",
      position: next.position ?? position,
      filter: next.filter ?? filter,
      view: next.view ?? view,
    });
    return `/consensus?${query.toString()}`;
  }

  return (
    <Container className="py-12 sm:py-16">
      <SectionHeading
        eyebrow="Community board"
        title="Community EYEQ"
        description="Free after Sunday 10:00 AM America/Chicago. Compare Human, Expert, and AI pregame consensus with Selected % and average selected rank. The All view blends intelligence groups with equal weight when configured."
      />

      {weeks.length === 0 ? (
        <EmptyState
          title="No weeks available"
          description="Create an active season and week in Admin to unlock consensus."
          actionHref="/how-it-works"
          actionLabel="How RankEyeQ works"
        />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            {weeks.map((week) => (
              <Link
                key={week.id}
                href={href({ weekId: week.id })}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  weekId === week.id
                    ? "bg-accent text-white"
                    : "border border-border bg-surface-elevated text-ink"
                }`}
              >
                {week.label}
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
          <div className="mb-3 flex flex-wrap gap-2">
            {FILTERS.map((item) => (
              <Link
                key={item.key}
                href={href({ filter: item.key })}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  filter === item.key
                    ? "bg-ink text-white"
                    : "border border-border bg-surface-elevated text-ink"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
          <div className="mb-6 flex flex-wrap gap-2">
            <Link
              href={href({ view: "consensus" })}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                view === "consensus"
                  ? "bg-accent text-white"
                  : "border border-border bg-surface-elevated text-ink"
              }`}
            >
              Consensus
            </Link>
            <Link
              href={href({ view: "actual" })}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                view === "actual"
                  ? "bg-accent text-white"
                  : "border border-border bg-surface-elevated text-ink"
              }`}
            >
              Actual Results
            </Link>
          </div>

          {!contest ? (
            <EmptyState
              title="No contest for this selection"
              description={`${selectedWeek?.label ?? "This week"} ${position} has not been created yet.`}
            />
          ) : !consensusVisible ? (
            <EmptyState
              title="Consensus still private"
              description={`Community EYEQ unlocks at Sunday 10:00 AM America/Chicago. ${submissionCount} official ${position} board${submissionCount === 1 ? "" : "s"} submitted so far.${
                selectedWeek?.fullLockAt
                  ? ` Lock: ${formatInChicago(selectedWeek.fullLockAt, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      timeZoneName: "short",
                    })}.`
                  : ""
              }`}
              actionHref={`/rank/${position.toLowerCase()}`}
              actionLabel="Build rankings"
            />
          ) : !consensus || consensus.sampleSize === 0 ? (
            <EmptyState
              title="No consensus yet"
              description="Official submitted weekly rankings will build the community board. Unsubmitted in-progress boards are excluded."
              actionHref={`/rank/${position.toLowerCase()}`}
              actionLabel="Build rankings"
            />
          ) : (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral">
                  {consensus.weekLabel} · {consensus.position}
                </Badge>
                <Badge tone="success">
                  Sample size {consensus.sampleSize}
                  {filter === "EXPERT" && consensus.sampleSize === 0
                    ? " (no expert boards)"
                    : ""}
                </Badge>
                {consensus.allConsensusMode ? (
                  <Badge tone="neutral">
                    All mode: {consensus.allConsensusMode}
                  </Badge>
                ) : null}
                <Badge tone="neutral">{consensus.contestStatus}</Badge>
                {timing ? <Badge tone="neutral">{timing.phase}</Badge> : null}
              </div>

              {(consensus.callouts.biggestHit ||
                consensus.callouts.biggestMiss ||
                consensus.callouts.mostPolarizing) &&
              (consensus.contestStatus === "FINAL" ||
                consensus.contestStatus === "ARCHIVED") ? (
                <div className="grid gap-3 md:grid-cols-3">
                  {consensus.callouts.biggestHit ? (
                    <Callout
                      label="Biggest consensus hit"
                      body={`${consensus.callouts.biggestHit.name} · consensus #${consensus.callouts.biggestHit.consensusRank} vs actual #${consensus.callouts.biggestHit.actualRank}`}
                    />
                  ) : null}
                  {consensus.callouts.biggestMiss ? (
                    <Callout
                      label="Biggest consensus miss"
                      body={`${consensus.callouts.biggestMiss.name} · consensus #${consensus.callouts.biggestMiss.consensusRank} vs actual #${consensus.callouts.biggestMiss.actualRank}`}
                    />
                  ) : null}
                  {consensus.callouts.mostPolarizing ? (
                    <Callout
                      label="Most polarizing"
                      body={`${consensus.callouts.mostPolarizing.name} · rank σ ${consensus.callouts.mostPolarizing.rankStdev?.toFixed(2)}`}
                    />
                  ) : null}
                </div>
              ) : null}

              <div className="table-scroll overflow-x-auto rounded-lg border border-border bg-surface-elevated">
                <table className="w-full min-w-[56rem] text-left text-sm">
                  <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-3 py-3">Consensus</th>
                      {showActual ? (
                        <th className="px-3 py-3">Actual</th>
                      ) : null}
                      <th className="px-3 py-3">Player</th>
                      <th className="px-3 py-3">Selected %</th>
                      <th className="px-3 py-3">Avg sel rank</th>
                      <th className="px-3 py-3">Team</th>
                      <th className="px-3 py-3">Opp</th>
                      <th className="px-3 py-3">Ballots</th>
                      {showActual ? (
                        <th className="px-3 py-3">Δ</th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {consensus.entries
                      .filter((entry) => entry.consensusRank != null)
                      .map((entry) => (
                        <tr
                          key={entry.rankableEntryId}
                          className="border-b border-border last:border-0"
                        >
                          <td className="px-3 py-3 font-display font-semibold text-ink">
                            {entry.consensusRank}
                          </td>
                          {showActual ? (
                            <td className="px-3 py-3 tabular-nums text-ink">
                              {entry.actualRank ?? "—"}
                            </td>
                          ) : null}
                          <td className="px-3 py-3 font-medium text-ink">
                            {entry.name}
                          </td>
                          <td className="px-3 py-3 tabular-nums text-ink">
                            {(entry.selectionRate * 100).toFixed(1)}%
                          </td>
                          <td className="px-3 py-3 tabular-nums text-ink">
                            {entry.averageSelectedRank?.toFixed(1) ?? "—"}
                          </td>
                          <td className="px-3 py-3 text-ink">{entry.team}</td>
                          <td className="px-3 py-3 text-muted">
                            {entry.opponent}
                          </td>
                          <td className="px-3 py-3 tabular-nums text-ink">
                            {entry.timesRanked}
                          </td>
                          {showActual ? (
                            <td className="px-3 py-3 tabular-nums text-ink">
                              {entry.consensusVsActual == null
                                ? "—"
                                : entry.consensusVsActual > 0
                                  ? `+${entry.consensusVsActual}`
                                  : entry.consensusVsActual}
                            </td>
                          ) : null}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {view === "actual" && !showActual ? (
                <p className="text-sm text-muted">
                  Actual finishes appear beside consensus after the contest is
                  FINAL.
                </p>
              ) : null}
            </div>
          )}

          {filter !== "EXPERT" &&
          consensusVisible &&
          expertConsensus &&
          expertConsensus.sampleSize > 0 ? (
            <div className="mt-10 space-y-4">
              <h2 className="font-display text-2xl font-semibold text-ink">
                Expert Source Consensus
              </h2>
              <p className="text-sm text-muted">
                Derived only from official on-time expert/benchmark boards.
                This is not Community EYEQ and is not FantasyPros ECR.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="warning">Expert sources</Badge>
                <Badge tone="success">
                  Sample size {expertConsensus.sampleSize}
                </Badge>
              </div>
              <div className="table-scroll overflow-x-auto rounded-lg border border-border bg-surface-elevated">
                <table className="w-full min-w-[56rem] text-left text-sm">
                  <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-3 py-3">Consensus</th>
                      <th className="px-3 py-3">Player</th>
                      <PlayerConfidenceMetricHeader kind="rankPercent" />
                      <PlayerConfidenceMetricHeader kind="podiumPercent" />
                      <PlayerConfidenceMetricHeader kind="averageRank" />
                      <th className="px-3 py-3">Sources</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expertConsensus.entries
                      .filter((entry) => entry.consensusRank != null)
                      .map((entry) => (
                        <tr
                          key={entry.rankableEntryId}
                          className="border-b border-border last:border-0"
                        >
                          <td className="px-3 py-3 font-display font-semibold text-ink">
                            {entry.consensusRank}
                          </td>
                          <td className="px-3 py-3 font-medium text-ink">
                            {entry.name}
                          </td>
                          <ConfidenceMetricCell
                            kind="rankPercent"
                            value={entry.rankPercent}
                            ordinalRank={entry.rankPercentRank}
                          />
                          <ConfidenceMetricCell
                            kind="podiumPercent"
                            value={entry.podiumPercent}
                            ordinalRank={entry.podiumPercentRank}
                          />
                          <ConfidenceMetricCell
                            kind="averageRank"
                            value={entry.averagePredictedRank}
                            ordinalRank={entry.averageRankRank}
                          />
                          <td className="px-3 py-3 tabular-nums text-ink">
                            {entry.timesRanked}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      )}
    </Container>
  );
}

function Callout({ label, body }: { label: string; body: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-accent">
        {label}
      </p>
      <p className="mt-1 text-sm text-ink">{body}</p>
    </div>
  );
}

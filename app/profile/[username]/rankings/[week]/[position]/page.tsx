import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/layout/Container";
import {
  StandingStatusBadge,
  standingRowShellClass,
} from "@/components/live/StandingStatus";
import { ScoringBoardLegend } from "@/components/live/ScoringBoardLegend";
import { LiveEyeqScore } from "@/components/live/LiveEyeqScore";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { getAuthContext } from "@/lib/auth/session";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import { getBoardIndexability } from "@/lib/board-privacy";
import { getPublicProfileBoard } from "@/lib/public-board";
import { formatRankIqScore } from "@/lib/scoring";
import { NO_INDEX, PUBLIC_INDEX } from "@/lib/seo";
import { competitorClassLabel } from "@/lib/profile-labels";
import { formatInChicago } from "@/lib/timing/chicago";

export const dynamic = "force-dynamic";

const POSITIONS: ContestPosition[] = ["QB", "RB", "WR", "TE", "DEF"];

export async function generateMetadata(
  props: PageProps<"/profile/[username]/rankings/[week]/[position]">,
): Promise<Metadata> {
  const { username, week, position } = await props.params;
  const weekNumber = Number(week);
  const pos = position.toUpperCase() as ContestPosition;
  if (!Number.isInteger(weekNumber) || !POSITIONS.includes(pos)) {
    return { title: "Rankings", ...NO_INDEX };
  }
  const indexability = await getBoardIndexability({
    username,
    weekNumber,
    position: pos,
  });
  if (!indexability.public) {
    return {
      title: `${username} rankings`,
      description: "RankEyeQ ranking board. Content is private until public release.",
      ...NO_INDEX,
    };
  }
  return {
    title: `${username} · Week ${week} ${pos} rankings`,
    description: `Public RankEyeQ board for ${username}, week ${week}, ${pos}.`,
    ...PUBLIC_INDEX,
  };
}

export default async function PublicRankingBoardPage(
  props: PageProps<"/profile/[username]/rankings/[week]/[position]">,
) {
  const { username, week, position } = await props.params;
  const weekNumber = Number(week);
  const pos = position.toUpperCase() as ContestPosition;
  if (!Number.isInteger(weekNumber) || weekNumber < 1 || !POSITIONS.includes(pos)) {
    notFound();
  }

  const auth = await getAuthContext();
  const board = await getPublicProfileBoard({
    username,
    weekNumber,
    position: pos,
    viewer: {
      profileId: auth?.universalProfile?.id ?? null,
      isAdmin: auth?.user.role === "ADMIN",
    },
  });
  if (!board) notFound();

  return (
    <Container className="py-12 sm:py-16">
      <SectionHeading
        eyebrow="Ranking board"
        title={`${board.displayName} · ${board.position}`}
        description={`${board.weekLabel} Top ${board.rankingDepth}. Privacy is enforced server-side.`}
        action={
          <Link
            href={`/profile/${board.username}`}
            className="text-sm font-medium text-accent-ink hover:underline"
          >
            Back to profile
          </Link>
        }
      />

      <div className="mb-6 flex flex-wrap gap-2">
        <Badge tone="neutral">@{board.username}</Badge>
        <Badge tone={board.profileType === "AI" ? "warning" : "success"}>
          {competitorClassLabel(board.profileType)}
        </Badge>
        <Badge tone="neutral">{board.contestStatus}</Badge>
        <Badge tone="neutral">{board.timingPhase}</Badge>
        {board.submissionStatus ? (
          <Badge tone="neutral">{board.submissionStatus}</Badge>
        ) : null}
        {board.isLiveProvisional ? (
          <Badge tone="warning">LIVE / UNOFFICIAL</Badge>
        ) : (
          <Badge tone="success">Final</Badge>
        )}
      </div>

      {!board.allowed ? (
        <EmptyState
          title={
            board.gatedPremium
              ? "Premium board — unlock required before noon."
              : "Board not public yet"
          }
          description={
            board.reason ??
            "Current-week individual rankings stay private until the Sunday reveal rules allow them."
          }
          actionHref={board.gatedPremium ? "/rankers" : "/consensus"}
          actionLabel={
            board.gatedPremium ? "Find rankers" : "View consensus timing"
          }
        />
      ) : !board.submissionStatus ? (
        <EmptyState
          title="No board for this contest"
          description={`${board.displayName} has no ${board.position} submission for ${board.weekLabel}.`}
        />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {board.submittedAt
              ? `Submitted ${formatInChicago(board.submittedAt, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  timeZoneName: "short",
                })}.`
              : "In progress — not submitted for this weekly contest."}
            {board.lockedAt
              ? ` Locked ${formatInChicago(board.lockedAt, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  timeZoneName: "short",
                })}.`
              : ""}
          </p>
          {board.captureAttribution ? (
            <p className="text-sm text-muted">
              {board.captureAttribution}
              {board.capturedAt
                ? ` · ${formatInChicago(board.capturedAt, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                    timeZoneName: "short",
                  })}`
                : ""}
              . RankEyeQ Top {board.rankingDepth} only.
            </p>
          ) : null}

          {board.isLiveProvisional && board.liveEyeq ? (
            <div className="rounded-lg border border-warning/30 bg-warning-soft/30 px-4 py-3">
              <LiveEyeqScore
                score={board.liveEyeq.score}
                resolvedCount={board.liveEyeq.resolvedCount}
                totalPicks={board.liveEyeq.totalPicks}
              />
              <p className="mt-2 text-xs text-muted">
                Unofficial — can still move as more games resolve
              </p>
            </div>
          ) : null}

          {!board.isLiveProvisional && board.finalEyeqScore != null ? (
            <div className="rounded-lg border border-border bg-surface-elevated px-4 py-3">
              <p className="text-sm font-semibold text-ink">
                EYEQ{" "}
                <span className="font-display tabular-nums">
                  {formatRankIqScore(board.finalEyeqScore)}
                </span>
              </p>
              <p className="mt-1 text-xs text-muted">Official graded weekly score</p>
            </div>
          ) : null}

          {board.publicBoardRestricted ? (
            <EmptyState
              title="Board not reproduced publicly"
              description={
                board.reason ??
                "This source ranking is stored internally. Performance metrics remain on the RankEyeQ profile."
              }
            />
          ) : (
            <div className="space-y-6">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  {board.showingStoredScoringBoard
                    ? "Scoring board"
                    : "Ranking board"}
                </p>
                {board.boardCaption ? (
                  <p className="mb-3 text-sm text-muted">{board.boardCaption}</p>
                ) : null}
                {board.showingStoredScoringBoard ? (
                  <ScoringBoardLegend />
                ) : null}
                <ol className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface-elevated">
                  {Array.from(
                    {
                      length: board.showingStoredScoringBoard
                        ? Math.max(board.picks.length, board.rankingDepth)
                        : board.rankingDepth,
                    },
                    (_, index) => {
                      const pick = board.showingStoredScoringBoard
                        ? board.picks[index]
                        : board.picks.find(
                            (row) => row.predictedRank === index + 1,
                          );
                      const status = pick?.standingStatus ?? "PENDING";
                      return (
                        <li
                          key={index + 1}
                          className={`flex items-center justify-between gap-3 px-4 py-3 ${standingRowShellClass(
                            status,
                            pick?.showExactHit ?? false,
                          )}`}
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="font-display w-6 font-semibold text-ink">
                              {pick?.predictedRank ?? index + 1}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-ink">
                                {pick?.showExactHit ? (
                                  <span
                                    className="mr-1 text-accent"
                                    aria-hidden="true"
                                  >
                                    ★
                                  </span>
                                ) : null}
                                {pick?.name ?? "Empty slot"}
                              </p>
                              {pick ? (
                                <p className="truncate text-xs text-muted">
                                  {board.showingStoredScoringBoard
                                    ? pick.fromReserve
                                      ? `Promoted from R${pick.reserveSlot} · Originally #${pick.originalPredictedRank}`
                                      : `Scoring #${pick.predictedRank}${
                                          pick.originalPredictedRank != null &&
                                          pick.originalPredictedRank !==
                                            pick.predictedRank
                                            ? ` · Originally #${pick.originalPredictedRank}`
                                            : ""
                                        }`
                                    : `#${pick.predictedRank} predicted`}
                                  {pick.currentActualRank != null
                                    ? ` · Current ${board.position}${pick.currentActualRank}`
                                    : board.isLiveProvisional
                                      ? " · Pending"
                                      : ""}
                                  {` · ${pick.team}`}
                                </p>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            {pick ? (
                              <StandingStatusBadge
                                status={status}
                                fieldSize={board.rankingDepth}
                                currentRank={pick.currentActualRank}
                                position={board.position}
                                compact
                              />
                            ) : null}
                            {pick?.fromReserve ? (
                              <Badge tone="success">
                                R{pick.reserveSlot} promoted
                              </Badge>
                            ) : null}
                            {!board.showingStoredScoringBoard &&
                            pick?.slotLocked ? (
                              <Badge tone="warning">
                                Early lock
                                {pick.lockedRank ? ` #${pick.lockedRank}` : ""}
                              </Badge>
                            ) : null}
                          </div>
                        </li>
                      );
                    },
                  )}
                </ol>
              </div>

              {board.originalAuditPicks.length > 0 ? (
                <details className="rounded-lg border border-border bg-surface px-4 py-3">
                  <summary className="cursor-pointer text-sm font-medium text-ink">
                    View original ranking
                  </summary>
                  <p className="mt-2 text-xs text-muted">
                    Immutable submitted board. Unavailable players were removed
                    from the scoring board above; predicted ranks were not
                    rewritten.
                  </p>
                  <ol className="mt-3 divide-y divide-border overflow-hidden rounded-md border border-border bg-surface-elevated">
                    {board.originalAuditPicks.map((row) => (
                      <li
                        key={`orig-${row.predictedRank}`}
                        className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm"
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-ink">
                            <span className="mr-2 font-display text-muted">
                              {row.isReserve
                                ? `R${row.reserveSlot}`
                                : row.predictedRank}
                            </span>
                            {row.name}
                            <span className="ml-1 text-xs text-muted">
                              · {row.team}
                            </span>
                          </p>
                          {row.note ? (
                            <p className="mt-0.5 text-xs text-muted">{row.note}</p>
                          ) : null}
                        </div>
                        {!row.scored ? (
                          <Badge tone="warning">Not scored</Badge>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
            </div>
          )}
        </div>
      )}
    </Container>
  );
}

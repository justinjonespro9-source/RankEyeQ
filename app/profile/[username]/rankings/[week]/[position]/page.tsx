import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { getAuthContext } from "@/lib/auth/session";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import { getBoardIndexability } from "@/lib/board-privacy";
import { getPublicProfileBoard } from "@/lib/public-board";
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
            className="text-sm font-medium text-accent hover:underline"
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
          {board.publicBoardRestricted ? (
            <EmptyState
              title="Board not reproduced publicly"
              description={
                board.reason ??
                "This source ranking is stored internally. Performance metrics remain on the RankEyeQ profile."
              }
            />
          ) : (
            <ol className="divide-y divide-border rounded-lg border border-border bg-surface-elevated">
              {Array.from({ length: board.rankingDepth }, (_, index) => {
                const pick = board.picks.find(
                  (row) => row.predictedRank === index + 1,
                );
                return (
                  <li
                    key={index + 1}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="font-display w-6 font-semibold text-accent">
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">
                          {pick?.name ?? "Empty slot"}
                        </p>
                        {pick ? (
                          <p className="truncate text-xs text-muted">
                            {pick.team} · {pick.opponent}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    {pick?.slotLocked ? (
                      <Badge tone="warning">
                        Early lock
                        {pick.lockedRank ? ` #${pick.lockedRank}` : ""}
                      </Badge>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </Container>
  );
}

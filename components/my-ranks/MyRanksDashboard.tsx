import Link from "next/link";
import { LiveEyeqScore } from "@/components/live/LiveEyeqScore";
import {
  StandingStatusBadge,
  standingRowShellClass,
} from "@/components/live/StandingStatus";
import { Badge } from "@/components/ui/Badge";
import { formatRankIqScore } from "@/lib/scoring";
import { toUiPosition } from "@/lib/contest-defaults";
import type { MyRanksPositionDashboard } from "@/lib/my-ranks";
import type { ContestPosition } from "@/lib/generated/prisma/client";

const POSITIONS: ContestPosition[] = ["QB", "RB", "WR", "TE", "DEF"];

export function MyRanksPositionTabs({
  active,
  weekId,
  hrefForPosition,
}: {
  active: ContestPosition;
  weekId?: string;
  /** Override tab href builder (admin control room). */
  hrefForPosition?: (position: ContestPosition) => string;
}) {
  return (
    <div className="mb-6 flex flex-wrap gap-2">
      {POSITIONS.map((position) => {
        const href = hrefForPosition
          ? hrefForPosition(position)
          : (() => {
              const params = new URLSearchParams({
                position: position.toLowerCase(),
              });
              if (weekId) params.set("weekId", weekId);
              return `/my-ranks?${params.toString()}`;
            })();
        const selected = position === active;
        return (
          <Link
            key={position}
            href={href}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              selected
                ? "bg-ink text-off-white"
                : "border border-border bg-surface-elevated text-ink hover:border-ink/30"
            }`}
          >
            {position}
          </Link>
        );
      })}
    </div>
  );
}

function EmptyPanel({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface px-4 py-6 text-sm text-muted">
      <p className="font-medium text-ink">{title}</p>
      <p className="mt-1">{description}</p>
    </div>
  );
}

export function MyRanksDashboard({
  dashboard,
  variant = "user",
}: {
  dashboard: MyRanksPositionDashboard;
  /** Admin control room hides user edit CTA. */
  variant?: "user" | "admin";
}) {
  const uiPos = toUiPosition(dashboard.position).toUpperCase();
  const standingsLabel = dashboard.isFinal
    ? "Final Position Results"
    : "Live Position Standings";
  const perfectLabel = dashboard.isFinal
    ? "Perfect Board"
    : "Perfect Board Right Now";
  const perfectSub = dashboard.isFinal
    ? "Official Top finishes for this week."
    : "If the week ended now.";

  return (
    <div className="space-y-6">
      {/* 1. LIVE EYEQ summary */}
      <section className="rounded-lg border border-border bg-surface-elevated px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="mb-2 flex flex-wrap gap-2">
              <Badge tone={dashboard.isFinal ? "success" : "warning"}>
                {dashboard.isFinal ? "Final" : "LIVE / UNOFFICIAL"}
              </Badge>
              {dashboard.submissionStatus ? (
                <Badge
                  tone={
                    dashboard.submissionStatus === "LOCKED" ||
                    dashboard.submissionStatus === "GRADED"
                      ? "warning"
                      : "neutral"
                  }
                >
                  {dashboard.submissionStatus === "LOCKED" ||
                  dashboard.contestStatus === "LOCKED" ||
                  dashboard.contestStatus === "LIVE"
                    ? "LOCKED"
                    : dashboard.submissionStatus}
                </Badge>
              ) : (
                <Badge tone="neutral">No submission</Badge>
              )}
            </div>
            {dashboard.eyeq ? (
              dashboard.eyeq.isLive ? (
                <LiveEyeqScore
                  score={dashboard.eyeq.score}
                  resolvedCount={dashboard.eyeq.resolvedCount}
                  totalPicks={dashboard.eyeq.totalPicks}
                />
              ) : (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">
                    EYEQ
                  </p>
                  <p className="font-display text-lg font-semibold tabular-nums text-ink">
                    {formatRankIqScore(dashboard.eyeq.score)}
                  </p>
                </div>
              )
            ) : (
              <p className="text-sm text-muted">
                {dashboard.picks.length === 0
                  ? variant === "admin"
                    ? "No submission for this position."
                    : "Submit a board on This Week to track live EYEQ here."
                  : "Waiting for live scores on picks."}
              </p>
            )}
          </div>
          {variant === "user" ? (
            <Link
              href={`/rank/${toUiPosition(dashboard.position)}`}
              className="text-sm font-medium text-accent-ink hover:underline"
            >
              {dashboard.isFinal ? "Back to This Week" : "Edit on This Week"}
            </Link>
          ) : null}
        </div>
      </section>

      {/* Desktop: your board + standings side-by-side; mobile stacks */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="font-display text-lg font-semibold text-ink">
            Your Rankings
          </h2>
          <p className="mt-1 text-sm text-muted">
            Predicted order with current {uiPos} standing colors.
          </p>
          {dashboard.picks.length === 0 ? (
            <div className="mt-3">
              <EmptyPanel
                title={`No ${dashboard.position} board submitted`}
                description={
                  variant === "admin"
                    ? "Use Manage Rankings to import or capture this position through the existing workflow."
                    : "Build or submit this position on This Week, then return here for live tracking."
                }
              />
              {variant === "user" ? (
                <Link
                  href={`/rank/${toUiPosition(dashboard.position)}`}
                  className="mt-3 inline-block text-sm font-medium text-accent-ink hover:underline"
                >
                  Go to This Week →
                </Link>
              ) : null}
            </div>
          ) : (
            <>
            <ol className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface-elevated">
              {dashboard.picks
                .filter((pick) => !pick.isReserve)
                .map((pick) => (
                <li
                  key={pick.rankableEntryId}
                  className={`flex items-start justify-between gap-3 px-3 py-3 sm:px-4 ${standingRowShellClass(
                    pick.standingStatus,
                    pick.showExactHit,
                  )}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">
                      {pick.showExactHit ? (
                        <span className="mr-1 text-accent" aria-hidden="true">
                          ★
                        </span>
                      ) : null}
                      <span className="font-display tabular-nums text-muted">
                        #{pick.predictedRank}
                      </span>{" "}
                      {pick.name}
                      {pick.displaced ? (
                        <span className="ml-2 text-xs font-semibold uppercase tracking-wide text-warning">
                          OUT · displaced
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {pick.team}
                      {pick.fantasyPoints != null
                        ? ` · ${pick.fantasyPoints.toFixed(1)} pts`
                        : ""}
                      {pick.currentActualRank != null
                        ? ` · Current ${dashboard.position}${pick.currentActualRank}`
                        : " · Pending"}
                    </p>
                  </div>
                  <StandingStatusBadge
                    status={pick.standingStatus}
                    fieldSize={dashboard.rankingDepth}
                    currentRank={pick.currentActualRank}
                    position={dashboard.position}
                    compact
                  />
                </li>
              ))}
            </ol>
            {dashboard.picks.some((p) => p.isReserve) ? (
              <div className="mt-4">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Reserves
                </h3>
                {dashboard.activations.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-xs text-muted">
                    {dashboard.activations.map((a) => (
                      <li key={`${a.reserveSlot}-${a.effectiveRank}`}>
                        R{a.reserveSlot} {a.reserveName} → activated to{" "}
                        {dashboard.position}
                        {a.effectiveRank}. Replaced: {a.replacedName}
                        {a.replacedAvailability
                          ? ` (${a.replacedAvailability})`
                          : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <ol className="mt-2 divide-y divide-border overflow-hidden rounded-lg border border-dashed border-border bg-surface">
                  {dashboard.picks
                    .filter((pick) => pick.isReserve)
                    .map((pick) => (
                      <li
                        key={pick.rankableEntryId}
                        className="flex items-start justify-between gap-3 px-3 py-3 sm:px-4"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-ink">
                            <span className="font-display tabular-nums text-muted">
                              R{pick.reserveSlot}
                            </span>{" "}
                            {pick.name}
                            {pick.activatedToRank != null ? (
                              <span className="ml-2 text-xs font-medium text-success">
                                → {dashboard.position}
                                {pick.activatedToRank}
                              </span>
                            ) : null}
                          </p>
                          <p className="mt-0.5 text-xs text-muted">
                            {pick.team}
                            {pick.replacedName
                              ? ` · Replaced ${pick.replacedName}`
                              : " · Reserve"}
                          </p>
                        </div>
                      </li>
                    ))}
                </ol>
              </div>
            ) : null}
            </>
          )}
        </section>

        <section>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-lg font-semibold text-ink">
              {standingsLabel}
            </h2>
            {!dashboard.isFinal ? (
              <Badge tone="warning">LIVE / UNOFFICIAL</Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted">
            {dashboard.isFinal
              ? "Official positional finishes."
              : "Players with recorded live fantasy points only."}
          </p>
          {dashboard.standings.length === 0 ? (
            <div className="mt-3">
              <EmptyPanel
                title="No live scores yet"
                description="Standings appear after admin live stats (or final results) are recorded."
              />
            </div>
          ) : (
            <ol className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface-elevated">
              {dashboard.standings.map((row) => (
                <li
                  key={row.rankableEntryId}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 sm:px-4"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="font-display w-6 font-semibold tabular-nums text-ink">
                      {row.rank}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{row.name}</p>
                      <p className="text-xs text-muted">{row.team}</p>
                    </div>
                  </div>
                  <span className="shrink-0 tabular-nums font-medium text-ink">
                    {row.fantasyPoints.toFixed(1)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {/* Perfect board */}
      <section className="rounded-lg border border-border bg-surface-elevated p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-lg font-semibold text-ink">
            {perfectLabel}
          </h2>
          {!dashboard.isFinal ? (
            <Badge tone="warning">LIVE / UNOFFICIAL</Badge>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-muted">{perfectSub}</p>
        <p className="mt-1 text-xs text-muted">
          Current Top {dashboard.rankingDepth} {dashboard.position} — same live
          standings, not a separate ranking engine.
        </p>
        {dashboard.perfectBoard.length === 0 ? (
          <div className="mt-3">
            <EmptyPanel
              title="Perfect board unavailable"
              description="Needs at least one scored player at this position."
            />
          </div>
        ) : (
          <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {dashboard.perfectBoard.map((row) => (
              <li
                key={`perfect-${row.rankableEntryId}`}
                className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm"
              >
                <span className="min-w-0 truncate">
                  <span className="font-display font-semibold tabular-nums text-muted">
                    #{row.rank}
                  </span>{" "}
                  <span className="font-medium text-ink">{row.name}</span>
                  <span className="text-muted"> · {row.team}</span>
                </span>
                <span className="shrink-0 tabular-nums text-ink">
                  {row.fantasyPoints.toFixed(1)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

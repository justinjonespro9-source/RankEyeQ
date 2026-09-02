import Link from "next/link";
import { StatusPill } from "@/components/admin/StatusPill";
import { Button } from "@/components/ui/Button";
import type { getCommandCenterSnapshot } from "@/lib/admin/command-center";

type Snapshot = Awaited<ReturnType<typeof getCommandCenterSnapshot>>;

export function WeekOperationalStatusPanel({ snapshot }: { snapshot: Snapshot }) {
  const week = snapshot.week;
  const season = snapshot.activeSeason;

  if (!week || !season) {
    return (
      <section className="mb-8 rounded-lg border border-dashed border-border bg-surface-elevated p-5">
        <h2 className="font-display text-lg font-semibold text-ink">
          Current week status
        </h2>
        <p className="mt-2 text-sm text-muted">
          Select or create a week to see operational status.
        </p>
        <Button href="/admin/seasons" size="sm" className="mt-4" variant="secondary">
          Seasons & weeks
        </Button>
      </section>
    );
  }

  const poolsReady =
    snapshot.data?.poolsBuilt && (snapshot.data?.missingKickoff ?? 0) === 0;

  const humanSubmitted = snapshot.humanMonitoring.reduce(
    (sum, row) => sum + row.submitted + row.locked + row.graded,
    0,
  );

  const aiSubmitted = snapshot.bots?.submittedBoards ?? 0;
  const aiExpected = snapshot.bots?.expectedBoards ?? 0;

  const resultsStatus = snapshot.finalize?.ready
    ? "Ready"
    : snapshot.data?.gamesFinal === snapshot.data?.gamesTotal &&
        (snapshot.data?.gamesTotal ?? 0) > 0
      ? "Pending grade"
      : "Not available";

  const gradingStatus = snapshot.humanMonitoring.every(
    (row) => row.contestStatus === "FINAL" || row.contestStatus === "ARCHIVED",
  )
    ? "Complete"
    : snapshot.finalize?.ready
      ? "Ready"
      : "Pending";

  return (
    <section className="mb-8 rounded-lg border border-border bg-surface-elevated p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Operational status
          </p>
          <h2 className="mt-1 font-display text-2xl font-semibold text-ink">
            {season.year} · {week.label}
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button href={`/admin/weekly-pools?weekId=${week.id}`} size="sm" variant="secondary">
            Weekly pools
          </Button>
          <Button href={`/admin/ai?weekId=${week.id}`} size="sm" variant="secondary">
            AI submissions
          </Button>
          <Button href={`/admin/data?weekId=${week.id}`} size="sm" variant="secondary">
            NFL data
          </Button>
          <Button href="/admin/contests" size="sm" variant="secondary">
            Contests
          </Button>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {snapshot.humanMonitoring.map((contest) => (
          <Link
            key={contest.contestId}
            href={`/admin/contests/${contest.contestId}`}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
          >
            <span className="font-semibold text-ink">{contest.position}</span>
            <span className="ml-2 text-muted">{contest.contestStatus}</span>
          </Link>
        ))}
      </div>

      <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
          <dt className="text-muted">Player pools</dt>
          <dd>
            <StatusPill status={poolsReady ? "Complete" : "Needs Attention"} />
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
          <dt className="text-muted">Ranker submissions</dt>
          <dd className="font-medium tabular-nums text-ink">{humanSubmitted}</dd>
        </div>
        <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
          <dt className="text-muted">AI cards</dt>
          <dd className="font-medium tabular-nums text-ink">
            {aiSubmitted}/{aiExpected}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
          <dt className="text-muted">Results import</dt>
          <dd className="font-medium text-ink">{resultsStatus}</dd>
        </div>
        <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
          <dt className="text-muted">Grading</dt>
          <dd>
            <StatusPill
              status={
                gradingStatus === "Complete"
                  ? "Complete"
                  : gradingStatus === "Ready"
                    ? "Ready"
                    : "Needs Attention"
              }
            />
          </dd>
        </div>
        <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
          <dt className="text-muted">Reveal window</dt>
          <dd className="font-medium text-ink">
            {snapshot.lockReveal?.revealWindowActive ? "Active" : "Inactive"}
          </dd>
        </div>
      </dl>
    </section>
  );
}

// Default export alias for admin page import
export { WeekOperationalStatusPanel as WeekOperationalStatus };

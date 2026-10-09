import type { Metadata } from "next";
import Link from "next/link";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { WaiverContestOpenPanel } from "@/components/admin/waivers/WaiverContestOpenPanel";
import { WaiverSnapshotImportPanel } from "@/components/admin/waivers/WaiverSnapshotImportPanel";
import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { privatePageMetadata } from "@/lib/seo";
import { formatInChicago, toChicagoDateTimeLocal } from "@/lib/timing/chicago";
import { loadWaiverAdminWeeks, loadWaiverWeekOps } from "@/lib/waivers/snapshot/queries";

export const metadata: Metadata = privatePageMetadata(
  "Waivers · Admin",
  "Freeze and correct the Official Waiver ownership snapshot and open Waiver contests.",
);

export const dynamic = "force-dynamic";

function when(value: Date | null | undefined) {
  if (!value) return "—";
  return formatInChicago(value, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

function Cell({ label, value, alert = false }: { label: string; value: string | number; alert?: boolean }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className={`font-medium tabular-nums ${alert ? "text-danger" : "text-ink"}`}>{value}</dd>
    </div>
  );
}

export default async function AdminWaiversPage({ searchParams }: { searchParams: Promise<{ weekId?: string }> }) {
  const params = await searchParams;
  const weeks = await loadWaiverAdminWeeks();
  const weekId = params.weekId ?? weeks.find((week) => !week.isTest && (week.status === "OPEN" || week.status === "UPCOMING"))?.id ?? weeks[0]?.id ?? null;
  const ops = weekId ? await loadWaiverWeekOps(weekId) : null;

  return (
    <Container className="py-12 sm:py-16">
      <AdminBanner />
      <AdminNav current="/admin/waivers" />
      <SectionHeading
        eyebrow="Weekly Ops"
        title="Waivers"
        description="Freeze the week's Official Waiver ownership snapshot, correct it as a new version, and open Waiver contests as a separate step. Nothing here grades, scrapes or changes Rankings."
      />

      <p className="mb-4 text-sm">
        <Link href={`/admin/waivers/artifacts${weekId ? `?weekId=${weekId}` : ""}`} className="text-accent-ink hover:underline">
          Canonical artifacts (SNG) →
        </Link>
      </p>
      <div className="mb-6 flex flex-wrap gap-2">
        {weeks.map((week) => (
          <Link
            key={week.id}
            href={`/admin/waivers?weekId=${week.id}`}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${week.id === ops?.week.id ? "bg-accent text-ink" : "border border-border bg-surface-elevated text-ink"}`}
          >
            {week.label}
            {week.isTest ? " (test)" : ""}
          </Link>
        ))}
      </div>

      {!ops ? (
        <p className="text-sm text-muted">No week selected.</p>
      ) : (
        <div className="space-y-6">
          <section className="rounded-lg border border-border bg-surface-elevated p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl font-semibold text-ink">
                {ops.week.label} · {ops.week.seasonYear}
              </h2>
              <Badge tone="neutral">{ops.week.status}</Badge>
              {ops.week.isTest ? <Badge tone="warning">Test week</Badge> : null}
              <Badge tone={ops.readiness.lockPassed ? "danger" : ops.readiness.lockResolvable ? "accent" : "warning"}>
                {ops.readiness.lockPassed ? "Waiver lock passed" : ops.readiness.lockResolvable ? "Before lock" : "Lock unresolvable"}
              </Badge>
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
              <Cell label="Scheduled games" value={ops.readiness.scheduledGames} alert={ops.readiness.scheduledGames === 0} />
              <Cell label="Postponed / canceled" value={`${ops.readiness.postponedGames} / ${ops.readiness.canceledGames}`} />
              <Cell label="First kickoff" value={when(ops.readiness.firstKickoff)} />
              <Cell label="Waiver lock" value={when(ops.readiness.locksAt)} />
              <Cell label="Roster sync" value={when(ops.readiness.rosterSyncedAt)} alert={ops.readiness.rosterStale} />
              <Cell label="Availability rows / latest" value={`${ops.readiness.availabilityRows} / ${when(ops.readiness.latestAvailabilityAt)}`} />
            </dl>
          </section>

          <section className="rounded-lg border border-border bg-surface-elevated p-5">
            <h3 className="font-display text-lg font-semibold text-ink">Snapshot versions</h3>
            {ops.versions.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No snapshot frozen for this week.</p>
            ) : (
              <table className="mt-3 w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="py-1">Version</th>
                    <th className="py-1">Status</th>
                    <th className="py-1">Observed</th>
                    <th className="py-1">Frozen</th>
                    <th className="py-1">By</th>
                    <th className="py-1">Eligible / candidates / follow-ups</th>
                    <th className="py-1">Correction</th>
                  </tr>
                </thead>
                <tbody>
                  {ops.versions.map((version) => (
                    <tr key={version.id} className="border-t border-border">
                      <td className="py-1">
                        <Link href={`/admin/waivers/snapshots/${version.id}`} className="text-accent-ink hover:underline">
                          v{version.version}
                        </Link>
                      </td>
                      <td className="py-1">
                        <Badge tone={version.currentForWeekId ? "success" : "neutral"}>{version.currentForWeekId ? "CURRENT" : version.status}</Badge>
                      </td>
                      <td className="py-1">{when(version.observedAt)}</td>
                      <td className="py-1">{when(version.frozenAt)}</td>
                      <td className="py-1">{version.frozenBy}</td>
                      <td className="py-1 tabular-nums">
                        {version.eligibleCount} / {version.candidateCount} / {version.followUpCount}
                      </td>
                      <td className="py-1 text-xs text-muted">{version.correctionCase ? `${version.correctionCase}: ${version.correctionReason ?? ""}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {ops.current ? (
              <p className="mt-3 text-sm">
                <Link href={`/admin/waivers/snapshots/${ops.current.id}`} className="text-accent-ink hover:underline">
                  Inspect or correct the current version (v{ops.current.version})
                </Link>
              </p>
            ) : null}
          </section>

          <section className="rounded-lg border border-border bg-surface-elevated p-5">
            <h3 className="font-display text-lg font-semibold text-ink">Waiver contests</h3>
            {ops.contests.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No contests opened.</p>
            ) : (
              <table className="mt-3 w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="py-1">Pos</th>
                    <th className="py-1">Status</th>
                    <th className="py-1">Pinned version</th>
                    <th className="py-1">Locks</th>
                    <th className="py-1">Submitted</th>
                    <th className="py-1">Drafts</th>
                  </tr>
                </thead>
                <tbody>
                  {ops.contests.map((contest) => (
                    <tr key={contest.id} className="border-t border-border tabular-nums">
                      <td className="py-1 font-medium text-ink">{contest.position}</td>
                      <td className="py-1">
                        <Badge tone={contest.status === "OPEN" ? "accent" : "neutral"}>{contest.status}</Badge>
                      </td>
                      <td className="py-1">v{contest.snapshotVersion}</td>
                      <td className="py-1">{when(contest.locksAt)}</td>
                      <td className="py-1">
                        {contest.submitted}
                        {contest.aiSubmitted > 0 ? <span className="text-muted"> (incl. {contest.aiSubmitted} AI)</span> : null}
                      </td>
                      <td className="py-1">{contest.drafts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {ops.current && ops.canOpenContests ? (
            <WaiverContestOpenPanel
              weekId={ops.week.id}
              snapshotId={ops.current.id}
              snapshotVersion={ops.current.version}
              unopenedPositions={ops.unopenedPositions}
              locksAtLabel={when(ops.readiness.locksAt)}
            />
          ) : null}

          {!ops.current ? <WaiverSnapshotImportPanel weekId={ops.week.id} defaultObservedAt={toChicagoDateTimeLocal(ops.now)} /> : null}
        </div>
      )}
    </Container>
  );
}

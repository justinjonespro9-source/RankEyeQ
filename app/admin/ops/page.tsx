import type { Metadata } from "next";
import Link from "next/link";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { getOpsDashboard, type OpsStatus } from "@/lib/admin/ops-dashboard";
import { prisma } from "@/lib/db";
import { formatInChicago } from "@/lib/timing/chicago";

export const metadata: Metadata = {
  title: "Weekly ops",
  description: "RankEyeQ weekly operations dashboard.",
};

export const dynamic = "force-dynamic";

function toneFor(status: OpsStatus) {
  if (status === "Complete") return "success" as const;
  if (status === "Ready") return "success" as const;
  return "warning" as const;
}

export default async function AdminOpsPage({
  searchParams,
}: {
  searchParams: Promise<{ weekId?: string }>;
}) {
  const params = await searchParams;
  const weeks = await prisma.week.findMany({
    where: { season: { active: true } },
    orderBy: { weekNumber: "asc" },
  });
  const weekId = params.weekId ?? weeks[0]?.id ?? null;
  const dashboard = weekId ? await getOpsDashboard(weekId) : null;

  return (
    <Container className="py-12 sm:py-16">
      <AdminBanner />
      <AdminNav current="/admin/ops" />
      <SectionHeading
        eyebrow="Operations"
        title="Weekly ops dashboard"
        description="Timing, submissions, bots, and data readiness for all five position contests."
      />

      {weeks.length === 0 || !dashboard ? (
        <EmptyState
          title="No weeks configured"
          description="Create an active NFL week to see operations status."
          actionHref="/admin/seasons"
          actionLabel="Seasons & Weeks"
        />
      ) : (
        <>
          <div className="mb-6 flex flex-wrap gap-2">
            {weeks.map((week) => (
              <Link
                key={week.id}
                href={`/admin/ops?weekId=${week.id}`}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  week.id === weekId
                    ? "bg-accent text-white"
                    : "border border-border bg-surface-elevated text-ink"
                }`}
              >
                {week.label}
              </Link>
            ))}
          </div>

          <section className="mb-8 rounded-lg border border-border bg-surface-elevated p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl font-semibold text-ink">
                {dashboard.week.label}
              </h2>
              <Badge tone="neutral">{dashboard.week.status}</Badge>
              <Badge tone="neutral">{dashboard.week.phase}</Badge>
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <TimingCell
                label="Open"
                value={dashboard.week.rankingsOpenAt}
              />
              <TimingCell label="Sunday lock" value={dashboard.week.fullLockAt} />
              <TimingCell
                label="Reveal start"
                value={dashboard.week.revealStartsAt}
              />
              <TimingCell
                label="Public release"
                value={dashboard.week.publicReleaseAt}
              />
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted">
                  Games final
                </dt>
                <dd className="mt-1 text-ink">
                  {dashboard.week.gamesFinal} / {dashboard.week.gamesTotal}
                </dd>
              </div>
            </dl>
          </section>

          <section className="mb-8 overflow-x-auto rounded-lg border border-border bg-surface-elevated">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-3">Pos</th>
                  <th className="px-3 py-3">Contest</th>
                  <th className="px-3 py-3">Eligible</th>
                  <th className="px-3 py-3">Drafts</th>
                  <th className="px-3 py-3">Submitted</th>
                  <th className="px-3 py-3">Partial lock</th>
                  <th className="px-3 py-3">Fully locked</th>
                  <th className="px-3 py-3">Graded</th>
                  <th className="px-3 py-3">Stats</th>
                  <th className="px-3 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.positions.map((row) => (
                  <tr key={row.position} className="border-b border-border last:border-0">
                    <td className="px-3 py-3 font-medium text-ink">
                      {row.position}
                    </td>
                    <td className="px-3 py-3 text-ink">{row.contestStatus}</td>
                    <td className="px-3 py-3 tabular-nums">{row.eligibleEntries}</td>
                    <td className="px-3 py-3 tabular-nums">{row.drafts}</td>
                    <td className="px-3 py-3 tabular-nums">{row.submitted}</td>
                    <td className="px-3 py-3 tabular-nums">
                      {row.partiallyLockedBoards}
                    </td>
                    <td className="px-3 py-3 tabular-nums">
                      {row.fullyLockedBoards}
                    </td>
                    <td className="px-3 py-3 tabular-nums">{row.gradedBoards}</td>
                    <td className="px-3 py-3">
                      {row.statsReady ? "Ready" : "Needs Attention"}
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={toneFor(row.status)}>{row.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-lg border border-border bg-surface-elevated p-5">
              <h3 className="font-display text-lg font-semibold text-ink">
                Bots
              </h3>
              <p className="mt-1 text-sm text-muted">
                {dashboard.bots.expected} AI profiles expected
              </p>
              <ul className="mt-3 space-y-2 text-sm">
                {Object.entries(dashboard.bots.completedByPosition).map(
                  ([position, count]) => (
                    <li key={position} className="text-ink">
                      {position}: {count} submitted
                      {dashboard.bots.missingByPosition[position]?.length
                        ? ` · missing ${dashboard.bots.missingByPosition[position].join(", ")}`
                        : ""}
                    </li>
                  ),
                )}
              </ul>
            </section>
            <section className="rounded-lg border border-border bg-surface-elevated p-5">
              <h3 className="font-display text-lg font-semibold text-ink">
                Data
              </h3>
              <Badge tone={toneFor(dashboard.data.status)}>
                {dashboard.data.status}
              </Badge>
              <ul className="mt-3 space-y-1 text-sm text-ink">
                <li>
                  Schedule imported: {dashboard.data.scheduleImported ? "Yes" : "No"}
                </li>
                <li>
                  Player pools built: {dashboard.data.poolsBuilt ? "Yes" : "No"}
                </li>
                <li>
                  Stats available: {dashboard.data.statsAvailable ? "Yes" : "No"}
                </li>
                <li>Provisional rows: {dashboard.data.provisionalRows}</li>
                <li>Missing stats: {dashboard.data.missingStats}</li>
                <li>
                  Ready to finalize: {dashboard.data.readyToFinalize ? "Yes" : "No"}
                </li>
              </ul>
            </section>
          </div>
        </>
      )}
    </Container>
  );
}

function TimingCell({ label, value }: { label: string; value: Date | null }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 text-ink">
        {value
          ? formatInChicago(value, {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              timeZoneName: "short",
            })
          : "—"}
      </dd>
    </div>
  );
}

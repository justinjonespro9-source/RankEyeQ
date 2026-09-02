import type { Metadata } from "next";
import Link from "next/link";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { prisma } from "@/lib/db";
import { getWeeklyExceptionReview } from "@/lib/nfl/weekly-exceptions";
import { getWeeklyEligibilitySyncStatus } from "@/lib/nfl/weekly-auto-sync";

export const metadata: Metadata = {
  title: "Weekly exceptions",
  description: "Admin review for weekly pool data-integrity exceptions.",
};

export const dynamic = "force-dynamic";

export default async function AdminWeeklyExceptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ weekId?: string }>;
}) {
  const params = await searchParams;
  const activeSeason = await prisma.season.findFirst({
    where: { active: true, sport: "NFL" },
    include: { weeks: { orderBy: { weekNumber: "asc" } } },
  });

  const weekId =
    params.weekId ??
    activeSeason?.weeks.find((week) => week.status === "OPEN")?.id ??
    activeSeason?.weeks[0]?.id ??
    null;

  const review =
    weekId != null ? await getWeeklyExceptionReview(weekId) : null;
  const syncStatus =
    weekId != null ? await getWeeklyEligibilitySyncStatus(weekId) : null;

  return (
    <Container className="py-10 sm:py-12">
      <AdminBanner />
      <AdminNav current="/admin/weekly-exceptions" />
      <SectionHeading
        eyebrow="Exception review"
        title="Weekly pool exceptions"
        description="Normal eligible players require no action. Review exclusions, mapping failures, and missing weekly entries only."
      />

      {!activeSeason || !weekId ? (
        <p className="text-sm text-muted">No active NFL week configured.</p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {activeSeason.weeks.map((week) => (
              <Link
                key={week.id}
                href={`/admin/weekly-exceptions?weekId=${week.id}`}
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

          {syncStatus ? (
            <div className="mb-6 flex flex-wrap gap-2">
              <Badge tone={syncStatus.hasSchedule ? "success" : "warning"}>
                {syncStatus.hasSchedule ? "Schedule loaded" : "No schedule"}
              </Badge>
              <Badge tone="neutral">
                {syncStatus.activePoolEntries} active pool entries
              </Badge>
              <Badge tone="neutral">
                {syncStatus.adminExclusions} admin exclusions
              </Badge>
              <Link
                href={`/admin/weekly-pools?weekId=${weekId}`}
                className="text-sm text-accent hover:underline"
              >
                Re-sync weekly field
              </Link>
            </div>
          ) : null}

          {review ? (
            <div className="space-y-4">
              <p className="text-sm text-muted">
                {review.summary.normalEligibleEntries} players are in the active
                field with {review.summary.exceptionCount} exception
                {review.summary.exceptionCount === 1 ? "" : "s"} to review.
              </p>

              {review.exceptions.length === 0 ? (
                <p className="rounded-lg border border-border bg-surface-elevated px-4 py-6 text-sm text-muted">
                  No exceptions — weekly field looks healthy for {review.week.label}.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border bg-surface-elevated">
                  <table className="w-full min-w-[48rem] text-left text-sm">
                    <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
                      <tr>
                        <th className="px-3 py-3">Type</th>
                        <th className="px-3 py-3">Pos</th>
                        <th className="px-3 py-3">Name</th>
                        <th className="px-3 py-3">Reason</th>
                        <th className="px-3 py-3">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {review.exceptions.map((row, index) => (
                        <tr
                          key={`${row.kind}-${row.name}-${index}`}
                          className="border-b border-border last:border-0"
                        >
                          <td className="px-3 py-3 text-ink">{row.kind}</td>
                          <td className="px-3 py-3 text-ink">{row.position}</td>
                          <td className="px-3 py-3 font-medium text-ink">
                            {row.name}
                            {row.team ? (
                              <span className="text-muted"> · {row.team}</span>
                            ) : null}
                          </td>
                          <td className="px-3 py-3 text-muted">{row.reason}</td>
                          <td className="px-3 py-3">
                            {row.href ? (
                              <Link
                                href={row.href}
                                className="text-accent hover:underline"
                              >
                                Review
                              </Link>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </>
      )}
    </Container>
  );
}

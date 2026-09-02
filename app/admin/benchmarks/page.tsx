import type { Metadata } from "next";
import Link from "next/link";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { StatusPill } from "@/components/admin/StatusPill";
import { Container } from "@/components/layout/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { getBenchmarkCoverage } from "@/lib/benchmarks/coverage";
import { prisma } from "@/lib/db";
import { CONTEST_POSITIONS } from "@/lib/contest-defaults";

export const metadata: Metadata = {
  title: "Benchmarks · Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminBenchmarksPage({
  searchParams,
}: {
  searchParams: Promise<{ weekId?: string }>;
}) {
  const params = await searchParams;
  const weeks = await prisma.week.findMany({
    where: { season: { active: true } },
    orderBy: { weekNumber: "asc" },
    include: { contests: true },
  });
  const weekId =
    params.weekId ??
    weeks.find((week) => week.status === "OPEN")?.id ??
    weeks[0]?.id ??
    null;
  const week = weeks.find((item) => item.id === weekId) ?? null;
  const coverage = weekId ? await getBenchmarkCoverage(weekId) : null;
  const contestByPosition = new Map(
    (week?.contests ?? []).map((contest) => [contest.position, contest.id]),
  );

  return (
    <Container className="py-12 sm:py-16">
      <AdminBanner />
      <AdminNav current="/admin/benchmarks" />
      <SectionHeading
        eyebrow="Expert sources"
        title="Benchmark ranking coverage"
        description="Manual capture of publicly published expert rankings. EYEQ scores them independently. Missing positions can be marked Not Available — they do not block Finalize Week."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {weeks.map((item) => (
          <Link
            key={item.id}
            href={`/admin/benchmarks?weekId=${item.id}`}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              item.id === weekId
                ? "bg-accent text-white"
                : "border border-border bg-surface-elevated text-ink"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {!coverage || !week ? (
        <p className="text-sm text-muted">Select a week with contests.</p>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted">
            Expected boards {coverage.expectedBoards} · captured{" "}
            {coverage.capturedBoards} · fully locked {coverage.fullyLockedBoards} ·
            graded {coverage.gradedBoards} · sources missing one or more positions{" "}
            {coverage.sourcesMissingPositions.length}
          </p>
          <div className="overflow-x-auto rounded-lg border border-border bg-surface-elevated">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Source</th>
                  {CONTEST_POSITIONS.map((position) => (
                    <th key={position} className="px-3 py-2">
                      {position}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {coverage.rows.map((row) => (
                  <tr
                    key={row.profileId}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-3 py-2 font-medium text-ink">
                      {row.displayName}
                      <span className="block text-xs text-muted">
                        {row.capturedCount}/{row.expectedCount} captured
                      </span>
                    </td>
                    {CONTEST_POSITIONS.map((position) => {
                      const contestId = contestByPosition.get(position);
                      const status = row.cells[position];
                      const late = row.lateCells.includes(position);
                      return (
                        <td key={position} className="px-3 py-2">
                          {contestId ? (
                            <Link
                              href={`/admin/benchmarks/${row.profileId}/${contestId}`}
                              className="inline-flex flex-col items-start gap-1 hover:underline"
                            >
                              <StatusPill status={status} />
                              {late ? (
                                <span className="text-[10px] uppercase tracking-wide text-warning">
                                  Late
                                </span>
                              ) : null}
                            </Link>
                          ) : (
                            <StatusPill status="Not Started" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Container>
  );
}

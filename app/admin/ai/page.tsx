import type { Metadata } from "next";
import Link from "next/link";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { CopyButton } from "@/components/admin/CopyButton";
import { StatusPill } from "@/components/admin/StatusPill";
import { Container } from "@/components/layout/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { getBotCoverage } from "@/lib/admin/bot-coverage";
import { loadWeekAiPrompts } from "@/lib/admin/ai-prompt-data";
import { prisma } from "@/lib/db";
import { CONTEST_POSITIONS } from "@/lib/contest-defaults";
import { formatEligiblePlayerPool } from "@/lib/admin/ai-prompt";

export const metadata: Metadata = {
  title: "AI rankings · Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminAiPage({
  searchParams,
}: {
  searchParams: Promise<{ weekId?: string; profileId?: string }>;
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
  const coverage = weekId ? await getBotCoverage(weekId) : null;
  const selectedBot =
    coverage?.rows.find((row) => row.profileId === params.profileId) ??
    coverage?.rows[0] ??
    null;
  const prompts =
    weekId && selectedBot
      ? await loadWeekAiPrompts(weekId, selectedBot.displayName)
      : null;
  const contestByPosition = new Map(
    (week?.contests ?? []).map((contest) => [contest.position, contest.id]),
  );

  return (
    <Container className="py-12 sm:py-16">
      <AdminBanner />
      <AdminNav current="/admin/ai" />
      <SectionHeading
        eyebrow="Bots"
        title="AI ranking workflow"
        description="Generate copy-ready prompts from the live contest pool, then parse and submit on the existing RankingSubmission path."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {weeks.map((item) => (
          <Link
            key={item.id}
            href={`/admin/ai?weekId=${item.id}`}
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
            All bots complete: {coverage.allBotsComplete ? "Yes" : "No"} ·{" "}
            {coverage.submittedBoards}/{coverage.expectedBoards} submitted ·{" "}
            {coverage.lockedBoards} locked · {coverage.gradedBoards} graded
          </p>
          <div className="overflow-x-auto rounded-lg border border-border bg-surface-elevated">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Bot</th>
                  {CONTEST_POSITIONS.map((position) => (
                    <th key={position} className="px-3 py-2">
                      {position}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {coverage.rows.map((row) => (
                  <tr key={row.profileId} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-medium text-ink">
                      {row.displayName}
                      <span className="block text-xs text-muted">
                        {row.submittedCount}/{row.expectedCount} submitted
                      </span>
                    </td>
                    {CONTEST_POSITIONS.map((position) => {
                      const contestId = contestByPosition.get(position);
                      const status = row.cells[position];
                      return (
                        <td key={position} className="px-3 py-2">
                          {contestId ? (
                            <Link
                              href={`/admin/ai/${row.profileId}/${contestId}`}
                              className="inline-flex items-center gap-2 hover:underline"
                            >
                              <StatusPill status={status} />
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

          {selectedBot && prompts ? (
            <section className="mt-8 rounded-lg border border-border bg-surface-elevated p-5">
              <h2 className="font-display text-lg font-semibold text-ink">
                Copy prompts · {selectedBot.displayName}
              </h2>
              <div className="mt-3 flex flex-wrap gap-2">
                <CopyButton
                  text={prompts.combined}
                  label="Copy all position prompts"
                />
              </div>
              <div className="mt-4 space-y-4">
                {prompts.prompts.map((item) => (
                  <div key={item.position} className="rounded-md border border-border p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium text-ink">{item.position}</p>
                      <div className="flex flex-wrap gap-2">
                        <CopyButton text={item.prompt} label="Copy prompt" />
                        <CopyButton
                          text={formatEligiblePlayerPool(item.pool)}
                          label="Copy player pool"
                        />
                      </div>
                    </div>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs text-muted">
                      {item.prompt}
                    </pre>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </Container>
  );
}

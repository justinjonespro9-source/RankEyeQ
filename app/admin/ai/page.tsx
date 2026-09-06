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
import { RANKEYEQ_AI_WEEKLY_PROMPT_VERSION } from "@/lib/admin/ai-prompt";
import { prisma } from "@/lib/db";
import { CONTEST_POSITIONS } from "@/lib/contest-defaults";
import type { ContestPosition } from "@/lib/generated/prisma/client";

export const metadata: Metadata = {
  title: "AI rankings · Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminAiPage({
  searchParams,
}: {
  searchParams: Promise<{
    weekId?: string;
    profileId?: string;
    position?: string;
  }>;
}) {
  const params = await searchParams;
  const weeks = await prisma.week.findMany({
    where: { season: { active: true } },
    orderBy: { weekNumber: "asc" },
    include: { contests: true, season: true },
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
  const positionParam = (params.position ?? "").toUpperCase();
  const selectedPosition = (
    CONTEST_POSITIONS.includes(positionParam as ContestPosition)
      ? positionParam
      : "RB"
  ) as ContestPosition;

  const generatedAt = new Date();
  const prompts =
    weekId && selectedBot
      ? await loadWeekAiPrompts(weekId, selectedBot.displayName, generatedAt)
      : null;
  const contestByPosition = new Map(
    (week?.contests ?? []).map((contest) => [contest.position, contest.id]),
  );
  const focusedPrompt =
    prompts?.prompts.find((item) => item.position === selectedPosition) ?? null;

  return (
    <Container className="py-12 sm:py-16">
      <AdminBanner />
      <AdminNav current="/admin/ai" />
      <SectionHeading
        eyebrow="Bots"
        title="AI ranking workflow"
        description={`Canonical ${RANKEYEQ_AI_WEEKLY_PROMPT_VERSION} prompts from the live contest pool. Same eligible field and scoring rules for every AI competitor — then parse/submit on the RankingSubmission path.`}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {weeks.map((item) => (
          <Link
            key={item.id}
            href={hrefAi({
              weekId: item.id,
              profileId: selectedBot?.profileId,
              position: selectedPosition,
            })}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              item.id === weekId
                ? "bg-accent text-ink"
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

          <div className="mb-4 flex flex-wrap gap-2">
            {coverage.rows.map((row) => (
              <Link
                key={row.profileId}
                href={hrefAi({
                  weekId: week.id,
                  profileId: row.profileId,
                  position: selectedPosition,
                })}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  row.profileId === selectedBot?.profileId
                    ? "bg-ink text-off-white"
                    : "border border-border bg-surface-elevated text-ink"
                }`}
              >
                {row.displayName}
              </Link>
            ))}
          </div>

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
                  <tr
                    key={row.profileId}
                    className="border-b border-border last:border-0"
                  >
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
            <section className="mt-8 space-y-4 rounded-lg border border-border bg-surface-elevated p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-lg font-semibold text-ink">
                    Canonical prompt · {selectedBot.displayName}
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    Same pool snapshot and instructions for every AI on this week.
                  </p>
                </div>
                <CopyButton
                  text={prompts.combined}
                  label="Copy all position prompts"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {CONTEST_POSITIONS.map((position) => (
                  <Link
                    key={position}
                    href={hrefAi({
                      weekId: week.id,
                      profileId: selectedBot.profileId,
                      position,
                    })}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                      position === selectedPosition
                        ? "bg-accent-soft text-ink"
                        : "border border-border bg-surface text-ink"
                    }`}
                  >
                    {position}
                  </Link>
                ))}
              </div>

              {focusedPrompt ? (
                <>
                  <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <MetaItem label="AI identity" value={selectedBot.displayName} />
                    <MetaItem
                      label="Season / week"
                      value={`${week.season.year} · ${week.label}`}
                    />
                    <MetaItem
                      label="Position / field size"
                      value={`${focusedPrompt.meta.position} · Top ${focusedPrompt.meta.fieldSize}`}
                    />
                    <MetaItem
                      label="Eligible pool"
                      value={`${focusedPrompt.meta.eligiblePoolCount} players`}
                    />
                    <MetaItem
                      label="Prompt version"
                      value={focusedPrompt.meta.version}
                    />
                    <MetaItem
                      label="Generated"
                      value={focusedPrompt.meta.generatedAtLabel}
                    />
                  </dl>

                  <div className="flex flex-wrap gap-2">
                    <CopyButton text={focusedPrompt.prompt} label="Copy Prompt" />
                    <CopyButton
                      text={focusedPrompt.poolText}
                      label="Copy player pool"
                    />
                    {contestByPosition.get(selectedPosition) ? (
                      <Link
                        href={`/admin/ai/${selectedBot.profileId}/${contestByPosition.get(selectedPosition)}`}
                        className="inline-flex items-center rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:border-ink/30"
                      >
                        Open parse / submit
                      </Link>
                    ) : null}
                  </div>

                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface p-3 text-xs text-muted">
                    {focusedPrompt.prompt}
                  </pre>
                </>
              ) : (
                <p className="text-sm text-muted">
                  No {selectedPosition} contest for this week yet.
                </p>
              )}
            </section>
          ) : null}
        </>
      )}
    </Container>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-medium text-ink">{value}</dd>
    </div>
  );
}

function hrefAi(input: {
  weekId: string;
  profileId?: string;
  position?: string;
}) {
  const query = new URLSearchParams();
  query.set("weekId", input.weekId);
  if (input.profileId) query.set("profileId", input.profileId);
  if (input.position) query.set("position", input.position);
  return `/admin/ai?${query.toString()}`;
}

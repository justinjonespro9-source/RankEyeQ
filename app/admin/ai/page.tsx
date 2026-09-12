import type { Metadata } from "next";
import Link from "next/link";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { CopyButton } from "@/components/admin/CopyButton";
import { StatusPill } from "@/components/admin/StatusPill";
import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SectionHeading } from "@/components/ui/SectionHeading";
import {
  setCompetitorActiveAction,
  updateCompetitorMetadataAction,
} from "@/lib/admin-competitor-actions";
import { getBotCoverage } from "@/lib/admin/bot-coverage";
import { loadWeekAiPrompts } from "@/lib/admin/ai-prompt-data";
import { RANKEYEQ_AI_WEEKLY_PROMPT_VERSION } from "@/lib/admin/ai-prompt";
import { listAiCompetitorIdentities } from "@/lib/ai-identity";
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
    created?: string;
    username?: string;
    error?: string;
    updated?: string;
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
      ? await loadWeekAiPrompts(weekId, selectedBot.displayName, generatedAt, {
          universalProfileId: selectedBot.profileId,
        })
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
        action={
          <Link
            href="/admin/competitors/new?type=ai"
            className="inline-flex min-h-10 items-center rounded-md bg-accent px-3 py-2 text-sm font-medium text-ink"
          >
            Add AI competitor
          </Link>
        }
      />

      {params.created === "1" ? (
        <p className="mb-4 rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent-ink">
          AI competitor created
          {params.username ? ` (@${params.username})` : ""}. It appears in coverage when
          competitorActive.
        </p>
      ) : null}
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

      <AiCompetitorDirectory />
    </Container>
  );
}

async function AiCompetitorDirectory() {
  const rows = await listAiCompetitorIdentities();

  return (
    <section className="mt-12">
      <h2 className="font-display text-lg font-semibold text-ink">
        AI competitor directory
      </h2>
      <p className="mt-1 text-sm text-muted">
        Deactivate to remove from weekly coverage without deleting historical
        submissions. Display name feeds the public AI · model chip.
      </p>
      <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-surface-elevated">
        <table className="w-full min-w-[48rem] text-left text-sm">
          <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-3">AI</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Graded</th>
              <th className="px-3 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.universalProfileId}
                className="border-b border-border align-top last:border-0"
              >
                <td className="px-3 py-3">
                  <p className="font-medium text-ink">{row.displayName}</p>
                  <p className="text-xs text-muted">@{row.username}</p>
                  {row.bio ? (
                    <p className="mt-1 text-xs text-muted">{row.bio}</p>
                  ) : null}
                </td>
                <td className="px-3 py-3">
                  <Badge tone={row.competitorActive ? "success" : "warning"}>
                    {row.competitorActive ? "Active" : "Inactive"}
                  </Badge>
                  {!row.publicVisible ? (
                    <Badge tone="neutral" className="ml-1">
                      Hidden
                    </Badge>
                  ) : null}
                </td>
                <td className="px-3 py-3 tabular-nums">{row.gradedSubmissions}</td>
                <td className="px-3 py-3">
                  <div className="flex flex-col gap-2">
                    <form action={setCompetitorActiveAction}>
                      <input type="hidden" name="type" value="ai" />
                      <input
                        type="hidden"
                        name="universalProfileId"
                        value={row.universalProfileId}
                      />
                      <input type="hidden" name="returnTo" value="/admin/ai" />
                      <input
                        type="hidden"
                        name="active"
                        value={row.competitorActive ? "false" : "true"}
                      />
                      <Button type="submit" variant="secondary" className="text-xs">
                        {row.competitorActive ? "Deactivate" : "Activate"}
                      </Button>
                    </form>
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted hover:text-ink">
                        Edit metadata
                      </summary>
                      <form
                        action={updateCompetitorMetadataAction}
                        className="mt-2 grid gap-2 rounded-md border border-border bg-surface p-2"
                      >
                        <input type="hidden" name="type" value="ai" />
                        <input
                          type="hidden"
                          name="universalProfileId"
                          value={row.universalProfileId}
                        />
                        <input type="hidden" name="returnTo" value="/admin/ai" />
                        <input
                          name="displayName"
                          defaultValue={row.displayName}
                          className="rounded border border-border bg-surface-elevated px-2 py-1"
                        />
                        <input
                          name="avatarUrl"
                          defaultValue={row.avatarUrl ?? ""}
                          placeholder="Avatar URL"
                          className="rounded border border-border bg-surface-elevated px-2 py-1"
                        />
                        <input
                          name="bio"
                          defaultValue={row.bio ?? ""}
                          placeholder="Version notes"
                          className="rounded border border-border bg-surface-elevated px-2 py-1"
                        />
                        <input type="hidden" name="publicVisible" value="false" />
                        <label className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            name="publicVisible"
                            value="true"
                            defaultChecked={row.publicVisible}
                          />
                          Public visible
                        </label>
                        <Button type="submit" className="text-xs">
                          Save
                        </Button>
                      </form>
                    </details>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
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

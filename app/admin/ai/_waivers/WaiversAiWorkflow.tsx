import Link from "next/link";
import { CopyButton } from "@/components/admin/CopyButton";
import { Badge } from "@/components/ui/Badge";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { formatInChicago } from "@/lib/timing/chicago";
import { WAIVEREYEQ_AI_PROMPT_VERSION, WAIVER_AI_COMPETITIVE_OVERRIDE_LABEL, WAIVER_AI_LATE_ENTRY_LABEL } from "@/lib/waivers/ai/constants";
import { loadWaiverAiAdminWeeks, loadWaiverAiWeekView, type WaiverAiBoardStatus } from "@/lib/waivers/ai/queries";

function when(value: Date): string {
  return formatInChicago(value, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

const STATUS_TONE: Record<WaiverAiBoardStatus, "neutral" | "success" | "warning" | "accent" | "danger"> = {
  MISSING: "warning",
  DRAFT: "neutral",
  SUBMITTED: "success",
  LOCKED: "accent",
  EVIDENCE_ONLY: "danger",
};

const STATUS_LABEL: Record<WaiverAiBoardStatus, string> = {
  MISSING: "Missing",
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  LOCKED: "Locked",
  EVIDENCE_ONLY: "Evidence only",
};

/** WaiverEyeQ AI administration: coverage, frozen-pool prompts and links to per-board pages. */
export async function WaiversAiWorkflow({ weekId }: { weekId: string | null }) {
  const weeks = await loadWaiverAiAdminWeeks();
  const selected = weeks.find((week) => week.id === weekId) ?? weeks[0] ?? null;
  const view = selected ? await loadWaiverAiWeekView(selected.id) : null;

  return (
    <>
      <SectionHeading
        eyebrow="Bots"
        title="AI WaiverEyeQ workflow"
        description={`${WAIVEREYEQ_AI_PROMPT_VERSION} prompts are generated only from each contest's pinned frozen snapshot. AI boards are system-operated, append-only and stay out of the human consensus.`}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {weeks.map((week) => (
          <Link
            key={week.id}
            href={`/admin/ai?discipline=waivers&weekId=${encodeURIComponent(week.id)}`}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${week.id === selected?.id ? "bg-accent text-ink" : "border border-border bg-surface-elevated text-ink"}`}
          >
            {week.seasonYear} · {week.label}
            {week.isTest ? " (test)" : ""}
          </Link>
        ))}
      </div>

      {!view ? (
        <p className="text-sm text-muted">No weeks have Waiver contests yet.</p>
      ) : (
        <div className="space-y-8">
          <section className="rounded-lg border border-border bg-surface-elevated p-5">
            <h2 className="text-lg font-semibold text-ink">AI coverage · {view.week.label}</h2>
            <p className="mt-1 text-sm text-muted">
              {view.totals.submitted} submitted · {view.totals.locked} locked · {view.totals.evidenceOnly} evidence only ·{" "}
              {view.totals.missing} missing of {view.totals.expected} active AI boards. Evidence-only records are never boards. Inactive AIs
              are listed only when they have records for this week and are not counted.
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
              <li>Normal AI submissions close when each contest locks.</li>
              <li>
                After the lock, an admin can still enter a missing AI board from its board page by checking “Allow late AI submission”.
              </li>
              <li>A late submission never replaces a board the AI already has.</li>
              <li>
                Late submissions close once grading begins for the week.
                {view.gradingStarted ? <span className="font-medium text-ink"> Grading has begun for this week, so they are closed.</span> : null}
              </li>
              <li>Late submissions are marked “Admin override” here and in the board history.</li>
              <li>Each AI board page keeps the frozen prompt available to admins, including after the lock.</li>
            </ul>
            {view.competitors.length === 0 ? (
              <p className="mt-3 text-sm text-muted">No active AI competitors.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[40rem] text-left text-sm">
                  <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="py-2 pr-3">AI competitor</th>
                      {view.contests.map((contest) => (
                        <th key={contest.contestId} className="px-2 py-2">
                          {contest.position}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {view.competitors.map((competitor) => (
                      <tr key={competitor.id} className="border-b border-border last:border-0">
                        <td className="py-2 pr-3">
                          <span className="font-medium text-ink">{competitor.displayName}</span>{" "}
                          <span className="text-xs text-muted">@{competitor.username}</span>
                          {!competitor.active ? <span className="ml-2 text-xs text-muted">(inactive · not counted)</span> : null}
                        </td>
                        {view.contests.map((contest) => {
                          const cell = view.cells[competitor.id]?.[contest.position];
                          return (
                            <td key={contest.contestId} className="px-2 py-2">
                              {cell ? (
                                <Link href={`/admin/waivers/ai/${competitor.id}/${contest.contestId}`} className="inline-flex flex-col gap-0.5">
                                  <Badge tone={STATUS_TONE[cell.status]}>{STATUS_LABEL[cell.status]}</Badge>
                                  {cell.lateEntered ? (
                                    <Badge tone="warning" title={WAIVER_AI_LATE_ENTRY_LABEL}>
                                      Late-entered
                                    </Badge>
                                  ) : null}
                                  {cell.overridden ? (
                                    <Badge tone="danger" title={WAIVER_AI_COMPETITIVE_OVERRIDE_LABEL}>
                                      Admin override
                                    </Badge>
                                  ) : null}
                                  <span className="text-xs text-muted">
                                    {cell.revisionNumber !== null ? `r${cell.revisionNumber} · ${cell.callCount} pick${cell.callCount === 1 ? "" : "s"}` : ""}
                                    {cell.evidenceCount > 0 ? `${cell.revisionNumber !== null ? " · " : ""}${cell.evidenceCount} evidence` : ""}
                                  </span>
                                </Link>
                              ) : (
                                <span className="text-xs text-muted">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-ink">Frozen-pool prompts</h2>
            <p className="text-sm text-muted">
              One prompt per position, identical for every AI, built from the contest&apos;s frozen player pool. The sha256 identifies the exact prompt
              text. Copy prompts here while a contest is open; after the lock, open any AI&apos;s board page to view or copy its prompt.
            </p>
            {view.contests.map((contest) => (
              <article key={contest.contestId} className="rounded-lg border border-border bg-surface-elevated p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-ink">
                      {contest.position} <Badge tone={contest.phase === "OPEN" ? "success" : "neutral"}>{contest.phase === "OPEN" ? "Open" : "Locked"}</Badge>
                    </h3>
                    <p className="mt-1 text-xs text-muted">
                      Locks {when(contest.locksAt)} · {contest.poolSize} eligible · up to {contest.availableSlots} pick{contest.availableSlots === 1 ? "" : "s"}
                    </p>
                  </div>
                  {contest.promptText ? <CopyButton text={contest.promptText} label="Copy Prompt" /> : null}
                </div>
                <dl className="mt-3 grid gap-1 font-mono text-xs text-muted sm:grid-cols-2">
                  <div>
                    <dt className="inline">snapshot </dt>
                    <dd className="inline">
                      v{contest.snapshot.version} · {contest.snapshot.entriesFingerprint}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">{contest.promptVersion} sha256 </dt>
                    <dd className="inline break-all">{contest.promptSha256}</dd>
                  </div>
                </dl>
                {contest.promptText ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm text-muted">Show prompt</summary>
                    <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface p-3 font-mono text-xs">{contest.promptText}</pre>
                  </details>
                ) : (
                  <p className="mt-3 text-xs text-muted">
                    {view.gradingStarted
                      ? "Locked and grading has begun: AI submissions are closed. The prompt stays available on each AI board page."
                      : "Locked: normal AI submissions are closed. Open an AI's board page to view this prompt or make a late AI submission."}
                  </p>
                )}
              </article>
            ))}
          </section>
        </div>
      )}
    </>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { ManualOpsPanel } from "@/components/admin/ManualOpsPanel";
import { ResultsWorkflowPanel } from "@/components/admin/ResultsWorkflowPanel";
import { OpenWeekRankingsPanel } from "@/components/admin/OpenWeekRankingsPanel";
import { ReadinessChecklistPanel } from "@/components/admin/ReadinessChecklistPanel";
import { StatusPill } from "@/components/admin/StatusPill";
import { Container } from "@/components/layout/Container";
import { Button } from "@/components/ui/Button";
import { ConfirmSubmit } from "@/components/ui/ConfirmSubmit";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { getCommandCenterSnapshot } from "@/lib/admin/command-center";
import {
  commandArchiveWeekAction,
  commandCreateWeekAction,
  commandEnsureContestsAction,
  commandUpdateWeekTimingAction,
} from "@/lib/admin-command-actions";
import { isManualNflMode } from "@/lib/providers/nfl";
import { WeekOperationalStatus } from "@/components/admin/WeekOperationalStatus";
import {
  formatInChicago,
  RANKIQ_TIMEZONE,
  toChicagoDateTimeLocal,
} from "@/lib/timing/chicago";

export const metadata: Metadata = {
  title: "Admin command center",
  description: "Weekly RankEyeQ operator workflow.",
};

export const dynamic = "force-dynamic";

export default async function AdminCommandCenterPage({
  searchParams,
}: {
  searchParams: Promise<{ weekId?: string; notice?: string; error?: string }>;
}) {
  const params = await searchParams;
  const snapshot = await getCommandCenterSnapshot(params.weekId);
  const week = snapshot.week;
  const manualMode = isManualNflMode();
  const previousWeekId =
    snapshot.activeSeason?.weeks
      .filter((item) => week && item.weekNumber < week.weekNumber)
      .sort((a, b) => b.weekNumber - a.weekNumber)[0]?.id ?? null;

  return (
    <Container className="py-12 sm:py-16">
      <AdminBanner />
      <AdminNav current="/admin" />
      <SectionHeading
        eyebrow="Operator"
        title="Weekly command center"
        description={
          manualMode
            ? "Manual NFL data mode: paste schedule/pools/results, then lock, grade, and finalize — no paid sports API."
            : "One flow for NFL week setup, data, AI boards, lock/reveal, live stats, and finalization."
        }
      />

      {params.notice ? (
        <p className="mb-4 rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent">
          {params.notice}
        </p>
      ) : null}
      {params.error ? (
        <p className="mb-4 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning">
          {params.error}
        </p>
      ) : null}

      <div className="mb-6 flex flex-wrap gap-2">
        {(snapshot.activeSeason?.weeks ?? []).map((item) => (
          <Link
            key={item.id}
            href={`/admin?weekId=${item.id}`}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              item.id === snapshot.selectedWeekId
                ? "bg-accent text-white"
                : "border border-border bg-surface-elevated text-ink"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      <WeekOperationalStatus snapshot={snapshot} />

      {snapshot.readinessChecklist && snapshot.readinessChecklist.length > 0 ? (
        <ReadinessChecklistPanel items={snapshot.readinessChecklist} />
      ) : null}

      {week && snapshot.openReadiness ? (
        <OpenWeekRankingsPanel
          weekId={week.id}
          weekLabel={week.label}
          readiness={snapshot.openReadiness}
        />
      ) : null}

      {snapshot.steps.length > 0 ? (
        <ol className="mb-8 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {snapshot.steps.map((step, index) => (
            <li
              key={step.key}
              id={`step-${step.key}`}
              className="rounded-lg border border-border bg-surface-elevated p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {index + 1}. {step.label}
                </p>
                <StatusPill status={step.status} />
              </div>
              <p className="mt-2 text-sm text-ink">{step.summary}</p>
              {step.href ? (
                <Link
                  href={step.href}
                  className="mt-2 inline-block text-xs font-medium text-accent hover:underline"
                >
                  Open →
                </Link>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      <section className="mb-8 grid gap-6 lg:grid-cols-2">
        <form
          action={commandCreateWeekAction}
          className="space-y-3 rounded-lg border border-border bg-surface-elevated p-5"
        >
          <h2 className="font-display text-lg font-semibold text-ink">
            1. Create week
          </h2>
          <p className="text-sm text-muted">
            NFL timing auto-fills Tuesday open, Sunday 10:00 AM lock/reveal, and
            noon public release (America/Chicago). Duplicate week numbers are blocked.
          </p>
          <label className="block text-sm">
            <span className="text-muted">Season</span>
            <select
              name="seasonId"
              required
              defaultValue={snapshot.activeSeason?.id}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
            >
              {snapshot.seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.sport} {season.year}
                  {season.active ? " (active)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-muted">Week number</span>
            <input
              name="weekNumber"
              type="number"
              min={1}
              required
              defaultValue={(snapshot.activeSeason?.weeks.length ?? 0) + 1}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Label</span>
            <input
              name="label"
              placeholder="Week 2"
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Starts (Chicago)</span>
            <input
              name="startsAt"
              type="datetime-local"
              required
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Ends (Chicago)</span>
            <input
              name="endsAt"
              type="datetime-local"
              required
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
            />
          </label>
          <input type="hidden" name="status" value="OPEN" />
          <Button type="submit" disabled={!snapshot.activeSeason}>
            Create week
          </Button>
        </form>

        {week ? (
          <div className="space-y-3 rounded-lg border border-border bg-surface-elevated p-5">
          <form
            action={commandUpdateWeekTimingAction}
            className="space-y-3"
            id="timing"
          >
            <h2 className="font-display text-lg font-semibold text-ink">
              Edit timing · {week.label}
            </h2>
            <p className="text-sm text-muted">
              Timezone: {RANKIQ_TIMEZONE}. Adjust rankings open without editing source code.
            </p>
            {snapshot.timingDisplay?.warnings.map((warning) => (
              <p
                key={warning.code}
                className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning"
              >
                {warning.message}
              </p>
            ))}
            <input type="hidden" name="weekId" value={week.id} />
            <label className="block text-sm">
              <span className="text-muted">Label</span>
              <input
                name="label"
                defaultValue={week.label}
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              <span className="text-muted">Status</span>
              <select
                name="status"
                defaultValue={week.status}
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
              >
                {["UPCOMING", "OPEN", "LOCKED", "COMPLETE", "ARCHIVED"].map(
                  (status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ),
                )}
              </select>
            </label>
            {(
              [
                ["startsAt", "Starts", week.startsAt],
                ["endsAt", "Ends", week.endsAt],
                ["rankingsOpenAt", "Rankings open", week.rankingsOpenAt],
                ["fullLockAt", "Sunday lock", week.fullLockAt],
                ["revealStartsAt", "Reveal start", week.revealStartsAt],
                ["publicReleaseAt", "Public release", week.publicReleaseAt],
              ] as const
            ).map(([name, label, value]) => (
              <label key={name} className="block text-sm">
                <span className="text-muted">{label} (Chicago)</span>
                <input
                  name={name}
                  type="datetime-local"
                  defaultValue={value ? toChicagoDateTimeLocal(value) : ""}
                  className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
                />
              </label>
            ))}
            <Button type="submit" variant="secondary">
              Save timing
            </Button>
          </form>
          <form action={commandEnsureContestsAction}>
            <input type="hidden" name="weekId" value={week.id} />
            <Button type="submit">Create all five contests</Button>
          </form>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border p-5 text-sm text-muted">
            Create or select a week to edit timing and generate QB/RB/WR/TE/DEF
            contests.
          </div>
        )}
      </section>

      {week && snapshot.data && snapshot.bots && snapshot.lockReveal && snapshot.finalize && snapshot.resultsAudit ? (
        <>
          <section className="mb-8 rounded-lg border border-border bg-surface-elevated p-5">
            <h2 className="font-display text-lg font-semibold text-ink">
              2–3. Player / data & pools
            </h2>
            <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <li>Schedule imported: {snapshot.data.scheduleImported ? "Yes" : "No"}</li>
              <li>Players imported: {snapshot.data.playersImported}</li>
              <li>Defenses imported: {snapshot.data.defensesImported}</li>
              <li>Games mapped: {snapshot.data.gamesMapped ? "Yes" : "No"}</li>
              <li>Position pools built: {snapshot.data.poolsBuilt ? "Yes" : "No"}</li>
              <li>
                Missing team/opp/kickoff: {snapshot.data.missingTeam}/
                {snapshot.data.missingOpponent}/{snapshot.data.missingKickoff}
              </li>
              <li>Manual exclusions: {snapshot.data.excluded}</li>
              <li>Manual additions: {snapshot.data.manuallyAdded}</li>
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button href={`/admin/data?weekId=${week.id}`} size="sm">
                Open NFL data workflow
              </Button>
              <Button href="/admin/players" size="sm" variant="secondary">
                Master player directory
              </Button>
            </div>
          </section>

          {manualMode ? (
            <div className="mb-8">
              <ManualOpsPanel
                weekId={week.id}
                weekLabel={week.label}
                previousWeekId={previousWeekId}
              />
            </div>
          ) : null}

          <section className="mb-8 rounded-lg border border-border bg-surface-elevated p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-lg font-semibold text-ink">
                4. AI rankings
              </h2>
              <StatusPill
                status={snapshot.bots.allBotsComplete ? "Complete" : "Needs Attention"}
              />
            </div>
            <p className="mt-1 text-sm text-muted">
              All bots complete: {snapshot.bots.allBotsComplete ? "Yes" : "No"} ·
              expected {snapshot.bots.expectedBoards} · submitted{" "}
              {snapshot.bots.submittedBoards} · locked {snapshot.bots.lockedBoards} ·
              graded {snapshot.bots.gradedBoards}
            </p>
            <ul className="mt-3 space-y-1 text-sm">
              {snapshot.bots.rows.map((row) => (
                <li key={row.profileId}>
                  {row.displayName} — {row.submittedCount}/{row.expectedCount}{" "}
                  Submitted
                  {snapshot.bots.missing.find((m) => m.username === row.displayName)
                    ? ` · missing ${
                        snapshot.bots.missing.find((m) => m.username === row.displayName)
                          ?.positions.join(", ")
                      }`
                    : ""}
                </li>
              ))}
            </ul>
            <Button href={`/admin/ai?weekId=${week.id}`} size="sm" className="mt-4">
              Open AI ranking workflow
            </Button>
          </section>

          <section className="mb-8 overflow-x-auto rounded-lg border border-border bg-surface-elevated">
            <div className="border-b border-border px-5 py-4">
              <h2 className="font-display text-lg font-semibold text-ink">
                5. Human submission monitoring
              </h2>
              <p className="mt-1 text-sm text-muted">
                Counts only. Individual boards stay private until reveal rules allow
                them. Admins can inspect submissions on contest pages.
              </p>
            </div>
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Pos</th>
                  <th className="px-3 py-2">Drafts</th>
                  <th className="px-3 py-2">Submitted</th>
                  <th className="px-3 py-2">Locked</th>
                  <th className="px-3 py-2">Graded</th>
                  <th className="px-3 py-2">Humans</th>
                  <th className="px-3 py-2">AI</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.humanMonitoring.map((row) => (
                  <tr key={row.contestId} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      <Link
                        href={`/admin/contests/${row.contestId}`}
                        className="font-medium text-accent hover:underline"
                      >
                        {row.position}
                      </Link>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{row.drafts}</td>
                    <td className="px-3 py-2 tabular-nums">{row.submitted}</td>
                    <td className="px-3 py-2 tabular-nums">{row.locked}</td>
                    <td className="px-3 py-2 tabular-nums">{row.graded}</td>
                    <td className="px-3 py-2 tabular-nums">{row.uniqueHumans}</td>
                    <td className="px-3 py-2 tabular-nums">{row.uniqueAi}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="mb-8 rounded-lg border border-border bg-surface-elevated p-5">
            <h2 className="font-display text-lg font-semibold text-ink">
              6. Lock / reveal
            </h2>
            <p className="mt-1 text-sm text-muted">
              America/Chicago ({RANKIQ_TIMEZONE})
            </p>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                Rankings open:{" "}
                {snapshot.lockReveal.rankingsOpenAt
                  ? formatInChicago(snapshot.lockReveal.rankingsOpenAt, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      timeZoneName: "short",
                    })
                  : "—"}
              </div>
              <div>
                Sunday full lock:{" "}
                {snapshot.lockReveal.fullLockAt
                  ? formatInChicago(snapshot.lockReveal.fullLockAt, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      timeZoneName: "short",
                    })
                  : "—"}
              </div>
              <div>
                Reveal start:{" "}
                {snapshot.lockReveal.revealStartsAt
                  ? formatInChicago(snapshot.lockReveal.revealStartsAt, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      timeZoneName: "short",
                    })
                  : "—"}
              </div>
              <div>
                Reveal end (public):{" "}
                {snapshot.lockReveal.publicReleaseAt
                  ? formatInChicago(snapshot.lockReveal.publicReleaseAt, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      timeZoneName: "short",
                    })
                  : "—"}
              </div>
              <div>Early games started: {snapshot.lockReveal.earlyGamesStarted ? "Yes" : "No"}</div>
              <div>Individually locked picks: {snapshot.lockReveal.individuallyLocked}</div>
              <div>Sunday full lock: {snapshot.lockReveal.sundayLocked ? "Yes" : "No"}</div>
              <div>Consensus visible: {snapshot.lockReveal.consensusVisible ? "Yes" : "No"}</div>
              <div>Reveal window: {snapshot.lockReveal.revealWindowActive ? "Yes" : "No"}</div>
              <div>All boards public: {snapshot.lockReveal.boardsPublic ? "Yes" : "No"}</div>
            </dl>
          </section>

          <section className="mb-8 rounded-lg border border-border bg-surface-elevated p-5">
            <h2 className="font-display text-lg font-semibold text-ink">
              7. Live operations
            </h2>
            {manualMode ? (
              <p className="mt-1 text-sm text-muted">
                Live standings update only when you paste provisional fantasy
                points. There is no automatic live sports feed in manual mode.
              </p>
            ) : null}
            <ul className="mt-3 space-y-1 text-sm">
              <li>Games in progress: {snapshot.data.gamesInProgress}</li>
              <li>Provisional stats: {snapshot.data.provisionalStats}</li>
              <li>Missing stats: {snapshot.data.missingStats}</li>
              <li>
                Games final: {snapshot.data.gamesFinal}/{snapshot.data.gamesTotal}
              </li>
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button href="/leaderboards/live" size="sm" variant="secondary">
                Live ranker board
              </Button>
              <Button href="/receipts" size="sm" variant="secondary">
                Thursday Receipts
              </Button>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 font-display text-lg font-semibold text-ink">
              8. Final results / grading
            </h2>
            {snapshot.finalize.reasons.length > 0 ? (
              <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-warning">
                {snapshot.finalize.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : (
              <p className="mb-3 text-sm text-accent">Ready to finalize.</p>
            )}
            <ResultsWorkflowPanel
              weekId={week.id}
              weekLabel={week.label}
              resultsAudit={snapshot.resultsAudit}
              finalizeReadiness={snapshot.finalize}
            />
          </section>

          <section className="mb-8 rounded-lg border border-border bg-surface-elevated p-5">
            <h2 className="font-display text-lg font-semibold text-ink">
              9. Archive
            </h2>
            <p className="mt-1 text-sm text-muted">
              Archive after the week is complete. Historical rankings stay public.
            </p>
            <div className="mt-3 max-w-xl">
              <ConfirmSubmit
                action={commandArchiveWeekAction}
                submitLabel="Archive week"
                impact={`Archive ${week.label}. Contests move to ARCHIVED. Historical rankings stay public.`}
                blockers={
                  week.status === "ARCHIVED" ? ["Week is already archived."] : []
                }
                confirmPhrase="ARCHIVE"
              >
                <input type="hidden" name="weekId" value={week.id} />
              </ConfirmSubmit>
            </div>
          </section>
        </>
      ) : null}

      <section className="rounded-lg border border-border bg-surface-elevated p-5">
        <h2 className="font-display text-lg font-semibold text-ink">
          Recent admin activity
        </h2>
        {snapshot.audit.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No audit events yet.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {snapshot.audit.map((row) => (
              <li key={row.id} className="border-b border-border pb-2 last:border-0">
                <span className="font-medium text-ink">{row.action}</span>{" "}
                <span className="text-muted">
                  · {row.entityType}
                  {row.entityId ? ` ${row.entityId.slice(0, 8)}` : ""} ·{" "}
                  {row.adminUser.email ?? row.adminUser.name ?? "admin"} ·{" "}
                  {formatInChicago(row.createdAt, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Container>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  calculateActualFinishesAction,
  commitWeekResultsAction,
  finalizeWeekAction,
  previewWeekResultsAction,
  regradeWeekContestsAction,
} from "@/lib/nfl/actions";
import type {
  FinalizeWeekReadiness,
  PreflightStatus,
} from "@/lib/nfl/finalize-week";
import type { ResultsImportPreview } from "@/lib/nfl/results-import";
import type { ResultsAudit } from "@/lib/nfl/results-audit";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

function statusTone(
  status: PreflightStatus,
): "success" | "warning" | "danger" | "neutral" {
  if (status === "PASS") return "success";
  if (status === "WARNING") return "warning";
  if (status === "BLOCKED") return "danger";
  return "neutral";
}

export function ResultsWorkflowPanel({
  weekId,
  weekLabel,
  resultsAudit,
  finalizeReadiness,
}: {
  weekId: string;
  weekLabel: string;
  resultsAudit: ResultsAudit;
  finalizeReadiness: FinalizeWeekReadiness;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<ResultsImportPreview | null>(null);
  const [confirmGrade, setConfirmGrade] = useState(false);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [resultsVerified, setResultsVerified] = useState(false);
  const manualMode = finalizeReadiness.manualMode;
  const weekNumber = finalizeReadiness.weekNumber;
  const positionsLabel = "QB / RB / WR / TE / DEF";

  function run(action: () => Promise<void>) {
    startTransition(async () => {
      try {
        await action();
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Action failed");
      }
    });
  }

  return (
    <section className="rounded-lg border border-border bg-surface-elevated p-5">
      <h2 className="font-display text-lg font-semibold text-ink">
        Verify & finalize · {weekLabel}
      </h2>
      <p className="mt-1 text-sm text-muted">
        GAME FINALIZED is not the same as WEEK / POSITION CONTEST FINALIZED.
        This action runs the canonical finishes → EYEQ grade → contest FINAL →
        week COMPLETE path. {manualMode ? "No live sports API." : null}
      </p>

      <div className="mt-4 overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">Check</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Detail</th>
            </tr>
          </thead>
          <tbody>
            {finalizeReadiness.checks.map((check) => (
              <tr
                key={check.key}
                className="border-b border-border last:border-0"
              >
                <td className="px-3 py-2 font-medium text-ink">{check.label}</td>
                <td className="px-3 py-2">
                  <Badge tone={statusTone(check.status)}>{check.status}</Badge>
                </td>
                <td className="px-3 py-2 text-muted">{check.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 overflow-x-auto">
        <h3 className="font-display text-base font-semibold text-ink">
          Position board · {positionsLabel}
        </h3>
        <table className="mt-2 w-full min-w-[40rem] text-left text-sm">
          <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-2 py-2">Pos</th>
              <th className="px-2 py-2">Contest</th>
              <th className="px-2 py-2">Pool</th>
              <th className="px-2 py-2">Pts</th>
              <th className="px-2 py-2">Ranks</th>
              <th className="px-2 py-2">Boards</th>
              <th className="px-2 py-2">Snapshot</th>
              <th className="px-2 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {finalizeReadiness.positions.map((row) => (
              <tr
                key={row.position}
                className="border-b border-border last:border-0"
              >
                <td className="px-2 py-2 font-medium text-ink">{row.position}</td>
                <td className="px-2 py-2 text-ink">
                  {row.contestStatus ?? "—"}
                </td>
                <td className="px-2 py-2 tabular-nums">{row.poolSize}</td>
                <td className="px-2 py-2 tabular-nums">{row.withPoints}</td>
                <td className="px-2 py-2 tabular-nums">{row.withRanks}</td>
                <td className="px-2 py-2 tabular-nums">
                  {row.lockedOrGradedSubmissions}/{row.eligibleSubmissions}
                  {row.unlockedSubmitted > 0
                    ? ` (${row.unlockedSubmitted} unlocked)`
                    : ""}
                </td>
                <td className="px-2 py-2">
                  {row.hasPregameSnapshot ? "Yes" : "No"}
                </td>
                <td className="px-2 py-2">
                  <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {!manualMode ? (
          <>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const formData = new FormData();
                  formData.set("weekId", weekId);
                  const result = await previewWeekResultsAction(formData);
                  setPreview(result.preview);
                  setMessage(
                    `Stats preview · ${result.preview.playerMatched} players matched · ${result.preview.defenseMatched} D/ST matched`,
                  );
                })
              }
            >
              Fetch Latest Stats
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const formData = new FormData();
                  formData.set("weekId", weekId);
                  const result = await commitWeekResultsAction(formData);
                  setMessage(
                    `Stats committed · players ${result.counts.playersCreated}/${result.counts.playersUpdated} · D/ST ${result.counts.defensesCreated}/${result.counts.defensesUpdated}`,
                  );
                })
              }
            >
              Commit Stats
            </Button>
          </>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const formData = new FormData();
              formData.set("weekId", weekId);
              const result = await calculateActualFinishesAction(formData);
              setMessage(
                `Actual finishes calculated for ${result.results.length} contests`,
              );
            })
          }
        >
          Calculate Actual Finishes
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending || !confirmGrade}
          onClick={() =>
            run(async () => {
              const formData = new FormData();
              formData.set("weekId", weekId);
              const result = await regradeWeekContestsAction(formData);
              setMessage(
                `Regraded ${result.graded} contests · ${new Date().toLocaleString()}`,
              );
              setConfirmGrade(false);
            })
          }
        >
          Regrade Week
        </Button>
        <Button
          type="button"
          disabled={
            pending ||
            !finalizeReadiness.ready ||
            !confirmFinalize ||
            (manualMode && !resultsVerified)
          }
          onClick={() =>
            run(async () => {
              const formData = new FormData();
              formData.set("weekId", weekId);
              if (manualMode) formData.set("resultsVerified", "1");
              const result = await finalizeWeekAction(formData);
              const summary = result.result;
              setMessage(
                [
                  `Week ${summary.weekNumber} finalized at ${new Date(summary.finalizedAt).toLocaleString()}`,
                  `${summary.contestsGraded} contests FINAL (${positionsLabel})`,
                  `${summary.submissionsGraded} submissions graded`,
                  summary.submissionsSkipped > 0
                    ? `${summary.submissionsSkipped} skipped (incomplete boards)`
                    : "no skips",
                ].join(" · "),
              );
              setConfirmFinalize(false);
              setResultsVerified(false);
            })
          }
        >
          VERIFY & FINALIZE WEEK
        </Button>
      </div>

      <div className="mt-3 space-y-2 text-sm text-ink">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={confirmGrade}
            onChange={(event) => setConfirmGrade(event.target.checked)}
          />
          <span>
            Regrade {weekLabel}: replace prior EYEQ scores in place for{" "}
            {positionsLabel}. Safe after official/stat corrections — does not
            duplicate history.
          </span>
        </label>
        {manualMode ? (
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={resultsVerified}
              onChange={(event) => setResultsVerified(event.target.checked)}
              disabled={!finalizeReadiness.ready}
            />
            <span>
              All final NFL results have been entered and verified for{" "}
              {weekLabel}.
            </span>
          </label>
        ) : null}
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={confirmFinalize}
            onChange={(event) => setConfirmFinalize(event.target.checked)}
            disabled={
              !finalizeReadiness.ready || (manualMode && !resultsVerified)
            }
          />
          <span>
            Finalize Week {weekNumber} and grade all position contests? Affected:{" "}
            {positionsLabel}. Computes finishes if needed, grades with
            reserve-adjusted effective boards, persists EYEQ, sets contests
            FINAL, and marks the week COMPLETE.
          </span>
        </label>
      </div>

      {message ? (
        <p className="mt-3 text-sm text-accent-ink" role="status">
          {message}
        </p>
      ) : null}

      {!finalizeReadiness.ready ? (
        <div className="mt-3 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
          VERIFY & FINALIZE WEEK blocked until critical checks pass:
          <ul className="mt-1 list-disc pl-5">
            {finalizeReadiness.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 text-sm text-accent-ink">
          Preflight clear
          {finalizeReadiness.checks.some((c) => c.status === "WARNING")
            ? " (warnings present — review above)"
            : ""}
          . Confirm and run VERIFY & FINALIZE WEEK.
        </p>
      )}

      {preview ? (
        <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Players matched" value={String(preview.playerMatched)} />
          <Stat
            label="Players unmatched"
            value={String(preview.playerUnmatched)}
          />
          <Stat label="D/ST matched" value={String(preview.defenseMatched)} />
          <Stat
            label="Provisional rows"
            value={String(preview.provisionalCount)}
          />
        </div>
      ) : null}

      <div className="mt-6 overflow-x-auto">
        <h3 className="font-display text-base font-semibold text-ink">
          Results audit
        </h3>
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Stat
            label="Scheduled offense pool"
            value={String(resultsAudit.scheduledPlayers)}
          />
          <Stat
            label="With stat lines"
            value={String(resultsAudit.playersWithStats)}
          />
          <Stat
            label="Zero-point lines"
            value={String(resultsAudit.zeroPointStatLines)}
          />
          <Stat
            label="Missing player stats"
            value={String(resultsAudit.missingPlayerStats)}
          />
          <Stat
            label="Missing D/ST stats"
            value={String(resultsAudit.missingDefenseStats)}
          />
          <Stat
            label="Games not final"
            value={String(resultsAudit.gamesNotFinal)}
          />
          <Stat
            label="Unmatched player stats"
            value={String(resultsAudit.unmatchedPlayerStats)}
          />
          <Stat
            label="Unmatched D/ST stats"
            value={String(resultsAudit.unmatchedDefenseStats)}
          />
        </dl>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-1 font-medium tabular-nums text-ink">{value}</dd>
    </div>
  );
}

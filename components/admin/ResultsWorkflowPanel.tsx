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
import type { FinalizeWeekReadiness } from "@/lib/nfl/finalize-week";
import type { ResultsImportPreview } from "@/lib/nfl/results-import";
import type { ResultsAudit } from "@/lib/nfl/results-audit";
import { Button } from "@/components/ui/Button";

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
        Results · {weekLabel}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {manualMode ? (
          <>
            Manual mode: paste final fantasy points in Manual weekly ops, then
            calculate finishes and grade with{" "}
            <span className="font-medium text-ink">
              {resultsAudit.scoringVersion}
            </span>
            . No live sports-data API is used.
          </>
        ) : (
          <>
            Fetch provider stats, score with{" "}
            <span className="font-medium text-ink">
              {resultsAudit.scoringVersion}
            </span>
            , calculate competition-rank finishes, then grade. Preview never
            grades.
          </>
        )}
      </p>

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
              setMessage(`Graded ${result.graded} contests`);
              setConfirmGrade(false);
            })
          }
        >
          Grade All / Regrade
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
              setMessage(
                `Week finalized · ${result.result.contestsGraded} contests FINAL`,
              );
              setConfirmFinalize(false);
              setResultsVerified(false);
            })
          }
        >
          Finalize Week
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
            Grade/Regrade {weekLabel}: recalculate EYEQ scores for submitted
            boards. Scoring formulas do not change.
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
            {manualMode
              ? `Finalize ${weekLabel}: compute finishes if needed, grade all contests, and mark the week COMPLETE. Does not call an external sports API.`
              : `Finalize ${weekLabel}: refresh stats, compute finishes, grade all contests, and mark the week COMPLETE. Cannot be undone casually.`}
          </span>
        </label>
      </div>

      {message ? (
        <p className="mt-3 text-sm text-accent" role="status">
          {message}
        </p>
      ) : null}

      {!finalizeReadiness.ready ? (
        <div className="mt-3 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning">
          Finalize Week blocked:
          <ul className="mt-1 list-disc pl-5">
            {finalizeReadiness.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 text-sm text-accent">
          {manualMode
            ? "Week is ready to finalize (pools ready, final points + ranks present). Confirm verified results above."
            : "Week is ready to finalize (all games final, stats + ranks present)."}
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

        <table className="mt-4 w-full min-w-[36rem] text-left text-sm">
          <thead className="border-b border-border text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-2 py-2">Pos</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Pool</th>
              <th className="px-2 py-2">Pts</th>
              <th className="px-2 py-2">Ranks</th>
              <th className="px-2 py-2">Grade-ready</th>
            </tr>
          </thead>
          <tbody>
            {resultsAudit.contests.map((contest) => (
              <tr
                key={contest.position}
                className="border-b border-border last:border-0"
              >
                <td className="px-2 py-2 font-medium text-ink">
                  {contest.position}
                </td>
                <td className="px-2 py-2 text-ink">{contest.status}</td>
                <td className="px-2 py-2 tabular-nums">{contest.poolSize}</td>
                <td className="px-2 py-2 tabular-nums">{contest.withPoints}</td>
                <td className="px-2 py-2 tabular-nums">{contest.withRanks}</td>
                <td className="px-2 py-2">
                  {contest.readyToGrade ? "Yes" : "No"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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

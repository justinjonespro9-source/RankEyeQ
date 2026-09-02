"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import {
  auditPoolsAction,
  buildDefPoolFromScheduleAction,
  commitFantasyPointsAction,
  commitManualPoolAction,
  commitManualScheduleAction,
  copyPreviousWeekPoolsAction,
  openContestsIfPoolsReadyAction,
  previewFantasyPointsAction,
  previewManualPoolAction,
  previewManualScheduleAction,
} from "@/lib/admin-manual-actions";
import { regradeWeekContestsAction } from "@/lib/nfl/actions";
import type { ContestPosition } from "@/lib/generated/prisma/client";

const POSITIONS: ContestPosition[] = ["QB", "RB", "WR", "TE", "DEF"];

export function ManualOpsPanel({
  weekId,
  weekLabel,
  previousWeekId,
}: {
  weekId: string;
  weekLabel: string;
  previousWeekId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [scheduleText, setScheduleText] = useState("");
  const [poolText, setPoolText] = useState("");
  const [poolPosition, setPoolPosition] = useState<ContestPosition | "ALL">(
    "ALL",
  );
  const [resultsText, setResultsText] = useState("");
  const [resultsPosition, setResultsPosition] = useState<
    ContestPosition | "ALL"
  >("ALL");
  const [confirmCreates, setConfirmCreates] = useState(false);
  const [auditSummary, setAuditSummary] = useState<string | null>(null);

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
    <section className="space-y-6 rounded-lg border border-border bg-surface-elevated p-5">
      <div>
        <h2 className="font-display text-lg font-semibold text-ink">
          Manual weekly ops · {weekLabel}
        </h2>
        <p className="mt-1 text-sm text-muted">
          Operator-entered schedule, pools, and fantasy points. No live sports-data
          API. Opponent and kickoff from prior weeks are never carried forward.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending || !previousWeekId}
          onClick={() =>
            run(async () => {
              const result = await copyPreviousWeekPoolsAction({
                weekId,
                sourceWeekId: previousWeekId ?? undefined,
              });
              setMessage(
                result.ok
                  ? `Copied pools · retained ${result.result.retained} · added ${result.result.added} · exclusions ${result.result.exclusionsPreserved}`
                  : result.error,
              );
            })
          }
        >
          Copy Previous Week Pools
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const result = await buildDefPoolFromScheduleAction({ weekId });
              setMessage(
                result.ok
                  ? `DEF pool · created ${result.result.created} · updated ${result.result.updated}`
                  : result.error,
              );
            })
          }
        >
          Build DEF Pool from Schedule
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const result = await auditPoolsAction({ weekId });
              if (!result.ok) return;
              setAuditSummary(
                result.audit.audits
                  .map(
                    (row) =>
                      `${row.position}: ${row.eligibleCount} eligible · ${row.ready ? "READY" : row.blockers[0] ?? "blocked"}`,
                  )
                  .join(" · "),
              );
              setMessage(
                result.audit.ready
                  ? "All pools READY"
                  : `Pools not ready · ${result.audit.blockers[0] ?? "see audit"}`,
              );
            })
          }
        >
          Audit All Pools
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const formData = new FormData();
              formData.set("weekId", weekId);
              const result = await openContestsIfPoolsReadyAction(formData);
              setMessage(
                result.ok
                  ? "Contests opened"
                  : result.error ?? "Unable to open contests",
              );
            })
          }
        >
          Open Contests (Open Week Rankings)
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const formData = new FormData();
              formData.set("weekId", weekId);
              const result = await regradeWeekContestsAction(formData);
              setMessage(`Graded ${result.graded} contests`);
            })
          }
        >
          Grade All
        </Button>
      </div>
      {auditSummary ? (
        <p className="text-xs text-muted">{auditSummary}</p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="font-medium text-ink">Paste weekly schedule</h3>
          <p className="mt-1 text-xs text-muted">
            Away | Home | Kickoff — e.g. GB | MIN | 2026-09-13 12:00 CT
          </p>
          <textarea
            value={scheduleText}
            onChange={(event) => setScheduleText(event.target.value)}
            rows={8}
            className="mt-2 w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const result = await previewManualScheduleAction({
                    text: scheduleText,
                  });
                  setMessage(
                    result.preview.ready
                      ? `Schedule ready · ${result.preview.rows.length} games`
                      : result.preview.blockers[0] ?? "Schedule not ready",
                  );
                })
              }
            >
              Preview schedule
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const result = await commitManualScheduleAction({
                    weekId,
                    text: scheduleText,
                  });
                  setMessage(
                    result.ok
                      ? `Schedule saved · created ${result.result.created} · updated ${result.result.updated}`
                      : result.error,
                  );
                })
              }
            >
              Save schedule
            </Button>
          </div>
        </div>

        <div>
          <h3 className="font-medium text-ink">Paste player pool</h3>
          <p className="mt-1 text-xs text-muted">
            All positions: Name | Pos | Team | Opponent | Kickoff. Or pick a
            position and paste Name | Team | Opponent | Kickoff.
          </p>
          <select
            value={poolPosition}
            onChange={(event) =>
              setPoolPosition(event.target.value as ContestPosition | "ALL")
            }
            className="mt-2 rounded-md border border-border bg-surface px-3 py-2 text-sm"
          >
            <option value="ALL">All positions</option>
            {POSITIONS.map((position) => (
              <option key={position} value={position}>
                Paste {position} pool
              </option>
            ))}
          </select>
          <textarea
            value={poolText}
            onChange={(event) => setPoolText(event.target.value)}
            rows={8}
            className="mt-2 w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm"
          />
          <label className="mt-2 flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={confirmCreates}
              onChange={(event) => setConfirmCreates(event.target.checked)}
            />
            Confirm create new master players from unmatched names
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const result = await previewManualPoolAction({
                    text: poolText,
                    fixedPosition:
                      poolPosition === "ALL" ? undefined : poolPosition,
                  });
                  setMessage(
                    result.preview.ready
                      ? `Pool ready · ${result.preview.matchCount} matched · ${result.preview.createCount} new`
                      : result.preview.blockers[0] ?? "Pool not ready",
                  );
                })
              }
            >
              Preview pool
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const result = await commitManualPoolAction({
                    weekId,
                    text: poolText,
                    fixedPosition:
                      poolPosition === "ALL" ? undefined : poolPosition,
                    confirmCreates,
                  });
                  setMessage(
                    result.ok
                      ? `Pool saved · created ${result.result.created} · updated ${result.result.updated} · masters ${result.result.masterCreated}`
                      : result.error,
                  );
                })
              }
            >
              Save pool
            </Button>
          </div>
        </div>
      </div>

      <div>
        <h3 className="font-medium text-ink">Paste fantasy points</h3>
        <p className="mt-1 text-xs text-muted">
          Name | Points — or Name | Position | Points for the whole week. Explicit
          0.0 is kept; missing rows stay missing.
        </p>
        <select
          value={resultsPosition}
          onChange={(event) =>
            setResultsPosition(event.target.value as ContestPosition | "ALL")
          }
          className="mt-2 rounded-md border border-border bg-surface px-3 py-2 text-sm"
        >
          <option value="ALL">All positions</option>
          {POSITIONS.map((position) => (
            <option key={position} value={position}>
              {position} only
            </option>
          ))}
        </select>
        <textarea
          value={resultsText}
          onChange={(event) => setResultsText(event.target.value)}
          rows={8}
          className="mt-2 w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const result = await previewFantasyPointsAction({
                  weekId,
                  text: resultsText,
                  position:
                    resultsPosition === "ALL" ? undefined : resultsPosition,
                });
                setMessage(
                  result.preview.ready
                    ? `Results ready · ${result.preview.matchedCount} matched · ${result.preview.zeroCount} explicit zeros`
                    : result.preview.blockers[0] ?? "Results not ready",
                );
              })
            }
          >
            Preview results
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const result = await commitFantasyPointsAction({
                  weekId,
                  text: resultsText,
                  position:
                    resultsPosition === "ALL" ? undefined : resultsPosition,
                  provisional: false,
                });
                setMessage(
                  result.ok
                    ? `Final points saved · ${result.result.updated} updated · finishes calculated`
                    : result.error,
                );
              })
            }
          >
            Save final results
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const result = await commitFantasyPointsAction({
                  weekId,
                  text: resultsText,
                  position:
                    resultsPosition === "ALL" ? undefined : resultsPosition,
                  provisional: true,
                });
                setMessage(
                  result.ok
                    ? `Provisional points saved · ${result.result.updated} updated (does not overwrite finals)`
                    : result.error,
                );
              })
            }
          >
            Save provisional (live)
          </Button>
        </div>
      </div>

      {message ? (
        <p className="text-sm text-accent" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}

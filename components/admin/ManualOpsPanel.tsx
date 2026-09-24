"use client";

import { useMemo, useState, useTransition } from "react";
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
  syncWeekMatchupsAction,
} from "@/lib/admin-manual-actions";
import { buildAiSchedulePrompt } from "@/lib/nfl/manual/ai-schedule-prompt";
import type { ScheduleParseResult } from "@/lib/nfl/manual/parse-schedule";
import { schedulePreviewIsReadyToSave } from "@/lib/nfl/manual/schedule-preview-state";
import { regradeWeekContestsAction } from "@/lib/nfl/actions";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import type { OperatorMatchupSyncSummary } from "@/lib/nfl/week-matchup-repair";

const POSITIONS: ContestPosition[] = ["QB", "RB", "WR", "TE", "DEF"];

export function ManualOpsPanel({
  weekId,
  weekLabel,
  seasonYear,
  weekNumber,
  previousWeekId,
}: {
  weekId: string;
  weekLabel: string;
  seasonYear: number;
  weekNumber: number;
  previousWeekId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [scheduleText, setScheduleText] = useState("");
  const [schedulePreview, setSchedulePreview] =
    useState<ScheduleParseResult | null>(null);
  const [schedulePreviewStale, setSchedulePreviewStale] = useState(false);
  const [scheduleSaveResult, setScheduleSaveResult] = useState<{
    operatorMessage: string;
    matchupSummary: OperatorMatchupSyncSummary;
  } | null>(null);
  const [syncPreview, setSyncPreview] = useState<{
    message: string;
    summary: OperatorMatchupSyncSummary;
    attentionRows: Array<{
      name: string;
      team: string;
      position: ContestPosition;
      status: string;
    }>;
  } | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);
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

  const aiSchedulePrompt = useMemo(
    () => buildAiSchedulePrompt({ seasonYear, weekNumber }),
    [seasonYear, weekNumber],
  );

  const scheduleReadyToSave = schedulePreviewIsReadyToSave(
    schedulePreview,
    schedulePreviewStale,
  );

  function run(action: () => Promise<void>, options?: { refresh?: boolean }) {
    startTransition(async () => {
      try {
        await action();
        if (options?.refresh !== false) {
          router.refresh();
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Action failed");
      }
    });
  }

  function onScheduleTextChange(value: string) {
    setScheduleText(value);
    if (schedulePreview) {
      setSchedulePreviewStale(true);
    }
  }

  async function copyAiPrompt() {
    try {
      await navigator.clipboard.writeText(aiSchedulePrompt);
      setPromptCopied(true);
      setMessage("AI schedule prompt copied");
      window.setTimeout(() => setPromptCopied(false), 2000);
    } catch {
      setMessage("Unable to copy prompt — select and copy manually");
    }
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
          Saving a schedule also synchronizes existing pool matchups for this week.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="flex flex-col gap-1">
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
          <p className="max-w-xs text-[11px] leading-snug text-muted">
            Copies/refreshes pool membership and applicable exclusions from the
            prior week. Not required merely to synchronize schedule matchups.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            run(
              async () => {
                const result = await syncWeekMatchupsAction({
                  weekId,
                  apply: false,
                });
                if (!result.ok) {
                  setMessage(result.error);
                  return;
                }
                setSyncPreview({
                  message: result.message,
                  summary: result.summary,
                  attentionRows: result.attentionRows,
                });
                setMessage(result.message);
              },
              { refresh: false },
            )
          }
        >
          Preview Sync Matchups
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            run(async () => {
              const result = await syncWeekMatchupsAction({
                weekId,
                apply: true,
              });
              if (!result.ok) {
                setMessage(result.error);
                return;
              }
              setSyncPreview({
                message: result.message,
                summary: result.summary,
                attentionRows: result.attentionRows,
              });
              setMessage(result.message);
            })
          }
        >
          Sync Matchups
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
      {syncPreview ? (
        <MatchupSyncResultPanel
          title="Matchup sync"
          message={syncPreview.message}
          summary={syncPreview.summary}
          attentionRows={syncPreview.attentionRows}
        />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="font-medium text-ink">Paste weekly schedule</h3>
          <p className="mt-1 text-xs text-muted">
            Away | Home | Kickoff — e.g. GB | MIN | 2026-09-13 12:00 CT. After
            save, existing pool entries are linked to this week&apos;s games
            (stamp-only — does not copy or rebuild pools).
          </p>

          <div className="mt-3 rounded-md border border-border bg-surface px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-ink">AI Schedule Prompt</p>
                <p className="mt-0.5 text-xs text-muted">
                  Copy a prompt for {seasonYear} NFL Week {weekNumber}, then paste
                  the AI output above. Preview remains the safety gate.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  void copyAiPrompt();
                }}
              >
                {promptCopied ? "Copied" : "Copy Prompt"}
              </Button>
            </div>
          </div>

          <textarea
            value={scheduleText}
            onChange={(event) => onScheduleTextChange(event.target.value)}
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
                run(
                  async () => {
                    const result = await previewManualScheduleAction({
                      text: scheduleText,
                    });
                    setSchedulePreview(result.preview);
                    setSchedulePreviewStale(false);
                    setMessage(
                      result.preview.ready
                        ? `Schedule preview · ${result.preview.summary.gameCount} games · READY TO SAVE`
                        : `Schedule preview · BLOCKED · ${result.preview.blockers[0] ?? "fix rows"}`,
                    );
                  },
                  { refresh: false },
                )
              }
            >
              Preview schedule
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={pending || (schedulePreview != null && !scheduleReadyToSave)}
              title={
                schedulePreview != null && !scheduleReadyToSave
                  ? schedulePreviewStale
                    ? "Schedule changed — Preview again before saving"
                    : "Fix blocking errors before saving"
                  : undefined
              }
              onClick={() =>
                run(async () => {
                  const result = await commitManualScheduleAction({
                    weekId,
                    text: scheduleText,
                  });
                  if (result.ok) {
                    setSchedulePreviewStale(false);
                    setScheduleSaveResult({
                      operatorMessage: result.result.operatorMessage,
                      matchupSummary: result.result.matchupSummary,
                    });
                    setMessage(result.result.operatorMessage);
                  } else {
                    setMessage(result.error);
                  }
                })
              }
            >
              Save schedule
            </Button>
          </div>

          {schedulePreview ? (
            <SchedulePreviewPanel
              seasonYear={seasonYear}
              weekNumber={weekNumber}
              preview={schedulePreview}
              stale={schedulePreviewStale}
            />
          ) : null}

          {scheduleSaveResult ? (
            <MatchupSyncResultPanel
              title="Schedule save result"
              message={scheduleSaveResult.operatorMessage}
              summary={scheduleSaveResult.matchupSummary}
            />
          ) : null}
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
        <p className="whitespace-pre-line text-sm text-accent-ink" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}

function MatchupSyncResultPanel({
  title,
  message,
  summary,
  attentionRows,
}: {
  title: string;
  message: string;
  summary: OperatorMatchupSyncSummary;
  attentionRows?: Array<{
    name: string;
    team: string;
    position: ContestPosition;
    status: string;
  }>;
}) {
  const warning = summary.needsAttention > 0 || summary.skippedDueToLifecycle;
  return (
    <div
      className={`rounded-md border px-3 py-3 text-sm ${
        warning
          ? "border-warning/40 bg-warning-soft/40"
          : "border-success/40 bg-success-soft/30"
      }`}
      role="status"
    >
      <p className="font-semibold uppercase tracking-wide text-ink">{title}</p>
      <p className="mt-1 whitespace-pre-line text-sm text-ink">{message}</p>
      <ul className="mt-2 space-y-0.5 text-xs text-muted">
        <li>
          Pool entries: {summary.totalEntries} · linked {summary.linkedCorrectly} ·
          repaired {summary.updated} · already correct {summary.alreadyCorrect}
        </li>
        <li>
          Unmatched {summary.unmatched} · ambiguous {summary.ambiguous}
          {summary.staleCorrected > 0
            ? ` · stale corrected ${summary.staleCorrected}`
            : ""}
        </li>
      </ul>
      {attentionRows && attentionRows.length > 0 ? (
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-warning">
          {attentionRows.map((row) => (
            <li key={`${row.position}-${row.name}-${row.team}`}>
              {row.position} {row.name} ({row.team}) — {row.status}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SchedulePreviewPanel({
  seasonYear,
  weekNumber,
  preview,
  stale,
}: {
  seasonYear: number;
  weekNumber: number;
  preview: ScheduleParseResult;
  stale: boolean;
}) {
  const { summary } = preview;
  const invalidAbbr = preview.rows.filter((row) =>
    row.issues.includes("unknown_team"),
  ).length;
  const invalidKickoff = preview.rows.filter((row) =>
    row.issues.includes("invalid_kickoff"),
  ).length;
  const duplicateGames = preview.rows.filter((row) =>
    row.issues.includes("duplicate_game"),
  ).length;
  const duplicateTeams = preview.rows.filter((row) =>
    row.issues.includes("duplicate_team"),
  ).length;

  return (
    <div
      className={`mt-3 rounded-md border px-3 py-3 text-sm ${
        stale
          ? "border-warning/40 bg-warning-soft/40"
          : preview.ready
            ? "border-success/40 bg-success-soft/30"
            : "border-danger/40 bg-danger-soft/40"
      }`}
      role="status"
    >
      <p className="font-semibold uppercase tracking-wide text-ink">
        Schedule Preview — {seasonYear} Week {weekNumber}
      </p>
      {stale ? (
        <p className="mt-1 text-xs font-medium text-warning">
          Input changed since last Preview — re-run Preview before saving.
        </p>
      ) : null}
      <ul className="mt-2 space-y-0.5 text-xs text-muted">
        <li>{summary.gameCount} games parsed</li>
        <li>{summary.teamAppearanceCount} team appearances</li>
        <li>{summary.uniqueTeamCount} unique teams</li>
        <li>{duplicateGames} duplicate games</li>
        <li>{duplicateTeams} duplicate team appearances</li>
        <li>{invalidAbbr} invalid team abbreviations</li>
        <li>{invalidKickoff} invalid kickoff timestamps</li>
        {summary.absentTeams.length > 0 ? (
          <li>
            {summary.absentTeams.length} teams absent:{" "}
            {summary.absentTeams.join(", ")}
          </li>
        ) : (
          <li>0 teams absent</li>
        )}
      </ul>

      <div className="mt-3 space-y-1 text-xs">
        <p className="font-medium text-ink">
          Structural validation:{" "}
          {summary.structuralPassed ? "PASSED" : "FAILED"}
        </p>
        <p className="font-medium text-ink">
          Completeness:{" "}
          {summary.completeness === "FULL"
            ? "FULL SLATE"
            : summary.completeness === "VERIFY_SLATE"
              ? "VERIFY SLATE"
              : "BLOCKED"}
        </p>
        {!stale && preview.ready ? (
          <p className="font-semibold text-success">READY TO SAVE</p>
        ) : null}
        {!stale && !preview.ready ? (
          <p className="font-semibold text-danger">BLOCKED — FIX BEFORE SAVING</p>
        ) : null}
      </div>

      {preview.blockers.length > 0 ? (
        <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-danger">
          {preview.blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      ) : null}

      {preview.rows.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
            Away | Home | Kickoff CT
          </p>
          <table className="w-full min-w-[20rem] border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted">
                <th className="py-1 pr-2 font-medium">Away</th>
                <th className="py-1 pr-2 font-medium">Home</th>
                <th className="py-1 font-medium">Kickoff CT</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row) => (
                <tr
                  key={`${row.lineNumber}-${row.raw}`}
                  className={
                    row.issues.length > 0
                      ? "border-b border-border/60 text-danger"
                      : "border-b border-border/60 text-ink"
                  }
                >
                  <td className="py-1 pr-2 font-mono">{row.awayTeam || "—"}</td>
                  <td className="py-1 pr-2 font-mono">{row.homeTeam || "—"}</td>
                  <td className="py-1 font-mono">
                    {row.kickoffLabel ?? "—"}
                    {row.issues.length > 0
                      ? ` · ${row.issues.join(", ").replaceAll("_", " ")}`
                      : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

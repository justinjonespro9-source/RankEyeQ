"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  commitStatComponentsImportAction,
  exportStatComponentsTemplateAction,
  previewStatComponentsImportAction,
} from "@/lib/admin-stat-components-actions";
import type { StatComponentsPreview } from "@/lib/nfl/manual/stat-components-import";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

export function StatComponentsImportPanel({ weekId }: { weekId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [csvText, setCsvText] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [observedAt, setObservedAt] = useState("");
  const [replaceProvisional, setReplaceProvisional] = useState(false);
  const [approved, setApproved] = useState(false);
  const [preview, setPreview] = useState<StatComponentsPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<void>) {
    startTransition(async () => {
      try {
        await action();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Action failed");
      }
    });
  }

  return (
    <section className="mt-8 rounded-lg border border-border bg-surface-elevated p-5">
      <h2 className="font-display text-lg font-semibold text-ink">
        Batch statistical components
      </h2>
      <p className="mt-1 text-sm text-muted">
        Import verified PLAYER/DEF component lines for this week. Fantasy points
        are calculated with FantasyTrack Half-PPR V2 (same as Live Scoring).
        Writes are provisional only — games are not finalized and contests are
        not graded.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            run(async () => {
              setError(null);
              setMessage(null);
              const result = await exportStatComponentsTemplateAction({
                weekId,
              });
              if (!result.ok) {
                setError(result.error);
                return;
              }
              const blob = new Blob([result.result.csv], {
                type: "text/csv;charset=utf-8",
              });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = result.result.filename;
              anchor.click();
              URL.revokeObjectURL(url);
              setMessage(
                `Downloaded template · ${result.result.rowCount} pool rows (fill components + source fields)`,
              );
            })
          }
        >
          Download blank template
        </Button>
      </div>

      <label className="mt-4 block text-sm font-medium text-ink">
        CSV paste
        <textarea
          value={csvText}
          onChange={(event) => {
            setCsvText(event.target.value);
            setPreview(null);
            setApproved(false);
          }}
          rows={10}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs"
          spellCheck={false}
        />
      </label>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="text-sm text-ink">
          Source label
          <input
            value={sourceLabel}
            onChange={(event) => setSourceLabel(event.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
            placeholder="NFL.com box scores"
          />
        </label>
        <label className="text-sm text-ink">
          Source URL
          <input
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
            placeholder="https://…"
          />
        </label>
        <label className="text-sm text-ink">
          Observed at (ISO)
          <input
            value={observedAt}
            onChange={(event) => setObservedAt(event.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
            placeholder="2026-10-20T18:00:00.000Z"
          />
        </label>
      </div>

      <label className="mt-3 flex items-start gap-2 text-sm text-ink">
        <input
          type="checkbox"
          className="mt-1"
          checked={replaceProvisional}
          onChange={(event) => {
            setReplaceProvisional(event.target.checked);
            setPreview(null);
            setApproved(false);
          }}
        />
        <span>
          Allow replacing differing provisional WeekStat lines (required when
          Preview reports provisional conflicts).
        </span>
      </label>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending || !csvText.trim()}
          onClick={() =>
            run(async () => {
              setError(null);
              setMessage(null);
              setApproved(false);
              const result = await previewStatComponentsImportAction({
                weekId,
                csvText,
                replaceProvisional,
              });
              if (!result.ok) {
                setError(result.error);
                setPreview(null);
                return;
              }
              setPreview(result.preview);
              setMessage(
                result.preview.ready
                  ? `Preview ready · ${result.preview.coverage.matchedCount}/${result.preview.coverage.poolSize} matched · ${result.preview.scoringVersion}`
                  : result.preview.blockers[0] ?? "Preview not ready",
              );
            })
          }
        >
          Preview (no writes)
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={pending || !preview?.ready || !approved}
          onClick={() =>
            run(async () => {
              setError(null);
              setMessage(null);
              if (!preview) return;
              const result = await commitStatComponentsImportAction({
                weekId,
                csvText,
                previewToken: preview.previewToken,
                approved,
                sourceLabel,
                sourceUrl,
                observedAt,
                replaceProvisional,
              });
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setMessage(
                `Committed provisional stats · created ${result.result.created} · updated ${result.result.updated} · unchanged ${result.result.unchanged} · sha ${result.result.contentSha256.slice(0, 12)}…`,
              );
              setApproved(false);
              setPreview(null);
            })
          }
        >
          Commit provisional stats
        </Button>
      </div>

      {preview ? (
        <div className="mt-4 space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={preview.ready ? "success" : "danger"}>
              {preview.ready ? "READY" : "BLOCKED"}
            </Badge>
            <span className="text-muted">
              Coverage {preview.coverage.matchedCount}/
              {preview.coverage.poolSize}
              {preview.coverage.missingCount > 0
                ? ` · missing ${preview.coverage.missingCount}`
                : ""}
            </span>
            <span className="font-mono text-xs text-muted">
              sha {preview.contentSha256.slice(0, 16)}…
            </span>
          </div>

          {preview.blockers.length > 0 ? (
            <ul className="list-disc pl-5 text-danger">
              {preview.blockers.slice(0, 12).map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
              {preview.blockers.length > 12 ? (
                <li>…and {preview.blockers.length - 12} more</li>
              ) : null}
            </ul>
          ) : null}

          {preview.warnings.length > 0 ? (
            <ul className="list-disc pl-5 text-warning">
              {preview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}

          {preview.ready ? (
            <>
              <div className="max-h-56 overflow-auto rounded-md border border-border">
                <table className="w-full min-w-[36rem] text-left text-xs">
                  <thead className="sticky top-0 bg-surface text-muted">
                    <tr>
                      <th className="px-2 py-1">Pos</th>
                      <th className="px-2 py-1">Name</th>
                      <th className="px-2 py-1">Game</th>
                      <th className="px-2 py-1">FP</th>
                      <th className="px-2 py-1">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.matched.slice(0, 40).map((row) => (
                      <tr
                        key={row.contestEntryId}
                        className="border-t border-border"
                      >
                        <td className="px-2 py-1">{row.position}</td>
                        <td className="px-2 py-1">{row.name}</td>
                        <td className="px-2 py-1 font-mono">
                          {row.gameExternalId}
                        </td>
                        <td className="px-2 py-1 tabular-nums">
                          {row.fantasyPoints.toFixed(2)}
                        </td>
                        <td className="px-2 py-1">{row.action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.matched.length > 40 ? (
                <p className="text-xs text-muted">
                  Showing first 40 of {preview.matched.length} matched rows.
                </p>
              ) : null}
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={approved}
                  onChange={(event) => setApproved(event.target.checked)}
                />
                <span>
                  I verified this file against the named source (
                  {sourceLabel || "…"}) observed at {observedAt || "…"}. Commit
                  will write provisional WeekStats only.
                </span>
              </label>
            </>
          ) : null}
        </div>
      ) : null}

      {message ? (
        <p className="mt-3 text-sm text-accent-ink" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

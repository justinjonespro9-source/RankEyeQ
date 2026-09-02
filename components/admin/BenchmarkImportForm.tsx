"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { LATE_CAPTURE_WARNING } from "@/lib/benchmark-sources";
import {
  extractTopNFromPastedText,
  type SourceExtractRow,
} from "@/lib/benchmarks/parser";
import { isLateCapture } from "@/lib/benchmarks/merge";
import { adminCaptureBenchmarkAction } from "@/lib/admin-benchmark-actions";
import type { EligibleParserEntry } from "@/lib/admin/ai-parser";
import type { BenchmarkCaptureType } from "@/lib/generated/prisma/client";
import { parseChicagoDateTimeLocal, toChicagoDateTimeLocal } from "@/lib/timing/chicago";

export function BenchmarkImportForm({
  contestId,
  profileId,
  weekId,
  rankingDepth,
  eligible,
  universe = [],
  otherPositions = [],
  sourceName,
  fullLockAt,
  latestSnapshotId,
  hasOfficialBoard,
}: {
  contestId: string;
  profileId: string;
  weekId: string;
  rankingDepth: number;
  eligible: EligibleParserEntry[];
  universe?: EligibleParserEntry[];
  otherPositions?: EligibleParserEntry[];
  sourceName: string;
  fullLockAt: Date | string | null;
  latestSnapshotId: string | null;
  hasOfficialBoard: boolean;
}) {
  const [raw, setRaw] = useState("");
  const [rows, setRows] = useState<SourceExtractRow[] | null>(null);
  const [blocking, setBlocking] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [captureType, setCaptureType] =
    useState<BenchmarkCaptureType>("SUNDAY");
  const [capturedAt, setCapturedAt] = useState(() =>
    toChicagoDateTimeLocal(new Date()),
  );
  const [sourceUrl, setSourceUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [publicBoardAllowed, setPublicBoardAllowed] = useState(true);
  const [correctionReason, setCorrectionReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const late = useMemo(() => {
    const lock = fullLockAt ? new Date(fullLockAt) : null;
    const captured = parseChicagoDateTimeLocal(capturedAt) ?? new Date(capturedAt);
    return isLateCapture(captured, lock);
  }, [capturedAt, fullLockAt]);

  function parse() {
    const exclusions = (rows ?? [])
      .filter((row) => row.excluded)
      .map((row) => ({
        sourceRank: row.sourceRank,
        reason: row.exclusionReason ?? "Admin confirmed exclusion",
      }));
    const extracted = extractTopNFromPastedText({
      text: raw,
      eligible,
      rankingDepth,
      universe,
      otherPositions,
      confirmedExclusions: exclusions,
    });
    setRows(extracted.rows);
    setBlocking(extracted.blockingIssues);
    setReady(extracted.ready);
    setMessage(null);
  }

  function toggleExclude(sourceRank: number) {
    if (!rows) return;
    const next = rows.map((row) =>
      row.sourceRank === sourceRank
        ? {
            ...row,
            excluded: !row.excluded,
            exclusionReason: !row.excluded
              ? "Admin confirmed exclusion"
              : null,
          }
        : row,
    );
    const exclusions = next
      .filter((row) => row.excluded)
      .map((row) => ({
        sourceRank: row.sourceRank,
        reason: row.exclusionReason ?? "Admin confirmed exclusion",
      }));
    const extracted = extractTopNFromPastedText({
      text: raw,
      eligible,
      rankingDepth,
      universe,
      otherPositions,
      confirmedExclusions: exclusions,
    });
    setRows(extracted.rows);
    setBlocking(extracted.blockingIssues);
    setReady(extracted.ready);
  }

  function save(asCorrection: boolean) {
    if (!rows) return;
    if (asCorrection && !correctionReason.trim()) {
      setMessage("Corrections require a reason.");
      return;
    }
    startTransition(async () => {
      const result = await adminCaptureBenchmarkAction({
        contestId,
        profileId,
        weekId,
        captureType,
        capturedAt,
        sourceUrl,
        notes,
        rawText: raw,
        publicBoardAllowed,
        confirmedExclusions: rows
          .filter((row) => row.excluded)
          .map((row) => ({
            sourceRank: row.sourceRank,
            reason: row.exclusionReason ?? undefined,
          })),
        correctionOfId: asCorrection ? latestSnapshotId : null,
        correctionReason: asCorrection ? correctionReason : null,
        commitOfficial: !late,
      });
      setMessage(
        result.ok
          ? [result.message, ...(result.warnings ?? [])].join(" ")
          : result.error,
      );
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Independent RankEyeQ capture for {sourceName}. Paste a public or otherwise
        authorized ranking. EYEQ scores only Top {rankingDepth} eligible
        contest-pool players in source order.
      </p>
      <label className="block text-sm">
        <span className="text-muted">Paste source rankings</span>
        <textarea
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          rows={12}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm"
          placeholder={"1. Player Name\n2) Player Name\n3 - Player Name"}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-muted">Capture type</span>
          <select
            value={captureType}
            onChange={(event) =>
              setCaptureType(event.target.value as BenchmarkCaptureType)
            }
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
          >
            <option value="THURSDAY">Thursday snapshot</option>
            <option value="SUNDAY">Sunday snapshot</option>
            <option value="MANUAL_FINAL">Manual final / audited correction</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-muted">Captured at (America/Chicago)</span>
          <input
            type="datetime-local"
            value={capturedAt}
            onChange={(event) => setCapturedAt(event.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
          />
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="text-muted">Source URL (optional)</span>
          <input
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
            placeholder="https://"
          />
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="text-muted">Notes (optional)</span>
          <input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={publicBoardAllowed}
          onChange={(event) => setPublicBoardAllowed(event.target.checked)}
        />
        Public board may show RankEyeQ Top {rankingDepth} (uncheck for restricted sources)
      </label>
      {late ? (
        <p className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning">
          {LATE_CAPTURE_WARNING}
        </p>
      ) : null}
      <Button type="button" variant="secondary" onClick={parse}>
        Parse & extract Top {rankingDepth}
      </Button>

      {rows ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">Source rank</th>
                <th className="px-3 py-2">EYEQ slot</th>
                <th className="px-3 py-2">Parsed name</th>
                <th className="px-3 py-2">Matched</th>
                <th className="px-3 py-2">Issue</th>
                <th className="px-3 py-2">Exclude</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.sourceRank}
                  className={`border-b border-border last:border-0 ${
                    row.selected ? "bg-accent-soft/30" : ""
                  }`}
                >
                  <td className="px-3 py-2 tabular-nums">{row.sourceRank}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {row.rankIqRank ?? (row.extra ? "extra" : "—")}
                  </td>
                  <td className="px-3 py-2 text-ink">{row.rawName || "—"}</td>
                  <td className="px-3 py-2 text-ink">
                    {row.matchedName ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-warning">{row.issue ?? "—"}</td>
                  <td className="px-3 py-2">
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={row.excluded}
                        onChange={() => toggleExclude(row.sourceRank)}
                      />
                      Confirm skip
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {blocking.length > 0 ? (
            <ul className="space-y-1 p-3 text-sm text-warning">
              {blocking.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="p-3 text-sm text-muted">
              Highlighted rows are the RankEyeQ Top {rankingDepth} in source order.
            </p>
          )}
          <div className="flex flex-wrap gap-2 p-3">
            <Button
              type="button"
              disabled={pending || !ready}
              onClick={() => save(false)}
            >
              Save snapshot
            </Button>
            {hasOfficialBoard ? (
              <Button
                type="button"
                variant="secondary"
                disabled={pending || !ready || !correctionReason.trim()}
                onClick={() => save(true)}
              >
                Save correction
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {hasOfficialBoard ? (
        <label className="block text-sm">
          <span className="text-muted">
            Correction reason (required to rewrite an official board)
          </span>
          <input
            value={correctionReason}
            onChange={(event) => setCorrectionReason(event.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
            placeholder="Parser mapping / transcription / attribution"
          />
        </label>
      ) : null}

      {message ? <p className="text-sm text-accent">{message}</p> : null}
    </div>
  );
}

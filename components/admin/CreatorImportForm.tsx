"use client";

import Link from "next/link";
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
import {
  parseCreatorRankingPaste,
  parseMultiPositionCreatorPaste,
} from "@/lib/creators/ranking-paste";
import type { BenchmarkCaptureType } from "@/lib/generated/prisma/client";
import {
  parseChicagoDateTimeLocal,
  toChicagoDateTimeLocal,
} from "@/lib/timing/chicago";
import { rankingDepthForPosition } from "@/lib/contest-defaults";
import type { ContestPosition } from "@/lib/generated/prisma/client";

/**
 * Fast Creator ranking import — public attributable rankings only.
 * Persists via BenchmarkSnapshot (sourceUrl + sourcePublishedAt + capturedAt).
 * Never silently substitutes fuzzy matches.
 */
export function CreatorImportForm({
  contestId,
  profileId,
  weekId,
  position,
  rankingDepth,
  eligible,
  universe = [],
  otherPositions = [],
  creatorName,
  brandName,
  affiliationBadge,
  defaultSourceUrl,
  competitorActive,
  fullLockAt,
  latestSnapshotId,
  hasOfficialBoard,
  nextHref,
}: {
  contestId: string;
  profileId: string;
  weekId: string;
  position: ContestPosition;
  rankingDepth: number;
  eligible: EligibleParserEntry[];
  universe?: EligibleParserEntry[];
  otherPositions?: EligibleParserEntry[];
  creatorName: string;
  brandName: string | null;
  affiliationBadge: string;
  defaultSourceUrl: string | null;
  competitorActive: boolean;
  fullLockAt: Date | string | null;
  latestSnapshotId: string | null;
  hasOfficialBoard: boolean;
  nextHref: string | null;
}) {
  const [raw, setRaw] = useState("");
  const [rows, setRows] = useState<SourceExtractRow[] | null>(null);
  const [blocking, setBlocking] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [tierNote, setTierNote] = useState<string | null>(null);
  const [bulkPreview, setBulkPreview] = useState<
    Array<{ position: ContestPosition; lineCount: number; depth: number }>
  >([]);
  const [captureType, setCaptureType] =
    useState<BenchmarkCaptureType>("SUNDAY");
  const [capturedAt, setCapturedAt] = useState(() =>
    toChicagoDateTimeLocal(new Date()),
  );
  const [sourcePublishedAt, setSourcePublishedAt] = useState("");
  const [sourceUrl, setSourceUrl] = useState(defaultSourceUrl ?? "");
  const [notes, setNotes] = useState("");
  const [publicBoardAllowed, setPublicBoardAllowed] = useState(true);
  const [correctionReason, setCorrectionReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const late = useMemo(() => {
    const lock = fullLockAt ? new Date(fullLockAt) : null;
    const captured =
      parseChicagoDateTimeLocal(capturedAt) ?? new Date(capturedAt);
    return isLateCapture(captured, lock);
  }, [capturedAt, fullLockAt]);

  function parse() {
    const tiered = parseCreatorRankingPaste(raw);
    if (!tiered.ok) {
      setRows(null);
      setReady(false);
      setBlocking([tiered.error]);
      setTierNote(null);
      setMessage(null);
      return;
    }

    const exclusions = (rows ?? [])
      .filter((row) => row.excluded)
      .map((row) => ({
        sourceRank: row.sourceRank,
        reason: row.exclusionReason ?? "Admin confirmed exclusion",
      }));

    const extracted = extractTopNFromPastedText({
      text: raw,
      lines: tiered.lines,
      eligible,
      rankingDepth,
      universe,
      otherPositions,
      confirmedExclusions: exclusions,
    });

    // Exact field-size preference: too many selected extras still OK via extract,
    // but missing slots / unmatched block submit.
    setRows(extracted.rows);
    setBlocking(extracted.blockingIssues);
    setReady(extracted.ready);
    setTierNote(
      tiered.mode === "ordered_tiers"
        ? `Flattened ${tiered.tierCount} ordered tiers into ${tiered.lines.length} ranks.`
        : null,
    );
    setMessage(null);
  }

  function previewBulk() {
    const { sections } = parseMultiPositionCreatorPaste(raw);
    setBulkPreview(
      sections.map((section) => ({
        position: section.position,
        lineCount: section.lines.length,
        depth: rankingDepthForPosition(section.position),
      })),
    );
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
    const tiered = parseCreatorRankingPaste(raw);
    if (!tiered.ok) return;
    const extracted = extractTopNFromPastedText({
      text: raw,
      lines: tiered.lines,
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
    if (!rows || !ready) {
      setMessage(
        "Fix validation errors and parse again. RankEyeQ never silently repairs creator rankings.",
      );
      return;
    }
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
        sourcePublishedAt: sourcePublishedAt || null,
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
      <div className="rounded-lg border border-border bg-surface px-4 py-3 text-sm">
        <p className="font-medium text-ink">
          {creatorName} · {affiliationBadge}
        </p>
        <p className="mt-1 text-muted">
          Tracked competitor{competitorActive ? "" : " (inactive)"}
          {brandName ? ` · ${brandName}` : ""}. Import clearly public rankings
          published before kickoff — not an endorsement or partnership.
        </p>
        <p className="mt-1 text-xs text-muted">
          Field size: Top {rankingDepth} · Position {position} · Week preserved
          via matrix navigation
        </p>
      </div>

      <p className="text-sm text-muted">
        Paste formats: numbered list, plain ordered names, CSV (
        <code className="text-xs">rank,player</code>), or ordered tiers (
        <code className="text-xs">Tier 1:</code>). Unordered tiers are refused.
      </p>

      <label className="block text-sm">
        <span className="text-muted">Ranking paste</span>
        <textarea
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          rows={14}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm"
          placeholder={
            "1. Bijan Robinson\n2. Jahmyr Gibbs\n3. Saquon Barkley\n\n# or plain ordered names / CSV / Tier 1: ..."
          }
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm sm:col-span-2">
          <span className="text-muted">Source URL</span>
          <input
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
            placeholder="https:// public ranking URL"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">
            Source published (Chicago, optional)
          </span>
          <input
            type="datetime-local"
            value={sourcePublishedAt}
            onChange={(event) => setSourcePublishedAt(event.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">Import captured at (Chicago)</span>
          <input
            type="datetime-local"
            value={capturedAt}
            onChange={(event) => setCapturedAt(event.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">Capture type</span>
          <select
            value={captureType}
            onChange={(event) =>
              setCaptureType(event.target.value as BenchmarkCaptureType)
            }
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
          >
            <option value="THURSDAY">Thursday snapshot (draft)</option>
            <option value="SUNDAY">Sunday snapshot (submit)</option>
            <option value="MANUAL_FINAL">Manual final / correction</option>
          </select>
        </label>
        <label className="block text-sm">
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
        Public board may show RankEyeQ Top {rankingDepth}
      </label>

      {late ? (
        <p className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning">
          {LATE_CAPTURE_WARNING} Source published time is stored separately from
          import time and does not bypass lock rules.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={parse}>
          Parse &amp; validate Top {rankingDepth}
        </Button>
        <Button type="button" variant="ghost" onClick={previewBulk}>
          Preview multi-position paste
        </Button>
        {nextHref ? (
          <Link
            href={nextHref}
            className="inline-flex items-center rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-ink hover:border-ink/30"
          >
            Next missing board
          </Link>
        ) : null}
      </div>

      {bulkPreview.length > 0 ? (
        <div className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-muted">
          <p className="font-medium text-ink">Multi-position sections detected</p>
          <ul className="mt-1 list-disc pl-5">
            {bulkPreview.map((section) => (
              <li key={section.position}>
                {section.position}: {section.lineCount} lines (needs{" "}
                {section.depth}) — open that position board to import
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs">
            Bulk multi-position auto-submit is not enabled (launch safety). Parse
            each position separately.
          </p>
        </div>
      ) : null}

      {tierNote ? <p className="text-sm text-accent-ink">{tierNote}</p> : null}

      {rows ? (
        <div className="space-y-3">
          <div className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
            <p className="font-medium text-ink">Preview</p>
            <ul className="mt-1 space-y-0.5 text-muted">
              <li>
                Creator: {creatorName} · {affiliationBadge}
              </li>
              <li>
                Week / Position: preserved · {position} · Top {rankingDepth}
              </li>
              <li>Source URL: {sourceUrl.trim() || "—"}</li>
              <li>
                Source published: {sourcePublishedAt || "—"} · Import:{" "}
                {capturedAt}
              </li>
              <li>
                Lock: {late ? "LATE vs full lock" : "On-time for official board"}
              </li>
            </ul>
          </div>

          {blocking.length > 0 ? (
            <div
              className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
              role="alert"
            >
              <p className="font-medium">Validation errors</p>
              <ul className="mt-1 list-disc pl-5">
                {blocking.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="rounded-md border border-success/30 bg-success-soft px-3 py-2 text-sm text-success">
              Valid · {rankingDepth} / {rankingDepth} eligible slots in source
              order
            </p>
          )}

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Source #</th>
                  <th className="px-3 py-2">EYEQ</th>
                  <th className="px-3 py-2">Parsed</th>
                  <th className="px-3 py-2">Matched</th>
                  <th className="px-3 py-2">Suggestions</th>
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
                    <td className="px-3 py-2 text-xs text-muted">
                      {row.issue === "ambiguous"
                        ? row.candidates.map((c) => c.name).join(", ")
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-warning">
                      {row.issue ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={row.excluded}
                          onChange={() => toggleExclude(row.sourceRank)}
                        />
                        Skip
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex flex-wrap gap-2 p-3">
              <Button
                type="button"
                disabled={pending || !ready}
                onClick={() => save(false)}
              >
                Submit ranking
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
          />
        </label>
      ) : null}

      {message ? <p className="text-sm text-accent-ink">{message}</p> : null}
    </div>
  );
}

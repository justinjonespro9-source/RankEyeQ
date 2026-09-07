"use client";

import Link from "next/link";
import {
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { Button } from "@/components/ui/Button";
import { LATE_CAPTURE_WARNING } from "@/lib/benchmark-sources";
import { extractTopNFromPastedText } from "@/lib/benchmarks/parser";
import { isLateCapture } from "@/lib/benchmarks/merge";
import { adminCaptureBenchmarkAction } from "@/lib/admin-benchmark-actions";
import {
  clearCreatorImportDraft,
  emptyCreatorImportDraft,
  readCreatorImportDraft,
  shouldClearCreatorImportDraft,
  writeCreatorImportDraft,
  type CreatorImportDraft,
} from "@/lib/admin/creator-import-draft";
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

const draftListeners = new Set<() => void>();

function notifyCreatorImportDraftListeners() {
  for (const listener of draftListeners) listener();
}

function subscribeCreatorImportDraft(listener: () => void) {
  draftListeners.add(listener);
  return () => {
    draftListeners.delete(listener);
  };
}

/**
 * Fast Creator ranking import — public attributable rankings only.
 *
 * Client preview validates against contest-eligible players only (keeps RSC
 * payload small). Full universe / wrong-position catalogs are applied on the
 * server action at submit time.
 *
 * Draft lives in sessionStorage so remount / error-boundary Retry keeps paste.
 * Cleared only on official lock or Reset.
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
  // Stable SSR/client fallback — never stamp `new Date()` into the server snapshot
  // or hydration will mismatch and trip admin error.tsx.
  const emptyDraft = useMemo(
    () =>
      emptyCreatorImportDraft({
        sourceUrl: defaultSourceUrl ?? "",
        capturedAt: "",
      }),
    [defaultSourceUrl],
  );

  const readSnapshot = useCallback((): CreatorImportDraft => {
    if (typeof window === "undefined") return emptyDraft;
    return (
      readCreatorImportDraft(window.sessionStorage, profileId, contestId) ??
      emptyDraft
    );
  }, [profileId, contestId, emptyDraft]);

  const draft = useSyncExternalStore(
    subscribeCreatorImportDraft,
    readSnapshot,
    () => emptyDraft,
  );

  const [bulkPreview, setBulkPreview] = useState<
    Array<{ position: ContestPosition; lineCount: number; depth: number }>
  >([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function ensureCapturedAt(next: CreatorImportDraft): CreatorImportDraft {
    if (next.capturedAt.trim()) return next;
    return {
      ...next,
      capturedAt: toChicagoDateTimeLocal(new Date()),
    };
  }

  function patchDraft(partial: Partial<CreatorImportDraft>) {
    const next = ensureCapturedAt({ ...draft, ...partial });
    writeCreatorImportDraft(
      typeof window !== "undefined" ? window.sessionStorage : null,
      profileId,
      contestId,
      next,
    );
    notifyCreatorImportDraftListeners();
  }

  const displayCapturedAt =
    draft.capturedAt ||
    // Display-only fallback; do not write during render (hydration-safe).
    "";

  const late = useMemo(() => {
    const lock = fullLockAt ? new Date(fullLockAt) : null;
    const raw = draft.capturedAt.trim();
    if (!raw) return false;
    const captured = parseChicagoDateTimeLocal(raw) ?? new Date(raw);
    if (Number.isNaN(captured.getTime())) return false;
    return isLateCapture(captured, lock);
  }, [draft.capturedAt, fullLockAt]);

  function parse() {
    const withTime = ensureCapturedAt(draft);
    if (withTime.capturedAt !== draft.capturedAt) {
      writeCreatorImportDraft(
        typeof window !== "undefined" ? window.sessionStorage : null,
        profileId,
        contestId,
        withTime,
      );
      notifyCreatorImportDraftListeners();
    }

    const tiered = parseCreatorRankingPaste(withTime.raw);
    if (!tiered.ok) {
      patchDraft({
        capturedAt: withTime.capturedAt,
        rows: null,
        ready: false,
        blocking: [tiered.error],
        tierNote: null,
      });
      setMessage(null);
      return;
    }

    const exclusions = (withTime.rows ?? [])
      .filter((row) => row.excluded)
      .map((row) => ({
        sourceRank: row.sourceRank,
        reason: row.exclusionReason ?? "Admin confirmed exclusion",
      }));

    const extracted = extractTopNFromPastedText({
      text: withTime.raw,
      lines: tiered.lines,
      eligible,
      rankingDepth,
      universe,
      otherPositions,
      confirmedExclusions: exclusions,
    });

    patchDraft({
      capturedAt: withTime.capturedAt,
      rows: extracted.rows,
      blocking: extracted.blockingIssues,
      ready: extracted.ready,
      tierNote:
        tiered.mode === "ordered_tiers"
          ? `Flattened ${tiered.tierCount} ordered tiers into ${tiered.lines.length} ranks.`
          : null,
    });
    setMessage(null);
  }

  function previewBulk() {
    const { sections } = parseMultiPositionCreatorPaste(draft.raw);
    setBulkPreview(
      sections.map((section) => ({
        position: section.position,
        lineCount: section.lines.length,
        depth: rankingDepthForPosition(section.position),
      })),
    );
  }

  function toggleExclude(sourceRank: number) {
    if (!draft.rows) return;
    const next = draft.rows.map((row) =>
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
    const tiered = parseCreatorRankingPaste(draft.raw);
    if (!tiered.ok) return;
    const extracted = extractTopNFromPastedText({
      text: draft.raw,
      lines: tiered.lines,
      eligible,
      rankingDepth,
      universe,
      otherPositions,
      confirmedExclusions: exclusions,
    });
    patchDraft({
      rows: extracted.rows,
      blocking: extracted.blockingIssues,
      ready: extracted.ready,
    });
  }

  function resetForm() {
    clearCreatorImportDraft(
      typeof window !== "undefined" ? window.sessionStorage : null,
      profileId,
      contestId,
    );
    writeCreatorImportDraft(
      typeof window !== "undefined" ? window.sessionStorage : null,
      profileId,
      contestId,
      emptyCreatorImportDraft({
        sourceUrl: defaultSourceUrl ?? "",
        capturedAt: "",
      }),
    );
    notifyCreatorImportDraftListeners();
    setBulkPreview([]);
    setMessage(null);
  }

  function save(asCorrection: boolean) {
    const rows = draft.rows;
    if (!rows || !draft.ready) {
      setMessage(
        "Fix validation errors and parse again. RankEyeQ never silently repairs creator rankings.",
      );
      return;
    }
    if (asCorrection && !draft.correctionReason.trim()) {
      setMessage("Corrections require a reason.");
      return;
    }
    const withTime = ensureCapturedAt(draft);
    startTransition(async () => {
      try {
        const result = await adminCaptureBenchmarkAction({
          contestId,
          profileId,
          weekId,
          captureType: withTime.captureType,
          capturedAt: withTime.capturedAt,
          sourcePublishedAt: withTime.sourcePublishedAt || null,
          sourceUrl: withTime.sourceUrl,
          notes: withTime.notes,
          rawText: withTime.raw,
          publicBoardAllowed: withTime.publicBoardAllowed,
          confirmedExclusions: rows
            .filter((row) => row.excluded)
            .map((row) => ({
              sourceRank: row.sourceRank,
              reason: row.exclusionReason ?? undefined,
            })),
          correctionOfId: asCorrection ? latestSnapshotId : null,
          correctionReason: asCorrection ? withTime.correctionReason : null,
          commitOfficial: !late,
        });
        setMessage(
          result.ok
            ? [result.message, ...(result.warnings ?? [])].join(" ")
            : result.error,
        );
        if (shouldClearCreatorImportDraft(result)) {
          clearCreatorImportDraft(
            typeof window !== "undefined" ? window.sessionStorage : null,
            profileId,
            contestId,
          );
          notifyCreatorImportDraftListeners();
        }
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to capture benchmark snapshot",
        );
      }
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
          Field size: Top {rankingDepth} · Position {position} · Eligible pool{" "}
          {eligible.length} · Week preserved via matrix navigation
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
          value={draft.raw}
          onChange={(event) => patchDraft({ raw: event.target.value })}
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
            value={draft.sourceUrl}
            onChange={(event) => patchDraft({ sourceUrl: event.target.value })}
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
            value={draft.sourcePublishedAt}
            onChange={(event) =>
              patchDraft({ sourcePublishedAt: event.target.value })
            }
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">Import captured at (Chicago)</span>
          <input
            type="datetime-local"
            value={displayCapturedAt}
            onChange={(event) => patchDraft({ capturedAt: event.target.value })}
            onFocus={() => {
              if (!draft.capturedAt.trim()) {
                patchDraft({ capturedAt: toChicagoDateTimeLocal(new Date()) });
              }
            }}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">Capture type</span>
          <select
            value={draft.captureType}
            onChange={(event) =>
              patchDraft({
                captureType: event.target.value as BenchmarkCaptureType,
              })
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
            value={draft.notes}
            onChange={(event) => patchDraft({ notes: event.target.value })}
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
          />
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={draft.publicBoardAllowed}
          onChange={(event) =>
            patchDraft({ publicBoardAllowed: event.target.checked })
          }
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
        <Button type="button" variant="ghost" onClick={resetForm}>
          Reset
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

      {draft.tierNote ? (
        <p className="text-sm text-accent-ink">{draft.tierNote}</p>
      ) : null}

      {draft.rows ? (
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
              <li>Source URL: {draft.sourceUrl.trim() || "—"}</li>
              <li>
                Source published: {draft.sourcePublishedAt || "—"} · Import:{" "}
                {draft.capturedAt || "—"}
              </li>
              <li>
                Lock: {late ? "LATE vs full lock" : "On-time for official board"}
              </li>
            </ul>
          </div>

          {draft.blocking.length > 0 ? (
            <div
              className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
              role="alert"
            >
              <p className="font-medium">Validation errors</p>
              <ul className="mt-1 list-disc pl-5">
                {draft.blocking.map((item) => (
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
                {draft.rows.map((row) => (
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
                disabled={pending || !draft.ready}
                onClick={() => save(false)}
              >
                {pending ? "Submitting…" : "Submit ranking"}
              </Button>
              {hasOfficialBoard ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={
                    pending || !draft.ready || !draft.correctionReason.trim()
                  }
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
            value={draft.correctionReason}
            onChange={(event) =>
              patchDraft({ correctionReason: event.target.value })
            }
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
          />
        </label>
      ) : null}

      {message ? (
        <p
          className={`text-sm ${
            message.toLowerCase().includes("unable") ||
            message.toLowerCase().includes("failed") ||
            message.toLowerCase().includes("cannot") ||
            message.toLowerCase().includes("require")
              ? "text-danger"
              : "text-accent-ink"
          }`}
          role="status"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

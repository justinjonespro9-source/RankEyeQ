"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import {
  mergeUniversalRankingIntoLockedBoard,
  orderedMatchedIdsFromUniversalPaste,
  type EligibleParserEntry,
  type ImmutableLockedPick,
} from "@/lib/admin/ai-parser";
import { adminSaveParsedBotBoardAction } from "@/lib/admin-command-actions";

export function AiParserForm({
  contestId,
  profileId,
  weekId,
  rankingDepth,
  scoringDepth,
  eligible,
  lockedPicks = [],
  kickedOffIds = [],
}: {
  contestId: string;
  profileId: string;
  weekId: string;
  /** Submission depth including reserves (12 / 17). */
  rankingDepth: number;
  /** Scoring depth (10 / 15). */
  scoringDepth: number;
  eligible: EligibleParserEntry[];
  /** Profile-immutable locks preserved at their ranks during import merge. */
  lockedPicks?: Array<ImmutableLockedPick & { name?: string; team?: string }>;
  /** Entry IDs that have kicked off and cannot be newly added. */
  kickedOffIds?: string[];
}) {
  const [raw, setRaw] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [mergePreview, setMergePreview] = useState<{
    ok: boolean;
    rankedEntryIds: (string | null)[];
    error?: string;
    preservedLocks: number;
    filledUnlocked: number;
    skippedDuplicateLocks: number;
    skippedKickedOff: number;
    truncated: number;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  const eligibleById = useMemo(() => {
    const map = new Map<string, { name: string; team?: string }>();
    for (const entry of eligible) map.set(entry.id, entry);
    for (const pick of lockedPicks) {
      if (!map.has(pick.rankableEntryId) && pick.name) {
        map.set(pick.rankableEntryId, { name: pick.name, team: pick.team });
      }
    }
    return map;
  }, [eligible, lockedPicks]);

  function parse() {
    const ordered = orderedMatchedIdsFromUniversalPaste({
      text: raw,
      eligible,
      kickedOffIds,
    });
    const merged = mergeUniversalRankingIntoLockedBoard({
      submissionDepth: rankingDepth,
      lockedPicks,
      orderedResponseIds: ordered,
      kickedOffIds,
    });
    setMergePreview({
      ok: merged.ok,
      rankedEntryIds: merged.rankedEntryIds,
      error: merged.ok ? undefined : merged.error,
      preservedLocks: merged.preservedLocks,
      filledUnlocked: merged.filledUnlocked,
      skippedDuplicateLocks: merged.skippedDuplicateLocks,
      skippedKickedOff: merged.skippedKickedOff,
      truncated: merged.truncated,
    });
    setMessage(null);
  }

  const ready = Boolean(mergePreview?.ok);

  function save(submit: boolean) {
    if (!mergePreview?.ok) {
      setMessage(
        mergePreview?.error ??
          "Parse a complete merged board before saving. RankEyeQ does not silently invent missing unlocked slots.",
      );
      return;
    }
    const rankedEntryIds = mergePreview.rankedEntryIds;
    startTransition(async () => {
      const result = await adminSaveParsedBotBoardAction({
        contestId,
        profileId,
        weekId,
        rankedEntryIds,
        submit,
      });
      setMessage(
        result.ok
          ? submit
            ? "Bot ranking submitted"
            : "Bot draft saved"
          : result.error,
      );
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Paste the universal model response (ordered selectable players). Profile
        kickoff-locked picks stay in their original slots; only unlocked scoring
        and reserve slots are filled from the paste. Need exactly{" "}
        {rankingDepth} slots after merge (Top {scoringDepth} + reserves).
      </p>
      {lockedPicks.length > 0 ? (
        <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
          Preserving {lockedPicks.length} locked pick
          {lockedPicks.length === 1 ? "" : "s"} on this AI profile board during
          import.
        </p>
      ) : null}
      <label className="block text-sm">
        <span className="text-muted">Paste AI response</span>
        <textarea
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          rows={12}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm"
          placeholder={"1. Jahmyr Gibbs\n2. Bijan Robinson\n3. Jonathan Taylor"}
        />
      </label>
      <Button type="button" variant="secondary" onClick={parse}>
        Parse rankings
      </Button>

      {mergePreview ? (
        <div className="space-y-3">
          {!mergePreview.ok ? (
            <div
              className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
              role="alert"
            >
              <p className="font-medium">Merge rejected</p>
              <p className="mt-1">{mergePreview.error}</p>
            </div>
          ) : (
            <p className="rounded-md border border-success/30 bg-success-soft px-3 py-2 text-sm text-success">
              Valid merge · preserved {mergePreview.preservedLocks} lock
              {mergePreview.preservedLocks === 1 ? "" : "s"} · filled{" "}
              {mergePreview.filledUnlocked} unlocked slot
              {mergePreview.filledUnlocked === 1 ? "" : "s"}
              {mergePreview.skippedDuplicateLocks
                ? ` · skipped ${mergePreview.skippedDuplicateLocks} duplicate(s)`
                : ""}
              {mergePreview.skippedKickedOff
                ? ` · skipped ${mergePreview.skippedKickedOff} kicked-off`
                : ""}
              {mergePreview.truncated
                ? ` · truncated ${mergePreview.truncated} excess`
                : ""}
            </p>
          )}

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Rank</th>
                  <th className="px-3 py-2">Merged entry</th>
                  <th className="px-3 py-2">Source</th>
                </tr>
              </thead>
              <tbody>
                {mergePreview.rankedEntryIds.map((id, index) => {
                  const rank = index + 1;
                  const locked = lockedPicks.some((pick) => pick.rank === rank);
                  const entry = id ? eligibleById.get(id) : null;
                  const isReserve = rank > scoringDepth;
                  return (
                    <tr
                      key={`slot-${rank}`}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-3 py-2 tabular-nums">
                        {isReserve ? `R${rank - scoringDepth}` : rank}
                      </td>
                      <td className="px-3 py-2 text-ink">
                        {entry?.name ?? (id ? id : "—")}
                      </td>
                      <td className="px-3 py-2 text-muted">
                        {locked ? "Locked (preserved)" : id ? "From paste" : "Empty"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex flex-wrap gap-2 p-3">
              <Button
                type="button"
                variant="secondary"
                disabled={pending || !ready}
                onClick={() => save(false)}
              >
                Save Draft
              </Button>
              <Button
                type="button"
                disabled={pending || !ready}
                onClick={() => save(true)}
              >
                Submit Ranking
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {message ? <p className="text-sm text-accent-ink">{message}</p> : null}
    </div>
  );
}

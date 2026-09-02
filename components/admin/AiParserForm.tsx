"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import {
  matchParsedRankings,
  parseNumberedRankingLines,
  previewIsReadyToSubmit,
  previewToRankedIds,
  type EligibleParserEntry,
  type ParsedPickPreview,
} from "@/lib/admin/ai-parser";
import { adminSaveParsedBotBoardAction } from "@/lib/admin-command-actions";

export function AiParserForm({
  contestId,
  profileId,
  weekId,
  rankingDepth,
  eligible,
  universe = [],
}: {
  contestId: string;
  profileId: string;
  weekId: string;
  rankingDepth: number;
  eligible: EligibleParserEntry[];
  universe?: EligibleParserEntry[];
}) {
  const [raw, setRaw] = useState("");
  const [preview, setPreview] = useState<ParsedPickPreview[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function parse() {
    const lines = parseNumberedRankingLines(raw);
    const next = matchParsedRankings({
      lines,
      eligible,
      rankingDepth,
      universe,
    });
    setPreview(next);
    setMessage(null);
  }

  function updateRow(rank: number, entryId: string) {
    if (!preview) return;
    setPreview(
      preview.map((row) => {
        if (row.rank !== rank) return row;
        const match = eligible.find((entry) => entry.id === entryId) ?? null;
        return {
          ...row,
          matchedEntryId: entryId || null,
          matchedName: match?.name ?? null,
          issue: entryId ? null : row.issue,
          candidates: row.candidates,
        };
      }),
    );
  }

  const ready = useMemo(
    () => (preview ? previewIsReadyToSubmit(preview, rankingDepth) : false),
    [preview, rankingDepth],
  );

  function save(submit: boolean) {
    if (!preview) return;
    const rankedEntryIds = previewToRankedIds(preview, rankingDepth);
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

      {preview ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">Rank</th>
                <th className="px-3 py-2">Parsed name</th>
                <th className="px-3 py-2">Match / correction</th>
                <th className="px-3 py-2">Issue</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((row) => (
                <tr key={row.rank} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 tabular-nums">{row.rank}</td>
                  <td className="px-3 py-2 text-ink">{row.rawName || "—"}</td>
                  <td className="px-3 py-2">
                    <select
                      value={row.matchedEntryId ?? ""}
                      onChange={(event) => updateRow(row.rank, event.target.value)}
                      className="w-full rounded-md border border-border bg-surface px-2 py-1"
                    >
                      <option value="">Select player</option>
                      {(row.candidates.length > 0 ? row.candidates : eligible).map(
                        (entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.name}
                          </option>
                        ),
                      )}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-warning">
                    {row.issue ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap gap-2 p-3">
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
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
      ) : null}
      {message ? <p className="text-sm text-accent">{message}</p> : null}
    </div>
  );
}

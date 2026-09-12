"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import {
  matchParsedRankings,
  parseRankingPaste,
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
  scoringDepth,
  eligible,
  universe = [],
  otherPositions = [],
}: {
  contestId: string;
  profileId: string;
  weekId: string;
  /** Submission depth including reserves (12 / 17). */
  rankingDepth: number;
  /** Scoring depth (10 / 15). */
  scoringDepth: number;
  eligible: EligibleParserEntry[];
  universe?: EligibleParserEntry[];
  otherPositions?: EligibleParserEntry[];
}) {
  const [raw, setRaw] = useState("");
  const [preview, setPreview] = useState<ParsedPickPreview[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function parse() {
    const lines = parseRankingPaste(raw);
    const next = matchParsedRankings({
      lines,
      eligible,
      rankingDepth,
      scoringDepth,
      universe,
      otherPositions,
    });
    setPreview(next);
    setMessage(null);
  }

  const ready = useMemo(
    () => (preview ? previewIsReadyToSubmit(preview, rankingDepth) : false),
    [preview, rankingDepth],
  );

  const issueSummary = useMemo(() => {
    if (!preview) return [];
    return preview
      .filter((row) => row.issue)
      .map((row) => {
        const label = row.rawName
          ? `#${row.rank} “${row.rawName}”`
          : `#${row.rank}`;
        const reserve = row.isReserve ? ` (R${row.reserveSlot})` : "";
        return `${label}${reserve}: ${row.issue}`;
      });
  }, [preview]);

  function save(submit: boolean) {
    if (!preview || !ready) {
      setMessage(
        "Fix every validation error in the pasted ranking, then parse again. RankEyeQ does not silently repair AI output.",
      );
      return;
    }
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
      <p className="text-sm text-muted">
        Paste the model&apos;s numbered ranking only (exactly {rankingDepth}{" "}
        players). Slots 1–{scoringDepth} are scoring picks;{" "}
        {scoringDepth + 1}–{rankingDepth} are ordered reserves (R1 / R2). Every
        name must resolve to an eligible contest entry.
      </p>
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
        <div className="space-y-3">
          {issueSummary.length > 0 ? (
            <div
              className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger"
              role="alert"
            >
              <p className="font-medium">Validation errors — fix the paste</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {issueSummary.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="rounded-md border border-success/30 bg-success-soft px-3 py-2 text-sm text-success">
              Valid · {rankingDepth} / {rankingDepth} eligible players matched
              (Top {scoringDepth} + 2 reserves)
            </p>
          )}

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Rank</th>
                  <th className="px-3 py-2">Parsed name</th>
                  <th className="px-3 py-2">Matched entry</th>
                  <th className="px-3 py-2">Issue</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row) => (
                  <tr
                    key={`${row.rank}-${row.rawName}`}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-3 py-2 tabular-nums">
                      {row.isReserve ? `R${row.reserveSlot}` : row.rank}
                    </td>
                    <td className="px-3 py-2 text-ink">{row.rawName || "—"}</td>
                    <td className="px-3 py-2 text-ink">
                      {row.matchedName ?? "—"}
                      {row.issue === "ambiguous" && row.candidates.length > 0 ? (
                        <span className="mt-1 block text-xs text-muted">
                          Ambiguous — paste a full name. Candidates:{" "}
                          {row.candidates.map((c) => c.name).join(", ")}
                        </span>
                      ) : null}
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

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
import {
  adminCommitAiHistoricalBoardAction,
  adminPreviewAiHistoricalBoardAction,
} from "@/lib/admin-ai-historical-actions";
import {
  AI_HISTORICAL_ACK_TEXT,
  AI_HISTORICAL_BACKFILL_BADGE,
  AI_HISTORICAL_ENTRY_LABEL,
  AI_HISTORICAL_EVIDENCE_TYPES,
  type AiHistoricalProvenanceClassUi,
} from "@/lib/rankings/ai-historical-backfill-ui";

type HistoricalPreview = {
  ready: boolean;
  status: "READY" | "HOLD" | "BLOCKED";
  blockers: string[];
  warnings: string[];
  holdReasons: string[];
  previewFingerprint: string;
  competitiveAt: string;
  capturedAt: string;
  provenanceClass: AiHistoricalProvenanceClassUi;
  thursdayPlayerCount: number;
  rankedEntryIds: string[];
  officiallyCompetitive?: boolean;
};

export function AiParserForm({
  contestId,
  profileId,
  weekId,
  rankingDepth,
  scoringDepth,
  eligible,
  /** Full non-excluded pool for historical mode (includes kicked-off players). */
  historicalEligible,
  lockedPicks = [],
  kickedOffIds = [],
  allowHistoricalEntry = true,
}: {
  contestId: string;
  profileId: string;
  weekId: string;
  /** Submission depth including reserves (12 / 17). */
  rankingDepth: number;
  /** Scoring depth (10 / 15). */
  scoringDepth: number;
  eligible: EligibleParserEntry[];
  historicalEligible?: EligibleParserEntry[];
  /** Profile-immutable locks preserved at their ranks during import merge. */
  lockedPicks?: Array<ImmutableLockedPick & { name?: string; team?: string }>;
  /** Entry IDs that have kicked off and cannot be newly added (normal mode). */
  kickedOffIds?: string[];
  allowHistoricalEntry?: boolean;
}) {
  const [mode, setMode] = useState<"normal" | "historical">("normal");
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

  const [originalPredictionAt, setOriginalPredictionAt] = useState("");
  const [evidenceType, setEvidenceType] = useState<string>("");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [sourceIdentifier, setSourceIdentifier] = useState("");
  const [evidenceIndependentlyReviewed, setEvidenceIndependentlyReviewed] =
    useState(false);
  const [showOptionalEvidence, setShowOptionalEvidence] = useState(false);
  const [attestationAccepted, setAttestationAccepted] = useState(false);
  const [historicalPreview, setHistoricalPreview] =
    useState<HistoricalPreview | null>(null);

  const poolForMode =
    mode === "historical" ? (historicalEligible ?? eligible) : eligible;

  const eligibleById = useMemo(() => {
    const map = new Map<string, { name: string; team?: string }>();
    for (const entry of poolForMode) map.set(entry.id, entry);
    for (const pick of lockedPicks) {
      if (!map.has(pick.rankableEntryId) && pick.name) {
        map.set(pick.rankableEntryId, { name: pick.name, team: pick.team });
      }
    }
    return map;
  }, [poolForMode, lockedPicks]);

  function parse() {
    const kicked =
      mode === "historical" ? [] : kickedOffIds;
    const ordered = orderedMatchedIdsFromUniversalPaste({
      text: raw,
      eligible: poolForMode,
      kickedOffIds: kicked,
    });
    const merged = mergeUniversalRankingIntoLockedBoard({
      submissionDepth: rankingDepth,
      lockedPicks: mode === "historical" ? [] : lockedPicks,
      orderedResponseIds: ordered,
      kickedOffIds: kicked,
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
    setHistoricalPreview(null);
    setMessage(null);
  }

  const ready = Boolean(mergePreview?.ok);
  const filledIds =
    mergePreview?.ok
      ? mergePreview.rankedEntryIds.filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        )
      : [];

  function save(submit: boolean) {
    if (mode !== "normal") return;
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

  function runHistoricalPreview() {
    if (!mergePreview?.ok) {
      setMessage("Parse a complete board before historical Preview.");
      return;
    }
    startTransition(async () => {
      const result = await adminPreviewAiHistoricalBoardAction({
        contestId,
        profileId,
        weekId,
        rankedEntryIds: filledIds,
        originalPredictionAt,
        evidenceType: evidenceType || null,
        evidenceReference: evidenceReference || null,
        sourceIdentifier: sourceIdentifier || null,
        rawResponseText: raw,
        evidenceIndependentlyReviewed,
        attestationAccepted,
      });
      if (!result.ok) {
        setHistoricalPreview(null);
        setMessage(result.error);
        return;
      }
      setHistoricalPreview(result.preview);
      setMessage(
        result.preview.status === "READY"
          ? "Eligibility Preview READY — review then Commit historical entry."
          : result.preview.status === "HOLD"
            ? `HOLD — ${result.preview.holdReasons[0] ?? "owner review required"}`
            : `BLOCKED — ${result.preview.blockers[0] ?? "not ready"}`,
      );
    });
  }

  function commitHistorical() {
    if (!mergePreview?.ok || !historicalPreview?.ready) {
      setMessage("Run a READY eligibility Preview before committing.");
      return;
    }
    startTransition(async () => {
      const result = await adminCommitAiHistoricalBoardAction({
        contestId,
        profileId,
        weekId,
        rankedEntryIds: filledIds,
        originalPredictionAt,
        evidenceType: evidenceType || null,
        evidenceReference: evidenceReference || null,
        sourceIdentifier: sourceIdentifier || null,
        rawResponseText: raw,
        evidenceIndependentlyReviewed,
        attestationAccepted,
        previewFingerprint: historicalPreview.previewFingerprint,
      });
      setMessage(result.ok ? result.message : result.error);
      if (result.ok) setHistoricalPreview(null);
    });
  }

  return (
    <div className="space-y-4">
      {allowHistoricalEntry ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={mode === "normal" ? "primary" : "secondary"}
            onClick={() => {
              setMode("normal");
              setHistoricalPreview(null);
              setMergePreview(null);
              setMessage(null);
            }}
          >
            Normal entry
          </Button>
          <Button
            type="button"
            variant={mode === "historical" ? "primary" : "secondary"}
            onClick={() => {
              setMode("historical");
              setHistoricalPreview(null);
              setMergePreview(null);
              setMessage(null);
            }}
          >
            {AI_HISTORICAL_ENTRY_LABEL}
          </Button>
          {mode === "historical" ? (
            <span className="self-center rounded border border-warning/40 bg-warning-soft px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-warning">
              {AI_HISTORICAL_BACKFILL_BADGE}
            </span>
          ) : null}
        </div>
      ) : null}

      {mode === "normal" ? (
        <p className="text-sm text-muted">
          Paste the universal model response (ordered selectable players). Profile
          kickoff-locked picks stay in their original slots; only unlocked scoring
          and reserve slots are filled from the paste. Need exactly{" "}
          {rankingDepth} slots after merge (Top {scoringDepth} + reserves).
          Wall-clock kickoff checks apply — Thursday players already kicked off
          cannot be newly selected.
        </p>
      ) : (
        <div className="space-y-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
          <p className="font-medium">{AI_HISTORICAL_ENTRY_LABEL}</p>
          <p>
            Admin-only. Capture the AI model&apos;s original rankings and
            prediction time. Evidence is optional. Competitive eligibility uses
            the original prediction timestamp — not import wall-clock. Does not
            reopen Thursday players for normal submissions.
          </p>
        </div>
      )}

      {mode === "normal" && lockedPicks.length > 0 ? (
        <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
          Preserving {lockedPicks.length} locked pick
          {lockedPicks.length === 1 ? "" : "s"} on this AI profile board during
          import.
        </p>
      ) : null}

      {mode === "historical" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm sm:col-span-2">
            <span className="text-muted">
              Original prediction date/time (America/Chicago local or ISO UTC)
            </span>
            <input
              type="text"
              value={originalPredictionAt}
              onChange={(e) => {
                setOriginalPredictionAt(e.target.value);
                setHistoricalPreview(null);
              }}
              placeholder="2026-11-19 18:40 CT or 2026-11-20T00:40:00.000Z"
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm"
            />
          </label>

          <div className="sm:col-span-2">
            <button
              type="button"
              className="text-sm text-accent-ink underline-offset-2 hover:underline"
              onClick={() => setShowOptionalEvidence((open) => !open)}
            >
              {showOptionalEvidence
                ? "Hide optional evidence"
                : "Optional evidence details"}
            </button>
            {showOptionalEvidence ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="text-muted">Evidence type (optional)</span>
                  <select
                    value={evidenceType}
                    onChange={(e) => {
                      setEvidenceType(e.target.value);
                      setHistoricalPreview(null);
                    }}
                    className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                  >
                    <option value="">None</option>
                    {AI_HISTORICAL_EVIDENCE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="text-muted">
                    Source identifier (optional)
                  </span>
                  <input
                    type="text"
                    value={sourceIdentifier}
                    onChange={(e) => {
                      setSourceIdentifier(e.target.value);
                      setHistoricalPreview(null);
                    }}
                    className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                    placeholder="chat-id / export filename / ticket"
                  />
                </label>
                <label className="block text-sm sm:col-span-2">
                  <span className="text-muted">
                    Evidence reference / URL (optional)
                  </span>
                  <input
                    type="text"
                    value={evidenceReference}
                    onChange={(e) => {
                      setEvidenceReference(e.target.value);
                      setHistoricalPreview(null);
                    }}
                    className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                    placeholder="URL, vault path, screenshot, chat export, or other locator"
                  />
                </label>
                <label className="flex items-start gap-2 text-sm sm:col-span-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={evidenceIndependentlyReviewed}
                    onChange={(e) => {
                      setEvidenceIndependentlyReviewed(e.target.checked);
                      setHistoricalPreview(null);
                    }}
                  />
                  <span>
                    I independently reviewed supporting evidence for the
                    original prediction time (sets provenance to VERIFIED when
                    evidence details are present). Leaving this unchecked keeps
                    OWNER_REPORTED even if a URL or screenshot is supplied.
                  </span>
                </label>
              </div>
            ) : null}
          </div>

          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={attestationAccepted}
              onChange={(e) => {
                setAttestationAccepted(e.target.checked);
                setHistoricalPreview(null);
              }}
            />
            <span>{AI_HISTORICAL_ACK_TEXT}</span>
          </label>
        </div>
      ) : null}

      <label className="block text-sm">
        <span className="text-muted">Paste AI response</span>
        <textarea
          value={raw}
          onChange={(event) => {
            setRaw(event.target.value);
            setHistoricalPreview(null);
          }}
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
                  const locked =
                    mode === "normal" &&
                    lockedPicks.some((pick) => pick.rank === rank);
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
                        {locked
                          ? "Locked (preserved)"
                          : id
                            ? "From paste"
                            : "Empty"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex flex-wrap gap-2 p-3">
              {mode === "normal" ? (
                <>
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
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={pending || !ready}
                    onClick={runHistoricalPreview}
                  >
                    Eligibility Preview
                  </Button>
                  <Button
                    type="button"
                    disabled={pending || !historicalPreview?.ready}
                    onClick={commitHistorical}
                  >
                    Commit historical entry
                  </Button>
                </>
              )}
            </div>
          </div>

          {historicalPreview ? (
            <div
              className={`rounded-md border px-3 py-2 text-sm ${
                historicalPreview.status === "READY"
                  ? "border-success/30 bg-success-soft text-success"
                  : historicalPreview.status === "HOLD"
                    ? "border-warning/30 bg-warning-soft text-warning"
                    : "border-danger/30 bg-danger-soft text-danger"
              }`}
            >
              <p className="font-medium">
                Preview {historicalPreview.status}
                {historicalPreview.ready ? " · Commit allowed" : " · Commit blocked"}
                {historicalPreview.thursdayPlayerCount
                  ? ` · ${historicalPreview.thursdayPlayerCount} already-kicked pick(s) eligible only via historical clock`
                  : ""}
              </p>
              <p className="mt-1 font-mono text-xs">
                provenance={historicalPreview.provenanceClass} · competitive=
                {historicalPreview.competitiveAt} · capture=
                {historicalPreview.capturedAt}
              </p>
              {historicalPreview.blockers.length > 0 ? (
                <ul className="mt-2 list-disc pl-5">
                  {historicalPreview.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              ) : null}
              {historicalPreview.holdReasons.length > 0 ? (
                <ul className="mt-2 list-disc pl-5">
                  {historicalPreview.holdReasons.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              ) : null}
              {historicalPreview.warnings.length > 0 ? (
                <ul className="mt-2 list-disc pl-5 text-warning">
                  {historicalPreview.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {message ? <p className="text-sm text-accent-ink">{message}</p> : null}
    </div>
  );
}

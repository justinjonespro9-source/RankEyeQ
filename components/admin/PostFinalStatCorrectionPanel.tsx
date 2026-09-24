"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  applyPostFinalStatCorrectionForWeekAction,
  previewPostFinalStatCorrectionAction,
  resolveWeekStatForCorrectionAction,
} from "@/lib/admin-post-final-stat-actions";
import {
  calculateDefenseLiveFantasyPoints,
  calculatePlayerLiveFantasyPoints,
  EMPTY_DEFENSE,
  EMPTY_PLAYER,
  type LiveScoringEntryRow,
} from "@/lib/admin/live-scoring-shared";
import type { DefenseStatLine } from "@/lib/fantasy/defense-scoring";
import type { PlayerStatLine } from "@/lib/fantasy/player-scoring";
import type { PostFinalStatCorrectionPreview } from "@/lib/nfl/post-final-stat-correction";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

const PLAYER_FIELDS: Array<{ key: keyof PlayerStatLine; label: string }> = [
  { key: "passingYards", label: "Pass Yds" },
  { key: "passingTds", label: "Pass TD" },
  { key: "interceptions", label: "INT" },
  { key: "rushingYards", label: "Rush Yds" },
  { key: "rushingTds", label: "Rush TD" },
  { key: "receptions", label: "Rec" },
  { key: "receivingYards", label: "Rec Yds" },
  { key: "receivingTds", label: "Rec TD" },
  { key: "twoPointConversions", label: "2PT" },
  { key: "fumblesLost", label: "Fum Lost" },
  { key: "returnTds", label: "Ret TD" },
];

const DEFENSE_FIELDS: Array<{ key: keyof DefenseStatLine; label: string }> = [
  { key: "sacks", label: "Sacks" },
  { key: "interceptions", label: "INT" },
  { key: "fumbleRecoveries", label: "FR" },
  { key: "defensiveTds", label: "Def TD" },
  { key: "specialTeamsTds", label: "ST TD" },
  { key: "safeties", label: "Safeties" },
  { key: "blockedKicks", label: "Blk" },
  { key: "pointsAllowed", label: "PA" },
];

type Props = {
  weekId: string;
  scoringVersion: string;
  lockedEntries: LiveScoringEntryRow[];
};

export function PostFinalStatCorrectionPanel({
  weekId,
  scoringVersion,
  lockedEntries,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [contestEntryId, setContestEntryId] = useState(
    lockedEntries[0]?.contestEntryId ?? "",
  );
  const [playerDraft, setPlayerDraft] =
    useState<Required<PlayerStatLine>>(EMPTY_PLAYER);
  const [defenseDraft, setDefenseDraft] =
    useState<Required<DefenseStatLine>>(EMPTY_DEFENSE);
  const [reason, setReason] = useState("");
  const [sourceReference, setSourceReference] = useState("");
  const [confirmHighImpact, setConfirmHighImpact] = useState(false);
  const [preview, setPreview] = useState<PostFinalStatCorrectionPreview | null>(
    null,
  );
  const [weekStatId, setWeekStatId] = useState<string | null>(null);
  const [kind, setKind] = useState<"player" | "defense">("player");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selected = useMemo(
    () => lockedEntries.find((e) => e.contestEntryId === contestEntryId) ?? null,
    [lockedEntries, contestEntryId],
  );

  const livePts = useMemo(() => {
    if (!selected) return 0;
    return selected.position === "DEF"
      ? calculateDefenseLiveFantasyPoints(defenseDraft, scoringVersion)
      : calculatePlayerLiveFantasyPoints(playerDraft, scoringVersion);
  }, [selected, defenseDraft, playerDraft, scoringVersion]);

  function loadEntry(entryId: string) {
    const entry = lockedEntries.find((e) => e.contestEntryId === entryId);
    setContestEntryId(entryId);
    setPreview(null);
    setWeekStatId(null);
    setConfirmHighImpact(false);
    setError(null);
    setMessage(null);
    if (!entry) return;
    if (entry.position === "DEF") {
      setKind("defense");
      setDefenseDraft({ ...(entry.defenseStats ?? EMPTY_DEFENSE) });
    } else {
      setKind("player");
      setPlayerDraft({ ...(entry.playerStats ?? EMPTY_PLAYER) });
    }
  }

  function runPreview() {
    if (!selected) return;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const resolved = await resolveWeekStatForCorrectionAction({
        contestEntryId: selected.contestEntryId,
      });
      if (!resolved.ok) {
        setError(resolved.message);
        return;
      }
      setWeekStatId(resolved.weekStatId);
      setKind(resolved.kind);
      const result = await previewPostFinalStatCorrectionAction({
        weekStatId: resolved.weekStatId,
        kind: resolved.kind,
        proposedStats: resolved.kind === "defense" ? defenseDraft : playerDraft,
      });
      if (!result.ok) {
        setError(result.message);
        setPreview(null);
        return;
      }
      setPreview(result.preview);
      setMessage("Preview ready — no writes performed.");
    });
  }

  function applyCorrection() {
    if (!selected || !weekStatId || !preview) return;
    setError(null);
    startTransition(async () => {
      const result = await applyPostFinalStatCorrectionForWeekAction({
        weekId,
        weekStatId,
        kind,
        proposedStats: kind === "defense" ? defenseDraft : playerDraft,
        reason,
        sourceReference,
        confirmHighImpact,
      });
      if (!result.ok) {
        setError(
          result.message +
            (result.partialState
              ? ` (partial: weekStat=${result.partialState.weekStatUpdated} finishes=${result.partialState.finishesRecalculated} graded=${result.partialState.graded})`
              : ""),
        );
        return;
      }
      setMessage(
        `Applied ${result.position} correction. FP ${result.oldFantasyPoints.toFixed(2)} → ${result.newFantasyPoints.toFixed(2)}; rank ${result.oldActualRank ?? "—"} → ${result.newActualRank ?? "—"}; regraded ${result.submissionsRegraded}. Week ${result.weekStatus}, contest ${result.contestStatus}.`,
      );
      setPreview(null);
      setConfirmHighImpact(false);
      router.refresh();
    });
  }

  if (lockedEntries.length === 0) return null;

  return (
    <div className="rounded-lg border border-warning/40 bg-warning/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-ink">Correct Final Stats</h3>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            This changes official factual results and may recalculate final EYEQ
            scores. Ordinary live editing stays locked. Week remains COMPLETE;
            only the affected position is regraded.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => {
            setOpen((v) => !v);
            if (!open && selected) loadEntry(selected.contestEntryId);
          }}
        >
          {open ? "Hide correction form" : "Correct Final Stats"}
        </Button>
      </div>

      {open ? (
        <div className="mt-4 space-y-4">
          <label className="block text-sm">
            <span className="font-medium text-ink">Player / DEF</span>
            <select
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
              value={contestEntryId}
              onChange={(e) => loadEntry(e.target.value)}
            >
              {lockedEntries.map((entry) => (
                <option key={entry.contestEntryId} value={entry.contestEntryId}>
                  {entry.position} · {entry.name} ({entry.team}) · FP{" "}
                  {entry.fantasyPoints?.toFixed(1) ?? "—"} · Rank{" "}
                  {entry.actualRank ?? "—"}
                </option>
              ))}
            </select>
          </label>

          {selected ? (
            <div className="flex flex-wrap gap-2">
              <Badge tone="warning">POST-FINAL CORRECTION</Badge>
              <Badge tone="neutral">{selected.position}</Badge>
              <Badge tone="neutral">
                Live calc {livePts.toFixed(2)} pts
              </Badge>
            </div>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {(selected?.position === "DEF" ? DEFENSE_FIELDS : PLAYER_FIELDS).map(
              (field) => (
                <label key={field.key} className="text-xs text-muted">
                  {field.label}
                  <input
                    type="number"
                    className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-ink"
                    value={
                      selected?.position === "DEF"
                        ? defenseDraft[field.key as keyof DefenseStatLine]
                        : playerDraft[field.key as keyof PlayerStatLine]
                    }
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      if (selected?.position === "DEF") {
                        setDefenseDraft((current) => ({
                          ...current,
                          [field.key]: Number.isFinite(value) ? value : 0,
                        }));
                      } else {
                        setPlayerDraft((current) => ({
                          ...current,
                          [field.key]: Number.isFinite(value) ? value : 0,
                        }));
                      }
                      setPreview(null);
                    }}
                  />
                </label>
              ),
            )}
          </div>

          <label className="block text-sm">
            <span className="font-medium text-ink">Correction reason *</span>
            <textarea
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this factual amendment authorized?"
            />
          </label>

          <label className="block text-sm">
            <span className="font-medium text-ink">Source / reference *</span>
            <input
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2"
              value={sourceReference}
              onChange={(e) => setSourceReference(e.target.value)}
              placeholder="URL or box-score citation"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={pending} onClick={runPreview}>
              {pending ? "Working…" : "Preview Impact"}
            </Button>
          </div>

          {preview ? (
            <div className="rounded-md border border-border bg-surface p-3 text-sm">
              <p className="font-medium text-ink">Impact preview (no writes)</p>
              <ul className="mt-2 space-y-1 text-muted">
                <li>
                  Changed fields:{" "}
                  {preview.changedFields.length
                    ? preview.changedFields.join(", ")
                    : "none (identical facts)"}
                </li>
                <li>
                  Fantasy points: {preview.oldFantasyPoints.toFixed(2)} →{" "}
                  {preview.newFantasyPoints.toFixed(2)}
                </li>
                <li>
                  Actual rank: {preview.oldActualRank ?? "—"} →{" "}
                  {preview.projectedActualRank ?? "—"}
                </li>
                <li>
                  Position {preview.position} · contest {preview.contestStatus} ·
                  week {preview.weekStatus}
                </li>
                <li>
                  Rank changes: {preview.rankChanges.length} · graded
                  submissions: {preview.gradedSubmissionCount}
                </li>
                <li>
                  EYEQ score changes:{" "}
                  {preview.eyeqPreviewLimited
                    ? "preview limited (ranks/submission count only)"
                    : preview.eyeqChanges?.length ?? 0}
                </li>
                <li>Unrelated positions unaffected: yes</li>
              </ul>
              {preview.rankChanges.length > 0 ? (
                <div className="mt-3 max-h-40 overflow-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr>
                        <th className="py-1">Player</th>
                        <th>Old</th>
                        <th>New</th>
                        <th>Pts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rankChanges.slice(0, 40).map((row) => (
                        <tr key={row.rankableEntryId}>
                          <td className="py-0.5">{row.name}</td>
                          <td>{row.oldRank ?? "—"}</td>
                          <td>{row.newRank ?? "—"}</td>
                          <td>{row.fantasyPoints.toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              <label className="mt-3 flex items-start gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={confirmHighImpact}
                  onChange={(e) => setConfirmHighImpact(e.target.checked)}
                />
                <span>
                  I understand this amends official FINAL results and will
                  recalculate finishes + EYEQ for {preview.position} only.
                </span>
              </label>

              <div className="mt-3">
                <Button
                  type="button"
                  disabled={pending || !confirmHighImpact}
                  onClick={applyCorrection}
                >
                  Apply Correction &amp; Regrade
                </Button>
              </div>
            </div>
          ) : null}

          {error ? <p className="text-sm text-danger">{error}</p> : null}
          {message ? <p className="text-sm text-success">{message}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

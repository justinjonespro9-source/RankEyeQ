"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  applyWaiverCorrectionAction,
  previewWaiverCorrectionAction,
  type WaiverCorrectionPreviewView,
} from "@/lib/waivers/snapshot/actions";

type EntryOption = { rankableEntryId: string; name: string; position: string; team: string | null; rosteredBps: number; eligibility: string };
type Kind = "SET_ROSTERED" | "REMATCH" | "SET_TEAM_GAME" | "SET_AVAILABILITY" | "REMOVE";
type DraftOp = {
  kind: Kind;
  rankableEntryId: string;
  percent: string;
  toRankableEntryId: string;
  team: string;
  designation: string;
  hardUnavailable: boolean;
  evidence: string;
  reason: string;
};

const KIND_LABEL: Record<Kind, string> = {
  SET_ROSTERED: "Change rostered %",
  REMATCH: "Re-match to another player (ID)",
  SET_TEAM_GAME: "Correct team / game",
  SET_AVAILABILITY: "Correct availability (evidence only)",
  REMOVE: "Remove erroneous row",
};
const DESIGNATIONS = ["AVAILABLE", "QUESTIONABLE", "DOUBTFUL", "OUT", "INACTIVE", "UNKNOWN"];
const inputClass = "w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-ink";
const emptyDraft = (entryId: string): DraftOp => ({
  kind: "SET_ROSTERED",
  rankableEntryId: entryId,
  percent: "",
  toRankableEntryId: "",
  team: "",
  designation: "OUT",
  hardUnavailable: true,
  evidence: "",
  reason: "",
});

function toOp(draft: DraftOp) {
  const reason = draft.reason.trim() || null;
  switch (draft.kind) {
    case "SET_ROSTERED":
      return { kind: draft.kind, rankableEntryId: draft.rankableEntryId, percent: draft.percent, reason };
    case "REMATCH":
      return { kind: draft.kind, rankableEntryId: draft.rankableEntryId, toRankableEntryId: draft.toRankableEntryId.trim(), reason };
    case "SET_TEAM_GAME":
      return { kind: draft.kind, rankableEntryId: draft.rankableEntryId, team: draft.team.trim(), reason };
    case "SET_AVAILABILITY":
      return {
        kind: draft.kind,
        rankableEntryId: draft.rankableEntryId,
        designation: draft.designation,
        hardUnavailable: draft.hardUnavailable,
        evidence: draft.evidence,
        reason,
      };
    case "REMOVE":
      return { kind: draft.kind, rankableEntryId: draft.rankableEntryId, reason };
  }
}

const show = (value: unknown) => (value === null || value === undefined ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value));

/** Targeted corrections of the current version → version n+1. Nothing is graded, voided or rewritten. */
export function WaiverSnapshotCorrectionPanel({ snapshotId, version, entries }: { snapshotId: string; version: number; entries: EntryOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<DraftOp>(emptyDraft(entries[0]?.rankableEntryId ?? ""));
  const [ops, setOps] = useState<DraftOp[]>([]);
  const [addRows, setAddRows] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<WaiverCorrectionPreviewView | null>(null);
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const nameOf = new Map(entries.map((entry) => [entry.rankableEntryId, `${entry.name} (${entry.position})`]));
  const request = () => ({
    snapshotId,
    reason,
    ops: [...ops.map(toOp), ...(addRows.trim() ? [{ kind: "ADD_ROWS" as const, rawText: addRows, reason: null }] : [])],
  });
  const invalidate = () => {
    setPreview(null);
    setAcknowledged(new Set());
  };

  const runPreview = () => {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await previewWaiverCorrectionAction(request());
      if (!result.ok) {
        setError(`${result.code}: ${result.error}`);
        return;
      }
      setPreview(result.preview);
      setAcknowledged(new Set());
    });
  };

  const runApply = () => {
    if (!preview) return;
    setError(null);
    startTransition(async () => {
      const result = await applyWaiverCorrectionAction({
        ...request(),
        correctionFingerprint: preview.correctionFingerprint,
        acknowledged: preview.requiredAcknowledgments.filter((code) => acknowledged.has(code)),
      });
      if (!result.ok) {
        setError(`${result.code}: ${result.error}`);
        if (result.code === "STALE_PREVIEW") invalidate();
        return;
      }
      setMessage(`Version ${result.version} is now current (${result.correctionCase}). Re-pin: ${result.repin.map((r) => `${r.position} ${r.outcome}`).join(", ") || "no contests"}.`);
      router.push(`/admin/waivers/snapshots/${result.snapshotId}`);
    });
  };

  const canApply = Boolean(preview && preview.blockers.length === 0 && preview.requiredAcknowledgments.every((code) => acknowledged.has(code)));

  return (
    <section className="rounded-lg border border-border bg-surface-elevated p-5">
      <h3 className="font-display text-lg font-semibold text-ink">Correct version {version}</h3>
      <p className="mt-1 text-sm text-muted">
        Creates version {version + 1}. Before lock, open contests are re-pinned and affected boards flagged. After lock the new version is a factual record only and
        contests keep their pinned version.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-sm text-muted">
          Correction
          <select className={inputClass} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Kind })}>
            {(Object.keys(KIND_LABEL) as Kind[]).map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABEL[kind]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-muted sm:col-span-2">
          Row
          <select className={inputClass} value={draft.rankableEntryId} onChange={(e) => setDraft({ ...draft, rankableEntryId: e.target.value })}>
            {entries.map((entry) => (
              <option key={entry.rankableEntryId} value={entry.rankableEntryId}>
                {entry.position} · {entry.name} · {entry.team ?? "FA"} · {(entry.rosteredBps / 100).toFixed(2)}% · {entry.eligibility}
              </option>
            ))}
          </select>
        </label>
        {draft.kind === "SET_ROSTERED" ? (
          <label className="text-sm text-muted">
            Rostered % at the official time
            <input className={inputClass} value={draft.percent} onChange={(e) => setDraft({ ...draft, percent: e.target.value })} />
          </label>
        ) : null}
        {draft.kind === "REMATCH" ? (
          <label className="text-sm text-muted">
            Correct RankEyeQ ID
            <input className={`${inputClass} font-mono`} value={draft.toRankableEntryId} onChange={(e) => setDraft({ ...draft, toRankableEntryId: e.target.value })} />
          </label>
        ) : null}
        {draft.kind === "SET_TEAM_GAME" ? (
          <label className="text-sm text-muted">
            Team
            <input className={inputClass} value={draft.team} maxLength={8} onChange={(e) => setDraft({ ...draft, team: e.target.value })} />
          </label>
        ) : null}
        {draft.kind === "SET_AVAILABILITY" ? (
          <>
            <label className="text-sm text-muted">
              Designation
              <select className={inputClass} value={draft.designation} onChange={(e) => setDraft({ ...draft, designation: e.target.value })}>
                {DESIGNATIONS.map((designation) => (
                  <option key={designation}>{designation}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={draft.hardUnavailable} onChange={(e) => setDraft({ ...draft, hardUnavailable: e.target.checked })} />
              Hard unavailable
            </label>
            <label className="text-sm text-muted">
              Evidence
              <input className={inputClass} value={draft.evidence} maxLength={1000} onChange={(e) => setDraft({ ...draft, evidence: e.target.value })} />
            </label>
          </>
        ) : null}
        <label className="text-sm text-muted sm:col-span-2">
          Row reason (optional; defaults to the overall reason)
          <input className={inputClass} value={draft.reason} maxLength={1000} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} />
        </label>
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="mt-3"
        disabled={!draft.rankableEntryId}
        onClick={() => {
          setOps([...ops, draft]);
          setDraft(emptyDraft(draft.rankableEntryId));
          invalidate();
        }}
      >
        Add correction
      </Button>

      {ops.length ? (
        <ul className="mt-3 space-y-1 text-sm">
          {ops.map((op, index) => (
            <li key={index} className="flex items-center gap-2">
              <Badge tone="neutral">{op.kind}</Badge>
              <span className="text-ink">{nameOf.get(op.rankableEntryId)}</span>
              <button
                type="button"
                className="text-xs text-danger underline"
                onClick={() => {
                  setOps(ops.filter((_, i) => i !== index));
                  invalidate();
                }}
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <label className="mt-4 block text-sm text-muted">
        Omitted rows (same paste format; observed at the official time unless a row gives an earlier time)
        <textarea
          className={`${inputClass} h-24 font-mono`}
          value={addRows}
          maxLength={200_000}
          onChange={(e) => {
            setAddRows(e.target.value);
            invalidate();
          }}
        />
      </label>
      <label className="mt-3 block text-sm text-muted">
        Correction reason (required)
        <textarea
          className={`${inputClass} h-16`}
          value={reason}
          maxLength={1000}
          onChange={(e) => {
            setReason(e.target.value);
            invalidate();
          }}
        />
      </label>
      <Button type="button" variant="secondary" size="sm" className="mt-3" disabled={pending} onClick={runPreview}>
        Preview correction (read-only)
      </Button>

      {error ? (
        <p className="mt-3 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mt-3 text-sm text-success" role="status">
          {message}
        </p>
      ) : null}

      {preview ? (
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge tone={preview.correctionCase === "POST_LOCK" ? "danger" : preview.correctionCase === "OPEN_WITH_SUBMISSIONS" ? "warning" : "neutral"}>
              {preview.correctionCase}
            </Badge>
            <Badge tone="neutral">
              v{preview.fromVersion} → v{preview.toVersion}
            </Badge>
            <Badge tone="neutral">Eligible {preview.counts.eligibleCount}</Badge>
          </div>
          <ul className="space-y-1 text-sm">
            {preview.issues.map((issue) => (
              <li key={`${issue.code}-${issue.lineNumbers?.join(",") ?? ""}`}>
                <Badge tone={issue.level === "BLOCKER" ? "danger" : issue.level === "CONFIRM" ? "warning" : "neutral"}>{issue.code}</Badge>{" "}
                <span className="text-muted">
                  {issue.message}
                  {issue.lineNumbers?.length ? ` (lines ${issue.lineNumbers.join(", ")})` : ""}
                </span>
              </li>
            ))}
          </ul>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="py-1">Player</th>
                  <th className="py-1">Field</th>
                  <th className="py-1">Before</th>
                  <th className="py-1">After</th>
                  <th className="py-1">Eligibility</th>
                  <th className="py-1">Case / policy</th>
                  <th className="py-1">Affected calls</th>
                </tr>
              </thead>
              <tbody>
                {preview.changes.map((change, index) => (
                  <tr key={index} className="border-t border-border align-top">
                    <td className="py-1 text-ink">{nameOf.get(change.rankableEntryId) ?? change.rankableEntryId}</td>
                    <td className="py-1 font-mono text-xs">{change.field}</td>
                    <td className="max-w-xs truncate py-1 font-mono text-xs" title={show(change.originalValue)}>
                      {show(change.originalValue)}
                    </td>
                    <td className="max-w-xs truncate py-1 font-mono text-xs" title={show(change.correctedValue)}>
                      {show(change.correctedValue)}
                    </td>
                    <td className="py-1 text-xs">
                      {change.eligibilityBefore ?? "—"} → {change.eligibilityAfter ?? "—"}
                    </td>
                    <td className="py-1 text-xs">
                      {change.correctionCase} · {change.policy}
                    </td>
                    <td className="py-1 text-xs tabular-nums">{change.affectedCallIds.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.contests.length ? (
            <ul className="text-sm text-muted">
              {preview.contests.map((contest) => (
                <li key={contest.contestId}>
                  {contest.position}: {contest.correctionCase} · {contest.willRepin ? "will re-pin" : "stays pinned"} · {contest.affectedSubmissionIds.length} affected board(s)
                </li>
              ))}
            </ul>
          ) : null}
          {preview.requiredAcknowledgments.length ? (
            <ul className="space-y-1 text-sm">
              {preview.issues
                .filter((issue) => issue.level === "CONFIRM")
                .map((issue) => (
                  <li key={issue.code}>
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={acknowledged.has(issue.code)}
                        onChange={(e) => {
                          const next = new Set(acknowledged);
                          if (e.target.checked) next.add(issue.code);
                          else next.delete(issue.code);
                          setAcknowledged(next);
                        }}
                      />
                      <span className="text-ink">{issue.code}</span>
                    </label>
                  </li>
                ))}
            </ul>
          ) : null}
          <Button type="button" size="sm" disabled={pending || !canApply} onClick={runApply}>
            {pending ? "Applying…" : `Apply as version ${preview.toVersion}`}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { commitRankEyeQResultsAction, previewRankEyeQResultsAction } from "@/lib/waivers/rankeyeq-results/actions";
import { RANKEYEQ_RESULTS_ATTESTATION_TEXT, RANKEYEQ_RESULTS_AUTHORITY_LABEL } from "@/lib/waivers/rankeyeq-results/contract";
import type { RankEyeQResultsPreview } from "@/lib/waivers/rankeyeq-results/store";
import type { RankEyeQZeroPointDecision } from "@/lib/waivers/rankeyeq-results/contract";
import type { RankEyeQResultsSnapshotListItem } from "@/lib/waivers/rankeyeq-results/queries";
import type { RankEyeQParticipationReviewItem } from "@/lib/waivers/rankeyeq-results/types";

type DecisionDraft = {
  decision: RankEyeQZeroPointDecision;
  evidenceReference: string;
  reason: string;
};

const inputClass = "w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-ink";

function toneForStatus(status: RankEyeQResultsPreview["status"]): "success" | "warning" | "danger" | "neutral" {
  if (status === "READY") return "success";
  if (status === "ALREADY_COMMITTED") return "neutral";
  return "danger";
}

/**
 * Admin RankEyeQ final-week-stats workflow: preview coverage and participation
 * exceptions, record evidence-backed decisions, commit an immutable snapshot.
 * Never grades, applies or publishes.
 */
export function WaiverRankEyeQResultsPanel({
  weekId,
  weekLabel,
  weekStatus,
  snapshots,
}: {
  weekId: string;
  weekLabel: string;
  weekStatus: string;
  snapshots: RankEyeQResultsSnapshotListItem[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<RankEyeQResultsPreview | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DecisionDraft>>({});
  const [sourceReference, setSourceReference] = useState("");
  const [attested, setAttested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const decisionPayload = () =>
    Object.entries(drafts)
      .filter(([, d]) => d.decision !== "PENDING")
      .map(([rankableEntryId, d]) => ({
        rankableEntryId,
        decision: d.decision,
        evidenceReference: d.evidenceReference,
        reason: d.reason,
      }));

  const runPreview = () => {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await previewRankEyeQResultsAction({ weekId, decisions: decisionPayload() });
      if (!result.ok) {
        setError(`${result.code}: ${result.error}`);
        setPreview(null);
        return;
      }
      setPreview(result.preview);
      setAttested(false);
      // Seed drafts for any new review items.
      setDrafts((prev) => {
        const next = { ...prev };
        for (const item of result.preview.reviewItems) {
          if (!next[item.rankableEntryId]) {
            next[item.rankableEntryId] = {
              decision: "PENDING",
              evidenceReference: "",
              reason: "",
            };
          }
        }
        return next;
      });
    });
  };

  const runCommit = () => {
    if (!preview?.previewFingerprint) return;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await commitRankEyeQResultsAction({
        weekId,
        decisions: decisionPayload(),
        previewFingerprint: preview.previewFingerprint,
        sourceReference,
        attested,
      });
      if (!result.ok) {
        setError(`${result.code}: ${result.error}`);
        return;
      }
      setMessage(
        result.alreadyCommitted
          ? `Already committed revision (checksum match). Snapshot ${result.snapshotRowId}.`
          : `Committed immutable snapshot r${result.revision} · ${result.contentChecksum.slice(0, 12)}…`,
      );
      setPreview(null);
      setAttested(false);
      router.refresh();
    });
  };

  const setDraft = (id: string, patch: Partial<DecisionDraft>) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { decision: "PENDING", evidenceReference: "", reason: "" }), ...patch } }));
  };

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-surface-elevated p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-xl font-semibold text-ink">
            {weekLabel} · RankEyeQ results
          </h2>
          <Badge tone="neutral">{weekStatus}</Badge>
          <Badge tone="warning">{RANKEYEQ_RESULTS_AUTHORITY_LABEL}</Badge>
        </div>
        <p className="mt-2 text-sm text-muted">
          Preview RankEyeQ final WeekStat coverage and participation exceptions, record evidence-backed decisions, then commit an immutable results snapshot.
          Commit does <strong className="font-medium text-ink">not</strong> grade, apply authority or publish leaderboards.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" onClick={runPreview} disabled={pending}>
            {pending ? "Working…" : "Preview coverage"}
          </Button>
        </div>
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        {message ? <p className="mt-3 text-sm text-ink">{message}</p> : null}
      </section>

      {preview ? (
        <section className="rounded-lg border border-border bg-surface-elevated p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-lg font-semibold text-ink">Preview</h3>
            <Badge tone={toneForStatus(preview.status)}>{preview.status}</Badge>
            {preview.revision !== null ? <Badge tone="neutral">next r{preview.revision}</Badge> : null}
          </div>
          {preview.contentChecksum ? (
            <p className="mt-2 break-all font-mono text-xs text-muted">checksum {preview.contentChecksum}</p>
          ) : null}
          {preview.content ? (
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-muted">Participants</dt>
                <dd className="tabular-nums text-ink">{preview.content.summary.participantCount}</dd>
              </div>
              <div>
                <dt className="text-muted">Pending zeros</dt>
                <dd className="tabular-nums text-ink">{preview.content.summary.pendingZeroCount}</dd>
              </div>
              <div>
                <dt className="text-muted">Unresolved / absent</dt>
                <dd className="tabular-nums text-ink">{preview.content.summary.unresolvedCount}</dd>
              </div>
              <div>
                <dt className="text-muted">Series</dt>
                <dd className="break-all font-mono text-xs text-ink">{preview.seriesKey ?? "—"}</dd>
              </div>
            </dl>
          ) : null}

          {preview.blockers.length > 0 ? (
            <ul className="mt-4 space-y-1 text-sm text-danger">
              {preview.blockers.map((b, i) => (
                <li key={`${b.code}-${i}`}>
                  <span className="font-mono text-xs">{b.code}</span> — {b.detail}
                </li>
              ))}
            </ul>
          ) : null}

          {preview.reviewItems.length > 0 ? (
            <div className="mt-5">
              <h4 className="text-sm font-semibold text-ink">Participation review</h4>
              <p className="mt-1 text-xs text-muted">
                Zero fantasy points never imply DNP. Absent WeekStat rows can only be confirmed as DID_NOT_PLAY with evidence — never as a played zero.
              </p>
              <ul className="mt-3 space-y-4">
                {preview.reviewItems.map((item) => (
                  <ReviewRow key={item.rankableEntryId} item={item} draft={drafts[item.rankableEntryId]} onChange={(patch) => setDraft(item.rankableEntryId, patch)} />
                ))}
              </ul>
              <div className="mt-3">
                <Button type="button" variant="secondary" onClick={runPreview} disabled={pending}>
                  Re-preview with decisions
                </Button>
              </div>
            </div>
          ) : null}

          {preview.status === "READY" && preview.previewFingerprint ? (
            <div className="mt-6 space-y-3 border-t border-border pt-4">
              <label className="block text-sm">
                <span className="text-muted">Source reference (where you reviewed the stats)</span>
                <input className={`${inputClass} mt-1`} value={sourceReference} onChange={(e) => setSourceReference(e.target.value)} placeholder="admin live scoring / box score notes" />
              </label>
              <label className="flex items-start gap-2 text-sm text-ink">
                <input type="checkbox" className="mt-1" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
                <span>{RANKEYEQ_RESULTS_ATTESTATION_TEXT}</span>
              </label>
              <Button type="button" onClick={runCommit} disabled={pending || !attested || sourceReference.trim().length === 0}>
                Commit immutable snapshot
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-lg border border-border bg-surface-elevated p-5">
        <h3 className="font-display text-lg font-semibold text-ink">Committed snapshots</h3>
        {snapshots.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No RankEyeQ results snapshot for this week yet.</p>
        ) : (
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="py-1">Rev</th>
                <th className="py-1">State</th>
                <th className="py-1">Participants</th>
                <th className="py-1">Checksum</th>
                <th className="py-1">Built</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <td className="py-2 tabular-nums">r{s.revision}</td>
                  <td className="py-2">
                    <Badge tone={s.publicationState === "ACCEPTED" ? "success" : s.publicationState === "WITHDRAWN" ? "danger" : "neutral"}>
                      {s.publicationState}
                    </Badge>
                  </td>
                  <td className="py-2 tabular-nums">
                    {s.participantCount} · zero {s.pendingZeroCount} · unresolved {s.unresolvedCount}
                  </td>
                  <td className="py-2 break-all font-mono text-xs">{s.contentChecksum.slice(0, 16)}…</td>
                  <td className="py-2 text-xs text-muted">{s.builtAt.toISOString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function ReviewRow({
  item,
  draft,
  onChange,
}: {
  item: RankEyeQParticipationReviewItem;
  draft: DecisionDraft | undefined;
  onChange: (patch: Partial<DecisionDraft>) => void;
}) {
  const value = draft ?? { decision: "PENDING" as const, evidenceReference: "", reason: "" };
  const absent = item.reviewKind === "ABSENT_DNP_REVIEW";
  return (
    <li className="rounded-md border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-ink">
          {item.displayName} · {item.position}
          {item.team ? ` · ${item.team}` : ""}
        </span>
        <Badge tone={absent ? "warning" : "neutral"}>{item.reviewKind}</Badge>
        <span className="font-mono text-xs text-muted">{item.externalId}</span>
      </div>
      {item.issues.length > 0 ? (
        <ul className="mt-1 text-xs text-muted">
          {item.issues.map((issue, i) => (
            <li key={`${issue.code}-${i}`}>
              {issue.code}: {issue.detail}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <label className="text-xs">
          <span className="text-muted">Decision</span>
          <select
            className={`${inputClass} mt-1`}
            value={value.decision}
            onChange={(e) => onChange({ decision: e.target.value as RankEyeQZeroPointDecision })}
          >
            <option value="PENDING">Pending</option>
            {!absent ? <option value="PLAYED_ZERO">Played, scored zero</option> : null}
            <option value="DID_NOT_PLAY">Did not play (evidence required)</option>
          </select>
        </label>
        <label className="text-xs sm:col-span-2">
          <span className="text-muted">Evidence reference</span>
          <input
            className={`${inputClass} mt-1`}
            value={value.evidenceReference}
            onChange={(e) => onChange({ evidenceReference: e.target.value })}
            placeholder="URL or box-score citation"
            disabled={value.decision === "PENDING"}
          />
        </label>
        <label className="text-xs sm:col-span-3">
          <span className="text-muted">Reason</span>
          <input
            className={`${inputClass} mt-1`}
            value={value.reason}
            onChange={(e) => onChange({ reason: e.target.value })}
            placeholder="What you verified"
            disabled={value.decision === "PENDING"}
          />
        </label>
      </div>
    </li>
  );
}

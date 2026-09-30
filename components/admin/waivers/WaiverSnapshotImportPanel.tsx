"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { WaiverSnapshotPreview } from "@/components/admin/waivers/WaiverSnapshotPreview";
import { Button } from "@/components/ui/Button";
import { freezeWaiverSnapshotAction, previewWaiverSnapshotAction, type WaiverSnapshotPreviewView } from "@/lib/waivers/snapshot/actions";

const FOLLOW_UP_REASONS = [
  { value: "SOURCE_HAS_NO_LISTING", label: "Source has no listing" },
  { value: "UNABLE_TO_VERIFY", label: "Unable to verify" },
  { value: "SOURCE_UNAVAILABLE", label: "Source unavailable" },
  { value: "OTHER", label: "Other (note required)" },
] as const;
type FollowUpReason = (typeof FOLLOW_UP_REASONS)[number]["value"];

const inputClass = "w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-ink";

/**
 * Paste → read-only preview → exact acknowledgments → freeze. Freezing never
 * opens contests; the server rebuilds the preview and refuses a stale one.
 */
export function WaiverSnapshotImportPanel({ weekId, defaultObservedAt }: { weekId: string; defaultObservedAt: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rawText, setRawText] = useState("");
  const [sourceLabel, setSourceLabel] = useState("Sleeper");
  const [sourceUrl, setSourceUrl] = useState("");
  const [observedAt, setObservedAt] = useState(defaultObservedAt);
  const [preview, setPreview] = useState<WaiverSnapshotPreviewView | null>(null);
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const [followUps, setFollowUps] = useState<Record<string, { reason: FollowUpReason | ""; note: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const form = { weekId, rawText, sourceLabel, sourceUrl: sourceUrl.trim() || null, observedAt };
  const invalidate = () => {
    setPreview(null);
    setAcknowledged(new Set());
    setFollowUps({});
    setMessage(null);
  };

  const runPreview = () => {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await previewWaiverSnapshotAction(form);
      if (!result.ok) {
        setError(`${result.code}: ${result.error}`);
        setPreview(null);
        return;
      }
      setPreview(result.preview);
      setAcknowledged(new Set());
      setFollowUps(Object.fromEntries(result.preview.missingFollowUps.map((player) => [player.rankableEntryId, { reason: "", note: "" }])));
    });
  };

  const followUpsComplete =
    preview?.missingFollowUps.every((player) => {
      const ack = followUps[player.rankableEntryId];
      return ack?.reason && (ack.reason !== "OTHER" || ack.note.trim());
    }) ?? false;
  const allAcknowledged = preview?.requiredAcknowledgments.every((code) => acknowledged.has(code)) ?? false;
  const canFreeze = Boolean(preview && preview.blockers.length === 0 && allAcknowledged && followUpsComplete);

  const runFreeze = () => {
    if (!preview) return;
    setError(null);
    startTransition(async () => {
      const result = await freezeWaiverSnapshotAction({
        ...form,
        previewFingerprint: preview.previewFingerprint,
        acknowledged: preview.requiredAcknowledgments.filter((code) => acknowledged.has(code)),
        followUpAcks: preview.missingFollowUps.map((player) => ({
          rankableEntryId: player.rankableEntryId,
          reason: followUps[player.rankableEntryId]?.reason,
          note: followUps[player.rankableEntryId]?.note || null,
        })),
      });
      if (!result.ok) {
        setError(`${result.code}: ${result.error}`);
        if (result.code === "STALE_PREVIEW") invalidate();
        return;
      }
      setMessage(
        result.alreadyFrozen
          ? `Version ${result.version} was already frozen with this exact input.`
          : `Froze version ${result.version} at ${result.frozenAt}. Contests were not opened.`,
      );
      invalidate();
      router.refresh();
    });
  };

  return (
    <section className="rounded-lg border border-border bg-surface-elevated p-5">
      <h3 className="font-display text-lg font-semibold text-ink">Import official ownership snapshot</h3>
      <p className="mt-1 text-sm text-muted">
        One row per player: <span className="font-mono">Player | Pos | Team | Rostered%</span>, optionally{" "}
        <span className="font-mono">| RankEyeQ ID | Source | Observed at</span>. Pipe, tab or CSV. Preview writes nothing.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-sm text-muted">
          Source label
          <input
            className={inputClass}
            value={sourceLabel}
            maxLength={120}
            onChange={(e) => {
              setSourceLabel(e.target.value);
              invalidate();
            }}
          />
        </label>
        <label className="text-sm text-muted">
          Source URL
          <input
            className={inputClass}
            value={sourceUrl}
            maxLength={500}
            placeholder="https://"
            onChange={(e) => {
              setSourceUrl(e.target.value);
              invalidate();
            }}
          />
        </label>
        <label className="text-sm text-muted">
          Official observation time (Chicago)
          <input
            type="datetime-local"
            className={inputClass}
            value={observedAt}
            onChange={(e) => {
              setObservedAt(e.target.value);
              invalidate();
            }}
          />
        </label>
      </div>
      <label className="mt-3 block text-sm text-muted">
        Paste
        <textarea
          className={`${inputClass} h-56 font-mono`}
          value={rawText}
          maxLength={200_000}
          onChange={(e) => {
            setRawText(e.target.value);
            invalidate();
          }}
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={pending || !rawText.trim()} onClick={runPreview}>
          {pending && !preview ? "Previewing…" : "Preview (read-only)"}
        </Button>
      </div>
      {error ? (
        <p className="mt-3 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mt-3 rounded-md border border-success/30 bg-success-soft px-3 py-2 text-sm text-success" role="status">
          {message}
        </p>
      ) : null}

      {preview ? (
        <>
          <WaiverSnapshotPreview preview={preview} />
          {preview.missingFollowUps.length ? (
            <section className="mt-6 rounded-lg border border-warning/30 bg-warning-soft p-4">
              <h3 className="font-display text-lg font-semibold text-ink">Missing tracked follow-ups</h3>
              <p className="mt-1 text-sm text-muted">No percentage or row is invented. Give each player a reason.</p>
              <ul className="mt-3 space-y-2">
                {preview.missingFollowUps.map((player) => {
                  const ack = followUps[player.rankableEntryId] ?? { reason: "", note: "" };
                  return (
                    <li key={player.rankableEntryId} className="grid gap-2 text-sm sm:grid-cols-3">
                      <span className="text-ink">
                        {player.name} · {player.position} · last {(player.lastObservedBps / 100).toFixed(2)}% (week {player.lastObservedWeekNumber})
                      </span>
                      <select
                        className={inputClass}
                        value={ack.reason}
                        onChange={(e) => setFollowUps({ ...followUps, [player.rankableEntryId]: { ...ack, reason: e.target.value as FollowUpReason } })}
                      >
                        <option value="">Choose a reason…</option>
                        {FOLLOW_UP_REASONS.map((reason) => (
                          <option key={reason.value} value={reason.value}>
                            {reason.label}
                          </option>
                        ))}
                      </select>
                      <input
                        className={inputClass}
                        placeholder="Note"
                        maxLength={1000}
                        value={ack.note}
                        onChange={(e) => setFollowUps({ ...followUps, [player.rankableEntryId]: { ...ack, note: e.target.value } })}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
          {preview.requiredAcknowledgments.length ? (
            <section className="mt-6 rounded-lg border border-border bg-surface p-4">
              <h3 className="font-display text-lg font-semibold text-ink">Acknowledgments</h3>
              <ul className="mt-2 space-y-2 text-sm">
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
                        <span>
                          <span className="font-medium text-ink">{issue.code}</span> — <span className="text-muted">{issue.message}</span>
                        </span>
                      </label>
                    </li>
                  ))}
              </ul>
            </section>
          ) : null}
          <div className="mt-4">
            <Button type="button" size="sm" disabled={pending || !canFreeze} onClick={runFreeze}>
              {pending ? "Freezing…" : "Freeze official snapshot"}
            </Button>
            <p className="mt-1 text-xs text-muted">Freezing records evidence only. Opening contests is a separate action.</p>
          </div>
        </>
      ) : null}
    </section>
  );
}

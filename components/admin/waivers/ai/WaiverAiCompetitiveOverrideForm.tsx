"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { WaiverAiParsePreview } from "@/components/admin/waivers/ai/WaiverAiParsePreview";
import { sha256Hex } from "@/components/admin/waivers/ai/client-sha256";
import { Button } from "@/components/ui/Button";
import { overrideWaiverAiBoardAction, previewWaiverAiResponseAction } from "@/lib/waivers/ai/actions";
import { WAIVER_AI_COMPETITIVE_OVERRIDE_LABEL, WAIVER_AI_MODEL_LABEL_MAX, WAIVER_AI_OVERRIDE_REASON_MAX } from "@/lib/waivers/ai/constants";
import type { WaiverAiIssue, WaiverAiParseResult } from "@/lib/waivers/ai/response-parser";

type Preview = { text: string; responseSha256: string; parse: WaiverAiParseResult };

export type WaiverAiOverrideEvidenceOption = { id: string; responseSha256: string; label: string; rejected: boolean };

const input = "mt-1 w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm";

function chicago(at: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(at);
}

/**
 * Admin competitive override: Paste → Parse and Preview → model label,
 * reason, optional evidence → typed confirmation → submit. The server
 * re-parses the exact text against the pinned frozen pool; nothing here is
 * written as a pick.
 */
export function WaiverAiCompetitiveOverrideForm({
  contestId,
  profileId,
  aiDisplayName,
  evidence,
}: {
  contestId: string;
  profileId: string;
  aiDisplayName: string;
  /** Historical evidence for this AI and contest; only an unrejected record of the same response can be attached. */
  evidence: WaiverAiOverrideEvidenceOption[];
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [modelLabel, setModelLabel] = useState("");
  const [reason, setReason] = useState("");
  const [sourceReference, setSourceReference] = useState("");
  const [evidenceId, setEvidenceId] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [include, setInclude] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string; issues?: WaiverAiIssue[] } | null>(null);
  const [pending, startTransition] = useTransition();

  const stale = preview !== null && preview.text !== text;
  const attachable = preview ? evidence.filter((row) => row.responseSha256 === preview.responseSha256 && !row.rejected) : [];
  const canSubmit =
    Boolean(preview?.parse.ok) &&
    !stale &&
    modelLabel.trim().length > 0 &&
    reason.trim().length > 0 &&
    confirmation.trim().length === 12 &&
    include &&
    !pending;

  function parse() {
    setMessage(null);
    setInclude(false);
    setEvidenceId("");
    const submitted = text;
    startTransition(async () => {
      const result = await previewWaiverAiResponseAction({ contestId, responseText: submitted });
      if (!result.ok) {
        setPreview(null);
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setPreview({ text: submitted, responseSha256: result.preview.responseSha256, parse: result.preview.parse });
    });
  }

  function submit() {
    if (!preview || !canSubmit) return;
    const current = preview;
    startTransition(async () => {
      const expectedResponseSha256 = await sha256Hex(current.text);
      if (expectedResponseSha256 !== current.responseSha256) {
        setMessage({ tone: "error", text: "The browser and server hashes of the response differ; nothing was saved." });
        return;
      }
      const result = await overrideWaiverAiBoardAction({
        contestId,
        profileId,
        responseText: current.text,
        expectedResponseSha256,
        confirmedRankableEntryIds: current.parse.picks.map((pick) => pick.rankableEntryId),
        modelLabel,
        reason,
        sourceReference,
        evidenceId: evidenceId || null,
        confirmation,
        includeInCompetition: include,
      });
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error, issues: Array.isArray(result.issues) ? (result.issues as WaiverAiIssue[]) : undefined });
        return;
      }
      setMessage({
        tone: "ok",
        text: `${WAIVER_AI_COMPETITIVE_OVERRIDE_LABEL}: ${aiDisplayName}'s board (${result.noCalls ? "NO CALLS" : `${result.callCount} pick${result.callCount === 1 ? "" : "s"}`}) imported at ${chicago(new Date(result.importedAt))}.`,
      });
      setText("");
      setPreview(null);
      setInclude(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <label className="block text-sm">
        <span className="font-medium text-ink">1. Paste the AI&apos;s original response</span>
        <span className="block text-xs text-muted">Stored exactly as pasted and hashed (sha256). Never edited, trimmed or reordered.</span>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={8}
          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm"
          placeholder={"1. Player Name\n2. Player Name\n\nor: NO CALLS"}
        />
      </label>
      <Button type="button" variant="secondary" disabled={pending || text.length === 0} onClick={parse}>
        2. Parse and Preview
      </Button>

      {preview ? (
        <div className="space-y-3">
          <p className="text-sm font-medium text-ink">3. Frozen-pool validation</p>
          {stale ? (
            <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
              The response changed after this preview. Parse and Preview again.
            </p>
          ) : null}
          <WaiverAiParsePreview parse={preview.parse} />
          <p className="font-mono text-xs text-muted">response sha256 {preview.responseSha256}</p>

          {preview.parse.ok && !stale ? (
            <div className="space-y-3 rounded-lg border border-danger/30 bg-surface p-4">
              <p className="text-sm font-medium text-ink">4. Authorize the admin competitive override</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="text-muted">Model label (required)</span>
                  <input value={modelLabel} onChange={(event) => setModelLabel(event.target.value)} maxLength={WAIVER_AI_MODEL_LABEL_MAX} className={input} placeholder="Model and version used" />
                </label>
                <label className="block text-sm">
                  <span className="text-muted">Source reference (optional)</span>
                  <input value={sourceReference} onChange={(event) => setSourceReference(event.target.value)} maxLength={500} className={input} placeholder="Where the original response is kept" />
                </label>
                <label className="block text-sm sm:col-span-2">
                  <span className="text-muted">Override reason (required)</span>
                  <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={WAIVER_AI_OVERRIDE_REASON_MAX} rows={3} className={input} />
                </label>
                <label className="block text-sm sm:col-span-2">
                  <span className="text-muted">Attach original evidence (optional)</span>
                  <select value={evidenceId} onChange={(event) => setEvidenceId(event.target.value)} className={input} disabled={attachable.length === 0}>
                    <option value="">{attachable.length === 0 ? "No unrejected evidence holds this exact response" : "None"}</option>
                    {attachable.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.label}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-muted">Record evidence in the historical-evidence section first. Attaching evidence does not make this a verified entry.</span>
                </label>
                <label className="block text-sm">
                  <span className="text-muted">
                    Type the first 12 characters of the response sha256 (<span className="font-mono">{preview.responseSha256.slice(0, 4)}…</span>)
                  </span>
                  <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} maxLength={64} className={`${input} font-mono`} autoComplete="off" />
                </label>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={include} onChange={(event) => setInclude(event.target.checked)} className="mt-1" />
                <span>
                  I authorize including this board in AI and All Participants competition as “{WAIVER_AI_COMPETITIVE_OVERRIDE_LABEL}”, without pre-lock evidence. It is
                  recorded at the actual database time with my identity and reason, cannot be edited, replaced or withdrawn, and never enters human-only consensus.
                </span>
              </label>
              <Button type="button" variant="danger" disabled={!canSubmit} onClick={submit}>
                Submit admin competitive override
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {message ? (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${message.tone === "ok" ? "border-success/30 bg-success-soft text-success" : "border-danger/30 bg-danger-soft text-danger"}`}
          role={message.tone === "error" ? "alert" : undefined}
        >
          <p>{message.text}</p>
          {message.issues && message.issues.length > 0 ? (
            <ul className="mt-1 list-disc pl-5">
              {message.issues.map((issue, index) => (
                <li key={`${issue.code}-${index}`}>{issue.message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

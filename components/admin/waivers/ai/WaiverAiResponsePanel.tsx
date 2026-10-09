"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { WaiverAiParsePreview } from "@/components/admin/waivers/ai/WaiverAiParsePreview";
import { sha256Hex } from "@/components/admin/waivers/ai/client-sha256";
import { Button } from "@/components/ui/Button";
import { previewWaiverAiResponseAction, submitWaiverAiBoardAction } from "@/lib/waivers/ai/actions";
import type { WaiverAiIssue, WaiverAiParseResult } from "@/lib/waivers/ai/response-parser";

type Preview = { text: string; responseSha256: string; promptSha256: string; parse: WaiverAiParseResult };

/** Paste AI Response → Parse and Preview → validation errors → Confirm and Submit. */
export function WaiverAiResponsePanel({
  contestId,
  profileId,
  promptSha256,
  aiDisplayName,
}: {
  contestId: string;
  profileId: string;
  /** sha256 of the prompt shown on this page (the one the admin copied). */
  promptSha256: string;
  aiDisplayName: string;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [modelLabel, setModelLabel] = useState("");
  const [statedGeneratedAt, setStatedGeneratedAt] = useState("");
  const [sourceReference, setSourceReference] = useState("");
  const [sourceNote, setSourceNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string; issues?: WaiverAiIssue[] } | null>(null);
  const [pending, startTransition] = useTransition();

  const stale = preview !== null && preview.text !== text;
  const promptChanged = preview !== null && preview.promptSha256 !== promptSha256;
  const canSubmit = Boolean(preview?.parse.ok) && !stale && !promptChanged && confirmed && modelLabel.trim().length > 0 && !pending;

  function parse() {
    setMessage(null);
    setConfirmed(false);
    const submitted = text;
    startTransition(async () => {
      const result = await previewWaiverAiResponseAction({ contestId, responseText: submitted });
      if (!result.ok) {
        setPreview(null);
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setPreview({
        text: submitted,
        responseSha256: result.preview.responseSha256,
        promptSha256: result.preview.promptSha256,
        parse: result.preview.parse,
      });
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
      const result = await submitWaiverAiBoardAction({
        contestId,
        profileId,
        responseText: current.text,
        expectedResponseSha256,
        expectedPromptSha256: promptSha256,
        confirmedRankableEntryIds: current.parse.picks.map((pick) => pick.rankableEntryId),
        modelLabel,
        statedGeneratedAt,
        sourceReference,
        sourceNote,
      });
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error, issues: Array.isArray(result.issues) ? (result.issues as WaiverAiIssue[]) : undefined });
        return;
      }
      setMessage({
        tone: "ok",
        text: result.changed
          ? `Submitted revision ${result.revisionNumber} for ${aiDisplayName} (${result.noCalls ? "NO CALLS" : `${result.callCount} pick${result.callCount === 1 ? "" : "s"}`}).`
          : "This exact response is already the current board; nothing changed.",
      });
      setText("");
      setPreview(null);
      setConfirmed(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <label className="block text-sm">
        <span className="font-medium text-ink">2. Paste AI Response</span>
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
        3. Parse and Preview
      </Button>

      {preview ? (
        <div className="space-y-3">
          <p className="text-sm font-medium text-ink">4. Validation</p>
          {stale ? (
            <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
              The response changed after this preview. Parse and Preview again.
            </p>
          ) : null}
          {promptChanged ? (
            <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
              The contest&apos;s frozen pool changed since this page loaded. Reload, copy the new prompt and re-run the AI.
            </p>
          ) : null}
          <WaiverAiParsePreview parse={preview.parse} />
          <p className="font-mono text-xs text-muted">response sha256 {preview.responseSha256}</p>

          {preview.parse.ok && !stale && !promptChanged ? (
            <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
              <p className="text-sm font-medium text-ink">5. Confirm and Submit</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="text-muted">Model label (required)</span>
                  <input
                    value={modelLabel}
                    onChange={(event) => setModelLabel(event.target.value)}
                    maxLength={120}
                    className="mt-1 w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm"
                    placeholder="Model and version used"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-muted">Stated generation time (optional, unverified)</span>
                  <input
                    type="datetime-local"
                    value={statedGeneratedAt}
                    onChange={(event) => setStatedGeneratedAt(event.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm"
                  />
                  <span className="text-xs text-muted">Chicago time. Recorded as stated; the database records the actual import time.</span>
                </label>
                <label className="block text-sm">
                  <span className="text-muted">Source reference (optional)</span>
                  <input
                    value={sourceReference}
                    onChange={(event) => setSourceReference(event.target.value)}
                    maxLength={500}
                    className="mt-1 w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm"
                    placeholder="Chat link or file name"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-muted">Source note (optional)</span>
                  <input
                    value={sourceNote}
                    onChange={(event) => setSourceNote(event.target.value)}
                    maxLength={2000}
                    className="mt-1 w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm"
                  />
                </label>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />
                <span>
                  I confirm these exact picks, in this order, are {aiDisplayName}&apos;s response to the prompt above. The server re-parses the
                  original text and submits a new append-only revision; boards cannot change after the Waiver lock.
                </span>
              </label>
              <Button type="button" disabled={!canSubmit} onClick={submit}>
                Confirm and Submit
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

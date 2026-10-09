"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { WaiverAiParsePreview } from "@/components/admin/waivers/ai/WaiverAiParsePreview";
import { sha256Hex } from "@/components/admin/waivers/ai/client-sha256";
import { Button } from "@/components/ui/Button";
import { previewWaiverAiEvidenceAction, recordWaiverAiEvidenceAction } from "@/lib/waivers/ai/actions";
import {
  WAIVER_AI_EVIDENCE_LABEL,
  WAIVER_AI_EVIDENCE_SOURCES,
  WAIVER_AI_EVIDENCE_SOURCE_LABELS,
  WAIVER_AI_LATE_EVIDENCE_LABEL,
  WAIVER_AI_RESPONSE_MAX_BYTES,
} from "@/lib/waivers/ai/constants";
import type { WaiverAiParseResult } from "@/lib/waivers/ai/response-parser";

type Preview = { text: string; responseSha256: string; afterLock: boolean; parse: WaiverAiParseResult };

/**
 * Records a historical AI prediction as append-only evidence. Record-only:
 * it never creates a Waiver board, revision, call, grade or consensus entry.
 * A loaded original file is kept byte-exact (read-only); pasted text is
 * stored as received.
 */
export function WaiverAiEvidencePanel({ contestId, profileId }: { contestId: string; profileId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [file, setFile] = useState<{ name: string; sha256: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [modelLabel, setModelLabel] = useState("");
  const [evidenceSource, setEvidenceSource] = useState<string>("");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [statedSourceAt, setStatedSourceAt] = useState("");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const stale = preview !== null && preview.text !== text;
  const canRecord =
    preview !== null && !stale && confirmed && modelLabel.trim() && evidenceSource && evidenceReference.trim() && !pending;

  async function loadFile(selected: File | undefined) {
    setMessage(null);
    setPreview(null);
    if (!selected) return;
    if (selected.size > WAIVER_AI_RESPONSE_MAX_BYTES) {
      setMessage({ tone: "error", text: `The file is larger than ${WAIVER_AI_RESPONSE_MAX_BYTES} bytes.` });
      return;
    }
    const bytes = new Uint8Array(await selected.arrayBuffer());
    try {
      const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const fileSha = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      if ((await sha256Hex(decoded)) !== fileSha) {
        setMessage({ tone: "error", text: "The file does not round-trip as UTF-8 text; it cannot be stored byte-exact." });
        return;
      }
      setText(decoded);
      setFile({ name: selected.name, sha256: fileSha });
    } catch {
      setMessage({ tone: "error", text: "The file is not valid UTF-8 text." });
    }
  }

  function clear() {
    setText("");
    setFile(null);
    setPreview(null);
    setConfirmed(false);
  }

  function runPreview() {
    setMessage(null);
    setConfirmed(false);
    const submitted = text;
    startTransition(async () => {
      const result = await previewWaiverAiEvidenceAction({ contestId, responseText: submitted });
      if (!result.ok) {
        setPreview(null);
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setPreview({ text: submitted, responseSha256: result.preview.responseSha256, afterLock: result.preview.afterLock, parse: result.preview.parse });
    });
  }

  function record() {
    if (!preview || !canRecord) return;
    const current = preview;
    startTransition(async () => {
      const expectedResponseSha256 = await sha256Hex(current.text);
      if (expectedResponseSha256 !== current.responseSha256 || (file && file.sha256 !== expectedResponseSha256)) {
        setMessage({ tone: "error", text: "The browser, file and server hashes differ; nothing was recorded." });
        return;
      }
      const result = await recordWaiverAiEvidenceAction({
        contestId,
        profileId,
        responseText: current.text,
        expectedResponseSha256,
        modelLabel,
        statedSourceAt,
        evidenceSource,
        evidenceReference,
        note,
      });
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setMessage({
        tone: "ok",
        text: `Evidence recorded (${result.recordedAfterLock ? WAIVER_AI_LATE_EVIDENCE_LABEL : WAIVER_AI_EVIDENCE_LABEL}) · sha256 ${result.responseSha256}`,
      });
      clear();
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-ink/20 bg-surface-elevated px-3 py-1.5 font-medium">
          Load original file (byte-exact)
          <input type="file" accept=".txt,.md,.csv,.json,text/plain" className="sr-only" onChange={(event) => void loadFile(event.target.files?.[0])} />
        </label>
        {file ? (
          <>
            <span className="font-mono text-xs text-muted">
              {file.name} · sha256 {file.sha256}
            </span>
            <Button type="button" size="xs" variant="ghost" onClick={clear}>
              Clear
            </Button>
          </>
        ) : (
          <span className="text-xs text-muted">or paste the original text below (stored exactly as received)</span>
        )}
      </div>
      <textarea
        value={text}
        readOnly={file !== null}
        onChange={(event) => setText(event.target.value)}
        rows={8}
        className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm read-only:opacity-80"
        placeholder="Original AI response"
      />
      <Button type="button" variant="secondary" disabled={pending || text.length === 0} onClick={runPreview}>
        Preview against the frozen pool
      </Button>

      {preview ? (
        <div className="space-y-3">
          {stale ? (
            <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">The text changed after this preview. Preview again.</p>
          ) : null}
          <p className={`rounded-md border px-3 py-2 text-sm font-semibold ${preview.afterLock ? "border-danger/30 bg-danger-soft text-danger" : "border-warning/30 bg-warning-soft text-warning"}`}>
            {preview.afterLock ? WAIVER_AI_LATE_EVIDENCE_LABEL : WAIVER_AI_EVIDENCE_LABEL}
          </p>
          <WaiverAiParsePreview parse={preview.parse} />
          <p className="font-mono text-xs text-muted">sha256 {preview.responseSha256}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-muted">Model label (required)</span>
              <input value={modelLabel} onChange={(event) => setModelLabel(event.target.value)} maxLength={120} className="mt-1 w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm" />
            </label>
            <label className="block text-sm">
              <span className="text-muted">How the original was preserved (required)</span>
              <select value={evidenceSource} onChange={(event) => setEvidenceSource(event.target.value)} className="mt-1 w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm">
                <option value="">Choose…</option>
                {WAIVER_AI_EVIDENCE_SOURCES.map((source) => (
                  <option key={source} value={source}>
                    {WAIVER_AI_EVIDENCE_SOURCE_LABELS[source]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-muted">Evidence reference (required)</span>
              <input value={evidenceReference} onChange={(event) => setEvidenceReference(event.target.value)} maxLength={500} className="mt-1 w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm" placeholder="Where the original is kept" />
            </label>
            <label className="block text-sm">
              <span className="text-muted">Stated original time (optional, unverified)</span>
              <input type="datetime-local" value={statedSourceAt} onChange={(event) => setStatedSourceAt(event.target.value)} className="mt-1 w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm" />
              <span className="text-xs text-muted">Chicago time. Recorded as stated — never treated as proof of timing.</span>
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="text-muted">Note (optional)</span>
              <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} className="mt-1 w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm" />
            </label>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" />
            <span>
              I understand this is a record only: it is not a Waiver board, it is never graded, never enters consensus or a leaderboard, and
              cannot be edited or deleted once recorded.
            </span>
          </label>
          <Button type="button" variant="secondary" disabled={!canRecord} onClick={record}>
            Record evidence (record only)
          </Button>
        </div>
      ) : null}

      {message ? (
        <p
          className={`rounded-md border px-3 py-2 text-sm ${message.tone === "ok" ? "border-success/30 bg-success-soft text-success" : "border-danger/30 bg-danger-soft text-danger"}`}
          role={message.tone === "error" ? "alert" : undefined}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { approveWaiverAiLateEntryAction, verifyWaiverAiLateEntryAction } from "@/lib/waivers/ai/actions";
import {
  WAIVER_AI_ARTIFACT_MAX_BYTES,
  WAIVER_AI_LATE_ENTRY_BASES,
  WAIVER_AI_LATE_ENTRY_BASIS_LABELS,
  WAIVER_AI_LATE_ENTRY_INELIGIBLE_LABELS,
  WAIVER_AI_PROMPT_EQUIVALENCE_LABELS,
  WAIVER_AI_PROMPT_VERSION_MAX,
} from "@/lib/waivers/ai/constants";
import { inspectProviderArtifact, type ProviderArtifactInspection } from "@/lib/waivers/ai/provider-artifact";

type Artifact = { name: string; sha256: string; base64: string; inspection: ProviderArtifactInspection };

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

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const input = "mt-1 w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm";

/**
 * Late Entry Override for one historical-evidence record: (1) record an
 * append-only verification, then (2) in a separate action, approve an
 * eligible verification, which creates the late-entered board. The server
 * re-parses the stored evidence text; nothing here is written as a pick.
 */
export function WaiverAiLateEntryForm({
  evidenceId,
  profileId,
  contestId,
  responseText,
  responseSha256,
  promptSha256,
  pickIds,
  recordedBeforeLock,
  latestVerification,
  canApprove,
}: {
  evidenceId: string;
  profileId: string;
  contestId: string;
  responseText: string;
  responseSha256: string;
  promptSha256: string;
  /** Strict frozen-pool parse of the evidence, in order. */
  pickIds: string[];
  recordedBeforeLock: boolean;
  latestVerification: null | { id: string; sequence: number; eligible: boolean; ineligibleReason: string | null; approved: boolean };
  canApprove: boolean;
}) {
  const router = useRouter();
  const [basis, setBasis] = useState<string>(recordedBeforeLock ? "DATABASE_RECORDED_PRE_LOCK" : "");
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [originalAt, setOriginalAt] = useState("");
  const [promptVersion, setPromptVersion] = useState("");
  const [promptReference, setPromptReference] = useState("");
  const [promptText, setPromptText] = useState("");
  const [promptTextSha256, setPromptTextSha256] = useState<string | null>(null);
  const promptHashRequest = useRef(0);
  const [sourceReference, setSourceReference] = useState("");
  const [attestation, setAttestation] = useState("");
  const [attested, setAttested] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [note, setNote] = useState("");
  const [approveChecked, setApproveChecked] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const needsArtifact = basis === "PROVIDER_ARTIFACT";
  /** Admin-read or admin-stated times are recorded but never competitive. */
  const recordOnlyTime = (basis === "PROVIDER_ARTIFACT" && artifact !== null && !artifact.inspection.extractedAt) || basis === "OPERATOR_ATTESTED";
  const promptMatchesCanonical = promptTextSha256 !== null && promptTextSha256 === promptSha256;
  const claimsCanonicalLabel = /^\s*WAIVEREYEQ_AI_V[0-9]/i.test(promptVersion);
  const canVerify =
    basis !== "" &&
    (!needsArtifact || artifact !== null) &&
    (!claimsCanonicalLabel || promptMatchesCanonical) &&
    sourceReference.trim() !== "" &&
    attestation.trim() !== "" &&
    attested &&
    !pending;
  const approvable = latestVerification !== null && latestVerification.eligible && !latestVerification.approved && canApprove;

  async function loadArtifact(selected: File | undefined) {
    setMessage(null);
    setArtifact(null);
    if (!selected) return;
    if (selected.size === 0 || selected.size > WAIVER_AI_ARTIFACT_MAX_BYTES) {
      setMessage({ tone: "error", text: `The provider file must be 1–${WAIVER_AI_ARTIFACT_MAX_BYTES} bytes.` });
      return;
    }
    const bytes = new Uint8Array(await selected.arrayBuffer());
    setArtifact({ name: selected.name, sha256: await sha256Hex(bytes), base64: toBase64(bytes), inspection: inspectProviderArtifact(bytes, responseText) });
  }

  async function changePromptText(value: string) {
    setPromptText(value);
    const request = ++promptHashRequest.current;
    const sha256 = value.trim() ? await sha256Hex(new TextEncoder().encode(value)) : null;
    if (request === promptHashRequest.current) setPromptTextSha256(sha256);
  }

  function verify() {
    setMessage(null);
    startTransition(async () => {
      const result = await verifyWaiverAiLateEntryAction({
        evidenceId,
        profileId,
        contestId,
        expectedSequence: latestVerification?.sequence ?? 0,
        basis,
        originalPredictionAt: basis === "DATABASE_RECORDED_PRE_LOCK" ? "" : originalAt,
        sourceReference,
        artifact: artifact ? { name: artifact.name, sha256: artifact.sha256, base64: artifact.base64 } : null,
        expectedPromptSha256: promptSha256,
        originalPrompt: { version: promptVersion, reference: promptReference, text: promptText },
        confirmedRankableEntryIds: pickIds,
        attestation,
      });
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      const prompt = WAIVER_AI_PROMPT_EQUIVALENCE_LABELS[result.promptEquivalence] ?? result.promptEquivalence;
      setMessage({
        tone: result.eligible ? "ok" : "error",
        text: result.eligible
          ? `Verification ${result.sequence} recorded: eligible for approval. Original prompt: ${prompt}.`
          : `Verification ${result.sequence} recorded: NOT eligible — ${WAIVER_AI_LATE_ENTRY_INELIGIBLE_LABELS[result.ineligibleReason ?? ""] ?? result.ineligibleReason}. The evidence stays record-only.`,
      });
      setArtifact(null);
      setAttested(false);
      router.refresh();
    });
  }

  function approve() {
    if (!latestVerification) return;
    setMessage(null);
    startTransition(async () => {
      const result = await approveWaiverAiLateEntryAction({
        verificationId: latestVerification.id,
        profileId,
        contestId,
        confirmation,
        confirmedRankableEntryIds: pickIds,
        note,
      });
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setMessage({ tone: "ok", text: `Late entry approved and imported at ${chicago(new Date(result.importedAt))}.` });
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-md border border-border p-4">
        <p className="text-sm font-semibold text-ink">Step 1 · Record evidence verification</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm sm:col-span-2">
            <span className="text-muted">Evidence basis (required)</span>
            <select value={basis} onChange={(event) => setBasis(event.target.value)} className={input}>
              <option value="">Choose…</option>
              {WAIVER_AI_LATE_ENTRY_BASES.map((value) => (
                <option key={value} value={value} disabled={value === "DATABASE_RECORDED_PRE_LOCK" && !recordedBeforeLock}>
                  {WAIVER_AI_LATE_ENTRY_BASIS_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          {needsArtifact ? (
            <div className="space-y-1 text-sm sm:col-span-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-ink/20 bg-surface-elevated px-3 py-1.5 font-medium">
                Load original provider file (byte-exact)
                <input type="file" className="sr-only" onChange={(event) => void loadArtifact(event.target.files?.[0])} />
              </label>
              {artifact ? (
                <div className="space-y-0.5 text-xs">
                  <p className="font-mono text-muted">
                    {artifact.name} · sha256 {artifact.sha256}
                  </p>
                  <p className={artifact.inspection.containsResponse ? "text-success" : "text-danger"}>
                    {artifact.inspection.containsResponse ? "Contains the exact response text." : "Does NOT contain the exact response text — not eligible."}
                  </p>
                  <p className={artifact.inspection.extractedAt ? "text-muted" : "text-danger"}>
                    {artifact.inspection.extractedAt
                      ? `Provider timestamp on the assistant message (${artifact.inspection.extractedKey}): ${chicago(artifact.inspection.extractedAt)}`
                      : "No provider timestamp on the assistant message holding the response — this verification will be record-only (not eligible)."}
                  </p>
                  <p className="text-muted">Preview only; the server re-reads the stored file and its result is final.</p>
                </div>
              ) : null}
            </div>
          ) : null}
          {recordOnlyTime ? (
            <label className="block text-sm">
              <span className="text-muted">
                {basis === "OPERATOR_ATTESTED" ? "Stated original time (optional, unverified)" : "Time you read in the file (optional, record-only)"}
              </span>
              <input type="datetime-local" value={originalAt} onChange={(event) => setOriginalAt(event.target.value)} className={input} />
              <span className="text-xs text-muted">Chicago time. Never establishes competitive eligibility.</span>
            </label>
          ) : null}
          <label className="block text-sm">
            <span className="text-muted">Source reference (required)</span>
            <input value={sourceReference} onChange={(event) => setSourceReference(event.target.value)} maxLength={500} className={input} placeholder="Export file, share link or archive location" />
          </label>
          <fieldset className="space-y-2 rounded-md border border-border p-3 text-sm sm:col-span-2">
            <legend className="px-1 text-muted">Original prompt the AI was given (record what is known; leave blank if unknown)</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-muted">Original prompt version or name</span>
                <input value={promptVersion} onChange={(event) => setPromptVersion(event.target.value)} maxLength={WAIVER_AI_PROMPT_VERSION_MAX} className={input} />
              </label>
              <label className="block">
                <span className="text-muted">Original prompt reference</span>
                <input value={promptReference} onChange={(event) => setPromptReference(event.target.value)} maxLength={500} className={input} placeholder="Where the original prompt is kept" />
              </label>
            </div>
            <label className="block">
              <span className="text-muted">Original prompt text, exactly as sent (optional)</span>
              <textarea value={promptText} onChange={(event) => void changePromptText(event.target.value)} rows={4} className={`${input} font-mono text-xs`} />
            </label>
            <p className={claimsCanonicalLabel && !promptMatchesCanonical ? "text-danger" : "text-muted"}>
              {promptMatchesCanonical
                ? "Byte-identical to the canonical prompt — the board will name it."
                : claimsCanonicalLabel
                  ? "A canonical prompt version may be recorded only with the byte-identical preserved prompt text."
                  : promptTextSha256
                    ? "Differs from the canonical prompt — recorded as a different original prompt; the board will not name the canonical prompt."
                    : "Without the preserved prompt text, the original prompt is recorded as unknown or different; the board will not name the canonical prompt."}
            </p>
            <p className="text-xs text-muted">
              Canonical prompt used for validation: sha256 <span className="font-mono">{promptSha256.slice(0, 12)}…</span>
            </p>
          </fieldset>
          <label className="block text-sm sm:col-span-2">
            <span className="text-muted">Evidence review and attestation (required)</span>
            <textarea value={attestation} onChange={(event) => setAttestation(event.target.value)} maxLength={2000} rows={3} className={input} />
          </label>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} className="mt-1" />
          <span>
            I attest that this is the AI&apos;s exact original response, produced before the lock, that the original prompt is recorded above only as far as it is
            known, and that I reviewed the evidence above. Picks are never regenerated, corrected or reordered.
          </span>
        </label>
        <Button type="button" variant="secondary" disabled={!canVerify} onClick={verify}>
          Record verification
        </Button>
      </div>

      {approvable ? (
        <div className="space-y-3 rounded-md border border-danger/30 p-4">
          <p className="text-sm font-semibold text-ink">Step 2 · Approve competitive inclusion</p>
          <p className="text-sm text-muted">
            Creates this AI&apos;s locked board from the verified response, shown as “LATE-ENTERED — VERIFIED PRE-LOCK”. One late entry per AI per contest; it
            cannot be edited, replaced or withdrawn.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-muted">
                Type the first 12 characters of the response sha256 (<span className="font-mono">{responseSha256.slice(0, 4)}…</span>)
              </span>
              <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} maxLength={64} className={`${input} font-mono`} autoComplete="off" />
            </label>
            <label className="block text-sm">
              <span className="text-muted">Approval note (optional)</span>
              <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} className={input} />
            </label>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={approveChecked} onChange={(event) => setApproveChecked(event.target.checked)} className="mt-1" />
            <span>I approve including this late-entered board in AI and All Participants competition. It never enters human-only consensus.</span>
          </label>
          <Button type="button" variant="danger" disabled={pending || !approveChecked || confirmation.trim().length !== 12} onClick={approve}>
            Approve late entry
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

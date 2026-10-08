"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { withdrawWaiverArtifactAction } from "@/lib/waivers/artifacts/actions";
import { WAIVER_ARTIFACT_WITHDRAWAL_ATTESTATION_TEXT } from "@/lib/waivers/artifacts/authority";

const inputClass = "w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-ink";

/**
 * Records an SNG withdrawal as a new event. The artifact, its content, its
 * earlier events and any successor stay intact; nothing is restored.
 */
export function WaiverArtifactWithdrawPanel({
  artifactRowId,
  latestSequence,
  superseded,
}: {
  artifactRowId: string;
  latestSequence: number;
  superseded: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [sourceReference, setSourceReference] = useState("");
  const [sourceObservedAt, setSourceObservedAt] = useState("");
  const [attested, setAttested] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = reason.trim() && sourceReference.trim() && sourceObservedAt.trim() && attested;

  const run = () => {
    setError(null);
    startTransition(async () => {
      const result = await withdrawWaiverArtifactAction({ artifactRowId, expectedSequence: latestSequence, reason, sourceReference, sourceObservedAt, attested });
      if (!result.ok) {
        setError(`${result.code}: ${result.error}`);
        return;
      }
      router.refresh();
    });
  };

  return (
    <section className="rounded-lg border border-danger/30 bg-surface-elevated p-5">
      <h3 className="font-display text-lg font-semibold text-ink">{superseded ? "Record later withdrawal of a superseded artifact" : "Record SNG withdrawal"}</h3>
      <p className="mt-1 text-sm text-muted">
        {superseded
          ? "Appends a WITHDRAWN event after its SUPERSEDED event. The successor stays current; no earlier artifact is restored. Nothing is deleted or re-graded."
          : "Appends a WITHDRAWN event. No earlier artifact is restored. Nothing is deleted, re-graded or replaced."}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-muted">
          SNG source reference
          <input className={inputClass} value={sourceReference} maxLength={500} onChange={(e) => setSourceReference(e.target.value)} />
        </label>
        <label className="text-sm text-muted">
          When you observed the withdrawal (Chicago or ISO)
          <input className={inputClass} value={sourceObservedAt} placeholder="YYYY-MM-DDTHH:MM" maxLength={64} onChange={(e) => setSourceObservedAt(e.target.value)} />
        </label>
      </div>
      <label className="mt-3 block text-sm text-muted">
        Reason (required)
        <textarea className={`${inputClass} h-20`} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
      </label>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
        <span className="text-muted">{WAIVER_ARTIFACT_WITHDRAWAL_ATTESTATION_TEXT}</span>
      </label>
      <div className="mt-3">
        <Button type="button" size="sm" variant="secondary" disabled={pending || !ready} onClick={run}>
          {pending ? "Recording…" : "Record withdrawal"}
        </Button>
      </div>
      {error ? (
        <p className="mt-3 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

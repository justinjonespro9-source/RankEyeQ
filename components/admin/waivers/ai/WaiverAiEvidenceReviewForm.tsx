"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { reviewWaiverAiEvidenceAction } from "@/lib/waivers/ai/actions";
import { WAIVER_AI_EVIDENCE_REVIEW_STATUSES } from "@/lib/waivers/ai/constants";

const STATUS_LABELS: Record<(typeof WAIVER_AI_EVIDENCE_REVIEW_STATUSES)[number], string> = {
  TEXT_CONFIRMED: "Text confirmed against the preserved original",
  NEEDS_FOLLOW_UP: "Needs follow-up",
  REJECTED: "Rejected as evidence",
};

/** Appends a review. No status makes the evidence competitive. */
export function WaiverAiEvidenceReviewForm({
  evidenceId,
  profileId,
  contestId,
  latestSequence,
}: {
  evidenceId: string;
  profileId: string;
  contestId: string;
  latestSequence: number;
}) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await reviewWaiverAiEvidenceAction({ evidenceId, profileId, contestId, expectedSequence: latestSequence, status, note });
      if (!result.ok) {
        setMessage(result.error);
        return;
      }
      setStatus("");
      setNote("");
      setMessage(`Review ${result.sequence} recorded.`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-2 text-sm">
      <label className="block">
        <span className="text-xs text-muted">Review</span>
        <select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1 block rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-sm">
          <option value="">Choose…</option>
          {WAIVER_AI_EVIDENCE_REVIEW_STATUSES.map((value) => (
            <option key={value} value={value}>
              {STATUS_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <label className="block min-w-[16rem] flex-1">
        <span className="text-xs text-muted">Note (required)</span>
        <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} className="mt-1 block w-full rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-sm" />
      </label>
      <Button type="button" size="sm" variant="secondary" disabled={pending || !status || !note.trim()} onClick={submit}>
        Add review
      </Button>
      {message ? <span className="text-xs text-muted">{message}</span> : null}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { openWaiverContestsAction } from "@/lib/waivers/actions";

/** Separate, explicit Phase 2 action: opens unopened positions against the current snapshot. */
export function WaiverContestOpenPanel({
  weekId,
  snapshotId,
  snapshotVersion,
  unopenedPositions,
  locksAtLabel,
}: {
  weekId: string;
  snapshotId: string;
  snapshotVersion: number;
  unopenedPositions: string[];
  locksAtLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    setError(null);
    startTransition(async () => {
      const response = await openWaiverContestsAction({ weekId, snapshotId });
      if (!response.ok) {
        setError(`${response.code}: ${response.error}`);
        return;
      }
      setResult(
        [
          response.opened.length ? `Opened ${response.opened.map((row) => `${row.position} (${row.availableSlots} slots)`).join(", ")}` : null,
          response.existing.length ? `Already open: ${response.existing.map((row) => row.position).join(", ")}` : null,
          response.refused.length ? `Refused (empty eligible pool): ${response.refused.map((row) => row.position).join(", ")}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      );
      setConfirmed(false);
      router.refresh();
    });
  };

  return (
    <section className="rounded-lg border border-border bg-surface-elevated p-5">
      <h3 className="font-display text-lg font-semibold text-ink">Open Waiver contests</h3>
      <p className="mt-1 text-sm text-muted">
        Opens {unopenedPositions.join(", ")} against snapshot version {snapshotVersion}. Locks {locksAtLabel}. Positions with no eligible players are refused.
      </p>
      <label className="mt-3 flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />I reviewed version {snapshotVersion} and want to open these contests
      </label>
      <Button type="button" size="sm" className="mt-3" disabled={pending || !confirmed} onClick={open}>
        {pending ? "Opening…" : "Open contests"}
      </Button>
      {result ? (
        <p className="mt-3 text-sm text-success" role="status">
          {result}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

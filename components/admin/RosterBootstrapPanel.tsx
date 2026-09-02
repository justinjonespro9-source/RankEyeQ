"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bootstrapNflRosterAction } from "@/lib/admin-manual-actions";
import { Button } from "@/components/ui/Button";

export function RosterBootstrapPanel({
  seasonId,
  seasonYear,
  lastSyncSource,
  lastSyncedAt,
}: {
  seasonId: string;
  seasonYear: number;
  lastSyncSource: string | null;
  lastSyncedAt: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [report, setReport] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    setReport(null);
    startTransition(async () => {
      const result = await bootstrapNflRosterAction({ seasonId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setReport(result.summary);
      router.refresh();
    });
  }

  return (
    <section className="mb-8 rounded-lg border border-border bg-surface-elevated p-5">
      <h2 className="font-display text-lg font-semibold text-ink">
        2026 NFL roster bootstrap
      </h2>
      <p className="mt-1 text-sm text-muted">
        One-time import from official NFL.com {seasonYear} team roster pages.
        Populates the season player universe (QB/RB/FB→RB/WR/TE + 32 DEF) and
        runs weekly eligibility sync. Not a long-term production dependency —
        review licensing before automating.
      </p>
      {lastSyncedAt ? (
        <p className="mt-2 text-xs text-muted">
          Last sync: {new Date(lastSyncedAt).toLocaleString()} ·{" "}
          {lastSyncSource ?? "unknown source"}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" disabled={pending} onClick={run}>
          {pending ? "Importing…" : `Import ${seasonYear} NFL rosters`}
        </Button>
      </div>
      {error ? (
        <pre className="mt-4 whitespace-pre-wrap rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-700">
          {error}
        </pre>
      ) : null}
      {report ? (
        <pre className="mt-4 whitespace-pre-wrap rounded-md border border-border bg-surface p-3 font-mono text-xs text-ink">
          {report}
        </pre>
      ) : null}
    </section>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { StatusPill } from "@/components/admin/StatusPill";
import { Button } from "@/components/ui/Button";
import { commandOpenWeekRankingsAction } from "@/lib/admin-command-actions";
import type { OpenWeekRankingsReadiness } from "@/lib/admin/open-week-rankings";
import { CONTEST_POSITIONS } from "@/lib/contest-defaults";

export function OpenWeekRankingsPanel({
  weekId,
  weekLabel,
  readiness,
}: {
  weekId: string;
  weekLabel: string;
  readiness: OpenWeekRankingsReadiness;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const allOpen = readiness.contestStatuses.every((row) => row.status === "OPEN");

  return (
    <section
      id="open-rankings"
      className="mb-8 rounded-lg border border-border bg-surface-elevated p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">
            Open Week Rankings
          </h2>
          <p className="mt-1 text-sm text-muted">
            Explicitly publish all five contests for {weekLabel}. Eligibility sync
            does not open rankings automatically.
          </p>
        </div>
        {allOpen ? <StatusPill status="Complete" /> : <StatusPill status={readiness.ready ? "Ready" : "Needs Attention"} />}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {CONTEST_POSITIONS.map((position) => {
          const row = readiness.contestStatuses.find((c) => c.position === position);
          return (
            <span
              key={position}
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm"
            >
              <span className="font-semibold text-ink">{position}</span>
              <span className="ml-2 text-muted">{row?.status ?? "—"}</span>
            </span>
          );
        })}
      </div>

      {readiness.blockers.length > 0 && !allOpen ? (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-warning">
          {readiness.blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      ) : null}

      {readiness.warnings.length > 0 ? (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted">
          {readiness.warnings.map((warning) => (
            <li key={warning.code}>{warning.message}</li>
          ))}
        </ul>
      ) : null}

      {message ? (
        <p className="mt-3 text-sm text-ink">{message}</p>
      ) : null}

      <div className="mt-4">
        <Button
          type="button"
          disabled={pending || (!readiness.ready && !allOpen)}
          onClick={() =>
            startTransition(async () => {
              const formData = new FormData();
              formData.set("weekId", weekId);
              const result = await commandOpenWeekRankingsAction(formData);
              if (result.ok) {
                setMessage(
                  result.alreadyOpen
                    ? "All five contests are already OPEN."
                    : "Week rankings opened — QB, RB, WR, TE, and DEF are now OPEN.",
                );
                router.refresh();
              } else {
                setMessage(result.error ?? "Unable to open week rankings.");
              }
            })
          }
        >
          {allOpen ? "Rankings already open" : "Open Week Rankings"}
        </Button>
      </div>
    </section>
  );
}

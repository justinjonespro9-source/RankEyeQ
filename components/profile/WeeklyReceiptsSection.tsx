"use client";

import Link from "next/link";
import { useState } from "react";
import {
  groupReceiptsByWeek,
  formatEyeqOrDash,
} from "@/lib/profile-resume";
import { receiptOutcomeTone } from "@/lib/profile-receipt";
import type { ProfileContestHistoryItem } from "@/types/profile";

export function WeeklyReceiptsSection({
  username,
  history,
}: {
  username: string;
  history: ProfileContestHistoryItem[];
}) {
  const weeks = groupReceiptsByWeek(history);

  if (weeks.length === 0) {
    return (
      <section className="mt-10">
        <h3 className="font-display text-lg font-semibold text-ink">
          Weekly Receipts
        </h3>
        <p className="mt-2 rounded-lg border border-border bg-surface px-4 py-5 text-sm text-muted">
          Season performance begins after Week 1. Receipts unlock after results
          are graded.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-10">
      <h3 className="font-display text-lg font-semibold text-ink">
        Weekly Receipts
      </h3>
      <p className="mt-1 text-sm text-muted">
        Permanent graded boards — expand a card to see predicted vs actual
        finishes.
      </p>
      <div className="mt-4 space-y-4">
        {weeks.map((week) => (
          <div key={week.weekNumber} className="space-y-2">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-muted">
              {week.weekLabel}
            </h4>
            <ul className="space-y-2">
              {week.items.map((item) => (
                <ReceiptCard
                  key={item.submissionId}
                  username={username}
                  item={item}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReceiptCard({
  username,
  item,
}: {
  username: string;
  item: ProfileContestHistoryItem;
}) {
  const [open, setOpen] = useState(false);
  const eyeq = formatEyeqOrDash(item.normalizedScore);
  const href = `/profile/${username}/rankings/${item.weekNumber}/${item.position.toLowerCase()}`;

  return (
    <li className="rounded-lg border border-border bg-surface overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <p className="font-medium text-ink">
            {item.position}
            {eyeq != null ? (
              <>
                {" "}
                — EYEQ{" "}
                <span className="font-display tabular-nums">{eyeq}</span>
              </>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {item.topNHits} field hits · {item.exactHits} exact
            {item.numberOneHit ? " · #1 hit" : ""}
            {item.weeklyRank != null ? ` · Week rank #${item.weeklyRank}` : ""}
            {" · "}
            {open ? "Hide receipt" : "View Receipt"}
          </p>
        </button>
        <Link
          href={href}
          className="shrink-0 text-sm font-medium text-accent hover:underline"
        >
          Full board
        </Link>
      </div>

      {open ? (
        <div className="border-t border-border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <thead className="border-b border-border bg-surface-elevated text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Predicted</th>
                  <th className="px-3 py-2">Player</th>
                  <th className="px-3 py-2">Actual</th>
                  <th className="px-3 py-2">Result</th>
                </tr>
              </thead>
              <tbody>
                {item.receiptPicks.map((pick) => (
                  <tr
                    key={`${item.submissionId}-${pick.predictedRank}`}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-3 py-2 font-display tabular-nums text-ink">
                      #{pick.predictedRank}
                    </td>
                    <td className="px-3 py-2 text-ink">
                      <span className="font-medium">{pick.playerName}</span>
                      {pick.team ? (
                        <span className="ml-1 text-xs text-muted">
                          {pick.team}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-ink">
                      {pick.actualLabel}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${receiptOutcomeTone(pick.outcome.key)}`}
                      >
                        {pick.outcome.label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </li>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { ReceiptOutcomeChip } from "@/components/rank/ReceiptOutcomeChip";
import {
  groupReceiptsByWeek,
  formatEyeqOrDash,
} from "@/lib/profile-resume";
import type { ProfileContestHistoryItem } from "@/types/profile";
import type { ReceiptPickLine } from "@/lib/profile-receipt";

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
      <div className="flex items-stretch gap-2 px-3 py-2 sm:px-4 sm:py-3">
        <button
          type="button"
          className="min-h-12 min-w-0 flex-1 rounded-md px-1 py-2 text-left"
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
          <p className="mt-0.5 text-sm text-muted">
            {item.weekLabel} · {item.topNHits} field hits · {item.exactHits} exact
            {item.numberOneHit ? " · #1 hit" : ""}
            {item.weeklyRank != null ? ` · Week rank #${item.weeklyRank}` : ""}
          </p>
          <p className="mt-1 text-sm font-medium text-accent-ink">
            {open ? "Hide receipt" : "View receipt"}
          </p>
        </button>
        <Link
          href={href}
          className="inline-flex min-h-12 shrink-0 items-center px-2 text-sm font-medium text-accent-ink hover:underline"
        >
          Full board
        </Link>
      </div>

      {open ? (
        <div className="border-t border-border">
          {item.receiptPicks.length === 0 ? (
            <p className="px-4 py-5 text-sm text-muted">
              No graded picks on this receipt yet.
            </p>
          ) : (
            <>
              <div className="space-y-2 p-3 md:hidden">
                {item.receiptPicks.map((pick) => (
                  <ReceiptPickMobileCard
                    key={`${item.submissionId}-${pick.predictedRank}`}
                    pick={pick}
                  />
                ))}
              </div>

              <div className="table-scroll hidden overflow-x-auto md:block">
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
                          <ReceiptOutcomeChip outcome={pick.outcome} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      ) : null}
    </li>
  );
}

function ReceiptPickMobileCard({ pick }: { pick: ReceiptPickLine }) {
  return (
    <article className="rounded-lg border border-border bg-surface-elevated p-3">
      <p className="font-medium text-ink">{pick.playerName}</p>
      {pick.team ? (
        <p className="mt-0.5 text-sm text-muted">{pick.team}</p>
      ) : null}
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <div className="flex gap-1.5">
          <dt className="text-muted">Predicted:</dt>
          <dd className="font-display font-semibold tabular-nums text-ink">
            #{pick.predictedRank}
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-muted">Actual:</dt>
          <dd className="font-display font-semibold tabular-nums text-ink">
            {pick.actualLabel}
          </dd>
        </div>
      </dl>
      <div className="mt-2">
        <ReceiptOutcomeChip outcome={pick.outcome} />
      </div>
    </article>
  );
}

"use client";

import { useState } from "react";
import { ReceiptOutcomeChip } from "@/components/rank/ReceiptOutcomeChip";
import { classifyReceiptOutcome } from "@/lib/profile-receipt";
import type { PlayerScoreBreakdown } from "@/types/scoring";

function rowTone(row: PlayerScoreBreakdown, showExactHit: boolean) {
  if (showExactHit) {
    return "border-accent/40 bg-accent-soft/60 ring-2 ring-accent/40 shadow-[0_0_12px_rgba(20,184,166,0.22)]";
  }
  if (!row.topNHit) return "border-rose-200 bg-rose-50";
  if (row.rankDifference < 0) return "border-sky-200 bg-sky-50";
  if (row.rankDifference > 0) return "border-amber-200 bg-amber-50";
  return "border-border bg-surface";
}

function precisionLabel(row: PlayerScoreBreakdown) {
  const diff = Math.abs(row.rankDifference);
  if (diff === 0) return "Exact Rank";
  if (diff === 1) return "Off by 1";
  if (diff === 2) return "Off by 2";
  return "Off by 3+";
}

export function formatPlayerScoreLines(
  row: PlayerScoreBreakdown,
  fieldSize = 10,
): string[] {
  const hitLabel = fieldSize === 15 ? "Top 15 Hit" : "Top 10 Hit";
  if (!row.topNHit) {
    return [`Outside ${fieldSize === 15 ? "Top 15" : "Top 10"}`, "0"];
  }

  const lines: string[] = [`${hitLabel} +${row.basePoints}`];

  if (row.actualPodiumPoints > 0) {
    lines.push(`Actual #${row.actualRank} +${row.actualPodiumPoints}`);
  }

  if (row.podiumCallPoints > 0) {
    lines.push(`Podium Call +${row.podiumCallPoints}`);
  }

  if (row.precisionPoints > 0) {
    lines.push(`${precisionLabel(row)} +${row.precisionPoints}`);
  }

  lines.push(`Total ${row.totalPoints}`);
  return lines;
}

export function ScoredPlayerRow({
  row,
  fieldSize = 10,
  team,
  opponent,
  fantasyPoints,
  /** When true (final graded only), celebrate exact hits. Default true for graded results UIs. */
  contestIsFinal = true,
}: {
  row: PlayerScoreBreakdown;
  fieldSize?: number;
  team?: string;
  opponent?: string;
  fantasyPoints?: number | null;
  contestIsFinal?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const scoreLines = formatPlayerScoreLines(row, fieldSize);
  const breakdownParts = scoreLines.slice(0, -1);
  const fieldLabel = fieldSize === 15 ? "Top 15" : "Top 10";
  const outcome = classifyReceiptOutcome(row, fieldSize);
  const meta = [team, opponent].filter(Boolean).join(" · ");
  const showExactHit = contestIsFinal && row.exactHit;

  return (
    <li className={`border-b border-border last:border-0 ${rowTone(row, showExactHit)}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full flex-col gap-2 px-4 py-3.5 text-left sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-5"
        aria-expanded={open}
      >
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">
            {showExactHit ? (
              <span className="mr-1 text-accent" aria-hidden="true">
                ★
              </span>
            ) : null}
            {row.playerName}
          </p>
          {meta ? (
            <p className="mt-0.5 text-sm text-muted">{meta}</p>
          ) : null}

          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm sm:flex sm:flex-wrap sm:gap-x-4">
            <div className="flex gap-1.5">
              <dt className="text-muted">Predicted:</dt>
              <dd className="font-display font-semibold tabular-nums text-ink">
                #{row.predictedRank}
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-muted">Actual:</dt>
              <dd className="font-display font-semibold tabular-nums text-ink">
                #{row.actualRank}
              </dd>
            </div>
            {fantasyPoints != null && Number.isFinite(fantasyPoints) ? (
              <div className="col-span-2 flex gap-1.5 sm:col-span-1">
                <dt className="text-muted">Fantasy Pts:</dt>
                <dd className="font-semibold tabular-nums text-ink">
                  {fantasyPoints.toFixed(1)}
                </dd>
              </div>
            ) : null}
          </dl>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ReceiptOutcomeChip outcome={outcome} showExactHit={showExactHit} />
            <span className="text-sm font-semibold tabular-nums text-ink sm:hidden">
              {row.totalPoints} pts
            </span>
          </div>
        </div>

        <div className="hidden shrink-0 text-right text-sm sm:block">
          <p className="font-display text-lg font-semibold tabular-nums text-ink">
            {row.totalPoints} pts
          </p>
          <p className="text-xs text-muted">{breakdownParts.join(" · ")}</p>
        </div>
      </button>

      {open ? (
        <div className="border-t border-border/70 bg-surface-elevated/80 px-4 py-3 text-sm sm:px-5">
          <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">
                Predicted
              </dt>
              <dd className="font-medium tabular-nums text-ink">
                {row.predictedRank}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">
                Actual
              </dt>
              <dd className="font-medium tabular-nums text-ink">
                {row.actualRank}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">
                Rank diff
              </dt>
              <dd className="font-medium tabular-nums text-ink">
                {row.rankDifference > 0 ? "+" : ""}
                {row.rankDifference}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">
                Flags
              </dt>
              <dd className="font-medium text-ink">
                {[
                  row.topNHit ? fieldLabel : null,
                  showExactHit ? "Exact" : null,
                  row.podiumCallHit ? "Podium Call" : null,
                  row.actualPodiumPoints > 0 && !row.podiumCallHit
                    ? "Actual Podium"
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Miss"}
              </dd>
            </div>
          </dl>
          <ul className="mt-3 space-y-1 text-muted">
            {scoreLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

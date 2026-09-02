"use client";

import { useState } from "react";
import type { PlayerScoreBreakdown } from "@/types/scoring";

function rowTone(row: PlayerScoreBreakdown) {
  if (row.exactHit) return "border-accent/30 bg-accent-soft/50";
  if (!row.topNHit) return "border-rose-200 bg-rose-50";
  if (row.rankDifference < 0) return "border-sky-200 bg-sky-50";
  if (row.rankDifference > 0) return "border-amber-200 bg-amber-50";
  return "border-border bg-surface";
}

function differenceLabel(row: PlayerScoreBreakdown) {
  if (!row.topNHit) return "Outside Top N";
  if (row.exactHit) return "Exact";
  return `Off by ${Math.abs(row.rankDifference)}`;
}

function precisionLabel(row: PlayerScoreBreakdown) {
  const diff = Math.abs(row.rankDifference);
  if (diff === 0) return "Exact Rank";
  if (diff === 1) return "Off by 1";
  if (diff === 2) return "Off by 2";
  return "Off by 3+";
}

export function formatPlayerScoreLines(row: PlayerScoreBreakdown): string[] {
  if (!row.topNHit) {
    return ["Outside Top N", "0"];
  }

  const lines: string[] = [`Top-N Hit +${row.basePoints}`];

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

export function ScoredPlayerRow({ row }: { row: PlayerScoreBreakdown }) {
  const [open, setOpen] = useState(false);
  const scoreLines = formatPlayerScoreLines(row);
  const breakdownParts = scoreLines.slice(0, -1);

  return (
    <li className={`border-b border-border last:border-0 ${rowTone(row)}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full flex-col gap-1 px-4 py-3 text-left sm:flex-row sm:items-center sm:justify-between sm:px-5"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <p className="font-medium text-ink">
            <span className="font-display tabular-nums text-accent">
              {row.predictedRank}.
            </span>{" "}
            {row.playerName}
            {row.podiumCallHit ? (
              <span className="ml-2 text-xs font-semibold uppercase tracking-wide text-accent">
                Podium Call
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            Actual: {row.actualRank} · {differenceLabel(row)}
          </p>
          <p className="mt-1 text-xs text-muted sm:hidden">
            {breakdownParts.join(" · ")} ·{" "}
            <span className="font-semibold text-ink">
              {row.totalPoints} pts
            </span>
          </p>
        </div>
        <div className="hidden text-right text-sm sm:block">
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
                  row.topNHit ? "Top-N" : null,
                  row.exactHit ? "Exact" : null,
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

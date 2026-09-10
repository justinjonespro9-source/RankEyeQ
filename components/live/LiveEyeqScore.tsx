import { formatRankIqScore } from "@/lib/scoring";

/**
 * Compact LIVE EYEQ display with resolved progress always visible.
 * Scoring math is unchanged — presentation only.
 */
export function LiveEyeqScore({
  score,
  resolvedCount,
  totalPicks,
  align = "start",
  size = "md",
}: {
  score: number;
  resolvedCount: number;
  totalPicks: number;
  align?: "start" | "end";
  size?: "sm" | "md";
}) {
  const scoreText = formatRankIqScore(score);
  const alignClass = align === "end" ? "text-right items-end" : "text-left items-start";
  const scoreClass =
    size === "sm"
      ? "text-base font-display font-semibold tabular-nums text-ink"
      : "text-lg font-display font-semibold tabular-nums text-ink";

  return (
    <div className={`flex flex-col gap-0.5 ${alignClass}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">
        LIVE EYEQ
      </p>
      {/* Desktop / wide: single compact line */}
      <p className={`hidden sm:block ${scoreClass}`}>
        {scoreText}
        <span className="ml-1.5 text-sm font-medium normal-case tracking-normal text-muted">
          · {resolvedCount}/{totalPicks} resolved
        </span>
      </p>
      {/* Mobile: two lines */}
      <div className="sm:hidden">
        <p className={scoreClass}>{scoreText}</p>
        <p className="text-xs text-muted">
          {resolvedCount} of {totalPicks} picks resolved
        </p>
      </div>
    </div>
  );
}

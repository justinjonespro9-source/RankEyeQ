import { PodiumMedal } from "@/components/live/PodiumMedal";

/**
 * Compact explanatory legend for FINAL/GRADED scoring-board rows.
 * Display only — does not affect scoring or standing logic.
 *
 * ★ = effective scoring-board rank equals actual finish within Top N.
 * Medal = actual finish was #1 / #2 / #3 (not necessarily a Podium Call).
 */
export function ScoringBoardLegend({ className = "" }: { className?: string }) {
  return (
    <p
      className={`mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted ${className}`}
      aria-label="Scoring board legend"
    >
      <span className="inline-flex items-center gap-1">
        <span className="text-accent" aria-hidden="true">
          ★
        </span>
        <span>Exact Rank Hit</span>
      </span>
      <span className="text-muted/70" aria-hidden="true">
        ·
      </span>
      <span className="inline-flex items-center gap-1">
        <PodiumMedal place={1} />
        <span>Actual Top 3</span>
      </span>
    </p>
  );
}

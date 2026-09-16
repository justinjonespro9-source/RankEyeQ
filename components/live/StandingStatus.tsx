import { PodiumMedal } from "@/components/live/PodiumMedal";
import {
  provisionalStandingLabel,
  provisionalStandingRowClass,
  type ProvisionalStandingStatus,
} from "@/lib/live-provisional";

function podiumPlace(
  status: ProvisionalStandingStatus,
): 1 | 2 | 3 | null {
  if (status === "GOLD") return 1;
  if (status === "SILVER") return 2;
  if (status === "BRONZE") return 3;
  return null;
}

export function StandingStatusBadge({
  status,
  fieldSize,
  currentRank,
  position,
  compact = false,
}: {
  status: ProvisionalStandingStatus;
  fieldSize: number;
  currentRank?: number | null;
  position?: string;
  compact?: boolean;
}) {
  const place = podiumPlace(status);
  const label =
    place != null && currentRank != null
      ? position
        ? `${position}${currentRank}`
        : `#${currentRank}`
      : currentRank != null && status !== "PENDING"
        ? position
          ? `${position}${currentRank}`
          : `#${currentRank}`
        : provisionalStandingLabel(status, fieldSize);

  const tone =
    status === "GOLD"
      ? "border-amber-500/70 bg-amber-100 text-amber-950 shadow-sm shadow-amber-200/50"
      : status === "SILVER"
        ? "border-slate-400/70 bg-slate-200 text-slate-900 shadow-sm shadow-slate-300/40"
        : status === "BRONZE"
          ? "border-orange-500/60 bg-orange-100 text-orange-950 shadow-sm shadow-orange-200/40"
          : status === "IN_FIELD"
            ? "border-emerald-400/60 bg-emerald-100 text-emerald-950"
            : "border-border bg-surface text-muted";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold tracking-wide ${tone} ${
        compact ? "uppercase" : ""
      }`}
    >
      {place != null ? <PodiumMedal place={place} /> : null}
      {place != null ? (
        <span className="sr-only">
          {place === 1 ? "Gold" : place === 2 ? "Silver" : "Bronze"} podium
        </span>
      ) : null}
      {label}
    </span>
  );
}

export function standingRowShellClass(
  status: ProvisionalStandingStatus,
  showExactHit = false,
) {
  const base = provisionalStandingRowClass(status);
  if (!showExactHit) return base;
  // Exact-hit glow stays independent of podium medal treatment.
  return `${base} ring-2 ring-accent/50 shadow-[0_0_0_1px_rgba(20,184,166,0.22)]`;
}

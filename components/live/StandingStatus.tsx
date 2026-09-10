import {
  provisionalStandingLabel,
  provisionalStandingRowClass,
  type ProvisionalStandingStatus,
} from "@/lib/live-provisional";

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
  const label =
    currentRank != null && status !== "PENDING"
      ? position
        ? `Current ${position}${currentRank}`
        : `Current #${currentRank}`
      : provisionalStandingLabel(status, fieldSize);

  const tone =
    status === "GOLD"
      ? "border-amber-400/60 bg-amber-100 text-amber-950"
      : status === "SILVER"
        ? "border-slate-300 bg-slate-200 text-slate-900"
        : status === "BRONZE"
          ? "border-orange-300/70 bg-orange-100 text-orange-950"
          : status === "IN_FIELD"
            ? "border-emerald-300/60 bg-emerald-100 text-emerald-950"
            : "border-border bg-surface text-muted";

  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${tone} ${
        compact ? "uppercase tracking-wide" : ""
      }`}
    >
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
  return `${base} ring-2 ring-accent/45 shadow-[0_0_0_1px_rgba(20,184,166,0.2)]`;
}

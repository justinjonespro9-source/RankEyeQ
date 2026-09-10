import {
  receiptOutcomeTone,
  type ReceiptOutcome,
} from "@/lib/profile-receipt";

export function ReceiptOutcomeChip({
  outcome,
  showExactHit = false,
}: {
  outcome: ReceiptOutcome;
  /** Final graded exact-hit celebration only. */
  showExactHit?: boolean;
}) {
  const exact = showExactHit || outcome.key === "EXACT";
  return (
    <span
      className={`inline-flex min-h-7 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${receiptOutcomeTone(outcome.key)} ${
        exact
          ? "ring-2 ring-accent/40 shadow-[0_0_12px_rgba(20,184,166,0.25)]"
          : ""
      }`}
    >
      {exact ? <span aria-hidden="true">★</span> : null}
      {outcome.label}
    </span>
  );
}

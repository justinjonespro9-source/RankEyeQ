import {
  receiptOutcomeTone,
  type ReceiptOutcome,
} from "@/lib/profile-receipt";

export function ReceiptOutcomeChip({ outcome }: { outcome: ReceiptOutcome }) {
  return (
    <span
      className={`inline-flex min-h-7 items-center rounded-md border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${receiptOutcomeTone(outcome.key)}`}
    >
      {outcome.label}
    </span>
  );
}

import { describeConsensusDelta } from "@/lib/results-consensus-display";

function MoveArrow({
  direction,
}: {
  direction: "better" | "worse";
}) {
  const up = direction === "better";
  return (
    <svg
      viewBox="0 0 12 12"
      width="11"
      height="11"
      aria-hidden="true"
      className="shrink-0"
    >
      {up ? (
        <path
          d="M6 2.2 9.6 6.4H7.2V9.8H4.8V6.4H2.4L6 2.2Z"
          fill="currentColor"
        />
      ) : (
        <path
          d="M6 9.8 2.4 5.6H4.8V2.2H7.2V5.6H9.6L6 9.8Z"
          fill="currentColor"
        />
      )}
    </svg>
  );
}

/**
 * Vs Consensus movement: ↑ spots better / ↓ spots worse / EVEN.
 * Underlying value remains actual − consensus for sorting.
 */
export function ConsensusDeltaMove({
  value,
  className = "",
  compact = false,
}: {
  value: number | null | undefined;
  className?: string;
  compact?: boolean;
}) {
  const model = describeConsensusDelta(value);

  return (
    <span
      title={model.title}
      aria-label={model.title}
      className={`inline-flex items-center gap-0.5 tabular-nums font-medium ${model.toneClass} ${className}`}
    >
      {model.direction === "better" || model.direction === "worse" ? (
        <MoveArrow direction={model.direction} />
      ) : null}
      <span className={compact && model.direction === "even" ? "text-[10px]" : undefined}>
        {model.visibleValue}
      </span>
    </span>
  );
}

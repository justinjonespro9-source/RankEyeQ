import { presentedByLabel } from "@/lib/sponsors/catalog";

/**
 * Lightweight “Presented by {Sponsor}” line for future premium inventory.
 * Not activated with fake paid sponsors at launch.
 */
export function PresentedBy({
  sponsorName,
  surface,
  className = "",
}: {
  sponsorName: string;
  /** e.g. “Consensus”, “Player Performance Market” */
  surface?: string;
  className?: string;
}) {
  const label = presentedByLabel(sponsorName);
  return (
    <p
      className={`text-xs font-medium uppercase tracking-[0.12em] text-muted ${className}`}
      data-presented-by={sponsorName}
    >
      {surface ? (
        <>
          <span className="text-ink">{surface}</span>
          <span className="mx-1.5 text-border" aria-hidden>
            ·
          </span>
        </>
      ) : null}
      <span>{label}</span>
    </p>
  );
}

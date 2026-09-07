import { SponsorCard } from "@/components/sponsors/SponsorCard";
import { resolvePlacement } from "@/lib/sponsors/resolve";
import type { PlacementKey } from "@/lib/sponsors/types";

/**
 * Server-friendly placement slot. Resolves catalog creative for `placementKey`.
 * Renders nothing when inactive / unresolved.
 */
export function AdPlacement({
  placementKey,
  className = "",
}: {
  placementKey: PlacementKey;
  className?: string;
}) {
  const placement = resolvePlacement(placementKey);
  if (!placement) return null;

  return (
    <div
      className={className}
      data-ad-placement={placementKey}
      data-ad-slot="true"
    >
      <SponsorCard placement={placement} />
    </div>
  );
}

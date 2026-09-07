import { SponsorClickLink } from "@/components/sponsors/SponsorClickLink";
import type { ResolvedPlacement } from "@/lib/sponsors/types";

/**
 * Native RankEyeQ sponsor / house-ad card (not a 728×90 banner unit).
 */
export function SponsorCard({
  placement,
  className = "",
}: {
  placement: ResolvedPlacement;
  className?: string;
}) {
  const { campaign, labelText, placementKey, trackedHref } = placement;
  const accent = campaign.accentColor ?? "var(--accent-ink)";

  return (
    <aside
      className={`overflow-hidden rounded-lg border border-border bg-surface-elevated ${className}`}
      aria-label={campaign.accessibilityLabel}
      data-placement={placementKey}
      data-campaign={campaign.id}
      data-sponsor-type={campaign.sponsorType}
    >
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-stretch sm:gap-5 sm:p-5">
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md font-display text-lg font-semibold text-off-white sm:h-14 sm:w-14"
          style={{ backgroundColor: accent }}
          aria-hidden
        >
          {campaign.sponsorName
            .split(/[\s-]+/)
            .map((part) => part[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            {labelText}
          </p>
          <h3 className="mt-1 font-display text-lg font-semibold tracking-tight text-ink sm:text-xl">
            {campaign.headline}
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            {campaign.body}
          </p>
          <div className="mt-3">
            <SponsorClickLink
              href={trackedHref}
              placementKey={placementKey}
              campaignId={String(campaign.id)}
              trackingSlug={campaign.trackingSlug}
              destinationUrl={campaign.destinationUrl}
              className="inline-flex items-center justify-center rounded-md border border-ink/20 bg-navy px-4 py-2 text-sm font-medium text-off-white transition-colors hover:bg-midnight focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {campaign.ctaLabel}
            </SponsorClickLink>
          </div>
        </div>
      </div>
    </aside>
  );
}

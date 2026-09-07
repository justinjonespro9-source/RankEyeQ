import Image from "next/image";
import type { CSSProperties } from "react";
import { SponsorClickLink } from "@/components/sponsors/SponsorClickLink";
import { usesProductHouseTheme } from "@/lib/sponsors/catalog";
import type { ResolvedPlacement, SponsorCampaign } from "@/lib/sponsors/types";

/**
 * Native RankEyeQ sponsor / house-ad card.
 * PAID (and generic HOUSE) use the RankEyeQ shell.
 * Product HOUSE campaigns use their own brand creative theme.
 */
export function SponsorCard({
  placement,
  className = "",
}: {
  placement: ResolvedPlacement;
  className?: string;
}) {
  const { campaign, labelText, placementKey, trackedHref } = placement;

  if (usesProductHouseTheme(campaign)) {
    return (
      <HouseProductCard
        campaign={campaign}
        labelText={labelText}
        placementKey={placementKey}
        trackedHref={trackedHref}
        className={className}
      />
    );
  }

  return (
    <PaidOrGenericCard
      campaign={campaign}
      labelText={labelText}
      placementKey={placementKey}
      trackedHref={trackedHref}
      className={className}
    />
  );
}

function PaidOrGenericCard({
  campaign,
  labelText,
  placementKey,
  trackedHref,
  className,
}: {
  campaign: SponsorCampaign;
  labelText: string;
  placementKey: ResolvedPlacement["placementKey"];
  trackedHref: string;
  className: string;
}) {
  const accent = campaign.accentColor ?? "var(--accent-ink)";

  return (
    <aside
      className={`overflow-hidden rounded-lg border border-border bg-surface-elevated ${className}`}
      aria-label={campaign.accessibilityLabel}
      data-placement={placementKey}
      data-campaign={campaign.id}
      data-sponsor-type={campaign.sponsorType}
      data-sponsor-theme={campaign.theme ?? "generic"}
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
          {campaign.subheadline ? (
            <p className="mt-1 text-sm font-medium text-ink/80">
              {campaign.subheadline}
            </p>
          ) : null}
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

function HouseProductCard({
  campaign,
  labelText,
  placementKey,
  trackedHref,
  className,
}: {
  campaign: SponsorCampaign;
  labelText: string;
  placementKey: ResolvedPlacement["placementKey"];
  trackedHref: string;
  className: string;
}) {
  const theme = campaign.theme ?? "generic";
  const ctaClass =
    campaign.ctaClassName ??
    "inline-flex items-center justify-center rounded-md bg-off-white px-4 py-2 text-sm font-bold text-ink";

  return (
    <aside
      className={[
        "sponsor-house-card relative overflow-hidden rounded-lg border border-white/15",
        campaign.themeClassName ?? "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={campaign.accessibilityLabel}
      data-placement={placementKey}
      data-campaign={campaign.id}
      data-sponsor-type={campaign.sponsorType}
      data-sponsor-theme={theme}
    >
      {campaign.backgroundImageUrl ? (
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <Image
            src={campaign.backgroundImageUrl}
            alt=""
            fill
            className="sponsor-house-card__bg-image object-cover"
            style={
              {
                "--sponsor-object-pos":
                  campaign.imageObjectPosition ?? "center",
                "--sponsor-object-pos-mobile":
                  campaign.imageObjectPositionMobile ??
                  campaign.imageObjectPosition ??
                  "center",
              } as CSSProperties
            }
            sizes="(max-width: 640px) 100vw, 720px"
            priority={false}
          />
          <div className="sponsor-house-card__overlay absolute inset-0" />
        </div>
      ) : null}

      <div className="relative z-[1] flex min-h-[11.5rem] flex-col gap-4 p-4 sm:min-h-[13.5rem] sm:flex-row sm:items-center sm:gap-5 sm:p-5">
        <div
          className={
            theme === "handicap-hero"
              ? "min-w-0 flex-1 sm:max-w-[62%]"
              : "min-w-0 flex-1 sm:max-w-[58%]"
          }
        >
          <div
            className={
              theme === "handicap-hero" || theme === "team-m8tes"
                ? "mb-3 flex flex-col items-start gap-2 sm:mb-2 sm:flex-row sm:items-center sm:gap-3"
                : "mb-2 flex items-center gap-3"
            }
          >
            {campaign.logoUrl ? (
              <Image
                src={campaign.logoUrl}
                alt={campaign.logoAlt ?? campaign.sponsorName}
                width={theme === "handicap-hero" ? 112 : theme === "team-m8tes" ? 360 : 140}
                height={theme === "handicap-hero" ? 112 : theme === "team-m8tes" ? 108 : 40}
                className={
                  theme === "handicap-hero"
                    ? "h-[4.5rem] w-[4.5rem] object-contain sm:h-24 sm:w-24"
                    : theme === "stadium-slop"
                      ? "h-7 w-auto max-w-[9.5rem] object-contain object-left sm:h-8"
                      : "h-16 w-auto max-w-[min(100%,16rem)] object-contain object-left sm:h-[5.25rem] sm:max-w-[20rem]"
                }
                priority={false}
              />
            ) : null}
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/70">
              {labelText}
            </p>
          </div>

          <h3 className="font-display text-xl font-bold tracking-tight text-white sm:text-2xl">
            {campaign.headline}
          </h3>
          {campaign.subheadline ? (
            <p
              className="mt-1 text-sm font-semibold sm:text-base"
              style={{ color: campaign.accentColor ?? "#fff" }}
            >
              {campaign.subheadline}
            </p>
          ) : null}
          <p className="mt-2 max-w-md text-sm leading-relaxed text-white/90">
            {campaign.body}
          </p>
          <div className="mt-4">
            <SponsorClickLink
              href={trackedHref}
              placementKey={placementKey}
              campaignId={String(campaign.id)}
              trackingSlug={campaign.trackingSlug}
              destinationUrl={campaign.destinationUrl}
              className={`inline-flex items-center justify-center transition-opacity ${ctaClass}`}
            >
              {campaign.ctaLabel}
            </SponsorClickLink>
          </div>
        </div>

        {/* Desktop-only HH wordmark — never used as the upper-left mark */}
        {campaign.imageUrl && theme === "handicap-hero" ? (
          <div className="relative mx-auto hidden h-20 w-56 shrink-0 sm:mx-0 sm:block lg:h-24 lg:w-64">
            <Image
              src={campaign.imageUrl}
              alt=""
              fill
              className="object-contain object-right"
              sizes="(min-width: 1024px) 256px, 224px"
            />
          </div>
        ) : null}
      </div>
    </aside>
  );
}

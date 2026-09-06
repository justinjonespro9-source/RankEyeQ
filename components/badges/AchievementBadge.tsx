import { BrandMark } from "@/components/brand/BrandMark";
import type { EarnedBadge } from "@/lib/badges/types";

/**
 * Achievement badge — BrandMark Q/eye as family anchor (not the status Badge chip).
 */
export function AchievementBadge({
  badge,
  size = "md",
}: {
  badge: EarnedBadge;
  size?: "sm" | "md";
}) {
  const markClass = size === "sm" ? "h-5 w-5" : "h-6 w-6";
  const pad = size === "sm" ? "px-2 py-1.5 gap-1.5" : "px-2.5 py-2 gap-2";

  return (
    <div
      className={`inline-flex max-w-full items-center ${pad} rounded-md border border-accent/30 bg-accent-soft/40 text-ink`}
      title={
        badge.detail
          ? `${badge.definition.description} (${badge.detail})`
          : badge.definition.description
      }
    >
      <span className="shrink-0 text-accent">
        <BrandMark className={markClass} />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-display text-xs font-semibold sm:text-sm">
          {badge.definition.shortLabel}
        </span>
        {badge.detail ? (
          <span className="block truncate text-[10px] text-muted">
            {badge.detail}
          </span>
        ) : null}
      </span>
    </div>
  );
}

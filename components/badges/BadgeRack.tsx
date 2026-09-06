import { AchievementBadge } from "@/components/badges/AchievementBadge";
import type { EarnedBadge } from "@/lib/badges/types";

export function BadgeRack({
  badges,
  title = "Badges",
  emptyLabel,
  size = "md",
}: {
  badges: EarnedBadge[];
  title?: string;
  emptyLabel?: string;
  size?: "sm" | "md";
}) {
  if (badges.length === 0) {
    if (!emptyLabel) return null;
    return (
      <section className="mt-4">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
          {title}
        </h2>
        <p className="mt-2 text-sm text-muted">{emptyLabel}</p>
      </section>
    );
  }

  return (
    <section className="mt-4" aria-label={title}>
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
        {title}
      </h2>
      <ul className="mt-2 flex flex-wrap gap-2">
        {badges.map((badge) => (
          <li key={badge.id}>
            <AchievementBadge badge={badge} size={size} />
          </li>
        ))}
      </ul>
    </section>
  );
}

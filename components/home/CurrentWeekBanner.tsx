import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import type { HomepageWeek } from "@/lib/homepage";

function formatRange(startsAt: Date, endsAt: Date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  });
  return `${fmt.format(startsAt)} – ${fmt.format(endsAt)}`;
}

export function CurrentWeekBanner({ week }: { week: HomepageWeek | null }) {
  if (!week) {
    return (
      <section className="border-b border-border bg-surface py-6">
        <Container>
          <p className="text-sm text-muted">
            No active NFL week configured. Create a season and week in Admin.
          </p>
        </Container>
      </section>
    );
  }

  return (
    <section className="border-b border-border bg-surface py-6">
      <Container className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
            Current week
          </p>
          <p className="mt-1 font-display text-2xl font-semibold text-ink">
            {week.seasonYear} · {week.label}
          </p>
          <p className="mt-1 text-sm text-muted">
            {formatRange(week.startsAt, week.endsAt)} · Rank this week&apos;s slate
            before kickoff
          </p>
        </div>
        <Badge tone={week.status === "OPEN" ? "success" : "neutral"}>
          {week.status}
        </Badge>
      </Container>
    </section>
  );
}

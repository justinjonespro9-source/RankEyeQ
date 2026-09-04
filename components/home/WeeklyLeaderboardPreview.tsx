import { Container } from "@/components/layout/Container";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProfileLink } from "@/components/ui/ProfileLink";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/Button";
import type { LeaderboardRow } from "@/lib/leaderboards";
import { formatRankIqScore } from "@/lib/scoring";

export function WeeklyLeaderboardPreview({
  leaders,
  weekLabel,
}: {
  leaders: LeaderboardRow[];
  weekLabel: string | null;
}) {
  return (
    <section className="py-16 sm:py-20">
      <Container>
        <SectionHeading
          eyebrow="Competitive field"
          title={weekLabel ? `${weekLabel} leaders` : "Weekly leaders"}
          description="Top EYEQ performers from the latest graded NFL week — one weekly contest at a time."
          action={
            <Button href="/leaderboards" variant="secondary" size="sm">
              View all
            </Button>
          }
        />
        {leaders.length === 0 ? (
          <EmptyState
            title="No graded contests yet"
            description="Weekly leaders appear after contests are locked, result-entered, and graded."
            actionHref="/how-it-works"
            actionLabel="How scoring works"
          />
        ) : (
          <ol className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface-elevated">
            {leaders.map((entry) => (
              <li
                key={entry.universalProfileId}
                className="flex items-center justify-between gap-4 px-4 py-3.5 sm:px-5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="font-display w-8 text-lg font-semibold text-ink">
                    {entry.rank}
                  </span>
                  <ProfileLink
                    username={entry.username}
                    displayName={entry.displayName}
                    isAi={entry.profileType === "AI"}
                    isExpert={entry.profileType === "BENCHMARK"}
                    isCreator={entry.profileType === "CREATOR"}
                    expertPublisher={entry.expertPublisher}
                    creatorBrand={entry.creatorBrand}
                  />
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-display text-lg font-semibold tabular-nums text-ink">
                    {formatRankIqScore(entry.averageScore)}
                  </p>
                  <p className="text-xs text-muted">
                    {entry.contestsPlayed} contests
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Container>
    </section>
  );
}

import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import type { HomepageChallengeCard } from "@/lib/homepage";
import { WEEKLY_CONTEST_HELPER } from "@/lib/weekly-messaging";

export function PositionChallenges({
  challenges,
}: {
  challenges: HomepageChallengeCard[];
}) {
  return (
    <section className="py-16 sm:py-20">
      <Container>
        <SectionHeading
          eyebrow="This week"
          title="Weekly position contests"
          description="Rank this week's NFL slate by position before kickoff. Boards reset each week and grade against that week's actual fantasy-point finishes."
        />
        {challenges.length === 0 ? (
          <EmptyState
            title="No active contests"
            description="When an NFL week has RankEyeQ contests, they’ll appear here."
            actionHref="/how-it-works"
            actionLabel="How RankEyeQ works"
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {challenges.map((challenge) => (
              <article
                key={challenge.contestId}
                className="flex flex-col rounded-lg border border-border bg-surface-elevated p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="font-display text-3xl font-semibold text-ink">
                    {challenge.shortLabel}
                  </p>
                  <Badge
                    tone={
                      challenge.contestStatus === "OPEN" ? "success" : "neutral"
                    }
                  >
                    {challenge.contestStatus}
                  </Badge>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  {WEEKLY_CONTEST_HELPER}
                </p>
                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted">Depth</dt>
                    <dd className="font-medium text-ink">
                      Top {challenge.rankingDepth}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted">Submitted</dt>
                    <dd className="font-medium text-ink">
                      {challenge.submittedCount}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted">Lock</dt>
                    <dd className="max-w-[9rem] text-right font-medium text-ink">
                      {challenge.lockLabel}
                    </dd>
                  </div>
                  {challenge.profileSubmissionStatus ? (
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted">Your board</dt>
                      <dd className="font-medium uppercase text-ink">
                        {challenge.profileSubmissionStatus}
                      </dd>
                    </div>
                  ) : null}
                </dl>
                <div className="mt-5">
                  <Button
                    href={challenge.href}
                    className="w-full"
                    variant={
                      challenge.contestStatus === "OPEN" ? "primary" : "secondary"
                    }
                  >
                    {challenge.ctaLabel}
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </Container>
    </section>
  );
}

import Link from "next/link";
import { Container } from "@/components/layout/Container";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProfileLink } from "@/components/ui/ProfileLink";
import { SectionHeading } from "@/components/ui/SectionHeading";
import type { HomepageRecentResult } from "@/lib/homepage";
import { formatRankIqScore } from "@/lib/scoring";

export function RecentResults({
  results,
}: {
  results: HomepageRecentResult[];
}) {
  return (
    <section className="py-16 sm:py-20">
      <Container>
        <SectionHeading
          eyebrow="Finalized"
          title="Recent results"
          description="Latest graded weekly contests — top EYEQ score and actual #1 for that NFL week."
          action={
            <Link
              href="/results"
              className="text-sm font-medium text-accent hover:underline"
            >
              All results
            </Link>
          }
        />
        {results.length === 0 ? (
          <EmptyState
            title="No finalized contests yet"
            description="After grading, recent winners and actual finishes land here."
          />
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {results.map((result) => (
              <li
                key={result.contestId}
                className="rounded-lg border border-border bg-surface-elevated p-5"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-display text-lg font-semibold text-ink">
                    {result.weekLabel} · {result.position}
                  </p>
                  <Link
                    href={result.href}
                    className="text-sm font-medium text-accent hover:underline"
                  >
                    Results
                  </Link>
                </div>
                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Winning EYEQ Score</dt>
                    <dd className="font-semibold tabular-nums text-ink">
                      {result.winningScore == null
                        ? "—"
                        : formatRankIqScore(result.winningScore)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted">Top performer</dt>
                    <dd>
                      {result.topPerformerUsername &&
                      result.topPerformerDisplayName ? (
                        <ProfileLink
                          username={result.topPerformerUsername}
                          displayName={result.topPerformerDisplayName}
                          isAi={result.topPerformerIsAi}
                          showAvatar={false}
                        />
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Actual #1</dt>
                    <dd className="font-medium text-ink">
                      {result.actualNumberOneName ?? "—"}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </Container>
    </section>
  );
}

import Link from "next/link";
import { Container } from "@/components/layout/Container";

export const CLAIMED_EXPERT_RANK_MESSAGE =
  "Your Expert rankings are tracked by RankEyeQ from your published rankings.";

/**
 * Intentional /rank state for a signed-in owner of a BENCHMARK (Expert) profile.
 * Expert boards are captured by RankEyeQ, so the ranking workspace is not shown.
 */
export function ClaimedExpertRankNotice({ username }: { username: string }) {
  return (
    <Container className="py-12 sm:py-16">
      <section className="mx-auto max-w-xl rounded-lg border border-border bg-surface-elevated px-5 py-6 sm:px-7">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-ink">
          Verified Expert
        </p>
        <h1 className="mt-2 font-display text-2xl font-semibold text-ink">
          {CLAIMED_EXPERT_RANK_MESSAGE}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Your RankEyeQ competitive history is sourced from the rankings you
          publish each week, captured before kickoff and graded like every other
          board. You don&apos;t need to re-enter them here.
        </p>
        <div className="mt-5 flex flex-wrap gap-3 text-sm">
          <Link
            href={`/profile/${username}`}
            className="inline-flex min-h-10 items-center rounded-md bg-accent px-4 font-medium text-ink hover:opacity-90"
          >
            View My Profile
          </Link>
          <Link
            href="/account"
            className="inline-flex min-h-10 items-center rounded-md border border-border px-4 font-medium text-ink hover:border-ink/30"
          >
            Edit profile presentation
          </Link>
        </div>
      </section>
    </Container>
  );
}

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { WAIVER_EYEQ_FUTURE_COPY } from "@/lib/waivers/play-model";

export function WaiversDisciplineSwitch() {
  return (
    <nav aria-label="Weekly game" className="inline-flex rounded-md border border-border bg-surface p-0.5 text-sm">
      <Link
        href="/rank"
        className="inline-flex min-h-9 items-center rounded px-3 font-medium text-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Rankings
      </Link>
      <span
        aria-current="page"
        className="inline-flex min-h-9 items-center rounded bg-surface-elevated px-3 font-semibold text-ink shadow-sm"
      >
        Waivers
      </span>
    </nav>
  );
}

export function WaiversHeader({ weekLabel }: { weekLabel: string | null }) {
  return (
    <header className="mb-6 sm:mb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <WaiversDisciplineSwitch />
        {weekLabel ? <Badge tone="neutral">{weekLabel}</Badge> : null}
      </div>
      <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-accent-ink">
        RankEyeQ Waivers · Low-owned discovery
      </p>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        Spot the waiver wire&apos;s best before anyone else
      </h1>
      <p className="mt-2 max-w-2xl text-base text-muted">
        Each week, pick the low-owned players you expect to have the biggest fantasy weeks at each position, ranked
        WIN, PLACE, SHOW. Your locked calls are on-the-record proof of how early you spotted them.
      </p>

      <details className="group mt-4 max-w-2xl rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted">
        <summary className="cursor-pointer list-none font-medium text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          <span aria-hidden="true" className="mr-1 inline-block transition-transform group-open:rotate-90">
            ›
          </span>
          How Waivers works
        </summary>
        <ul className="mt-3 list-disc space-y-1.5 pl-5">
          <li>
            The pool is the official list of players rostered in under 50% of leagues, taken from a snapshot frozen on
            Tuesday. Rostered percentages are the frozen values and don&apos;t change during the week.
          </li>
          <li>
            Make up to 3 calls per position (up to 5 at WR). Partial boards are allowed, and you can sit a position out
            by submitting it with no calls.
          </li>
          <li>
            Boards lock at the posted lock time, normally Tuesday at 7:00 PM CT. You can revise a submitted board
            until then. Unsubmitted drafts
            don&apos;t count.
          </li>
          <li>Everyone&apos;s calls stay hidden until lock. Consensus appears right after.</li>
          <li>{WAIVER_EYEQ_FUTURE_COPY} Results are not graded yet.</li>
        </ul>
      </details>
    </header>
  );
}

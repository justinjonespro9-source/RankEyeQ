import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { CreatorAccountSection } from "@/components/social/CreatorAccountSection";
import { ProfileLink } from "@/components/ui/ProfileLink";
import { requireAuthContext } from "@/lib/auth/session";
import { getCreatorDashboard } from "@/lib/social/creator-dashboard";
import { privatePageMetadata } from "@/lib/seo";

export const metadata: Metadata = privatePageMetadata(
  "Creator dashboard",
  "RankEyeQ creator controls, unlocks, and test ledger placeholder.",
);

export const dynamic = "force-dynamic";

export default async function CreatorDashboardPage() {
  const ctx = await requireAuthContext();
  if (!ctx.universalProfile) {
    redirect("/account/setup");
  }

  const dash = await getCreatorDashboard(ctx.universalProfile.id);
  const enabled = dash.qualification.status === "ENABLED";

  return (
    <Container className="py-12 sm:py-16">
      <SectionHeading
        eyebrow="Creator"
        title="Creator dashboard"
        description="Qualification, reveal preferences, unlocks, and a non-live earnings placeholder. Payments are not enabled."
        action={
          <Link
            href="/account"
            className="text-sm font-medium text-accent hover:underline"
          >
            Account settings
          </Link>
        }
      />

      <div className="mb-6 rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning">
        Payments are not live. Ledger figures are test/admin placeholders only and
        do not represent real earnings.
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Qualification" value={dash.qualification.status.replaceAll("_", " ")} />
        <StatCard
          label="Creator mode"
          value={enabled ? "On" : "Off"}
        />
        <StatCard label="Followers" value={String(dash.followCounts.followers)} />
        <StatCard
          label="Board unlocks"
          value={String(
            dash.currentWeekBoards.reduce((sum, board) => sum + board.unlockCount, 0),
          )}
        />
      </div>

      <CreatorAccountSection
        status={dash.qualification.status}
        eligible={dash.qualification.eligible}
        reasons={dash.qualification.reasons}
        enabled={enabled}
        defaultRevealPreference={dash.qualification.defaultRevealPreference}
        gradedContestCount={dash.qualification.gradedContestCount}
        minGradedContests={dash.qualification.rules.minGradedContests}
        currentWeekBoards={dash.currentWeekBoards}
      />

      <section className="mt-10 rounded-lg border border-border bg-surface-elevated p-5">
        <h2 className="font-display text-xl font-semibold text-ink">
          Current-week boards
        </h2>
        {dash.currentWeekBoards.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No current-week boards"
              description="Submit rankings this week to control Sunday reveal preferences."
              actionHref="/rank"
              actionLabel="Rank now"
            />
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {dash.currentWeekBoards.map((board) => (
              <li
                key={board.contestId}
                className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"
              >
                <span className="text-ink">
                  {board.position} · {board.status}
                </span>
                <span className="flex items-center gap-2 text-muted">
                  <Badge tone="neutral">{board.revealPreference}</Badge>
                  {board.unlockCount} unlocks
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface-elevated p-5">
          <h2 className="font-display text-lg font-semibold text-ink">
            Recent followers
          </h2>
          {dash.recentFollowers.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No followers yet.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {dash.recentFollowers.map((row) => (
                <li key={row.id} className="flex items-center justify-between">
                  <ProfileLink
                    username={row.follower.username}
                    displayName={row.follower.displayName}
                    isAi={row.follower.profileType === "AI"}
                  />
                  <span className="text-xs text-muted">
                    {row.createdAt.toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-border bg-surface-elevated p-5">
          <h2 className="font-display text-lg font-semibold text-ink">
            Unlock activity
          </h2>
          {dash.recentUnlocks.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No unlock events yet.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {dash.recentUnlocks.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-2">
                  <span className="text-ink">
                    @{row.viewer.username} · {row.contest.position}
                  </span>
                  <Badge tone="neutral">{row.accessType}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="mt-8 rounded-lg border border-dashed border-warning/50 bg-warning-soft/40 p-5">
        <h2 className="font-display text-lg font-semibold text-ink">
          Test earnings placeholder
        </h2>
        <p className="mt-1 text-sm text-muted">
          Not live. {dash.ledgerSummary.entryCount} test ledger entries · creator
          amount {dash.ledgerSummary.creatorAmountMinor} minor units · gross{" "}
          {dash.ledgerSummary.grossAmountMinor}.
        </p>
        {dash.ledger.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            No test ledger rows. Admins can create placeholder entries.
          </p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {dash.ledger.map((entry) => (
              <li key={entry.id} className="flex justify-between gap-2">
                <span>
                  {entry.type} · {entry.status}
                </span>
                <span className="tabular-nums text-muted">
                  {entry.creatorAmountMinor} {entry.currency}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Container>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-elevated px-4 py-4">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-display text-xl font-semibold text-ink">{value}</p>
    </div>
  );
}

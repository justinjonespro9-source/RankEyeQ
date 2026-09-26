import type { Metadata } from "next";
import Link from "next/link";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { Container } from "@/components/layout/Container";
import { Button } from "@/components/ui/Button";
import { SectionHeading } from "@/components/ui/SectionHeading";
import {
  approveCreatorVerificationAction,
  rejectCreatorVerificationAction,
} from "@/lib/creator-verification-actions";
import {
  CREATOR_TRACKED_DISCLAIMER,
  CREATOR_VERIFICATION_CRITERIA,
  listCreatorVerificationQueue,
} from "@/lib/creator-verification";
import {
  analyzeProfileClaimCollisions,
  listProfileClaimQueue,
} from "@/lib/profile-claim";
import { formatInChicago } from "@/lib/timing/chicago";

export const metadata: Metadata = {
  title: "Profile claims · Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminCreatorVerificationPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const params = await searchParams;
  const [legacyQueue, claimQueue] = await Promise.all([
    listCreatorVerificationQueue(),
    listProfileClaimQueue(),
  ]);

  const claimRows = await Promise.all(
    claimQueue.map(async (row) => {
      const analysis = await analyzeProfileClaimCollisions({
        claimantProfileId: row.claimantProfileId,
        targetProfileId: row.targetProfileId,
      });
      return { row, analysis };
    }),
  );

  return (
    <Container className="py-12 sm:py-16">
      <AdminBanner />
      <AdminNav current="/admin/creators/verification" />
      <SectionHeading
        eyebrow="Creators / Experts"
        title="Profile claim & verification queue"
        description="Manual review only. Expert claims link ownership onto an existing BENCHMARK UniversalProfile without changing profileType or rewriting historical submissions. Creator in-place promote remains available for new Creator identities."
        action={
          <Link
            href="/admin/creators"
            className="text-sm font-medium text-accent-ink hover:underline"
          >
            Ranking imports
          </Link>
        }
      />

      {params.notice ? (
        <p className="mb-4 rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent-ink">
          {params.notice}
        </p>
      ) : null}
      {params.error ? (
        <p className="mb-4 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning">
          {params.error}
        </p>
      ) : null}

      <details className="mb-6 rounded-md border border-border bg-surface-elevated px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium text-ink">
          Launch verification criteria
        </summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
          {CREATOR_VERIFICATION_CRITERIA.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">{CREATOR_TRACKED_DISCLAIMER}</p>
      </details>

      <h2 className="mb-3 font-display text-xl font-semibold text-ink">
        Ownership claims (Expert / Creator link)
      </h2>
      {claimRows.length === 0 ? (
        <p className="mb-8 rounded-lg border border-border bg-surface-elevated px-4 py-8 text-sm text-muted">
          No ownership claim requests awaiting review.
        </p>
      ) : (
        <ul className="mb-10 space-y-4">
          {claimRows.map(({ row, analysis }) => {
            const target = row.targetProfile;
            const isExpert = target.profileType === "BENCHMARK";
            return (
              <li
                key={row.id}
                className="rounded-lg border border-border bg-surface-elevated p-4 sm:p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-display text-lg font-semibold text-ink">
                      Claim → {target.displayName}
                    </p>
                    <p className="text-sm text-muted">
                      Target @{target.username} · {target.profileType}
                      {row.claimantUser.email
                        ? ` · claimant ${row.claimantUser.email}`
                        : ""}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      Requested{" "}
                      {formatInChicago(row.requestedAt, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <span className="rounded-md border border-border bg-surface px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted">
                    {row.status}
                  </span>
                </div>

                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted">
                      Claimant User
                    </dt>
                    <dd className="mt-1 text-ink">
                      {row.claimantUser.name ?? "—"} · {row.claimantUser.email}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted">
                      Claimant temporary HUMAN
                    </dt>
                    <dd className="mt-1 text-ink">
                      @{row.claimantProfile.username} ·{" "}
                      {row.claimantProfile.displayName}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted">
                      Target type
                    </dt>
                    <dd className="mt-1 text-ink">
                      {isExpert ? "BENCHMARK (Expert)" : "CREATOR"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted">
                      Target historical submissions
                    </dt>
                    <dd className="mt-1 text-ink">
                      {analysis.targetSubmissionCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted">
                      Claimant historical submissions
                    </dt>
                    <dd className="mt-1 text-ink">
                      {analysis.claimantSubmissionCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted">
                      Contest collisions
                    </dt>
                    <dd className="mt-1 text-ink">
                      {analysis.collisions.length === 0
                        ? "None"
                        : `${analysis.collisions.length} overlapping contest(s)`}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted">
                      Site / content URL
                    </dt>
                    <dd className="mt-1 break-all text-ink">
                      {row.creatorSiteUrl ? (
                        <a
                          href={row.creatorSiteUrl}
                          className="text-accent-ink hover:underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {row.creatorSiteUrl}
                        </a>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted">
                      Handle
                    </dt>
                    <dd className="mt-1 text-ink">{row.socialHandle ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted">
                      RankEyeQ proof
                    </dt>
                    <dd className="mt-1 break-all text-ink">
                      {row.publicProofUrl ? (
                        <a
                          href={row.publicProofUrl}
                          className="text-accent-ink hover:underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {row.publicProofUrl}
                        </a>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs uppercase tracking-wide text-muted">
                      Claim note
                    </dt>
                    <dd className="mt-1 text-ink">{row.claimNote ?? "—"}</dd>
                  </div>
                </dl>

                {isExpert ? (
                  <div className="mt-4 rounded-md border border-warning/40 bg-warning-soft/40 px-3 py-2 text-sm text-ink">
                    <p className="font-medium">Expert approval consequences</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
                      <li>
                        profileType remains <strong>BENCHMARK</strong>
                      </li>
                      <li>
                        Target UniversalProfile.id stays{" "}
                        <code className="text-xs">{target.id}</code>
                      </li>
                      <li>
                        Historical RankingSubmissions on the target stay
                        unchanged
                      </li>
                      <li>
                        User.universalProfileId moves to the target; HUMAN shell
                        is retired (not deleted)
                      </li>
                      <li>
                        Leaderboard class remains Expert
                      </li>
                    </ul>
                  </div>
                ) : (
                  <div className="mt-4 rounded-md border border-accent/30 bg-accent-soft/30 px-3 py-2 text-sm text-ink">
                    <p className="font-medium">Creator link approval consequences</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
                      <li>profileType remains CREATOR</li>
                      <li>
                        Target UniversalProfile.id stays{" "}
                        <code className="text-xs">{target.id}</code>
                      </li>
                      <li>
                        Historical RankingSubmissions on the target stay
                        unchanged
                      </li>
                      <li>CreatorCompetitorProfile marked VERIFIED</li>
                    </ul>
                  </div>
                )}

                {analysis.collisions.length > 0 ? (
                  <div className="mt-3 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning">
                    Collisions will be preserved (not merged/deleted). Check
                    acknowledgment below before approving.
                    <ul className="mt-2 list-disc pl-5 text-xs">
                      {analysis.collisions.slice(0, 8).map((c) => (
                        <li key={c.contestId}>
                          Week {c.weekNumber} {c.position}
                        </li>
                      ))}
                      {analysis.collisions.length > 8 ? (
                        <li>+{analysis.collisions.length - 8} more</li>
                      ) : null}
                    </ul>
                  </div>
                ) : null}

                <div className="mt-5 grid gap-4 border-t border-border pt-4 lg:grid-cols-2">
                  <form
                    action={approveCreatorVerificationAction}
                    className="space-y-3 rounded-md border border-border bg-surface p-3"
                  >
                    <input
                      type="hidden"
                      name="profileClaimRequestId"
                      value={row.id}
                    />
                    <input
                      type="hidden"
                      name="requestingProfileId"
                      value={row.claimantProfileId}
                    />
                    <label className="block text-sm">
                      <span className="font-medium text-ink">
                        Admin notes (optional)
                      </span>
                      <textarea
                        name="verificationNotes"
                        rows={2}
                        className="mt-1 w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-ink"
                      />
                    </label>
                    {analysis.collisions.length > 0 ? (
                      <label className="flex items-start gap-2 text-sm text-ink">
                        <input
                          type="checkbox"
                          name="acknowledgeCollisions"
                          value="1"
                          required
                          className="mt-1"
                        />
                        <span>
                          I acknowledge overlapping contests exist. Both
                          histories will be preserved (no silent deletes).
                        </span>
                      </label>
                    ) : null}
                    <Button type="submit" className="min-h-10">
                      Approve ownership link
                    </Button>
                  </form>

                  <form
                    action={rejectCreatorVerificationAction}
                    className="space-y-3 rounded-md border border-border bg-surface p-3"
                  >
                    <input
                      type="hidden"
                      name="profileClaimRequestId"
                      value={row.id}
                    />
                    <input
                      type="hidden"
                      name="requestingProfileId"
                      value={row.claimantProfileId}
                    />
                    <label className="block text-sm">
                      <span className="font-medium text-ink">
                        Rejection notes (optional, internal)
                      </span>
                      <textarea
                        name="verificationNotes"
                        rows={2}
                        className="mt-1 w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-ink"
                      />
                    </label>
                    <Button
                      type="submit"
                      variant="secondary"
                      className="min-h-10"
                    >
                      Reject claim
                    </Button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <h2 className="mb-3 font-display text-xl font-semibold text-ink">
        In-place Creator verification (legacy / new Creator)
      </h2>
      {legacyQueue.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface-elevated px-4 py-8 text-sm text-muted">
          No in-place Creator verification requests awaiting review.
        </p>
      ) : (
        <ul className="space-y-4">
          {legacyQueue.map((row) => {
            const profile = row.universalProfile;
            const target = row.claimTargetProfile;
            return (
              <li
                key={row.id}
                className="rounded-lg border border-border bg-surface-elevated p-4 sm:p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-display text-lg font-semibold text-ink">
                      {profile.displayName}
                    </p>
                    <p className="text-sm text-muted">
                      @{profile.username}
                      {profile.authUser?.email
                        ? ` · ${profile.authUser.email}`
                        : ""}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      Requested{" "}
                      {row.claimRequestedAt
                        ? formatInChicago(row.claimRequestedAt, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })
                        : "—"}
                    </p>
                  </div>
                  <span className="rounded-md border border-border bg-surface px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted">
                    {row.claimStatus}
                  </span>
                </div>

                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted">
                      Creator URL
                    </dt>
                    <dd className="mt-1 break-all text-ink">
                      {row.creatorSiteUrl ? (
                        <a
                          href={row.creatorSiteUrl}
                          className="text-accent-ink hover:underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {row.creatorSiteUrl}
                        </a>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted">
                      Handle
                    </dt>
                    <dd className="mt-1 text-ink">{row.socialHandle ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted">
                      RankEyeQ proof
                    </dt>
                    <dd className="mt-1 break-all text-ink">
                      {row.publicProofUrl ? (
                        <a
                          href={row.publicProofUrl}
                          className="text-accent-ink hover:underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {row.publicProofUrl}
                        </a>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted">
                      Brand
                    </dt>
                    <dd className="mt-1 text-ink">{row.brandName ?? "—"}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs uppercase tracking-wide text-muted">
                      Claim note
                    </dt>
                    <dd className="mt-1 text-ink">{row.claimNote ?? "—"}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs uppercase tracking-wide text-muted">
                      Tracked claim target
                    </dt>
                    <dd className="mt-1 text-ink">
                      {target
                        ? `@${target.username} · ${target.displayName}`
                        : "None (approve in place)"}
                    </dd>
                  </div>
                </dl>

                <div className="mt-5 grid gap-4 border-t border-border pt-4 lg:grid-cols-2">
                  <form
                    action={approveCreatorVerificationAction}
                    className="space-y-3 rounded-md border border-border bg-surface p-3"
                  >
                    <input
                      type="hidden"
                      name="requestingProfileId"
                      value={profile.id}
                    />
                    {target ? (
                      <input
                        type="hidden"
                        name="targetCreatorProfileId"
                        value={target.id}
                      />
                    ) : null}
                    <label className="block text-sm">
                      <span className="font-medium text-ink">
                        Admin notes (optional)
                      </span>
                      <textarea
                        name="verificationNotes"
                        rows={2}
                        className="mt-1 w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-ink"
                      />
                    </label>
                    {!target ? (
                      <label className="block text-sm">
                        <span className="font-medium text-ink">
                          Optional: tracked Creator profile id (link instead)
                        </span>
                        <input
                          name="targetCreatorProfileId"
                          type="text"
                          placeholder="Paste UniversalProfile id to link"
                          className="mt-1 w-full min-h-10 rounded-md border border-border bg-surface-elevated px-3 py-2 text-ink"
                        />
                      </label>
                    ) : null}
                    <Button type="submit" className="min-h-10">
                      {target
                        ? "Approve + link to tracked Creator"
                        : "Approve (promote in place)"}
                    </Button>
                  </form>

                  <form
                    action={rejectCreatorVerificationAction}
                    className="space-y-3 rounded-md border border-border bg-surface p-3"
                  >
                    <input
                      type="hidden"
                      name="requestingProfileId"
                      value={profile.id}
                    />
                    <label className="block text-sm">
                      <span className="font-medium text-ink">
                        Rejection notes (optional, internal)
                      </span>
                      <textarea
                        name="verificationNotes"
                        rows={2}
                        className="mt-1 w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-ink"
                      />
                    </label>
                    <Button
                      type="submit"
                      variant="secondary"
                      className="min-h-10"
                    >
                      Reject (remain PUBLIC)
                    </Button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Container>
  );
}

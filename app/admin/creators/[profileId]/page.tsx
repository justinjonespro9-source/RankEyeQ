import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmSubmit } from "@/components/ui/ConfirmSubmit";
import { SectionHeading } from "@/components/ui/SectionHeading";
import {
  adminRevokeEntitlementAction,
  adminSetCreatorEnabledAction,
} from "@/lib/admin-creator-actions";
import { getAdminCreatorDetail } from "@/lib/social/admin";

export const metadata: Metadata = {
  title: "Creator detail · Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminCreatorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ profileId: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { profileId } = await params;
  const query = await searchParams;
  const detail = await getAdminCreatorDetail(profileId);
  if (!detail) notFound();

  return (
    <Container className="py-12 sm:py-16">
      <AdminBanner />
      <AdminNav current="/admin/creators" />
      <SectionHeading
        eyebrow="Creator"
        title={`@${detail.username}`}
        description={`${detail.displayName} · qualification is derived. Performance stats cannot be edited here.`}
        action={
          <Link
            href="/admin/creators"
            className="text-sm font-medium text-accent hover:underline"
          >
            Back to list
          </Link>
        }
      />

      {query.notice ? (
        <p className="mb-4 rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent">
          {query.notice}
        </p>
      ) : null}
      {query.error ? (
        <p className="mb-4 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning">
          {query.error}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-4">
        <Info label="Status" value={detail.qualificationStatus} />
        <Info label="Graded contests" value={String(detail.gradedContestCount)} />
        <Info label="Followers" value={String(detail.followerCount)} />
        <Info label="Default reveal" value={detail.defaultRevealPreference} />
      </div>

      <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted">
        {detail.reasons.length === 0 ? (
          <li>Eligible under current qualification rules.</li>
        ) : (
          detail.reasons.map((reason) => <li key={reason}>{reason}</li>)
        )}
      </ul>

      <form action={adminSetCreatorEnabledAction} className="mt-6">
        <input type="hidden" name="profileId" value={detail.profileId} />
        <input
          type="hidden"
          name="enabled"
          value={detail.creatorEnabled ? "false" : "true"}
        />
        <Button type="submit" size="sm" variant="secondary">
          {detail.creatorEnabled ? "Disable creator mode" : "Enable creator mode"}
        </Button>
      </form>

      <section className="mt-8 rounded-lg border border-border bg-surface-elevated p-5">
        <h2 className="font-display text-lg font-semibold text-ink">Boards</h2>
        <ul className="mt-3 divide-y divide-border text-sm">
          {detail.boards.map((board) => (
            <li key={board.id} className="flex justify-between gap-2 py-2">
              <span>
                {board.contest.week.label} · {board.contest.position} · {board.status}
              </span>
              <Badge tone="neutral">{board.revealPreference}</Badge>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8 rounded-lg border border-border bg-surface-elevated p-5">
        <h2 className="font-display text-lg font-semibold text-ink">
          Entitlements
        </h2>
        <ul className="mt-3 space-y-2 text-sm">
          {detail.entitlements.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
            >
              <span>
                {row.entitlementType} · viewer @{row.viewer.username}
                {row.revokedAt ? " · revoked" : ""}
              </span>
              {!row.revokedAt ? (
                <ConfirmSubmit
                  action={adminRevokeEntitlementAction}
                  submitLabel="Revoke"
                  impact={`Revoke ${row.entitlementType} for @${row.viewer.username}. They lose matching premium board access immediately.`}
                  confirmPhrase="REVOKE"
                >
                  <input type="hidden" name="entitlementId" value={row.id} />
                  <input type="hidden" name="profileId" value={detail.profileId} />
                </ConfirmSubmit>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8 rounded-lg border border-border bg-surface-elevated p-5">
        <h2 className="font-display text-lg font-semibold text-ink">
          Unlock events
        </h2>
        <ul className="mt-3 space-y-2 text-sm">
          {detail.unlocks.map((row) => (
            <li key={row.id} className="flex justify-between gap-2">
              <span>
                @{row.viewer.username} · {row.contest.position}
              </span>
              <Badge tone="neutral">{row.accessType}</Badge>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8 rounded-lg border border-dashed border-warning/50 bg-warning-soft/30 p-5">
        <h2 className="font-display text-lg font-semibold text-ink">
          Test ledger
        </h2>
        <ul className="mt-3 space-y-2 text-sm">
          {detail.ledger.map((row) => (
            <li key={row.id} className="flex justify-between gap-2">
              <span>
                {row.type} · {row.status}
              </span>
              <span className="tabular-nums">
                {row.creatorAmountMinor} {row.currency}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </Container>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-elevated px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-medium text-ink">{value}</p>
    </div>
  );
}

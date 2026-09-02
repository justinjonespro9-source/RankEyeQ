import type { Metadata } from "next";
import Link from "next/link";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { Container } from "@/components/layout/Container";
import { Button } from "@/components/ui/Button";
import { ConfirmSubmit } from "@/components/ui/ConfirmSubmit";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Badge } from "@/components/ui/Badge";
import {
  adminCreateTestLedgerEntryAction,
  adminGrantEntitlementAction,
} from "@/lib/admin-creator-actions";
import { listAdminCreators } from "@/lib/social/admin";

export const metadata: Metadata = {
  title: "Creators · Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminCreatorsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    type?: string;
    notice?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const status = (
    ["ALL", "NOT_ELIGIBLE", "ELIGIBLE", "ENABLED"].includes(params.status ?? "")
      ? params.status
      : "ALL"
  ) as "ALL" | "NOT_ELIGIBLE" | "ELIGIBLE" | "ENABLED";
  const profileType = (
    ["ALL", "HUMAN", "AI"].includes(params.type ?? "") ? params.type : "ALL"
  ) as "ALL" | "HUMAN" | "AI";

  const rows = await listAdminCreators({
    query: params.q,
    status,
    profileType,
  });

  return (
    <Container className="py-12 sm:py-16">
      <AdminBanner />
      <AdminNav current="/admin/creators" />
      <SectionHeading
        eyebrow="Social"
        title="Creator & entitlements"
        description="Qualification is derived from sample size and standing. Admins cannot fabricate performance stats. Payments are not live."
      />

      {params.notice ? (
        <p className="mb-4 rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent">
          {params.notice}
        </p>
      ) : null}
      {params.error ? (
        <p className="mb-4 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning">
          {params.error}
        </p>
      ) : null}

      <form
        action="/admin/creators"
        method="get"
        className="mb-6 grid gap-2 rounded-lg border border-border bg-surface-elevated p-4 sm:grid-cols-4"
      >
        <input
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="Search username"
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
        />
        <select
          name="status"
          defaultValue={status}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
        >
          <option value="ALL">All qualification</option>
          <option value="NOT_ELIGIBLE">Not eligible</option>
          <option value="ELIGIBLE">Eligible</option>
          <option value="ENABLED">Enabled</option>
        </select>
        <select
          name="type"
          defaultValue={profileType}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
        >
          <option value="ALL">All types</option>
          <option value="HUMAN">Humans</option>
          <option value="AI">AI</option>
        </select>
        <Button type="submit" size="sm">
          Filter
        </Button>
      </form>

      <div className="table-scroll overflow-x-auto rounded-lg border border-border bg-surface-elevated">
        <table className="w-full min-w-[52rem] text-left text-sm">
          <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2">Profile</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Graded</th>
              <th className="px-3 py-2">Followers</th>
              <th className="px-3 py-2">Qualification</th>
              <th className="px-3 py-2">Reveal</th>
              <th className="px-3 py-2">Why</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.profileId} className="border-b border-border last:border-0">
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/creators/${row.profileId}`}
                    className="font-medium text-accent hover:underline"
                  >
                    @{row.username}
                  </Link>
                  <p className="text-xs text-muted">{row.displayName}</p>
                </td>
                <td className="px-3 py-2">
                  <Badge tone={row.profileType === "AI" ? "warning" : "success"}>
                    {row.profileType}
                  </Badge>
                </td>
                <td className="px-3 py-2 tabular-nums">{row.gradedContestCount}</td>
                <td className="px-3 py-2 tabular-nums">{row.followerCount}</td>
                <td className="px-3 py-2">
                  <Badge
                    tone={
                      row.qualificationStatus === "ENABLED"
                        ? "success"
                        : row.qualificationStatus === "ELIGIBLE"
                          ? "neutral"
                          : "warning"
                    }
                  >
                    {row.qualificationStatus}
                  </Badge>
                  {row.creatorEnabled ? (
                    <span className="ml-1 text-xs text-muted">opt-in</span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-xs">{row.defaultRevealPreference}</td>
                <td className="px-3 py-2 text-xs text-muted">
                  {row.reasons[0] ?? "Eligible"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <ConfirmSubmit
          action={adminGrantEntitlementAction}
          submitLabel="Grant entitlement"
          impact="Grant a test board entitlement. No payment is charged. Viewer is resolved from username."
          confirmPhrase="GRANT"
        >
        <div className="space-y-3 rounded-lg border border-border bg-surface-elevated p-5">
          <h2 className="font-display text-lg font-semibold text-ink">
            Grant test entitlement
          </h2>
          <p className="text-xs text-muted">
            Admin/dev only. No payment checkout. Viewer is resolved from username.
          </p>
          <label className="block text-sm">
            Viewer username
            <input
              name="viewer"
              required
              className="mt-1 w-full rounded-md border border-border px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            Type
            <select
              name="entitlementType"
              className="mt-1 w-full rounded-md border border-border px-3 py-2"
              defaultValue="SINGLE_BOARD"
            >
              <option value="SINGLE_BOARD">SINGLE_BOARD</option>
              <option value="CREATOR_WEEK">CREATOR_WEEK</option>
              <option value="POSITION_WEEK">POSITION_WEEK</option>
              <option value="WEEK_ALL_ACCESS">WEEK_ALL_ACCESS</option>
              <option value="SUBSCRIPTION">SUBSCRIPTION</option>
            </select>
          </label>
          <label className="block text-sm">
            Creator username (optional)
            <input name="creator" className="mt-1 w-full rounded-md border border-border px-3 py-2" />
          </label>
          <label className="block text-sm">
            Contest ID (optional)
            <input name="contestId" className="mt-1 w-full rounded-md border border-border px-3 py-2" />
          </label>
          <label className="block text-sm">
            Week ID (optional)
            <input name="weekId" className="mt-1 w-full rounded-md border border-border px-3 py-2" />
          </label>
          <label className="block text-sm">
            Source
            <input
              name="source"
              defaultValue="admin"
              className="mt-1 w-full rounded-md border border-border px-3 py-2"
            />
          </label>
        </div>
        </ConfirmSubmit>

        <form
          action={adminCreateTestLedgerEntryAction}
          className="space-y-3 rounded-lg border border-dashed border-warning/50 bg-warning-soft/30 p-5"
        >
          <h2 className="font-display text-lg font-semibold text-ink">
            Test ledger entry
          </h2>
          <p className="text-xs text-muted">
            Placeholder only. Amounts may be zero. No real money movement.
          </p>
          <label className="block text-sm">
            Creator username
            <input
              name="creator"
              required
              className="mt-1 w-full rounded-md border border-border px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            Viewer username (optional)
            <input name="viewer" className="mt-1 w-full rounded-md border border-border px-3 py-2" />
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="block text-sm">
              Gross
              <input
                name="grossAmountMinor"
                type="number"
                defaultValue={0}
                className="mt-1 w-full rounded-md border border-border px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              Fee
              <input
                name="platformFeeMinor"
                type="number"
                defaultValue={0}
                className="mt-1 w-full rounded-md border border-border px-3 py-2"
              />
            </label>
            <label className="block text-sm">
              Creator
              <input
                name="creatorAmountMinor"
                type="number"
                defaultValue={0}
                className="mt-1 w-full rounded-md border border-border px-3 py-2"
              />
            </label>
          </div>
          <Button type="submit" size="sm" variant="secondary">
            Create test ledger row
          </Button>
        </form>
      </section>
    </Container>
  );
}

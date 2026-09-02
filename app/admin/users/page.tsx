import type { Metadata } from "next";
import Link from "next/link";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { StatusPill } from "@/components/admin/StatusPill";
import { Container } from "@/components/layout/Container";
import { Button } from "@/components/ui/Button";
import { ConfirmSubmit } from "@/components/ui/ConfirmSubmit";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { searchAdminUsers } from "@/lib/admin/users";
import {
  changeUserRoleAction,
  createAiProfileAction,
  setProfileStatusAction,
  updateAdminProfileAction,
} from "@/lib/admin-command-actions";
import type { ProfileStatus, ProfileType, UserRole } from "@/lib/generated/prisma/client";

export const metadata: Metadata = {
  title: "Users · Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    type?: string;
    role?: string;
    status?: string;
    notice?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const query = params.q ?? "";
  const profileType = (["HUMAN", "AI", "BENCHMARK"].includes(params.type ?? "")
    ? params.type
    : "ALL") as ProfileType | "ALL";
  const role = (["USER", "ADMIN"].includes(params.role ?? "")
    ? params.role
    : "ALL") as UserRole | "ALL";
  const status = (["ACTIVE", "SUSPENDED"].includes(params.status ?? "")
    ? params.status
    : "ALL") as ProfileStatus | "ALL";

  const rows = await searchAdminUsers({
    query,
    profileType,
    role,
    status,
  });

  return (
    <Container className="py-12 sm:py-16">
      <AdminBanner />
      <AdminNav current="/admin/users" />
      <SectionHeading
        eyebrow="Accounts"
        title="User management"
        description="Search humans, AI, and expert/benchmark UniversalProfiles. Suspension blocks future submissions and keeps historical rankings."
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
        action="/admin/users"
        method="get"
        className="mb-6 grid gap-2 rounded-lg border border-border bg-surface-elevated p-4 sm:grid-cols-4"
      >
        <input
          name="q"
          defaultValue={query}
          placeholder="Search username, name, email"
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm sm:col-span-2"
        />
        <select
          name="type"
          defaultValue={profileType}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
        >
          <option value="ALL">All types</option>
          <option value="HUMAN">HUMAN</option>
          <option value="AI">AI</option>
          <option value="BENCHMARK">BENCHMARK</option>
        </select>
        <select
          name="role"
          defaultValue={role}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
        >
          <option value="ALL">All roles</option>
          <option value="USER">USER</option>
          <option value="ADMIN">ADMIN</option>
        </select>
        <select
          name="status"
          defaultValue={status}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
        >
          <option value="ALL">All statuses</option>
          <option value="ACTIVE">ACTIVE</option>
          <option value="SUSPENDED">SUSPENDED</option>
        </select>
        <Button type="submit" size="sm">
          Filter
        </Button>
      </form>

      <form
        action={createAiProfileAction}
        className="mb-8 grid gap-2 rounded-lg border border-border bg-surface-elevated p-4 sm:grid-cols-4"
      >
        <h2 className="font-display text-lg font-semibold text-ink sm:col-span-4">
          Create AI UniversalProfile
        </h2>
        <input
          name="username"
          required
          placeholder="username"
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
        />
        <input
          name="displayName"
          required
          placeholder="Display name"
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
        />
        <input
          name="avatarUrl"
          placeholder="Avatar URL"
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
        />
        <Button type="submit" size="sm">
          Create AI profile
        </Button>
      </form>

      <div className="space-y-4">
        {rows.map((row) => (
          <article
            key={row.profileId}
            className="rounded-lg border border-border bg-surface-elevated p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-display text-lg font-semibold text-ink">
                  {row.displayName}{" "}
                  <span className="text-sm font-normal text-muted">
                    @{row.username}
                  </span>
                </p>
                <p className="text-xs text-muted">
                  {row.email ?? "No auth email"} · contests {row.contestCount} ·
                  created {row.createdAt.toLocaleDateString()}
                  {row.accountCreatedAt
                    ? ` · account ${row.accountCreatedAt.toLocaleDateString()}`
                    : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusPill status={row.profileType} />
                <StatusPill status={row.status} />
                {row.role ? <StatusPill status={row.role} /> : null}
                <Link
                  href={`/profile/${row.username}`}
                  className="text-sm font-medium text-accent hover:underline"
                >
                  Public profile
                </Link>
              </div>
            </div>

            <form
              action={updateAdminProfileAction}
              className="mt-3 grid gap-2 sm:grid-cols-4"
            >
              <input type="hidden" name="profileId" value={row.profileId} />
              <input
                name="username"
                defaultValue={row.username}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
              />
              <input
                name="displayName"
                defaultValue={row.displayName}
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
              />
              <input
                name="avatarUrl"
                defaultValue={row.avatarUrl ?? ""}
                placeholder="Avatar URL"
                className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
              />
              <Button type="submit" size="sm" variant="secondary">
                Save profile
              </Button>
            </form>

            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {row.userId ? (
                <ConfirmSubmit
                  action={changeUserRoleAction}
                  submitLabel={`Make ${row.role === "ADMIN" ? "USER" : "ADMIN"}`}
                  impact={`Change @${row.username} from ${row.role ?? "USER"} to ${row.role === "ADMIN" ? "USER" : "ADMIN"}. Admin access is server-enforced.`}
                  confirmPhrase={row.role === "ADMIN" ? "USER" : "ADMIN"}
                >
                  <input type="hidden" name="userId" value={row.userId} />
                  <input
                    type="hidden"
                    name="role"
                    value={row.role === "ADMIN" ? "USER" : "ADMIN"}
                  />
                </ConfirmSubmit>
              ) : null}
              <ConfirmSubmit
                action={setProfileStatusAction}
                submitLabel={row.status === "SUSPENDED" ? "Reactivate" : "Suspend"}
                impact={
                  row.status === "SUSPENDED"
                    ? `Reactivate @${row.username}. Historical rankings stay; they may submit and gain followers again.`
                    : `Suspend @${row.username}. Blocks new submissions and new followers. Historical rankings and follows are kept.`
                }
                confirmPhrase={row.status === "SUSPENDED" ? "REACTIVATE" : "SUSPEND"}
              >
                <input type="hidden" name="profileId" value={row.profileId} />
                <input
                  type="hidden"
                  name="status"
                  value={row.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED"}
                />
              </ConfirmSubmit>
            </div>
          </article>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No profiles match those filters.</p>
      ) : null}
    </Container>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { Container } from "@/components/layout/Container";
import { Button } from "@/components/ui/Button";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { createCompetitorAction } from "@/lib/admin-competitor-actions";

export const metadata: Metadata = {
  title: "Add competitor · Admin",
  description: "Create AI, Creator, or Expert competition identities.",
};

export const dynamic = "force-dynamic";

const TYPES = [
  {
    id: "ai" as const,
    label: "AI",
    href: "/admin/competitors/new?type=ai",
    blurb: "Manual AI competition identity — no API credentials required.",
  },
  {
    id: "creator" as const,
    label: "Creator",
    href: "/admin/competitors/new?type=creator",
    blurb: "Tracked Creator identity (UNCLAIMED). Not verified by default.",
  },
  {
    id: "expert" as const,
    label: "Expert",
    href: "/admin/competitors/new?type=expert",
    blurb: "Individual analyst Expert (BENCHMARK · ANALYST). Not a publisher shell.",
  },
];

const POSITIONS = ["QB", "RB", "WR", "TE", "DEF"] as const;

export default async function AdminCreateCompetitorPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : {};
  const typeParam = typeof params.type === "string" ? params.type.toLowerCase() : "ai";
  const type = (["ai", "creator", "expert"].includes(typeParam)
    ? typeParam
    : "ai") as "ai" | "creator" | "expert";
  const error = typeof params.error === "string" ? params.error : null;
  const meta = TYPES.find((item) => item.id === type)!;

  return (
    <Container className="py-10 sm:py-12">
      <AdminBanner />
      <AdminNav current="/admin/competitors/new" />
      <SectionHeading
        eyebrow="Competitors"
        title="Add competitor"
        description="Create AI, Creator, or Expert identities for RankEyeQ competition. Historical submissions stay attached to UniversalProfile — prefer deactivate over delete."
      />

      <div className="mb-6 flex flex-wrap gap-2">
        {TYPES.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              item.id === type
                ? "bg-accent text-ink"
                : "border border-border bg-surface-elevated text-ink"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {error ? (
        <p className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          {error}
        </p>
      ) : null}

      <section className="rounded-lg border border-border bg-surface-elevated p-5">
        <h2 className="font-display text-lg font-semibold text-ink">
          New {meta.label} competitor
        </h2>
        <p className="mt-1 text-sm text-muted">{meta.blurb}</p>

        <form action={createCompetitorAction} className="mt-4 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="type" value={type} />

          <label className="block text-sm sm:col-span-2">
            <span className="text-muted">
              {type === "ai"
                ? "Public display name / model label"
                : type === "creator"
                  ? "Display name (person)"
                  : "Analyst name"}
            </span>
            <input
              name="displayName"
              required
              placeholder={
                type === "ai"
                  ? "Claude"
                  : type === "creator"
                    ? "Tyler Cohen"
                    : "Justin Boone"
              }
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
            />
          </label>

          <label className="block text-sm">
            <span className="text-muted">Username / public slug</span>
            <input
              name="username"
              required={type === "ai"}
              placeholder={
                type === "ai" ? "claude_opus" : type === "creator" ? "tyler_cohen" : "justin_boone"
              }
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
            />
          </label>

          <label className="block text-sm">
            <span className="text-muted">Avatar URL (optional)</span>
            <input
              name="avatarUrl"
              type="url"
              placeholder="https://…"
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
            />
          </label>

          {type === "creator" ? (
            <>
              <label className="block text-sm">
                <span className="text-muted">Brand / channel / publication</span>
                <input
                  name="brandName"
                  required
                  placeholder="TCO Fantasy Show"
                  className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
                />
              </label>
              <label className="block text-sm">
                <span className="text-muted">Creator site URL</span>
                <input
                  name="creatorSiteUrl"
                  type="url"
                  placeholder="https://…"
                  className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
                />
              </label>
              <label className="block text-sm">
                <span className="text-muted">Primary social URL</span>
                <input
                  name="socialUrl"
                  type="url"
                  placeholder="https://…"
                  className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
                />
              </label>
              <label className="block text-sm">
                <span className="text-muted">Social handle</span>
                <input
                  name="socialHandle"
                  placeholder="@handle"
                  className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
                />
              </label>
            </>
          ) : null}

          {type === "expert" ? (
            <label className="block text-sm sm:col-span-2">
              <span className="text-muted">Publication / affiliation</span>
              <input
                name="publicationName"
                required
                placeholder="Yahoo Fantasy"
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
              />
            </label>
          ) : null}

          {type === "expert" || type === "creator" ? (
            <label className="block text-sm sm:col-span-2">
              <span className="text-muted">Source URL (optional)</span>
              <input
                name="sourceUrl"
                type="url"
                placeholder="https://…"
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
              />
            </label>
          ) : null}

          {type === "ai" ? (
            <label className="block text-sm sm:col-span-2">
              <span className="text-muted">Model / version notes (optional bio)</span>
              <input
                name="bio"
                placeholder="Anthropic Claude 4 · manual weekly boards"
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
              />
            </label>
          ) : (
            <label className="block text-sm sm:col-span-2">
              <span className="text-muted">Bio / notes (optional)</span>
              <input
                name="bio"
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
              />
            </label>
          )}

          {type === "expert" || type === "creator" ? (
            <fieldset className="sm:col-span-2">
              <legend className="text-sm text-muted">Positions covered</legend>
              <div className="mt-2 flex flex-wrap gap-3">
                {POSITIONS.map((position) => (
                  <label
                    key={position}
                    className="flex items-center gap-1.5 text-sm text-ink"
                  >
                    <input
                      type="checkbox"
                      name="positions"
                      value={position}
                      defaultChecked
                    />
                    {position}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="hidden" name="competitorActive" value="false" />
            <input
              type="checkbox"
              name="competitorActive"
              value="true"
              defaultChecked
            />
            Competitor active (include in weekly coverage)
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="hidden" name="publicVisible" value="false" />
            <input
              type="checkbox"
              name="publicVisible"
              value="true"
              defaultChecked
            />
            Public profile visible
          </label>
          <label className="flex items-center gap-2 text-sm text-ink sm:col-span-2">
            <input type="checkbox" name="acknowledgeDuplicate" value="true" />
            Acknowledge existing name if a similar competitor already exists
          </label>

          {type === "creator" ? (
            <p className="sm:col-span-2 text-xs text-muted">
              Creates ProfileType.CREATOR with claimStatus=UNCLAIMED. Tracking ≠
              verified. Use Creator Verify to approve claims later.
            </p>
          ) : null}
          {type === "expert" ? (
            <p className="sm:col-span-2 text-xs text-muted">
              Creates ProfileType.BENCHMARK with sourceKind=ANALYST. Publisher
              shells stay separate and inactive as competitors.
            </p>
          ) : null}

          <div className="sm:col-span-2 flex flex-wrap gap-3">
            <Button type="submit">Create {meta.label} competitor</Button>
            <Link
              href={
                type === "ai"
                  ? "/admin/ai"
                  : type === "creator"
                    ? "/admin/creators"
                    : "/admin/experts"
              }
              className="inline-flex min-h-10 items-center text-sm text-muted hover:text-ink"
            >
              Cancel
            </Link>
          </div>
        </form>
      </section>
    </Container>
  );
}

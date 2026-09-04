import type { Metadata } from "next";
import Link from "next/link";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SectionHeading } from "@/components/ui/SectionHeading";
import {
  createExpertAnalystAction,
  setExpertActiveAction,
  updateExpertMetadataAction,
} from "@/lib/admin-expert-actions";
import { listExpertIdentities } from "@/lib/expert-identity";

export const metadata: Metadata = {
  title: "Expert sources",
  description: "Individual Expert analysts and publisher affiliations for RankEyeQ.",
};

export const dynamic = "force-dynamic";

const POSITIONS = ["QB", "RB", "WR", "TE", "DEF"] as const;

export default async function AdminExpertsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : {};
  const error =
    typeof params.error === "string" ? params.error : null;
  const created = params.created === "1";
  const updated = params.updated === "1";
  const experts = await listExpertIdentities();
  const analysts = experts.filter((expert) => expert.sourceKind === "ANALYST");
  const publishers = experts.filter((expert) => expert.sourceKind !== "ANALYST");

  return (
    <Container className="py-10 sm:py-12">
      <AdminBanner />
      <AdminNav current="/admin/experts" />
      <SectionHeading
        eyebrow="Expert identities"
        title="Experts"
        description="Competing Experts are individual analysts. Publishers (Yahoo, ESPN, CBS, …) are affiliations. Do not import a publisher ballot when an attributable analyst board exists. Week-specific imports stay on Benchmarks."
      />

      {error ? (
        <p className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          {error}
        </p>
      ) : null}
      {created ? (
        <p className="mb-4 rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent">
          Expert analyst created. Activate them in the table if needed, then import Week rankings from Benchmarks.
        </p>
      ) : null}
      {updated ? (
        <p className="mb-4 rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent">
          Expert updated.
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-4 text-sm">
        <Link
          href="/admin/benchmarks"
          className="font-medium text-accent hover:underline"
        >
          Open weekly expert import grid →
        </Link>
        <span className="text-muted">
          {analysts.filter((row) => row.competitorActive).length} active analysts ·{" "}
          {publishers.length} publisher shells (inactive competitors)
        </span>
      </div>

      <section className="mb-10 rounded-lg border border-border bg-surface-elevated p-5">
        <h2 className="font-display text-lg font-semibold text-ink">
          Add Expert analyst
        </h2>
        <p className="mt-1 text-sm text-muted">
          Creates a BENCHMARK identity with sourceKind=ANALYST. Publisher shells
          remain for history/affiliation only — do not submit weekly rankings to
          them when an analyst exists.
        </p>
        <form action={createExpertAnalystAction} className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="text-muted">Expert name (analyst)</span>
            <input
              name="analystName"
              required
              placeholder="Justin Boone"
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Publisher</span>
            <input
              name="publicationName"
              required
              placeholder="Yahoo Fantasy"
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Username (optional)</span>
            <input
              name="username"
              placeholder="justin_boone"
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted">Source URL (optional)</span>
            <input
              name="sourceUrl"
              type="url"
              placeholder="https://…"
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-ink"
            />
          </label>
          <fieldset className="sm:col-span-2">
            <legend className="text-sm text-muted">Positions supported</legend>
            <div className="mt-2 flex flex-wrap gap-3">
              {POSITIONS.map((position) => (
                <label key={position} className="flex items-center gap-1.5 text-sm text-ink">
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
          <label className="flex items-center gap-2 text-sm text-ink sm:col-span-2">
            <input type="checkbox" name="competitorActive" value="true" defaultChecked />
            Activate for weekly coverage immediately
          </label>
          <div className="sm:col-span-2">
            <Button type="submit">Create Expert</Button>
          </div>
        </form>
      </section>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface-elevated">
        <table className="w-full min-w-[64rem] text-left text-sm">
          <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-3">Expert</th>
              <th className="px-3 py-3">Publisher</th>
              <th className="px-3 py-3">Kind</th>
              <th className="px-3 py-3">Positions</th>
              <th className="px-3 py-3">Directory</th>
              <th className="px-3 py-3">Graded</th>
              <th className="px-3 py-3">Week import</th>
              <th className="px-3 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {experts.map((expert) => (
              <tr
                key={expert.universalProfileId}
                className="border-b border-border align-top last:border-0"
              >
                <td className="px-3 py-3">
                  <p className="font-medium text-ink">{expert.primaryName}</p>
                  <Link
                    href={`/profile/${expert.username}`}
                    className="text-xs text-accent hover:underline"
                  >
                    @{expert.username}
                  </Link>
                  {expert.sourceUrl ? (
                    <p className="mt-1 max-w-[14rem] truncate text-xs text-muted">
                      <a
                        href={expert.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:underline"
                      >
                        {expert.sourceUrl}
                      </a>
                    </p>
                  ) : null}
                </td>
                <td className="px-3 py-3 text-ink">
                  {expert.publicationName ?? "—"}
                </td>
                <td className="px-3 py-3 text-ink">{expert.sourceKind}</td>
                <td className="px-3 py-3 text-ink">
                  {expert.positionsCovered.length > 0
                    ? expert.positionsCovered.join(", ")
                    : "All"}
                </td>
                <td className="px-3 py-3">
                  <Badge
                    tone={
                      expert.active && expert.competitorActive
                        ? "success"
                        : "warning"
                    }
                  >
                    {expert.active && expert.competitorActive
                      ? "Active"
                      : "Inactive"}
                  </Badge>
                  {expert.isOfficialSource ? (
                    <Badge tone="neutral" className="ml-1">
                      Publisher shell
                    </Badge>
                  ) : null}
                </td>
                <td className="px-3 py-3 tabular-nums text-ink">
                  {expert.gradedSubmissions}
                </td>
                <td className="px-3 py-3">
                  <Link
                    href={`/admin/benchmarks?profileId=${expert.universalProfileId}`}
                    className="text-accent hover:underline"
                  >
                    Import status →
                  </Link>
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-col gap-2">
                    <form action={setExpertActiveAction}>
                      <input
                        type="hidden"
                        name="universalProfileId"
                        value={expert.universalProfileId}
                      />
                      <input
                        type="hidden"
                        name="active"
                        value={expert.competitorActive ? "false" : "true"}
                      />
                      <Button type="submit" variant="secondary" className="text-xs">
                        {expert.competitorActive ? "Deactivate" : "Activate"}
                      </Button>
                    </form>
                    {expert.sourceKind === "ANALYST" ? (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted hover:text-ink">
                          Edit metadata
                        </summary>
                        <form
                          action={updateExpertMetadataAction}
                          className="mt-2 grid gap-2 rounded-md border border-border bg-surface p-2"
                        >
                          <input
                            type="hidden"
                            name="universalProfileId"
                            value={expert.universalProfileId}
                          />
                          <input
                            name="analystName"
                            defaultValue={expert.analystName ?? expert.displayName}
                            className="rounded border border-border bg-surface-elevated px-2 py-1"
                            placeholder="Analyst"
                          />
                          <input
                            name="publicationName"
                            defaultValue={expert.publicationName ?? ""}
                            className="rounded border border-border bg-surface-elevated px-2 py-1"
                            placeholder="Publisher"
                          />
                          <input
                            name="sourceUrl"
                            defaultValue={expert.sourceUrl ?? ""}
                            className="rounded border border-border bg-surface-elevated px-2 py-1"
                            placeholder="URL"
                          />
                          <div className="flex flex-wrap gap-2">
                            {POSITIONS.map((position) => (
                              <label key={position} className="flex items-center gap-1">
                                <input
                                  type="checkbox"
                                  name="positions"
                                  value={position}
                                  defaultChecked={
                                    expert.positionsCovered.length === 0 ||
                                    expert.positionsCovered.includes(position)
                                  }
                                />
                                {position}
                              </label>
                            ))}
                          </div>
                          <Button type="submit" className="text-xs">
                            Save
                          </Button>
                        </form>
                      </details>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Container>
  );
}

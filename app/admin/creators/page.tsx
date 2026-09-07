import type { Metadata } from "next";
import Link from "next/link";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SectionHeading } from "@/components/ui/SectionHeading";
import {
  setCompetitorActiveAction,
  updateCompetitorMetadataAction,
} from "@/lib/admin-competitor-actions";
import {
  getCreatorRankingCoverage,
  type CreatorImportCellStatus,
} from "@/lib/creators/coverage";
import { listCreatorCompetitorIdentities } from "@/lib/creator-identity";
import { prisma } from "@/lib/db";
import { CONTEST_POSITIONS } from "@/lib/contest-defaults";

export const metadata: Metadata = {
  title: "Creator rankings · Admin",
};

export const dynamic = "force-dynamic";

function statusClass(status: CreatorImportCellStatus) {
  if (status === "Submitted") return "bg-success-soft text-success";
  if (status === "Draft") return "bg-accent-soft text-ink";
  if (status === "Error") return "bg-danger-soft text-danger";
  return "bg-surface text-muted border border-border";
}

export default async function AdminCreatorRankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ weekId?: string; created?: string; username?: string }>;
}) {
  const params = await searchParams;
  const weeks = await prisma.week.findMany({
    where: { season: { active: true } },
    orderBy: { weekNumber: "asc" },
    include: { contests: true },
  });
  const weekId =
    params.weekId ??
    weeks.find((week) => week.status === "OPEN")?.id ??
    weeks[0]?.id ??
    null;
  const week = weeks.find((item) => item.id === weekId) ?? null;
  const coverage = weekId ? await getCreatorRankingCoverage(weekId) : null;
  const contestByPosition = new Map(
    (week?.contests ?? []).map((contest) => [contest.position, contest.id]),
  );

  return (
    <Container className="py-12 sm:py-16">
      <AdminBanner />
      <AdminNav current="/admin/creators" />
      <SectionHeading
        eyebrow="Tracked creators"
        title="Creator ranking imports"
        description="Import clearly public, attributable weekly rankings for CREATOR competitors. Same scoring path as Humans, Experts, and AI via BenchmarkSnapshot + RankingSubmission. Not a partnership or endorsement."
        action={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              href="/admin/competitors/new?type=creator"
              className="inline-flex min-h-10 items-center rounded-md bg-accent px-3 py-2 text-sm font-medium text-ink"
            >
              Add Creator
            </Link>
            <Link
              href="/admin/creators/entitlements"
              className="text-sm font-medium text-accent-ink hover:underline"
            >
              Monetization entitlements
            </Link>
            <Link
              href="/admin/creators/verification"
              className="text-sm font-medium text-accent-ink hover:underline"
            >
              Verification queue
            </Link>
          </span>
        }
      />

      {params.created === "1" ? (
        <p className="mb-4 rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-accent-ink">
          Creator competitor created
          {params.username ? ` (@${params.username})` : ""} as UNCLAIMED tracked
          identity — not verified.
        </p>
      ) : null}
      <div className="mb-4 flex flex-wrap gap-2">
        {weeks.map((item) => (
          <Link
            key={item.id}
            href={`/admin/creators?weekId=${item.id}`}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              item.id === weekId
                ? "bg-accent text-ink"
                : "border border-border bg-surface-elevated text-ink"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {!coverage || !week ? (
        <p className="text-sm text-muted">Select a week with contests.</p>
      ) : (
        <>
          <dl className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Active creators", String(coverage.activeCreators)],
              [
                "Imported this week",
                `${coverage.importedBoards} / ${coverage.expectedBoards}`,
              ],
              ["Submitted", String(coverage.submittedBoards)],
              ["Missing positions", String(coverage.missingBoards)],
              ["Missing source links", String(coverage.missingSourceLinks)],
              ["Errors / late", String(coverage.errorBoards)],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-md border border-border bg-surface-elevated px-3 py-2"
              >
                <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  {label}
                </dt>
                <dd className="mt-0.5 font-display text-lg font-semibold text-ink">
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          <p className="mb-3 text-xs text-muted">
            Matrix statuses: Not imported · Draft (Thursday) · Submitted
            (Sunday/locked) · Error (late capture). Preserve week while clicking
            cells. Experts remain under Benchmarks.
          </p>

          <div className="overflow-x-auto rounded-lg border border-border bg-surface-elevated">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-2">Creator</th>
                  {CONTEST_POSITIONS.map((position) => (
                    <th key={position} className="px-3 py-2">
                      {position}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {coverage.rows.map((row) => (
                  <tr
                    key={row.profileId}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-3 py-2">
                      <p className="font-medium text-ink">{row.displayName}</p>
                      <p className="text-xs text-muted">
                        {row.affiliationBadge}
                        {row.sourceUrl ? (
                          <>
                            {" · "}
                            <a
                              href={row.sourceUrl}
                              className="text-accent-ink hover:underline"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              profile URL
                            </a>
                          </>
                        ) : (
                          " · no profile URL"
                        )}
                      </p>
                      <p className="text-xs text-muted">
                        {row.capturedCount}/{row.expectedCount} imported
                        {row.missingPositions.length > 0
                          ? ` · missing ${row.missingPositions.join(", ")}`
                          : ""}
                      </p>
                    </td>
                    {CONTEST_POSITIONS.map((position) => {
                      const contestId = contestByPosition.get(position);
                      const status = row.cells[position];
                      return (
                        <td key={position} className="px-3 py-2">
                          {contestId ? (
                            <Link
                              href={`/admin/creators/board/${row.profileId}/${contestId}?weekId=${week.id}`}
                              className={`inline-flex rounded px-2 py-1 text-[11px] font-medium ${statusClass(status)}`}
                            >
                              {status}
                            </Link>
                          ) : (
                            <span className="text-xs text-muted">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <CreatorCompetitorDirectory />
    </Container>
  );
}

async function CreatorCompetitorDirectory() {
  const rows = await listCreatorCompetitorIdentities();
  return (
    <section className="mt-12">
      <h2 className="font-display text-lg font-semibold text-ink">
        Creator competitor directory
      </h2>
      <p className="mt-1 text-sm text-muted">
        Tracked Creators default to UNCLAIMED. Deactivate without deleting
        historical boards. Brand feeds the CREATOR · brand chip.
      </p>
      <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-surface-elevated">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-3">Creator</th>
              <th className="px-3 py-3">Claim</th>
              <th className="px-3 py-3">Directory</th>
              <th className="px-3 py-3">Graded</th>
              <th className="px-3 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.universalProfileId}
                className="border-b border-border align-top last:border-0"
              >
                <td className="px-3 py-3">
                  <p className="font-medium text-ink">{row.primaryName}</p>
                  <p className="text-xs text-muted">
                    @{row.username}
                    {row.affiliationBadge ? ` · ${row.affiliationBadge}` : ""}
                  </p>
                </td>
                <td className="px-3 py-3">
                  <Badge
                    tone={
                      row.claimStatus === "VERIFIED"
                        ? "success"
                        : row.claimStatus === "REQUESTED"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {row.claimStatus}
                  </Badge>
                </td>
                <td className="px-3 py-3">
                  <Badge tone={row.competitorActive ? "success" : "warning"}>
                    {row.competitorActive ? "Active" : "Inactive"}
                  </Badge>
                </td>
                <td className="px-3 py-3 tabular-nums">{row.gradedSubmissions}</td>
                <td className="px-3 py-3">
                  <div className="flex flex-col gap-2">
                    <form action={setCompetitorActiveAction}>
                      <input type="hidden" name="type" value="creator" />
                      <input
                        type="hidden"
                        name="universalProfileId"
                        value={row.universalProfileId}
                      />
                      <input type="hidden" name="returnTo" value="/admin/creators" />
                      <input
                        type="hidden"
                        name="active"
                        value={row.competitorActive ? "false" : "true"}
                      />
                      <Button type="submit" variant="secondary" className="text-xs">
                        {row.competitorActive ? "Deactivate" : "Activate"}
                      </Button>
                    </form>
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted hover:text-ink">
                        Edit metadata
                      </summary>
                      <form
                        action={updateCompetitorMetadataAction}
                        className="mt-2 grid gap-2 rounded-md border border-border bg-surface p-2"
                      >
                        <input type="hidden" name="type" value="creator" />
                        <input
                          type="hidden"
                          name="universalProfileId"
                          value={row.universalProfileId}
                        />
                        <input
                          type="hidden"
                          name="returnTo"
                          value="/admin/creators"
                        />
                        <input
                          name="displayName"
                          defaultValue={row.personName ?? row.displayName}
                          placeholder="Person name"
                          className="rounded border border-border bg-surface-elevated px-2 py-1"
                        />
                        <input
                          name="brandName"
                          defaultValue={row.brandName ?? ""}
                          placeholder="Brand"
                          className="rounded border border-border bg-surface-elevated px-2 py-1"
                        />
                        <input
                          name="creatorSiteUrl"
                          defaultValue={row.creatorSiteUrl ?? ""}
                          placeholder="Site URL"
                          className="rounded border border-border bg-surface-elevated px-2 py-1"
                        />
                        <input
                          name="socialUrl"
                          defaultValue={row.socialUrl ?? ""}
                          placeholder="Social URL"
                          className="rounded border border-border bg-surface-elevated px-2 py-1"
                        />
                        <input
                          name="socialHandle"
                          defaultValue={row.socialHandle ?? ""}
                          placeholder="Handle"
                          className="rounded border border-border bg-surface-elevated px-2 py-1"
                        />
                        <input
                          name="avatarUrl"
                          defaultValue={row.avatarUrl ?? ""}
                          placeholder="Avatar URL"
                          className="rounded border border-border bg-surface-elevated px-2 py-1"
                        />
                        <Button type="submit" className="text-xs">
                          Save
                        </Button>
                      </form>
                    </details>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { listExpertIdentities } from "@/lib/expert-identity";

export const metadata: Metadata = {
  title: "Expert sources",
  description: "Expert ranking source identities for RankEyeQ.",
};

export const dynamic = "force-dynamic";

export default async function AdminExpertsPage() {
  const experts = await listExpertIdentities();

  return (
    <Container className="py-10 sm:py-12">
      <AdminBanner />
      <AdminNav current="/admin/experts" />
      <SectionHeading
        eyebrow="Expert identities"
        title="Expert sources"
        description="Persistent competitive identities for third-party rankings. Import weekly boards via Benchmarks; graded with the same EYEQ engine as Human and AI rankers."
      />

      <div className="mb-4">
        <Link
          href="/admin/benchmarks"
          className="text-sm font-medium text-accent hover:underline"
        >
          Open weekly expert import grid →
        </Link>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface-elevated">
        <table className="w-full min-w-[52rem] text-left text-sm">
          <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-3">Source</th>
              <th className="px-3 py-3">Publication</th>
              <th className="px-3 py-3">Kind</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Graded weeks</th>
              <th className="px-3 py-3">Profile</th>
            </tr>
          </thead>
          <tbody>
            {experts.map((expert) => (
              <tr
                key={expert.universalProfileId}
                className="border-b border-border last:border-0"
              >
                <td className="px-3 py-3 font-medium text-ink">
                  {expert.displayName}
                  {expert.isOfficialSource ? (
                    <Badge tone="neutral" className="ml-2">
                      Official
                    </Badge>
                  ) : null}
                </td>
                <td className="px-3 py-3 text-ink">
                  {expert.publicationName ?? "—"}
                </td>
                <td className="px-3 py-3 text-ink">{expert.sourceKind}</td>
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
                </td>
                <td className="px-3 py-3 tabular-nums text-ink">
                  {expert.gradedSubmissions}
                </td>
                <td className="px-3 py-3">
                  <Link
                    href={`/profile/${expert.username}`}
                    className="text-accent hover:underline"
                  >
                    @{expert.username}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Container>
  );
}

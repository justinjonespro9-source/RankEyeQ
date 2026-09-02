import type { Metadata } from "next";
import Link from "next/link";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { Container } from "@/components/layout/Container";
import { Button } from "@/components/ui/Button";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { listRankingScoringVersions } from "@/lib/ranking-scoring-versions";
import { getDefaultRankingScoringConfig } from "@/lib/ranking-scoring-version";
import { parseRankingScoringConfig } from "@/lib/ranking-scoring-version";

export const metadata: Metadata = {
  title: "Scoring versions",
  description: "RankEyeQ ranking formula versions — draft, activate, and audit.",
};

export const dynamic = "force-dynamic";

export default async function AdminScoringVersionsPage() {
  const versions = await listRankingScoringVersions();
  const active = versions.find((version) => version.status === "ACTIVE");
  const config = active
    ? parseRankingScoringConfig(active.config)
    : getDefaultRankingScoringConfig();

  return (
    <Container className="py-10 sm:py-12">
      <AdminBanner />
      <AdminNav current="/admin/scoring" />
      <SectionHeading
        eyebrow="Scoring"
        title="Ranking formula versions"
        description="Finalized contests freeze the scoring version used at grade time. Changing the active version affects future contests only."
      />

      <div className="mb-8 rounded-lg border border-border bg-surface-elevated p-5">
        <h2 className="font-display text-lg font-semibold text-ink">
          Active formula
        </h2>
        <p className="mt-1 text-sm text-muted">
          {active?.label ?? "Default V1 (in-memory fallback)"}
        </p>
        <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
          <div>Base hit: {config.baseHitPoints}</div>
          <div>Podium call bonus: {config.podiumCallBonus}</div>
          <div>Precision exact / ±1 / ±2: {config.precisionExact} / {config.precisionOffBy1} / {config.precisionOffBy2}</div>
          <div>
            Actual podium #1/#2/#3: {config.actualPodiumPoints["1"]} /{" "}
            {config.actualPodiumPoints["2"]} / {config.actualPodiumPoints["3"]}
          </div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button href="/admin/scoring-lab" size="sm" variant="secondary">
            Open scoring lab
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface-elevated">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-3 py-3">Slug</th>
              <th className="px-3 py-3">Label</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">Contests</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((version) => (
              <tr key={version.id} className="border-b border-border last:border-0">
                <td className="px-3 py-3 font-mono text-xs text-ink">{version.slug}</td>
                <td className="px-3 py-3 text-ink">{version.label}</td>
                <td className="px-3 py-3 text-ink">{version.status}</td>
                <td className="px-3 py-3">
                  <Link href={`/admin/contests`} className="text-accent hover:underline">
                    Inspect
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

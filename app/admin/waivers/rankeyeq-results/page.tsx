import type { Metadata } from "next";
import Link from "next/link";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { WaiverRankEyeQResultsPanel } from "@/components/admin/waivers/WaiverRankEyeQResultsPanel";
import { Container } from "@/components/layout/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { privatePageMetadata } from "@/lib/seo";
import { loadRankEyeQResultsSnapshotsForWeek } from "@/lib/waivers/rankeyeq-results/queries";
import { loadWaiverAdminWeeks } from "@/lib/waivers/snapshot/queries";

export const metadata: Metadata = privatePageMetadata(
  "RankEyeQ results snapshots · Admin",
  "Preview and commit immutable RankEyeQ final-week-stats results snapshots for WaiverEyeQ grading.",
);

export const dynamic = "force-dynamic";

export default async function AdminRankEyeQResultsPage({ searchParams }: { searchParams: Promise<{ weekId?: string }> }) {
  const params = await searchParams;
  const weeks = await loadWaiverAdminWeeks();
  const weekId =
    params.weekId ?? weeks.find((week) => !week.isTest && week.status === "COMPLETE")?.id ?? weeks.find((week) => !week.isTest)?.id ?? weeks[0]?.id ?? null;
  const week = weeks.find((w) => w.id === weekId) ?? null;
  const snapshots = weekId ? await loadRankEyeQResultsSnapshotsForWeek(weekId) : [];

  return (
    <Container className="py-12 sm:py-16">
      <AdminBanner />
      <AdminNav current="/admin/waivers" />
      <SectionHeading
        eyebrow="Waivers"
        title="RankEyeQ results snapshots"
        description="Build an immutable RankEyeQ final-week-stats snapshot from completed Rankings WeekStat rows and operator participation review. Separate from SNG artifacts and from grading."
      />
      <p className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link href={`/admin/waivers${weekId ? `?weekId=${weekId}` : ""}`} className="text-accent-ink hover:underline">
          ← Waivers
        </Link>
        <Link href={`/admin/waivers/grading${weekId ? `?weekId=${weekId}&source=rankeyeq` : ""}`} className="text-accent-ink hover:underline">
          Grading (after snapshot) →
        </Link>
        <Link href={`/admin/waivers/artifacts${weekId ? `?weekId=${weekId}` : ""}`} className="text-accent-ink hover:underline">
          SNG artifacts →
        </Link>
      </p>
      <div className="mb-6 flex flex-wrap gap-2">
        {weeks.map((w) => (
          <Link
            key={w.id}
            href={`/admin/waivers/rankeyeq-results?weekId=${w.id}`}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${w.id === weekId ? "bg-accent text-ink" : "border border-border bg-surface-elevated text-ink"}`}
          >
            {w.label}
            {w.isTest ? " (test)" : ""}
          </Link>
        ))}
      </div>
      {!week || !weekId ? (
        <p className="text-sm text-muted">No week selected.</p>
      ) : (
        <WaiverRankEyeQResultsPanel weekId={weekId} weekLabel={week.label} weekStatus={week.status} snapshots={snapshots} />
      )}
    </Container>
  );
}

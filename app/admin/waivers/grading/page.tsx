import type { Metadata } from "next";
import Link from "next/link";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { WaiverGradingWorkflowPanel } from "@/components/admin/waivers/WaiverGradingWorkflowPanel";
import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { privatePageMetadata } from "@/lib/seo";
import { loadWaiverArtifactWeekView } from "@/lib/waivers/artifacts/queries";
import { isWaiverRankEyeQResultsAvailable, type WaiverGradingSource } from "@/lib/waivers/grading/source";
import { loadWaiverGradingLifecycleState } from "@/lib/waivers/grading/state";
import { loadWaiverAdminWeeks } from "@/lib/waivers/snapshot/queries";

export const metadata: Metadata = privatePageMetadata(
  "Waiver grading · Admin",
  "Preview, create, approve, apply and publish WaiverEyeQ grading runs.",
);

export const dynamic = "force-dynamic";

const pill = (active: boolean) =>
  `rounded-md px-3 py-1.5 text-sm font-medium ${active ? "bg-accent text-ink" : "border border-border bg-surface-elevated text-ink"}`;

export default async function AdminWaiverGradingPage({
  searchParams,
}: {
  searchParams: Promise<{ weekId?: string; source?: string; artifactRowId?: string }>;
}) {
  const params = await searchParams;
  const weeks = await loadWaiverAdminWeeks();
  const weekId = params.weekId ?? weeks.find((week) => !week.isTest && (week.status === "OPEN" || week.status === "UPCOMING"))?.id ?? weeks[0]?.id ?? null;
  const [artifactView, lifecycle] = weekId ? await Promise.all([loadWaiverArtifactWeekView(weekId), loadWaiverGradingLifecycleState(weekId)]) : [null, null];

  const artifacts = artifactView?.artifacts ?? [];
  const isLatest = (a: (typeof artifacts)[number]) => a.currentState === "ACCEPTED" && !a.supersededBy;
  const selected =
    artifacts.find((a) => a.id === params.artifactRowId) ?? [...artifacts].reverse().find(isLatest) ?? artifacts[artifacts.length - 1] ?? null;
  const sourceKind = params.source === "rankeyeq" ? "RANKEYEQ_SNAPSHOT" : "SNG_ARTIFACT";
  const source: WaiverGradingSource = sourceKind === "SNG_ARTIFACT" ? { kind: "SNG_ARTIFACT", artifactRowId: selected?.id ?? "" } : { kind: "RANKEYEQ_SNAPSHOT", snapshotId: null };
  const query = (extra: Record<string, string>) => `?${new URLSearchParams({ ...(weekId ? { weekId } : {}), ...extra }).toString()}`;

  return (
    <Container className="py-12 sm:py-16">
      <AdminBanner />
      <AdminNav current="/admin/waivers" />
      <SectionHeading
        eyebrow="Waivers · grading"
        title="WaiverEyeQ grading"
        description="Separate stages: read-only preview, create a versioned run, approve, apply as the week's current authority, then publish to public leaderboards. Applying never publishes."
      />
      <p className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link href={`/admin/waivers${weekId ? `?weekId=${weekId}` : ""}`} className="text-accent-ink hover:underline">
          ← Waivers
        </Link>
        <Link href={`/admin/waivers/artifacts${weekId ? `?weekId=${weekId}` : ""}`} className="text-accent-ink hover:underline">
          Canonical artifacts &amp; results intake (D3) →
        </Link>
        <Link href="/leaderboards?discipline=waivers" className="text-accent-ink hover:underline">
          Public Waivers leaderboard →
        </Link>
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        {weeks.map((week) => (
          <Link key={week.id} href={`/admin/waivers/grading?weekId=${week.id}`} className={pill(week.id === weekId)}>
            {week.label}
            {week.isTest ? " (test)" : ""}
          </Link>
        ))}
      </div>

      {weekId && lifecycle ? (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Source</span>
            <Link href={`/admin/waivers/grading${query({ source: "sng" })}`} className={pill(sourceKind === "SNG_ARTIFACT")}>
              SNG artifact
            </Link>
            <Link href={`/admin/waivers/grading${query({ source: "rankeyeq" })}`} className={pill(sourceKind === "RANKEYEQ_SNAPSHOT")}>
              RankEyeQ snapshot
            </Link>
            {!isWaiverRankEyeQResultsAvailable() ? <Badge tone="warning">RankEyeQ results not available yet</Badge> : null}
          </div>
          {sourceKind === "SNG_ARTIFACT" && artifacts.length > 0 ? (
            <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">Revision</span>
              {artifacts.map((a) => (
                <Link key={a.id} href={`/admin/waivers/grading${query({ source: "sng", artifactRowId: a.id })}`} className={pill(a.id === selected?.id)}>
                  r{a.revision} · {a.currentState ?? "?"}
                  {a.supersededBy ? " (superseded)" : ""}
                </Link>
              ))}
            </div>
          ) : (
            <div className="mb-6" />
          )}
          <WaiverGradingWorkflowPanel
            key={`${weekId}-${sourceKind}-${selected?.id ?? "none"}`}
            weekId={weekId}
            weekLabel={weeks.find((w) => w.id === weekId)?.label ?? "this week"}
            source={source}
            artifact={
              selected
                ? {
                    id: selected.id,
                    artifactId: selected.artifactId,
                    revision: selected.revision,
                    state: selected.currentState,
                    isLatest: !selected.supersededBy,
                    contentChecksum: selected.contentChecksum,
                  }
                : null
            }
            state={lifecycle}
            rankeyeqAvailable={isWaiverRankEyeQResultsAvailable()}
          />
        </>
      ) : (
        <p className="text-sm text-muted">No week selected.</p>
      )}
    </Container>
  );
}

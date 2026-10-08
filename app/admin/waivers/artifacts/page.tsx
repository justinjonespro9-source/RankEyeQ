import type { Metadata } from "next";
import Link from "next/link";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { WaiverArtifactImportPanel } from "@/components/admin/waivers/WaiverArtifactImportPanel";
import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { privatePageMetadata } from "@/lib/seo";
import { formatInChicago } from "@/lib/timing/chicago";
import { WAIVER_ARTIFACT_AUTHORITY_LABEL } from "@/lib/waivers/artifacts/authority";
import { loadWaiverArtifactWeekView } from "@/lib/waivers/artifacts/queries";
import { loadWaiverAdminWeeks } from "@/lib/waivers/snapshot/queries";

export const metadata: Metadata = privatePageMetadata("Waiver canonical artifacts · Admin", "Imported SNG canonical artifact authority records.");

export const dynamic = "force-dynamic";

function when(value: Date | null | undefined) {
  if (!value) return "—";
  return formatInChicago(value, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

const STATE_TONE = { ACCEPTED: "success", SUPERSEDED: "neutral", WITHDRAWN: "danger" } as const;

export default async function AdminWaiverArtifactsPage({ searchParams }: { searchParams: Promise<{ weekId?: string }> }) {
  const params = await searchParams;
  const weeks = await loadWaiverAdminWeeks();
  const weekId = params.weekId ?? weeks.find((week) => !week.isTest && (week.status === "OPEN" || week.status === "UPCOMING"))?.id ?? weeks[0]?.id ?? null;
  const view = weekId ? await loadWaiverArtifactWeekView(weekId) : null;

  return (
    <Container className="py-12 sm:py-16">
      <AdminBanner />
      <AdminNav current="/admin/waivers" />
      <SectionHeading
        eyebrow="Waivers"
        title="Canonical artifacts"
        description="Imported SNG canonical NFL weekly performance artifacts and their publication history. Records are immutable; importing never grades a contest."
      />
      <p className="mb-4 text-sm">
        <Link href={`/admin/waivers${weekId ? `?weekId=${weekId}` : ""}`} className="text-accent-ink hover:underline">
          ← Back to Waivers
        </Link>
      </p>
      <div className="mb-6 flex flex-wrap gap-2">
        {weeks.map((week) => (
          <Link
            key={week.id}
            href={`/admin/waivers/artifacts?weekId=${week.id}`}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${week.id === view?.week.id ? "bg-accent text-ink" : "border border-border bg-surface-elevated text-ink"}`}
          >
            {week.label}
            {week.isTest ? " (test)" : ""}
          </Link>
        ))}
      </div>

      {!view ? (
        <p className="text-sm text-muted">No week selected.</p>
      ) : (
        <div className="space-y-6">
          <section className="rounded-lg border border-border bg-surface-elevated p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl font-semibold text-ink">
                {view.week.label} · {view.week.seasonYear}
              </h2>
              <Badge tone="neutral">{view.week.status}</Badge>
              {view.week.isTest ? <Badge tone="warning">Test week</Badge> : null}
              <Badge tone="warning">{view.authorityMode === "OPERATOR_ATTESTED" ? WAIVER_ARTIFACT_AUTHORITY_LABEL : "Import disabled: publication authority unverifiable"}</Badge>
            </div>
            {view.artifacts.length === 0 ? (
              <p className="mt-3 text-sm text-muted">No canonical artifact imported for this week.</p>
            ) : (
              <table className="mt-3 w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="py-1">Revision</th>
                    <th className="py-1">Artifact</th>
                    <th className="py-1">State</th>
                    <th className="py-1">Checksum</th>
                    <th className="py-1">Accepted (SNG)</th>
                    <th className="py-1">Lineage</th>
                    <th className="py-1">Imported</th>
                  </tr>
                </thead>
                <tbody>
                  {view.artifacts.map((artifact) => (
                    <tr key={artifact.id} className="border-t border-border align-top">
                      <td className="py-1 tabular-nums">r{artifact.revision}</td>
                      <td className="py-1">
                        <Link href={`/admin/waivers/artifacts/${artifact.id}`} className="font-mono text-xs text-accent-ink hover:underline">
                          {artifact.artifactId}
                        </Link>
                      </td>
                      <td className="py-1">{artifact.currentState ? <Badge tone={STATE_TONE[artifact.currentState]}>{artifact.currentState}</Badge> : "—"}</td>
                      <td className="py-1 font-mono text-xs" title={artifact.contentChecksum}>
                        {artifact.contentChecksum.slice(0, 12)}…
                      </td>
                      <td className="py-1 text-xs">
                        {artifact.acceptanceId}
                        <br />
                        {when(artifact.acceptedAt)}
                      </td>
                      <td className="py-1 text-xs">
                        {artifact.supersedesArtifactId ? `supersedes ${artifact.supersedesArtifactId}` : "first revision"}
                        {artifact.supersededBy ? (
                          <>
                            <br />
                            superseded by {artifact.supersededBy.artifactId}
                          </>
                        ) : null}
                      </td>
                      <td className="py-1 text-xs">
                        {when(artifact.importedAt)}
                        <br />
                        {artifact.importedBy}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <WaiverArtifactImportPanel weekId={view.week.id} authorityMode={view.authorityMode} />
        </div>
      )}
    </Container>
  );
}

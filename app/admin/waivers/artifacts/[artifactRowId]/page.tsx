import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { WaiverArtifactWithdrawPanel } from "@/components/admin/waivers/WaiverArtifactWithdrawPanel";
import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { privatePageMetadata } from "@/lib/seo";
import { formatInChicago } from "@/lib/timing/chicago";
import { WAIVER_ARTIFACT_AUTHORITY_LABEL } from "@/lib/waivers/artifacts/authority";
import { loadWaiverArtifactDetail, reverifyWaiverArtifactContent } from "@/lib/waivers/artifacts/queries";

export const metadata: Metadata = privatePageMetadata("Waiver canonical artifact · Admin", "Immutable SNG canonical artifact authority record.");

export const dynamic = "force-dynamic";

function when(value: Date | null | undefined) {
  if (!value) return "—";
  return formatInChicago(value, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" });
}

const STATE_TONE = { ACCEPTED: "success", SUPERSEDED: "neutral", WITHDRAWN: "danger" } as const;

function Field({ label, value, mono = false }: { label: string; value: string | number | null; mono?: boolean }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className={`break-all text-ink ${mono ? "font-mono text-xs" : ""}`}>{value ?? "—"}</dd>
    </div>
  );
}

export default async function AdminWaiverArtifactPage({ params }: { params: Promise<{ artifactRowId: string }> }) {
  const { artifactRowId } = await params;
  const artifact = await loadWaiverArtifactDetail(artifactRowId);
  if (!artifact) notFound();
  const validation = await reverifyWaiverArtifactContent(artifactRowId);

  return (
    <Container className="py-12 sm:py-16">
      <AdminBanner />
      <AdminNav current="/admin/waivers" />
      <SectionHeading
        eyebrow="Waivers · canonical artifact"
        title={`${artifact.week.label} · revision ${artifact.revision}`}
        description="Immutable metadata, exact stored content and an append-only publication history. Artifact text is never shown here."
      />
      <p className="mb-4 text-sm">
        <Link href={`/admin/waivers/artifacts?weekId=${artifact.week.id}`} className="text-accent-ink hover:underline">
          ← Back to {artifact.week.label} artifacts
        </Link>
      </p>

      <section className="mb-6 rounded-lg border border-border bg-surface-elevated p-5">
        <div className="flex flex-wrap items-center gap-2">
          {artifact.currentState ? <Badge tone={STATE_TONE[artifact.currentState]}>{artifact.currentState}</Badge> : null}
          <Badge tone="warning">{WAIVER_ARTIFACT_AUTHORITY_LABEL}</Badge>
          <Badge tone={validation?.ok ? "success" : "danger"}>{validation?.ok ? "Stored content integrity re-verified" : "Stored content failed re-verification"}</Badge>
          {artifact.supersedes ? (
            <Link href={`/admin/waivers/artifacts/${artifact.supersedes.id}`} className="text-sm text-accent-ink hover:underline">
              supersedes r{artifact.supersedes.revision}
            </Link>
          ) : null}
          {artifact.supersededBy ? (
            <Link href={`/admin/waivers/artifacts/${artifact.supersededBy.id}`} className="text-sm text-accent-ink hover:underline">
              superseded by r{artifact.supersededBy.revision}
            </Link>
          ) : null}
        </div>
        {validation && !validation.ok ? (
          <p className="mt-2 text-xs text-danger">
            verifier {validation.verifierOk ? "ok" : validation.issueCodes.join(", ")} · text sha256 {validation.textSha256Matches ? "ok" : "MISMATCH"} · bytes{" "}
            {validation.byteLengthMatches ? "ok" : "MISMATCH"}
          </p>
        ) : null}
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Artifact ID" value={artifact.artifactId} mono />
          <Field label="Series" value={artifact.seriesKey} mono />
          <Field label="Content checksum" value={artifact.contentChecksum} mono />
          <Field label="Contract" value={`${artifact.schemaVersion} · ${artifact.serializationVersion}`} />
          <Field label="Ruleset" value={`${artifact.rulesetCode}@${artifact.rulesetVersion}`} />
          <Field label="Ruleset checksum" value={artifact.rulesetDefinitionChecksum} mono />
          <Field label="Engine / position policy" value={`${artifact.engineVersion} · ${artifact.positionPolicyVersion}`} />
          <Field label="Readiness policy / evidence" value={`${artifact.readinessPolicyVersion} · ${artifact.readinessEvidenceChecksum}`} mono />
          <Field label="Manifest checksum" value={artifact.manifestChecksum} mono />
          <Field label="Run / input set / source revision" value={`${artifact.runFingerprint} · ${artifact.inputSetChecksum} · ${artifact.sourceRevisionFingerprint}`} mono />
          <Field label="Acceptance (inside the bytes)" value={`${artifact.acceptanceId} · ${when(artifact.acceptedAt)} · by ${artifact.sngAcceptedById}`} />
          <Field label="Field sizes QB/RB/WR/TE/DEF" value={`${artifact.qbFieldSize}/${artifact.rbFieldSize}/${artifact.wrFieldSize}/${artifact.teFieldSize}/${artifact.defFieldSize}`} />
          <Field label="Participants / bytes" value={`${artifact.participantCount} / ${artifact.byteLength}`} />
          <Field label="DEF crosswalk" value={artifact.defCrosswalkVersion} />
          <Field label="Authority basis" value={`${artifact.authorityBasis} — ${WAIVER_ARTIFACT_AUTHORITY_LABEL}`} />
          <Field label="Attested state at import" value={artifact.attestedPublicationState} />
          <Field label="Source reference" value={artifact.sourceReference} />
          <Field label="Observed on SNG" value={when(artifact.sourceObservedAt)} />
          <Field label="Attestation" value={`${artifact.attestationVersion}: ${artifact.attestationText}`} />
          <Field label="Imported" value={`${when(artifact.importedAt)} · ${artifact.importedBy}`} />
          <Field label="Preview fingerprint" value={artifact.previewFingerprint} mono />
        </dl>
      </section>

      <section className="mb-6 rounded-lg border border-border bg-surface-elevated p-5">
        <h3 className="font-display text-lg font-semibold text-ink">Publication history</h3>
        <p className="mt-1 text-xs text-muted">State is the SNG publication state attested; recorded time is RankEyeQ&apos;s database clock.</p>
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="py-1">#</th>
              <th className="py-1">State</th>
              <th className="py-1">Basis</th>
              <th className="py-1">Observed on SNG</th>
              <th className="py-1">Recorded</th>
              <th className="py-1">Operator</th>
              <th className="py-1">Reason / successor</th>
            </tr>
          </thead>
          <tbody>
            {artifact.events.map((event) => (
              <tr key={event.id} className="border-t border-border align-top">
                <td className="py-1 tabular-nums">{event.sequence}</td>
                <td className="py-1">
                  <Badge tone={STATE_TONE[event.state]}>{event.state}</Badge>
                </td>
                <td className="py-1 text-xs">{event.basis}</td>
                <td className="py-1 text-xs">{when(event.sourceObservedAt)}</td>
                <td className="py-1 text-xs">{when(event.recordedAt)}</td>
                <td className="py-1 text-xs">{event.operator}</td>
                <td className="py-1 text-xs">
                  {event.reason ?? "—"}
                  {event.successor ? (
                    <>
                      {" · "}
                      <Link href={`/admin/waivers/artifacts/${event.successor.id}`} className="text-accent-ink hover:underline">
                        {event.successor.artifactId}
                      </Link>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {artifact.currentState === "ACCEPTED" || artifact.currentState === "SUPERSEDED" ? (
        <WaiverArtifactWithdrawPanel artifactRowId={artifact.id} latestSequence={artifact.latestSequence} superseded={artifact.currentState === "SUPERSEDED"} />
      ) : null}
    </Container>
  );
}

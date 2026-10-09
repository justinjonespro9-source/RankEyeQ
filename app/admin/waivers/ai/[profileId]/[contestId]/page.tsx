import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { CopyButton } from "@/components/admin/CopyButton";
import { WaiverAiEvidencePanel } from "@/components/admin/waivers/ai/WaiverAiEvidencePanel";
import { WaiverAiEvidenceReviewForm } from "@/components/admin/waivers/ai/WaiverAiEvidenceReviewForm";
import { WaiverAiParsePreview } from "@/components/admin/waivers/ai/WaiverAiParsePreview";
import { WaiverAiResponsePanel } from "@/components/admin/waivers/ai/WaiverAiResponsePanel";
import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { privatePageMetadata } from "@/lib/seo";
import { formatInChicago } from "@/lib/timing/chicago";
import {
  WAIVER_AI_EVIDENCE_LABEL,
  WAIVER_AI_EVIDENCE_SOURCE_LABELS,
  WAIVER_AI_LATE_EVIDENCE_LABEL,
  WAIVER_AI_STATED_TIME_NOTE,
  type WaiverAiEvidenceSource,
} from "@/lib/waivers/ai/constants";
import { loadWaiverAiBoardView } from "@/lib/waivers/ai/queries";

export const metadata: Metadata = privatePageMetadata("AI Waiver board · Admin", "Submit and audit a system-operated AI WaiverEyeQ board.");

export const dynamic = "force-dynamic";

function when(value: Date | null | undefined) {
  if (!value) return "—";
  return formatInChicago(value, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" });
}

function Field({ label, value, mono = false }: { label: string; value: string | number | null; mono?: boolean }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className={`break-all text-ink ${mono ? "font-mono text-xs" : ""}`}>{value ?? "—"}</dd>
    </div>
  );
}

const REVIEW_LABELS: Record<string, string> = {
  TEXT_CONFIRMED: "Text confirmed",
  NEEDS_FOLLOW_UP: "Needs follow-up",
  REJECTED: "Rejected",
};

export default async function AdminWaiverAiBoardPage({ params }: { params: Promise<{ profileId: string; contestId: string }> }) {
  const { profileId, contestId } = await params;
  const view = await loadWaiverAiBoardView(profileId, contestId);
  if (!view) notFound();
  const open = view.phase === "OPEN";
  const backHref = `/admin/ai?discipline=waivers&weekId=${encodeURIComponent(view.contest.weekId)}`;

  return (
    <Container className="py-12 sm:py-16">
      <AdminBanner />
      <AdminNav current="/admin/ai" />
      <p className="mb-4 text-sm">
        <Link href={backHref} className="text-accent-ink underline">
          ← AI WaiverEyeQ coverage
        </Link>
      </p>
      <SectionHeading
        eyebrow={`WaiverEyeQ · AI · ${view.week.seasonYear} ${view.week.label}`}
        title={`${view.profile.displayName} · ${view.contest.position}`}
        description="System-operated AI board. Every submission stores the exact AI response and creates a new append-only revision; nothing changes after the Waiver lock."
      />

      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={open ? "success" : "neutral"}>{open ? "Open" : "Locked"}</Badge>
        <Badge tone="accent">AI · system-operated</Badge>
        {!view.profile.canSubmit ? <Badge tone="warning">AI profile inactive</Badge> : null}
        <span className="text-muted">Locks {when(view.contest.locksAt)}</span>
      </div>

      <div className="space-y-8">
        <section className="rounded-lg border border-border bg-surface-elevated p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-ink">1. Frozen-pool prompt</h2>
            {view.prompt.text ? <CopyButton text={view.prompt.text} label="Copy Prompt" /> : null}
          </div>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <Field label="Frozen snapshot" value={`v${view.snapshot.version} · frozen ${when(view.snapshot.frozenAt)}`} />
            <Field label="Snapshot fingerprint" value={view.snapshot.entriesFingerprint} mono />
            <Field label="Prompt version" value={view.prompt.version} mono />
            <Field label="Prompt sha256" value={view.prompt.sha256} mono />
            <Field label="Eligible pool" value={`${view.prompt.poolSize} players`} />
            <Field label="Allowed picks" value={`up to ${view.prompt.availableSlots} (fewer allowed; NO CALLS allowed)`} />
          </dl>
          {view.prompt.text ? (
            <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface p-3 font-mono text-xs">{view.prompt.text}</pre>
          ) : (
            <p className="mt-4 text-sm text-muted">The contest is locked; the prompt is no longer offered for new predictions.</p>
          )}
        </section>

        <section className="rounded-lg border border-border bg-surface-elevated p-5">
          <h2 className="text-lg font-semibold text-ink">AI response</h2>
          {!open ? (
            <p className="mt-2 text-sm text-muted">
              Locked: no competitive AI submission is possible after the Waiver lock, and there is no late-entry override. A prediction made
              earlier can only be preserved as historical evidence below (record only).
            </p>
          ) : !view.profile.canSubmit ? (
            <p className="mt-2 text-sm text-muted">This AI profile is not an active competitor; it cannot submit boards.</p>
          ) : (
            <div className="mt-3">
              <WaiverAiResponsePanel contestId={view.contest.id} profileId={view.profile.id} promptSha256={view.prompt.sha256} aiDisplayName={view.profile.displayName} />
            </div>
          )}
        </section>

        <section className="rounded-lg border border-border bg-surface-elevated p-5">
          <h2 className="text-lg font-semibold text-ink">Board history</h2>
          {!view.board ? (
            <p className="mt-2 text-sm text-muted">No board yet.</p>
          ) : (
            <div className="mt-3 space-y-4">
              <p className="text-sm text-muted">
                Status {view.board.status} · last submitted {when(view.board.submittedAt)}
                {view.board.lockedRevisionNumber !== null ? ` · competitive revision r${view.board.lockedRevisionNumber}` : ""}
              </p>
              {view.board.revisions.map((revision) => (
                <article key={revision.revisionNumber} className="rounded-md border border-border p-4">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-semibold text-ink">Revision {revision.revisionNumber}</span>
                    {revision.competitive ? <Badge tone="accent">Locked board</Badge> : null}
                    <span className="text-muted">
                      {when(revision.createdAt)} · by {revision.authorLabel} · {revision.callCount === 0 ? "NO CALLS" : `${revision.callCount} pick${revision.callCount === 1 ? "" : "s"}`}
                    </span>
                  </div>
                  {revision.calls.length > 0 ? (
                    <ol className="mt-2 space-y-0.5 text-sm">
                      {revision.calls.map((call) => (
                        <li key={call.slot}>
                          <span className="tabular-nums text-muted">
                            {call.slot} · {call.label}
                          </span>{" "}
                          {call.displayName}
                          {call.team ? ` (${call.team})` : ""}
                        </li>
                      ))}
                    </ol>
                  ) : null}
                  {revision.response ? (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-sm text-muted">Stored AI response ({revision.response.responseByteLength} bytes)</summary>
                      <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                        <Field label="Model label" value={revision.response.modelLabel} />
                        <Field label="Imported (database time)" value={when(revision.response.importedAt)} />
                        <Field label="Stated generation time" value={revision.response.statedGeneratedAt ? `${when(revision.response.statedGeneratedAt)} — ${WAIVER_AI_STATED_TIME_NOTE}` : null} />
                        <Field label="Source reference" value={revision.response.sourceReference} />
                        <Field label="Source note" value={revision.response.sourceNote} />
                        <Field label="Prompt" value={`${revision.response.promptVersion} · ${revision.response.promptSha256}`} mono />
                        <Field label="Parser" value={revision.response.parserVersion} mono />
                        <Field label="Response sha256" value={revision.response.responseSha256} mono />
                      </dl>
                      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface p-3 font-mono text-xs">{revision.response.responseText}</pre>
                    </details>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-border bg-surface-elevated p-5">
          <h2 className="text-lg font-semibold text-ink">Historical evidence (record only)</h2>
          <p className="mt-1 text-sm text-muted">
            Preserves an AI prediction exactly as it was produced. Evidence never creates a board, revision, call, grade, consensus or
            leaderboard entry, and cannot be edited or deleted. Records made at or after the lock are labelled “{WAIVER_AI_LATE_EVIDENCE_LABEL}”.
          </p>
          <div className="mt-4">
            <WaiverAiEvidencePanel contestId={view.contest.id} profileId={view.profile.id} />
          </div>

          {view.evidence.length > 0 ? (
            <div className="mt-6 space-y-4">
              {view.evidence.map((evidence) => (
                <article key={evidence.id} className="rounded-md border border-border p-4">
                  <p className={`text-sm font-semibold ${evidence.recordedAfterLock ? "text-danger" : "text-warning"}`}>
                    {evidence.recordedAfterLock ? WAIVER_AI_LATE_EVIDENCE_LABEL : WAIVER_AI_EVIDENCE_LABEL}
                  </p>
                  <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                    <Field label="Model label" value={evidence.modelLabel} />
                    <Field label="Recorded (database time)" value={`${when(evidence.recordedAt)} by ${evidence.recordedByLabel}`} />
                    <Field label="Stated original time" value={evidence.statedSourceAt ? `${when(evidence.statedSourceAt)} — ${WAIVER_AI_STATED_TIME_NOTE}` : null} />
                    <Field
                      label="Preserved as"
                      value={WAIVER_AI_EVIDENCE_SOURCE_LABELS[evidence.evidenceSource as WaiverAiEvidenceSource] ?? evidence.evidenceSource}
                    />
                    <Field label="Evidence reference" value={evidence.evidenceReference} />
                    <Field label="Note" value={evidence.note} />
                    <Field label="sha256" value={`${evidence.responseSha256} · ${evidence.responseByteLength} bytes`} mono />
                  </dl>
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm text-muted">Original text and frozen-pool parse</summary>
                    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface p-3 font-mono text-xs">{evidence.responseText}</pre>
                    <div className="mt-3">
                      <WaiverAiParsePreview parse={evidence.parse} />
                    </div>
                  </details>
                  <div className="mt-3 space-y-2">
                    <p className="text-sm font-medium text-ink">Reviews</p>
                    {evidence.reviews.length === 0 ? (
                      <p className="text-sm text-muted">Not reviewed.</p>
                    ) : (
                      <ol className="space-y-1 text-sm">
                        {evidence.reviews.map((review) => (
                          <li key={review.sequence}>
                            <span className="tabular-nums text-muted">#{review.sequence}</span> {REVIEW_LABELS[review.status] ?? review.status} — {review.note}{" "}
                            <span className="text-muted">
                              ({review.reviewerLabel}, {when(review.reviewedAt)})
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}
                    <WaiverAiEvidenceReviewForm
                      evidenceId={evidence.id}
                      profileId={view.profile.id}
                      contestId={view.contest.id}
                      latestSequence={evidence.reviews.at(-1)?.sequence ?? 0}
                    />
                    <p className="text-xs text-muted">Reviews are an audit trail only; no review makes evidence competitive.</p>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </Container>
  );
}

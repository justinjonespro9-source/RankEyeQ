import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { CopyButton } from "@/components/admin/CopyButton";
import { WaiverAiEvidencePanel } from "@/components/admin/waivers/ai/WaiverAiEvidencePanel";
import { WaiverAiEvidenceReviewForm } from "@/components/admin/waivers/ai/WaiverAiEvidenceReviewForm";
import { WaiverAiLateEntryForm } from "@/components/admin/waivers/ai/WaiverAiLateEntryForm";
import { WaiverAiParsePreview } from "@/components/admin/waivers/ai/WaiverAiParsePreview";
import { WaiverAiResponsePanel } from "@/components/admin/waivers/ai/WaiverAiResponsePanel";
import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { requireAdmin } from "@/lib/auth/session";
import { privatePageMetadata } from "@/lib/seo";
import { formatInChicago } from "@/lib/timing/chicago";
import {
  WAIVER_AI_COMPETITIVE_OVERRIDE_LABEL,
  WAIVER_AI_EVIDENCE_LABEL,
  WAIVER_AI_EVIDENCE_SOURCE_LABELS,
  WAIVER_AI_LATE_ENTRY_BASIS_LABELS,
  WAIVER_AI_LATE_ENTRY_INELIGIBLE_LABELS,
  WAIVER_AI_LATE_ENTRY_LABEL,
  WAIVER_AI_LATE_ENTRY_TIMESTAMP_LABELS,
  WAIVER_AI_LATE_EVIDENCE_LABEL,
  WAIVER_AI_PROMPT_EQUIVALENCE_LABELS,
  WAIVER_AI_STATED_TIME_NOTE,
  WAIVER_BOARD_ENTRY_BASIS_LABELS,
  type WaiverAiEvidenceSource,
  type WaiverAiLateEntryBasis,
} from "@/lib/waivers/ai/constants";
import type { WaiverAiPromptProvenance } from "@/lib/waivers/ai/prompt";
import {
  loadWaiverAiBoardView,
  type WaiverAiCompetitiveOverrideBoardView,
  type WaiverAiLateEntryBoardView,
  type WaiverAiLateEntryPromptView,
} from "@/lib/waivers/ai/queries";

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

function PromptProvenance({ prompt }: { prompt: WaiverAiLateEntryPromptView }) {
  return (
    <>
      <Field label="Original prompt" value={WAIVER_AI_PROMPT_EQUIVALENCE_LABELS[prompt.equivalence] ?? prompt.equivalence} />
      <Field label="Original prompt version (as recorded)" value={prompt.originalVersion ?? "Not known"} mono />
      <Field label="Original prompt reference" value={prompt.originalReference} />
      <Field label="Original prompt sha256" value={prompt.originalSha256 ?? "Prompt text not preserved"} mono />
      <Field label="Canonical prompt used for validation" value={`${prompt.canonicalVersion} · ${prompt.canonicalSha256}`} mono />
      {prompt.originalText ? (
        <details className="sm:col-span-2">
          <summary className="cursor-pointer text-muted">Preserved original prompt text</summary>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface p-3 font-mono text-xs">{prompt.originalText}</pre>
        </details>
      ) : null}
    </>
  );
}

function LateEntryDesignation({ late }: { late: WaiverAiLateEntryBoardView }) {
  return (
    <div className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm">
      <p className="font-semibold text-warning">{WAIVER_AI_LATE_ENTRY_LABEL}</p>
      <dl className="mt-1 grid gap-1 sm:grid-cols-2">
        <Field label="Original prediction time" value={`${when(late.originalPredictionAt)} — ${WAIVER_AI_LATE_ENTRY_TIMESTAMP_LABELS[late.timestampMethod] ?? late.timestampMethod}`} />
        <Field label="Imported (database time)" value={`${when(late.importedAt)} by ${late.approvedByLabel}`} />
        <Field label="Evidence basis" value={WAIVER_AI_LATE_ENTRY_BASIS_LABELS[late.basis as WaiverAiLateEntryBasis] ?? late.basis} />
        <Field label="Source reference" value={late.sourceReference} />
        <PromptProvenance prompt={late.prompt} />
        <Field label="Response sha256" value={late.responseSha256} mono />
        <Field label="Approval note" value={late.note} />
      </dl>
    </div>
  );
}

function OverrideDesignation({ override }: { override: WaiverAiCompetitiveOverrideBoardView }) {
  return (
    <div className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm">
      <p className="font-semibold text-danger">{WAIVER_AI_COMPETITIVE_OVERRIDE_LABEL}</p>
      <p className="mt-1 text-muted">Entered after the lock by an administrator, without pre-lock evidence. Not a verified pre-lock submission.</p>
      <dl className="mt-1 grid gap-1 sm:grid-cols-2">
        <Field label="Imported (database time)" value={`${when(override.importedAt)} by ${override.authorizedByLabel}`} />
        <Field label="Original prediction time" value="Not established" />
        <Field label="Model label" value={override.modelLabel} />
        <Field label="Source reference" value={override.sourceReference} />
        <Field label="Attached evidence" value={override.evidenceId ? `Historical evidence ${override.evidenceId}` : "None"} mono={Boolean(override.evidenceId)} />
        <Field label="Response sha256" value={override.responseSha256} mono />
        <div className="sm:col-span-2">
          <Field label="Override reason" value={override.reason} />
        </div>
      </dl>
    </div>
  );
}

const REVIEW_LABELS: Record<string, string> = {
  TEXT_CONFIRMED: "Text confirmed",
  NEEDS_FOLLOW_UP: "Needs follow-up",
  REJECTED: "Rejected",
};

function PromptProvenanceNotice({ provenance, sha256 }: { provenance: WaiverAiPromptProvenance; sha256: string }) {
  if (provenance.status === "CONFIRMED") {
    return (
      <p className="mt-2 rounded-md border border-success/30 bg-success-soft px-3 py-2 text-sm text-success">
        Rebuilt from the pinned frozen snapshot. Its sha256 matches the prompt hash recorded with {provenance.recordedResponses} AI submission
        {provenance.recordedResponses === 1 ? "" : "s"} for this contest, so it is byte-identical to the prompt they answered.
      </p>
    );
  }
  if (provenance.status === "MISMATCH") {
    return (
      <div className="mt-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
        <p className="font-semibold">Not the exact original prompt.</p>
        <p>
          This prompt is rebuilt from the pinned frozen snapshot, but its sha256 differs from a prompt hash recorded with this contest&apos;s AI
          submissions. Treat it as a reconstruction, not the prompt those AIs answered.
        </p>
        <ul className="mt-1 font-mono text-xs">
          <li>rebuilt {sha256}</li>
          {provenance.recordedHashes.map((row) => (
            <li key={`${row.version}:${row.sha256}`}>
              recorded {row.version} · {row.sha256}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <p className="mt-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
      Rebuilt deterministically from the pinned frozen snapshot with the current prompt builder. No AI submission for this contest recorded a
      prompt hash, so byte-identity with the prompt shown before the lock is not independently confirmed.
    </p>
  );
}

export default async function AdminWaiverAiBoardPage({ params }: { params: Promise<{ profileId: string; contestId: string }> }) {
  await requireAdmin();
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
            <CopyButton text={view.prompt.text} label="Copy Prompt" />
          </div>
          <PromptProvenanceNotice provenance={view.prompt.provenance} sha256={view.prompt.sha256} />
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <Field label="Frozen snapshot" value={`v${view.snapshot.version} · frozen ${when(view.snapshot.frozenAt)}`} />
            <Field label="Snapshot fingerprint" value={view.snapshot.entriesFingerprint} mono />
            <Field label="Prompt version" value={view.prompt.version} mono />
            <Field label="Prompt sha256" value={view.prompt.sha256} mono />
            <Field label="Eligible pool" value={`${view.prompt.poolSize} players`} />
            <Field label="Allowed picks" value={`up to ${view.prompt.availableSlots} (fewer allowed; NO CALLS allowed)`} />
          </dl>
          <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface p-3 font-mono text-xs">{view.prompt.text}</pre>
        </section>

        <section className="rounded-lg border border-border bg-surface-elevated p-5">
          <h2 className="text-lg font-semibold text-ink">Submit AI picks</h2>
          {open ? null : (
            <p className="mt-1 text-sm text-muted">
              The contest is locked. Checking “Allow late AI submission” enters these picks in competition, labelled “{WAIVER_AI_COMPETITIVE_OVERRIDE_LABEL}”
              with the actual submission time. Each AI has at most one board per contest; a late submission never replaces a board and is closed once the
              week has a grade run.
            </p>
          )}
          {open && !view.profile.canSubmit ? (
            <p className="mt-2 text-sm text-muted">This AI profile is not an active competitor; it cannot submit boards.</p>
          ) : !open && view.lateSubmission.blockers.length > 0 ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-warning">
              {view.lateSubmission.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          ) : (
            <div className="mt-3">
              <WaiverAiResponsePanel
                contestId={view.contest.id}
                profileId={view.profile.id}
                promptSha256={view.prompt.sha256}
                aiDisplayName={view.profile.displayName}
                late={!open}
              />
            </div>
          )}
        </section>

        <section className="rounded-lg border border-border bg-surface-elevated p-5">
          <h2 className="text-lg font-semibold text-ink">Board history</h2>
          {!view.board ? (
            <p className="mt-2 text-sm text-muted">No board yet.</p>
          ) : (
            <div className="mt-3 space-y-4">
              {view.board.lateEntry ? <LateEntryDesignation late={view.board.lateEntry} /> : null}
              {view.board.competitiveOverride ? <OverrideDesignation override={view.board.competitiveOverride} /> : null}
              <p className="text-sm text-muted">
                Entry: {WAIVER_BOARD_ENTRY_BASIS_LABELS[view.board.entryBasis]} · Status {view.board.status} · last submitted {when(view.board.submittedAt)}
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
                        <Field
                          label="Prompt"
                          value={
                            revision.response.promptVersion && revision.response.promptSha256
                              ? `${revision.response.promptVersion} · ${revision.response.promptSha256}`
                              : view.board?.competitiveOverride
                                ? "Not recorded — admin competitive override (no prompt claim)"
                                : "Original prompt not verified as the canonical prompt — see the late-entry verification"
                          }
                          mono
                        />
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

        <details className="rounded-lg border border-border bg-surface-elevated p-5">
          <summary className="cursor-pointer text-lg font-semibold text-ink">Advanced: historical evidence and verified pre-lock late entry</summary>
          <div className="mt-4 space-y-8">
            <section className="rounded-lg border border-border bg-surface p-5">
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
                        <p className="text-xs text-muted">
                          Reviews are an audit trail; no review makes evidence competitive. Late entry requires the latest review to be “Text confirmed”.
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}
            </section>

            <section className="rounded-lg border border-border bg-surface p-5">
              <h2 className="text-lg font-semibold text-ink">Verified pre-lock late entry (Late Entry Override)</h2>
              <p className="mt-1 text-sm text-muted">
                For delayed administrative recording only — never for creating or changing a prediction after the lock. A historical-evidence record
                becomes competitive only with independently verifiable pre-lock evidence (a database record made before the lock, or the original
                provider file whose assistant message holds the exact response and carries the provider&apos;s own timestamp), a “Text confirmed”
                review, a recorded verification and, in a separate action, an explicit approval. A time read or entered by an administrator is
                never competitive. The exact original response is parsed against the pinned frozen pool and refused whole if invalid. The board
                names the canonical prompt only when the AI&apos;s preserved original prompt is byte-identical to it.
              </p>
              {view.lateEntry.blockers.length > 0 ? (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-warning">
                  {view.lateEntry.blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              ) : null}
              {view.board?.lateEntry ? (
                <div className="mt-3">
                  <LateEntryDesignation late={view.board.lateEntry} />
                </div>
              ) : null}
              {view.evidence.length === 0 ? (
                <p className="mt-3 text-sm text-muted">No historical evidence recorded for this AI and contest. Record the original response above first.</p>
              ) : (
                <div className="mt-4 space-y-4">
                  {view.evidence.map((evidence) => {
                    const latest = evidence.verifications.at(-1) ?? null;
                    return (
                      <article key={evidence.id} className="rounded-md border border-border p-4">
                        <dl className="grid gap-2 text-sm sm:grid-cols-2">
                          <Field
                            label="Original prediction time"
                            value={
                              evidence.recordedAfterLock
                                ? "Not recorded before the lock — requires the original provider file"
                                : `${when(evidence.recordedAt)} (database clock, before the lock)`
                            }
                          />
                          <Field
                            label="Evidence source"
                            value={`${WAIVER_AI_EVIDENCE_SOURCE_LABELS[evidence.evidenceSource as WaiverAiEvidenceSource] ?? evidence.evidenceSource} · ${evidence.evidenceReference}`}
                          />
                          <Field label="Response fingerprint (sha256)" value={evidence.responseSha256} mono />
                          <Field label="Latest review" value={evidence.reviews.length ? (REVIEW_LABELS[evidence.reviews.at(-1)!.status] ?? evidence.reviews.at(-1)!.status) : "Not reviewed"} />
                        </dl>
                        <div className="mt-3">
                          <WaiverAiParsePreview parse={evidence.parse} />
                        </div>
                        {evidence.verifications.length > 0 ? (
                          <ol className="mt-3 space-y-2 text-sm">
                            {evidence.verifications.map((v) => (
                              <li key={v.id} className="rounded-md border border-border p-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-semibold text-ink">Verification #{v.sequence}</span>
                                  {v.eligible ? <Badge tone="success">Eligible</Badge> : <Badge tone="danger">Not eligible — record only</Badge>}
                                  {v.approved ? <Badge tone="accent">Approved</Badge> : null}
                                  <span className="text-muted">
                                    {when(v.verifiedAt)} by {v.verifiedByLabel}
                                  </span>
                                </div>
                                {!v.eligible && v.ineligibleReason ? (
                                  <p className="mt-1 text-danger">{WAIVER_AI_LATE_ENTRY_INELIGIBLE_LABELS[v.ineligibleReason] ?? v.ineligibleReason}</p>
                                ) : null}
                                <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                                  <Field label="Basis" value={WAIVER_AI_LATE_ENTRY_BASIS_LABELS[v.basis as WaiverAiLateEntryBasis] ?? v.basis} />
                                  <Field
                                    label="Original prediction time"
                                    value={v.originalPredictionAt ? `${when(v.originalPredictionAt)} — ${WAIVER_AI_LATE_ENTRY_TIMESTAMP_LABELS[v.timestampMethod] ?? v.timestampMethod}` : null}
                                  />
                                  <Field label="Source reference" value={v.sourceReference} />
                                  <div>
                                    <dt className="text-muted">Provider file</dt>
                                    <dd className="break-all text-ink">
                                      {v.artifact ? (
                                        <>
                                          {v.artifact.name} · {v.artifact.byteLength} bytes ·{" "}
                                          {v.artifact.containsResponse ? "contains the exact response" : "does not contain the response"} ·{" "}
                                          <span className="font-mono text-xs">sha256 {v.artifact.sha256}</span> ·{" "}
                                          <a href={v.artifact.downloadPath} download className="text-accent-ink underline">
                                            Download original file
                                          </a>
                                        </>
                                      ) : (
                                        "—"
                                      )}
                                    </dd>
                                  </div>
                                  <Field label="Board fingerprint" value={`${v.callCount === 0 ? "NO CALLS" : `${v.callCount} pick${v.callCount === 1 ? "" : "s"}`} · ${v.boardFingerprint}`} mono />
                                  <PromptProvenance prompt={v.prompt} />
                                  <Field label="Attestation" value={v.attestation} />
                                </dl>
                              </li>
                            ))}
                          </ol>
                        ) : null}
                        {!view.board && evidence.parse.ok && view.profile.canSubmit && view.phase === "LOCKED" ? (
                          <div className="mt-4">
                            <WaiverAiLateEntryForm
                              evidenceId={evidence.id}
                              profileId={view.profile.id}
                              contestId={view.contest.id}
                              responseText={evidence.responseText}
                              responseSha256={evidence.responseSha256}
                              promptSha256={view.prompt.sha256}
                              pickIds={evidence.parse.picks.map((pick) => pick.rankableEntryId)}
                              recordedBeforeLock={!evidence.recordedAfterLock}
                              latestVerification={latest ? { id: latest.id, sequence: latest.sequence, eligible: latest.eligible, ineligibleReason: latest.ineligibleReason, approved: latest.approved } : null}
                              canApprove={view.lateEntry.blockers.length === 0}
                            />
                          </div>
                        ) : !evidence.parse.ok ? (
                          <p className="mt-3 text-sm text-danger">The response is invalid against the frozen pool; it cannot be late-entered.</p>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </details>
      </div>
    </Container>
  );
}

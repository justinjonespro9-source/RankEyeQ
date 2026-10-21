"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  applyWaiverGradeAuthorityAction,
  approveWaiverGradeRunAction,
  previewWaiverWeekGradingAction,
  publishWaiverWeekGradesAction,
  storeWaiverGradingRunAction,
} from "@/lib/waivers/grading/actions";
import type { WaiverGradingReview } from "@/lib/waivers/grading/review-model";
import type { WaiverGradingSource } from "@/lib/waivers/grading/source";
import type { WaiverGradingLifecycleState, WaiverGradingRunView } from "@/lib/waivers/grading/state";
import type { WaiverGradeRunStage } from "@/lib/waivers/grading/state-model";
import { WAIVER_GRADING_APPROVAL_ATTESTATION_TEXT, WAIVER_GRADING_APPROVAL_RANKEYEQ_ATTESTATION_TEXT } from "@/lib/waivers/results/model";

const inputClass = "w-full rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-ink";
const points = (value: number | null) => (value === null ? "N/A" : (value / 100).toFixed(2));
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });

const STAGE_TONE: Record<WaiverGradeRunStage, "neutral" | "warning" | "accent" | "success"> = {
  STORED: "neutral",
  APPROVED: "warning",
  APPLIED: "accent",
  PUBLISHED: "success",
  SUPERSEDED: "neutral",
};
const STAGE_LABEL: Record<WaiverGradeRunStage, string> = {
  STORED: "Stored (proposed)",
  APPROVED: "Approved, not applied",
  APPLIED: "Applied (current), unpublished",
  PUBLISHED: "Published",
  SUPERSEDED: "Superseded",
};

type ActionResult = { ok: true } | { ok: false; error: string; code: string };

function Message({ error, note }: { error: string | null; note?: string | null }) {
  if (error) {
    return (
      <p className="mt-3 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
        {error}
      </p>
    );
  }
  return note ? <p className="mt-3 rounded-md border border-success/30 bg-success-soft px-3 py-2 text-sm text-success">{note}</p> : null;
}

function Card({ title, badge, children }: { title: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface-elevated p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-lg font-semibold text-ink">{title}</h3>
        {badge}
      </div>
      {children}
    </section>
  );
}

/** A staged, operator-driven view of WaiverEyeQ grading: preview, create run, approve, apply, publish. */
export function WaiverGradingWorkflowPanel({
  weekId,
  weekLabel,
  source,
  artifact,
  state,
  rankeyeqAvailable,
}: {
  weekId: string;
  weekLabel: string;
  source: WaiverGradingSource;
  artifact: { id: string; artifactId: string; revision: number; state: string | null; isLatest: boolean; contentChecksum: string } | null;
  state: WaiverGradingLifecycleState;
  rankeyeqAvailable: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [review, setReview] = useState<WaiverGradingReview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [storeNote, setStoreNote] = useState<string | null>(null);

  const sourceReady = source.kind === "SNG_ARTIFACT" ? artifact !== null : true;

  const runPreview = () => {
    setPreviewError(null);
    setStoreError(null);
    setStoreNote(null);
    startTransition(async () => {
      const result = await previewWaiverWeekGradingAction({ weekId, source });
      if (!result.ok) {
        setReview(null);
        setPreviewError(`${result.code}: ${result.error}`);
        return;
      }
      setReview(result.review);
    });
  };

  const createRun = () => {
    if (!review?.run) return;
    setStoreError(null);
    setStoreNote(null);
    startTransition(async () => {
      const result = await storeWaiverGradingRunAction({
        weekId,
        source,
        expectedInputFingerprint: review.run!.inputFingerprint,
        expectedOutputFingerprint: review.run!.outputFingerprint,
      });
      if (!result.ok) {
        setStoreError(`${result.code}: ${result.error}`);
        return;
      }
      setStoreNote(
        result.status === "ALREADY_STORED"
          ? `Run #${result.runNumber} already stores these exact inputs; nothing new was written.`
          : `Stored run #${result.runNumber} (${result.boardGradeCount} boards). It is a proposal only: approve it next.`,
      );
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <Card title="1 · Source" badge={<Badge tone="neutral">{source.kind === "SNG_ARTIFACT" ? "SNG artifact" : "RankEyeQ snapshot"}</Badge>}>
        {source.kind === "SNG_ARTIFACT" ? (
          artifact ? (
            <div className="mt-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={artifact.state === "ACCEPTED" ? "success" : "danger"}>{artifact.state ?? "unknown"}</Badge>
                <Badge tone={artifact.isLatest ? "success" : "danger"}>{artifact.isLatest ? "Latest revision" : "Superseded revision"}</Badge>
                <span className="text-ink">
                  {artifact.artifactId} · revision {artifact.revision}
                </span>
              </div>
              <p className="mt-1 break-all font-mono text-xs text-muted">checksum {artifact.contentChecksum}</p>
              <p className="mt-2 text-xs text-muted">
                Only the week&apos;s latest ACCEPTED, intact revision is gradable. D3 snapshot-conflict decisions and results reconciliation are reviewed on the{" "}
                <Link href={`/admin/waivers/artifacts/${artifact.id}`} className="text-accent-ink hover:underline">
                  artifact results intake
                </Link>
                .
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">
              No imported SNG artifact for {weekLabel}.{" "}
              <Link href={`/admin/waivers/artifacts?weekId=${weekId}`} className="text-accent-ink hover:underline">
                Import one
              </Link>
              .
            </p>
          )
        ) : (
          <div className="mt-3 text-sm text-muted">
            <p>
              Grades the week from its current ACCEPTED RankEyeQ final-week-stats snapshot.{" "}
              {rankeyeqAvailable
                ? "Preview it read-only, then create, approve, apply and publish a run bound to that snapshot (never to an SNG artifact). D3 snapshot-conflict decisions do not apply: RankEyeQ has no BYE disposition."
                : "It is not available yet: previewing this source reports that explicitly and never falls back to SNG."}
            </p>
          </div>
        )}
        <div className="mt-4">
          <Button type="button" size="sm" variant="secondary" disabled={pending || !sourceReady} onClick={runPreview}>
            {pending ? "Working…" : "Run read-only preview"}
          </Button>
          <span className="ml-3 text-xs text-muted">Reads only; stores, approves and applies nothing.</span>
        </div>
        <Message error={previewError} />
      </Card>

      {review ? (
        <ReviewSections review={review} />
      ) : (
        <p className="text-sm text-muted">Run the preview to review top finishes, zero-point players, D3 decisions and board scores before creating a run.</p>
      )}

      <Card title="3 · Create grading run" badge={<Badge tone="neutral">Writes results + run, nothing else</Badge>}>
        <p className="mt-2 text-xs text-muted">
          Stores the reviewed preview as a new versioned run (contest results, pool rows, board and call grades). It does not approve, apply or publish, and it refuses if
          the preview is blocked or has changed since you reviewed it.
        </p>
        <div className="mt-3">
          <Button type="button" size="sm" disabled={pending || review?.status !== "READY" || !review.run} onClick={createRun}>
            {pending ? "Working…" : "Create grading run"}
          </Button>
          {review && review.status !== "READY" ? <span className="ml-3 text-xs text-danger">Preview is blocked; resolve the blockers first.</span> : null}
        </div>
        <Message error={storeError} note={storeNote} />
      </Card>

      <Card
        title="4 · Approve → Apply → Publish"
        badge={
          state.authority ? (
            <Badge tone={state.publication ? "success" : "accent"}>
              {state.publication ? `Run #${state.authority.runNumber} published` : `Run #${state.authority.runNumber} current, unpublished`}
            </Badge>
          ) : (
            <Badge tone="neutral">No authority applied</Badge>
          )
        }
      >
        <p className="mt-2 text-xs text-muted">
          Each step is separate. Approve records an explicit attestation. Apply moves the week&apos;s authority to CURRENT in one atomic step and does <strong>not</strong>{" "}
          publish. Publish is the only step that shows grades on public leaderboards; a later regrade is unpublished until published again.
        </p>
        {state.runs.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No grading runs stored for this week.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {state.runs.map((run) => (
              <RunRow key={run.id} run={run} weekId={weekId} state={state} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function ReviewSections({ review }: { review: WaiverGradingReview }) {
  const d3Count = review.d3.applied.length + review.d3.unresolved.length;
  return (
    <div className="space-y-6">
      <Card title="2 · Preview" badge={<Badge tone={review.status === "READY" ? "success" : "danger"}>{review.status === "READY" ? "Ready to store" : "Blocked"}</Badge>}>
        {review.run ? (
          <p className="mt-2 break-all font-mono text-xs text-muted">
            input {review.run.inputFingerprint}
            <br />
            output {review.run.outputFingerprint} · {review.run.boardGradeCount} boards
          </p>
        ) : null}
        {review.issues.length > 0 ? (
          <div className="mt-3">
            <h4 className="text-sm font-semibold text-danger">Blockers ({review.issues.length})</h4>
            <ul className="mt-1 space-y-1 text-xs text-ink">
              {review.issues.map((issue, i) => (
                <li key={`${issue.code}-${i}`}>
                  <span className="font-mono">{issue.code}</span>
                  {issue.position ? ` · ${issue.position}` : ""} — {issue.detail}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {review.advisories.length > 0 ? (
          <div className="mt-3">
            <h4 className="text-sm font-semibold text-ink">Advisories</h4>
            <ul className="mt-1 space-y-1 text-xs text-muted">
              {review.advisories.map((a, i) => (
                <li key={`${a.code}-${i}`}>
                  <span className="font-mono">{a.code}</span>
                  {a.position ? ` · ${a.position}` : ""} — {a.detail}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="mt-4">
          <h4 className="text-sm font-semibold text-ink">Top finishes by position</h4>
          <div className="mt-2 grid gap-4 lg:grid-cols-2">
            {review.positions.map((p) => (
              <div key={p.position}>
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold text-ink">{p.position}</span>
                  {p.kind === "BLOCKED" ? <Badge tone="danger">blocked</Badge> : null}
                  {p.kind === "EMPTY_ELIGIBLE_POOL" ? <Badge tone="neutral">empty eligible pool</Badge> : null}
                  {p.pool ? (
                    <span className="text-muted">
                      {p.pool.ranked} ranked · {p.pool.nonParticipantZero} DNP · {p.pool.neutralized} neutralized · {p.pool.invalidated} invalidated · {p.boards} boards
                    </span>
                  ) : null}
                </div>
                {p.topFinishes.length > 0 ? (
                  <table className="mt-1 w-full text-left text-xs">
                    <thead className="uppercase tracking-wide text-muted">
                      <tr>
                        <th className="py-1 pr-3">#</th>
                        <th className="py-1 pr-3">Player</th>
                        <th className="py-1 pr-3">FP</th>
                        <th className="py-1 pr-3">Called by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.topFinishes.map((t) => (
                        <tr key={`${p.position}-${t.poolRank}-${t.name}`} className="border-t border-border">
                          <td className="py-1 pr-3 tabular-nums">{t.poolRank}</td>
                          <td className="py-1 pr-3">{t.name}</td>
                          <td className="py-1 pr-3 tabular-nums">{points(t.fpHundredths)}</td>
                          <td className="py-1 pr-3 tabular-nums">{t.calledBy}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <h4 className="text-sm font-semibold text-ink">Zero-point review ({review.zeroPoint.count})</h4>
          <p className="mt-1 text-xs text-muted">
            Players who earn no points: confirm each is a true zero (played for 0.00), a verified non-participant, a neutralized game, or an invalidated call before approving.
          </p>
          {review.zeroPoint.rows.length === 0 ? (
            <p className="mt-1 text-xs text-muted">None.</p>
          ) : (
            <table className="mt-2 w-full text-left text-xs">
              <thead className="uppercase tracking-wide text-muted">
                <tr>
                  <th className="py-1 pr-3">Pos</th>
                  <th className="py-1 pr-3">Player</th>
                  <th className="py-1 pr-3">Treatment</th>
                  <th className="py-1 pr-3">Why</th>
                  <th className="py-1 pr-3">Called by</th>
                </tr>
              </thead>
              <tbody>
                {review.zeroPoint.rows.map((row, i) => (
                  <tr key={`${row.position}-${row.name}-${i}`} className="border-t border-border align-top">
                    <td className="py-1 pr-3">{row.position}</td>
                    <td className="py-1 pr-3">{row.name}</td>
                    <td className="py-1 pr-3 font-mono">{row.treatment}</td>
                    <td className="py-1 pr-3">{row.reason}</td>
                    <td className="py-1 pr-3 tabular-nums">{row.calledBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="mt-4">
          <h4 className="text-sm font-semibold text-ink">D3 snapshot-conflict decisions ({d3Count})</h4>
          <p className="mt-1 text-xs text-muted">
            D3 decisions are recorded separately and bind the artifact revision; this panel never records one. Any undecided conflict blocks the run, and a decision made
            after a run is stored makes that run stale.
          </p>
          {review.d3.applied.length > 0 ? (
            <ul className="mt-1 space-y-1 text-xs text-ink">
              {review.d3.applied.map((r) => (
                <li key={`${r.conflictKey}-${r.sequence}`}>
                  {r.position} · {r.kind} → <span className="font-mono">{r.resolution}</span> (#{r.sequence})
                </li>
              ))}
            </ul>
          ) : null}
          {review.d3.unresolved.length > 0 ? (
            <ul className="mt-1 space-y-1 text-xs text-danger">
              {review.d3.unresolved.map((i, n) => (
                <li key={`${i.code}-${n}`}>
                  <span className="font-mono">{i.code}</span>
                  {i.position ? ` · ${i.position}` : ""} — {i.detail}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="mt-4">
          <h4 className="text-sm font-semibold text-ink">Board scores</h4>
          <p className="mt-1 text-xs text-muted">
            {review.boards.total} boards · {review.boards.scored} scored · {review.boards.zeroCall} zero-call (N/A) · {review.boards.allNeutralized} all-neutralized ·{" "}
            {review.boards.noEffectiveSlots} no effective slots
          </p>
          {review.boards.top.length > 0 ? (
            <table className="mt-2 w-full text-left text-xs">
              <thead className="uppercase tracking-wide text-muted">
                <tr>
                  <th className="py-1 pr-3">Competitor</th>
                  <th className="py-1 pr-3">Pos</th>
                  <th className="py-1 pr-3">Waiver EyeQ</th>
                  <th className="py-1 pr-3">FP</th>
                  <th className="py-1 pr-3">Calls</th>
                  <th className="py-1 pr-3">Exact</th>
                  <th className="py-1 pr-3">Honor</th>
                </tr>
              </thead>
              <tbody>
                {review.boards.top.map((b, i) => (
                  <tr key={`${b.profileId}-${b.position}-${i}`} className="border-t border-border">
                    <td className="py-1 pr-3">
                      {b.profileName}
                      {b.profileType !== "HUMAN" ? <span className="text-muted"> ({b.profileType})</span> : null}
                    </td>
                    <td className="py-1 pr-3">{b.position}</td>
                    <td className="py-1 pr-3 tabular-nums">{b.resultKind === "SCORED" ? points(b.eyeqHundredths) : b.resultKind.replace("NA_", "N/A ")}</td>
                    <td className="py-1 pr-3 tabular-nums">{points(b.totalFpHundredths)}</td>
                    <td className="py-1 pr-3 tabular-nums">{b.calls}</td>
                    <td className="py-1 pr-3 tabular-nums">{b.exactCalls}</td>
                    <td className="py-1 pr-3">{b.honor ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

function RunRow({ run, weekId, state }: { run: WaiverGradingRunView; weekId: string; state: WaiverGradingLifecycleState }) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-ink">Run #{run.runNumber}</span>
        <Badge tone={STAGE_TONE[run.stage]}>{STAGE_LABEL[run.stage]}</Badge>
        <span className="text-xs text-muted">
          {run.sourceKind === "RANKEYEQ_SNAPSHOT" ? "RankEyeQ snapshot" : "SNG artifact"} r{run.artifactRevision} · {run.boardGradeCount} boards · stored {when(run.createdAt)} by {run.initiatedBy}
        </span>
      </div>
      <p className="mt-1 break-all font-mono text-xs text-muted">output {run.outputFingerprint}</p>
      {run.approvals.length > 0 ? (
        <p className="mt-1 text-xs text-muted">
          Approved by {run.approvals.map((a) => `${a.approvedBy} (${a.policy}, ${when(a.approvedAt)})`).join("; ")}
        </p>
      ) : null}
      {run.nextAction === "APPROVE" ? <ApproveForm run={run} /> : null}
      {run.nextAction === "APPLY" ? <ApplyForm run={run} /> : null}
      {run.nextAction === "PUBLISH" && state.authority ? <PublishForm weekId={weekId} changeId={state.authority.changeId} runNumber={run.runNumber} /> : null}
      {run.stage === "PUBLISHED" && state.publication ? (
        <p className="mt-2 text-xs text-success">
          Published {when(state.publication.publishedAt)} by {state.publication.publishedBy}.
        </p>
      ) : null}
    </div>
  );
}

function useStageAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const run = (call: () => Promise<ActionResult & { status?: string }>, success: string) => {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const result = await call();
      if (!result.ok) {
        setError(`${result.code}: ${result.error}`);
        return;
      }
      setNote(success);
      router.refresh();
    });
  };
  return { pending, error, note, run };
}

function ApproveForm({ run }: { run: WaiverGradingRunView }) {
  const { pending, error, note, run: exec } = useStageAction();
  const [reason, setReason] = useState("");
  const [crosswalk, setCrosswalk] = useState(false);
  const [attested, setAttested] = useState(false);
  const [separate, setSeparate] = useState(false);
  const rankeyeq = run.sourceKind === "RANKEYEQ_SNAPSHOT";
  // A RankEyeQ source has no SNG team crosswalk: acknowledging it is not applicable (recorded as N/A acknowledged).
  const ready = reason.trim() && (rankeyeq || crosswalk) && attested;
  return (
    <div className="mt-3 border-t border-border pt-3">
      <h4 className="text-sm font-semibold text-ink">Approve run #{run.runNumber}</h4>
      <label className="mt-2 block text-sm text-muted">
        Reason (required)
        <textarea className={`${inputClass} h-16`} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
      </label>
      {rankeyeq ? (
        <p className="mt-2 text-xs text-muted">DEF team crosswalk: not applicable to a RankEyeQ source (recorded as rankeyeq-native/1, acknowledged as N/A).</p>
      ) : (
        <label className="mt-2 flex items-start gap-2 text-sm">
          <input type="checkbox" checked={crosswalk} onChange={(e) => setCrosswalk(e.target.checked)} />
          <span className="text-muted">I reviewed the DEF team crosswalk version this artifact was imported under.</span>
        </label>
      )}
      <label className="mt-2 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
        <span className="text-muted">{rankeyeq ? WAIVER_GRADING_APPROVAL_RANKEYEQ_ATTESTATION_TEXT : WAIVER_GRADING_APPROVAL_ATTESTATION_TEXT}</span>
      </label>
      <label className="mt-2 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={separate} onChange={(e) => setSeparate(e.target.checked)} />
        <span className="text-muted">Require a separate approver (not the {rankeyeq ? "RankEyeQ snapshot builder" : "artifact importer"} or run creator). Cannot be undone for this week.</span>
      </label>
      <div className="mt-3">
        <Button
          type="button"
          size="sm"
          disabled={pending || !ready}
          onClick={() =>
            exec(
              () =>
                approveWaiverGradeRunAction({
                  gradeRunId: run.id,
                  expectedOutputFingerprint: run.outputFingerprint,
                  reason,
                  acknowledgeDefCrosswalk: rankeyeq ? true : crosswalk,
                  attested,
                  policy: separate ? "SEPARATE_APPROVER" : "SINGLE_ADMIN_EXPLICIT",
                }),
              `Run #${run.runNumber} approved. Apply it next; nothing is applied or published yet.`,
            )
          }
        >
          {pending ? "Approving…" : "Approve run"}
        </Button>
      </div>
      <Message error={error} note={note} />
    </div>
  );
}

function ApplyForm({ run }: { run: WaiverGradingRunView }) {
  const { pending, error, note, run: exec } = useStageAction();
  const [reason, setReason] = useState("");
  return (
    <div className="mt-3 border-t border-border pt-3">
      <h4 className="text-sm font-semibold text-ink">Apply run #{run.runNumber} as the week&apos;s CURRENT authority</h4>
      <p className="mt-1 text-xs text-muted">Moves the week, contest and board authority pointers atomically. This does not publish to public leaderboards.</p>
      <label className="mt-2 block text-sm text-muted">
        Reason (required)
        <textarea className={`${inputClass} h-16`} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="mt-3">
        <Button
          type="button"
          size="sm"
          disabled={pending || !reason.trim() || !run.approvalId}
          onClick={() =>
            exec(
              () => applyWaiverGradeAuthorityAction({ approvalId: run.approvalId, reason }),
              `Run #${run.runNumber} is now the week's CURRENT authority. It is not published.`,
            )
          }
        >
          {pending ? "Applying…" : "Apply authority"}
        </Button>
      </div>
      <Message error={error} note={note} />
    </div>
  );
}

function PublishForm({ weekId, changeId, runNumber }: { weekId: string; changeId: string; runNumber: number }) {
  const { pending, error, note, run: exec } = useStageAction();
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  return (
    <div className="mt-3 border-t border-border pt-3">
      <h4 className="text-sm font-semibold text-ink">Publish official results (run #{runNumber})</h4>
      <p className="mt-1 text-xs text-muted">
        Makes this week&apos;s graded boards visible on the public Waivers leaderboards. Refused if the source was superseded or the live inputs changed.
      </p>
      <label className="mt-2 block text-sm text-muted">
        Reason (required)
        <textarea className={`${inputClass} h-16`} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
      </label>
      <label className="mt-2 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <span className="text-muted">I confirm these results are official and ready for public display.</span>
      </label>
      <div className="mt-3">
        <Button
          type="button"
          size="sm"
          disabled={pending || !reason.trim() || !confirmed}
          onClick={() => exec(() => publishWaiverWeekGradesAction({ weekId, expectedChangeId: changeId, reason }), `Run #${runNumber} is published.`)}
        >
          {pending ? "Publishing…" : "Publish official results"}
        </Button>
      </div>
      <Message error={error} note={note} />
    </div>
  );
}

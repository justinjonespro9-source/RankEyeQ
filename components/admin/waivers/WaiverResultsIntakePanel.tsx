import { Badge } from "@/components/ui/Badge";
import type { WaiverIntakeStatus, WaiverResultsIntake } from "@/lib/waivers/intake/model";

const STATUS: Record<WaiverIntakeStatus, { tone: "success" | "warning" | "danger"; label: string }> = {
  READY_FOR_GRADING_PREVIEW: { tone: "success", label: "Ready for grading preview" },
  D3_DECISIONS_REQUIRED: { tone: "warning", label: "D3 decisions required" },
  INTAKE_BLOCKED: { tone: "danger", label: "Intake blocked" },
  ARTIFACT_NOT_GRADABLE: { tone: "danger", label: "Artifact not gradable" },
};

const CONFLICT_TONE = { RESOLVED: "success", DECISION_REQUIRED: "warning", RESOLUTION_MISMATCH: "danger" } as const;

const points = (value: number | null) => (value === null ? "—" : (value / 100).toFixed(2));
const counts = (record: Partial<Record<string, number>>) =>
  Object.entries(record)
    .map(([key, n]) => `${key} ${n}`)
    .join(" · ") || "—";

/**
 * Read-only results intake: the imported factual results reconciled against
 * the week's frozen contest pools. Nothing here grades, records a D3
 * decision, approves or applies.
 */
export function WaiverResultsIntakePanel({ intake }: { intake: WaiverResultsIntake }) {
  const status = STATUS[intake.status];
  const conflicts = intake.positions.flatMap((p) => p.conflicts.map((c) => ({ ...c, position: p.position })));
  return (
    <section className="mb-6 rounded-lg border border-border bg-surface-elevated p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-lg font-semibold text-ink">Results intake</h3>
        <Badge tone={status.tone}>{status.label}</Badge>
        <Badge tone={intake.artifact.gradable ? "success" : "danger"}>{intake.artifact.gradable ? "Gradable revision" : "Not the gradable revision"}</Badge>
      </div>
      <p className="mt-1 text-xs text-muted">
        Reconciles these factual results with every contest&apos;s pinned frozen pool and the players called on locked boards. Read-only: it does not grade, record D3
        decisions, approve or apply results. Grading preview, approval and application are separate later steps.
      </p>
      <p className="mt-1 text-xs text-muted">
        &ldquo;Ready for grading preview&rdquo; only means intake found nothing left to block the preview. It does not authorize grading, approval, application or
        publication.
      </p>
      <p className="mt-1 break-all font-mono text-xs text-muted">intake {intake.intakeFingerprint}</p>

      {intake.facts ? (
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted">Participants</dt>
            <dd className="text-ink">{intake.facts.participantCount}</dd>
          </div>
          <div>
            <dt className="text-muted">Canonical classes</dt>
            <dd className="text-xs text-ink">{counts(intake.facts.ledgerByClass)}</dd>
          </div>
          <div>
            <dt className="text-muted">Games</dt>
            <dd className="text-xs text-ink">{counts(intake.facts.eventsByDisposition)}</dd>
          </div>
        </dl>
      ) : null}

      {intake.issues.length > 0 ? (
        <div className="mt-4">
          <h4 className="text-sm font-semibold text-danger">Blockers ({intake.issues.length})</h4>
          <ul className="mt-1 space-y-1 text-xs">
            {intake.issues.map((issue, i) => (
              <li key={`${issue.code}-${issue.snapshotEntryId ?? i}`} className="text-ink">
                <span className="font-mono">{issue.stage}</span> · <span className="font-mono">{issue.code}</span>
                {issue.position ? ` · ${issue.position}` : ""}
                {issue.submissionId ? ` · board ${issue.submissionId}` : ""} — {issue.detail}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4">
        <h4 className="text-sm font-semibold text-ink">
          D3 snapshot conflicts · {intake.decisionsRequired} need a decision · {intake.decisionsResolved} decided
        </h4>
        {conflicts.length === 0 ? (
          <p className="mt-1 text-xs text-muted">No snapshot conflicts detected.</p>
        ) : (
          <table className="mt-2 w-full text-left text-xs">
            <thead className="uppercase tracking-wide text-muted">
              <tr>
                <th className="py-1 pr-3">Pos</th>
                <th className="py-1 pr-3">Player</th>
                <th className="py-1 pr-3">Row</th>
                <th className="py-1 pr-3">Conflict</th>
                <th className="py-1 pr-3">Status</th>
                <th className="py-1 pr-3">Decision</th>
              </tr>
            </thead>
            <tbody>
              {conflicts.map((c) => (
                <tr key={c.conflictKey} className="border-t border-border align-top">
                  <td className="py-1 pr-3">{c.position}</td>
                  <td className="py-1 pr-3">{c.displayName}</td>
                  <td className="py-1 pr-3">{c.category === "ELIGIBLE_POOL_MEMBER" ? "pool member" : "called, invalidated"}</td>
                  <td className="py-1 pr-3">
                    {c.kind} — {c.detail}
                  </td>
                  <td className="py-1 pr-3">
                    <Badge tone={CONFLICT_TONE[c.status]}>{c.status.replaceAll("_", " ")}</Badge>
                  </td>
                  <td className="py-1 pr-3">{c.resolution ? `${c.resolution.treatment} (#${c.resolution.sequence})` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="mt-4">
        <h4 className="text-sm font-semibold text-ink">Positions</h4>
        <table className="mt-2 w-full text-left text-xs">
          <thead className="uppercase tracking-wide text-muted">
            <tr>
              <th className="py-1 pr-3">Pos</th>
              <th className="py-1 pr-3">Contest</th>
              <th className="py-1 pr-3">Locked boards</th>
              <th className="py-1 pr-3">Eligible pool</th>
              <th className="py-1 pr-3">Called, invalidated</th>
              <th className="py-1 pr-3">Matched</th>
              <th className="py-1 pr-3">SNG field</th>
              <th className="py-1 pr-3">Classes</th>
            </tr>
          </thead>
          <tbody>
            {intake.positions.map((p) => (
              <tr key={p.position} className="border-t border-border align-top">
                <td className="py-1 pr-3 font-semibold">{p.position}</td>
                <td className="py-1 pr-3">
                  {p.kind === "CONTEST" ? p.contestStatus : p.kind === "EMPTY_ELIGIBLE_POOL" ? "no contest (empty eligible pool)" : "blocked"}
                  {p.snapshotIsCurrent === false ? " · pinned snapshot not current" : ""}
                </td>
                <td className="py-1 pr-3 tabular-nums">
                  {p.lockedBoardCount}
                  {p.lockedBoards.nonHuman > 0 ? ` · ${p.lockedBoards.nonHuman} non-human` : ""}
                  {p.lockedBoards.adminOverride > 0 ? ` · ${p.lockedBoards.adminOverride} admin override` : ""}
                  {p.lockedBoards.aiLateEntry > 0 ? ` · ${p.lockedBoards.aiLateEntry} late entry` : ""}
                  {p.lockedBoards.inactiveNonHuman > 0 ? ` · ${p.lockedBoards.inactiveNonHuman} inactive` : ""}
                </td>
                <td className="py-1 pr-3 tabular-nums">{p.eligiblePoolSize}</td>
                <td className="py-1 pr-3 tabular-nums">{p.invalidatedCalledCount}</td>
                <td className="py-1 pr-3 tabular-nums">
                  {p.matchedCount}/{p.rows.length}
                </td>
                <td className="py-1 pr-3 tabular-nums">{p.artifactFieldSize ?? "—"}</td>
                <td className="py-1 pr-3">{counts(p.byClass)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {intake.positions
          .filter((p) => p.rows.length > 0)
          .map((p) => (
            <details key={p.position} className="mt-2">
              <summary className="cursor-pointer text-xs text-accent-ink">
                {p.position} rows ({p.rows.length})
              </summary>
              <table className="mt-1 w-full text-left text-xs">
                <thead className="uppercase tracking-wide text-muted">
                  <tr>
                    <th className="py-1 pr-3">Player</th>
                    <th className="py-1 pr-3">Row</th>
                    <th className="py-1 pr-3">Identity</th>
                    <th className="py-1 pr-3">SNG participant</th>
                    <th className="py-1 pr-3">Class</th>
                    <th className="py-1 pr-3">FP</th>
                    <th className="py-1 pr-3">SNG rank</th>
                    <th className="py-1 pr-3">Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {p.rows.map((r) => (
                    <tr key={`${r.category}-${r.snapshotEntryId}`} className="border-t border-border align-top">
                      <td className="py-1 pr-3">{r.displayName}</td>
                      <td className="py-1 pr-3">{r.category === "ELIGIBLE_POOL_MEMBER" ? "pool" : "called, invalidated"}</td>
                      <td className="py-1 pr-3 font-mono">
                        {r.identity.provider}:{r.identity.externalId}
                        {r.identitySource === "LIVE_NOT_FROZEN" ? " (live)" : ""}
                      </td>
                      <td className="py-1 pr-3 font-mono">
                        {r.sngParticipantId ?? "—"}
                        {r.positionMismatch ? ` (${r.sngPosition})` : ""}
                      </td>
                      <td className="py-1 pr-3">{r.cls ? `${r.cls} · ${r.disposition}` : "—"}</td>
                      <td className="py-1 pr-3 tabular-nums">{points(r.pointsHundredths)}</td>
                      <td className="py-1 pr-3 tabular-nums">{r.canonicalRank ?? "—"}</td>
                      <td className="py-1 pr-3 font-mono text-danger">{r.issueCodes.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ))}
      </div>

      <div className="mt-4">
        <h4 className="text-sm font-semibold text-ink">Acknowledgments a later grading approval must record</h4>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-ink">
          {intake.acknowledgmentsRequired.map((a) => (
            <li key={a.code}>
              <span className="font-mono">{a.code}</span> — {a.detail}
            </li>
          ))}
        </ul>
      </div>

      {intake.advisories.length > 0 ? (
        <div className="mt-4">
          <h4 className="text-sm font-semibold text-ink">Advisories</h4>
          <ul className="mt-1 space-y-1 text-xs text-muted">
            {intake.advisories.map((a, i) => (
              <li key={`${a.code}-${i}`}>
                <span className="font-mono">{a.code}</span> — {a.detail}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

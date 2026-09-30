import { Badge } from "@/components/ui/Badge";
import type { WaiverSnapshotPreviewView } from "@/lib/waivers/snapshot/actions";

type Issue = WaiverSnapshotPreviewView["issues"][number];

const pct = (bps: number | null) => (bps === null ? "—" : `${(bps / 100).toFixed(2).replace(/\.?0+$/, "")}%`);

function IssueList({ title, issues, tone }: { title: string; issues: Issue[]; tone: "danger" | "warning" | "neutral" }) {
  if (issues.length === 0) return null;
  return (
    <div className="mt-3">
      <h4 className="text-sm font-semibold text-ink">{title}</h4>
      <ul className="mt-1 space-y-1 text-sm">
        {issues.map((issue) => (
          <li key={`${issue.code}-${issue.lineNumbers?.join(",") ?? ""}`} className="flex flex-wrap items-start gap-2">
            <Badge tone={tone}>{issue.code}</Badge>
            <span className="text-muted">
              {issue.message}
              {issue.lineNumbers?.length ? ` (lines ${issue.lineNumbers.join(", ")})` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function stateTone(state: string) {
  if (state === "MATCHED") return "success" as const;
  return "danger" as const;
}

function eligibilityTone(eligibility: string | undefined) {
  if (eligibility === "ELIGIBLE") return "success" as const;
  if (eligibility === "OBSERVATION_ONLY") return "accent" as const;
  return "neutral" as const;
}

/** Read-only rendering of a snapshot preview (nothing here writes). */
export function WaiverSnapshotPreview({ preview }: { preview: WaiverSnapshotPreviewView }) {
  const blockers = preview.issues.filter((issue) => issue.level === "BLOCKER");
  const confirms = preview.issues.filter((issue) => issue.level === "CONFIRM");
  const infos = preview.issues.filter((issue) => issue.level === "INFO");
  return (
    <div className="mt-6 space-y-6">
      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-display text-lg font-semibold text-ink">Preview</h3>
          <Badge tone={blockers.length ? "danger" : "success"}>{blockers.length ? `${blockers.length} blocker(s)` : "No blockers"}</Badge>
          <Badge tone={preview.contestsCanOpen ? "accent" : "warning"}>{preview.contestsCanOpen ? "Before lock" : "Evidence only"}</Badge>
        </div>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted">Candidates</dt>
            <dd className="font-medium tabular-nums text-ink">{preview.counts.candidateCount}</dd>
          </div>
          <div>
            <dt className="text-muted">Eligible</dt>
            <dd className="font-medium tabular-nums text-ink">{preview.counts.eligibleCount}</dd>
          </div>
          <div>
            <dt className="text-muted">Excluded</dt>
            <dd className="font-medium tabular-nums text-ink">{preview.counts.excludedCount}</dd>
          </div>
          <div>
            <dt className="text-muted">Follow-up observations</dt>
            <dd className="font-medium tabular-nums text-ink">{preview.counts.followUpCount}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-muted">
          Official observation: {preview.header.observedAt ?? "—"} · Lock: {preview.locksAt ?? "unresolved"} · Input sha256 {preview.rawInputSha256.slice(0, 12)}…
        </p>
        <IssueList title="Blockers (must be fixed)" issues={blockers} tone="danger" />
        <IssueList title="Confirm before freezing" issues={confirms} tone="warning" />
        <IssueList title="Information" issues={infos} tone="neutral" />
      </section>

      <section className="overflow-x-auto rounded-lg border border-border bg-surface-elevated">
        <table className="w-full min-w-[64rem] text-left text-sm">
          <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-2 py-2">Line</th>
              <th className="px-2 py-2">Source row</th>
              <th className="px-2 py-2">Match</th>
              <th className="px-2 py-2">RankEyeQ player</th>
              <th className="px-2 py-2">Rostered</th>
              <th className="px-2 py-2">Result</th>
              <th className="px-2 py-2">Game</th>
              <th className="px-2 py-2">Availability</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => (
              <tr key={row.lineNumber} className="border-b border-border align-top last:border-0">
                <td className="px-2 py-2 tabular-nums text-muted">{row.lineNumber}</td>
                <td className="px-2 py-2 font-mono text-xs text-ink">{row.line}</td>
                <td className="px-2 py-2">
                  <Badge tone={stateTone(row.state)}>{row.state}</Badge>
                  {row.issues.length ? <div className="mt-1 text-xs text-danger">{row.issues.join(", ")}</div> : null}
                  {row.candidates.length ? (
                    <ul className="mt-1 text-xs text-muted">
                      {row.candidates.map((candidate) => (
                        <li key={candidate.id}>
                          {candidate.name} · {candidate.position} · {candidate.team ?? "FA"} · <span className="font-mono">{candidate.id}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </td>
                <td className="px-2 py-2">
                  {row.entry ? (
                    <>
                      <div className="text-ink">
                        {row.entry.displayNameAtFreeze} · {row.entry.position} · {row.entry.teamAtFreeze ?? "FA"}
                      </div>
                      <div className="text-xs text-muted">
                        {row.entry.matchMethod}
                        {row.entry.tracked ? " · tracked" : ""}
                      </div>
                      {row.entry.teamConflict ? (
                        <Badge tone="warning" className="mt-1">
                          Source team {row.entry.sourceTeam ?? "FA"} ≠ canonical {row.entry.teamAtFreeze ?? "FA"}
                        </Badge>
                      ) : null}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-2 py-2 tabular-nums">{row.entry ? pct(row.entry.rosteredBps) : row.percentRaw}</td>
                <td className="px-2 py-2">
                  {row.entry ? (
                    <>
                      <Badge tone={eligibilityTone(row.entry.eligibility)}>{row.entry.evidenceRole === "FOLLOW_UP" ? "FOLLOW-UP" : row.entry.eligibility}</Badge>
                      {row.entry.exclusionReason ? <div className="mt-1 text-xs text-muted">{row.entry.exclusionReason}</div> : null}
                      {row.entry.exclusionNote ? <div className="text-xs text-muted">{row.entry.exclusionNote}</div> : null}
                    </>
                  ) : null}
                </td>
                <td className="px-2 py-2 text-xs text-muted">
                  {row.entry
                    ? row.entry.isByeAtFreeze
                      ? "BYE"
                      : row.entry.opponentAtFreeze
                        ? `vs ${row.entry.opponentAtFreeze}${row.entry.gameStatusAtFreeze && row.entry.gameStatusAtFreeze !== "SCHEDULED" ? ` (${row.entry.gameStatusAtFreeze})` : ""}`
                        : "No scheduled game"
                    : null}
                </td>
                <td className="px-2 py-2 text-xs text-muted">
                  {row.entry ? (
                    <>
                      {row.entry.availabilityDesignationAtFreeze ?? "—"}
                      {row.entry.rosterStatusAtFreeze ? ` · ${row.entry.rosterStatusAtFreeze}` : ""}
                      {row.entry.hardUnavailableAtFreeze ? " · hard unavailable" : ""}
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="overflow-x-auto rounded-lg border border-border bg-surface-elevated p-4">
        <h3 className="font-display text-lg font-semibold text-ink">Completeness evidence</h3>
        <p className="mt-1 text-xs text-muted">Raw evidence only — no numeric pass/fail thresholds. Source completeness is your attestation.</p>
        <table className="mt-3 w-full min-w-[48rem] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="py-1">Pos</th>
              <th className="py-1">Rankings pool</th>
              <th className="py-1">Observed</th>
              <th className="py-1">Unobserved</th>
              <th className="py-1">Candidates</th>
              <th className="py-1">Follow-ups</th>
              <th className="py-1">Eligible</th>
              <th className="py-1">Excluded</th>
              <th className="py-1">Depth</th>
            </tr>
          </thead>
          <tbody>
            {preview.completeness.byPosition.map((row) => (
              <tr key={row.position} className="tabular-nums">
                <td className="py-1 font-medium text-ink">{row.position}</td>
                <td className="py-1">{row.rankingsPoolCount}</td>
                <td className="py-1">
                  {row.rankingsPoolObserved} ({pct(row.rankingsPoolObservedBps)})
                </td>
                <td className="py-1">
                  {row.rankingsPoolUnobserved} ({pct(row.rankingsPoolUnobservedBps)})
                </td>
                <td className="py-1">{row.candidateRows}</td>
                <td className="py-1">{row.followUpRows}</td>
                <td className="py-1">{row.eligible}</td>
                <td className="py-1">{row.excluded}</td>
                <td className="py-1">
                  {row.effectiveMaxCalls} / {row.maxCalls}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {preview.completeness.previousWeekEligibleMissing.length ? (
          <p className="mt-3 text-sm text-muted">
            Week {preview.completeness.previousWeekNumber} eligible players not in this paste:{" "}
            {preview.completeness.previousWeekEligibleMissing.map((player) => `${player.name} (${player.position})`).join(", ")}
          </p>
        ) : null}
        {preview.completeness.unobservedRankingsPlayers.length ? (
          <details className="mt-2 text-sm text-muted">
            <summary>Rankings-pool players not observed ({preview.completeness.unobservedRankingsPlayers.length})</summary>
            {preview.completeness.unobservedRankingsPlayers.map((player) => `${player.name} (${player.position})`).join(", ")}
          </details>
        ) : null}
      </section>
    </div>
  );
}

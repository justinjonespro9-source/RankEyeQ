import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { WaiverSnapshotCorrectionPanel } from "@/components/admin/waivers/WaiverSnapshotCorrectionPanel";
import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { privatePageMetadata } from "@/lib/seo";
import { formatInChicago } from "@/lib/timing/chicago";
import { WAIVER_POSITIONS } from "@/lib/waivers/constants";
import { loadWaiverSnapshotDetail } from "@/lib/waivers/snapshot/queries";

export const metadata: Metadata = privatePageMetadata("Waiver snapshot · Admin", "Frozen Official Waiver ownership evidence.");

export const dynamic = "force-dynamic";

function when(value: Date | null | undefined) {
  if (!value) return "—";
  return formatInChicago(value, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" });
}

const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
const show = (value: unknown) => (value === null || value === undefined ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value));

export default async function AdminWaiverSnapshotPage({ params }: { params: Promise<{ snapshotId: string }> }) {
  const { snapshotId } = await params;
  const snapshot = await loadWaiverSnapshotDetail(snapshotId);
  if (!snapshot) notFound();

  return (
    <Container className="py-12 sm:py-16">
      <AdminBanner />
      <AdminNav current="/admin/waivers" />
      <SectionHeading
        eyebrow="Waivers"
        title={`${snapshot.week.label} · snapshot v${snapshot.version}`}
        description="Frozen evidence. Entries and correction rows are immutable; a correction always creates a new version."
      />
      <p className="mb-4 text-sm">
        <Link href={`/admin/waivers?weekId=${snapshot.week.id}`} className="text-accent-ink hover:underline">
          ← Back to {snapshot.week.label}
        </Link>
      </p>

      <section className="mb-6 rounded-lg border border-border bg-surface-elevated p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={snapshot.isCurrent ? "success" : "neutral"}>{snapshot.isCurrent ? "CURRENT" : snapshot.status}</Badge>
          {snapshot.correctionCase ? <Badge tone="warning">{snapshot.correctionCase}</Badge> : null}
          {snapshot.supersedes ? (
            <Link href={`/admin/waivers/snapshots/${snapshot.supersedes.id}`} className="text-sm text-accent-ink hover:underline">
              supersedes v{snapshot.supersedes.version}
            </Link>
          ) : null}
          {snapshot.supersededBy ? (
            <Link href={`/admin/waivers/snapshots/${snapshot.supersededBy.id}`} className="text-sm text-accent-ink hover:underline">
              superseded by v{snapshot.supersededBy.version}
            </Link>
          ) : null}
        </div>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-muted">Source</dt>
            <dd className="text-ink">
              {snapshot.sourceLabel}
              {snapshot.sourceUrl ? (
                <>
                  {" · "}
                  <a href={snapshot.sourceUrl} rel="noreferrer noopener" target="_blank" className="text-accent-ink hover:underline">
                    link
                  </a>
                </>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Official observation</dt>
            <dd className="text-ink">{when(snapshot.observedAt)}</dd>
          </div>
          <div>
            <dt className="text-muted">Frozen</dt>
            <dd className="text-ink">
              {when(snapshot.frozenAt)} by {snapshot.frozenBy}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Threshold</dt>
            <dd className="text-ink">&lt; {pct(snapshot.thresholdBps)}</dd>
          </div>
          <div>
            <dt className="text-muted">Eligible / candidates</dt>
            <dd className="tabular-nums text-ink">
              {snapshot.counts.eligibleCount} / {snapshot.counts.candidateCount}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Excluded / follow-ups</dt>
            <dd className="tabular-nums text-ink">
              {snapshot.counts.excludedCount} / {snapshot.counts.followUpCount}
            </dd>
          </div>
          <div className="lg:col-span-2">
            <dt className="text-muted">Fingerprints</dt>
            <dd className="break-all font-mono text-xs text-ink">
              input {snapshot.rawInputSha256} · entries {snapshot.entriesFingerprint}
            </dd>
          </div>
        </dl>
        {snapshot.correctionReason ? <p className="mt-3 text-sm text-muted">Correction reason: {snapshot.correctionReason}</p> : null}
        <p className="mt-3 text-xs text-muted">
          Acknowledged: {snapshot.provenance.acknowledged.join(", ") || "—"}
          {snapshot.importLog ? ` · import log ${snapshot.importLog.id} (${snapshot.importLog.importType})` : ""}
        </p>
        {snapshot.provenance.followUpAcks.length ? (
          <ul className="mt-2 text-xs text-muted">
            {snapshot.provenance.followUpAcks.map((ack) => {
              const player = snapshot.provenance.missingFollowUps.find((row) => row.rankableEntryId === ack.rankableEntryId);
              return (
                <li key={ack.rankableEntryId}>
                  Missing follow-up {player ? `${player.name} (${player.position})` : ack.rankableEntryId}: {ack.reason}
                  {ack.note ? ` — ${ack.note}` : ""}
                </li>
              );
            })}
          </ul>
        ) : null}
        {snapshot.contests.length ? (
          <p className="mt-2 text-xs text-muted">Contests pinned to this version: {snapshot.contests.map((contest) => contest.position).join(", ")}</p>
        ) : null}
      </section>

      {WAIVER_POSITIONS.map((position) => {
        const rows = snapshot.entries.filter((entry) => entry.position === position);
        if (rows.length === 0) return null;
        return (
          <section key={position} className="mb-6 overflow-x-auto rounded-lg border border-border bg-surface-elevated">
            <h3 className="px-4 pt-4 font-display text-lg font-semibold text-ink">{position}</h3>
            <table className="mt-2 w-full min-w-[64rem] text-left text-sm">
              <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-2 py-2">Player</th>
                  <th className="px-2 py-2">Rostered</th>
                  <th className="px-2 py-2">Result</th>
                  <th className="px-2 py-2">Game</th>
                  <th className="px-2 py-2">Availability</th>
                  <th className="px-2 py-2">Source line</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <tr key={entry.id} className="border-b border-border align-top last:border-0">
                    <td className="px-2 py-2">
                      <div className="text-ink">
                        {entry.displayNameAtFreeze} · {entry.teamAtFreeze ?? "FA"}
                      </div>
                      <div className="text-xs text-muted">
                        {entry.matchMethod}
                        {entry.tracked ? " · tracked" : ""}
                      </div>
                      {entry.sourceTeamConflict ? (
                        <Badge tone="warning" className="mt-1">
                          Source team {entry.sourceTeamConflict}
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 tabular-nums">{pct(entry.rosteredBps)}</td>
                    <td className="px-2 py-2">
                      <Badge tone={entry.eligibility === "ELIGIBLE" ? "success" : entry.eligibility === "OBSERVATION_ONLY" ? "accent" : "neutral"}>
                        {entry.evidenceRole === "FOLLOW_UP" ? "FOLLOW-UP" : entry.eligibility}
                      </Badge>
                      {entry.exclusionReason ? <div className="mt-1 text-xs text-muted">{entry.exclusionReason}</div> : null}
                      {entry.exclusionNote ? <div className="text-xs text-muted">{entry.exclusionNote}</div> : null}
                    </td>
                    <td className="px-2 py-2 text-xs text-muted">
                      {entry.isByeAtFreeze
                        ? "BYE"
                        : entry.opponentAtFreeze
                          ? `vs ${entry.opponentAtFreeze} · ${when(entry.kickoffAtFreeze)}${entry.gameStatusAtFreeze && entry.gameStatusAtFreeze !== "SCHEDULED" ? ` (${entry.gameStatusAtFreeze})` : ""}`
                          : "No scheduled game"}
                    </td>
                    <td className="px-2 py-2 text-xs text-muted">
                      {entry.availabilityDesignationAtFreeze ?? "—"}
                      {entry.rosterStatusAtFreeze ? ` · ${entry.rosterStatusAtFreeze}` : ""}
                      {entry.hardUnavailableAtFreeze ? " · hard unavailable" : ""}
                      <div className="font-mono">{entry.availabilitySourceAtFreeze}</div>
                    </td>
                    <td className="px-2 py-2 font-mono text-xs text-muted">
                      {entry.inputLineNumber}: {entry.inputLine}
                      <div>
                        {entry.sourceLabel} · {when(entry.observedAt)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}

      {snapshot.corrections.length ? (
        <section className="mb-6 overflow-x-auto rounded-lg border border-border bg-surface-elevated p-4">
          <h3 className="font-display text-lg font-semibold text-ink">Corrections that produced this version</h3>
          <table className="mt-2 w-full min-w-[64rem] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="py-1">Player</th>
                <th className="py-1">Field</th>
                <th className="py-1">Before</th>
                <th className="py-1">After</th>
                <th className="py-1">Eligibility</th>
                <th className="py-1">Case / policy</th>
                <th className="py-1">Affected</th>
                <th className="py-1">Reason</th>
                <th className="py-1">Operator</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.corrections.map((row) => (
                <tr key={row.id} className="border-t border-border align-top">
                  <td className="py-1 font-mono text-xs">{row.rankableEntryId}</td>
                  <td className="py-1 font-mono text-xs">{row.field}</td>
                  <td className="max-w-xs truncate py-1 font-mono text-xs" title={show(row.originalValue)}>
                    {show(row.originalValue)}
                  </td>
                  <td className="max-w-xs truncate py-1 font-mono text-xs" title={show(row.correctedValue)}>
                    {show(row.correctedValue)}
                  </td>
                  <td className="py-1 text-xs">
                    {row.eligibilityBefore ?? "—"} → {row.eligibilityAfter ?? "—"}
                  </td>
                  <td className="py-1 text-xs">
                    {row.correctionCase} · {row.policy}
                  </td>
                  <td className="py-1 text-xs tabular-nums">{row.affectedSubmissionCount}</td>
                  <td className="py-1 text-xs">{row.reason}</td>
                  <td className="py-1 text-xs">
                    {row.operator} · {when(row.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {snapshot.isCurrent ? (
        <WaiverSnapshotCorrectionPanel
          snapshotId={snapshot.id}
          version={snapshot.version}
          entries={snapshot.entries.map((entry) => ({
            rankableEntryId: entry.rankableEntryId,
            name: entry.displayNameAtFreeze,
            position: entry.position,
            team: entry.teamAtFreeze,
            rosteredBps: entry.rosteredBps,
            eligibility: entry.eligibility,
          }))}
        />
      ) : null}
    </Container>
  );
}

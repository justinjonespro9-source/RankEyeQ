import type { Metadata } from "next";
import Link from "next/link";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmSubmit } from "@/components/ui/ConfirmSubmit";
import { SectionHeading } from "@/components/ui/SectionHeading";
import {
  WEEKLY_CONTENT_SUPPRESSION_REASON_MAX,
  getOfficialBoardAdminDetail,
  getOfficialBoardsWeekOps,
  previewMissingOfficialBoardFinals,
  type AdminBoardVersionView,
  type FinalReadinessState,
  type FinalRowState,
  type OfficialBoardDiagnostic,
  type WeeklyContentModerationRow,
} from "@/lib/admin/official-boards";
import {
  captureMissingOfficialBoardFinalsAction,
  restoreWeeklyContentAction,
  suppressWeeklyContentAction,
} from "@/lib/admin/official-boards-actions";
import { prisma } from "@/lib/db";
import { privatePageMetadata } from "@/lib/seo";
import { formatInChicago } from "@/lib/timing/chicago";
import { weeklyContentTypeLabel } from "@/lib/weekly-content-shared";

export const metadata: Metadata = privatePageMetadata(
  "Official Boards · Admin",
  "Inspect Official RankEyeQ Board publication, FINAL receipts and weekly content.",
);

export const dynamic = "force-dynamic";

const linkClass =
  "rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-sm font-medium text-ink hover:border-ink/30";

function when(value: Date | null | undefined) {
  if (!value) return "—";
  return formatInChicago(value, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

function readinessTone(state: FinalReadinessState) {
  if (state === "READY") return "success" as const;
  if (state === "MISSING") return "danger" as const;
  return "neutral" as const;
}

function finalTone(state: FinalRowState) {
  if (state === "CAPTURED") return "success" as const;
  if (state === "MISSING") return "danger" as const;
  return "neutral" as const;
}

const FINAL_LABEL: Record<FinalRowState, string> = {
  CAPTURED: "Captured",
  MISSING: "Missing",
  PENDING_FULL_LOCK: "At full lock",
  PRE_ACTIVATION: "Pre-activation",
  NOT_REQUIRED: "Not required",
};

function diagnosticTone(diagnostic: OfficialBoardDiagnostic) {
  if (diagnostic.severity === "error") return "danger" as const;
  if (diagnostic.severity === "warning") return "warning" as const;
  return "neutral" as const;
}

export default async function AdminOfficialBoardsPage({
  searchParams,
}: {
  searchParams: Promise<{
    weekId?: string;
    preview?: string;
    submission?: string;
    notice?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const weeks = await prisma.week.findMany({
    where: { season: { active: true } },
    orderBy: { weekNumber: "asc" },
    select: { id: true, label: true, status: true },
  });
  const weekId =
    params.weekId ??
    weeks.find((week) => week.status === "OPEN" || week.status === "LOCKED")?.id ??
    weeks[0]?.id ??
    null;
  const ops = weekId ? await getOfficialBoardsWeekOps(weekId) : null;
  const preview =
    ops && params.preview === "1"
      ? await previewMissingOfficialBoardFinals(ops.week.id)
      : null;
  const detail = params.submission
    ? await getOfficialBoardAdminDetail(params.submission)
    : null;
  const captureBlockers = ops
    ? [
        ...(!ops.activation.active
          ? [
              "This week is before Official Boards FINAL activation. FINAL receipts are never created for pre-activation weeks.",
            ]
          : []),
        ...(ops.activation.active && !ops.activation.finalsRequired
          ? ["FINAL receipts are captured only after the Sunday full lock."]
          : []),
      ]
    : [];

  return (
    <Container className="py-12 sm:py-16">
      <AdminBanner />
      <AdminNav current="/admin/official-boards" />
      <SectionHeading
        eyebrow="Weekly Ops"
        title="Official Boards"
        description="Inspect publication, immutable PUBLISHED / FINAL versions and weekly content. Competitive truth stays in the submission; this page never publishes, edits or deletes boards."
      />

      {!ops ? (
        <p className="text-sm text-muted">No active NFL week configured.</p>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap gap-2">
            {weeks.map((week) => (
              <Link
                key={week.id}
                href={`/admin/official-boards?weekId=${week.id}`}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  week.id === ops.week.id
                    ? "bg-accent text-ink"
                    : "border border-border bg-surface-elevated text-ink"
                }`}
              >
                {week.label}
              </Link>
            ))}
          </div>

          {params.notice ? (
            <p className="mb-4 rounded-md border border-success/30 bg-success-soft px-3 py-2 text-sm text-success" role="status">
              {params.notice}
            </p>
          ) : null}
          {params.error ? (
            <p className="mb-4 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
              {params.error}
            </p>
          ) : null}

          <section className="mb-6 rounded-lg border border-border bg-surface-elevated p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl font-semibold text-ink">
                {ops.week.label} · {ops.week.seasonYear}
              </h2>
              <Badge tone="neutral">{ops.week.status}</Badge>
              <Badge tone={ops.activation.active ? "accent" : "neutral"}>
                {ops.activation.active ? "FINAL receipts active" : "Pre-activation"}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-muted">
              Sunday full lock: {when(ops.week.fullLockAt)} · FINAL receipts begin
              with weeks locking at or after {when(ops.activation.finalsStartAt)}.
            </p>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-4 lg:grid-cols-8">
              <SummaryCell label="Eligible owner-authored" value={ops.summary.eligibleOwnerAuthored} />
              <SummaryCell label="Protected" value={ops.summary.protected} />
              <SummaryCell label="Published" value={ops.summary.published} />
              <SummaryCell label="FINAL complete" value={ops.summary.finalComplete} />
              <SummaryCell label="Missing FINAL" value={ops.summary.missingFinal} alert={ops.summary.missingFinal > 0} />
              <SummaryCell label="Weekly content" value={ops.summary.weeklyContentAttached} />
              <SummaryCell label="Content hidden" value={ops.summary.weeklyContentSuppressed} />
              <SummaryCell label="Diagnostics" value={ops.summary.diagnostics} alert={ops.summary.diagnostics > 0} />
            </dl>
          </section>

          <section className="mb-6 overflow-x-auto rounded-lg border border-border bg-surface-elevated">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-3">Pos</th>
                  <th className="px-3 py-3">Contest</th>
                  <th className="px-3 py-3">FINAL readiness</th>
                  <th className="px-3 py-3">Captured</th>
                  <th className="px-3 py-3">Missing</th>
                  <th className="px-3 py-3">Detail</th>
                </tr>
              </thead>
              <tbody>
                {ops.contests.map((contest) => (
                  <tr key={contest.contestId} className="border-b border-border last:border-0">
                    <td className="px-3 py-3 font-medium text-ink">{contest.position}</td>
                    <td className="px-3 py-3">
                      <Link href={`/admin/contests/${contest.contestId}`} className="text-accent-ink hover:underline">
                        {contest.contestStatus}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={readinessTone(contest.state)}>
                        {contest.gradingBlockedUntilCaptured ? "Grading blocked" : contest.state.replaceAll("_", " ")}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 tabular-nums">{contest.captured}</td>
                    <td className="px-3 py-3 tabular-nums">{contest.missing}</td>
                    <td className="px-3 py-3 text-muted">{contest.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="mb-8 grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-border bg-surface-elevated p-5">
              <h3 className="font-display text-lg font-semibold text-ink">Preview Missing FINALs</h3>
              <p className="mt-1 text-sm text-muted">
                Runs the canonical FINAL planner. Zero writes.
              </p>
              <Link
                href={`/admin/official-boards?weekId=${ops.week.id}&preview=1`}
                className={`mt-3 inline-block ${linkClass}`}
              >
                Preview Missing FINALs
              </Link>
              {preview ? (
                <div className="mt-4 text-sm">
                  <p className="font-medium text-ink">
                    Would create {preview.totalWouldCreate} FINAL receipt(s).
                  </p>
                  <ul className="mt-2 space-y-1 text-muted">
                    {preview.contests.map((contest) => (
                      <li key={contest.contestId}>
                        {contest.position}:{" "}
                        {contest.skipped
                          ? `skipped (${contest.skipped.replaceAll("_", " ")})`
                          : contest.wouldCreate.length > 0
                            ? contest.wouldCreate.map((row) => `@${row.username}`).join(", ")
                            : `nothing missing (${contest.alreadyCaptured} captured)`}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
            <div className="rounded-lg border border-border bg-surface-elevated p-5">
              <h3 className="font-display text-lg font-semibold text-ink">Capture Missing FINALs</h3>
              <p className="mt-1 mb-3 text-sm text-muted">
                Same canonical capture the full-lock lifecycle and grading
                backstop use. Idempotent, never replaces an existing FINAL, and
                audited.
              </p>
              <ConfirmSubmit
                action={captureMissingOfficialBoardFinalsAction}
                submitLabel="Capture Missing FINALs"
                impact={`Capture any missing FINAL receipts for ${ops.week.label}. Existing FINAL receipts are never replaced.`}
                blockers={captureBlockers}
                confirmPhrase="CAPTURE"
              >
                <input type="hidden" name="weekId" value={ops.week.id} />
              </ConfirmSubmit>
            </div>
          </section>

          <section className="mb-8">
            <h3 className="mb-3 font-display text-lg font-semibold text-ink">Boards</h3>
            <div className="overflow-x-auto rounded-lg border border-border bg-surface-elevated">
              <table className="w-full min-w-[80rem] text-left text-sm">
                <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-3">Ranker</th>
                    <th className="px-3 py-3">Pos</th>
                    <th className="px-3 py-3">Type</th>
                    <th className="px-3 py-3">Authority</th>
                    <th className="px-3 py-3">Submission</th>
                    <th className="px-3 py-3">Publication</th>
                    <th className="px-3 py-3">Published versions</th>
                    <th className="px-3 py-3">FINAL</th>
                    <th className="px-3 py-3">Weekly content</th>
                    <th className="px-3 py-3">Grading</th>
                    <th className="px-3 py-3">Diagnostics</th>
                    <th className="px-3 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {ops.rows.map((row) => (
                    <tr key={row.submissionId} className="border-b border-border align-top last:border-0">
                      <td className="px-3 py-3">
                        <p className="font-medium text-ink">{row.displayName}</p>
                        <p className="text-xs text-muted">@{row.username}</p>
                      </td>
                      <td className="px-3 py-3 text-ink">{row.position}</td>
                      <td className="px-3 py-3 text-ink">{row.profileType}</td>
                      <td className="px-3 py-3 text-ink">
                        {row.resolvedAuthority ?? "Unknown"}
                        {row.storedAuthority == null ? (
                          <span className="block text-xs text-muted">legacy (inferred)</span>
                        ) : null}
                        {!row.officialBoard ? (
                          <span className="block text-xs text-muted">Not an Official Board</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-ink">
                        {row.submissionStatus}
                        <span className="block text-xs text-muted">
                          {row.pickCount} slots{row.eligible ? " · eligible" : ""}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        {row.officialBoard ? (
                          <Badge tone={row.publication.state === "PUBLISHED" ? "accent" : "neutral"}>
                            {row.publication.state === "PUBLISHED" ? "Published" : "Protected"}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-3 text-ink">
                        {row.publishedVersionCount > 0
                          ? `${row.publishedVersionCount} · latest v${row.publication.latestVersionNumber ?? "?"}`
                          : "—"}
                        {row.publication.lastPublishedAt ? (
                          <span className="block text-xs text-muted">{when(row.publication.lastPublishedAt)}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={finalTone(row.final.state)}>{FINAL_LABEL[row.final.state]}</Badge>
                        {row.final.createdAt ? (
                          <span className="block text-xs text-muted">captured {when(row.final.createdAt)}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-ink">
                        {row.weeklyContent.count > 0
                          ? `${row.weeklyContent.count} · ${row.weeklyContent.types.map(weeklyContentTypeLabel).join(", ")}`
                          : "—"}
                        {row.weeklyContent.suppressed > 0 ? (
                          <span className="block text-xs text-warning">{row.weeklyContent.suppressed} hidden</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-ink">
                        {row.grading.graded ? `Graded · ${row.grading.normalizedScore ?? "—"}` : row.contestStatus}
                      </td>
                      <td className="px-3 py-3">
                        {row.diagnostics.length === 0 ? (
                          <Badge tone="success">OK</Badge>
                        ) : (
                          <ul className="space-y-1">
                            {row.diagnostics.map((diagnostic) => (
                              <li key={diagnostic.code}>
                                <Badge tone={diagnosticTone(diagnostic)} title={diagnostic.message}>
                                  {diagnostic.code.replaceAll("_", " ")}
                                </Badge>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <Link
                          href={`/admin/official-boards?weekId=${ops.week.id}&submission=${row.submissionId}#inspect`}
                          className="text-accent-ink hover:underline"
                        >
                          Inspect
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {ops.rows.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="px-3 py-6 text-muted">
                        No HUMAN or Creator boards for this week yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          {detail ? (
            <section id="inspect" className="mb-8 rounded-lg border border-border bg-surface-elevated p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-display text-lg font-semibold text-ink">
                  {detail.profile.displayName} · {detail.contest.position} · {detail.week.label}
                </h3>
                <Badge tone="neutral">{detail.submission.status}</Badge>
                <Badge tone="neutral">{detail.submission.resolvedAuthority ?? "Unknown authority"}</Badge>
              </div>
              <p className="mt-1 text-sm text-muted">
                Read-only. Competitive submission fingerprint{" "}
                <code className="text-xs">{detail.submission.fingerprint.slice(0, 16)}</code>
                {" · "}submitted {when(detail.submission.submittedAt)} · locked {when(detail.submission.lockedAt)}
              </p>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div>
                  <h4 className="text-sm font-semibold text-ink">Current competitive submission</h4>
                  <ol className="mt-2 space-y-0.5 text-sm">
                    {detail.submission.picks.map((pick) => (
                      <li key={pick.predictedRank} className="text-ink">
                        {pick.predictedRank > detail.contest.rankingDepth
                          ? `R${pick.predictedRank - detail.contest.rankingDepth}`
                          : pick.predictedRank}
                        . {pick.name} <span className="text-muted">{pick.team}</span>
                        {pick.slotLocked ? <span className="text-xs text-muted"> · slot locked</span> : null}
                        {pick.wasUnavailableAtKickoff ? (
                          <span className="text-xs text-warning"> · unavailable at kickoff</span>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-ink">Scoring Board</h4>
                  {detail.scoringBoard ? (
                    <ol className="mt-2 space-y-0.5 text-sm">
                      {detail.scoringBoard.map((row) => (
                        <li key={row.rankableEntryId} className="text-ink">
                          {row.scoringRank}. {row.name}
                          {row.fromReserve ? <span className="text-xs text-muted"> · from R{row.reserveSlot}</span> : null}
                          <span className="text-muted"> · {row.totalPoints} pts</span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="mt-2 text-sm text-muted">Available once the board is graded.</p>
                  )}
                </div>
              </div>

              <div className="mt-6 space-y-3">
                <h4 className="text-sm font-semibold text-ink">
                  Immutable versions
                  {detail.publication
                    ? ` · first published ${when(detail.publication.firstPublishedAt)} · last ${when(detail.publication.lastPublishedAt)}`
                    : " · never published (Protected)"}
                </h4>
                {detail.final ? <VersionDetails version={detail.final} depth={detail.contest.rankingDepth} /> : (
                  <p className="text-sm text-muted">No FINAL receipt.</p>
                )}
                {[...detail.published].reverse().map((version) => (
                  <VersionDetails key={version.id} version={version} depth={detail.contest.rankingDepth} />
                ))}
              </div>

              <div className="mt-6">
                <h4 className="text-sm font-semibold text-ink">Weekly content</h4>
                {detail.weeklyContent.length === 0 ? (
                  <p className="mt-1 text-sm text-muted">None attached.</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-sm">
                    {detail.weeklyContent.map((item) => (
                      <li key={item.id} className="text-ink">
                        {weeklyContentTypeLabel(item.type)} · {item.title}{" "}
                        <span className="text-muted">({item.host ?? "invalid host"})</span>
                        {item.suppressedAt ? <span className="text-xs text-warning"> · hidden</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          ) : null}

          <section className="mb-8">
            <h3 className="mb-1 font-display text-lg font-semibold text-ink">Weekly content moderation</h3>
            <p className="mb-3 text-sm text-muted">
              Noncompetitive. Hiding a link removes it from public display only;
              the owner still sees it. Every action is audited.
            </p>
            <div className="overflow-x-auto rounded-lg border border-border bg-surface-elevated">
              <table className="w-full min-w-[56rem] text-left text-sm">
                <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-3">Profile</th>
                    <th className="px-3 py-3">Link</th>
                    <th className="px-3 py-3">Type</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {ops.weeklyContent.map((item) => (
                    <ModerationRow key={item.id} item={item} weekId={ops.week.id} />
                  ))}
                  {ops.weeklyContent.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-muted">No weekly content for this week.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </Container>
  );
}

function SummaryCell({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className={`mt-1 text-lg font-semibold tabular-nums ${alert ? "text-danger" : "text-ink"}`}>{value}</dd>
    </div>
  );
}

function VersionDetails({ version, depth }: { version: AdminBoardVersionView; depth: number }) {
  return (
    <details className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
      <summary className="cursor-pointer text-ink">
        {version.kind === "FINAL" ? "FINAL" : `PUBLISHED v${version.versionNumber}`} · created {when(version.createdAt)}
        {version.boardLockedAt ? ` · lock boundary ${when(version.boardLockedAt)}` : ""}
        {version.authorEmail ? ` · by ${version.authorEmail}` : ""}
        <span className="text-muted"> · fp {version.fingerprint.slice(0, 16)}</span>
      </summary>
      <ol className="mt-2 space-y-0.5">
        {version.picks.map((pick) => (
          <li key={pick.boardRank} className="text-ink">
            {pick.isReserve ? `R${pick.reserveSlot ?? pick.boardRank - depth}` : pick.boardRank}. {pick.displayName}{" "}
            <span className="text-muted">{pick.displayTeam}</span>
            {pick.slotLocked ? (
              <span className="text-xs text-muted"> · slot locked {when(pick.lockedAt)} at #{pick.lockedRank ?? "—"}</span>
            ) : null}
          </li>
        ))}
      </ol>
    </details>
  );
}

function ModerationRow({ item, weekId }: { item: WeeklyContentModerationRow; weekId: string }) {
  return (
    <tr className="border-b border-border align-top last:border-0">
      <td className="px-3 py-3">
        <p className="font-medium text-ink">{item.displayName}</p>
        <p className="text-xs text-muted">@{item.username}</p>
      </td>
      <td className="px-3 py-3">
        <p className="text-ink">{item.title}</p>
        <p className="break-all text-xs text-muted">{item.host ?? "invalid host"} · {item.url}</p>
      </td>
      <td className="px-3 py-3 text-ink">
        {weeklyContentTypeLabel(item.type)}
        <span className="block text-xs text-muted">{item.position ?? "All positions"}</span>
      </td>
      <td className="px-3 py-3">
        {item.suppressedAt ? (
          <>
            <Badge tone="warning">Hidden</Badge>
            <span className="mt-1 block text-xs text-muted">
              {item.suppressionReason} · {item.suppressedByEmail ?? "admin"} · {when(item.suppressedAt)}
            </span>
          </>
        ) : (
          <Badge tone="success">Visible</Badge>
        )}
      </td>
      <td className="px-3 py-3">
        {item.suppressedAt ? (
          <form action={restoreWeeklyContentAction}>
            <input type="hidden" name="weekId" value={weekId} />
            <input type="hidden" name="id" value={item.id} />
            <Button type="submit" size="sm" variant="secondary">Restore</Button>
          </form>
        ) : (
          <form action={suppressWeeklyContentAction} className="flex flex-wrap gap-2">
            <input type="hidden" name="weekId" value={weekId} />
            <input type="hidden" name="id" value={item.id} />
            <input
              name="reason"
              required
              maxLength={WEEKLY_CONTENT_SUPPRESSION_REASON_MAX}
              placeholder="Reason (unsafe, spam, …)"
              aria-label="Moderation reason"
              className="w-48 rounded-md border border-border bg-surface px-2 py-1 text-sm"
            />
            <Button type="submit" size="sm" variant="secondary">Hide</Button>
          </form>
        )}
      </td>
    </tr>
  );
}

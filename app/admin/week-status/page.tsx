import type { Metadata } from "next";
import Link from "next/link";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SectionHeading } from "@/components/ui/SectionHeading";
import {
  bulkMarkAvailableAction,
  bulkMarkOutAction,
  clearWeekManualOverrideAction,
  setWeekPlayerStatusAction,
  syncNflInjuryStatusAction,
  syncWeekStatusFromProviderAction,
} from "@/lib/admin-week-status-actions";
import {
  DESIGNATION_FULL_LABEL,
  loadWeekStatusBoard,
  WEEKLY_DESIGNATION_VALUES,
} from "@/lib/admin/week-status";
import { getLastInjurySyncAt } from "@/lib/nfl/injury-sync";
import { prisma } from "@/lib/db";
import { formatInChicago } from "@/lib/timing/chicago";
import type { ContestPosition } from "@/lib/generated/prisma/client";

export const metadata: Metadata = {
  title: "Week status · Admin",
  description:
    "Update weekly player availability (injury/inactive) separately from NFL roster status.",
};

export const dynamic = "force-dynamic";

const POSITIONS: Array<ContestPosition | "ALL"> = [
  "ALL",
  "QB",
  "RB",
  "WR",
  "TE",
  "DEF",
];

export default async function AdminWeekStatusPage({
  searchParams,
}: {
  searchParams: Promise<{
    weekId?: string;
    position?: string;
    team?: string;
    q?: string;
    synced?: string;
    matched?: string;
    updated?: string;
    unchanged?: string;
    skippedManual?: string;
    skippedKickoff?: string;
    failed?: string;
    questionable?: string;
    doubtful?: string;
    out?: string;
    unmatched?: string;
    source?: string;
    syncError?: string;
  }>;
}) {
  const params = await searchParams;
  const weeks = await prisma.week.findMany({
    where: { season: { active: true }, isTest: false },
    orderBy: { weekNumber: "asc" },
    include: { season: true },
  });
  const weekId =
    params.weekId ??
    weeks.find((week) => week.status === "OPEN")?.id ??
    weeks[0]?.id ??
    null;
  const positionParam = (params.position ?? "ALL").toUpperCase();
  const position = (
    POSITIONS.includes(positionParam as ContestPosition | "ALL")
      ? positionParam
      : "ALL"
  ) as ContestPosition | "ALL";
  const team = params.team ?? "";
  const q = params.q ?? "";

  const rows = weekId
    ? await loadWeekStatusBoard({
        weekId,
        position,
        team: team || undefined,
        query: q || undefined,
      })
    : [];
  const lastSyncAt = weekId ? await getLastInjurySyncAt(weekId) : null;

  const unmatchedAudit =
    weekId && params.synced
      ? await prisma.adminAuditLog.findFirst({
          where: {
            action: "week_status.injury_synced",
            entityId: weekId,
          },
          orderBy: { createdAt: "desc" },
          select: { metadata: true, createdAt: true },
        })
      : null;
  const unmatchedNames =
    unmatchedAudit?.metadata &&
    typeof unmatchedAudit.metadata === "object" &&
    unmatchedAudit.metadata !== null &&
    "unmatchedNames" in unmatchedAudit.metadata &&
    Array.isArray(
      (unmatchedAudit.metadata as { unmatchedNames?: unknown }).unmatchedNames,
    )
      ? ((unmatchedAudit.metadata as { unmatchedNames: string[] }).unmatchedNames ??
        [])
      : [];

  function href(next: {
    weekId?: string;
    position?: string;
    team?: string;
    q?: string;
  }) {
    const query = new URLSearchParams({
      weekId: next.weekId ?? weekId ?? "",
      position: next.position ?? position,
      ...(next.team ?? team ? { team: next.team ?? team } : {}),
      ...(next.q ?? q ? { q: next.q ?? q } : {}),
    });
    return `/admin/week-status?${query.toString()}`;
  }

  return (
    <Container className="py-10 sm:py-12">
      <AdminBanner />
      <AdminNav current="/admin/week-status" />
      <SectionHeading
        eyebrow="Weekly eligibility"
        title="Week player status"
        description="Roster status (SeasonPlayer) is separate from weekly game availability (PlayerWeekAvailability). Roster ACTIVE does not mean AVAILABLE for the week — a player can remain on the 53-man roster and still be OUT. Manual overrides are never overwritten by injury sync until cleared."
      />

      {params.synced ? (
        <div
          className={`mb-4 rounded-md border px-3 py-3 text-sm ${
            params.synced === "1"
              ? "border-accent/30 bg-accent-soft text-accent-ink"
              : "border-danger/30 bg-danger-soft text-danger"
          }`}
          role="status"
        >
          <p className="font-medium">
            NFL injury report sync{" "}
            {params.synced === "1" ? "complete" : "failed"} · source{" "}
            {params.source ?? "none"}
          </p>
          <p className="mt-1">
            Matched {params.matched ?? "0"} · Updated {params.updated ?? "0"} ·
            Unchanged {params.unchanged ?? "0"} · Skipped manual{" "}
            {params.skippedManual ?? "0"} · Failed {params.failed ?? "0"} · Q{" "}
            {params.questionable ?? "0"} · D {params.doubtful ?? "0"} · Out{" "}
            {params.out ?? "0"} · Unmatched {params.unmatched ?? "0"}
          </p>
          {params.syncError ? (
            <p className="mt-1">{params.syncError}</p>
          ) : null}
          {unmatchedNames.length > 0 ? (
            <p className="mt-2 text-xs">
              Unmatched for review: {unmatchedNames.join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        {weeks.map((week) => (
          <Link
            key={week.id}
            href={href({ weekId: week.id })}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              week.id === weekId
                ? "bg-accent text-ink"
                : "border border-border bg-surface-elevated text-ink"
            }`}
          >
            {week.label}
          </Link>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {POSITIONS.map((pos) => (
          <Link
            key={pos}
            href={href({ position: pos })}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              pos === position
                ? "bg-accent text-ink"
                : "border border-border bg-surface-elevated text-ink"
            }`}
          >
            {pos}
          </Link>
        ))}
      </div>

      <form className="mb-4 flex flex-wrap items-end gap-2" method="get">
        <input type="hidden" name="weekId" value={weekId ?? ""} />
        <input type="hidden" name="position" value={position} />
        <label className="text-sm">
          <span className="text-muted">Team</span>
          <input
            name="team"
            defaultValue={team}
            placeholder="LV"
            className="mt-1 block w-24 rounded-md border border-border bg-surface px-2 py-1.5"
          />
        </label>
        <label className="text-sm">
          <span className="text-muted">Search</span>
          <input
            name="q"
            defaultValue={q}
            placeholder="Bowers"
            className="mt-1 block w-48 rounded-md border border-border bg-surface px-2 py-1.5"
          />
        </label>
        <Button type="submit">Filter</Button>
      </form>

      {weekId ? (
        <div className="mb-4 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <form action={syncNflInjuryStatusAction}>
              <input type="hidden" name="weekId" value={weekId} />
              <input type="hidden" name="position" value={position} />
              <Button type="submit">Sync NFL Injury Report</Button>
            </form>
            <form action={syncWeekStatusFromProviderAction}>
              <input type="hidden" name="weekId" value={weekId} />
              <Button type="submit" variant="secondary">
                Sync NFL Roster Status
              </Button>
            </form>
            {lastSyncAt ? (
              <span className="text-xs text-muted">
                Last injury sync:{" "}
                {formatInChicago(lastSyncAt, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  timeZoneName: "short",
                })}
              </span>
            ) : (
              <span className="text-xs text-muted">No injury sync yet</span>
            )}
          </div>
          <p className="text-xs text-muted max-w-3xl">
            <strong className="font-medium text-ink">Injury report</strong>{" "}
            writes week-specific designations from the NFL.com injuries page
            Game Status column only. Players not listed, or listed without a Game
            Status, stay UNKNOWN — sync never invents AVAILABLE. Third-party
            sources (including CBS) are disabled. Manual overrides are never
            overwritten.{" "}
            <strong className="font-medium text-ink">Roster status</strong>{" "}
            updates IR / PUP / SUSPENDED / FREE_AGENT / ACTIVE from season roster
            membership only — it does not invent weekly injury designations.
          </p>
        </div>
      ) : null}

      <form action={setWeekPlayerStatusAction}>
        <input type="hidden" name="weekId" value={weekId ?? ""} />
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="text-muted">Weekly designation</span>
            <select
              name="designation"
              defaultValue="OUT"
              className="mt-1 block rounded-md border border-border bg-surface px-2 py-1.5"
            >
              {WEEKLY_DESIGNATION_VALUES.map((status) => (
                <option key={status} value={status}>
                  {DESIGNATION_FULL_LABEL[status]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-muted">Injury / note</span>
            <input
              name="injuryDescription"
              placeholder="ankle; limited Wed"
              className="mt-1 block w-48 rounded-md border border-border bg-surface px-2 py-1.5"
            />
          </label>
          <label className="text-sm">
            <span className="text-muted">Source URL</span>
            <input
              name="sourceUrl"
              placeholder="https://…"
              className="mt-1 block w-52 rounded-md border border-border bg-surface px-2 py-1.5"
            />
          </label>
          <label className="text-sm">
            <span className="text-muted">Source time</span>
            <input
              name="sourcePublishedAt"
              type="datetime-local"
              className="mt-1 block rounded-md border border-border bg-surface px-2 py-1.5"
            />
          </label>
          <Button type="submit">Save manual override</Button>
          <Button formAction={bulkMarkOutAction} type="submit" variant="secondary">
            Bulk OUT
          </Button>
          <Button
            formAction={bulkMarkAvailableAction}
            type="submit"
            variant="secondary"
          >
            Bulk AVAILABLE
          </Button>
          <Button
            formAction={clearWeekManualOverrideAction}
            type="submit"
            variant="secondary"
          >
            Clear override
          </Button>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[64rem] text-left text-sm">
            <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">Select</th>
                <th className="px-3 py-2">Player</th>
                <th className="px-3 py-2">Pos</th>
                <th className="px-3 py-2">Team</th>
                <th className="px-3 py-2">Roster</th>
                <th className="px-3 py-2">Weekly</th>
                <th className="px-3 py-2">Note</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Updated</th>
                <th className="px-3 py-2">Eligible</th>
                <th className="px-3 py-2">Kickoff</th>
                <th className="px-3 py-2">On boards</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const selectable = !row.excluded && row.resolved.selectable;
                return (
                  <tr
                    key={row.contestEntryId}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        name="rankableEntryId"
                        value={row.rankableEntryId}
                      />
                    </td>
                    <td className="px-3 py-2 font-medium text-ink">
                      {row.name}
                      {row.manualOverride ? (
                        <Badge tone="warning" className="ml-2">
                          Override
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">{row.position}</td>
                    <td className="px-3 py-2">{row.team}</td>
                    <td className="px-3 py-2">
                      <Badge
                        tone={
                          row.resolved.rosterUnavailable ? "warning" : "neutral"
                        }
                      >
                        {row.nflStatus ?? "—"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        tone={
                          row.resolved.weeklyUnavailable ||
                          row.resolved.rosterUnavailable
                            ? "warning"
                            : row.designation === "QUESTIONABLE" ||
                                row.designation === "DOUBTFUL" ||
                                row.designation === "UNKNOWN"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {row.designation}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-muted max-w-[10rem] truncate">
                      {row.injuryDescription ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-muted text-xs">
                      {row.sourceType ?? "—"}
                      {row.sourceUrl ? (
                        <>
                          <br />
                          <a
                            href={row.sourceUrl}
                            className="underline"
                            target="_blank"
                            rel="noreferrer"
                          >
                            link
                          </a>
                        </>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-muted text-xs">
                      {row.observedAt
                        ? formatInChicago(row.observedAt, {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {row.excluded ? (
                        <span className="text-muted">Excluded</span>
                      ) : selectable ? (
                        <span className="text-accent-ink">Selectable</span>
                      ) : (
                        <span className="text-warning">
                          {row.resolved.unavailableReason ?? "Not addable"}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted">
                      {row.kickoffAt
                        ? formatInChicago(row.kickoffAt, {
                            weekday: "short",
                            hour: "numeric",
                            minute: "2-digit",
                            timeZoneName: "short",
                          })
                        : "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {row.selectionCount}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={12}
                    className="px-3 py-6 text-center text-muted"
                  >
                    No weekly field players for this filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </form>
    </Container>
  );
}

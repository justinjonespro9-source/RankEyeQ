import type { Metadata } from "next";
import Link from "next/link";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SectionHeading } from "@/components/ui/SectionHeading";
import {
  bulkMarkActiveAction,
  bulkMarkOutAction,
  setWeekPlayerStatusAction,
  syncWeekStatusFromProviderAction,
} from "@/lib/admin-week-status-actions";
import {
  loadWeekStatusBoard,
  WEEKLY_AVAILABILITY_VALUES,
} from "@/lib/admin/week-status";
import {
  AVAILABILITY_FULL_LABEL,
  isSelectableAvailability,
} from "@/lib/eligibility/weekly-status";
import { prisma } from "@/lib/db";
import { formatInChicago } from "@/lib/timing/chicago";
import type { ContestPosition } from "@/lib/generated/prisma/client";

export const metadata: Metadata = {
  title: "Week status · Admin",
  description: "Update weekly player availability for human + AI eligibility.",
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
        description="Canonical RankableEntry.availability for human pool + AI prompts. OUT/IR/PUP/etc. block new adds; QUESTIONABLE/DOUBTFUL stay selectable. Kickoff locks still win after game start."
      />

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
        <div className="mb-4 flex flex-wrap gap-2">
          <form action={syncWeekStatusFromProviderAction}>
            <input type="hidden" name="weekId" value={weekId} />
            <Button type="submit" variant="secondary">
              Sync from season NFL status
            </Button>
          </form>
        </div>
      ) : null}

      <form action={setWeekPlayerStatusAction}>
        <input type="hidden" name="weekId" value={weekId ?? ""} />
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="text-muted">Set status</span>
            <select
              name="availability"
              defaultValue="OUT"
              className="mt-1 block rounded-md border border-border bg-surface px-2 py-1.5"
            >
              {WEEKLY_AVAILABILITY_VALUES.map((status) => (
                <option key={status} value={status}>
                  {AVAILABILITY_FULL_LABEL[status]}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit">Apply to selected</Button>
          <Button formAction={bulkMarkOutAction} type="submit" variant="secondary">
            Bulk OUT
          </Button>
          <Button
            formAction={bulkMarkActiveAction}
            type="submit"
            variant="secondary"
          >
            Bulk ACTIVE
          </Button>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-3 py-2">Select</th>
                <th className="px-3 py-2">Player</th>
                <th className="px-3 py-2">Pos</th>
                <th className="px-3 py-2">Team</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Eligible</th>
                <th className="px-3 py-2">Kickoff</th>
                <th className="px-3 py-2">On boards</th>
                <th className="px-3 py-2">NFL roster</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const selectable =
                  !row.excluded && isSelectableAvailability(row.availability);
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
                    <td className="px-3 py-2 font-medium text-ink">{row.name}</td>
                    <td className="px-3 py-2">{row.position}</td>
                    <td className="px-3 py-2">{row.team}</td>
                    <td className="px-3 py-2">
                      <Badge
                        tone={
                          row.availability === "OUT" ||
                          row.availability === "IR" ||
                          row.availability === "SUSPENDED"
                            ? "warning"
                            : row.availability === "QUESTIONABLE" ||
                                row.availability === "DOUBTFUL"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {row.availability}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      {row.excluded ? (
                        <span className="text-muted">Excluded</span>
                      ) : selectable ? (
                        <span className="text-accent-ink">Selectable</span>
                      ) : (
                        <span className="text-warning">Not addable</span>
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
                    <td className="px-3 py-2 tabular-nums">{row.selectionCount}</td>
                    <td className="px-3 py-2 text-muted">
                      {row.nflStatus ?? "—"}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
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

import type { Metadata } from "next";
import Link from "next/link";
import { AdminBanner } from "@/components/admin/AdminBanner";
import { AdminNav } from "@/components/admin/AdminNav";
import { Container } from "@/components/layout/Container";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SectionHeading } from "@/components/ui/SectionHeading";
import {
  activateWeeklyPlayerAction,
  bulkActivateWeeklyPlayersAction,
  deactivateWeeklyPlayerAction,
  suggestWeeklyPoolAction,
  syncSeasonPlayersAction,
} from "@/lib/admin-manual-actions";
import { prisma } from "@/lib/db";
import { getWeeklyEligibilityBoard } from "@/lib/nfl/weekly-eligibility";
import type { ContestPosition } from "@/lib/generated/prisma/client";

export const metadata: Metadata = {
  title: "Weekly player pools",
  description: "Activate season players for weekly RankEyeQ contests.",
};

export const dynamic = "force-dynamic";

const POSITIONS: ContestPosition[] = ["QB", "RB", "WR", "TE", "DEF"];

export default async function AdminWeeklyPoolsPage({
  searchParams,
}: {
  searchParams: Promise<{ weekId?: string; position?: string }>;
}) {
  const params = await searchParams;
  const activeSeason = await prisma.season.findFirst({
    where: { active: true, sport: "NFL" },
    include: {
      weeks: { orderBy: { weekNumber: "asc" } },
    },
  });

  const weekId =
    params.weekId ??
    activeSeason?.weeks.find((week) => week.status === "OPEN")?.id ??
    activeSeason?.weeks[0]?.id ??
    null;

  const position = (
    POSITIONS.includes((params.position?.toUpperCase() ?? "") as ContestPosition)
      ? params.position!.toUpperCase()
      : "RB"
  ) as ContestPosition;

  const board =
    weekId != null
      ? await getWeeklyEligibilityBoard({ weekId, position })
      : null;

  const suggestedIds =
    board?.rows
      .filter((row) => row.suggested && !row.active)
      .map((row) => row.rankableEntryId) ?? [];

  function href(next: { weekId?: string; position?: string }) {
    const query = new URLSearchParams({
      weekId: next.weekId ?? weekId ?? "",
      position: next.position ?? position,
    });
    return `/admin/weekly-pools?${query.toString()}`;
  }

  return (
    <Container className="py-10 sm:py-12">
      <AdminBanner />
      <AdminNav current="/admin/weekly-pools" />
      <SectionHeading
        eyebrow="Weekly eligibility"
        title="Weekly player pools"
        description="Season universe → sync eligible weekly field → admin data-integrity exclusions only. All rostered players on scheduled teams are selectable by default — not editorially gated."
      />

      {!activeSeason ? (
        <p className="text-sm text-muted">No active NFL season configured.</p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {activeSeason.weeks.map((week) => (
              <Link
                key={week.id}
                href={href({ weekId: week.id })}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  weekId === week.id
                    ? "bg-accent text-white"
                    : "border border-border bg-surface-elevated text-ink"
                }`}
              >
                {week.label}
              </Link>
            ))}
          </div>
          <div className="mb-6 flex flex-wrap gap-2">
            {POSITIONS.map((pos) => (
              <Link
                key={pos}
                href={href({ position: pos })}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  position === pos
                    ? "bg-accent-soft text-accent"
                    : "border border-border bg-surface-elevated text-ink"
                }`}
              >
                {pos}
              </Link>
            ))}
          </div>

          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <form
              action={syncSeasonPlayersAction}
              className="rounded-lg border border-border bg-surface-elevated p-4"
            >
              <h2 className="font-display text-lg font-semibold text-ink">
                Sync season universe
              </h2>
              <p className="mt-1 text-sm text-muted">
                Import active master-directory players into the {activeSeason.year}{" "}
                season roster without duplicating identities.
              </p>
              <input type="hidden" name="seasonId" value={activeSeason.id} />
              <input type="hidden" name="position" value={position} />
              <Button type="submit" size="sm" className="mt-3" variant="secondary">
                Sync {position} players
              </Button>
            </form>

            {weekId ? (
              <form
                action={suggestWeeklyPoolAction}
                className="rounded-lg border border-border bg-surface-elevated p-4"
              >
                <h2 className="font-display text-lg font-semibold text-ink">
                  Sync weekly eligible field
                </h2>
                <p className="mt-1 text-sm text-muted">
                  Activates all roster-eligible {position} players on scheduled
                  teams for this week. Use exclude only for data corrections
                  (suspended, duplicate, not rostered).
                </p>
                <input type="hidden" name="weekId" value={weekId} />
                <input type="hidden" name="position" value={position} />
                <Button type="submit" size="sm" className="mt-3">
                  Sync {position} field
                </Button>
              </form>
            ) : null}
          </div>

          {board && board.contest && suggestedIds.length > 0 ? (
            <form
              action={bulkActivateWeeklyPlayersAction}
              className="mb-4 rounded-lg border border-accent/30 bg-accent-soft/30 p-4"
            >
              <input type="hidden" name="contestId" value={board.contest.id} />
              <input
                type="hidden"
                name="rankableEntryIds"
                value={suggestedIds.join(",")}
              />
              <Button type="submit" size="sm">
                Activate all {suggestedIds.length} suggested players
              </Button>
            </form>
          ) : null}

          {board ? (
            <div className="overflow-x-auto rounded-lg border border-border bg-surface-elevated">
              <table className="w-full min-w-[56rem] text-left text-sm">
                <thead className="border-b border-border bg-surface text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-2">Player</th>
                    <th className="px-3 py-2">Team</th>
                    <th className="px-3 py-2">Week team</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Actual</th>
                    <th className="px-3 py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {board.rows.map((row) => (
                    <tr key={row.rankableEntryId} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 font-medium text-ink">{row.name}</td>
                      <td className="px-3 py-2">{row.team}</td>
                      <td className="px-3 py-2">{row.weekTeam ?? "—"}</td>
                      <td className="px-3 py-2">
                        {!row.inWeeklyContest ? (
                          <Badge tone="neutral">Not in week</Badge>
                        ) : row.active ? (
                          <Badge tone="success">Active</Badge>
                        ) : row.suggested ? (
                          <Badge tone="warning">Suggested</Badge>
                        ) : (
                          <Badge tone="neutral">Inactive</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {row.actualRank ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        {row.inWeeklyContest && row.contestEntryId ? (
                          row.active ? (
                            <form action={deactivateWeeklyPlayerAction}>
                              <input type="hidden" name="weekId" value={weekId!} />
                              <input
                                type="hidden"
                                name="contestEntryId"
                                value={row.contestEntryId}
                              />
                              <Button type="submit" size="sm" variant="secondary">
                                Deactivate
                              </Button>
                            </form>
                          ) : (
                            <form action={activateWeeklyPlayerAction}>
                              <input type="hidden" name="weekId" value={weekId!} />
                              <input type="hidden" name="position" value={position} />
                              <input
                                type="hidden"
                                name="rankableEntryId"
                                value={row.rankableEntryId}
                              />
                              <Button type="submit" size="sm">
                                Activate
                              </Button>
                            </form>
                          )
                        ) : (
                          <form action={activateWeeklyPlayerAction}>
                            <input type="hidden" name="weekId" value={weekId!} />
                            <input type="hidden" name="position" value={position} />
                            <input
                              type="hidden"
                              name="rankableEntryId"
                              value={row.rankableEntryId}
                            />
                            <Button type="submit" size="sm" variant="secondary">
                              Add to week
                            </Button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      )}
    </Container>
  );
}

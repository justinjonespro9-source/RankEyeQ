/**
 * Unified Player Availability Engine — Preview (zero-write) + Sync.
 *
 * Sources remain auditable separately:
 * 1. NFL.com current roster Status
 * 2. NFL.com weekly injury Game Status
 * Practice is informational only (never infers OUT).
 */

import { prisma } from "@/lib/db";
import {
  syncWeekInjuriesFromNflCom,
  type InjurySyncSummary,
} from "@/lib/nfl/injury-sync";
import {
  syncCurrentSeasonRosterStatusesFromNflCom,
  ROSTER_STALE_AFTER_MS,
  type RosterStatusSyncSummary,
} from "@/lib/nfl/roster-status-sync";
import { syncWeekAvailabilityFromSeasonPlayers } from "@/lib/admin/week-status";
import {
  isRosterUnavailableStatus,
  resolvePlayerWeekStatus,
  type WeeklyDesignation,
} from "@/lib/eligibility/player-week-availability";
import type { FetchLike } from "@/lib/providers/nfl/nflcom/fetch-rosters";
import type { NormalizedRosterBundle } from "@/lib/providers/nfl/nflcom/fetch-rosters";

export { ROSTER_STALE_AFTER_MS };

export type PlayerAvailabilityEngineResult = {
  ok: boolean;
  apply: boolean;
  weekId: string;
  seasonId: string;
  roster: RosterStatusSyncSummary;
  injury: InjurySyncSummary;
  resolved: {
    eligible: number;
    rosterUnavailable: number;
    weeklyOut: number;
    weeklyInactive: number;
    weeklyQuestionable: number;
    weeklyDoubtful: number;
    noOfficialStatus: number;
  };
  operatorMessage: string;
  errors: string[];
};

export function formatPlayerAvailabilityOperatorMessage(
  result: PlayerAvailabilityEngineResult,
): string {
  const verb = result.apply ? "SYNC" : "PREVIEW";
  const r = result.roster;
  const i = result.injury;
  const statusLines = Object.entries(r.byNextStatus)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `${count} → ${status}`);

  return [
    `PLAYER AVAILABILITY ${verb} ${result.ok ? "✓" : "FAILED"}`,
    "",
    "ROSTER",
    `NFL.com fetched: ${r.syncedAt.toISOString()}`,
    `${r.teamCount} teams`,
    `${r.liveFantasyPlayers} fantasy players on source`,
    `${r.matched} matched`,
    `${r.updated} status changes${result.apply ? " applied" : " proposed"}`,
    `${r.unchanged} unchanged`,
    `${r.skippedConflicts} identity conflicts skipped`,
    `${r.unmatchedLive} unmatched live fantasy rows`,
    ...(statusLines.length ? ["Changes by status:", ...statusLines] : []),
    ...(r.errors[0] ? [`Roster error: ${r.errors[0]}`] : []),
    "",
    "INJURY REPORT",
    `NFL.com fetched: ${i.syncedAt.toISOString()}`,
    `${i.sourceRowCount} rows fetched`,
    `${i.officialGameStatusCount} official Game Status`,
    `${i.blankGameStatusCount} awaiting official status`,
    `${i.matched} fantasy players matched`,
    `${i.out} OUT · ${i.questionable} Q · ${i.doubtful} D`,
    `${i.unmatched} unmatched`,
    `Designation changes: ${i.designationChanges}`,
    `Practice-context-only: ${i.practiceContextOnlyChanges}`,
    `Injury-description-only: ${i.injuryDescriptionOnlyChanges}`,
    `Practice tiers: DNP ${i.practiceTierCounts.DNP} · Limited ${i.practiceTierCounts.LIMITED} · Full ${i.practiceTierCounts.FULL}`,
    `Updated: ${i.updated} · Unchanged: ${i.unchanged} · Errors: ${i.failed}`,
    "",
    "RESOLVED WEEK",
    `${result.resolved.eligible} eligible`,
    `${result.resolved.rosterUnavailable} roster-unavailable`,
    `${result.resolved.weeklyOut} weekly OUT`,
    `${result.resolved.weeklyInactive} weekly INACTIVE`,
    `${result.resolved.weeklyQuestionable} weekly QUESTIONABLE`,
    `${result.resolved.weeklyDoubtful} weekly DOUBTFUL`,
    `${result.resolved.noOfficialStatus} no official status yet`,
  ].join("\n");
}

async function loadResolvedWeekCounts(input: {
  weekId: string;
  seasonId: string;
}) {
  const contests = await prisma.rankIQContest.findMany({
    where: { weekId: input.weekId },
    select: { id: true },
  });
  const entries = await prisma.contestEntry.findMany({
    where: { contestId: { in: contests.map((c) => c.id) }, excluded: false },
    select: {
      rankableEntryId: true,
      rankableEntry: {
        select: {
          weekAvailabilities: {
            where: { weekId: input.weekId },
            take: 1,
          },
          seasonPlayers: {
            where: { seasonId: input.seasonId },
            take: 1,
            select: { nflStatus: true },
          },
        },
      },
    },
  });

  let eligible = 0;
  let rosterUnavailable = 0;
  let weeklyOut = 0;
  let weeklyInactive = 0;
  let weeklyQuestionable = 0;
  let weeklyDoubtful = 0;
  let noOfficialStatus = 0;

  for (const entry of entries) {
    const weekAvail = entry.rankableEntry.weekAvailabilities[0] ?? null;
    const nflStatus =
      entry.rankableEntry.seasonPlayers[0]?.nflStatus ?? null;
    const resolved = resolvePlayerWeekStatus({
      nflStatus,
      weekDesignation: weekAvail?.designation as WeeklyDesignation | undefined,
      manualOverride: weekAvail?.manualOverride,
      sourceType: weekAvail?.sourceType,
    });
    if (resolved.selectable) eligible += 1;
    if (resolved.rosterUnavailable) rosterUnavailable += 1;
    if (resolved.designation === "OUT") weeklyOut += 1;
    if (resolved.designation === "INACTIVE") weeklyInactive += 1;
    if (resolved.designation === "QUESTIONABLE") weeklyQuestionable += 1;
    if (resolved.designation === "DOUBTFUL") weeklyDoubtful += 1;
    if (
      !resolved.rosterUnavailable &&
      !resolved.manualOverride &&
      (resolved.designation === "UNKNOWN" || weekAvail == null)
    ) {
      noOfficialStatus += 1;
    }
  }

  return {
    eligible,
    rosterUnavailable,
    weeklyOut,
    weeklyInactive,
    weeklyQuestionable,
    weeklyDoubtful,
    noOfficialStatus,
  };
}

async function runEngine(input: {
  weekId: string;
  apply: boolean;
  fetchFn?: FetchLike;
  rosterBundle?: NormalizedRosterBundle;
  nflHtml?: string;
}): Promise<PlayerAvailabilityEngineResult> {
  const week = await prisma.week.findUnique({
    where: { id: input.weekId },
    select: { id: true, seasonId: true },
  });
  if (!week) {
    throw new Error(`Week not found: ${input.weekId}`);
  }

  const roster = await syncCurrentSeasonRosterStatusesFromNflCom({
    seasonId: week.seasonId,
    apply: input.apply,
    bundle: input.rosterBundle,
    fetchFn: input.fetchFn,
  });

  if (input.apply) {
    await syncWeekAvailabilityFromSeasonPlayers(week.id);
  }

  const injury = await syncWeekInjuriesFromNflCom({
    weekId: week.id,
    apply: input.apply,
    fetchFn: input.fetchFn as
      | import("@/lib/providers/nfl/nflcom/fetch-injuries").FetchLike
      | undefined,
    nflHtml: input.nflHtml,
  });

  const resolved = await loadResolvedWeekCounts({
    weekId: week.id,
    seasonId: week.seasonId,
  });

  const errors = [...roster.errors, ...injury.errors];
  const result: PlayerAvailabilityEngineResult = {
    ok: roster.ok && injury.ok && errors.length === 0,
    apply: input.apply,
    weekId: week.id,
    seasonId: week.seasonId,
    roster,
    injury,
    resolved,
    operatorMessage: "",
    errors,
  };
  result.operatorMessage = formatPlayerAvailabilityOperatorMessage(result);
  return result;
}

/** Zero-write preview of roster + injury reconciliation for a week. */
export async function previewPlayerAvailability(input: {
  weekId: string;
  fetchFn?: FetchLike;
  rosterBundle?: NormalizedRosterBundle;
  nflHtml?: string;
}): Promise<PlayerAvailabilityEngineResult> {
  return runEngine({ ...input, apply: false });
}

/** Apply roster status refresh + injury Game Status sync for a week. */
export async function syncPlayerAvailability(input: {
  weekId: string;
  fetchFn?: FetchLike;
  rosterBundle?: NormalizedRosterBundle;
  nflHtml?: string;
}): Promise<PlayerAvailabilityEngineResult> {
  return runEngine({ ...input, apply: true });
}

export function isRosterSyncStale(
  rosterSyncedAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!rosterSyncedAt) return true;
  return now.getTime() - rosterSyncedAt.getTime() > ROSTER_STALE_AFTER_MS;
}

export function countHardUnavailableInPool(
  nflStatuses: Array<string | null | undefined>,
): number {
  return nflStatuses.filter((s) => isRosterUnavailableStatus(s)).length;
}

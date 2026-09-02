"use server";

import { revalidatePath } from "next/cache";
import { logAdminAction } from "@/lib/admin/audit";
import { assertAdmin } from "@/lib/auth/session";
import { auditAllPools } from "@/lib/nfl/manual/pool-audit";
import {
  commitManualPoolPaste,
  copyPreviousWeekPools,
  previewManualPoolPaste,
} from "@/lib/nfl/manual/pool-import";
import {
  createMasterPlayer,
  searchMasterPlayers,
  updateMasterPlayer,
} from "@/lib/nfl/manual/players";
import {
  commitFantasyPointsPaste,
  previewFantasyPointsPaste,
} from "@/lib/nfl/manual/results-paste";
import {
  buildDefensePoolFromSchedule,
  commitManualSchedule,
  previewManualSchedule,
} from "@/lib/nfl/manual/schedule-import";
import { RATE_LIMITS, rateLimit, rateLimitErrorMessage } from "@/lib/rate-limit";
import { rateLimitKey } from "@/lib/request-ip";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logAdminImpact } from "@/lib/log";
import {
  syncSeasonPlayersFromDirectory,
  enrollSeasonPlayer,
} from "@/lib/season-players";
import {
  bootstrapSeasonRosterFromNflCom,
  formatRosterBootstrapSummary,
} from "@/lib/nfl/roster-bootstrap";
import {
  bulkActivateWeeklyPlayers,
  suggestWeeklyPoolFromSeason,
  activateWeeklyPlayer,
  deactivateWeeklyPlayer,
} from "@/lib/nfl/weekly-eligibility";

function revalidateManual(weekId?: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/data");
  revalidatePath("/admin/players");
  revalidatePath("/admin/weekly-pools");
  revalidatePath("/players");
  revalidatePath("/admin/contests");
  revalidatePath("/admin/weekly-pools");
  revalidatePath("/players");
  revalidatePath("/leaderboards/live");
  if (weekId) {
    revalidatePath(`/admin/data?weekId=${weekId}`);
    revalidatePath(`/admin?weekId=${weekId}`);
  }
}

async function assertManualRateLimit() {
  const limited = rateLimit({
    key: await rateLimitKey("admin-import"),
    ...RATE_LIMITS.adminImport,
  });
  if (!limited.ok) throw new Error(rateLimitErrorMessage(limited));
}

export async function previewManualScheduleAction(input: { text: string }) {
  await assertAdmin();
  return { ok: true as const, preview: await previewManualSchedule(input.text) };
}

export async function commitManualScheduleAction(input: {
  weekId: string;
  text: string;
}) {
  const admin = await assertAdmin();
  await assertManualRateLimit();
  try {
    const result = await commitManualSchedule({
      weekId: input.weekId,
      text: input.text,
      adminUserId: admin.user.id,
    });
    await logAdminAction({
      adminUserId: admin.user.id,
      action: "manual.schedule_imported",
      entityType: "Week",
      entityId: input.weekId,
      metadata: result,
    });
    revalidateManual(input.weekId);
    return { ok: true as const, result };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Schedule import failed",
    };
  }
}

export async function copyPreviousWeekPoolsAction(input: {
  weekId: string;
  sourceWeekId?: string;
}) {
  const admin = await assertAdmin();
  await assertManualRateLimit();
  try {
    const result = await copyPreviousWeekPools({
      targetWeekId: input.weekId,
      sourceWeekId: input.sourceWeekId,
      adminUserId: admin.user.id,
    });
    await logAdminAction({
      adminUserId: admin.user.id,
      action: "manual.pools_copied",
      entityType: "Week",
      entityId: input.weekId,
      metadata: result,
    });
    revalidateManual(input.weekId);
    return { ok: true as const, result };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Copy pools failed",
    };
  }
}

export async function previewManualPoolAction(input: {
  text: string;
  fixedPosition?: ContestPosition;
}) {
  await assertAdmin();
  const preview = await previewManualPoolPaste(input);
  return { ok: true as const, preview };
}

export async function commitManualPoolAction(input: {
  weekId: string;
  text: string;
  fixedPosition?: ContestPosition;
  confirmCreates?: boolean;
}) {
  const admin = await assertAdmin();
  await assertManualRateLimit();
  try {
    const result = await commitManualPoolPaste({
      weekId: input.weekId,
      text: input.text,
      adminUserId: admin.user.id,
      fixedPosition: input.fixedPosition,
      confirmCreates: input.confirmCreates,
    });
    await logAdminAction({
      adminUserId: admin.user.id,
      action: "manual.pool_imported",
      entityType: "Week",
      entityId: input.weekId,
      metadata: { ...result, position: input.fixedPosition ?? "ALL" },
    });
    revalidateManual(input.weekId);
    return { ok: true as const, result };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Pool import failed",
    };
  }
}

export async function buildDefPoolFromScheduleAction(input: { weekId: string }) {
  const admin = await assertAdmin();
  await assertManualRateLimit();
  try {
    const result = await buildDefensePoolFromSchedule({
      weekId: input.weekId,
      adminUserId: admin.user.id,
    });
    revalidateManual(input.weekId);
    return { ok: true as const, result };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "DEF pool build failed",
    };
  }
}

export async function auditPoolsAction(input: { weekId: string }) {
  await assertAdmin();
  const audit = await auditAllPools(input.weekId);
  return { ok: true as const, audit };
}

export async function previewFantasyPointsAction(input: {
  weekId: string;
  text: string;
  position?: ContestPosition;
}) {
  await assertAdmin();
  const preview = await previewFantasyPointsPaste(input);
  return { ok: true as const, preview };
}

export async function commitFantasyPointsAction(input: {
  weekId: string;
  text: string;
  position?: ContestPosition;
  provisional?: boolean;
}) {
  const admin = await assertAdmin();
  await assertManualRateLimit();
  try {
    const result = await commitFantasyPointsPaste({
      weekId: input.weekId,
      text: input.text,
      adminUserId: admin.user.id,
      position: input.position,
      provisional: input.provisional,
    });
    await logAdminAction({
      adminUserId: admin.user.id,
      action: input.provisional
        ? "manual.provisional_points"
        : "manual.fantasy_points",
      entityType: "Week",
      entityId: input.weekId,
      metadata: result,
    });
    revalidateManual(input.weekId);
    return { ok: true as const, result };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Fantasy points import failed",
    };
  }
}

export async function openContestsIfPoolsReadyAction(formData: FormData) {
  const admin = await assertAdmin();
  const weekId = String(formData.get("weekId") || "");
  const force = String(formData.get("force") || "") === "1";

  if (force) {
    const audit = await auditAllPools(weekId);
    await logAdminAction({
      adminUserId: admin.user.id,
      action: "manual.open_contests_override",
      entityType: "Week",
      entityId: weekId,
      metadata: { blockers: audit.blockers },
    });
    await prisma.rankIQContest.updateMany({
      where: { weekId, status: { in: ["DRAFT"] } },
      data: { status: "OPEN" },
    });
    logAdminImpact("contests.opened", { weekId, force });
    revalidateManual(weekId);
    return { ok: true as const, audit };
  }

  try {
    const { openWeekRankings } = await import("@/lib/admin/open-week-rankings");
    const result = await openWeekRankings({
      weekId,
      adminUserId: admin.user.id,
    });
    revalidateManual(weekId);
    return { ok: true as const, audit: result.readiness, opened: result.opened.length };
  } catch (error) {
    const { OpenWeekRankingsError } = await import("@/lib/admin/open-week-rankings");
    if (error instanceof OpenWeekRankingsError) {
      const audit = await auditAllPools(weekId);
      return {
        ok: false as const,
        error: error.blockers.join(" "),
        blockers: error.blockers,
        audit,
      };
    }
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Unable to open contests",
    };
  }
}

export async function searchMasterPlayersAction(input: {
  query?: string;
  position?: ContestPosition | "ALL";
  active?: "ALL" | "ACTIVE" | "INACTIVE";
  missingTeam?: boolean;
  possibleDuplicates?: boolean;
}) {
  await assertAdmin();
  const rows = await searchMasterPlayers(input);
  return { ok: true as const, rows };
}

export async function updateMasterPlayerAction(formData: FormData) {
  const admin = await assertAdmin();
  const id = String(formData.get("id") || "");
  await updateMasterPlayer({
    id,
    name: String(formData.get("name") || undefined) || undefined,
    team: String(formData.get("team") || undefined) || undefined,
    position: (String(formData.get("position") || "") || undefined) as
      | ContestPosition
      | undefined,
    active: String(formData.get("active") || "") === "1",
    headshotUrl: String(formData.get("headshotUrl") || "") || null,
    adminNotes: String(formData.get("adminNotes") || "") || null,
  });
  await logAdminAction({
    adminUserId: admin.user.id,
    action: "manual.player_updated",
    entityType: "RankableEntry",
    entityId: id,
  });
  revalidatePath("/admin/players");
  revalidatePath("/admin/weekly-pools");
  revalidatePath("/players");
}

export async function bootstrapNflRosterAction(input: { seasonId: string }) {
  const admin = await assertAdmin();
  await assertManualRateLimit();
  try {
    const report = await bootstrapSeasonRosterFromNflCom({
      seasonId: input.seasonId,
      runWeeklySync: true,
    });
    await logAdminAction({
      adminUserId: admin.user.id,
      action: "nfl.roster_bootstrap",
      entityType: "Season",
      entityId: input.seasonId,
      metadata: report,
    });
    revalidatePath("/admin/data");
    revalidatePath("/admin/players");
    revalidatePath("/admin/weekly-pools");
    revalidatePath("/players");
    return {
      ok: true as const,
      report,
      summary: formatRosterBootstrapSummary(report),
    };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Roster bootstrap failed",
    };
  }
}

export async function syncSeasonPlayersAction(formData: FormData) {
  const admin = await assertAdmin();
  const seasonId = String(formData.get("seasonId") || "");
  const position = String(formData.get("position") || "ALL") as
    | ContestPosition
    | "ALL";
  const result = await syncSeasonPlayersFromDirectory({
    seasonId,
    position: position === "ALL" ? undefined : position,
  });
  const { autoSyncWeeklyEligibilityForSeason } = await import(
    "@/lib/nfl/weekly-auto-sync"
  );
  const syncResults = await autoSyncWeeklyEligibilityForSeason(seasonId);
  await logAdminAction({
    adminUserId: admin.user.id,
    action: "season.players_synced",
    entityType: "Season",
    entityId: seasonId,
    metadata: { ...result, weeklySyncWeeks: syncResults.length },
  });
  revalidatePath("/admin/players");
  revalidatePath("/admin/weekly-pools");
}

export async function suggestWeeklyPoolAction(formData: FormData) {
  const admin = await assertAdmin();
  await assertManualRateLimit();
  const weekId = String(formData.get("weekId") || "");
  const position = String(formData.get("position") || "RB") as ContestPosition;
  const result = await suggestWeeklyPoolFromSeason({
    weekId,
    position,
    scheduledTeamsOnly: true,
  });
  await logAdminAction({
    adminUserId: admin.user.id,
    action: "weekly.pool_suggested",
    entityType: "Week",
    entityId: weekId,
    metadata: { position, ...result },
  });
  revalidateManual(weekId);
}

export async function activateWeeklyPlayerAction(formData: FormData) {
  const admin = await assertAdmin();
  const weekId = String(formData.get("weekId") || "");
  const position = String(formData.get("position") || "RB") as ContestPosition;
  const rankableEntryId = String(formData.get("rankableEntryId") || "");
  await activateWeeklyPlayer({ weekId, position, rankableEntryId });
  await logAdminAction({
    adminUserId: admin.user.id,
    action: "weekly.player_activated",
    entityType: "RankableEntry",
    entityId: rankableEntryId,
    metadata: { weekId, position },
  });
  revalidateManual(weekId);
}

export async function deactivateWeeklyPlayerAction(formData: FormData) {
  const admin = await assertAdmin();
  const weekId = String(formData.get("weekId") || "");
  const contestEntryId = String(formData.get("contestEntryId") || "");
  await deactivateWeeklyPlayer({ contestEntryId });
  await logAdminAction({
    adminUserId: admin.user.id,
    action: "weekly.player_deactivated",
    entityType: "ContestEntry",
    entityId: contestEntryId,
    metadata: { weekId },
  });
  revalidateManual(weekId);
}

export async function bulkActivateWeeklyPlayersAction(formData: FormData) {
  const admin = await assertAdmin();
  const contestId = String(formData.get("contestId") || "");
  const rankableEntryIds = String(formData.get("rankableEntryIds") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const activeCount = await bulkActivateWeeklyPlayers({
    contestId,
    rankableEntryIds,
  });
  await logAdminAction({
    adminUserId: admin.user.id,
    action: "weekly.players_bulk_activated",
    entityType: "RankIQContest",
    entityId: contestId,
    metadata: { activeCount, count: rankableEntryIds.length },
  });
  revalidatePath("/admin/weekly-pools");
  revalidatePath("/admin/contests");
}

export async function createMasterPlayerAction(formData: FormData) {
  const admin = await assertAdmin();
  const player = await createMasterPlayer({
    name: String(formData.get("name") || ""),
    team: String(formData.get("team") || ""),
    position: String(formData.get("position") || "RB") as ContestPosition,
    headshotUrl: String(formData.get("headshotUrl") || "") || null,
    adminNotes: String(formData.get("adminNotes") || "") || null,
  });
  const activeSeason = await prisma.season.findFirst({
    where: { active: true, sport: "NFL" },
  });
  if (activeSeason) {
    await enrollSeasonPlayer({
      seasonId: activeSeason.id,
      rankableEntryId: player.id,
    });
  }
  await logAdminAction({
    adminUserId: admin.user.id,
    action: "manual.player_created",
    entityType: "RankableEntry",
    entityId: player.id,
  });
  revalidatePath("/admin/players");
  revalidatePath("/admin/weekly-pools");
  revalidatePath("/players");
}

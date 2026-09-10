"use server";

import { revalidatePath } from "next/cache";
import { logAdminAction } from "@/lib/admin/audit";
import {
  clearLiveStats,
  finalizeLiveGame,
  reopenLiveGame,
  saveLiveDefenseStats,
  saveLivePlayerStats,
  type LiveDefenseStatsInput,
  type LivePlayerStatsInput,
} from "@/lib/admin/live-scoring";
import { assertAdmin } from "@/lib/auth/session";

function revalidateLiveScoring(weekId?: string) {
  revalidatePath("/my-ranks");
  revalidatePath("/admin/competitors/live");
  revalidatePath("/admin/live-scoring");
  revalidatePath("/leaderboards/live");
  revalidatePath("/leaderboards");
  revalidatePath("/receipts");
  revalidatePath("/results");
  revalidatePath("/rank", "layout");
  revalidatePath("/profile", "layout");
  for (const position of ["qb", "rb", "wr", "te", "def"]) {
    revalidatePath(`/leaderboards/live/${position}`);
  }
  if (weekId) {
    revalidatePath(`/admin/live-scoring?weekId=${weekId}`);
  }
}

export async function saveLivePlayerStatsAction(input: {
  contestEntryId: string;
  weekId: string;
  stats: LivePlayerStatsInput;
}) {
  const admin = await assertAdmin();
  try {
    const result = await saveLivePlayerStats({
      contestEntryId: input.contestEntryId,
      stats: input.stats,
      adminUserId: admin.user.id,
    });
    if (!result.skipped) {
      await logAdminAction({
        adminUserId: admin.user.id,
        action: "live_scoring.player_stats_saved",
        entityType: "ContestEntry",
        entityId: input.contestEntryId,
        metadata: {
          fantasyPoints: result.fantasyPoints,
          weekId: input.weekId,
        },
      });
      revalidateLiveScoring(input.weekId);
    }
    return { ok: true as const, result };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Save failed",
    };
  }
}

export async function saveLiveDefenseStatsAction(input: {
  contestEntryId: string;
  weekId: string;
  stats: LiveDefenseStatsInput;
}) {
  const admin = await assertAdmin();
  try {
    const result = await saveLiveDefenseStats({
      contestEntryId: input.contestEntryId,
      stats: input.stats,
      adminUserId: admin.user.id,
    });
    if (!result.skipped) {
      await logAdminAction({
        adminUserId: admin.user.id,
        action: "live_scoring.defense_stats_saved",
        entityType: "ContestEntry",
        entityId: input.contestEntryId,
        metadata: {
          fantasyPoints: result.fantasyPoints,
          weekId: input.weekId,
        },
      });
      revalidateLiveScoring(input.weekId);
    }
    return { ok: true as const, result };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Save failed",
    };
  }
}

export async function saveAllLiveStatsAction(input: {
  weekId: string;
  players: Array<{ contestEntryId: string; stats: LivePlayerStatsInput }>;
  defenses: Array<{ contestEntryId: string; stats: LiveDefenseStatsInput }>;
}) {
  const admin = await assertAdmin();
  try {
    const results = {
      saved: 0,
      skipped: 0,
      fantasyPointsByEntry: {} as Record<string, number | null>,
    };

    for (const row of input.players) {
      const result = await saveLivePlayerStats({
        contestEntryId: row.contestEntryId,
        stats: row.stats,
        adminUserId: admin.user.id,
      });
      if (result.skipped) results.skipped += 1;
      else {
        results.saved += 1;
        results.fantasyPointsByEntry[result.contestEntryId] =
          result.fantasyPoints;
      }
    }

    for (const row of input.defenses) {
      const result = await saveLiveDefenseStats({
        contestEntryId: row.contestEntryId,
        stats: row.stats,
        adminUserId: admin.user.id,
      });
      if (result.skipped) results.skipped += 1;
      else {
        results.saved += 1;
        results.fantasyPointsByEntry[result.contestEntryId] =
          result.fantasyPoints;
      }
    }

    if (results.saved > 0) {
      await logAdminAction({
        adminUserId: admin.user.id,
        action: "live_scoring.batch_saved",
        entityType: "Week",
        entityId: input.weekId,
        metadata: results,
      });
      revalidateLiveScoring(input.weekId);
    }

    return { ok: true as const, results };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Batch save failed",
    };
  }
}

export async function finalizeLiveGameAction(input: {
  weekId: string;
  gameId: string;
}) {
  const admin = await assertAdmin();
  try {
    const result = await finalizeLiveGame({
      weekId: input.weekId,
      gameId: input.gameId,
      adminUserId: admin.user.id,
    });
    await logAdminAction({
      adminUserId: admin.user.id,
      action: "live_scoring.game_finalized",
      entityType: "NflGame",
      entityId: input.gameId,
      metadata: {
        weekId: input.weekId,
        matchup: result.matchup,
        playerStatLines: result.playerStatLines,
        defenseStatLines: result.defenseStatLines,
        statsFinalizedAt: result.statsFinalizedAt.toISOString(),
      },
    });
    revalidateLiveScoring(input.weekId);
    return { ok: true as const, result };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Finalize failed",
    };
  }
}

export async function reopenLiveGameAction(input: {
  weekId: string;
  gameId: string;
}) {
  const admin = await assertAdmin();
  try {
    const result = await reopenLiveGame({
      weekId: input.weekId,
      gameId: input.gameId,
      adminUserId: admin.user.id,
    });
    await logAdminAction({
      adminUserId: admin.user.id,
      action: "live_scoring.game_reopened",
      entityType: "NflGame",
      entityId: input.gameId,
      metadata: {
        weekId: input.weekId,
        matchup: result.matchup,
        playerStatLines: result.playerStatLines,
        defenseStatLines: result.defenseStatLines,
      },
    });
    revalidateLiveScoring(input.weekId);
    return { ok: true as const, result };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Reopen failed",
    };
  }
}

export async function clearLiveStatsAction(input: {
  contestEntryId: string;
  weekId: string;
}) {
  const admin = await assertAdmin();
  try {
    const result = await clearLiveStats({
      contestEntryId: input.contestEntryId,
      adminUserId: admin.user.id,
    });
    if (!result.skipped) {
      await logAdminAction({
        adminUserId: admin.user.id,
        action: "live_scoring.cleared",
        entityType: "ContestEntry",
        entityId: input.contestEntryId,
        metadata: { weekId: input.weekId },
      });
      revalidateLiveScoring(input.weekId);
    }
    return { ok: true as const, result };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Clear failed",
    };
  }
}

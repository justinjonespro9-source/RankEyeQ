/**
 * Waiver-only PlayerWeekStat upsert for frozen WaiverEyeQ eligible candidates
 * who are absent from the Rankings position pool (no ContestEntry).
 *
 * Does NOT create ContestEntries, does NOT touch Rankings finishes/grades,
 * does NOT mutate frozen WaiverSnapshotEntry identity stamps.
 * Uses provider=manual + FANTASYTRACK_NFL_HALF_PPR_V2 scoring only.
 */

import { logAdminAction } from "@/lib/admin/audit";
import {
  calculatePlayerLiveFantasyPoints,
  EMPTY_PLAYER,
} from "@/lib/admin/live-scoring-shared";
import { prisma } from "@/lib/db";
import type { PlayerStatLine } from "@/lib/fantasy/player-scoring";
import {
  RANKEYEQ_FANTASY_SCORING_VERSION,
  RANKEYEQ_WEEK_STAT_PROVIDER,
} from "@/lib/waivers/rankeyeq-results/contract";

export const WAIVER_ONLY_WEEKSTAT_ACTION =
  "waivers.rankeyeq_waiver_only_weekstat_upserted";

export type WaiverOnlyWeekStatInput = {
  weekId: string;
  rankableEntryId: string;
  /** Must match the NflGame.externalId for the player's Week 8 game. */
  gameExternalId: string;
  stats: PlayerStatLine;
  reason: string;
  sourceReference: string;
  adminUserId: string;
  /**
   * When true, allow replacing an existing verified manual WeekStat whose
   * components/FP differ. Default false (idempotent same-line only).
   */
  replaceExisting?: boolean;
  now?: Date;
};

export type WaiverOnlyWeekStatResult =
  | {
      ok: true;
      weekStatId: string;
      action: "created" | "unchanged" | "updated";
      fantasyPoints: number;
      isProvisional: boolean;
      auditLogId: string;
      snapshotEntryId: string;
    }
  | {
      ok: false;
      error:
        | "missing_reason"
        | "missing_source"
        | "week_not_found"
        | "player_not_found"
        | "no_frozen_eligible_snapshot_entry"
        | "identity_mismatch"
        | "active_rankings_contest_entry"
        | "game_not_found"
        | "game_not_final"
        | "team_game_mismatch"
        | "existing_verified_conflict"
        | "scoring_version_mismatch";
      message: string;
    };

function normalizeStats(stats: PlayerStatLine): Required<PlayerStatLine> {
  return {
    passingYards: Number(stats.passingYards) || 0,
    passingTds: Math.trunc(Number(stats.passingTds) || 0),
    interceptions: Math.trunc(Number(stats.interceptions) || 0),
    rushingYards: Number(stats.rushingYards) || 0,
    rushingTds: Math.trunc(Number(stats.rushingTds) || 0),
    receptions: Math.trunc(Number(stats.receptions) || 0),
    receivingYards: Number(stats.receivingYards) || 0,
    receivingTds: Math.trunc(Number(stats.receivingTds) || 0),
    twoPointConversions: Math.trunc(Number(stats.twoPointConversions) || 0),
    fumblesLost: Math.trunc(Number(stats.fumblesLost) || 0),
    returnTds: Math.trunc(Number(stats.returnTds) || 0),
  };
}

function componentsEqual(
  a: Required<PlayerStatLine>,
  b: Required<PlayerStatLine>,
): boolean {
  return (Object.keys(EMPTY_PLAYER) as (keyof Required<PlayerStatLine>)[]).every(
    (key) => a[key] === b[key],
  );
}

/**
 * Upsert a verified manual PlayerWeekStat for a frozen WaiverEyeQ eligible
 * candidate without requiring a Rankings ContestEntry.
 */
export async function upsertWaiverOnlyPlayerWeekStat(
  input: WaiverOnlyWeekStatInput,
): Promise<WaiverOnlyWeekStatResult> {
  const reason = input.reason.trim();
  if (!reason) {
    return {
      ok: false,
      error: "missing_reason",
      message: "A reason is required for waiver-only WeekStat ingestion.",
    };
  }
  const sourceReference = input.sourceReference.trim();
  if (!sourceReference) {
    return {
      ok: false,
      error: "missing_source",
      message: "A factual source reference is required.",
    };
  }

  const week = await prisma.week.findUnique({
    where: { id: input.weekId },
    select: {
      id: true,
      status: true,
      fantasyScoringVersion: true,
      season: { select: { fantasyScoringVersion: true } },
    },
  });
  if (!week) {
    return {
      ok: false,
      error: "week_not_found",
      message: "Week not found.",
    };
  }

  const scoringVersion =
    week.fantasyScoringVersion ||
    week.season.fantasyScoringVersion ||
    RANKEYEQ_FANTASY_SCORING_VERSION;
  if (scoringVersion !== RANKEYEQ_FANTASY_SCORING_VERSION) {
    return {
      ok: false,
      error: "scoring_version_mismatch",
      message: `Week scoring version ${scoringVersion} is not ${RANKEYEQ_FANTASY_SCORING_VERSION}.`,
    };
  }

  const player = await prisma.rankableEntry.findUnique({
    where: { id: input.rankableEntryId },
    select: {
      id: true,
      name: true,
      team: true,
      position: true,
      provider: true,
      externalId: true,
    },
  });
  if (!player) {
    return {
      ok: false,
      error: "player_not_found",
      message: "RankableEntry not found.",
    };
  }
  if (player.position === "DEF") {
    return {
      ok: false,
      error: "player_not_found",
      message: "Waiver-only player WeekStat path does not accept DEF entries.",
    };
  }

  const snapshot = await prisma.waiverSnapshot.findFirst({
    where: { currentForWeekId: input.weekId, status: "FROZEN" },
    select: { id: true, entriesFingerprint: true },
  });
  const snapshotEntry = snapshot
    ? await prisma.waiverSnapshotEntry.findFirst({
        where: {
          snapshotId: snapshot.id,
          rankableEntryId: input.rankableEntryId,
          eligibility: "ELIGIBLE",
        },
        select: {
          id: true,
          identityProviderAtFreeze: true,
          identityExternalIdAtFreeze: true,
          teamAtFreeze: true,
          displayNameAtFreeze: true,
        },
      })
    : null;
  if (!snapshot || !snapshotEntry) {
    return {
      ok: false,
      error: "no_frozen_eligible_snapshot_entry",
      message:
        "No current FROZEN WaiverEyeQ eligible snapshot entry for this player.",
    };
  }

  const frozenProvider =
    snapshotEntry.identityProviderAtFreeze ?? player.provider;
  const frozenExternal =
    snapshotEntry.identityExternalIdAtFreeze ?? player.externalId;
  if (
    frozenProvider !== player.provider ||
    frozenExternal !== player.externalId
  ) {
    return {
      ok: false,
      error: "identity_mismatch",
      message:
        "Live RankableEntry identity does not match the frozen WaiverEyeQ identity stamp.",
    };
  }

  // Refuse if the player is an active (non-excluded) Rankings pool member —
  // those must use ContestEntry-backed live scoring / import.
  const activeContestEntry = await prisma.contestEntry.findFirst({
    where: {
      rankableEntryId: input.rankableEntryId,
      contest: { weekId: input.weekId },
      excluded: false,
    },
    select: { id: true },
  });
  if (activeContestEntry) {
    return {
      ok: false,
      error: "active_rankings_contest_entry",
      message:
        "Player has an active Rankings ContestEntry — use the standard ContestEntry-backed stat path.",
    };
  }

  const game = await prisma.nflGame.findFirst({
    where: { weekId: input.weekId, externalId: input.gameExternalId },
    select: {
      id: true,
      status: true,
      statsFinalizedAt: true,
      awayTeam: true,
      homeTeam: true,
      startsAt: true,
      externalId: true,
    },
  });
  if (!game) {
    return {
      ok: false,
      error: "game_not_found",
      message: `Game ${input.gameExternalId} not found for this week.`,
    };
  }
  if (game.status !== "FINAL" || game.statsFinalizedAt == null) {
    return {
      ok: false,
      error: "game_not_final",
      message: "Game must be FINAL with verified stats before waiver-only ingest.",
    };
  }
  const team = snapshotEntry.teamAtFreeze || player.team;
  if (team !== game.awayTeam && team !== game.homeTeam) {
    return {
      ok: false,
      error: "team_game_mismatch",
      message: `Team ${team} is not in game ${game.awayTeam}@${game.homeTeam}.`,
    };
  }

  const normalized = normalizeStats(input.stats);
  const fantasyPoints = calculatePlayerLiveFantasyPoints(
    normalized,
    scoringVersion,
  );

  const existing = await prisma.playerWeekStat.findUnique({
    where: {
      provider_weekId_externalPlayerId: {
        provider: RANKEYEQ_WEEK_STAT_PROVIDER,
        weekId: input.weekId,
        externalPlayerId: player.externalId,
      },
    },
  });

  let action: "created" | "unchanged" | "updated" = "created";
  let weekStatId: string;

  if (existing) {
    const existingComponents = normalizeStats({
      passingYards: existing.passingYards,
      passingTds: existing.passingTds,
      interceptions: existing.interceptions,
      rushingYards: existing.rushingYards,
      rushingTds: existing.rushingTds,
      receptions: existing.receptions,
      receivingYards: existing.receivingYards,
      receivingTds: existing.receivingTds,
      twoPointConversions: existing.twoPointConversions,
      fumblesLost: existing.fumblesLost,
      returnTds: existing.returnTds,
    });
    const same =
      componentsEqual(existingComponents, normalized) &&
      Math.abs(existing.fantasyPoints - fantasyPoints) < 1e-9 &&
      existing.rankableEntryId === player.id &&
      existing.isProvisional === false;

    if (same) {
      action = "unchanged";
      weekStatId = existing.id;
    } else if (!existing.isProvisional && !input.replaceExisting) {
      return {
        ok: false,
        error: "existing_verified_conflict",
        message:
          "A verified manual WeekStat already exists with different components. Pass replaceExisting only with explicit owner authorization.",
      };
    } else {
      const updated = await prisma.playerWeekStat.update({
        where: { id: existing.id },
        data: {
          rankableEntryId: player.id,
          gameId: game.id,
          scoringVersion,
          ...normalized,
          fantasyPoints,
          isProvisional: false,
        },
      });
      action = "updated";
      weekStatId = updated.id;
    }
  } else {
    const created = await prisma.playerWeekStat.create({
      data: {
        provider: RANKEYEQ_WEEK_STAT_PROVIDER,
        weekId: input.weekId,
        rankableEntryId: player.id,
        gameId: game.id,
        externalPlayerId: player.externalId,
        scoringVersion,
        ...normalized,
        fantasyPoints,
        isProvisional: false,
      },
    });
    action = "created";
    weekStatId = created.id;
  }

  const audit = await logAdminAction({
    adminUserId: input.adminUserId,
    action: WAIVER_ONLY_WEEKSTAT_ACTION,
    entityType: "PlayerWeekStat",
    entityId: weekStatId,
    metadata: {
      weekId: input.weekId,
      rankableEntryId: player.id,
      playerName: player.name,
      externalId: player.externalId,
      provider: player.provider,
      snapshotId: snapshot.id,
      snapshotEntryId: snapshotEntry.id,
      entriesFingerprint: snapshot.entriesFingerprint,
      gameExternalId: game.externalId,
      gameId: game.id,
      matchup: `${game.awayTeam}@${game.homeTeam}`,
      reason,
      sourceReference,
      fantasyPoints,
      components: normalized,
      upsertAction: action,
      rankingsContestEntryTouched: false,
      frozenIdentityUnchanged: true,
    },
  });

  return {
    ok: true,
    weekStatId,
    action,
    fantasyPoints,
    isProvisional: false,
    auditLogId: audit.id,
    snapshotEntryId: snapshotEntry.id,
  };
}

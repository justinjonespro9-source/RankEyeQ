/**
 * Post-FINAL factual WeekStat correction — admin-only audited workflow.
 *
 * Canonical chain (no parallel scoring):
 *   WeekStat factual fields
 *   → scoreWeeklyPlayerFantasy / scoreWeeklyDefenseFantasy
 *   → ContestEntry.fantasyPoints
 *   → calculateLeagueActualFinishesForContest (position-scoped)
 *   → gradeContest (effective-board / EYEQ)
 *
 * Does NOT reopen the week or use ordinary live-scoring save paths.
 * Does NOT mutate RankingPick.predictedRank / reserveEligiblePredecessorIds.
 * Week stays COMPLETE; contest ends FINAL after successful apply.
 */

import { logAdminAction } from "@/lib/admin/audit";
import {
  calculateDefenseLiveFantasyPoints,
  calculatePlayerLiveFantasyPoints,
  EMPTY_DEFENSE,
  EMPTY_PLAYER,
  LIVE_MANUAL_PROVIDER,
} from "@/lib/admin/live-scoring-shared";
import { prisma } from "@/lib/db";
import type { DefenseStatLine } from "@/lib/fantasy/defense-scoring";
import { assignCompetitionRanks } from "@/lib/fantasy/competition-rank";
import type { PlayerStatLine } from "@/lib/fantasy/player-scoring";
import { resolveFantasyScoringVersion } from "@/lib/fantasy/shared-engine";
import type {
  ContestPosition,
  ContestStatus,
  WeekStatus,
} from "@/lib/generated/prisma/client";
import { calculateLeagueActualFinishesForContest } from "@/lib/nfl/actual-finishes";
import { gradeContest } from "@/lib/grading";
import { scoreableEffectivePicks } from "@/lib/reserves/from-submission";
import { scoreContest } from "@/lib/scoring";
import { submissionIsEligible } from "@/lib/contest-lifecycle";

export const POST_FINAL_STAT_CORRECTION_ACTION =
  "live_scoring.post_final_stat_correction";
export const POST_FINAL_STAT_CORRECTION_RECALCULATED_ACTION =
  "live_scoring.post_final_stat_correction_recalculated";

export const PLAYER_FACTUAL_KEYS = [
  "passingYards",
  "passingTds",
  "interceptions",
  "rushingYards",
  "rushingTds",
  "receptions",
  "receivingYards",
  "receivingTds",
  "twoPointConversions",
  "fumblesLost",
  "returnTds",
] as const;

export const DEFENSE_FACTUAL_KEYS = [
  "sacks",
  "interceptions",
  "fumbleRecoveries",
  "defensiveTds",
  "specialTeamsTds",
  "safeties",
  "blockedKicks",
  "pointsAllowed",
] as const;

export type PlayerFactualKey = (typeof PLAYER_FACTUAL_KEYS)[number];
export type DefenseFactualKey = (typeof DEFENSE_FACTUAL_KEYS)[number];

export type PostFinalStatKind = "player" | "defense";

export type RankChangePreview = {
  rankableEntryId: string;
  name: string;
  oldRank: number | null;
  newRank: number | null;
  fantasyPoints: number;
};

export type EyeqChangePreview = {
  submissionId: string;
  universalProfileId: string;
  oldNormalizedScore: number | null;
  projectedNormalizedScore: number;
};

export type PostFinalStatCorrectionPreview = {
  kind: PostFinalStatKind;
  weekStatId: string;
  weekId: string;
  weekLabel: string;
  weekStatus: WeekStatus;
  seasonId: string;
  gameId: string | null;
  rankableEntryId: string;
  name: string;
  team: string;
  position: ContestPosition;
  contestId: string;
  contestStatus: ContestStatus;
  scoringVersion: string;
  reasonRequired: true;
  sourceRequired: true;
  currentFacts: Record<string, number>;
  proposedFacts: Record<string, number>;
  changedFields: string[];
  oldFantasyPoints: number;
  newFantasyPoints: number;
  oldActualRank: number | null;
  projectedActualRank: number | null;
  rankChanges: RankChangePreview[];
  gradedSubmissionCount: number;
  eyeqChanges: EyeqChangePreview[] | null;
  eyeqPreviewLimited: boolean;
  unrelatedPositionsUnaffected: true;
  weekRemainsComplete: boolean;
  contestRemainsFinal: boolean;
};

export type ApplyPostFinalStatCorrectionInput = {
  weekStatId: string;
  kind: PostFinalStatKind;
  proposedStats: PlayerStatLine | DefenseStatLine;
  reason: string;
  sourceReference: string;
  adminUserId: string;
  /** Explicit high-impact confirmation from operator UI. */
  confirmHighImpact: boolean;
};

export type ApplyPostFinalStatCorrectionResult =
  | {
      ok: true;
      auditLogId: string;
      recalculatedAuditLogId: string;
      contestId: string;
      position: ContestPosition;
      oldFantasyPoints: number;
      newFantasyPoints: number;
      oldActualRank: number | null;
      newActualRank: number | null;
      rankChanges: RankChangePreview[];
      submissionsRegraded: number;
      weekStatus: WeekStatus;
      contestStatus: ContestStatus;
      identicalNoOp: boolean;
    }
  | {
      ok: false;
      error:
        | "missing_reason"
        | "missing_source"
        | "missing_confirmation"
        | "not_found"
        | "week_mismatch"
        | "contest_not_final"
        | "invalid_stats"
        | "apply_failed";
      message: string;
      partialState?: {
        weekStatUpdated: boolean;
        finishesRecalculated: boolean;
        graded: boolean;
        contestStatus?: ContestStatus;
      };
    };

function nFloat(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function nInt(value: unknown): number {
  return Math.trunc(nFloat(value));
}

export function normalizePlayerFactualStats(
  stats: PlayerStatLine,
): Required<PlayerStatLine> {
  return {
    passingYards: nFloat(stats.passingYards),
    passingTds: nInt(stats.passingTds),
    interceptions: nInt(stats.interceptions),
    rushingYards: nFloat(stats.rushingYards),
    rushingTds: nInt(stats.rushingTds),
    receptions: nInt(stats.receptions),
    receivingYards: nFloat(stats.receivingYards),
    receivingTds: nInt(stats.receivingTds),
    twoPointConversions: nInt(stats.twoPointConversions),
    fumblesLost: nInt(stats.fumblesLost),
    returnTds: nInt(stats.returnTds),
  };
}

export function normalizeDefenseFactualStats(
  stats: DefenseStatLine,
): Required<DefenseStatLine> {
  return {
    sacks: nFloat(stats.sacks),
    interceptions: nInt(stats.interceptions),
    fumbleRecoveries: nInt(stats.fumbleRecoveries),
    defensiveTds: nInt(stats.defensiveTds),
    specialTeamsTds: nInt(stats.specialTeamsTds),
    safeties: nInt(stats.safeties),
    blockedKicks: nInt(stats.blockedKicks),
    pointsAllowed: Math.max(0, nInt(stats.pointsAllowed)),
  };
}

export function playerFactsFromRecord(
  row: Partial<Required<PlayerStatLine>>,
): Required<PlayerStatLine> {
  return normalizePlayerFactualStats({ ...EMPTY_PLAYER, ...row });
}

export function defenseFactsFromRecord(
  row: Partial<Required<DefenseStatLine>>,
): Required<DefenseStatLine> {
  return normalizeDefenseFactualStats({ ...EMPTY_DEFENSE, ...row });
}

export function diffNumericFacts(
  current: Record<string, number>,
  proposed: Record<string, number>,
): string[] {
  const keys = new Set([...Object.keys(current), ...Object.keys(proposed)]);
  return [...keys].filter((key) => (current[key] ?? 0) !== (proposed[key] ?? 0));
}

/** Pure projection of competition ranks after one ContestEntry FP change. */
export function projectPositionRanksAfterFantasyChange(input: {
  entries: Array<{
    rankableEntryId: string;
    name: string;
    fantasyPoints: number | null;
    actualRank: number | null;
  }>;
  targetRankableEntryId: string;
  newFantasyPoints: number;
}): {
  projectedRanks: Array<{
    rankableEntryId: string;
    name: string;
    fantasyPoints: number;
    newRank: number;
    oldRank: number | null;
  }>;
  rankChanges: RankChangePreview[];
  projectedActualRank: number | null;
} {
  const withPoints = input.entries
    .map((entry) => {
      const fantasyPoints =
        entry.rankableEntryId === input.targetRankableEntryId
          ? input.newFantasyPoints
          : entry.fantasyPoints;
      if (fantasyPoints == null) return null;
      return {
        rankableEntryId: entry.rankableEntryId,
        name: entry.name,
        fantasyPoints,
        oldRank: entry.actualRank,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  const ranked = assignCompetitionRanks(
    withPoints,
    (row) => row.fantasyPoints,
  );

  const projectedRanks = ranked.map((row) => ({
    rankableEntryId: row.item.rankableEntryId,
    name: row.item.name,
    fantasyPoints: row.item.fantasyPoints,
    newRank: row.rank,
    oldRank: row.item.oldRank,
  }));

  const rankChanges: RankChangePreview[] = projectedRanks
    .filter((row) => row.oldRank !== row.newRank)
    .map((row) => ({
      rankableEntryId: row.rankableEntryId,
      name: row.name,
      oldRank: row.oldRank,
      newRank: row.newRank,
      fantasyPoints: row.fantasyPoints,
    }));

  const target = projectedRanks.find(
    (row) => row.rankableEntryId === input.targetRankableEntryId,
  );

  return {
    projectedRanks,
    rankChanges,
    projectedActualRank: target?.newRank ?? null,
  };
}

function validateReasonSource(reason: string, sourceReference: string) {
  const trimmedReason = reason.trim();
  const trimmedSource = sourceReference.trim();
  if (!trimmedReason) {
    return {
      ok: false as const,
      error: "missing_reason" as const,
      message: "A correction reason is required.",
    };
  }
  if (!trimmedSource) {
    return {
      ok: false as const,
      error: "missing_source" as const,
      message: "A source / reference is required.",
    };
  }
  return {
    ok: true as const,
    reason: trimmedReason,
    sourceReference: trimmedSource,
  };
}

type LoadedCorrectionTarget = {
  kind: PostFinalStatKind;
  weekStatId: string;
  weekId: string;
  weekLabel: string;
  weekStatus: WeekStatus;
  seasonId: string;
  gameId: string | null;
  rankableEntryId: string;
  name: string;
  team: string;
  position: ContestPosition;
  contestId: string;
  contestStatus: ContestStatus;
  contestEntryId: string;
  scoringVersion: string;
  currentFacts: Record<string, number>;
  oldFantasyPoints: number;
  oldActualRank: number | null;
  oldLeagueActualRank: number | null;
  provider: string;
};

async function loadCorrectionTarget(input: {
  weekStatId: string;
  kind: PostFinalStatKind;
}): Promise<LoadedCorrectionTarget | null> {
  if (input.kind === "player") {
    const row = await prisma.playerWeekStat.findUnique({
      where: { id: input.weekStatId },
      include: {
        week: { include: { season: true } },
        rankableEntry: true,
      },
    });
    if (!row?.rankableEntryId || !row.rankableEntry) return null;
    if (row.rankableEntry.position === "DEF") return null;

    const contest = await prisma.rankIQContest.findUnique({
      where: {
        weekId_position: {
          weekId: row.weekId,
          position: row.rankableEntry.position,
        },
      },
    });
    if (!contest) return null;

    const contestEntry = await prisma.contestEntry.findFirst({
      where: {
        contestId: contest.id,
        rankableEntryId: row.rankableEntryId,
      },
    });
    if (!contestEntry) return null;

    const scoringVersion = resolveFantasyScoringVersion({
      weekVersion: row.week.fantasyScoringVersion,
      seasonVersion: row.week.season.fantasyScoringVersion,
    });

    const facts = playerFactsFromRecord(row);
    return {
      kind: "player",
      weekStatId: row.id,
      weekId: row.weekId,
      weekLabel: row.week.label,
      weekStatus: row.week.status,
      seasonId: row.week.seasonId,
      gameId: row.gameId,
      rankableEntryId: row.rankableEntryId,
      name: row.rankableEntry.name,
      team: row.rankableEntry.team,
      position: row.rankableEntry.position,
      contestId: contest.id,
      contestStatus: contest.status,
      contestEntryId: contestEntry.id,
      scoringVersion,
      currentFacts: { ...facts },
      oldFantasyPoints: row.fantasyPoints,
      oldActualRank: contestEntry.actualRank,
      oldLeagueActualRank: row.leagueActualRank,
      provider: row.provider,
    };
  }

  const row = await prisma.defenseWeekStat.findUnique({
    where: { id: input.weekStatId },
    include: {
      week: { include: { season: true } },
      rankableEntry: true,
    },
  });
  if (!row?.rankableEntryId || !row.rankableEntry) return null;
  if (row.rankableEntry.position !== "DEF") return null;

  const contest = await prisma.rankIQContest.findUnique({
    where: {
      weekId_position: { weekId: row.weekId, position: "DEF" },
    },
  });
  if (!contest) return null;

  const contestEntry = await prisma.contestEntry.findFirst({
    where: {
      contestId: contest.id,
      rankableEntryId: row.rankableEntryId,
    },
  });
  if (!contestEntry) return null;

  const scoringVersion = resolveFantasyScoringVersion({
    weekVersion: row.week.fantasyScoringVersion,
    seasonVersion: row.week.season.fantasyScoringVersion,
  });
  const facts = defenseFactsFromRecord(row);
  return {
    kind: "defense",
    weekStatId: row.id,
    weekId: row.weekId,
    weekLabel: row.week.label,
    weekStatus: row.week.status,
    seasonId: row.week.seasonId,
    gameId: row.gameId,
    rankableEntryId: row.rankableEntryId,
    name: row.rankableEntry.name,
    team: row.rankableEntry.team,
    position: "DEF",
    contestId: contest.id,
    contestStatus: contest.status,
    contestEntryId: contestEntry.id,
    scoringVersion,
    currentFacts: { ...facts },
    oldFantasyPoints: row.fantasyPoints,
    oldActualRank: contestEntry.actualRank,
    oldLeagueActualRank: row.leagueActualRank,
    provider: row.provider,
  };
}

async function buildEyeqPreview(input: {
  contestId: string;
  rankingDepth: number;
  projectedActualById: Map<string, { actualRank: number; fantasyPoints: number }>;
}): Promise<{ changes: EyeqChangePreview[]; limited: boolean }> {
  const contest = await prisma.rankIQContest.findUnique({
    where: { id: input.contestId },
    include: {
      submissions: {
        where: { status: { in: ["SUBMITTED", "LOCKED", "GRADED"] } },
        include: {
          picks: {
            orderBy: { predictedRank: "asc" },
            include: { rankableEntry: { include: { game: true } } },
          },
        },
      },
    },
  });
  if (!contest) return { changes: [], limited: true };

  const changes: EyeqChangePreview[] = [];
  for (const submission of contest.submissions) {
    if (!submissionIsEligible(submission.status)) continue;
    try {
      const effective = scoreableEffectivePicks({
        picks: submission.picks,
        scoringDepth: input.rankingDepth,
      });
      const scoreable = effective.map((pick) => {
        const result = input.projectedActualById.get(pick.playerId);
        return {
          playerId: pick.playerId,
          playerName: pick.playerId,
          predictedRank: pick.predictedRank,
          actualRank: result?.actualRank ?? input.rankingDepth + 100,
        };
      });
      const summary = scoreContest(scoreable, input.rankingDepth);
      if (
        submission.normalizedScore == null ||
        Math.abs(submission.normalizedScore - summary.rankIqScore) > 1e-9
      ) {
        changes.push({
          submissionId: submission.id,
          universalProfileId: submission.universalProfileId,
          oldNormalizedScore: submission.normalizedScore,
          projectedNormalizedScore: summary.rankIqScore,
        });
      }
    } catch {
      return { changes: [], limited: true };
    }
  }
  return { changes, limited: false };
}

/**
 * Read-only impact preview. Performs zero writes.
 */
export async function previewPostFinalStatCorrection(input: {
  weekStatId: string;
  kind: PostFinalStatKind;
  proposedStats: PlayerStatLine | DefenseStatLine;
}): Promise<
  | { ok: true; preview: PostFinalStatCorrectionPreview }
  | { ok: false; error: string; message: string }
> {
  const target = await loadCorrectionTarget(input);
  if (!target) {
    return {
      ok: false,
      error: "not_found",
      message: "WeekStat / contest entry not found for correction.",
    };
  }

  if (target.contestStatus !== "FINAL" && target.contestStatus !== "ARCHIVED") {
    return {
      ok: false,
      error: "contest_not_final",
      message:
        "Post-FINAL correction requires a FINAL (or ARCHIVED) contest. Use ordinary live scoring while the week is open.",
    };
  }

  const proposedFacts =
    input.kind === "player"
      ? normalizePlayerFactualStats(input.proposedStats as PlayerStatLine)
      : normalizeDefenseFactualStats(input.proposedStats as DefenseStatLine);

  const newFantasyPoints =
    input.kind === "player"
      ? calculatePlayerLiveFantasyPoints(
          proposedFacts,
          target.scoringVersion,
        )
      : calculateDefenseLiveFantasyPoints(
          proposedFacts,
          target.scoringVersion,
        );

  const changedFields = diffNumericFacts(target.currentFacts, {
    ...proposedFacts,
  });

  const contest = await prisma.rankIQContest.findUniqueOrThrow({
    where: { id: target.contestId },
    include: {
      entries: {
        where: { excluded: false },
        include: { rankableEntry: { select: { name: true } } },
      },
      submissions: {
        where: { status: { in: ["SUBMITTED", "LOCKED", "GRADED"] } },
        select: { id: true },
      },
    },
  });

  const projection = projectPositionRanksAfterFantasyChange({
    entries: contest.entries.map((entry) => ({
      rankableEntryId: entry.rankableEntryId,
      name: entry.rankableEntry.name,
      fantasyPoints: entry.fantasyPoints,
      actualRank: entry.actualRank,
    })),
    targetRankableEntryId: target.rankableEntryId,
    newFantasyPoints,
  });

  const projectedActualById = new Map(
    projection.projectedRanks.map((row) => [
      row.rankableEntryId,
      { actualRank: row.newRank, fantasyPoints: row.fantasyPoints },
    ]),
  );

  const eyeq = await buildEyeqPreview({
    contestId: contest.id,
    rankingDepth: contest.rankingDepth,
    projectedActualById,
  });

  const preview: PostFinalStatCorrectionPreview = {
    kind: target.kind,
    weekStatId: target.weekStatId,
    weekId: target.weekId,
    weekLabel: target.weekLabel,
    weekStatus: target.weekStatus,
    seasonId: target.seasonId,
    gameId: target.gameId,
    rankableEntryId: target.rankableEntryId,
    name: target.name,
    team: target.team,
    position: target.position,
    contestId: target.contestId,
    contestStatus: target.contestStatus,
    scoringVersion: target.scoringVersion,
    reasonRequired: true,
    sourceRequired: true,
    currentFacts: target.currentFacts,
    proposedFacts: { ...proposedFacts },
    changedFields,
    oldFantasyPoints: target.oldFantasyPoints,
    newFantasyPoints,
    oldActualRank: target.oldActualRank,
    projectedActualRank: projection.projectedActualRank,
    rankChanges: projection.rankChanges,
    gradedSubmissionCount: contest.submissions.length,
    eyeqChanges: eyeq.limited ? null : eyeq.changes,
    eyeqPreviewLimited: eyeq.limited,
    unrelatedPositionsUnaffected: true,
    weekRemainsComplete: target.weekStatus === "COMPLETE",
    contestRemainsFinal: true,
  };

  return { ok: true, preview };
}

/**
 * Apply factual correction + position finishes + contest regrade.
 *
 * Atomicity strategy (staged, recoverable):
 *  1. Short DB transaction: WeekStat factual+FP, ContestEntry.FP, start audit
 *  2. calculateLeagueActualFinishesForContest (position-only; existing chunked writes)
 *  3. gradeContest (ends FINAL; on failure restores prior FINAL)
 *  4. Follow-up audit with before/after ranks + regrade counts
 *
 * Partial failure surfaces explicitly. Retry of the same correction is safe:
 * identical factual writes are idempotent; finishes+grade are idempotent.
 */
export async function applyPostFinalStatCorrection(
  input: ApplyPostFinalStatCorrectionInput,
): Promise<ApplyPostFinalStatCorrectionResult> {
  const validated = validateReasonSource(input.reason, input.sourceReference);
  if (!validated.ok) {
    return {
      ok: false,
      error: validated.error,
      message: validated.message,
    };
  }
  if (!input.confirmHighImpact) {
    return {
      ok: false,
      error: "missing_confirmation",
      message:
        "High-impact confirmation is required before applying a post-FINAL correction.",
    };
  }

  const previewResult = await previewPostFinalStatCorrection({
    weekStatId: input.weekStatId,
    kind: input.kind,
    proposedStats: input.proposedStats,
  });
  if (!previewResult.ok) {
    return {
      ok: false,
      error:
        previewResult.error === "contest_not_final"
          ? "contest_not_final"
          : "not_found",
      message: previewResult.message,
    };
  }
  const preview = previewResult.preview;
  const target = await loadCorrectionTarget({
    weekStatId: input.weekStatId,
    kind: input.kind,
  });
  if (!target) {
    return {
      ok: false,
      error: "not_found",
      message: "WeekStat / contest entry not found for correction.",
    };
  }

  const proposedFacts =
    input.kind === "player"
      ? normalizePlayerFactualStats(input.proposedStats as PlayerStatLine)
      : normalizeDefenseFactualStats(input.proposedStats as DefenseStatLine);

  const identicalNoOp =
    preview.changedFields.length === 0 &&
    Math.abs(preview.oldFantasyPoints - preview.newFantasyPoints) < 1e-9;

  let weekStatUpdated = false;
  let finishesRecalculated = false;
  let graded = false;
  let auditLogId = "";

  try {
    await prisma.$transaction(async (tx) => {
      if (input.kind === "player") {
        await tx.playerWeekStat.update({
          where: { id: target.weekStatId },
          data: {
            ...proposedFacts,
            fantasyPoints: preview.newFantasyPoints,
            scoringVersion: target.scoringVersion,
            // Keep non-provisional — this is a final factual amendment.
            isProvisional: false,
          },
        });
      } else {
        await tx.defenseWeekStat.update({
          where: { id: target.weekStatId },
          data: {
            ...proposedFacts,
            fantasyPoints: preview.newFantasyPoints,
            scoringVersion: target.scoringVersion,
            isProvisional: false,
          },
        });
      }

      await tx.contestEntry.update({
        where: { id: target.contestEntryId },
        data: { fantasyPoints: preview.newFantasyPoints },
      });

      const audit = await tx.adminAuditLog.create({
        data: {
          adminUserId: input.adminUserId,
          action: POST_FINAL_STAT_CORRECTION_ACTION,
          entityType:
            input.kind === "player" ? "PlayerWeekStat" : "DefenseWeekStat",
          entityId: target.weekStatId,
          metadata: {
            stage: "stats_applied",
            adminUserId: input.adminUserId,
            seasonId: target.seasonId,
            weekId: target.weekId,
            weekLabel: target.weekLabel,
            weekStatus: target.weekStatus,
            gameId: target.gameId,
            playerName: target.name,
            team: target.team,
            position: target.position,
            rankableEntryId: target.rankableEntryId,
            weekStatId: target.weekStatId,
            contestId: target.contestId,
            contestEntryId: target.contestEntryId,
            provider: target.provider,
            reason: validated.reason,
            sourceReference: validated.sourceReference,
            beforeFacts: target.currentFacts,
            afterFacts: proposedFacts,
            oldFantasyPoints: preview.oldFantasyPoints,
            newFantasyPoints: preview.newFantasyPoints,
            oldActualRank: preview.oldActualRank,
            projectedActualRank: preview.projectedActualRank,
            changedFields: preview.changedFields,
            identicalNoOp,
            requiresRecalc: true,
            regradeOccurred: false,
            finishesRecalculated: false,
            unrelatedPositionsUnaffected: true,
            providerNote:
              target.provider === LIVE_MANUAL_PROVIDER
                ? "manual"
                : target.provider,
          },
        },
      });
      auditLogId = audit.id;
    });
    weekStatUpdated = true;

    const finishResult = await calculateLeagueActualFinishesForContest(
      target.contestId,
    );
    finishesRecalculated = true;

    const gradeResult = await gradeContest(target.contestId);
    graded = true;

    const contestAfter = await prisma.rankIQContest.findUniqueOrThrow({
      where: { id: target.contestId },
      select: { status: true },
    });
    const weekAfter = await prisma.week.findUniqueOrThrow({
      where: { id: target.weekId },
      select: { status: true },
    });
    const entryAfter = await prisma.contestEntry.findUniqueOrThrow({
      where: { id: target.contestEntryId },
      select: { actualRank: true, fantasyPoints: true },
    });

    const entriesAfter = await prisma.contestEntry.findMany({
      where: { contestId: target.contestId, excluded: false },
      include: { rankableEntry: { select: { name: true } } },
    });

    const finalRankChanges = preview.rankChanges.map((row) => {
      const after = entriesAfter.find(
        (e) => e.rankableEntryId === row.rankableEntryId,
      );
      return {
        ...row,
        newRank: after?.actualRank ?? row.newRank,
        fantasyPoints: after?.fantasyPoints ?? row.fantasyPoints,
      };
    });

    const recalcAudit = await logAdminAction({
      adminUserId: input.adminUserId,
      action: POST_FINAL_STAT_CORRECTION_RECALCULATED_ACTION,
      entityType: "RankIQContest",
      entityId: target.contestId,
      metadata: {
        stage: "recalculated",
        correctionAuditLogId: auditLogId,
        weekId: target.weekId,
        position: target.position,
        contestId: target.contestId,
        weekStatus: weekAfter.status,
        contestStatus: contestAfter.status,
        oldFantasyPoints: preview.oldFantasyPoints,
        newFantasyPoints: entryAfter.fantasyPoints,
        oldActualRank: preview.oldActualRank,
        newActualRank: entryAfter.actualRank,
        rankChanges: finalRankChanges,
        finishResult: {
          ranked: finishResult.ranked,
          tiedGroups: finishResult.tiedGroups,
          contestEntriesRanked: finishResult.contestEntriesRanked,
        },
        submissionsRegraded: gradeResult.graded,
        submissionsSkipped: gradeResult.skipped,
        identicalNoOp,
        regradeOccurred: true,
      },
    });

    return {
      ok: true,
      auditLogId,
      recalculatedAuditLogId: recalcAudit.id,
      contestId: target.contestId,
      position: target.position,
      oldFantasyPoints: preview.oldFantasyPoints,
      newFantasyPoints: entryAfter.fantasyPoints ?? preview.newFantasyPoints,
      oldActualRank: preview.oldActualRank,
      newActualRank: entryAfter.actualRank,
      rankChanges: finalRankChanges,
      submissionsRegraded: gradeResult.graded,
      weekStatus: weekAfter.status,
      contestStatus: contestAfter.status,
      identicalNoOp,
    };
  } catch (error) {
    const contestStatus = (
      await prisma.rankIQContest
        .findUnique({
          where: { id: target.contestId },
          select: { status: true },
        })
        .catch(() => null)
    )?.status;

    if (auditLogId) {
      await logAdminAction({
        adminUserId: input.adminUserId,
        action: "live_scoring.post_final_stat_correction_failed",
        entityType:
          input.kind === "player" ? "PlayerWeekStat" : "DefenseWeekStat",
        entityId: target.weekStatId,
        metadata: {
          correctionAuditLogId: auditLogId,
          weekStatUpdated,
          finishesRecalculated,
          graded,
          contestStatus: contestStatus ?? null,
          error: error instanceof Error ? error.message : "unknown",
        },
      }).catch(() => undefined);
    }

    return {
      ok: false,
      error: "apply_failed",
      message:
        error instanceof Error
          ? error.message
          : "Post-FINAL correction apply failed.",
      partialState: {
        weekStatUpdated,
        finishesRecalculated,
        graded,
        contestStatus: contestStatus ?? undefined,
      },
    };
  }
}

/** Resolve WeekStat id for a contest entry (manual provider preferred). */
export async function resolveWeekStatIdForContestEntry(input: {
  contestEntryId: string;
}): Promise<
  | { ok: true; kind: PostFinalStatKind; weekStatId: string }
  | { ok: false; message: string }
> {
  const entry = await prisma.contestEntry.findUnique({
    where: { id: input.contestEntryId },
    include: {
      contest: true,
      rankableEntry: true,
    },
  });
  if (!entry) return { ok: false, message: "Contest entry not found." };

  if (entry.contest.position === "DEF") {
    const row =
      (await prisma.defenseWeekStat.findFirst({
        where: {
          weekId: entry.contest.weekId,
          rankableEntryId: entry.rankableEntryId,
          provider: LIVE_MANUAL_PROVIDER,
        },
        select: { id: true },
      })) ??
      (await prisma.defenseWeekStat.findFirst({
        where: {
          weekId: entry.contest.weekId,
          rankableEntryId: entry.rankableEntryId,
        },
        select: { id: true },
      }));
    if (!row) return { ok: false, message: "No DefenseWeekStat for entry." };
    return { ok: true, kind: "defense", weekStatId: row.id };
  }

  const row =
    (await prisma.playerWeekStat.findFirst({
      where: {
        weekId: entry.contest.weekId,
        rankableEntryId: entry.rankableEntryId,
        provider: LIVE_MANUAL_PROVIDER,
      },
      select: { id: true },
    })) ??
    (await prisma.playerWeekStat.findFirst({
      where: {
        weekId: entry.contest.weekId,
        rankableEntryId: entry.rankableEntryId,
      },
      select: { id: true },
    }));
  if (!row) return { ok: false, message: "No PlayerWeekStat for entry." };
  return { ok: true, kind: "player", weekStatId: row.id };
}

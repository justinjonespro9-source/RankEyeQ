import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { readWaiverClock, type WaiverDb } from "@/lib/waivers/clock";
import { WaiverContestError } from "@/lib/waivers/contests";
import {
  computeLockedWaiverCorrectionImpact,
  loadCurrentWaiverBoards,
  loadFinalWaiverBoards,
  repinWaiverContestsOnSupersession,
  type WaiverRepinOutcome,
} from "@/lib/waivers/corrections";
import { WAIVER_POSITIONS } from "@/lib/waivers/constants";
import {
  assembleWaiverCorrectionPreview,
  normalizeWaiverCorrectionRequest,
  WAIVER_CORRECTION_ROW_ADDED,
  WAIVER_CORRECTION_ROW_REMOVED,
  waiverCorrectionCaseFor,
  type WaiverCorrectionBase,
  type WaiverCorrectionContestBoards,
  type WaiverCorrectionPreview,
  type WaiverCorrectionRequest,
  type WaiverRematchTarget,
} from "@/lib/waivers/snapshot/correct-model";
import { WaiverSnapshotError } from "@/lib/waivers/snapshot/errors";
import {
  loadWaiverEntryFacts,
  loadWaiverMatchIndex,
  loadWaiverTrackedPlayers,
  loadWaiverWeek,
  loadWaiverWeekGames,
} from "@/lib/waivers/snapshot/facts";
import {
  assertWaiverSnapshotAdmin,
  lockWaiverWeek,
  WAIVER_SNAPSHOT_TX_OPTIONS,
  waiverSnapshotEntryRows,
} from "@/lib/waivers/snapshot/freeze";
import { parseWaiverInput } from "@/lib/waivers/snapshot/input";
import {
  deserializeWaiverEntryFacts,
  matchedWaiverEntryIds,
  matchWaiverInputRows,
  serializeWaiverEntryEvidence,
  validateWaiverAcknowledgments,
  waiverEntryContext,
  type WaiverEntryContext,
  type WaiverPreviewEntry,
} from "@/lib/waivers/snapshot/preview-model";

export const WAIVER_CORRECTION_IMPORT_TYPE = "WAIVER_OWNERSHIP_CORRECTION";

type SnapshotHeader = WaiverCorrectionBase & { seasonId: string; status: string; currentForWeekId: string | null };

/** A frozen version's entries with the derivation context stored in its import log. */
export async function loadWaiverCorrectionBase(db: WaiverDb, snapshotId: string): Promise<SnapshotHeader | null> {
  const snapshot = await db.waiverSnapshot.findUnique({
    where: { id: snapshotId },
    select: {
      id: true,
      seasonId: true,
      weekId: true,
      version: true,
      status: true,
      currentForWeekId: true,
      thresholdBps: true,
      sourceLabel: true,
      sourceUrl: true,
      observedAt: true,
      manualImportLogId: true,
      entries: { orderBy: [{ inputLineNumber: "asc" }, { id: "asc" }] },
    },
  });
  if (!snapshot) return null;
  const first = await db.waiverSnapshot.findUniqueOrThrow({
    where: { weekId_version: { weekId: snapshot.weekId, version: 1 } },
    select: { frozenAt: true },
  });
  const log = snapshot.manualImportLogId
    ? await db.manualImportLog.findUnique({ where: { id: snapshot.manualImportLogId }, select: { metadata: true } })
    : null;
  const contexts = new Map(
    (((log?.metadata as { entryContext?: WaiverEntryContext[] } | null)?.entryContext ?? []) as WaiverEntryContext[]).map((context) => [
      context.rankableEntryId,
      context,
    ]),
  );
  const missingContextIds: string[] = [];
  const entries: WaiverPreviewEntry[] = [];
  for (const row of snapshot.entries) {
    const context = contexts.get(row.rankableEntryId);
    if (!context) {
      missingContextIds.push(row.rankableEntryId);
      continue;
    }
    entries.push({
      rankableEntryId: row.rankableEntryId,
      evidenceRole: row.evidenceRole,
      position: row.position,
      displayNameAtFreeze: row.displayNameAtFreeze,
      teamAtFreeze: row.teamAtFreeze,
      rosteredBps: row.rosteredBps,
      sourceLabel: row.sourceLabel,
      sourceUrl: row.sourceUrl,
      observedAt: row.observedAt,
      inputLineNumber: row.inputLineNumber,
      inputLine: row.inputLine,
      matchMethod: row.matchMethod,
      eligibility: row.eligibility,
      exclusionReason: row.exclusionReason,
      exclusionNote: row.exclusionNote,
      nflGameId: row.nflGameId,
      opponentAtFreeze: row.opponentAtFreeze,
      kickoffAtFreeze: row.kickoffAtFreeze,
      isByeAtFreeze: row.isByeAtFreeze,
      availabilityDesignationAtFreeze: row.availabilityDesignationAtFreeze,
      rosterStatusAtFreeze: row.rosterStatusAtFreeze,
      availabilitySourceAtFreeze: row.availabilitySourceAtFreeze,
      hardUnavailableAtFreeze: row.hardUnavailableAtFreeze,
      gameStatusAtFreeze: context.gameStatusAtFreeze,
      sourceTeam: context.sourceTeam,
      teamConflict: context.teamConflict,
      tracked: context.tracked,
      facts: deserializeWaiverEntryFacts(context.facts),
    });
  }
  return {
    id: snapshot.id,
    seasonId: snapshot.seasonId,
    weekId: snapshot.weekId,
    version: snapshot.version,
    status: snapshot.status,
    currentForWeekId: snapshot.currentForWeekId,
    thresholdBps: snapshot.thresholdBps,
    sourceLabel: snapshot.sourceLabel,
    sourceUrl: snapshot.sourceUrl,
    observedAt: snapshot.observedAt,
    originalFrozenAt: first.frozenAt,
    entries,
    missingContextIds: missingContextIds.sort(),
  };
}

async function loadCorrectionContests(db: WaiverDb, weekId: string, now: Date): Promise<WaiverCorrectionContestBoards[]> {
  const contests = await db.waiverContest.findMany({
    where: { weekId },
    orderBy: { position: "asc" },
    select: { id: true, position: true, locksAt: true, snapshotId: true },
  });
  const result: WaiverCorrectionContestBoards[] = [];
  for (const contest of contests) {
    const submissionCount = await db.waiverSubmission.count({ where: { contestId: contest.id } });
    const locked = waiverCorrectionCaseFor({ locksAt: contest.locksAt, submissionCount }, now) === "POST_LOCK";
    const boards = locked
      ? await loadFinalWaiverBoards(db, { contestId: contest.id, locksAt: contest.locksAt })
      : await loadCurrentWaiverBoards(db, { contestId: contest.id });
    result.push({
      contestId: contest.id,
      position: contest.position,
      locksAt: contest.locksAt,
      snapshotId: contest.snapshotId,
      submissionCount,
      boards: boards.map((board) => ({ submissionId: board.submissionId, calls: board.calls.map(({ callId, rankableEntryId }) => ({ callId, rankableEntryId })) })),
    });
  }
  return result;
}

/**
 * Read-only correction preview against the current version. Apply rebuilds
 * exactly this inside its transaction and compares `correctionFingerprint`.
 */
export async function buildWaiverCorrectionPreview(db: WaiverDb, request: WaiverCorrectionRequest): Promise<WaiverCorrectionPreview> {
  const base = await loadWaiverCorrectionBase(db, request.snapshotId);
  if (!base) throw new WaiverSnapshotError("NOT_FOUND", "Snapshot not found");
  if (base.status !== "FROZEN" || base.currentForWeekId !== base.weekId) {
    throw new WaiverSnapshotError("SNAPSHOT_NOT_CURRENT", "Only the current version can be corrected");
  }
  const week = await loadWaiverWeek(db, base.weekId);
  if (!week) throw new WaiverSnapshotError("NOT_FOUND", "Week not found");
  const now = await readWaiverClock(db);
  const games = await loadWaiverWeekGames(db, week.id);
  const tracked = await loadWaiverTrackedPlayers(db, { week, now, thresholdBps: base.thresholdBps });
  const trackedIds = new Set(tracked.map((player) => player.rankableEntryId));

  const rematchIds = [...new Set(request.ops.flatMap((op) => (op.kind === "REMATCH" ? [op.toRankableEntryId] : [])))].sort();
  const rematchTargets = new Map<string, WaiverRematchTarget | null>(rematchIds.map((id) => [id, null]));
  if (rematchIds.length > 0) {
    const players = await db.rankableEntry.findMany({
      where: { id: { in: rematchIds }, position: { in: [...WAIVER_POSITIONS] } },
      select: { id: true, position: true },
    });
    const facts = await loadWaiverEntryFacts(db, { weekId: week.id, seasonId: week.seasonId, rankableEntryIds: players.map((p) => p.id), games });
    for (const player of players) {
      const playerFacts = facts.get(player.id);
      if (playerFacts && player.position) {
        rematchTargets.set(player.id, { rankableEntryId: player.id, position: player.position as WaiverRematchTarget["position"], facts: playerFacts });
      }
    }
  }

  const addOp = request.ops.find((op) => op.kind === "ADD_ROWS");
  const addParse = addOp ? parseWaiverInput(addOp.rawText) : null;
  const addMatched = addParse
    ? matchWaiverInputRows(
        addParse.rows,
        await loadWaiverMatchIndex(db, { seasonId: week.seasonId, idLookups: addParse.rows.flatMap((row) => (row.rankEyeQId ? [row.rankEyeQId] : [])) }),
      )
    : [];
  const addFactsById = addMatched.length
    ? await loadWaiverEntryFacts(db, { weekId: week.id, seasonId: week.seasonId, rankableEntryIds: matchedWaiverEntryIds(addMatched), games })
    : new Map();

  const contests = await loadCorrectionContests(db, week.id, now);
  return assembleWaiverCorrectionPreview(request, {
    now,
    base,
    games,
    contests,
    trackedIds,
    rematchTargets,
    addParse,
    addMatched,
    addFactsById,
  });
}

export async function previewWaiverCorrection(request: WaiverCorrectionRequest): Promise<WaiverCorrectionPreview> {
  return buildWaiverCorrectionPreview(prisma, request);
}

export type WaiverCorrectionApplyInput = WaiverCorrectionRequest & {
  adminUserId: string;
  correctionFingerprint: string;
  acknowledged: ReadonlyArray<string>;
};

export type WaiverCorrectionApplyResult = {
  snapshotId: string;
  version: number;
  supersededSnapshotId: string;
  frozenAt: Date;
  correctionCase: WaiverCorrectionPreview["correctionCase"];
  changeCount: number;
  repin: WaiverRepinOutcome[];
};

const jsonValue = (value: unknown) => (value === null || value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue));

/**
 * Applies a correction as version n+1 in one transaction: admin re-check, week
 * lock, authoritative clock, server-side preview rebuild (fingerprint must
 * match), zero blockers, exact acknowledgments; then supersede n, insert n+1
 * with a full entry copy, one correction row per changed field, Phase 2
 * re-pin (before lock only) and audit. Nothing is graded, voided or rewritten.
 */
export async function applyWaiverCorrection(input: WaiverCorrectionApplyInput): Promise<WaiverCorrectionApplyResult> {
  return prisma.$transaction(async (tx) => {
    await assertWaiverSnapshotAdmin(tx, input.adminUserId);
    const target = await tx.waiverSnapshot.findUnique({ where: { id: input.snapshotId }, select: { weekId: true } });
    if (!target) throw new WaiverSnapshotError("NOT_FOUND", "Snapshot not found");
    await lockWaiverWeek(tx, target.weekId);
    const now = await readWaiverClock(tx);

    const preview = await buildWaiverCorrectionPreview(tx, input);
    if (preview.correctionFingerprint !== input.correctionFingerprint) {
      throw new WaiverSnapshotError("STALE_PREVIEW", "The snapshot, contests or canonical facts changed since the correction preview; preview again");
    }
    if (preview.blockers.length > 0) throw new WaiverSnapshotError("BLOCKED", "The correction preview has blockers", preview.blockers);
    const ackErrors = validateWaiverAcknowledgments(
      { requiredAcknowledgments: preview.requiredAcknowledgments, missingFollowUps: [] },
      input.acknowledged,
      [],
    );
    if (ackErrors.length > 0) {
      throw new WaiverSnapshotError("ACKNOWLEDGMENT", "Every CONFIRM item must be acknowledged exactly", ackErrors);
    }
    if (preview.observedAt.getTime() > now.getTime()) {
      throw new WaiverSnapshotError("OBSERVED_AFTER_FREEZE", "Observation time must not be after the correction time");
    }

    const from = await tx.waiverSnapshot.findUniqueOrThrow({
      where: { id: input.snapshotId },
      select: { id: true, seasonId: true, weekId: true, version: true, thresholdBps: true, sourceLabel: true, sourceUrl: true },
    });
    await tx.waiverSnapshot.update({ where: { id: from.id }, data: { status: "SUPERSEDED", currentForWeekId: null } });

    const normalized = normalizeWaiverCorrectionRequest(input);
    const acknowledged = [...input.acknowledged].sort();
    const importLog = await tx.manualImportLog.create({
      data: {
        adminUserId: input.adminUserId,
        weekId: from.weekId,
        importType: WAIVER_CORRECTION_IMPORT_TYPE,
        rowCount: normalized.ops.length,
        createdCount: preview.changes.filter((change) => change.field === WAIVER_CORRECTION_ROW_ADDED).length,
        updatedCount: new Set(
          preview.changes.filter((c) => c.field !== WAIVER_CORRECTION_ROW_ADDED && c.field !== WAIVER_CORRECTION_ROW_REMOVED).map((c) => c.rankableEntryId),
        ).size,
        excludedCount: preview.counts.excludedCount,
        warnings: preview.issues.filter((issue) => issue.level !== "BLOCKER") as unknown as Prisma.InputJsonValue,
        metadata: {
          v: 1,
          fromSnapshotId: from.id,
          fromVersion: from.version,
          request: normalized as unknown as Prisma.InputJsonValue,
          inputSha256: preview.inputSha256,
          correctionFingerprint: preview.correctionFingerprint,
          entriesFingerprint: preview.entriesFingerprint,
          correctionCase: preview.correctionCase,
          acknowledged,
          contests: preview.contests,
          changes: preview.changes as unknown as Prisma.InputJsonValue,
          frozenAt: now.toISOString(),
          entries: preview.entries.map(serializeWaiverEntryEvidence),
          entryContext: preview.entries.map(waiverEntryContext),
        } satisfies Prisma.InputJsonValue,
        createdAt: now,
      },
      select: { id: true },
    });
    const next = await tx.waiverSnapshot.create({
      data: {
        seasonId: from.seasonId,
        weekId: from.weekId,
        version: from.version + 1,
        status: "FROZEN",
        currentForWeekId: from.weekId,
        thresholdBps: from.thresholdBps,
        sourceLabel: from.sourceLabel,
        sourceUrl: from.sourceUrl,
        observedAt: preview.observedAt,
        frozenAt: now,
        frozenByUserId: input.adminUserId,
        rawInputSha256: preview.inputSha256,
        entriesFingerprint: preview.entriesFingerprint,
        ...preview.counts,
        supersedesId: from.id,
        correctionCase: preview.correctionCase,
        correctionReason: preview.reason,
        manualImportLogId: importLog.id,
      },
      select: { id: true, version: true },
    });
    await tx.waiverSnapshotEntry.createMany({ data: waiverSnapshotEntryRows(next.id, preview.entries) });
    await tx.waiverSnapshotCorrection.createMany({
      data: preview.changes.map((change) => ({
        fromSnapshotId: from.id,
        toSnapshotId: next.id,
        rankableEntryId: change.rankableEntryId,
        field: change.field,
        originalValue: jsonValue(change.originalValue),
        correctedValue: jsonValue(change.correctedValue),
        reason: change.reason,
        correctionCase: change.correctionCase,
        policy: change.policy,
        eligibilityBefore: change.eligibilityBefore,
        eligibilityAfter: change.eligibilityAfter,
        affectedSubmissionCount: change.affectedSubmissionIds.length,
        affectedCallIds: change.affectedCallIds,
        operatorUserId: input.adminUserId,
        createdAt: now,
      })),
    });

    let repin: WaiverRepinOutcome[];
    try {
      repin = await repinWaiverContestsOnSupersession(tx, { fromSnapshotId: from.id, toSnapshotId: next.id, adminUserId: input.adminUserId });
    } catch (error) {
      if (error instanceof WaiverContestError) throw new WaiverSnapshotError("SNAPSHOT_NOT_CURRENT", error.message);
      throw error;
    }
    const expectedRepins = preview.contests.filter((contest) => contest.willRepin).map((contest) => contest.contestId).sort();
    const actualRepins = repin.filter((outcome) => outcome.outcome === "REPINNED").map((outcome) => outcome.contestId).sort();
    if (JSON.stringify(expectedRepins) !== JSON.stringify(actualRepins)) {
      throw new WaiverSnapshotError("STALE_PREVIEW", "A contest locked while the correction was applied; preview again");
    }

    const lockedImpact = [];
    for (const contest of preview.contests.filter((c) => c.correctionCase === "POST_LOCK")) {
      const locksAt = (await tx.waiverContest.findUniqueOrThrow({ where: { id: contest.contestId }, select: { locksAt: true } })).locksAt;
      lockedImpact.push({
        contestId: contest.contestId,
        position: contest.position,
        ...(await computeLockedWaiverCorrectionImpact(tx, { contestId: contest.contestId, position: contest.position, locksAt, snapshotId: next.id })),
      });
    }

    await tx.adminAuditLog.create({
      data: {
        adminUserId: input.adminUserId,
        action: "waivers.snapshot_corrected",
        entityType: "WaiverSnapshot",
        entityId: next.id,
        metadata: {
          weekId: from.weekId,
          fromSnapshotId: from.id,
          fromVersion: from.version,
          toVersion: next.version,
          manualImportLogId: importLog.id,
          frozenAt: now.toISOString(),
          reason: preview.reason,
          correctionCase: preview.correctionCase,
          inputSha256: preview.inputSha256,
          correctionFingerprint: preview.correctionFingerprint,
          entriesFingerprint: preview.entriesFingerprint,
          counts: preview.counts,
          changeCount: preview.changes.length,
          policies: preview.changes.map((change) => ({ rankableEntryId: change.rankableEntryId, field: change.field, policy: change.policy })),
          acknowledged,
          repin: repin as unknown as Prisma.InputJsonValue,
          lockedImpact,
        } satisfies Prisma.InputJsonValue,
        createdAt: now,
      },
    });

    return {
      snapshotId: next.id,
      version: next.version,
      supersededSnapshotId: from.id,
      frozenAt: now,
      correctionCase: preview.correctionCase,
      changeCount: preview.changes.length,
      repin,
    };
  }, WAIVER_SNAPSHOT_TX_OPTIONS);
}

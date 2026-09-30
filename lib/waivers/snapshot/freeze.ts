import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { readWaiverClock } from "@/lib/waivers/clock";
import { assertWaiverAdminUser, WaiverContestError } from "@/lib/waivers/contests";
import { WaiverSnapshotError } from "@/lib/waivers/snapshot/errors";
import { normalizeWaiverInputText, waiverRawInputSha256 } from "@/lib/waivers/snapshot/input";
import { buildWaiverSnapshotPreview, type WaiverSnapshotPreviewInput } from "@/lib/waivers/snapshot/preview";
import {
  serializeWaiverEntryEvidence,
  validateWaiverAcknowledgments,
  waiverEntryContext,
  type WaiverFollowUpAck,
  type WaiverPreviewEntry,
  type WaiverSnapshotCounts,
  type WaiverSnapshotPreview,
} from "@/lib/waivers/snapshot/preview-model";

export const WAIVER_SNAPSHOT_IMPORT_TYPE = "WAIVER_OWNERSHIP_SNAPSHOT";
export const WAIVER_SNAPSHOT_TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 } as const;

export type WaiverFreezeInput = WaiverSnapshotPreviewInput & {
  adminUserId: string;
  previewFingerprint: string;
  acknowledged: ReadonlyArray<string>;
  followUpAcks: ReadonlyArray<WaiverFollowUpAck>;
};

export type WaiverFreezeResult = {
  snapshotId: string;
  version: number;
  alreadyFrozen: boolean;
  frozenAt: Date;
  counts: WaiverSnapshotCounts;
  contestsCanOpen: boolean;
  locksAt: Date | null;
};

export async function assertWaiverSnapshotAdmin(tx: Prisma.TransactionClient, userId: string) {
  try {
    await assertWaiverAdminUser(tx, userId);
  } catch (error) {
    if (error instanceof WaiverContestError && error.code === "FORBIDDEN") {
      throw new WaiverSnapshotError("FORBIDDEN", "Admin access required");
    }
    throw error;
  }
}

/** Serializes freezes and corrections per week. */
export async function lockWaiverWeek(tx: Prisma.TransactionClient, weekId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Week" WHERE "id" = ${weekId} FOR UPDATE`;
  if (rows.length === 0) throw new WaiverSnapshotError("NOT_FOUND", "Week not found");
}

export function waiverSnapshotEntryRows(snapshotId: string, entries: ReadonlyArray<WaiverPreviewEntry>): Prisma.WaiverSnapshotEntryCreateManyInput[] {
  return entries.map((entry) => ({
    snapshotId,
    rankableEntryId: entry.rankableEntryId,
    evidenceRole: entry.evidenceRole,
    position: entry.position,
    displayNameAtFreeze: entry.displayNameAtFreeze,
    teamAtFreeze: entry.teamAtFreeze,
    rosteredBps: entry.rosteredBps,
    sourceLabel: entry.sourceLabel,
    sourceUrl: entry.sourceUrl,
    observedAt: entry.observedAt,
    inputLineNumber: entry.inputLineNumber,
    inputLine: entry.inputLine,
    matchMethod: entry.matchMethod,
    eligibility: entry.eligibility,
    exclusionReason: entry.exclusionReason,
    exclusionNote: entry.exclusionNote,
    nflGameId: entry.nflGameId,
    opponentAtFreeze: entry.opponentAtFreeze,
    kickoffAtFreeze: entry.kickoffAtFreeze,
    isByeAtFreeze: entry.isByeAtFreeze,
    availabilityDesignationAtFreeze: entry.availabilityDesignationAtFreeze,
    rosterStatusAtFreeze: entry.rosterStatusAtFreeze,
    availabilitySourceAtFreeze: entry.availabilitySourceAtFreeze,
    hardUnavailableAtFreeze: entry.hardUnavailableAtFreeze,
  }));
}

/** Game event status per entry (no column exists for it) — kept in import-log metadata. */
export function waiverGameStatusEvidence(entries: ReadonlyArray<WaiverPreviewEntry>) {
  return entries
    .filter((entry) => entry.nflGameId)
    .map((entry) => ({ rankableEntryId: entry.rankableEntryId, nflGameId: entry.nflGameId, status: entry.gameStatusAtFreeze }));
}

function freezeMetadata(input: WaiverFreezeInput, preview: WaiverSnapshotPreview, frozenAt: Date) {
  return {
    v: 1,
    rawInput: normalizeWaiverInputText(input.rawText),
    rawInputSha256: preview.rawInputSha256,
    previewFingerprint: preview.previewFingerprint,
    entriesFingerprint: preview.entriesFingerprint,
    header: {
      sourceLabel: preview.header.sourceLabel,
      sourceUrl: preview.header.sourceUrl,
      formObservedAt: input.observedAt?.toISOString() ?? null,
      observedAt: preview.header.observedAt?.toISOString() ?? null,
      thresholdBps: preview.header.thresholdBps,
    },
    frozenAt: frozenAt.toISOString(),
    acknowledged: [...input.acknowledged].sort(),
    followUpAcks: [...input.followUpAcks].sort((a, b) => (a.rankableEntryId < b.rankableEntryId ? -1 : 1)),
    missingFollowUps: preview.missingFollowUps,
    teamConflicts: preview.entries
      .filter((entry) => entry.teamConflict)
      .map((entry) => ({ rankableEntryId: entry.rankableEntryId, sourceTeam: entry.sourceTeam, canonicalTeam: entry.teamAtFreeze, line: entry.inputLineNumber })),
    gameStatuses: waiverGameStatusEvidence(preview.entries),
    completeness: preview.completeness,
    locksAt: preview.locksAt?.toISOString() ?? null,
    contestsCanOpen: preview.contestsCanOpen,
    rowStateCounts: preview.rowStateCounts,
    entries: preview.entries.map(serializeWaiverEntryEvidence),
    entryContext: preview.entries.map(waiverEntryContext),
  } satisfies Prisma.InputJsonValue;
}

/**
 * Freezes version 1 of the week's Official Waiver Snapshot in one
 * transaction: admin re-check, week row lock, authoritative clock, server-side
 * preview rebuild (fingerprint must match), zero blockers, exact
 * acknowledgments, then import log + header + entries + audit, all stamped
 * with `waiver_utc_now()`. Never opens contests.
 */
export async function freezeWaiverSnapshot(input: WaiverFreezeInput): Promise<WaiverFreezeResult> {
  return prisma.$transaction(async (tx) => {
    await assertWaiverSnapshotAdmin(tx, input.adminUserId);
    await lockWaiverWeek(tx, input.weekId);
    const now = await readWaiverClock(tx);

    const existing = await tx.waiverSnapshot.findFirst({
      where: { weekId: input.weekId },
      orderBy: { version: "desc" },
      select: { id: true, version: true, frozenAt: true, manualImportLogId: true, rawInputSha256: true, candidateCount: true, eligibleCount: true, excludedCount: true, followUpCount: true },
    });
    if (existing) {
      const log = existing.version === 1 && existing.manualImportLogId
        ? await tx.manualImportLog.findUnique({ where: { id: existing.manualImportLogId }, select: { metadata: true } })
        : null;
      const priorFingerprint = (log?.metadata as { previewFingerprint?: string } | null)?.previewFingerprint;
      if (priorFingerprint === input.previewFingerprint && existing.rawInputSha256 === waiverRawInputSha256(input.rawText)) {
        return {
          snapshotId: existing.id,
          version: existing.version,
          alreadyFrozen: true,
          frozenAt: existing.frozenAt,
          counts: {
            candidateCount: existing.candidateCount,
            eligibleCount: existing.eligibleCount,
            excludedCount: existing.excludedCount,
            followUpCount: existing.followUpCount,
          },
          contestsCanOpen: false,
          locksAt: null,
        };
      }
      throw new WaiverSnapshotError("ALREADY_FROZEN", `Version ${existing.version} already exists for this week; use a correction`);
    }

    const preview = await buildWaiverSnapshotPreview(tx, input);
    if (preview.previewFingerprint !== input.previewFingerprint) {
      throw new WaiverSnapshotError("STALE_PREVIEW", "Canonical facts or input changed since the preview; preview again");
    }
    if (preview.blockers.length > 0) {
      throw new WaiverSnapshotError("BLOCKED", "The preview has blockers", preview.blockers);
    }
    const ackErrors = validateWaiverAcknowledgments(preview, input.acknowledged, input.followUpAcks);
    if (ackErrors.length > 0) {
      throw new WaiverSnapshotError("ACKNOWLEDGMENT", "Every CONFIRM item and missing follow-up must be acknowledged exactly", ackErrors);
    }
    const observedAt = preview.header.observedAt;
    if (!observedAt || observedAt.getTime() > now.getTime()) {
      throw new WaiverSnapshotError("OBSERVED_AFTER_FREEZE", "Observation time must not be after the freeze time");
    }

    const week = await tx.week.findUniqueOrThrow({ where: { id: input.weekId }, select: { seasonId: true } });
    const metadata = freezeMetadata(input, preview, now);
    const importLog = await tx.manualImportLog.create({
      data: {
        adminUserId: input.adminUserId,
        weekId: input.weekId,
        importType: WAIVER_SNAPSHOT_IMPORT_TYPE,
        rowCount: preview.rows.length,
        createdCount: preview.entries.length,
        updatedCount: 0,
        excludedCount: preview.counts.excludedCount,
        warnings: preview.issues.filter((issue) => issue.level !== "BLOCKER") as unknown as Prisma.InputJsonValue,
        metadata,
        createdAt: now,
      },
      select: { id: true },
    });
    const snapshot = await tx.waiverSnapshot.create({
      data: {
        seasonId: week.seasonId,
        weekId: input.weekId,
        version: 1,
        status: "FROZEN",
        currentForWeekId: input.weekId,
        thresholdBps: preview.header.thresholdBps,
        sourceLabel: preview.header.sourceLabel,
        sourceUrl: preview.header.sourceUrl,
        observedAt,
        frozenAt: now,
        frozenByUserId: input.adminUserId,
        rawInputSha256: preview.rawInputSha256,
        entriesFingerprint: preview.entriesFingerprint,
        ...preview.counts,
        manualImportLogId: importLog.id,
      },
      select: { id: true, version: true },
    });
    await tx.waiverSnapshotEntry.createMany({ data: waiverSnapshotEntryRows(snapshot.id, preview.entries) });
    await tx.adminAuditLog.create({
      data: {
        adminUserId: input.adminUserId,
        action: "waivers.snapshot_frozen",
        entityType: "WaiverSnapshot",
        entityId: snapshot.id,
        metadata: {
          weekId: input.weekId,
          version: snapshot.version,
          manualImportLogId: importLog.id,
          frozenAt: now.toISOString(),
          observedAt: observedAt.toISOString(),
          sourceLabel: preview.header.sourceLabel,
          sourceUrl: preview.header.sourceUrl,
          rawInputSha256: preview.rawInputSha256,
          previewFingerprint: preview.previewFingerprint,
          entriesFingerprint: preview.entriesFingerprint,
          counts: preview.counts,
          acknowledged: metadata.acknowledged,
          followUpAcks: metadata.followUpAcks,
          contestsCanOpen: preview.contestsCanOpen,
        } satisfies Prisma.InputJsonValue,
        createdAt: now,
      },
    });
    return {
      snapshotId: snapshot.id,
      version: snapshot.version,
      alreadyFrozen: false,
      frozenAt: now,
      counts: preview.counts,
      contestsCanOpen: preview.contestsCanOpen,
      locksAt: preview.locksAt,
    };
  }, WAIVER_SNAPSHOT_TX_OPTIONS);
}

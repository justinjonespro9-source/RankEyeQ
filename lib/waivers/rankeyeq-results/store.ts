import { canAccessAdmin } from "@/lib/admin/access";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { readWaiverClock, type WaiverDb } from "@/lib/waivers/clock";
import { buildRankEyeQFinalWeekStatsSnapshot } from "@/lib/waivers/rankeyeq-results/build";
import { canonicalRankEyeQJson, sha256Hex } from "@/lib/waivers/rankeyeq-results/checksum";
import {
  RANKEYEQ_RESULTS_ATTESTATION_TEXT,
  RANKEYEQ_RESULTS_ATTESTATION_VERSION,
  RANKEYEQ_RESULTS_AUTHORITY_BASIS,
} from "@/lib/waivers/rankeyeq-results/contract";
import { RankEyeQResultsError } from "@/lib/waivers/rankeyeq-results/errors";
import { projectRankEyeQResultsSource, type VerifiedRankEyeQResultsSource } from "@/lib/waivers/rankeyeq-results/ledger";
import { applyParticipationDecisions, listRankEyeQParticipationReviewItems } from "@/lib/waivers/rankeyeq-results/participation";
import type {
  RankEyeQBuildBlocker,
  RankEyeQDecisionRejection,
  RankEyeQFinalWeekStatsContent,
  RankEyeQParticipationDecisionInput,
  RankEyeQParticipationReviewItem,
} from "@/lib/waivers/rankeyeq-results/types";
import { verifyRankEyeQFinalWeekStatsSnapshot, type RankEyeQVerificationIssue } from "@/lib/waivers/rankeyeq-results/verify";

/**
 * Preview and commit of RankEyeQ final-week-stats snapshots.
 *
 * Preview issues only SELECTs. Commit writes exactly one immutable snapshot
 * row, its applied participation decisions, the predecessor's SUPERSEDED
 * transition and an admin audit row, in one transaction, and only when called.
 * Neither grades, touches contests, WeekStat rows or any SNG artifact.
 */

export const RANKEYEQ_RESULTS_TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 } as const;
export const RANKEYEQ_RESULTS_SOURCE_REFERENCE_MAX = 500;

export type RankEyeQResultsPreviewRequest = {
  weekId: string;
  decisions?: readonly RankEyeQParticipationDecisionInput[];
};

export type RankEyeQResultsPreviewBlocker =
  | RankEyeQBuildBlocker
  | { code: "DECISION_REJECTED"; detail: string; rankableEntryId: string }
  | { code: "UNRESOLVED_PARTICIPANTS"; detail: string }
  | { code: "VERIFICATION_FAILED"; detail: string; issue: RankEyeQVerificationIssue }
  | { code: "CHECKSUM_STORED_NOT_ACCEPTED"; detail: string };

export type RankEyeQResultsPreview = {
  status: "READY" | "BLOCKED" | "ALREADY_COMMITTED";
  weekId: string;
  content: RankEyeQFinalWeekStatsContent | null;
  contentChecksum: string | null;
  blockers: RankEyeQResultsPreviewBlocker[];
  reviewItems: RankEyeQParticipationReviewItem[];
  rejectedDecisions: readonly RankEyeQDecisionRejection[];
  seriesKey: string | null;
  revision: number | null;
  supersedesSnapshotId: string | null;
  /** The stored snapshot with identical content, when ALREADY_COMMITTED. */
  existingSnapshotId: string | null;
  previewFingerprint: string | null;
};

const EMPTY_PREVIEW = (weekId: string): RankEyeQResultsPreview => ({
  status: "BLOCKED",
  weekId,
  content: null,
  contentChecksum: null,
  blockers: [],
  reviewItems: [],
  rejectedDecisions: [],
  seriesKey: null,
  revision: null,
  supersedesSnapshotId: null,
  existingSnapshotId: null,
  previewFingerprint: null,
});

/** Builds the full preview against `db`. Issues only SELECTs. */
export async function buildRankEyeQResultsPreview(db: WaiverDb, request: RankEyeQResultsPreviewRequest): Promise<RankEyeQResultsPreview> {
  const build = await buildRankEyeQFinalWeekStatsSnapshot({ weekId: request.weekId }, db);
  if (!build.content) return { ...EMPTY_PREVIEW(request.weekId), blockers: [...build.blockers] };

  const applied = applyParticipationDecisions(build.content, request.decisions ?? []);
  const content = applied.content;
  const reviewItems = listRankEyeQParticipationReviewItems(content);
  const blockers: RankEyeQResultsPreviewBlocker[] = [
    ...applied.rejected.map((rejection) => ({ code: "DECISION_REJECTED" as const, detail: `${rejection.code}: ${rejection.detail}`, rankableEntryId: rejection.rankableEntryId })),
  ];
  if (reviewItems.length > 0) {
    const pending = reviewItems.filter((item) => item.state === "PENDING_ZERO_REVIEW").length;
    blockers.push({
      code: "UNRESOLVED_PARTICIPANTS",
      detail: `${pending} zero-point participant(s) need an operator decision and ${reviewItems.length - pending} absent participant(s) need DID_NOT_PLAY evidence (or a corrected WeekStat rebuild)`,
    });
  }
  // Unresolved participants are reported above; verify everything else.
  const verification = verifyRankEyeQFinalWeekStatsSnapshot(content, { expectedWeekId: request.weekId, allowUnresolved: true });
  if (!verification.ok) {
    for (const issue of verification.issues) blockers.push({ code: "VERIFICATION_FAILED", detail: `${issue.code}: ${issue.detail}`, issue });
  }
  const contentChecksum = verification.ok ? verification.verified.contentChecksum : null;

  const latest = await db.waiverRankEyeQResultsSnapshot.findFirst({
    where: { seriesKey: content.seriesKey },
    orderBy: { revision: "desc" },
    select: { id: true, revision: true, contentChecksum: true, publicationState: true },
  });
  const stored = contentChecksum ? await db.waiverRankEyeQResultsSnapshot.findUnique({ where: { contentChecksum }, select: { id: true, publicationState: true } }) : null;
  const revision = latest ? latest.revision + 1 : 1;
  const supersedesSnapshotId = latest?.id ?? null;
  const base: RankEyeQResultsPreview = {
    status: "BLOCKED",
    weekId: request.weekId,
    content,
    contentChecksum,
    blockers,
    reviewItems,
    rejectedDecisions: applied.rejected,
    seriesKey: content.seriesKey,
    revision,
    supersedesSnapshotId,
    existingSnapshotId: null,
    previewFingerprint: null,
  };
  if (stored) {
    if (stored.publicationState === "ACCEPTED" && latest?.id === stored.id && blockers.length === 0) {
      return { ...base, status: "ALREADY_COMMITTED", existingSnapshotId: stored.id, revision: latest.revision, supersedesSnapshotId: null };
    }
    blockers.push({
      code: "CHECKSUM_STORED_NOT_ACCEPTED",
      detail: `Identical content is already stored as snapshot ${stored.id} (${stored.publicationState}); it cannot be committed again`,
    });
  }
  if (blockers.length > 0 || !contentChecksum) return base;
  return {
    ...base,
    status: "READY",
    previewFingerprint: sha256Hex(canonicalRankEyeQJson({ v: 1, weekId: request.weekId, contentChecksum, revision, supersedesSnapshotId })),
  };
}

/** Read-only preview. Writes nothing. */
export async function previewRankEyeQFinalWeekStats(request: RankEyeQResultsPreviewRequest): Promise<RankEyeQResultsPreview> {
  return buildRankEyeQResultsPreview(prisma, request);
}

export async function assertRankEyeQResultsAdmin(db: WaiverDb, userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user || !canAccessAdmin(user.role)) throw new RankEyeQResultsError("FORBIDDEN", "Admin access required");
}

/** Serializes snapshot commits per week. */
async function lockWeek(tx: Prisma.TransactionClient, weekId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Week" WHERE "id" = ${weekId} FOR UPDATE`;
  if (rows.length === 0) throw new RankEyeQResultsError("NOT_FOUND", "Week not found");
}

export type RankEyeQResultsCommitInput = RankEyeQResultsPreviewRequest & {
  adminUserId: string;
  previewFingerprint: string;
  sourceReference: string;
  attested: boolean;
};

export type RankEyeQResultsCommitResult = {
  snapshotRowId: string;
  revision: number;
  contentChecksum: string;
  alreadyCommitted: boolean;
  supersededSnapshotRowId: string | null;
};

/**
 * Commits one verified, fully resolved snapshot in a single transaction: admin
 * re-check, week lock, server-side preview rebuild (fingerprint must match,
 * zero blockers), then the immutable snapshot row, its decision rows, the
 * predecessor's SUPERSEDED transition and an audit row. An identical re-commit
 * writes nothing.
 */
export async function commitRankEyeQFinalWeekStats(input: RankEyeQResultsCommitInput): Promise<RankEyeQResultsCommitResult> {
  if (input.attested !== true) throw new RankEyeQResultsError("ATTESTATION_REQUIRED", "The operator attestation is required to commit");
  const sourceReference = input.sourceReference?.trim() ?? "";
  if (sourceReference === "" || sourceReference.length > RANKEYEQ_RESULTS_SOURCE_REFERENCE_MAX) {
    throw new RankEyeQResultsError("INVALID_INPUT", `A source reference (1-${RANKEYEQ_RESULTS_SOURCE_REFERENCE_MAX} characters) is required`);
  }
  return prisma.$transaction(async (tx) => {
    await assertRankEyeQResultsAdmin(tx, input.adminUserId);
    await lockWeek(tx, input.weekId);
    const preview = await buildRankEyeQResultsPreview(tx, { weekId: input.weekId, decisions: input.decisions });
    if (preview.status === "ALREADY_COMMITTED") {
      const existing = await tx.waiverRankEyeQResultsSnapshot.findUniqueOrThrow({
        where: { id: preview.existingSnapshotId! },
        select: { id: true, revision: true, contentChecksum: true },
      });
      return { snapshotRowId: existing.id, revision: existing.revision, contentChecksum: existing.contentChecksum, alreadyCommitted: true, supersededSnapshotRowId: null };
    }
    if (preview.status !== "READY" || !preview.content || !preview.contentChecksum || preview.revision === null) {
      throw new RankEyeQResultsError("BLOCKED", "The RankEyeQ results preview has blockers", preview.blockers);
    }
    if (preview.previewFingerprint !== input.previewFingerprint) {
      throw new RankEyeQResultsError("STALE_PREVIEW", "The week stats, snapshot or results history changed since the preview; preview again");
    }
    const { content } = preview;
    const builtAt = await readWaiverClock(tx);
    const row = await tx.waiverRankEyeQResultsSnapshot.create({
      data: {
        weekId: input.weekId,
        revision: preview.revision,
        schemaVersion: content.schemaVersion,
        contentChecksum: preview.contentChecksum,
        scoringVersion: content.scoringVersion,
        rankingsWeekStatus: content.rankingsWeekStatus,
        sourceWeekId: content.sourceWeekId,
        seriesKey: content.seriesKey,
        supersedesSnapshotId: preview.supersedesSnapshotId,
        participantCount: content.summary.participantCount,
        pendingZeroCount: content.summary.pendingZeroCount,
        unresolvedCount: content.summary.unresolvedCount,
        authorityBasis: RANKEYEQ_RESULTS_AUTHORITY_BASIS,
        attestationVersion: RANKEYEQ_RESULTS_ATTESTATION_VERSION,
        attestationText: RANKEYEQ_RESULTS_ATTESTATION_TEXT,
        sourceReference,
        previewFingerprint: preview.previewFingerprint!,
        builtByUserId: input.adminUserId,
        builtAt,
        publicationState: "ACCEPTED",
        content: content as unknown as Prisma.InputJsonValue,
      },
      select: { id: true, revision: true, contentChecksum: true },
    });
    const decisions = content.participants.flatMap((participant) =>
      participant.evidence.decision
        ? [
            {
              snapshotId: row.id,
              rankableEntryId: participant.rankableEntryId,
              decision: participant.evidence.decision.decision,
              evidenceReference: participant.evidence.decision.evidenceReference,
              reason: participant.evidence.decision.reason,
              decidedByUserId: participant.evidence.decision.decidedByUserId,
              decidedAt: new Date(participant.evidence.decision.decidedAt),
            },
          ]
        : [],
    );
    if (decisions.length > 0) await tx.waiverRankEyeQParticipationDecision.createMany({ data: decisions });

    let supersededSnapshotRowId: string | null = null;
    if (preview.supersedesSnapshotId) {
      const previous = await tx.waiverRankEyeQResultsSnapshot.findUniqueOrThrow({
        where: { id: preview.supersedesSnapshotId },
        select: { id: true, publicationState: true },
      });
      if (previous.publicationState === "ACCEPTED") {
        await tx.waiverRankEyeQResultsSnapshot.update({ where: { id: previous.id }, data: { publicationState: "SUPERSEDED" } });
        supersededSnapshotRowId = previous.id;
      }
    }
    await tx.adminAuditLog.create({
      data: {
        adminUserId: input.adminUserId,
        action: "waivers.rankeyeq_results_snapshot_committed",
        entityType: "WaiverRankEyeQResultsSnapshot",
        entityId: row.id,
        metadata: {
          weekId: input.weekId,
          seriesKey: content.seriesKey,
          revision: row.revision,
          supersedesSnapshotId: preview.supersedesSnapshotId,
          contentChecksum: row.contentChecksum,
          participantCount: content.summary.participantCount,
          decisionCount: decisions.length,
          sourceReference,
        },
      },
    });
    return { snapshotRowId: row.id, revision: row.revision, contentChecksum: row.contentChecksum, alreadyCommitted: false, supersededSnapshotRowId };
  }, RANKEYEQ_RESULTS_TX_OPTIONS);
}

export type RankEyeQResultsSourceLoad =
  | { ok: true; source: VerifiedRankEyeQResultsSource }
  | { ok: false; code: "NO_ACCEPTED_SNAPSHOT" | "VERIFICATION_FAILED"; issues: RankEyeQVerificationIssue[] };

/**
 * Loads the week's current ACCEPTED RankEyeQ snapshot, re-verifies its stored
 * checksum and metadata, and projects it into the grading-ready source.
 * Read-only.
 */
export async function loadVerifiedRankEyeQResultsSource(db: WaiverDb, weekId: string): Promise<RankEyeQResultsSourceLoad> {
  const row = await db.waiverRankEyeQResultsSnapshot.findFirst({
    where: { weekId, publicationState: "ACCEPTED" },
    orderBy: { revision: "desc" },
  });
  if (!row) return { ok: false, code: "NO_ACCEPTED_SNAPSHOT", issues: [] };
  const verification = verifyRankEyeQFinalWeekStatsSnapshot(row.content, {
    expectedContentChecksum: row.contentChecksum,
    expectedWeekId: weekId,
    publicationState: row.publicationState,
    row: {
      schemaVersion: row.schemaVersion,
      scoringVersion: row.scoringVersion,
      rankingsWeekStatus: row.rankingsWeekStatus,
      sourceWeekId: row.sourceWeekId,
      seriesKey: row.seriesKey,
      weekId: row.weekId,
      participantCount: row.participantCount,
      pendingZeroCount: row.pendingZeroCount,
      unresolvedCount: row.unresolvedCount,
      authorityBasis: row.authorityBasis,
      attestationVersion: row.attestationVersion,
    },
  });
  if (!verification.ok) return { ok: false, code: "VERIFICATION_FAILED", issues: verification.issues };
  return {
    ok: true,
    source: projectRankEyeQResultsSource(verification.verified, { snapshotRowId: row.id, revision: row.revision, authorityBasis: row.authorityBasis }),
  };
}

import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { WaiverPosition } from "@/lib/waivers/constants";
import { WaiverGradingError } from "@/lib/waivers/grading/errors";
import {
  waiverBoardGradeCreateData,
  waiverCallGradeCreateData,
  waiverContestResultCreateData,
  waiverEmptyPositionResultCreateData,
  waiverGradeRunCreateData,
  waiverPoolResultCreateData,
} from "@/lib/waivers/grading/rows";
import {
  isWaiverGradingSourceStorable,
  loadWaiverWeekGradingPreviewFromSource,
  waiverGradingSourceOfStored,
  waiverStoredSourceRef,
  type WaiverGradingSource,
} from "@/lib/waivers/grading/source";
import type { WaiverWeekGradingPreview } from "@/lib/waivers/grading/week";
import {
  WAIVER_GRADING_APPROVAL_ATTESTATION_TEXT,
  WAIVER_GRADING_APPROVAL_ATTESTATION_VERSION,
  WAIVER_GRADING_APPROVAL_RANKEYEQ_ATTESTATION_TEXT,
  WAIVER_GRADING_APPROVAL_RANKEYEQ_ATTESTATION_VERSION,
  WAIVER_RANKEYEQ_NATIVE_CROSSWALK_VERSION,
  type WaiverGradeApprovalPolicy,
} from "@/lib/waivers/results/model";

/**
 * Production grading lifecycle services, one per operator stage:
 *
 *   preview (SELECT only) -> store run -> approve -> apply -> publish
 *
 * Each stage is a separate, admin-authorized, audit-logged transaction. No
 * stage performs another: storing never approves, approving never applies,
 * applying (moving week authority to CURRENT) never publishes, and publishing
 * is the only step that makes grades visible on public leaderboards.
 *
 * Every write stage re-evaluates the live inputs inside its own transaction
 * (the read-only preview) and refuses when the reviewed run no longer matches:
 * a changed source checksum, a superseded or withdrawn source revision, a
 * new D3 decision, or an incomplete (BLOCKED) preview. WAIVER_EYEQ_V1 scoring
 * is untouched; rows come from the pure engine through `grading/rows.ts`.
 *
 * Dual source: a run is bound to exactly one verified source, either an SNG
 * canonical artifact (`artifactRowId`) or a RankEyeQ final-week-stats snapshot
 * (`rankEyeQSnapshotId`); the database enforces the XOR. The stored run decides
 * which source later stages re-verify, so a RankEyeQ run is never re-checked
 * against SNG (and vice versa).
 */

const TX = { maxWait: 10_000, timeout: 300_000 } as const;
const REASON_MAX = 1_000;

type Tx = Prisma.TransactionClient;

// ---------------------------------------------------------------------------
// Shared guards
// ---------------------------------------------------------------------------

/** Application-level admin check (the database re-checks every actor with `waiver_require_admin`). */
async function assertAdmin(tx: Tx, adminUserId: string) {
  const user = await tx.user.findUnique({ where: { id: adminUserId }, select: { role: true } });
  if (!user || user.role !== "ADMIN") throw new WaiverGradingError("FORBIDDEN", "Admin access required");
}

/** Serializes every grading stage per week (same locks as artifact import and the storage triggers). */
async function lockWeek(tx: Tx, weekId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Week" WHERE "id" = ${weekId} FOR UPDATE`;
  if (rows.length === 0) throw new WaiverGradingError("NOT_FOUND", "Week not found");
  await tx.$executeRaw`SELECT "waiver_grade_week_lock"(${weekId})`;
}

async function begin(tx: Tx, adminUserId: string, weekId: string) {
  await assertAdmin(tx, adminUserId);
  await lockWeek(tx, weekId);
}

function reasonOf(reason: unknown): string {
  if (typeof reason !== "string" || !reason.trim()) throw new WaiverGradingError("INVALID_INPUT", "A reason is required");
  if (reason.length > REASON_MAX) throw new WaiverGradingError("INVALID_INPUT", `The reason is limited to ${REASON_MAX} characters`);
  return reason.trim();
}

const SOURCE_CODES = new Set(["ARTIFACT_NOT_LATEST", "ARTIFACT_NOT_ACCEPTED"]);

function assertPreviewReady(preview: WaiverWeekGradingPreview): asserts preview is WaiverWeekGradingPreview & { run: NonNullable<WaiverWeekGradingPreview["run"]> } {
  if (preview.status === "READY" && preview.run && preview.positions.every((p) => p.kind !== "BLOCKED")) return;
  const source = preview.issues.find((issue) => SOURCE_CODES.has(issue.code));
  if (source) throw new WaiverGradingError("SOURCE_SUPERSEDED", `The grading source is no longer gradable: ${source.code} (${source.detail})`, preview.issues);
  throw new WaiverGradingError(
    "PREVIEW_BLOCKED",
    preview.issues.length ? `The grading preview is blocked: ${preview.issues.map((i) => i.code).join(", ")}` : "The grading preview is incomplete",
    preview.issues,
  );
}

type StoredRun = {
  id: string;
  weekId: string;
  artifactRowId: string | null;
  rankEyeQSnapshotId: string | null;
  artifactContentChecksum: string;
  inputFingerprint: string;
  outputFingerprint: string;
};

/**
 * Refuses unless the live inputs (re-verified source, frozen snapshots,
 * locked boards, current D3 decisions) still produce exactly this stored run.
 * The source is the run's own: its SNG artifact, or its pinned RankEyeQ snapshot.
 */
async function assertRunMatchesLiveInputs(tx: Tx, run: StoredRun) {
  const preview = await loadWaiverWeekGradingPreviewFromSource(tx, {
    weekId: run.weekId,
    source: waiverGradingSourceOfStored(run),
  });
  assertPreviewReady(preview);
  if (preview.artifact.contentChecksum !== run.artifactContentChecksum) {
    throw new WaiverGradingError("STALE", "The source checksum no longer matches the grade run; preview and store a new run");
  }
  if (preview.run.inputFingerprint !== run.inputFingerprint || preview.run.outputFingerprint !== run.outputFingerprint) {
    throw new WaiverGradingError("STALE", "The live grading inputs changed since this run was stored; preview and store a new run", {
      run: { input: run.inputFingerprint, output: run.outputFingerprint },
      live: { input: preview.run.inputFingerprint, output: preview.run.outputFingerprint },
    });
  }
}

async function audit(tx: Tx, adminUserId: string, action: string, entityType: string, entityId: string, metadata: Prisma.InputJsonObject) {
  await tx.adminAuditLog.create({ data: { adminUserId, action, entityType, entityId, metadata } });
}

// ---------------------------------------------------------------------------
// 1. Store run
// ---------------------------------------------------------------------------

export type StoreWaiverWeekGradingRunInput = {
  weekId: string;
  source: WaiverGradingSource;
  adminUserId: string;
  /** The fingerprints the operator reviewed in the preview. */
  expectedInputFingerprint: string;
  expectedOutputFingerprint: string;
};

export type StoreWaiverWeekGradingRunResult = {
  status: "STORED" | "ALREADY_STORED";
  gradeRunId: string;
  runNumber: number;
  boardGradeCount: number;
  inputFingerprint: string;
  outputFingerprint: string;
  reusedContestResults: number;
};

/**
 * Stores the contest results, empty-position results, grade run, board grades
 * and call grades of a READY preview as a new versioned PROPOSED run. Idempotent
 * on the run's input fingerprint. It never approves, applies or publishes.
 */
export async function storeWaiverWeekGradingRun(input: StoreWaiverWeekGradingRunInput): Promise<StoreWaiverWeekGradingRunResult> {
  // Both verified sources are storable (SNG artifact or RankEyeQ snapshot); anything else is refused before any read or write.
  if (!isWaiverGradingSourceStorable(input.source)) {
    throw new WaiverGradingError("SOURCE_UNSUPPORTED", "This grading source cannot be stored; nothing was stored.");
  }
  return prisma.$transaction(async (tx) => {
    await begin(tx, input.adminUserId, input.weekId);
    const preview = await loadWaiverWeekGradingPreviewFromSource(tx, { weekId: input.weekId, source: input.source });
    assertPreviewReady(preview);
    const { run: planned } = preview;
    // The preview's source row id is the SNG artifact row or the RankEyeQ snapshot row, per the requested source.
    if (!preview.artifact.rowId) throw new WaiverGradingError("PREVIEW_BLOCKED", "The grading preview has no source row to bind");
    const sourceRef = waiverStoredSourceRef(input.source.kind, preview.artifact.rowId);
    if (planned.inputFingerprint !== input.expectedInputFingerprint || planned.outputFingerprint !== input.expectedOutputFingerprint) {
      throw new WaiverGradingError("STALE", "The grading preview changed since it was reviewed; preview again");
    }

    const existing = await tx.waiverGradeRun.findUnique({
      where: { weekId_inputFingerprint: { weekId: input.weekId, inputFingerprint: planned.inputFingerprint } },
    });
    if (existing) {
      if (existing.outputFingerprint !== planned.outputFingerprint) {
        throw new WaiverGradingError("CONFLICT", `Stored grade run ${existing.id} has these inputs but a DIFFERENT output; refusing to store a second run`);
      }
      return {
        status: "ALREADY_STORED" as const,
        gradeRunId: existing.id,
        runNumber: existing.runNumber,
        boardGradeCount: existing.boardGradeCount,
        inputFingerprint: existing.inputFingerprint,
        outputFingerprint: existing.outputFingerprint,
        reusedContestResults: 0,
      };
    }

    const contestResultIds: Partial<Record<WaiverPosition, string>> = {};
    const emptyPositionResultIds: Partial<Record<WaiverPosition, string>> = {};
    const poolIds = new Map<WaiverPosition, Map<string, string>>();
    let reused = 0;
    for (const position of preview.positions) {
      if (position.kind === "EMPTY_ELIGIBLE_POOL") {
        const { weekId, position: p, snapshotId } = position.emptyResult;
        const stored = await tx.waiverEmptyPositionResult.findUnique({ where: { weekId_position_snapshotId: { weekId, position: p, snapshotId } } });
        emptyPositionResultIds[position.position] = (stored ?? (await tx.waiverEmptyPositionResult.create({ data: waiverEmptyPositionResultCreateData(position.emptyResult) }))).id;
      } else if (position.kind === "CONTEST_RESULT") {
        const stored = await tx.waiverContestResult.findUnique({
          where: { contestId_inputFingerprint: { contestId: position.contestId, inputFingerprint: position.result.inputFingerprint } },
          select: { id: true, resultFingerprint: true },
        });
        let resultId: string;
        if (stored) {
          if (stored.resultFingerprint !== position.result.resultFingerprint) {
            throw new WaiverGradingError("CONFLICT", `Stored ${position.position} contest result ${stored.id} has these inputs but a DIFFERENT result`);
          }
          resultId = stored.id;
          reused += 1;
        } else {
          const latest = await tx.waiverContestResult.aggregate({ where: { contestId: position.contestId }, _max: { resultVersion: true } });
          const created = await tx.waiverContestResult.create({ data: waiverContestResultCreateData(position.result, (latest._max.resultVersion ?? 0) + 1) });
          await tx.waiverPoolResult.createMany({ data: waiverPoolResultCreateData(position.rows, created.id) });
          resultId = created.id;
        }
        const pool = await tx.waiverPoolResult.findMany({ where: { contestResultId: resultId }, select: { id: true, rankableEntryId: true } });
        poolIds.set(position.position, new Map(pool.map((row) => [row.rankableEntryId, row.id])));
        contestResultIds[position.position] = resultId;
      }
    }

    const lastRun = await tx.waiverGradeRun.aggregate({ where: { weekId: input.weekId }, _max: { runNumber: true } });
    const run = await tx.waiverGradeRun.create({
      data: waiverGradeRunCreateData(planned, {
        weekId: input.weekId,
        runNumber: (lastRun._max.runNumber ?? 0) + 1,
        ...sourceRef,
        artifactContentChecksum: preview.artifact.contentChecksum,
        contestResultIds,
        emptyPositionResultIds,
        initiatedByUserId: input.adminUserId,
      }),
    });
    for (const grade of preview.boards) {
      const contestResultId = contestResultIds[grade.board.position];
      const pool = poolIds.get(grade.board.position);
      if (!contestResultId || !pool) throw new WaiverGradingError("PREVIEW_BLOCKED", `A graded ${grade.board.position} board has no stored contest result`);
      const board = await tx.waiverBoardGrade.create({ data: waiverBoardGradeCreateData(grade, { gradeRunId: run.id, contestResultId }) });
      const calls = waiverCallGradeCreateData(grade, { boardGradeId: board.id, poolResultIdByEntry: pool });
      if (calls.length) await tx.waiverCallGrade.createMany({ data: calls });
    }

    await audit(tx, input.adminUserId, "waivers.grading_run_stored", "WaiverGradeRun", run.id, {
      weekId: input.weekId,
      runNumber: run.runNumber,
      sourceKind: input.source.kind,
      artifactRowId: sourceRef.artifactRowId,
      rankEyeQSnapshotId: sourceRef.rankEyeQSnapshotId,
      artifactRevision: preview.artifact.revision,
      artifactContentChecksum: preview.artifact.contentChecksum,
      inputFingerprint: run.inputFingerprint,
      outputFingerprint: run.outputFingerprint,
      boardGradeCount: run.boardGradeCount,
      reusedContestResults: reused,
    });
    return {
      status: "STORED" as const,
      gradeRunId: run.id,
      runNumber: run.runNumber,
      boardGradeCount: run.boardGradeCount,
      inputFingerprint: run.inputFingerprint,
      outputFingerprint: run.outputFingerprint,
      reusedContestResults: reused,
    };
  }, TX);
}

// ---------------------------------------------------------------------------
// 2. Approve
// ---------------------------------------------------------------------------

export type ApproveWaiverGradeRunInput = {
  gradeRunId: string;
  adminUserId: string;
  /** The output fingerprint the operator reviewed. */
  expectedOutputFingerprint: string;
  reason: string;
  /**
   * The approver reviewed the DEF team crosswalk version the SNG artifact was imported under. Required for an SNG run;
   * not applicable to a RankEyeQ run (the approval then records the native marker, acknowledged as N/A).
   */
  acknowledgeDefCrosswalk: boolean;
  /** The approver affirms the exact approval attestation text. */
  attested: boolean;
  policy?: WaiverGradeApprovalPolicy;
};

/**
 * The approval's copy of its run's source (the database re-verifies every field). SNG copies the artifact's revision, DEF
 * crosswalk and importer; RankEyeQ copies the snapshot's revision, uses the `rankeyeq-native/1` crosswalk marker (N/A) and the
 * snapshot's builder as the importer equivalent, with RankEyeQ-specific attestation text.
 */
async function approvalSourceEvidence(tx: Tx, run: StoredRun) {
  if (run.rankEyeQSnapshotId !== null) {
    const snapshot = await tx.waiverRankEyeQResultsSnapshot.findUniqueOrThrow({
      where: { id: run.rankEyeQSnapshotId },
      select: { id: true, revision: true, contentChecksum: true, builtByUserId: true },
    });
    return {
      artifactRowId: null,
      rankEyeQSnapshotId: snapshot.id,
      revision: snapshot.revision,
      contentChecksum: snapshot.contentChecksum,
      defCrosswalkVersion: WAIVER_RANKEYEQ_NATIVE_CROSSWALK_VERSION,
      importedByUserId: snapshot.builtByUserId,
      attestationVersion: WAIVER_GRADING_APPROVAL_RANKEYEQ_ATTESTATION_VERSION,
      attestationText: WAIVER_GRADING_APPROVAL_RANKEYEQ_ATTESTATION_TEXT,
    };
  }
  if (run.artifactRowId === null) throw new WaiverGradingError("PREVIEW_BLOCKED", "The grade run has no source");
  const artifact = await tx.waiverCanonicalArtifact.findUniqueOrThrow({
    where: { id: run.artifactRowId },
    select: { id: true, revision: true, contentChecksum: true, defCrosswalkVersion: true, importedByUserId: true },
  });
  return {
    artifactRowId: artifact.id,
    rankEyeQSnapshotId: null,
    revision: artifact.revision,
    contentChecksum: artifact.contentChecksum,
    defCrosswalkVersion: artifact.defCrosswalkVersion,
    importedByUserId: artifact.importedByUserId,
    attestationVersion: WAIVER_GRADING_APPROVAL_ATTESTATION_VERSION,
    attestationText: WAIVER_GRADING_APPROVAL_ATTESTATION_TEXT,
  };
}

export type ApproveWaiverGradeRunResult = { status: "APPROVED" | "ALREADY_APPROVED"; approvalId: string; gradeRunId: string };

/** Records an explicit, immutable approval of one stored run. Never applies or publishes. */
export async function approveWaiverGradeRun(input: ApproveWaiverGradeRunInput): Promise<ApproveWaiverGradeRunResult> {
  if (input.attested !== true) throw new WaiverGradingError("ATTESTATION_REQUIRED", "The approval attestation is required");
  const reason = reasonOf(input.reason);
  const policy = input.policy ?? "SINGLE_ADMIN_EXPLICIT";
  return prisma.$transaction(async (tx) => {
    const run = await tx.waiverGradeRun.findUnique({ where: { id: input.gradeRunId } });
    if (!run) throw new WaiverGradingError("NOT_FOUND", "Grade run not found");
    if (run.rankEyeQSnapshotId === null && input.acknowledgeDefCrosswalk !== true) {
      throw new WaiverGradingError("ATTESTATION_REQUIRED", "Acknowledge the DEF team crosswalk version to approve");
    }
    await begin(tx, input.adminUserId, run.weekId);
    if (run.outputFingerprint !== input.expectedOutputFingerprint) {
      throw new WaiverGradingError("STALE", "The grade run does not match the output fingerprint that was reviewed");
    }
    const prior = await tx.waiverGradeApproval.findUnique({ where: { gradeRunId_approvedByUserId: { gradeRunId: run.id, approvedByUserId: input.adminUserId } } });
    if (prior) return { status: "ALREADY_APPROVED" as const, approvalId: prior.id, gradeRunId: run.id };

    await assertRunMatchesLiveInputs(tx, run);
    const evidence = await approvalSourceEvidence(tx, run);
    const approval = await tx.waiverGradeApproval.create({
      data: {
        weekId: run.weekId,
        gradeRunId: run.id,
        artifactRowId: evidence.artifactRowId,
        rankEyeQSnapshotId: evidence.rankEyeQSnapshotId,
        artifactRevision: evidence.revision,
        artifactContentChecksum: evidence.contentChecksum,
        snapshotSetFingerprint: run.snapshotSetFingerprint,
        resolutionSetFingerprint: run.resolutionSetFingerprint,
        inputFingerprint: run.inputFingerprint,
        outputFingerprint: run.outputFingerprint,
        defCrosswalkVersion: evidence.defCrosswalkVersion,
        defCrosswalkAcknowledged: true,
        approvalPolicy: policy,
        approvedByUserId: input.adminUserId,
        artifactImportedByUserId: evidence.importedByUserId,
        gradeRunInitiatedByUserId: run.initiatedByUserId,
        attestationVersion: evidence.attestationVersion,
        attestationText: evidence.attestationText,
        reason,
      },
    });
    await audit(tx, input.adminUserId, "waivers.grading_run_approved", "WaiverGradeApproval", approval.id, {
      weekId: run.weekId,
      gradeRunId: run.id,
      runNumber: run.runNumber,
      approvalPolicy: policy,
      sourceKind: evidence.rankEyeQSnapshotId !== null ? "RANKEYEQ_SNAPSHOT" : "SNG_ARTIFACT",
      artifactRowId: evidence.artifactRowId,
      rankEyeQSnapshotId: evidence.rankEyeQSnapshotId,
      artifactRevision: evidence.revision,
      defCrosswalkVersion: evidence.defCrosswalkVersion,
      inputFingerprint: run.inputFingerprint,
      outputFingerprint: run.outputFingerprint,
      attestationVersion: evidence.attestationVersion,
      reason,
    });
    return { status: "APPROVED" as const, approvalId: approval.id, gradeRunId: run.id };
  }, TX);
}

// ---------------------------------------------------------------------------
// 3. Apply (week-atomic CURRENT authority)
// ---------------------------------------------------------------------------

export type ApplyWaiverGradeAuthorityInput = { approvalId: string; adminUserId: string; reason: string };

export type ApplyWaiverGradeAuthorityResult = {
  status: "APPLIED" | "ALREADY_APPLIED";
  changeId: string;
  sequence: number;
  changeType: "INITIAL_GRADE" | "REGRADE";
  gradeRunId: string;
  /** The prior authority change had been published; this change is unpublished until published again. */
  unpublishedPriorPublication: boolean;
};

/**
 * Moves the week's authority (change record, week pointer, every contest
 * pointer and every board pointer) to the approved run in one transaction; the
 * database re-checks week atomicity at commit. It does NOT publish.
 */
export async function applyWaiverGradeAuthority(input: ApplyWaiverGradeAuthorityInput): Promise<ApplyWaiverGradeAuthorityResult> {
  const reason = reasonOf(input.reason);
  return prisma.$transaction(async (tx) => {
    const approval = await tx.waiverGradeApproval.findUnique({
      where: { id: input.approvalId },
      include: { change: { select: { id: true, sequence: true, changeType: true } }, gradeRun: true },
    });
    if (!approval) throw new WaiverGradingError("NOT_FOUND", "Grading approval not found");
    await begin(tx, input.adminUserId, approval.weekId);
    const run = approval.gradeRun;

    const current = await tx.waiverWeekGradeAuthority.findUnique({ where: { weekId: approval.weekId }, include: { change: { select: { sequence: true, changeType: true } } } });
    if (current && current.gradeRunId === run.id) {
      return {
        status: "ALREADY_APPLIED" as const,
        changeId: current.changeId,
        sequence: current.change.sequence,
        changeType: current.change.changeType,
        gradeRunId: run.id,
        unpublishedPriorPublication: false,
      };
    }
    if (approval.change) {
      throw new WaiverGradingError("ALREADY_USED", "This approval was already used for an earlier authority change; approve the run again to re-apply it");
    }
    await assertRunMatchesLiveInputs(tx, run);

    const boards = await tx.waiverBoardGrade.findMany({ where: { gradeRunId: run.id }, orderBy: { submissionId: "asc" }, select: { id: true, submissionId: true, contestId: true } });
    const resultIds = [run.qbContestResultId, run.rbContestResultId, run.wrContestResultId, run.teContestResultId, run.defContestResultId].filter((id): id is string => id !== null);
    const results = await tx.waiverContestResult.findMany({ where: { id: { in: resultIds } }, select: { id: true, contestId: true } });

    const last = await tx.waiverGradeAuthorityChange.findFirst({ where: { weekId: approval.weekId }, orderBy: { sequence: "desc" } });
    const priorPublication = last ? await tx.waiverWeekGradePublication.findUnique({ where: { changeId: last.id }, select: { id: true } }) : null;
    const change = await tx.waiverGradeAuthorityChange.create({
      data: {
        weekId: approval.weekId,
        sequence: (last?.sequence ?? 0) + 1,
        changeType: last ? "REGRADE" : "INITIAL_GRADE",
        priorChangeId: last?.id ?? null,
        priorGradeRunId: last?.newGradeRunId ?? null,
        newGradeRunId: run.id,
        approvalId: approval.id,
        approvedByUserId: approval.approvedByUserId,
        reason,
        inputFingerprint: run.inputFingerprint,
        outputFingerprint: run.outputFingerprint,
      },
    });
    const pointer = { gradeRunId: run.id, changeId: change.id };
    await tx.waiverWeekGradeAuthority.upsert({
      where: { weekId: approval.weekId },
      create: { weekId: approval.weekId, ...pointer, outputFingerprint: run.outputFingerprint },
      update: { ...pointer, outputFingerprint: run.outputFingerprint },
    });
    for (const result of results) {
      const data = {
        weekId: approval.weekId,
        contestResultId: result.id,
        artifactRowId: run.artifactRowId,
        rankEyeQSnapshotId: run.rankEyeQSnapshotId,
        ...pointer,
      };
      await tx.waiverContestResultAuthority.upsert({ where: { contestId: result.contestId }, create: { contestId: result.contestId, ...data }, update: data });
    }
    for (const board of boards) {
      const data = { weekId: approval.weekId, contestId: board.contestId, boardGradeId: board.id, ...pointer };
      await tx.waiverBoardGradeAuthority.upsert({ where: { submissionId: board.submissionId }, create: { submissionId: board.submissionId, ...data }, update: data });
    }

    await audit(tx, input.adminUserId, "waivers.grading_authority_applied", "WaiverGradeAuthorityChange", change.id, {
      weekId: approval.weekId,
      gradeRunId: run.id,
      runNumber: run.runNumber,
      approvalId: approval.id,
      sequence: change.sequence,
      changeType: change.changeType,
      priorChangeId: last?.id ?? null,
      priorGradeRunId: last?.newGradeRunId ?? null,
      unpublishedPriorPublication: priorPublication !== null,
      contestPointers: results.length,
      boardPointers: boards.length,
      inputFingerprint: run.inputFingerprint,
      outputFingerprint: run.outputFingerprint,
      reason,
    });
    return {
      status: "APPLIED" as const,
      changeId: change.id,
      sequence: change.sequence,
      changeType: change.changeType,
      gradeRunId: run.id,
      unpublishedPriorPublication: priorPublication !== null,
    };
  }, TX);
}

// ---------------------------------------------------------------------------
// 4. Publish (public visibility gate)
// ---------------------------------------------------------------------------

export type PublishWaiverWeekGradesInput = {
  weekId: string;
  adminUserId: string;
  /** The authority change the operator reviewed as CURRENT. */
  expectedChangeId: string;
  reason: string;
};

export type PublishWaiverWeekGradesResult = {
  status: "PUBLISHED" | "ALREADY_PUBLISHED";
  publicationId: string;
  changeId: string;
  gradeRunId: string;
  publishedAt: Date;
};

/**
 * Publishes the week's CURRENT, approved, applied authority to public
 * leaderboards. Refuses when nothing is applied, when the reviewed change is no
 * longer current, or when the source or live inputs have since changed.
 */
export async function publishWaiverWeekGrades(input: PublishWaiverWeekGradesInput): Promise<PublishWaiverWeekGradesResult> {
  const reason = reasonOf(input.reason);
  return prisma.$transaction(async (tx) => {
    await begin(tx, input.adminUserId, input.weekId);
    const authority = await tx.waiverWeekGradeAuthority.findUnique({ where: { weekId: input.weekId }, include: { gradeRun: true, change: true } });
    if (!authority) throw new WaiverGradingError("NOT_APPLIED", "No grading authority has been applied for this week; approve and apply a run first");
    if (authority.changeId !== input.expectedChangeId) {
      throw new WaiverGradingError("STALE", "The week's current authority changed since it was reviewed; reload");
    }
    const prior = await tx.waiverWeekGradePublication.findUnique({ where: { changeId: authority.changeId } });
    if (prior) {
      return { status: "ALREADY_PUBLISHED" as const, publicationId: prior.id, changeId: prior.changeId, gradeRunId: prior.gradeRunId, publishedAt: prior.publishedAt };
    }
    const approval = await tx.waiverGradeApproval.findUnique({ where: { id: authority.change.approvalId }, select: { id: true, gradeRunId: true, outputFingerprint: true } });
    if (!approval || approval.gradeRunId !== authority.gradeRunId || approval.outputFingerprint !== authority.outputFingerprint) {
      throw new WaiverGradingError("NOT_APPROVED", "The current authority is not backed by an approval of its exact grade run");
    }
    await assertRunMatchesLiveInputs(tx, authority.gradeRun);

    const publication = await tx.waiverWeekGradePublication.create({
      data: {
        weekId: input.weekId,
        changeId: authority.changeId,
        gradeRunId: authority.gradeRunId,
        outputFingerprint: authority.outputFingerprint,
        publishedByUserId: input.adminUserId,
        reason,
      },
    });
    await audit(tx, input.adminUserId, "waivers.grading_published", "WaiverWeekGradePublication", publication.id, {
      weekId: input.weekId,
      gradeRunId: authority.gradeRunId,
      runNumber: authority.gradeRun.runNumber,
      changeId: authority.changeId,
      sequence: authority.change.sequence,
      outputFingerprint: authority.outputFingerprint,
      reason,
    });
    return {
      status: "PUBLISHED" as const,
      publicationId: publication.id,
      changeId: publication.changeId,
      gradeRunId: publication.gradeRunId,
      publishedAt: publication.publishedAt,
    };
  }, TX);
}

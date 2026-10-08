import { prisma } from "@/lib/db";
import { canAccessAdmin } from "@/lib/admin/access";
import type { Prisma } from "@/lib/generated/prisma/client";
import { WAIVER_ARTIFACT_IMPORT_ATTESTATION_VERSION, WAIVER_ARTIFACT_PUBLICATION_AUTHORITY } from "@/lib/waivers/artifacts/authority";
import { WaiverArtifactError } from "@/lib/waivers/artifacts/errors";
import {
  EMPTY_WAIVER_ARTIFACT_LEDGER,
  WAIVER_ARTIFACT_EVENT_BASIS,
  evaluateWaiverArtifactImport,
  verifyWaiverArtifactText,
  waiverArtifactRowData,
  type StoredWaiverArtifact,
  type WaiverArtifactImportInput,
  type WaiverArtifactImportPreview,
  type WaiverArtifactLedger,
  type WaiverArtifactWeek,
} from "@/lib/waivers/artifacts/import-model";
import type { CanonicalArtifactSummary, CanonicalVerificationResult } from "@/lib/waivers/canonical/artifact-verifier";
import { readWaiverClock, type WaiverDb } from "@/lib/waivers/clock";

export const WAIVER_ARTIFACT_TX_OPTIONS = { maxWait: 10_000, timeout: 60_000 } as const;

export async function assertWaiverArtifactAdmin(db: WaiverDb, userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user || !canAccessAdmin(user.role)) throw new WaiverArtifactError("FORBIDDEN", "Admin access required");
}

/** Serializes artifact imports and publication events per week. */
export async function lockWaiverArtifactWeek(tx: Prisma.TransactionClient, weekId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Week" WHERE "id" = ${weekId} FOR UPDATE`;
  if (rows.length === 0) throw new WaiverArtifactError("NOT_FOUND", "Week not found");
}

async function loadArtifactWeek(db: WaiverDb, weekId: string): Promise<WaiverArtifactWeek | null> {
  const week = await db.week.findUnique({
    where: { id: weekId },
    select: { id: true, weekNumber: true, label: true, isTest: true, season: { select: { year: true } } },
  });
  return week ? { id: week.id, season: week.season.year, weekNumber: week.weekNumber, label: week.label, isTest: week.isTest } : null;
}

const STORED_SELECT = {
  id: true,
  artifactId: true,
  seriesKey: true,
  revision: true,
  supersedesArtifactId: true,
  contentChecksum: true,
  weekId: true,
  events: { orderBy: { sequence: "desc" }, take: 1, select: { state: true, sequence: true } },
} satisfies Prisma.WaiverCanonicalArtifactSelect;

type StoredRow = Prisma.WaiverCanonicalArtifactGetPayload<{ select: typeof STORED_SELECT }>;

function toStored(row: StoredRow | null): StoredWaiverArtifact | null {
  if (!row) return null;
  const latest = row.events[0];
  if (!latest) throw new Error(`Canonical artifact ${row.id} has no publication event`);
  return {
    id: row.id,
    artifactId: row.artifactId,
    seriesKey: row.seriesKey,
    revision: row.revision,
    supersedesArtifactId: row.supersedesArtifactId,
    contentChecksum: row.contentChecksum,
    weekId: row.weekId,
    latestState: latest.state,
    latestSequence: latest.sequence,
  };
}

/** Every local artifact the candidate could collide with or continue. */
export async function loadWaiverArtifactLedger(db: WaiverDb, summary: CanonicalArtifactSummary): Promise<WaiverArtifactLedger> {
  const byArtifactId = await db.waiverCanonicalArtifact.findUnique({ where: { artifactId: summary.artifactId }, select: STORED_SELECT });
  const byChecksum = await db.waiverCanonicalArtifact.findUnique({ where: { contentChecksum: summary.contentChecksum }, select: STORED_SELECT });
  const atRevision = await db.waiverCanonicalArtifact.findUnique({
    where: { seriesKey_revision: { seriesKey: summary.seriesKey, revision: summary.revision } },
    select: STORED_SELECT,
  });
  const latestInSeries = await db.waiverCanonicalArtifact.findFirst({
    where: { seriesKey: summary.seriesKey },
    orderBy: { revision: "desc" },
    select: STORED_SELECT,
  });
  const declaredPredecessor = summary.supersedesArtifactId
    ? await db.waiverCanonicalArtifact.findUnique({ where: { artifactId: summary.supersedesArtifactId }, select: STORED_SELECT })
    : null;
  return {
    byArtifactId: toStored(byArtifactId),
    byChecksum: toStored(byChecksum),
    atRevision: toStored(atRevision),
    latestInSeries: toStored(latestInSeries),
    declaredPredecessor: toStored(declaredPredecessor),
  };
}

export async function buildWaiverArtifactImportPreview(
  db: WaiverDb,
  request: WaiverArtifactImportInput,
  now?: Date,
): Promise<{ preview: WaiverArtifactImportPreview; verification: CanonicalVerificationResult }> {
  const week = await loadArtifactWeek(db, request.weekId);
  const verification = verifyWaiverArtifactText(request, week);
  const ledger = verification.ok ? await loadWaiverArtifactLedger(db, verification.summary) : EMPTY_WAIVER_ARTIFACT_LEDGER;
  const preview = evaluateWaiverArtifactImport({
    request,
    week,
    verification,
    ledger,
    authorityMode: WAIVER_ARTIFACT_PUBLICATION_AUTHORITY,
    now: now ?? (await readWaiverClock(db)),
  });
  return { preview, verification };
}

/** Read-only import preview. Issues only SELECTs. */
export async function previewWaiverArtifactImport(request: WaiverArtifactImportInput): Promise<WaiverArtifactImportPreview> {
  return (await buildWaiverArtifactImportPreview(prisma, request)).preview;
}

export type WaiverArtifactApplyInput = WaiverArtifactImportInput & {
  adminUserId: string;
  previewFingerprint: string;
  attested: boolean;
};

export type WaiverArtifactApplyResult = {
  artifactRowId: string;
  artifactId: string;
  revision: number;
  alreadyImported: boolean;
  importedAt: Date;
  supersededArtifactRowId: string | null;
};

/**
 * Imports one verified artifact in a single transaction: admin re-check, week
 * lock, database clock, server-side preview rebuild (fingerprint must match,
 * zero blockers), then metadata + exact content + ACCEPTED event, the
 * predecessor's SUPERSEDED event when it was still ACCEPTED, and an admin
 * audit row. An identical re-import writes nothing. Never grades.
 */
export async function applyWaiverArtifactImport(input: WaiverArtifactApplyInput): Promise<WaiverArtifactApplyResult> {
  if (input.attested !== true) throw new WaiverArtifactError("ATTESTATION_REQUIRED", "The operator attestation is required to import");
  return prisma.$transaction(async (tx) => {
    await assertWaiverArtifactAdmin(tx, input.adminUserId);
    await lockWaiverArtifactWeek(tx, input.weekId);
    const now = await readWaiverClock(tx);
    const { preview, verification } = await buildWaiverArtifactImportPreview(tx, input, now);
    if (preview.previewFingerprint !== input.previewFingerprint) {
      throw new WaiverArtifactError("STALE_PREVIEW", "The artifact, evidence or local artifact history changed since the preview; preview again");
    }
    if (preview.status === "BLOCKED" || !verification.ok) {
      throw new WaiverArtifactError("BLOCKED", "The import preview has blockers", preview.blockers);
    }
    if (preview.status === "ALREADY_IMPORTED") {
      const existing = await tx.waiverCanonicalArtifact.findUniqueOrThrow({
        where: { id: preview.succession.existingArtifactRowId! },
        select: { id: true, artifactId: true, revision: true, importedAt: true },
      });
      return {
        artifactRowId: existing.id,
        artifactId: existing.artifactId,
        revision: existing.revision,
        alreadyImported: true,
        importedAt: existing.importedAt,
        supersededArtifactRowId: null,
      };
    }

    const evidence = input.evidence;
    const sourceObservedAt = evidence.sourceObservedAt!;
    const sourceReference = evidence.sourceReference.trim();
    const artifact = await tx.waiverCanonicalArtifact.create({
      data: waiverArtifactRowData(verification, input, preview, input.adminUserId),
      select: { id: true, artifactId: true, revision: true, importedAt: true },
    });
    await tx.waiverCanonicalArtifactContent.create({
      data: { artifactRowId: artifact.id, contentText: input.artifactText, textSha256: preview.textSha256, byteLength: preview.byteLength },
    });
    await tx.waiverCanonicalArtifactEvent.create({
      data: {
        artifactRowId: artifact.id,
        sequence: 1,
        state: "ACCEPTED",
        basis: WAIVER_ARTIFACT_EVENT_BASIS.ACCEPTED,
        sourceReference,
        sourceObservedAt,
        attestationVersion: WAIVER_ARTIFACT_IMPORT_ATTESTATION_VERSION,
        operatorUserId: input.adminUserId,
      },
    });
    let supersededArtifactRowId: string | null = null;
    if (preview.succession.predecessorAction === "SUPERSEDE") {
      supersededArtifactRowId = preview.succession.predecessorRowId!;
      await tx.waiverCanonicalArtifactEvent.create({
        data: {
          artifactRowId: supersededArtifactRowId,
          sequence: preview.succession.predecessorSequence! + 1,
          state: "SUPERSEDED",
          successorArtifactRowId: artifact.id,
          basis: WAIVER_ARTIFACT_EVENT_BASIS.SUPERSEDED,
          sourceReference,
          sourceObservedAt,
          attestationVersion: WAIVER_ARTIFACT_IMPORT_ATTESTATION_VERSION,
          reason: `Superseded by ${artifact.artifactId} (revision ${artifact.revision})`,
          operatorUserId: input.adminUserId,
        },
      });
    }
    await tx.adminAuditLog.create({
      data: {
        adminUserId: input.adminUserId,
        action: "waivers.canonical_artifact_imported",
        entityType: "WaiverCanonicalArtifact",
        entityId: artifact.id,
        metadata: {
          weekId: input.weekId,
          artifactId: artifact.artifactId,
          seriesKey: preview.summary!.seriesKey,
          revision: artifact.revision,
          supersedesArtifactId: preview.summary!.supersedesArtifactId,
          contentChecksum: preview.summary!.contentChecksum,
          textSha256: preview.textSha256,
          byteLength: preview.byteLength,
          acceptanceId: preview.acceptance!.id,
          acceptedAt: preview.acceptance!.acceptedAt,
          sourceReference,
          sourceObservedAt: sourceObservedAt.toISOString(),
          authorityMode: preview.authorityMode,
          attestationVersion: WAIVER_ARTIFACT_IMPORT_ATTESTATION_VERSION,
          previewFingerprint: preview.previewFingerprint,
          supersededArtifactRowId,
          advisories: preview.advisories.map((issue) => issue.code),
        } satisfies Prisma.InputJsonValue,
        createdAt: now,
      },
    });
    return {
      artifactRowId: artifact.id,
      artifactId: artifact.artifactId,
      revision: artifact.revision,
      alreadyImported: false,
      importedAt: artifact.importedAt,
      supersededArtifactRowId,
    };
  }, WAIVER_ARTIFACT_TX_OPTIONS);
}

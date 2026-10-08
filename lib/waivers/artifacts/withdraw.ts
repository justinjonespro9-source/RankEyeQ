import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { WAIVER_ARTIFACT_WITHDRAWAL_ATTESTATION_VERSION } from "@/lib/waivers/artifacts/authority";
import { WaiverArtifactError } from "@/lib/waivers/artifacts/errors";
import { assertWaiverArtifactAdmin, lockWaiverArtifactWeek, WAIVER_ARTIFACT_TX_OPTIONS } from "@/lib/waivers/artifacts/import";
import {
  canRecordWaiverArtifactEvent,
  WAIVER_ARTIFACT_EVENT_BASIS,
  waiverArtifactWithdrawalIssues,
  type WaiverArtifactWithdrawalEvidence,
} from "@/lib/waivers/artifacts/import-model";
import { readWaiverClock } from "@/lib/waivers/clock";

export type WaiverArtifactWithdrawInput = WaiverArtifactWithdrawalEvidence & {
  artifactRowId: string;
  adminUserId: string;
  /** The latest event sequence the operator reviewed; a newer event makes the request stale. */
  expectedSequence: number;
  attested: boolean;
};

export type WaiverArtifactWithdrawResult = { artifactRowId: string; sequence: number; recordedAt: Date };

/**
 * Records an operator-attested SNG withdrawal as an appended WITHDRAWN event.
 * The artifact, its content and earlier events are untouched; nothing is
 * deleted, re-graded or restored.
 */
export async function withdrawWaiverArtifact(input: WaiverArtifactWithdrawInput): Promise<WaiverArtifactWithdrawResult> {
  if (input.attested !== true) throw new WaiverArtifactError("ATTESTATION_REQUIRED", "The operator attestation is required to record a withdrawal");
  return prisma.$transaction(async (tx) => {
    await assertWaiverArtifactAdmin(tx, input.adminUserId);
    const artifact = await tx.waiverCanonicalArtifact.findUnique({
      where: { id: input.artifactRowId },
      select: { id: true, artifactId: true, revision: true, weekId: true, acceptedAt: true },
    });
    if (!artifact) throw new WaiverArtifactError("NOT_FOUND", "Canonical artifact not found");
    await lockWaiverArtifactWeek(tx, artifact.weekId);
    const now = await readWaiverClock(tx);
    const latest = await tx.waiverCanonicalArtifactEvent.findFirst({
      where: { artifactRowId: artifact.id },
      orderBy: { sequence: "desc" },
      select: { sequence: true, state: true },
    });
    if (!latest) throw new Error(`Canonical artifact ${artifact.id} has no publication event`);
    if (latest.sequence !== input.expectedSequence) {
      throw new WaiverArtifactError("STALE_PREVIEW", "The artifact's publication history changed since it was reviewed; reload");
    }
    if (!canRecordWaiverArtifactEvent(latest.state, "WITHDRAWN")) {
      throw new WaiverArtifactError("INVALID_TRANSITION", `A ${latest.state} artifact cannot be withdrawn`);
    }
    const issues = waiverArtifactWithdrawalIssues(input, artifact.acceptedAt, now);
    if (issues.length) throw new WaiverArtifactError("INVALID_INPUT", issues[0], issues);

    const sequence = latest.sequence + 1;
    const event = await tx.waiverCanonicalArtifactEvent.create({
      data: {
        artifactRowId: artifact.id,
        sequence,
        state: "WITHDRAWN",
        basis: WAIVER_ARTIFACT_EVENT_BASIS.WITHDRAWN,
        sourceReference: input.sourceReference.trim(),
        sourceObservedAt: input.sourceObservedAt!,
        attestationVersion: WAIVER_ARTIFACT_WITHDRAWAL_ATTESTATION_VERSION,
        reason: input.reason.trim(),
        operatorUserId: input.adminUserId,
      },
      select: { id: true, recordedAt: true },
    });
    await tx.adminAuditLog.create({
      data: {
        adminUserId: input.adminUserId,
        action: "waivers.canonical_artifact_withdrawn",
        entityType: "WaiverCanonicalArtifact",
        entityId: artifact.id,
        metadata: {
          artifactId: artifact.artifactId,
          revision: artifact.revision,
          weekId: artifact.weekId,
          eventId: event.id,
          sequence,
          previousState: latest.state,
          reason: input.reason.trim(),
          sourceReference: input.sourceReference.trim(),
          sourceObservedAt: input.sourceObservedAt!.toISOString(),
          attestationVersion: WAIVER_ARTIFACT_WITHDRAWAL_ATTESTATION_VERSION,
        } satisfies Prisma.InputJsonValue,
        createdAt: now,
      },
    });
    return { artifactRowId: artifact.id, sequence, recordedAt: event.recordedAt };
  }, WAIVER_ARTIFACT_TX_OPTIONS);
}

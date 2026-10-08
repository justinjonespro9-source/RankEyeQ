import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { WaiverArtifactError } from "@/lib/waivers/artifacts/errors";
import { applyWaiverArtifactImport, buildWaiverArtifactImportPreview, previewWaiverArtifactImport } from "@/lib/waivers/artifacts/import";
import { waiverArtifactRowData, type WaiverArtifactImportEvidence } from "@/lib/waivers/artifacts/import-model";
import { loadWaiverArtifactDetail, loadWaiverArtifactWeekView, reverifyWaiverArtifactContent } from "@/lib/waivers/artifacts/queries";
import { withdrawWaiverArtifact } from "@/lib/waivers/artifacts/withdraw";
import { createArtifactFixture, type ArtifactFixture } from "@/lib/waivers/__fixtures__/artifacts";
import { SYNTHETIC_PARTICIPANTS, type SealedSyntheticArtifact } from "@/lib/waivers/__fixtures__/canonical-artifact";
import { expectDbGuard } from "@/lib/waivers/__fixtures__/competition";

/** Service-level import path under the shipped OPERATOR_ATTESTED gate; the kill switch is in authority-gate.integration.test.ts. */

let f: ArtifactFixture;

beforeEach(async () => {
  f = await createArtifactFixture("art");
});

afterEach(async () => {
  await f.cleanup();
});

async function importArtifact(sealed: SealedSyntheticArtifact, week = 5, overrides: Partial<WaiverArtifactImportEvidence> = {}) {
  const request = f.request(sealed, week, overrides);
  const preview = await previewWaiverArtifactImport(request);
  expect(preview.blockers).toEqual([]);
  const result = await applyWaiverArtifactImport({ ...request, adminUserId: f.adminUserId, previewFingerprint: preview.previewFingerprint, attested: true });
  return { request, preview, result };
}

async function blockedCodes(sealed: SealedSyntheticArtifact, week = 5, overrides: Partial<WaiverArtifactImportEvidence> = {}) {
  const request = f.request(sealed, week, overrides);
  const preview = await previewWaiverArtifactImport(request);
  expect(preview.status).toBe("BLOCKED");
  await expect(
    applyWaiverArtifactImport({ ...request, adminUserId: f.adminUserId, previewFingerprint: preview.previewFingerprint, attested: true }),
  ).rejects.toMatchObject({ code: "BLOCKED" });
  return preview.blockers.map((issue) => issue.code);
}

const eventStates = async (artifactRowId: string) =>
  (await prisma.waiverCanonicalArtifactEvent.findMany({ where: { artifactRowId }, orderBy: { sequence: "asc" } })).map((event) => ({
    sequence: event.sequence,
    state: event.state,
    basis: event.basis,
    successorArtifactRowId: event.successorArtifactRowId,
    reason: event.reason,
  }));

const artifactCount = () => prisma.waiverCanonicalArtifact.count({ where: { weekId: { in: [f.weekId(5), f.weekId(6)] } } });
const auditCount = () => prisma.adminAuditLog.count({ where: { adminUserId: f.adminUserId } });

async function competitionCounts() {
  return {
    waiverContest: await prisma.waiverContest.count(),
    waiverSubmission: await prisma.waiverSubmission.count(),
    waiverSubmissionRevision: await prisma.waiverSubmissionRevision.count(),
    waiverCall: await prisma.waiverCall.count(),
    waiverSnapshot: await prisma.waiverSnapshot.count(),
    waiverSnapshotEntry: await prisma.waiverSnapshotEntry.count(),
    waiverSnapshotCorrection: await prisma.waiverSnapshotCorrection.count(),
    rankIQContest: await prisma.rankIQContest.count(),
    rankingSubmission: await prisma.rankingSubmission.count(),
    contestPregameSnapshot: await prisma.contestPregameSnapshot.count(),
    officialBoardVersion: await prisma.officialBoardVersion.count(),
  };
}

describe("canonical artifact import", () => {
  it("a valid preview is read-only", async () => {
    const before = { artifacts: await artifactCount(), audits: await auditCount() };
    const preview = await previewWaiverArtifactImport(f.request(f.build()));
    expect(preview.status).toBe("READY");
    expect(preview.importEnabled).toBe(true);
    expect({ artifacts: await artifactCount(), audits: await auditCount() }).toEqual(before);
  });

  it("imports metadata, the exact content, the ACCEPTED event and an audit record", async () => {
    const sealed = f.build();
    const { result, preview } = await importArtifact(sealed);
    expect(result.alreadyImported).toBe(false);
    expect(Math.abs(result.importedAt.getTime() - Date.now())).toBeLessThan(60_000);

    const content = await prisma.waiverCanonicalArtifactContent.findUniqueOrThrow({ where: { artifactRowId: result.artifactRowId } });
    expect(content.contentText).toBe(sealed.bytes);
    expect(content.textSha256).toBe(preview.textSha256);
    expect(content.byteLength).toBe(Buffer.byteLength(sealed.bytes, "utf8"));

    const row = await prisma.waiverCanonicalArtifact.findUniqueOrThrow({ where: { id: result.artifactRowId } });
    expect(row).toMatchObject({
      artifactId: f.artifactIdFor(5, 1),
      revision: 1,
      supersedesArtifactId: null,
      contentChecksum: sealed.checksum,
      expectedContentChecksum: sealed.checksum,
      rulesetCode: "SNG_NFL_HALF_PPR",
      rulesetVersion: 1,
      engineVersion: "sng-nfl-fantasy-engine/1.0.0",
      positionPolicyVersion: "sng-nfl-weekly-position-eligibility/1.0.0",
      season: f.year,
      weekNumber: 5,
      weekId: f.weekId(5),
      participantCount: SYNTHETIC_PARTICIPANTS.length,
      qbFieldSize: 3,
      defCrosswalkVersion: "rankeyeq-sng-team-crosswalk/1",
      attestedPublicationState: "ACCEPTED",
      authorityBasis: "OPERATOR_ATTESTED",
      importedByUserId: f.adminUserId,
      previewFingerprint: preview.previewFingerprint,
    });
    expect(await eventStates(result.artifactRowId)).toEqual([
      { sequence: 1, state: "ACCEPTED", basis: "IMPORT_ATTESTATION", successorArtifactRowId: null, reason: null },
    ]);

    const audit = await prisma.adminAuditLog.findFirstOrThrow({ where: { adminUserId: f.adminUserId, action: "waivers.canonical_artifact_imported" } });
    expect(audit.entityId).toBe(result.artifactRowId);
    expect(audit.metadata).toMatchObject({ artifactId: f.artifactIdFor(5, 1), contentChecksum: sealed.checksum, authorityMode: "OPERATOR_ATTESTED" });
    expect(JSON.stringify(audit.metadata)).not.toContain(sealed.bytes.slice(0, 200));
  });

  it("rejects a SHA-256 mismatch and writes nothing", async () => {
    expect(await blockedCodes(f.build(), 5, { expectedContentChecksum: "f".repeat(64) })).toContain("ARTIFACT_INVALID");
    expect(await artifactCount()).toBe(0);
  });

  it("an identical re-import is idempotent", async () => {
    const sealed = f.build();
    const first = await importArtifact(sealed);
    const audits = await auditCount();
    const second = await importArtifact(sealed);
    expect(second.preview.status).toBe("ALREADY_IMPORTED");
    expect(second.result).toMatchObject({ alreadyImported: true, artifactRowId: first.result.artifactRowId });
    expect(await artifactCount()).toBe(1);
    expect(await eventStates(first.result.artifactRowId)).toHaveLength(1);
    expect(await auditCount()).toBe(audits);
  });

  it("the same artifact ID with different content fails", async () => {
    await importArtifact(f.build());
    const changed = f.build({ participants: SYNTHETIC_PARTICIPANTS.map((p) => (p.id === "qb-a" ? { ...p, points: 2412 } : p)) });
    expect(await blockedCodes(changed)).toEqual(["ARTIFACT_ID_REUSED"]);
  });

  it("the same series/revision with different content fails (and an older revision cannot displace a newer one)", async () => {
    await importArtifact(f.build());
    expect(await blockedCodes(f.build({ artifactId: `${f.suffix}-rival-r1` }))).toEqual(["REVISION_CONFLICT"]);
    await importArtifact(f.build({ revision: 2 }));
    expect(await blockedCodes(f.build({ artifactId: `${f.suffix}-late-r1` }))).toEqual(["REVISION_CONFLICT"]);
  });

  it("valid succession records the predecessor SUPERSEDED with its history and content preserved", async () => {
    const r1 = await importArtifact(f.build());
    const r2 = await importArtifact(f.build({ revision: 2 }));
    expect(r2.preview.succession.predecessorAction).toBe("SUPERSEDE");
    expect(r2.result.supersededArtifactRowId).toBe(r1.result.artifactRowId);
    expect(await eventStates(r1.result.artifactRowId)).toEqual([
      { sequence: 1, state: "ACCEPTED", basis: "IMPORT_ATTESTATION", successorArtifactRowId: null, reason: null },
      { sequence: 2, state: "SUPERSEDED", basis: "SUCCESSOR_IMPORT", successorArtifactRowId: r2.result.artifactRowId, reason: `Superseded by ${f.artifactIdFor(5, 2)} (revision 2)` },
    ]);
    expect(await eventStates(r2.result.artifactRowId)).toEqual([
      { sequence: 1, state: "ACCEPTED", basis: "IMPORT_ATTESTATION", successorArtifactRowId: null, reason: null },
    ]);
    const r1Content = await prisma.waiverCanonicalArtifactContent.findUniqueOrThrow({ where: { artifactRowId: r1.result.artifactRowId } });
    expect(r1Content.contentText).toBe(r1.request.artifactText);
    const view = await loadWaiverArtifactWeekView(f.weekId(5));
    expect(view!.artifacts.map((a) => [a.revision, a.currentState, a.supersededBy?.artifactId ?? null])).toEqual([
      [1, "SUPERSEDED", f.artifactIdFor(5, 2)],
      [2, "ACCEPTED", null],
    ]);
  });

  it("blocks a skipped revision", async () => {
    await importArtifact(f.build());
    expect(await blockedCodes(f.build({ revision: 3 }))).toEqual(["REVISION_SKIPPED"]);
    expect(await blockedCodes(f.build({ week: 6, revision: 2 }), 6)).toEqual(["REVISION_SKIPPED"]);
  });

  it("blocks a predecessor mismatch", async () => {
    await importArtifact(f.build());
    expect(await blockedCodes(f.build({ revision: 2, supersedesArtifactId: `${f.suffix}-elsewhere` }))).toEqual(["PREDECESSOR_MISMATCH"]);
  });

  it("blocks a cross-week predecessor", async () => {
    await importArtifact(f.build());
    expect(await blockedCodes(f.build({ week: 6, revision: 2, supersedesArtifactId: f.artifactIdFor(5, 1) }), 6)).toEqual([
      "REVISION_SKIPPED",
      "CROSS_WEEK_PREDECESSOR",
    ]);
  });

  it("rejects stale previews (history changed, or evidence changed)", async () => {
    await importArtifact(f.build());
    const r1Row = await prisma.waiverCanonicalArtifact.findFirstOrThrow({ where: { weekId: f.weekId(5) } });
    const request = f.request(f.build({ revision: 2 }));
    const preview = await previewWaiverArtifactImport(request);
    await withdrawWaiverArtifact({
      artifactRowId: r1Row.id,
      adminUserId: f.adminUserId,
      expectedSequence: 1,
      attested: true,
      reason: "SNG withdrew revision 1",
      sourceReference: "sng-admin://withdrawn",
      sourceObservedAt: new Date(Date.now() - 60_000),
    });
    await expect(
      applyWaiverArtifactImport({ ...request, adminUserId: f.adminUserId, previewFingerprint: preview.previewFingerprint, attested: true }),
    ).rejects.toMatchObject({ code: "STALE_PREVIEW" });

    const fresh = await previewWaiverArtifactImport(request);
    await expect(
      applyWaiverArtifactImport({
        ...request,
        evidence: { ...request.evidence, sourceReference: "sng-admin://edited" },
        adminUserId: f.adminUserId,
        previewFingerprint: fresh.previewFingerprint,
        attested: true,
      }),
    ).rejects.toMatchObject({ code: "STALE_PREVIEW" });
  });

  it("refuses an unauthorized import and a missing attestation", async () => {
    const request = f.request(f.build());
    const preview = await previewWaiverArtifactImport(request);
    await expect(applyWaiverArtifactImport({ ...request, adminUserId: f.memberUserId, previewFingerprint: preview.previewFingerprint, attested: true })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(applyWaiverArtifactImport({ ...request, adminUserId: f.adminUserId, previewFingerprint: preview.previewFingerprint, attested: false })).rejects.toMatchObject({
      code: "ATTESTATION_REQUIRED",
    });
    expect(await artifactCount()).toBe(0);
  });
});

describe("withdrawal and transitions", () => {
  it("withdrawal without a successor appends history, keeps the artifact, and cannot be undone by re-import", async () => {
    const sealed = f.build();
    const { result } = await importArtifact(sealed);
    const before = await prisma.waiverCanonicalArtifact.findUniqueOrThrow({ where: { id: result.artifactRowId } });
    const withdrawal = await withdrawWaiverArtifact({
      artifactRowId: result.artifactRowId,
      adminUserId: f.adminUserId,
      expectedSequence: 1,
      attested: true,
      reason: "SNG withdrew the artifact pending a stat review",
      sourceReference: "sng-admin://artifacts/withdrawn",
      sourceObservedAt: new Date(Date.now() - 60_000),
    });
    expect(withdrawal.sequence).toBe(2);
    expect(await eventStates(result.artifactRowId)).toEqual([
      { sequence: 1, state: "ACCEPTED", basis: "IMPORT_ATTESTATION", successorArtifactRowId: null, reason: null },
      { sequence: 2, state: "WITHDRAWN", basis: "OPERATOR_WITHDRAWAL", successorArtifactRowId: null, reason: "SNG withdrew the artifact pending a stat review" },
    ]);
    expect(await prisma.waiverCanonicalArtifact.findUniqueOrThrow({ where: { id: result.artifactRowId } })).toEqual(before);
    expect((await prisma.waiverCanonicalArtifactContent.findUniqueOrThrow({ where: { artifactRowId: result.artifactRowId } })).contentText).toBe(sealed.bytes);
    expect(await prisma.adminAuditLog.count({ where: { adminUserId: f.adminUserId, action: "waivers.canonical_artifact_withdrawn", entityId: result.artifactRowId } })).toBe(1);

    expect(await blockedCodes(sealed)).toEqual(["WITHDRAWN_REIMPORT"]);
    expect(await eventStates(result.artifactRowId)).toHaveLength(2);

    const r2 = await importArtifact(f.build({ revision: 2 }));
    expect(r2.preview.succession.predecessorAction).toBe("PREDECESSOR_WITHDRAWN");
    expect(r2.result.supersededArtifactRowId).toBeNull();
    expect((await eventStates(result.artifactRowId)).map((event) => event.state)).toEqual(["ACCEPTED", "WITHDRAWN"]);
  });

  it("a superseded artifact later withdrawn keeps ACCEPTED, SUPERSEDED, its successor link and content; nothing is restored", async () => {
    const r1 = await importArtifact(f.build());
    const r2 = await importArtifact(f.build({ revision: 2 }));
    const r1Before = await prisma.waiverCanonicalArtifact.findUniqueOrThrow({ where: { id: r1.result.artifactRowId } });
    const r2Events = await eventStates(r2.result.artifactRowId);
    const withdrawal = await withdrawWaiverArtifact({
      artifactRowId: r1.result.artifactRowId,
      adminUserId: f.adminUserId,
      expectedSequence: 2,
      attested: true,
      reason: "SNG later discredited revision 1's source feed",
      sourceReference: "sng-admin://artifacts/r1/withdrawn",
      sourceObservedAt: new Date(Date.now() - 60_000),
    });
    expect(withdrawal.sequence).toBe(3);
    expect(await eventStates(r1.result.artifactRowId)).toEqual([
      { sequence: 1, state: "ACCEPTED", basis: "IMPORT_ATTESTATION", successorArtifactRowId: null, reason: null },
      { sequence: 2, state: "SUPERSEDED", basis: "SUCCESSOR_IMPORT", successorArtifactRowId: r2.result.artifactRowId, reason: `Superseded by ${f.artifactIdFor(5, 2)} (revision 2)` },
      { sequence: 3, state: "WITHDRAWN", basis: "OPERATOR_WITHDRAWAL", successorArtifactRowId: null, reason: "SNG later discredited revision 1's source feed" },
    ]);
    expect(await prisma.waiverCanonicalArtifact.findUniqueOrThrow({ where: { id: r1.result.artifactRowId } })).toEqual(r1Before);
    expect((await prisma.waiverCanonicalArtifactContent.findUniqueOrThrow({ where: { artifactRowId: r1.result.artifactRowId } })).contentText).toBe(r1.request.artifactText);
    expect(await eventStates(r2.result.artifactRowId)).toEqual(r2Events);
    const view = await loadWaiverArtifactWeekView(f.weekId(5));
    expect(view!.artifacts.map((a) => [a.revision, a.currentState, a.supersededBy?.artifactId ?? null])).toEqual([
      [1, "WITHDRAWN", f.artifactIdFor(5, 2)],
      [2, "ACCEPTED", null],
    ]);
    const audit = await prisma.adminAuditLog.findFirstOrThrow({ where: { action: "waivers.canonical_artifact_withdrawn", entityId: r1.result.artifactRowId } });
    expect(audit.metadata).toMatchObject({ previousState: "SUPERSEDED", sequence: 3 });

    expect(await blockedCodes(f.build())).toEqual(["WITHDRAWN_REIMPORT"]);
    expect(await blockedCodes(f.build({ revision: 2, artifactId: `${f.suffix}-fork-r2` }))).toEqual(["REVISION_CONFLICT"]);
    await expect(
      withdrawWaiverArtifact({
        artifactRowId: r1.result.artifactRowId,
        adminUserId: f.adminUserId,
        expectedSequence: 3,
        attested: true,
        reason: "again",
        sourceReference: "sng-admin://again",
        sourceObservedAt: new Date(Date.now() - 60_000),
      }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("rejects invalid transitions, stale sequences and unauthorized withdrawals", async () => {
    const r1 = await importArtifact(f.build());
    await importArtifact(f.build({ revision: 2 }));
    const base = { reason: "x", sourceReference: "sng-admin://x", sourceObservedAt: new Date(Date.now() - 60_000), attested: true };
    await expect(withdrawWaiverArtifact({ ...base, artifactRowId: r1.result.artifactRowId, adminUserId: f.adminUserId, expectedSequence: 1 })).rejects.toMatchObject({
      code: "STALE_PREVIEW",
    });

    const r2Row = await prisma.waiverCanonicalArtifact.findFirstOrThrow({ where: { weekId: f.weekId(5), revision: 2 } });
    await expect(withdrawWaiverArtifact({ ...base, artifactRowId: r2Row.id, adminUserId: f.memberUserId, expectedSequence: 1 })).rejects.toBeInstanceOf(WaiverArtifactError);
    await expect(withdrawWaiverArtifact({ ...base, artifactRowId: r2Row.id, adminUserId: f.memberUserId, expectedSequence: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(withdrawWaiverArtifact({ ...base, artifactRowId: r2Row.id, adminUserId: f.adminUserId, expectedSequence: 1, reason: "  " })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(withdrawWaiverArtifact({ ...base, artifactRowId: r2Row.id, adminUserId: f.adminUserId, expectedSequence: 1, attested: false })).rejects.toMatchObject({
      code: "ATTESTATION_REQUIRED",
    });
    await withdrawWaiverArtifact({ ...base, artifactRowId: r2Row.id, adminUserId: f.adminUserId, expectedSequence: 1 });
    await expect(withdrawWaiverArtifact({ ...base, artifactRowId: r2Row.id, adminUserId: f.adminUserId, expectedSequence: 2 })).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });
});

describe("database immutability and transition guards", () => {
  it("rejects artifact metadata UPDATE and DELETE", async () => {
    const { result } = await importArtifact(f.build());
    await expectDbGuard(prisma.waiverCanonicalArtifact.update({ where: { id: result.artifactRowId }, data: { sourceReference: "edited" } }), "WAIVER_IMMUTABLE");
    await expectDbGuard(prisma.$executeRaw`UPDATE "WaiverCanonicalArtifact" SET "revision" = "revision" WHERE "id" = ${result.artifactRowId}`, "WAIVER_IMMUTABLE");
    await expectDbGuard(prisma.waiverCanonicalArtifact.delete({ where: { id: result.artifactRowId } }), "WAIVER_IMMUTABLE");
  });

  it("rejects content UPDATE and DELETE", async () => {
    const { result } = await importArtifact(f.build());
    await expectDbGuard(
      prisma.waiverCanonicalArtifactContent.update({ where: { artifactRowId: result.artifactRowId }, data: { contentText: "{}" } }),
      "WAIVER_IMMUTABLE",
    );
    await expectDbGuard(prisma.waiverCanonicalArtifactContent.delete({ where: { artifactRowId: result.artifactRowId } }), "WAIVER_IMMUTABLE");
  });

  it("rejects event UPDATE and DELETE", async () => {
    const { result } = await importArtifact(f.build());
    const event = await prisma.waiverCanonicalArtifactEvent.findFirstOrThrow({ where: { artifactRowId: result.artifactRowId } });
    await expectDbGuard(prisma.waiverCanonicalArtifactEvent.update({ where: { id: event.id }, data: { state: "WITHDRAWN", reason: "x" } }), "WAIVER_IMMUTABLE");
    await expectDbGuard(prisma.waiverCanonicalArtifactEvent.delete({ where: { id: event.id } }), "WAIVER_IMMUTABLE");
  });

  it("enforces append-only legal transitions at the database", async () => {
    const r1 = await importArtifact(f.build());
    const unrelated = await importArtifact(f.build({ week: 6 }), 6);
    const base = {
      artifactRowId: r1.result.artifactRowId,
      sourceReference: "sng-admin://direct",
      sourceObservedAt: new Date(Date.now() - 60_000),
      attestationVersion: "direct",
      operatorUserId: f.adminUserId,
    };
    await expectDbGuard(prisma.waiverCanonicalArtifactEvent.create({ data: { ...base, sequence: 3, state: "WITHDRAWN", basis: "OPERATOR_WITHDRAWAL", reason: "skip" } }), "WAIVER_INVALID");
    await expectDbGuard(
      prisma.waiverCanonicalArtifactEvent.create({
        data: { ...base, sequence: 2, state: "SUPERSEDED", basis: "SUCCESSOR_IMPORT", successorArtifactRowId: unrelated.result.artifactRowId },
      }),
      "WAIVER_INVALID",
    );
    await expect(prisma.waiverCanonicalArtifactEvent.create({ data: { ...base, sequence: 2, state: "ACCEPTED", basis: "IMPORT_ATTESTATION" } })).rejects.toThrow(
      /WaiverCanonicalArtifactEvent_shape_check|WAIVER_INVALID/,
    );
    await expect(prisma.waiverCanonicalArtifactEvent.create({ data: { ...base, sequence: 2, state: "WITHDRAWN", basis: "OPERATOR_WITHDRAWAL" } })).rejects.toThrow(
      /WaiverCanonicalArtifactEvent_shape_check/,
    );
    const withdrawn = await prisma.waiverCanonicalArtifactEvent.create({
      data: { ...base, sequence: 2, state: "WITHDRAWN", basis: "OPERATOR_WITHDRAWAL", reason: "direct", recordedAt: new Date(0) },
    });
    expect(Math.abs(withdrawn.recordedAt.getTime() - Date.now())).toBeLessThan(60_000);
    await expectDbGuard(prisma.waiverCanonicalArtifactEvent.create({ data: { ...base, sequence: 3, state: "WITHDRAWN", basis: "OPERATOR_WITHDRAWAL", reason: "again" } }), "WAIVER_INVALID");
  });

  it("allows SUPERSEDED -> WITHDRAWN at the database but never SUPERSEDED -> SUPERSEDED or any return to ACCEPTED", async () => {
    const r1 = await importArtifact(f.build());
    const r2 = await importArtifact(f.build({ revision: 2 }));
    const base = {
      artifactRowId: r1.result.artifactRowId,
      sourceReference: "sng-admin://direct",
      sourceObservedAt: new Date(Date.now() - 60_000),
      attestationVersion: "direct",
      operatorUserId: f.adminUserId,
    };
    await expectDbGuard(
      prisma.waiverCanonicalArtifactEvent.create({
        data: { ...base, sequence: 3, state: "SUPERSEDED", basis: "SUCCESSOR_IMPORT", successorArtifactRowId: r2.result.artifactRowId },
      }),
      "WAIVER_INVALID",
    );
    await expect(prisma.waiverCanonicalArtifactEvent.create({ data: { ...base, sequence: 3, state: "ACCEPTED", basis: "IMPORT_ATTESTATION" } })).rejects.toThrow(
      /WaiverCanonicalArtifactEvent_shape_check|WAIVER_INVALID/,
    );
    await prisma.waiverCanonicalArtifactEvent.create({ data: { ...base, sequence: 3, state: "WITHDRAWN", basis: "OPERATOR_WITHDRAWAL", reason: "discredited" } });
    await expectDbGuard(prisma.waiverCanonicalArtifactEvent.create({ data: { ...base, sequence: 4, state: "WITHDRAWN", basis: "OPERATOR_WITHDRAWAL", reason: "again" } }), "WAIVER_INVALID");
    const latest = await prisma.waiverCanonicalArtifactEvent.findMany({ where: { artifactRowId: { in: [r1.result.artifactRowId, r2.result.artifactRowId] } }, orderBy: [{ artifactRowId: "asc" }, { sequence: "desc" }] });
    const current = new Map<string, string>();
    for (const event of latest) if (!current.has(event.artifactRowId)) current.set(event.artifactRowId, event.state);
    expect([...current.values()].filter((state) => state === "ACCEPTED")).toHaveLength(1);
  });

  it("refuses TRUNCATE on every artifact table, directly or by CASCADE", async () => {
    await importArtifact(f.build());
    for (const statement of [
      `TRUNCATE "WaiverCanonicalArtifactEvent"`,
      `TRUNCATE "WaiverCanonicalArtifactContent"`,
      `TRUNCATE "WaiverCanonicalArtifact" CASCADE`,
    ]) {
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(statement);
          throw new Error("ROLLBACK_SENTINEL: the TRUNCATE guard did not fire");
        }),
      ).rejects.toThrow(/WAIVER_IMMUTABLE: canonical artifact records cannot be truncated/);
    }
    expect(await artifactCount()).toBe(1);
  });

  it("requires content and the ACCEPTED import event at commit, contiguous lineage, and checked bytes", async () => {
    const sealed = f.build();
    const request = f.request(sealed);
    const { preview, verification } = await buildWaiverArtifactImportPreview(prisma, request);
    if (!verification.ok) throw new Error("fixture must verify");
    const data = waiverArtifactRowData(verification, request, preview, f.adminUserId);

    await expectDbGuard(prisma.$transaction(async (tx) => tx.waiverCanonicalArtifact.create({ data })), "WAIVER_INVALID");
    await expectDbGuard(
      prisma.$transaction(async (tx) => {
        const row = await tx.waiverCanonicalArtifact.create({ data });
        await tx.waiverCanonicalArtifactContent.create({ data: { artifactRowId: row.id, contentText: sealed.bytes, textSha256: preview.textSha256, byteLength: preview.byteLength } });
      }),
      "WAIVER_INVALID",
    );
    await expect(
      prisma.$transaction(async (tx) => {
        const row = await tx.waiverCanonicalArtifact.create({ data });
        await tx.waiverCanonicalArtifactContent.create({ data: { artifactRowId: row.id, contentText: sealed.bytes, textSha256: "0".repeat(64), byteLength: preview.byteLength } });
      }),
    ).rejects.toThrow(/WaiverCanonicalArtifactContent_bytes_check/);
    await expectDbGuard(prisma.waiverCanonicalArtifact.create({ data: { ...data, weekId: f.weekId(6) } }), "WAIVER_INVALID");

    const r2 = f.build({ revision: 2 });
    const r2Request = f.request(r2);
    const r2Built = await buildWaiverArtifactImportPreview(prisma, r2Request);
    if (!r2Built.verification.ok) throw new Error("fixture must verify");
    await expectDbGuard(prisma.waiverCanonicalArtifact.create({ data: waiverArtifactRowData(r2Built.verification, r2Request, r2Built.preview, f.adminUserId) }), "WAIVER_INVALID");
    expect(await artifactCount()).toBe(0);
  });
});

describe("isolation", () => {
  it("never grades or modifies competition, Rankings or Official Board rows", async () => {
    const before = await competitionCounts();
    const r1 = await importArtifact(f.build());
    await importArtifact(f.build({ revision: 2 }));
    const r2Row = await prisma.waiverCanonicalArtifact.findFirstOrThrow({ where: { weekId: f.weekId(5), revision: 2 } });
    await withdrawWaiverArtifact({
      artifactRowId: r2Row.id,
      adminUserId: f.adminUserId,
      expectedSequence: 1,
      attested: true,
      reason: "withdrawn",
      sourceReference: "sng-admin://w",
      sourceObservedAt: new Date(Date.now() - 60_000),
    });
    expect(await competitionCounts()).toEqual(before);
    expect(r1.result.alreadyImported).toBe(false);
  });

  it("list and detail views never carry artifact text; re-verification reads it server-side only", async () => {
    const sealed = f.build();
    const { result } = await importArtifact(sealed);
    const view = await loadWaiverArtifactWeekView(f.weekId(5));
    const detail = await loadWaiverArtifactDetail(result.artifactRowId);
    for (const payload of [view, detail]) {
      expect(JSON.stringify(payload)).not.toContain("contentText");
      expect(JSON.stringify(payload)).not.toContain(sealed.bytes.slice(0, 120));
    }
    expect(await reverifyWaiverArtifactContent(result.artifactRowId)).toEqual({
      ok: true,
      verifierOk: true,
      issueCodes: [],
      textSha256Matches: true,
      byteLengthMatches: true,
    });
  });
});

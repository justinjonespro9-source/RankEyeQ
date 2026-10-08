import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as importRoute } from "@/app/api/admin/waivers/artifacts/import/route";
import { POST as previewRoute } from "@/app/api/admin/waivers/artifacts/preview/route";
import { prisma } from "@/lib/db";
import { WAIVER_ARTIFACT_AUTHORITY_LABEL, WAIVER_ARTIFACT_IMPORT_ATTESTATION_VERSION } from "@/lib/waivers/artifacts/authority";
import type { WaiverArtifactImportEvidence, WaiverArtifactImportPreview } from "@/lib/waivers/artifacts/import-model";
import { decompressWaiverArtifact } from "@/lib/waivers/artifacts/upload";
import {
  WAIVER_ARTIFACT_IMPORT_ROUTE,
  WAIVER_ARTIFACT_PREVIEW_ROUTE,
  WAIVER_ARTIFACT_UPLOAD_HEADER,
  WAIVER_ARTIFACT_UPLOAD_HEADER_VALUE,
  WAIVER_ARTIFACT_UPLOAD_MAX_BYTES,
} from "@/lib/waivers/artifacts/upload-limits";
import { createArtifactFixture, type ArtifactFixture } from "@/lib/waivers/__fixtures__/artifacts";
import type { SealedSyntheticArtifact } from "@/lib/waivers/__fixtures__/canonical-artifact";

/** The upload routes with a real local DB; only the session lookup is replaced. */
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/auth/session", async () => {
  const { prisma: db } = await import("@/lib/db");
  const { canAccessAdmin } = await import("@/lib/admin/access");
  return {
    assertAdmin: async () => {
      const user = session.userId ? await db.user.findUnique({ where: { id: session.userId } }) : null;
      if (!user || !canAccessAdmin(user.role)) throw new Error("Admin access required");
      return { user, universalProfile: null };
    },
  };
});

const ORIGIN = "https://admin.rankeyeq.test";
const HOST = "admin.rankeyeq.test";

let f: ArtifactFixture;

beforeEach(async () => {
  f = await createArtifactFixture("upl");
  session.userId = f.adminUserId;
});

afterEach(async () => {
  session.userId = null;
  await f.cleanup();
});

type Fields = Record<string, string | Blob>;

function evidenceJson(sealed: SealedSyntheticArtifact, week = 5, overrides: Partial<Record<keyof WaiverArtifactImportEvidence, string | number>> = {}) {
  const e = f.evidence(sealed);
  return JSON.stringify({
    weekId: f.weekId(week),
    expectedContentChecksum: e.expectedContentChecksum,
    sngArtifactId: e.sngArtifactId,
    sngRevision: String(e.sngRevision),
    sngAcceptanceId: e.sngAcceptanceId,
    sngAcceptedAt: e.sngAcceptedAt!.toISOString(),
    attestedPublicationState: e.attestedPublicationState,
    sourceReference: e.sourceReference,
    sourceObservedAt: e.sourceObservedAt!.toISOString(),
    ...overrides,
  });
}

const gz = (text: string) => new Blob([new Uint8Array(gzipSync(Buffer.from(text, "utf8")))], { type: "application/gzip" });

function uploadRequest(route: string, fields: Fields, headers: Record<string, string> = {}) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  return new Request(`${ORIGIN}${route}`, {
    method: "POST",
    body,
    headers: { origin: ORIGIN, "x-forwarded-host": HOST, "sec-fetch-site": "same-origin", [WAIVER_ARTIFACT_UPLOAD_HEADER]: WAIVER_ARTIFACT_UPLOAD_HEADER_VALUE, ...headers },
  });
}

async function call(route: typeof previewRoute, request: Request) {
  const response = await route(request);
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text) as Record<string, unknown> & { code?: string }, raw: text };
}

async function preview(sealed: SealedSyntheticArtifact, evidence = evidenceJson(sealed)) {
  const result = await call(previewRoute, uploadRequest(WAIVER_ARTIFACT_PREVIEW_ROUTE, { artifact: gz(sealed.bytes), evidence }));
  return { ...result, preview: result.body.preview as WaiverArtifactImportPreview };
}

function importFields(text: string, evidence: string, p: WaiverArtifactImportPreview, extra: Fields = {}): Fields {
  return { artifact: gz(text), evidence, previewFingerprint: p.previewFingerprint, previewTextSha256: p.textSha256, attested: "true", ...extra };
}

const artifactCount = () => prisma.waiverCanonicalArtifact.count({ where: { weekId: { in: [f.weekId(5), f.weekId(6)] } } });

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

describe("operator-attested import through the upload route", () => {
  it("previews read-only, imports with the operator's identity and exact evidence, and labels the authority honestly", async () => {
    const sealed = f.build();
    const before = await competitionCounts();
    const evidence = evidenceJson(sealed);
    const p = await preview(sealed, evidence);
    expect(p.status).toBe(200);
    expect(p.preview).toMatchObject({ status: "READY", importEnabled: true, authorityMode: "OPERATOR_ATTESTED" });
    expect(p.preview.advisories.find((issue) => issue.code === "OPERATOR_ATTESTED_AUTHORITY")?.message).toContain(WAIVER_ARTIFACT_AUTHORITY_LABEL);
    expect(await artifactCount()).toBe(0);

    const imported = await call(importRoute, uploadRequest(WAIVER_ARTIFACT_IMPORT_ROUTE, importFields(sealed.bytes, evidence, p.preview)));
    expect(imported.status).toBe(200);
    expect(imported.body).toMatchObject({ ok: true, artifactId: f.artifactIdFor(5, 1), revision: 1, alreadyImported: false });
    for (const response of [p.raw, imported.raw]) expect(response).not.toContain(sealed.bytes.slice(0, 120));

    const row = await prisma.waiverCanonicalArtifact.findUniqueOrThrow({ where: { id: imported.body.artifactRowId as string } });
    const e = f.evidence(sealed);
    expect(row).toMatchObject({
      importedByUserId: f.adminUserId,
      authorityBasis: "OPERATOR_ATTESTED",
      attestationVersion: WAIVER_ARTIFACT_IMPORT_ATTESTATION_VERSION,
      expectedContentChecksum: e.expectedContentChecksum,
      artifactId: e.sngArtifactId,
      revision: e.sngRevision,
      acceptanceId: e.sngAcceptanceId,
      acceptedAt: e.sngAcceptedAt,
      sourceReference: e.sourceReference,
      sourceObservedAt: e.sourceObservedAt,
      attestedPublicationState: "ACCEPTED",
      previewFingerprint: p.preview.previewFingerprint,
    });
    expect(row.attestationText).toMatch(/authenticated publication\/download surface/);
    expect(row.attestationText).toMatch(/not who authored or published it/);
    const event = await prisma.waiverCanonicalArtifactEvent.findFirstOrThrow({ where: { artifactRowId: row.id } });
    expect(event).toMatchObject({ state: "ACCEPTED", operatorUserId: f.adminUserId, sourceReference: e.sourceReference, attestationVersion: WAIVER_ARTIFACT_IMPORT_ATTESTATION_VERSION });
    expect((await prisma.waiverCanonicalArtifactContent.findUniqueOrThrow({ where: { artifactRowId: row.id } })).contentText).toBe(sealed.bytes);

    const replay = await call(importRoute, uploadRequest(WAIVER_ARTIFACT_IMPORT_ROUTE, importFields(sealed.bytes, evidence, (await preview(sealed, evidence)).preview)));
    expect(replay.body).toMatchObject({ ok: true, alreadyImported: true, artifactRowId: row.id });
    expect(await artifactCount()).toBe(1);
    expect(await competitionCounts()).toEqual(before);
  });

  it("blocks missing or incomplete operator evidence", async () => {
    const sealed = f.build();
    const blank = evidenceJson(sealed, 5, { sngAcceptanceId: "", sourceReference: "", sourceObservedAt: "", sngRevision: "", expectedContentChecksum: "", sngAcceptedAt: "" });
    const p = await preview(sealed, blank);
    expect(p.preview.status).toBe("BLOCKED");
    const missing = p.preview.blockers.find((issue) => issue.code === "EVIDENCE_MISSING")?.details as { missing: string[] };
    expect(missing.missing.sort()).toEqual(["expectedContentChecksum", "sngAcceptanceId", "sngAcceptedAt", "sngRevision", "sourceObservedAt", "sourceReference"]);
    const imported = await call(importRoute, uploadRequest(WAIVER_ARTIFACT_IMPORT_ROUTE, importFields(sealed.bytes, blank, p.preview)));
    expect(imported).toMatchObject({ status: 422, body: { code: "BLOCKED" } });

    const mismatched = evidenceJson(sealed, 5, { sngAcceptanceId: "someone-else" });
    expect((await preview(sealed, mismatched)).preview.blockers.map((issue) => issue.code)).toContain("EVIDENCE_MISMATCH");
    const noAttestation = await call(importRoute, uploadRequest(WAIVER_ARTIFACT_IMPORT_ROUTE, importFields(sealed.bytes, evidenceJson(sealed), (await preview(sealed)).preview, { attested: "false" })));
    expect(noAttestation).toMatchObject({ status: 400, body: { code: "ATTESTATION_REQUIRED" } });
    expect(await call(previewRoute, uploadRequest(WAIVER_ARTIFACT_PREVIEW_ROUTE, { artifact: gz(sealed.bytes), evidence: "{not json" }))).toMatchObject({
      status: 400,
      body: { code: "INVALID_INPUT" },
    });
    expect(await artifactCount()).toBe(0);
  });

  it("blocks an incorrect checksum", async () => {
    const sealed = f.build();
    const evidence = evidenceJson(sealed, 5, { expectedContentChecksum: "a".repeat(64) });
    const p = await preview(sealed, evidence);
    expect(p.preview.status).toBe("BLOCKED");
    expect(p.preview.blockers.map((issue) => issue.code)).toContain("ARTIFACT_INVALID");
    expect(await call(importRoute, uploadRequest(WAIVER_ARTIFACT_IMPORT_ROUTE, importFields(sealed.bytes, evidence, p.preview)))).toMatchObject({
      status: 422,
      body: { code: "BLOCKED" },
    });
    expect(await artifactCount()).toBe(0);
  });

  it("binds import to the previewed content and evidence", async () => {
    const sealed = f.build();
    const other = f.build({ week: 6 });
    const evidence = evidenceJson(sealed);
    const p = (await preview(sealed, evidence)).preview;

    const swapped = await call(importRoute, uploadRequest(WAIVER_ARTIFACT_IMPORT_ROUTE, importFields(other.bytes, evidence, p)));
    expect(swapped).toMatchObject({ status: 409, body: { code: "CONTENT_MISMATCH" } });

    const otherPreview = (await preview(other, evidenceJson(other, 6))).preview;
    const forged = await call(
      importRoute,
      uploadRequest(WAIVER_ARTIFACT_IMPORT_ROUTE, importFields(other.bytes, evidenceJson(other, 6), { ...otherPreview, previewFingerprint: p.previewFingerprint })),
    );
    expect(forged).toMatchObject({ status: 409, body: { code: "STALE_PREVIEW" } });

    const editedEvidence = evidenceJson(sealed, 5, { sourceReference: "sng-admin://edited-after-preview" });
    expect(await call(importRoute, uploadRequest(WAIVER_ARTIFACT_IMPORT_ROUTE, importFields(sealed.bytes, editedEvidence, p)))).toMatchObject({
      status: 409,
      body: { code: "STALE_PREVIEW" },
    });
    expect(await artifactCount()).toBe(0);
  });
});

describe("upload transport limits and authorization", () => {
  it("rejects oversized uploads by declared length and while streaming, before buffering", async () => {
    const sealed = f.build();
    const declared = uploadRequest(WAIVER_ARTIFACT_PREVIEW_ROUTE, { artifact: gz(sealed.bytes), evidence: evidenceJson(sealed) }, { "content-length": String(WAIVER_ARTIFACT_UPLOAD_MAX_BYTES + 1) });
    expect(await call(previewRoute, declared)).toMatchObject({ status: 413, body: { code: "UPLOAD_TOO_LARGE" } });

    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > WAIVER_ARTIFACT_UPLOAD_MAX_BYTES + chunk.byteLength) return controller.close();
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const streamed = new Request(`${ORIGIN}${WAIVER_ARTIFACT_PREVIEW_ROUTE}`, {
      method: "POST",
      body: stream,
      duplex: "half",
      headers: {
        origin: ORIGIN,
        "x-forwarded-host": HOST,
        "content-type": "multipart/form-data; boundary=x",
        [WAIVER_ARTIFACT_UPLOAD_HEADER]: WAIVER_ARTIFACT_UPLOAD_HEADER_VALUE,
      },
    } as RequestInit);
    expect(await call(previewRoute, streamed)).toMatchObject({ status: 413, body: { code: "UPLOAD_TOO_LARGE" } });
    expect(sent).toBeLessThanOrEqual(WAIVER_ARTIFACT_UPLOAD_MAX_BYTES + 2 * chunk.byteLength);
  });

  it("bounds decompression and rejects non-gzip or non-UTF-8 artifacts", async () => {
    const bomb = new Uint8Array(gzipSync(Buffer.alloc(2 * 1024 * 1024, 0x20)));
    expect(bomb.byteLength).toBeLessThan(64 * 1024);
    expect(() => decompressWaiverArtifact(bomb, 1024 * 1024)).toThrow(/exceeds/);
    expect(() => decompressWaiverArtifact(new Uint8Array(gzipSync(Buffer.from([0xff, 0xfe, 0xfd]))))).toThrow(/UTF-8/);
    const sealed = f.build();
    const plain = await call(previewRoute, uploadRequest(WAIVER_ARTIFACT_PREVIEW_ROUTE, { artifact: new Blob([sealed.bytes]), evidence: evidenceJson(sealed) }));
    expect(plain).toMatchObject({ status: 415, body: { code: "UNSUPPORTED_ENCODING" } });
    const extra = await call(previewRoute, uploadRequest(WAIVER_ARTIFACT_PREVIEW_ROUTE, { artifact: gz(sealed.bytes), evidence: evidenceJson(sealed), url: "https://example.test/a.json" }));
    expect(extra).toMatchObject({ status: 400, body: { code: "INVALID_INPUT" } });
  });

  it("refuses unauthenticated, non-admin and cross-site uploads and writes nothing", async () => {
    const sealed = f.build();
    const p = (await preview(sealed)).preview;
    const fields = () => importFields(sealed.bytes, evidenceJson(sealed), p);

    session.userId = null;
    expect(await call(previewRoute, uploadRequest(WAIVER_ARTIFACT_PREVIEW_ROUTE, { artifact: gz(sealed.bytes), evidence: evidenceJson(sealed) }))).toMatchObject({
      status: 403,
      body: { code: "FORBIDDEN" },
    });
    expect(await call(importRoute, uploadRequest(WAIVER_ARTIFACT_IMPORT_ROUTE, fields()))).toMatchObject({ status: 403, body: { code: "FORBIDDEN" } });
    session.userId = f.memberUserId;
    expect(await call(importRoute, uploadRequest(WAIVER_ARTIFACT_IMPORT_ROUTE, fields()))).toMatchObject({ status: 403, body: { code: "FORBIDDEN" } });

    session.userId = f.adminUserId;
    expect(await call(importRoute, uploadRequest(WAIVER_ARTIFACT_IMPORT_ROUTE, fields(), { origin: "https://evil.test" }))).toMatchObject({ status: 403, body: { code: "CROSS_SITE" } });
    expect(await call(importRoute, uploadRequest(WAIVER_ARTIFACT_IMPORT_ROUTE, fields(), { "sec-fetch-site": "cross-site" }))).toMatchObject({ status: 403, body: { code: "CROSS_SITE" } });
    expect(await call(importRoute, uploadRequest(WAIVER_ARTIFACT_IMPORT_ROUTE, fields(), { [WAIVER_ARTIFACT_UPLOAD_HEADER]: "" }))).toMatchObject({ status: 400 });
    expect(await artifactCount()).toBe(0);
    expect(await prisma.adminAuditLog.count({ where: { adminUserId: { in: [f.adminUserId, f.memberUserId] } } })).toBe(0);
  });
});

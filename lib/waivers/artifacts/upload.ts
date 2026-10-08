import { gunzipSync } from "node:zlib";
import { assertAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { logServerEvent } from "@/lib/log";
import { WaiverArtifactError, type WaiverArtifactErrorCode } from "@/lib/waivers/artifacts/errors";
import { applyWaiverArtifactImport, assertWaiverArtifactAdmin, previewWaiverArtifactImport } from "@/lib/waivers/artifacts/import";
import {
  WAIVER_ARTIFACT_ID_MAX,
  WAIVER_ARTIFACT_SOURCE_REFERENCE_MAX,
  waiverArtifactTextSha256,
  type WaiverArtifactImportInput,
} from "@/lib/waivers/artifacts/import-model";
import {
  WAIVER_ARTIFACT_TEXT_MAX_BYTES,
  WAIVER_ARTIFACT_UPLOAD_FIELDS,
  WAIVER_ARTIFACT_UPLOAD_HEADER,
  WAIVER_ARTIFACT_UPLOAD_HEADER_VALUE,
  WAIVER_ARTIFACT_UPLOAD_MAX_BYTES,
} from "@/lib/waivers/artifacts/upload-limits";
import { parseWaiverObservedAt } from "@/lib/waivers/snapshot/input";

/**
 * Authenticated canonical artifact upload (preview and import). One request
 * carries the gzip-compressed artifact and the operator evidence; nothing is
 * persisted until the import transaction, and nothing is fetched from a URL.
 * Responses and logs never contain artifact text.
 */

export type WaiverArtifactUploadMode = "preview" | "import";

class UploadRejection extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const MAX_ID = 64;
const MAX_EVIDENCE_CHARS = 8 * 1024;
const HEX64 = /^[a-f0-9]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

const ERROR_STATUS: Record<WaiverArtifactErrorCode, number> = {
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  ATTESTATION_REQUIRED: 400,
  BLOCKED: 422,
  STALE_PREVIEW: 409,
  INVALID_TRANSITION: 409,
};

const respond = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const invalid = (message: string) => new UploadRejection(400, "INVALID_INPUT", message);
const tooLarge = (message: string) => new UploadRejection(413, "UPLOAD_TOO_LARGE", message);

/** Same-origin browser requests only; the custom header also forces a CORS preflight that is never granted. */
function assertSameOrigin(request: Request) {
  if (request.headers.get(WAIVER_ARTIFACT_UPLOAD_HEADER) !== WAIVER_ARTIFACT_UPLOAD_HEADER_VALUE) {
    throw new UploadRejection(400, "INVALID_INPUT", "Missing artifact upload header");
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  let originHost: string | null = null;
  try {
    originHost = origin ? new URL(origin).host : null;
  } catch {
    originHost = null;
  }
  if ((fetchSite && fetchSite !== "same-origin") || !originHost || !host || originHost !== host) {
    throw new UploadRejection(403, "CROSS_SITE", "Cross-site artifact upload refused");
  }
}

async function resolveAdminUserId(): Promise<string | null> {
  try {
    return (await assertAdmin()).user.id;
  } catch {
    return null;
  }
}

/** Reads at most `max` bytes; a declared or streamed overrun is refused without buffering the rest. */
async function readCappedBody(request: Request, max: number): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) throw invalid("Invalid Content-Length");
    if (Number(declared) > max) throw tooLarge(`The upload exceeds ${max} bytes`);
  }
  if (!request.body) throw invalid("Empty upload");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge(`The upload exceeds ${max} bytes`);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function parseMultipart(body: Uint8Array, contentType: string, mode: WaiverArtifactUploadMode): Promise<FormData> {
  let form: FormData;
  try {
    form = await new Response(body as BodyInit, { headers: { "content-type": contentType } }).formData();
  } catch {
    throw invalid("Malformed multipart upload");
  }
  const allowed = new Set<string>([WAIVER_ARTIFACT_UPLOAD_FIELDS.artifact, WAIVER_ARTIFACT_UPLOAD_FIELDS.evidence]);
  if (mode === "import") {
    allowed.add(WAIVER_ARTIFACT_UPLOAD_FIELDS.previewFingerprint);
    allowed.add(WAIVER_ARTIFACT_UPLOAD_FIELDS.previewTextSha256);
    allowed.add(WAIVER_ARTIFACT_UPLOAD_FIELDS.attested);
  }
  const seen = new Set<string>();
  for (const key of form.keys()) {
    if (!allowed.has(key) || seen.has(key)) throw invalid(`Unexpected upload field ${key.slice(0, 40)}`);
    seen.add(key);
  }
  return form;
}

/** Gunzips with a hard output bound (no decompression bomb) and decodes strict UTF-8, keeping any BOM for the verifier to reject. */
export function decompressWaiverArtifact(compressed: Uint8Array, maxBytes = WAIVER_ARTIFACT_TEXT_MAX_BYTES): string {
  if (compressed.byteLength < 18 || compressed[0] !== 0x1f || compressed[1] !== 0x8b) {
    throw new UploadRejection(415, "UNSUPPORTED_ENCODING", "The artifact must be gzip-compressed");
  }
  let raw: Buffer;
  try {
    raw = gunzipSync(compressed, { maxOutputLength: maxBytes });
  } catch (error) {
    if (error instanceof RangeError || (error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") {
      throw tooLarge(`The decompressed artifact exceeds ${maxBytes} bytes`);
    }
    throw new UploadRejection(400, "INVALID_ENCODING", "The artifact is not valid gzip");
  }
  if (raw.byteLength === 0) throw invalid("The artifact is empty");
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
  } catch {
    throw new UploadRejection(400, "INVALID_ENCODING", "The artifact is not valid UTF-8");
  }
}

const isText = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;

function parseRevision(value: unknown): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : null;
  if (text === null || !/^\d{1,6}$/.test(text)) return undefined;
  return Number(text);
}

/** Operator evidence (JSON). Blank fields stay blank so the preview reports them as EVIDENCE_MISSING. */
export function parseWaiverArtifactEvidence(raw: unknown, artifactText: string): WaiverArtifactImportInput {
  if (typeof raw !== "string" || raw.length > MAX_EVIDENCE_CHARS) throw invalid("Invalid SNG evidence");
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    throw invalid("Invalid SNG evidence");
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw invalid("Invalid SNG evidence");
  const { weekId, expectedContentChecksum, sngArtifactId, sngRevision, sngAcceptanceId, sngAcceptedAt, attestedPublicationState, sourceReference, sourceObservedAt } =
    input as Record<string, unknown>;
  if (typeof weekId !== "string" || !weekId || weekId.length > MAX_ID) throw invalid("Invalid week");
  if (!isText(expectedContentChecksum, 128) || !isText(sngArtifactId, WAIVER_ARTIFACT_ID_MAX) || !isText(sngAcceptanceId, WAIVER_ARTIFACT_ID_MAX)) {
    throw invalid("Invalid SNG evidence");
  }
  if (!isText(attestedPublicationState, 32) || !isText(sourceReference, WAIVER_ARTIFACT_SOURCE_REFERENCE_MAX)) throw invalid("Invalid SNG evidence");
  const revision = parseRevision(sngRevision);
  if (revision === undefined) throw invalid("SNG revision must be a whole number");
  if (!isText(sngAcceptedAt, 64) || (sngAcceptedAt.trim() && !ISO_UTC.test(sngAcceptedAt.trim()))) {
    throw invalid("SNG acceptance time must be the exact ISO UTC value SNG shows (…Z)");
  }
  if (!isText(sourceObservedAt, 64)) throw invalid("Invalid observation time");
  const observedAt = sourceObservedAt.trim() ? parseWaiverObservedAt(sourceObservedAt) : null;
  if (sourceObservedAt.trim() && !observedAt) throw invalid("Observation time must be Chicago local (YYYY-MM-DDTHH:MM) or ISO with a zone");
  return {
    weekId,
    artifactText,
    evidence: {
      expectedContentChecksum,
      sngArtifactId,
      sngRevision: revision,
      sngAcceptanceId,
      sngAcceptedAt: sngAcceptedAt.trim() ? new Date(sngAcceptedAt.trim()) : null,
      attestedPublicationState,
      sourceReference,
      sourceObservedAt: observedAt,
    },
  };
}

/**
 * Handles one upload: same-origin + admin session checks before the body is
 * read, a capped body, strict multipart, bounded gunzip, then the read-only
 * preview or the transactional import. Import binds to the previewed content
 * (text SHA-256) and the preview fingerprint (content + evidence + history).
 */
export async function handleWaiverArtifactUpload(request: Request, mode: WaiverArtifactUploadMode): Promise<Response> {
  try {
    if (request.method !== "POST") throw new UploadRejection(405, "METHOD_NOT_ALLOWED", "POST only");
    assertSameOrigin(request);
    const contentType = request.headers.get("content-type") ?? "";
    if (!/^multipart\/form-data;\s*boundary=/i.test(contentType)) throw new UploadRejection(415, "UNSUPPORTED_MEDIA_TYPE", "Expected multipart/form-data");
    const adminUserId = await resolveAdminUserId();
    if (!adminUserId) throw new UploadRejection(403, "FORBIDDEN", "Admin access required");

    const form = await parseMultipart(await readCappedBody(request, WAIVER_ARTIFACT_UPLOAD_MAX_BYTES), contentType, mode);
    const file = form.get(WAIVER_ARTIFACT_UPLOAD_FIELDS.artifact);
    if (!file || typeof file === "string") throw invalid("The artifact file is required");
    const artifactText = decompressWaiverArtifact(new Uint8Array(await file.arrayBuffer()));
    const upload = parseWaiverArtifactEvidence(form.get(WAIVER_ARTIFACT_UPLOAD_FIELDS.evidence), artifactText);

    if (mode === "preview") {
      await assertWaiverArtifactAdmin(prisma, adminUserId);
      return respond(200, { ok: true, preview: await previewWaiverArtifactImport(upload) });
    }

    const previewFingerprint = form.get(WAIVER_ARTIFACT_UPLOAD_FIELDS.previewFingerprint);
    const previewTextSha256 = form.get(WAIVER_ARTIFACT_UPLOAD_FIELDS.previewTextSha256);
    const attested = form.get(WAIVER_ARTIFACT_UPLOAD_FIELDS.attested);
    if (typeof previewFingerprint !== "string" || !HEX64.test(previewFingerprint) || typeof previewTextSha256 !== "string" || !HEX64.test(previewTextSha256)) {
      throw invalid("Import requires the preview fingerprint and previewed content digest");
    }
    if (waiverArtifactTextSha256(artifactText) !== previewTextSha256) {
      throw new UploadRejection(409, "CONTENT_MISMATCH", "The uploaded artifact differs from the previewed artifact; preview again");
    }
    const result = await applyWaiverArtifactImport({ ...upload, adminUserId, previewFingerprint, attested: attested === "true" });
    return respond(200, {
      ok: true,
      artifactRowId: result.artifactRowId,
      artifactId: result.artifactId,
      revision: result.revision,
      alreadyImported: result.alreadyImported,
      importedAt: result.importedAt.toISOString(),
      supersededArtifactRowId: result.supersededArtifactRowId,
    });
  } catch (error) {
    if (error instanceof UploadRejection) return respond(error.status, { ok: false, code: error.code, error: error.message });
    if (error instanceof WaiverArtifactError) {
      return respond(ERROR_STATUS[error.code], { ok: false, code: error.code, error: error.message, details: error.details ?? null });
    }
    logServerEvent(`waivers.artifact_${mode}_failed`, {}, "error");
    return respond(500, { ok: false, code: "UNKNOWN", error: "Unexpected error; nothing was saved" });
  }
}

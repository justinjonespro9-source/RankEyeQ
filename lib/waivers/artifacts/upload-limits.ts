import { SNG_CANONICAL_MAX_ARTIFACT_CHARS } from "@/lib/waivers/canonical/contract";

/**
 * Canonical artifact upload transport, shared by the admin client and the
 * upload route. The artifact travels gzip-compressed (canonical JSON shrinks
 * ~7-8x) inside one multipart request whose total size stays under the
 * Vercel Function 4.5 MB request-body ceiling; it is never stored between
 * preview and import, so the client re-sends the same file to apply.
 */
export const WAIVER_ARTIFACT_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

/** Decompressed artifact bound: the canonical contract's own maximum. */
export const WAIVER_ARTIFACT_TEXT_MAX_BYTES = SNG_CANONICAL_MAX_ARTIFACT_CHARS;

export const WAIVER_ARTIFACT_UPLOAD_HEADER = "x-rankeyeq-upload";
export const WAIVER_ARTIFACT_UPLOAD_HEADER_VALUE = "sng-canonical-artifact/1";

export const WAIVER_ARTIFACT_PREVIEW_ROUTE = "/api/admin/waivers/artifacts/preview";
export const WAIVER_ARTIFACT_IMPORT_ROUTE = "/api/admin/waivers/artifacts/import";

/** Multipart field names. `artifact` is the gzip-compressed artifact text. */
export const WAIVER_ARTIFACT_UPLOAD_FIELDS = {
  artifact: "artifact",
  evidence: "evidence",
  previewFingerprint: "previewFingerprint",
  previewTextSha256: "previewTextSha256",
  attested: "attested",
} as const;

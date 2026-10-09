import { createHash } from "node:crypto";
import { assertAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { logServerEvent } from "@/lib/log";
import { assertWaiverAiAdmin, WaiverAiError } from "@/lib/waivers/ai/submissions";

/**
 * Read-only, admin-only download of the original provider file preserved on a
 * late-entry verification. Returns the exact stored bytes (re-checked against
 * the stored sha256 and length) as an attachment that is never rendered,
 * cached or shared. Writes nothing.
 */

const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Browser fetch metadata that may carry the admin session; anything cross-site is refused. */
const ALLOWED_FETCH_SITES = new Set(["same-origin", "none"]);

const refuse = (status: number, code: string, error: string) =>
  Response.json({ ok: false, code, error }, { status, headers: { "cache-control": "no-store, private", "x-content-type-options": "nosniff" } });

function contentDisposition(name: string): string {
  const fallback = name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "provider-file";
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

async function resolveAdminUserId(): Promise<string | null> {
  try {
    return (await assertAdmin()).user.id;
  } catch {
    return null;
  }
}

export async function handleWaiverAiProviderFileDownload(request: Request, verificationId: string): Promise<Response> {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && !ALLOWED_FETCH_SITES.has(fetchSite)) return refuse(403, "FORBIDDEN", "Cross-site requests are refused");
  const adminUserId = await resolveAdminUserId();
  if (!adminUserId) return refuse(403, "FORBIDDEN", "Admin access required");
  const evidenceId = new URL(request.url).searchParams.get("evidenceId");
  if (!ID.test(verificationId) || !evidenceId || !ID.test(evidenceId)) return refuse(400, "INVALID_INPUT", "Invalid request");

  try {
    await assertWaiverAiAdmin(prisma, adminUserId);
    const file = await prisma.waiverAiLateEntryVerification.findUnique({
      where: { id: verificationId },
      select: { evidenceId: true, sourceArtifact: true, sourceArtifactName: true, sourceArtifactSha256: true, sourceArtifactByteLength: true },
    });
    if (!file || file.evidenceId !== evidenceId) return refuse(404, "NOT_FOUND", "Verification not found for this evidence");
    if (!file.sourceArtifact || !file.sourceArtifactName || !file.sourceArtifactSha256 || file.sourceArtifactByteLength === null) {
      return refuse(404, "NOT_FOUND", "This verification has no provider file");
    }
    const bytes = new Uint8Array(file.sourceArtifact);
    if (bytes.byteLength !== file.sourceArtifactByteLength || createHash("sha256").update(bytes).digest("hex") !== file.sourceArtifactSha256) {
      logServerEvent("waivers.ai_provider_file_integrity_failed", { verificationId }, "error");
      return refuse(500, "INTEGRITY", "The stored provider file does not match its recorded fingerprint");
    }
    logServerEvent("waivers.ai_provider_file_downloaded", { verificationId, evidenceId, adminUserId });
    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(bytes.byteLength),
        "content-disposition": contentDisposition(file.sourceArtifactName),
        "cache-control": "no-store, private",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "x-rankeyeq-sha256": file.sourceArtifactSha256,
      },
    });
  } catch (error) {
    if (error instanceof WaiverAiError && error.code === "FORBIDDEN") return refuse(403, "FORBIDDEN", "Admin access required");
    logServerEvent("waivers.ai_provider_file_download_failed", {}, "error");
    return refuse(500, "UNKNOWN", "Unexpected error");
  }
}

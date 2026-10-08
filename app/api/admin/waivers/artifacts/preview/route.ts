import { handleWaiverArtifactUpload } from "@/lib/waivers/artifacts/upload";

/** Read-only canonical artifact preview (admin only). Writes nothing. */
export async function POST(request: Request) {
  return handleWaiverArtifactUpload(request, "preview");
}

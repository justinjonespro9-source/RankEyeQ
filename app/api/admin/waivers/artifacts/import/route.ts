import { handleWaiverArtifactUpload } from "@/lib/waivers/artifacts/upload";

/** Imports a previewed canonical artifact (admin only, operator-attested). Never grades. */
export async function POST(request: Request) {
  return handleWaiverArtifactUpload(request, "import");
}

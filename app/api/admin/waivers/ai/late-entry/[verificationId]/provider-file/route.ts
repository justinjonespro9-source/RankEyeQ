import { handleWaiverAiProviderFileDownload } from "@/lib/waivers/ai/provider-file";

/** Downloads a late-entry verification's original provider file (admin only, read-only, exact bytes). */
export async function GET(request: Request, { params }: { params: Promise<{ verificationId: string }> }) {
  const { verificationId } = await params;
  return handleWaiverAiProviderFileDownload(request, verificationId);
}

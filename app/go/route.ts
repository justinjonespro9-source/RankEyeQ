import { NextResponse } from "next/server";
import { trackEvent } from "@/lib/analytics";
import { isAllowedSponsorDestination } from "@/lib/sponsors/urls";

/**
 * Lightweight sponsor click redirect.
 * Query: p=placementKey, c=trackingSlug, id=campaignId, u=destinationUrl
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const placementKey = searchParams.get("p")?.trim() ?? "";
  const trackingSlug = searchParams.get("c")?.trim() ?? "";
  const campaignId = searchParams.get("id")?.trim() ?? "";
  const destination = searchParams.get("u")?.trim() ?? "";

  if (!destination || !isAllowedSponsorDestination(destination)) {
    return NextResponse.json(
      { error: "Invalid or disallowed destination" },
      { status: 400 },
    );
  }

  trackEvent("sponsor_click", {
    placementKey: placementKey || null,
    trackingSlug: trackingSlug || null,
    campaignId: campaignId || null,
    destinationHost: safeHost(destination),
  });

  return NextResponse.redirect(destination, 302);
}

function safeHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

import { NextResponse } from "next/server";
import { trackEvent } from "@/lib/analytics";
import { RATE_LIMITS, rateLimit, rateLimitErrorMessage } from "@/lib/rate-limit";
import { rateLimitKey } from "@/lib/request-ip";
import { isAllowedSponsorDestination } from "@/lib/sponsors/urls";

/**
 * Lightweight sponsor click redirect.
 * Query: p=placementKey, c=trackingSlug, id=campaignId, u=destinationUrl
 */
export async function GET(request: Request) {
  const limited = rateLimit({
    key: await rateLimitKey("sponsor-go"),
    ...RATE_LIMITS.sponsorGo,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: rateLimitErrorMessage(limited) },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.max(1, Math.ceil(limited.retryAfterMs / 1000))),
          "X-Robots-Tag": "noindex, nofollow",
        },
      },
    );
  }

  const { searchParams } = new URL(request.url);
  const placementKey = searchParams.get("p")?.trim() ?? "";
  const trackingSlug = searchParams.get("c")?.trim() ?? "";
  const campaignId = searchParams.get("id")?.trim() ?? "";
  const destination = searchParams.get("u")?.trim() ?? "";

  if (!destination || !isAllowedSponsorDestination(destination)) {
    return NextResponse.json(
      { error: "Invalid or disallowed destination" },
      {
        status: 400,
        headers: { "X-Robots-Tag": "noindex, nofollow" },
      },
    );
  }

  trackEvent("sponsor_click", {
    placementKey: placementKey || null,
    trackingSlug: trackingSlug || null,
    campaignId: campaignId || null,
    destinationHost: safeHost(destination),
  });

  const response = NextResponse.redirect(destination, 302);
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

function safeHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

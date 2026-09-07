import type {
  CreatorClaimStatus,
  ProfileType,
} from "@/lib/generated/prisma/client";

/**
 * RankEyeQ launch criteria for Creator verification (manual, discretionary):
 * - Legitimate public fantasy-football content presence
 * - Consistent fantasy analysis / rankings publishing
 * - Identifiable audience or recurring publishing history
 * - Participates on RankEyeQ
 * - Publicly connects their identity to RankEyeQ (receipt share, post, tag, profile link, etc.)
 * No hard follower minimum in V1.
 */
export const CREATOR_VERIFICATION_CRITERIA = [
  "Legitimate public fantasy-football content presence",
  "Publishes fantasy analysis or rankings consistently",
  "Identifiable audience or recurring publishing history",
  "Participates on RankEyeQ",
  "Publicly connects their identity to RankEyeQ",
] as const;

export const CREATOR_TRACKED_DISCLAIMER =
  "Tracked creator profiles may include rankings publicly posted before kickoff. Tracking does not imply endorsement or partnership.";

export const CREATOR_CLAIM_REVIEW_COPY =
  "Creator status is manually reviewed by RankEyeQ.";

export function isCreatorVerified(input: {
  profileType: ProfileType | null | undefined;
  claimStatus?: CreatorClaimStatus | null;
}): boolean {
  return (
    input.profileType === "CREATOR" && input.claimStatus === "VERIFIED"
  );
}

const MAX_URL_LENGTH = 500;
const MAX_HANDLE_LENGTH = 80;

/** Safe http(s) URL for claim form fields — no javascript: / data: schemes. */
export function validatePublicHttpUrl(
  raw: string,
  label = "URL",
): { ok: true; url: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: `${label} is required.` };
  }
  if (trimmed.length > MAX_URL_LENGTH) {
    return { ok: false, error: `${label} is too long.` };
  }
  if (/[\s<>"]/.test(trimmed)) {
    return { ok: false, error: `${label} contains invalid characters.` };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: `${label} must be a valid http(s) link.` };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: `${label} must use http or https.` };
  }
  if (!parsed.hostname.includes(".")) {
    return { ok: false, error: `${label} must include a valid host.` };
  }
  return { ok: true, url: parsed.toString() };
}

export function sanitizeSocialHandle(raw: string): string {
  return raw.trim().replace(/^@+/, "").slice(0, MAX_HANDLE_LENGTH);
}

/**
 * Shared avatar resolution for human identity surfaces.
 *
 * Precedence:
 * 1. UniversalProfile.avatarUrl — uploaded photo, or Google image seeded at setup
 * 2. oauthImageUrl — Auth.js User.image (Google) when profile avatar is cleared
 * 3. null — callers render initials
 *
 * Expert / Creator / AI profiles typically have neither; initials remain.
 */
export function resolveAvatarUrl(input: {
  avatarUrl?: string | null;
  oauthImageUrl?: string | null;
}): string | null {
  const custom = input.avatarUrl?.trim() || null;
  if (custom) return custom;
  const oauth = input.oauthImageUrl?.trim() || null;
  return oauth || null;
}

export function displayInitials(name: string) {
  const parts = name
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/** True when the stored profile URL looks like a RankEyeQ Blob upload. */
export function isUploadedAvatarUrl(url: string | null | undefined) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return (
      host.endsWith(".public.blob.vercel-storage.com") ||
      host.endsWith(".blob.vercel-storage.com")
    );
  } catch {
    return false;
  }
}

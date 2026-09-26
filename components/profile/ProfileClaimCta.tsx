import Link from "next/link";

/**
 * Subtle CTA for unclaimed Expert / Creator profiles.
 * Does not reveal private verification details.
 */
export function ProfileClaimCta({
  displayName,
  username,
  signedIn,
}: {
  displayName: string;
  username: string;
  signedIn: boolean;
}) {
  const href = signedIn
    ? `/account?claim=${encodeURIComponent(username)}`
    : `/signin?callbackUrl=${encodeURIComponent(`/account?claim=${username}`)}`;

  return (
    <p className="mt-6 rounded-md border border-dashed border-border bg-surface px-3 py-2 text-sm text-muted">
      Are you {displayName}?{" "}
      <Link href={href} className="font-medium text-accent-ink hover:underline">
        Claim this profile
      </Link>
      .
    </p>
  );
}

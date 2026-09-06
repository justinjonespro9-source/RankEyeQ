import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { ProfileAvatar } from "@/components/ui/ProfileAvatar";

export function ProfileLink({
  username,
  displayName,
  avatarUrl = null,
  isAi = false,
  isExpert = false,
  isCreator = false,
  expertPublisher = null,
  creatorBrand = null,
  showAvatar = true,
  className = "",
}: {
  username: string;
  displayName: string;
  /** Resolved public avatar URL (uploaded or Google-seeded). */
  avatarUrl?: string | null;
  isAi?: boolean;
  isExpert?: boolean;
  isCreator?: boolean;
  /** Publisher affiliation for Experts, e.g. "Yahoo Fantasy" → badge EXPERT · Yahoo Fantasy */
  expertPublisher?: string | null;
  /** Brand affiliation for Creators, e.g. "TCO Fantasy Show" → badge CREATOR · TCO Fantasy Show */
  creatorBrand?: string | null;
  showAvatar?: boolean;
  className?: string;
}) {
  const expertBadge =
    isExpert && expertPublisher?.trim()
      ? `EXPERT · ${expertPublisher.trim()}`
      : isExpert
        ? "Expert"
        : null;
  const creatorBadge =
    isCreator && creatorBrand?.trim()
      ? `CREATOR · ${creatorBrand.trim()}`
      : isCreator
        ? "Creator"
        : null;

  return (
    <Link
      href={`/profile/${username}`}
      className={`inline-flex min-w-0 items-center gap-2 hover:text-accent ${className}`}
    >
      {showAvatar ? (
        <ProfileAvatar name={displayName} src={avatarUrl} size="md" />
      ) : null}
      <span className="min-w-0">
        <span className="block truncate font-medium text-ink">{displayName}</span>
        <span className="block truncate text-xs text-muted">@{username}</span>
      </span>
      {isAi ? <Badge className="shrink-0">AI</Badge> : null}
      {expertBadge ? <Badge className="shrink-0">{expertBadge}</Badge> : null}
      {creatorBadge ? <Badge className="shrink-0">{creatorBadge}</Badge> : null}
    </Link>
  );
}

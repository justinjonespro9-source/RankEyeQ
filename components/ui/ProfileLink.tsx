import Link from "next/link";
import { Badge } from "@/components/ui/Badge";

function initials(name: string) {
  const parts = name.replace(/[^a-zA-Z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function ProfileLink({
  username,
  displayName,
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
        <span
          aria-hidden
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent"
        >
          {initials(displayName)}
        </span>
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

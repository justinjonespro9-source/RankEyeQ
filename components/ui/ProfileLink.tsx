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
  showAvatar = true,
  className = "",
}: {
  username: string;
  displayName: string;
  isAi?: boolean;
  isExpert?: boolean;
  showAvatar?: boolean;
  className?: string;
}) {
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
      {isExpert ? <Badge className="shrink-0">Expert</Badge> : null}
    </Link>
  );
}

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { ProfileAvatar } from "@/components/ui/ProfileAvatar";
import { competitorIdentityChip } from "@/lib/profile-labels";
import type { ProfileType } from "@/lib/generated/prisma/client";

export function ProfileLink({
  username,
  displayName,
  avatarUrl = null,
  profileType,
  isAi = false,
  isExpert = false,
  isCreator = false,
  expertPublisher = null,
  creatorBrand = null,
  aiModel = null,
  showAvatar = true,
  showIdentity = true,
  className = "",
}: {
  username: string;
  displayName: string;
  /** Resolved public avatar URL (uploaded or Google-seeded). */
  avatarUrl?: string | null;
  /** Preferred: explicit profile type for identity chips. */
  profileType?: ProfileType | null;
  isAi?: boolean;
  isExpert?: boolean;
  isCreator?: boolean;
  /** Publisher affiliation for Experts, e.g. "Yahoo Fantasy" → EXPERT · Yahoo Fantasy */
  expertPublisher?: string | null;
  /** Brand affiliation for Creators, e.g. "TCO Fantasy Show" → CREATOR · TCO Fantasy Show */
  creatorBrand?: string | null;
  /** Model name for AI competitors, e.g. "Claude" → AI · Claude */
  aiModel?: string | null;
  showAvatar?: boolean;
  /** When false, link is name-only (identity shown elsewhere). */
  showIdentity?: boolean;
  className?: string;
}) {
  const resolvedType: ProfileType | null | undefined =
    profileType ??
    (isAi
      ? "AI"
      : isExpert
        ? "BENCHMARK"
        : isCreator
          ? "CREATOR"
          : "HUMAN");

  const identity = showIdentity
    ? competitorIdentityChip({
        profileType: resolvedType,
        expertPublisher,
        creatorBrand,
        aiModel: aiModel ?? (resolvedType === "AI" ? displayName : null),
      })
    : null;

  return (
    <Link
      href={`/profile/${username}`}
      className={`inline-flex min-w-0 max-w-full items-center gap-2 hover:text-accent-ink ${className}`}
    >
      {showAvatar ? (
        <ProfileAvatar name={displayName} src={avatarUrl} size="md" />
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-ink">{displayName}</span>
        <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-xs text-muted">@{username}</span>
          {identity ? (
            <Badge
              tone={identity.tone}
              className="max-w-full shrink truncate text-[10px] leading-tight sm:text-xs"
              title={identity.label}
            >
              {identity.label}
            </Badge>
          ) : null}
        </span>
      </span>
    </Link>
  );
}

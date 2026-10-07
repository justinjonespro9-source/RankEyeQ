import Link from "next/link";
import type { ReactNode } from "react";
import { FollowButton } from "@/components/social/FollowButton";
import { Badge } from "@/components/ui/Badge";
import { ProfileAvatar } from "@/components/ui/ProfileAvatar";
import type { ProfileType } from "@/lib/generated/prisma/client";
import { competitorIdentityChip } from "@/lib/profile-labels";
import type { FollowControl } from "@/lib/social/follow-eligibility";

export type LeaderboardIdentityProfile = {
  universalProfileId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  profileType: ProfileType;
  expertPublisher: string | null;
  expertSourceKind: string | null;
  creatorBrand: string | null;
};

/**
 * Competitor identity for every leaderboard row: name, then @handle, profile
 * chip and Follow on one line. Follow lives here — never in the metrics area.
 */
export function LeaderboardIdentity({
  profile,
  follow,
  children,
}: {
  profile: LeaderboardIdentityProfile;
  follow: { control: FollowControl; initialFollowing: boolean } | null;
  children?: ReactNode;
}) {
  const href = `/profile/${profile.username}`;
  const chip = competitorIdentityChip({
    profileType: profile.profileType,
    expertPublisher: profile.expertPublisher,
    expertSourceKind: profile.expertSourceKind,
    creatorBrand: profile.creatorBrand,
    aiModel: profile.profileType === "AI" ? profile.displayName : null,
  });
  const control = follow?.control ?? "hidden";

  return (
    <div className="flex min-w-0 flex-1 items-start gap-3" data-leaderboard-identity>
      <Link href={href} className="shrink-0" tabIndex={-1} aria-hidden>
        <ProfileAvatar name={profile.displayName} src={profile.avatarUrl} size="md" />
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={href} className="block truncate font-medium text-ink hover:text-accent-ink">
          {profile.displayName}
        </Link>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Link href={href} className="truncate text-xs text-muted hover:text-accent-ink">
            @{profile.username}
          </Link>
          <Badge tone={chip.tone} className="max-w-full shrink truncate text-[10px] leading-tight sm:text-xs" title={chip.label}>
            {chip.label}
          </Badge>
          {control !== "hidden" ? (
            <FollowButton
              targetProfileId={profile.universalProfileId}
              initialFollowing={follow?.initialFollowing ?? false}
              signedIn={control === "follow"}
              size="xs"
              align="start"
            />
          ) : null}
        </div>
        {children ? <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">{children}</div> : null}
      </div>
    </div>
  );
}

import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { LeaderboardIdentity } from "@/components/leaderboards/LeaderboardIdentity";
import { LeaderboardRowMetrics } from "@/components/leaderboards/LeaderboardRowMetrics";
import { WaiverRowMetrics } from "@/components/leaderboards/WaiverRowMetrics";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import type { LeaderboardCompetitorIdentity, LeaderboardRow } from "@/lib/leaderboards";
import type { FollowControl } from "@/lib/social/follow-eligibility";
import type { WaiverLeaderboardRow } from "@/lib/waivers/leaderboard-model";

/** One follow lookup shared by every discipline's rows. */
export type RowFollow = (
  profile: Pick<LeaderboardCompetitorIdentity, "universalProfileId" | "profileType" | "expertSourceKind">,
) => {
  control: FollowControl;
  initialFollowing: boolean;
};

const ROW_CLASS =
  "flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between";

function RankCell({ rank }: { rank: number | null }) {
  return (
    <span className="font-display mt-2 w-7 shrink-0 text-center text-base font-semibold tabular-nums text-ink sm:w-8">
      {rank ?? "—"}
    </span>
  );
}

export function BoardTable({
  rows,
  follow,
  followerCounts,
  viewCard,
}: {
  rows: LeaderboardRow[];
  follow: RowFollow;
  followerCounts: Map<string, number>;
  /** Position weekly boards only — never Overall. */
  viewCard?: {
    weekNumber: number;
    position: ContestPosition;
  } | null;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No graded contests yet"
        description="Leaderboards fill in after contests are graded. Contests played will stay visible for thin samples."
        actionHref="/rank"
        actionLabel="Build rankings"
      />
    );
  }

  return (
    <ol className="divide-y divide-border">
      {rows.map((entry) => {
        const cardHref =
          viewCard != null
            ? `/profile/${entry.username}/rankings/${viewCard.weekNumber}/${viewCard.position.toLowerCase()}`
            : null;
        return (
          <li key={entry.universalProfileId} className={ROW_CLASS}>
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <RankCell rank={entry.rank} />
              <LeaderboardIdentity profile={entry} follow={follow(entry)}>
                {entry.profileType === "HUMAN" ? (
                  <p className="text-xs text-muted">
                    {followerCounts.get(entry.universalProfileId) ?? 0} followers
                  </p>
                ) : null}
                {cardHref ? (
                  <Link
                    href={cardHref}
                    className="text-xs font-medium text-accent-ink hover:underline"
                  >
                    View Card
                  </Link>
                ) : null}
              </LeaderboardIdentity>
            </div>
            <div className="w-full min-w-0 sm:w-auto sm:shrink-0">
              <LeaderboardRowMetrics row={entry} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function WaiverBoardTable({
  rows,
  identities,
  follow,
}: {
  rows: WaiverLeaderboardRow[];
  identities: Map<string, LeaderboardCompetitorIdentity>;
  follow: RowFollow;
}) {
  return (
    <ol className="divide-y divide-border">
      {rows.map((row) => {
        const identity = identities.get(row.universalProfileId);
        if (!identity) return null;
        return (
          <li key={row.universalProfileId} className={ROW_CLASS}>
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <RankCell rank={row.rank} />
              <LeaderboardIdentity profile={identity} follow={follow(identity)} />
            </div>
            <div className="w-full min-w-0 sm:w-auto sm:shrink-0">
              <WaiverRowMetrics row={row} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

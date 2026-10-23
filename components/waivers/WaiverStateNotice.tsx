import Link from "next/link";
import type { WaiverPosition } from "@/lib/waivers/constants";
import {
  WAIVER_PLAY_STATE_COPY,
  waiverLeaderboardHref,
  type WaiverPlayState,
} from "@/lib/waivers/play-model";

const TITLES: Record<keyof typeof WAIVER_PLAY_STATE_COPY, string> = {
  NO_WEEK: "No Waivers week yet",
  POOL_PREPARING: "Pool in progress",
  POOL_READY: "Pool frozen",
  NO_PLAYERS: "No eligible players",
  NO_CONTEST: "No contest held",
};

/** Non-playable states. OPEN/LOCKED render the workspace instead. */
export function WaiverStateNotice({
  state,
  position,
  weekLabel,
  weekNumber,
  weekPublished,
}: {
  state: WaiverPlayState;
  position: WaiverPosition;
  weekLabel?: string | null;
  weekNumber?: number | null;
  weekPublished?: boolean;
}) {
  if (state === "OPEN" || state === "LOCKED") return null;
  const title =
    state === "NO_CONTEST" && weekLabel
      ? `${weekLabel} · No contest held`
      : TITLES[state];
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface px-5 py-10 text-center" role="status">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
        {position} · {title}
      </p>
      <p className="mx-auto mt-2 max-w-md font-display text-lg font-semibold text-ink">{WAIVER_PLAY_STATE_COPY[state]}</p>
      {weekPublished && weekNumber != null ? (
        <p className="mt-4 text-sm">
          <Link
            href={waiverLeaderboardHref({ weekNumber })}
            className="font-medium text-accent-ink underline-offset-2 hover:underline"
          >
            View Week {weekNumber} WaiverEyeQ leaderboard
          </Link>
        </p>
      ) : null}
    </div>
  );
}

import type { WaiverPosition } from "@/lib/waivers/constants";
import { WAIVER_PLAY_STATE_COPY, type WaiverPlayState } from "@/lib/waivers/play-model";

const TITLES: Record<keyof typeof WAIVER_PLAY_STATE_COPY, string> = {
  NO_WEEK: "No Waivers week yet",
  POOL_PREPARING: "Pool in progress",
  POOL_READY: "Pool frozen",
  NO_PLAYERS: "No eligible players",
};

/** Non-playable states. OPEN/LOCKED render the workspace instead. */
export function WaiverStateNotice({ state, position }: { state: WaiverPlayState; position: WaiverPosition }) {
  if (state === "OPEN" || state === "LOCKED") return null;
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface px-5 py-10 text-center" role="status">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
        {position} · {TITLES[state]}
      </p>
      <p className="mx-auto mt-2 max-w-md font-display text-lg font-semibold text-ink">{WAIVER_PLAY_STATE_COPY[state]}</p>
    </div>
  );
}

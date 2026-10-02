import Link from "next/link";
import type { WaiverPlayTab } from "@/lib/waivers/play-queries";
import type { WaiverPosition } from "@/lib/waivers/constants";
import { WAIVER_VIEWER_STATUS_LABEL, waiverPlayHref, type WaiverPlayState } from "@/lib/waivers/play-model";

const STATE_LABEL: Record<WaiverPlayState, string> = {
  NO_WEEK: "Not open",
  POOL_PREPARING: "Preparing",
  POOL_READY: "Not open",
  NO_PLAYERS: "No pool",
  OPEN: "Open",
  LOCKED: "Locked",
};

function tabStatus(tab: WaiverPlayTab): string {
  if (tab.viewerStatus && tab.viewerStatus !== "NONE") {
    if (tab.viewerStatus === "MISSED") return "Locked";
    return WAIVER_VIEWER_STATUS_LABEL[tab.viewerStatus].split(" — ")[0];
  }
  return STATE_LABEL[tab.state];
}

export function WaiverPositionTabs({ tabs, selected }: { tabs: WaiverPlayTab[]; selected: WaiverPosition }) {
  return (
    <nav aria-label="Waiver positions" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-2">
        {tabs.map((tab) => {
          const active = tab.position === selected;
          const status = tabStatus(tab);
          const done = tab.viewerStatus === "SUBMITTED" || tab.viewerStatus === "ABSTAINED" || tab.viewerStatus === "LOCKED_IN" || tab.viewerStatus === "LOCKED_ABSTAINED";
          return (
            <li key={tab.position}>
              <Link
                href={waiverPlayHref(tab.position)}
                aria-current={active ? "page" : undefined}
                aria-label={`${tab.position} — ${status}`}
                className={`flex min-h-12 min-w-[4.5rem] flex-col items-center justify-center rounded-md border px-3 py-1.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  active
                    ? "border-ink/60 bg-surface-elevated text-ink shadow-sm"
                    : "border-border bg-surface text-muted hover:border-ink/30 hover:text-ink"
                }`}
              >
                <span className="font-display text-sm font-semibold">{tab.position}</span>
                <span className="text-[11px] leading-tight">
                  {done ? <span aria-hidden="true">✓ </span> : null}
                  {status}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

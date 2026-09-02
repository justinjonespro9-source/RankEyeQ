import { Suspense } from "react";
import { LEADERBOARDS_SUBNAV } from "@/lib/navigation";
import { SectionSubnav } from "./SectionSubnav";

export function LeaderboardsSubnav() {
  return (
    <Suspense fallback={<div className="mb-6 h-10" aria-hidden />}>
      <SectionSubnav links={LEADERBOARDS_SUBNAV} ariaLabel="Leaderboards" />
    </Suspense>
  );
}

import type { Metadata } from "next";
import { Container } from "@/components/layout/Container";
import { WaiverConsensusPanel } from "@/components/waivers/WaiverConsensusPanel";
import { WaiverPositionTabs } from "@/components/waivers/WaiverPositionTabs";
import { WaiversHeader } from "@/components/waivers/WaiversHeader";
import { WaiverStateNotice } from "@/components/waivers/WaiverStateNotice";
import { WaiversWorkspace, type WaiverParticipation } from "@/components/waivers/WaiversWorkspace";
import { canSubmitFromRankingWorkspace } from "@/lib/auth/participation";
import { getAuthContext } from "@/lib/auth/session";
import { privatePageMetadata } from "@/lib/seo";
import { formatInChicago } from "@/lib/timing/chicago";
import { parseWaiverPlayPosition } from "@/lib/waivers/play-model";
import { loadWaiverPlayPage } from "@/lib/waivers/play-queries";

export const metadata: Metadata = privatePageMetadata(
  "Waivers",
  "RankEyeQ Waivers: call this week's best low-owned fantasy players from the official waiver pool before the Tuesday lock.",
);

export const dynamic = "force-dynamic";

const LOCK_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
};

export default async function WaiversPage(props: PageProps<"/waivers">) {
  const searchParams = await props.searchParams;
  const position = parseWaiverPlayPosition(searchParams.position);

  const ctx = await getAuthContext();
  const profile = ctx?.universalProfile ?? null;
  const participation: WaiverParticipation = !ctx
    ? "signed-out"
    : !profile
      ? "needs-setup"
      : profile.status !== "ACTIVE"
        ? "suspended"
        : canSubmitFromRankingWorkspace(profile.profileType)
          ? "ready"
          : "view-only";

  const view = await loadWaiverPlayPage({ position, viewerProfileId: profile?.id ?? null });
  const { selected } = view;
  const locksAt = selected.locksAt ? new Date(selected.locksAt) : null;
  const lockLabel = locksAt ? formatInChicago(locksAt, LOCK_FORMAT) : null;
  const snapshotLabel = selected.snapshot
    ? formatInChicago(new Date(selected.snapshot.observedAt), LOCK_FORMAT)
    : null;
  const pool = selected.pool.map((entry) => ({
    ...entry,
    kickoffLabel: entry.kickoffAt
      ? formatInChicago(new Date(entry.kickoffAt), { weekday: "short", hour: "numeric", minute: "2-digit" })
      : null,
  }));
  const showWorkspace = selected.contestId !== null && (selected.state === "OPEN" || selected.state === "LOCKED");

  return (
    <Container className="py-8 sm:py-12">
      <WaiversHeader weekLabel={view.week?.label ?? null} />

      <WaiverPositionTabs tabs={view.tabs} selected={position} />

      <section aria-labelledby="waiver-position-heading" className="mt-6">
        <h2 id="waiver-position-heading" className="sr-only">
          {position} Waiver board
        </h2>
        {showWorkspace && selected.contestId && locksAt && lockLabel ? (
          <WaiversWorkspace
            key={`${selected.contestId}:${selected.state}:${selected.board?.status ?? "NONE"}:${selected.board?.revisionNumber ?? 0}`}
            position={position}
            contestId={selected.contestId}
            locked={selected.state === "LOCKED"}
            locksAt={locksAt.toISOString()}
            lockLabel={lockLabel}
            serverNow={view.now}
            availableSlots={selected.availableSlots}
            pool={pool}
            board={selected.board}
            participation={participation}
            snapshotLabel={snapshotLabel}
            snapshotSource={selected.snapshot?.sourceLabel ?? null}
          />
        ) : (
          <WaiverStateNotice state={selected.state} position={position} />
        )}
        {selected.state === "LOCKED" ? (
          <WaiverConsensusPanel position={position} consensus={selected.consensus} />
        ) : null}
      </section>
    </Container>
  );
}

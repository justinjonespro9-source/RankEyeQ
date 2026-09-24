import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Container } from "@/components/layout/Container";
import {
  MyRanksDashboard,
  MyRanksPositionTabs,
  MyRanksWeekTabs,
} from "@/components/my-ranks/MyRanksDashboard";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { requireAuthContext } from "@/lib/auth/session";
import { isPosition } from "@/lib/contest";
import { toDbPosition } from "@/lib/contest-defaults";
import {
  getMyRanksPositionDashboard,
  getMyRanksWeekContext,
} from "@/lib/my-ranks";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import { privatePageMetadata } from "@/lib/seo";

export const metadata: Metadata = privatePageMetadata(
  "My Ranks",
  "Your submitted weekly rankings with live fantasy standings and provisional EYEQ.",
);

export const dynamic = "force-dynamic";

export default async function MyRanksPage({
  searchParams,
}: {
  searchParams: Promise<{ position?: string; weekId?: string }>;
}) {
  const ctx = await requireAuthContext();
  if (!ctx.universalProfile) {
    redirect("/account/setup");
  }

  const params = await searchParams;
  const weekContext = await getMyRanksWeekContext({
    universalProfileId: ctx.universalProfile.id,
    weekId: params.weekId ?? null,
  });
  if (!weekContext) {
    return (
      <Container className="py-12 sm:py-16">
        <SectionHeading
          eyebrow="My Ranks"
          title="My Ranks"
          description="Live weekly command center for your submitted boards."
        />
        <EmptyState
          title="No active NFL week"
          description="An active season week is required before live rankings appear."
          actionHref="/rank"
          actionLabel="This Week"
        />
      </Container>
    );
  }

  const positionParam = params.position?.toLowerCase() ?? "qb";
  const position: ContestPosition = isPosition(positionParam)
    ? toDbPosition(positionParam)
    : "QB";

  const dashboard = await getMyRanksPositionDashboard({
    universalProfileId: ctx.universalProfile.id,
    position,
    weekId: weekContext.weekId,
  });

  if (!dashboard) {
    return (
      <Container className="py-12 sm:py-16">
        <SectionHeading
          eyebrow="My Ranks"
          title="My Ranks"
          description="Live weekly command center for your submitted boards."
        />
        <EmptyState
          title="Position unavailable"
          description="Could not load this position for the current week."
          actionHref="/rank"
          actionLabel="This Week"
        />
      </Container>
    );
  }

  const isActiveWeek = dashboard.weekId === weekContext.activeWeekId;
  const description = dashboard.isFinal
    ? `Historical ${dashboard.weekLabel} · ${dashboard.position} — scored/effective board (read-only).`
    : isActiveWeek
      ? "Submitted boards, live positional standings, and the perfect board right now — unofficial until the week is final."
      : `${dashboard.weekLabel} · ${dashboard.position} — live/unofficial tracking.`;

  return (
    <Container className="py-12 sm:py-16">
      <SectionHeading
        eyebrow="My Ranks"
        title={`${dashboard.weekLabel} · ${dashboard.position}`}
        description={description}
        action={
          <Link
            href="/rank"
            className="text-sm font-medium text-accent-ink hover:underline"
          >
            This Week
          </Link>
        }
      />

      <MyRanksWeekTabs
        weeks={weekContext.weeks}
        activeWeekId={dashboard.weekId}
        position={dashboard.position}
      />

      <MyRanksPositionTabs
        active={dashboard.position}
        weekId={dashboard.weekId}
      />

      <MyRanksDashboard
        dashboard={dashboard}
        isActiveWeek={isActiveWeek}
      />
    </Container>
  );
}

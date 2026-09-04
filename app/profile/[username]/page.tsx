import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/layout/Container";
import { ProfileHeader } from "@/components/profile/ProfileHeader";
import { ProfileProductSections } from "@/components/profile/ProfileProductSections";
import { Badge } from "@/components/ui/Badge";
import { trackEvent } from "@/lib/analytics";
import { getAuthContext, isAdminRole } from "@/lib/auth/session";
import {
  isAdminTestPreviewRequested,
  resolveIncludeTestWeeks,
} from "@/lib/admin/test-preview";
import { PUBLIC_INDEX } from "@/lib/seo";
import { getRankIQProfileView } from "@/lib/profile-stats";
import { getProfileCurrentWeekBoardSummaries } from "@/lib/public-board";
import { evaluateProfileQualification } from "@/lib/social/creator";
import { getFollowCounts, isFollowing } from "@/lib/social/follows";
import { buildProfileOverview } from "@/lib/profile-modules";
import { prisma } from "@/lib/db";
import type { ProductKey, UniversalProfile } from "@/types/user";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  props: PageProps<"/profile/[username]">,
): Promise<Metadata> {
  const { username } = await props.params;
  const view = await getRankIQProfileView(username);
  return {
    title: view?.displayName ?? username,
    description: `RankEyeQ profile for ${view?.displayName ?? username} — weekly contest EYEQ stats, position ranks, and recent NFL-week results.`,
    ...PUBLIC_INDEX,
  };
}

export default async function ProfilePage(
  props: PageProps<"/profile/[username]">,
) {
  const { username } = await props.params;
  const searchParams = await props.searchParams;
  const tabParam = searchParams?.tab;
  const initialTab =
    typeof tabParam === "string" &&
    ["overview", "rankiq", "handicap-hero", "fantasytrack"].includes(tabParam)
      ? (tabParam as ProductKey)
      : "overview";

  const authCtx = await getAuthContext();
  const includeTest = resolveIncludeTestWeeks({
    isAdmin: authCtx?.user?.role ? isAdminRole(authCtx.user.role) : false,
    adminTestPreview: isAdminTestPreviewRequested(
      typeof searchParams === "object" && searchParams
        ? (searchParams as Record<string, string | undefined>)
        : undefined,
    ),
  });

  const view = await getRankIQProfileView(username, { includeTest });
  if (!view) notFound();

  const viewerProfile = authCtx?.universalProfile ?? null;
  const isOwner =
    viewerProfile?.id != null && viewerProfile.id === view.profileId;
  const isAdmin = authCtx?.user.role === "ADMIN";

  const profileRecord = await prisma.universalProfile.findUnique({
    where: { username },
    select: { publicVisible: true, bio: true },
  });
  if (profileRecord && !profileRecord.publicVisible && !isOwner && !isAdmin) {
    notFound();
  }

  trackEvent("ranker_profile_viewed", { contestsPlayed: view.contestsPlayed });
  const [followCounts, viewerIsFollowing, qualification, weekBoards] =
    await Promise.all([
      getFollowCounts(view.profileId),
      viewerProfile
        ? isFollowing(viewerProfile.id, view.profileId)
        : Promise.resolve(false),
      evaluateProfileQualification(view.profileId),
      getProfileCurrentWeekBoardSummaries({
        username: view.username,
        viewer: {
          profileId: viewerProfile?.id ?? null,
          isAdmin: authCtx?.user.role === "ADMIN",
        },
      }),
    ]);

  const profile: UniversalProfile = {
    universalUserId: view.universalUserId,
    username: view.username,
    displayName: view.displayName,
    isBot: view.profileType === "AI",
    isBenchmark: view.profileType === "BENCHMARK",
    suspended: view.status === "SUSPENDED",
    expertAnalystName: view.expertAnalystName,
    expertPublicationName: view.expertPublicationName,
    bio:
      profileRecord?.bio ??
      (view.status === "SUSPENDED"
        ? "This profile is unavailable."
        : view.profileType === "AI"
          ? "AI competitor — rankings are submitted through RankEyeQ's administrative workflow."
          : view.profileType === "BENCHMARK"
            ? "Independent RankEyeQ Expert."
            : undefined),
    rankiq: view.stats,
  };

  const overview = await buildProfileOverview({
    profileId: view.profileId,
    username: view.username,
    rankiqContestsPlayed: view.contestsPlayed,
    recentHistory: view.history.slice(0, 5).map((item) => ({
      weekLabel: item.weekLabel,
      position: item.position,
      normalizedScore: item.normalizedScore,
      href: `/profile/${view.username}/rankings/${item.weekNumber}/${item.position.toLowerCase()}`,
    })),
  });

  return (
    <Container className="py-12 sm:py-16">
      <ProfileHeader
        profile={profile}
        isOwner={isOwner}
        followerCount={followCounts.followers}
        followingCount={followCounts.following}
        follow={{
          signedIn: Boolean(authCtx),
          viewerIsFollowing,
          canFollow:
            !isOwner &&
            view.status !== "SUSPENDED" &&
            view.profileType !== "BENCHMARK" &&
            viewerProfile?.profileType === "HUMAN",
          targetProfileId: view.profileId,
        }}
        creator={{
          enabled: qualification.status === "ENABLED",
          qualified:
            qualification.status === "ELIGIBLE" ||
            qualification.status === "ENABLED",
        }}
      />

      {weekBoards.length > 0 ? (
        <section className="mt-6 rounded-lg border border-border bg-surface-elevated p-5">
          <h2 className="font-display text-lg font-semibold text-ink">
            Current week boards
          </h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {weekBoards.map((board) => (
              <li key={board.position}>
                <Link
                  href={`/profile/${view.username}/rankings/${board.weekNumber}/${board.position.toLowerCase()}`}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm hover:border-ink/30"
                >
                  <span className="font-medium text-ink">{board.position}</span>
                  {board.gatedPremium ? (
                    <Badge tone="warning">Premium before noon</Badge>
                  ) : board.allowed ? (
                    <Badge tone="success">View board</Badge>
                  ) : (
                    <Badge tone="neutral">Locked</Badge>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Suspense fallback={<div className="mt-8 text-sm text-muted">Loading profile…</div>}>
        <ProfileProductSections
          profile={profile}
          overview={overview}
          history={view.history}
          contestsPlayed={view.contestsPlayed}
          initialTab={initialTab}
        />
      </Suspense>
    </Container>
  );
}

import { Container } from "@/components/layout/Container";
import { AdPlacement } from "@/components/sponsors/AdPlacement";
import { ProfileHeader } from "@/components/profile/ProfileHeader";
import { ProfileProductSections } from "@/components/profile/ProfileProductSections";
import { CurrentWeekBoardsSection } from "@/components/profile/CurrentWeekBoardsSection";
import { trackEvent } from "@/lib/analytics";
import { getAuthContext, isAdminRole } from "@/lib/auth/session";
import {
  isAdminTestPreviewRequested,
  resolveIncludeTestWeeks,
} from "@/lib/admin/test-preview";
import { getCompetitorBadgesForProfile } from "@/lib/badges";
import {
  NO_INDEX,
  publicPageMetadata,
} from "@/lib/seo";
import { getRankIQProfileView } from "@/lib/profile-stats";
import { getProfileCurrentWeekBoardSummaries } from "@/lib/public-board";
import { evaluateProfileQualification } from "@/lib/social/creator";
import { getFollowCounts, isFollowing } from "@/lib/social/follows";
import { buildProfileOverview } from "@/lib/profile-modules";
import { prisma } from "@/lib/db";
import type { ProductKey, UniversalProfile } from "@/types/user";
import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  props: PageProps<"/profile/[username]">,
): Promise<Metadata> {
  const { username } = await props.params;
  const view = await getRankIQProfileView(username);
  if (!view) {
    return { title: "Profile", ...NO_INDEX };
  }

  const visibility = await prisma.universalProfile.findUnique({
    where: { username: view.username },
    select: { publicVisible: true },
  });
  if (visibility && !visibility.publicVisible) {
    return {
      title: view.displayName,
      description: "Private RankEyeQ profile.",
      ...NO_INDEX,
    };
  }

  const name = view.displayName;
  return publicPageMetadata({
    title: `${name} Fantasy Rankings & EYEQ Score`,
    description: `${name} on RankEyeQ — weekly fantasy rankings, EYEQ Score, and contest results versus the Public, Experts, Creators, and AI.`,
    path: `/profile/${view.username}`,
  });
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
  const [followCounts, viewerIsFollowing, qualification, weekBoards, badges] =
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
      getCompetitorBadgesForProfile({
        profileId: view.profileId,
        profileType: view.profileType,
        stats: view.stats,
        history: view.history,
        includeTest,
      }),
    ]);

  const profile: UniversalProfile = {
    universalUserId: view.universalUserId,
    username: view.username,
    displayName: view.displayName,
    avatarUrl: view.avatarUrl,
    isBot: view.profileType === "AI",
    isBenchmark: view.profileType === "BENCHMARK",
    isCreator: view.profileType === "CREATOR",
    suspended: view.status === "SUSPENDED",
    expertAnalystName: view.expertAnalystName,
    expertPublicationName: view.expertPublicationName,
    creatorPersonName: view.creatorPersonName,
    creatorBrandName: view.creatorBrandName,
    creatorVerified: view.creatorVerified,
    bio:
      profileRecord?.bio ??
      (view.status === "SUSPENDED"
        ? "This profile is unavailable."
        : view.profileType === "AI"
          ? "AI competitor — rankings are submitted through RankEyeQ's administrative workflow."
          : view.profileType === "BENCHMARK"
            ? "Independent RankEyeQ Expert."
            : view.profileType === "CREATOR"
              ? "Independent RankEyeQ Creator competitor."
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
            view.profileType !== "CREATOR" &&
            viewerProfile?.profileType === "HUMAN",
          targetProfileId: view.profileId,
        }}
        creator={{
          enabled: qualification.status === "ENABLED",
          qualified:
            qualification.status === "ELIGIBLE" ||
            qualification.status === "ENABLED",
        }}
        badges={badges}
      />

      <CurrentWeekBoardsSection
        username={view.username}
        weekBoards={weekBoards}
        isOwner={isOwner}
      />

      <Suspense fallback={<div className="mt-8 text-sm text-muted">Loading profile…</div>}>
        <ProfileProductSections
          profile={profile}
          overview={overview}
          history={view.history}
          contestsPlayed={view.contestsPlayed}
          weekBoards={weekBoards}
          initialTab={initialTab}
        />
      </Suspense>

      <AdPlacement placementKey="profile_footer" className="mt-10 sm:mt-12" />
    </Container>
  );
}

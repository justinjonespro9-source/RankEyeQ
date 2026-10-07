import { Container } from "@/components/layout/Container";
import { AdPlacement } from "@/components/sponsors/AdPlacement";
import { ProfileHeader } from "@/components/profile/ProfileHeader";
import { ProfileProductSections } from "@/components/profile/ProfileProductSections";
import { CurrentWeekBoardsSection } from "@/components/profile/CurrentWeekBoardsSection";
import { SeasonStanding } from "@/components/profile/SeasonStanding";
import { TrophyCase } from "@/components/profile/TrophyCase";
import { ResumeStats } from "@/components/profile/ResumeStats";
import { trackEvent } from "@/lib/analytics";
import { getAuthContext, isAdminRole } from "@/lib/auth/session";
import {
  isAdminTestPreviewRequested,
  resolveIncludeTestWeeks,
} from "@/lib/admin/test-preview";
import { isOfficialBenchmarkUsername } from "@/lib/benchmark-sources";
import {
  NO_INDEX,
  publicPageMetadata,
} from "@/lib/seo";
import {
  EXPERT_SOURCE_KIND,
  formatBenchmarkScoringDisclosure,
  isPublisherConsensusSource,
} from "@/lib/expert-identity";
import { getRankIQProfileView } from "@/lib/profile-stats";
import { getCompetitiveResume } from "@/lib/competitive-resume-data";
import { profileBoardHref } from "@/lib/board-routes";
import { getProfileCurrentWeekBoardSummaries } from "@/lib/public-board";
import { evaluateProfileQualification } from "@/lib/social/creator";
import { getFollowCounts, isFollowing } from "@/lib/social/follows";
import { followControlFor } from "@/lib/social/follow-eligibility";
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
  const visibility = await prisma.universalProfile.findUnique({
    where: { username },
    select: {
      publicVisible: true,
      competitorActive: true,
      profileType: true,
      expertSource: { select: { sourceKind: true } },
    },
  });
  if (
    visibility &&
    !visibility.publicVisible &&
    (visibility.profileType === "BENCHMARK" ||
      visibility.profileType === "CREATOR" ||
      visibility.profileType === "AI")
  ) {
    return { title: "Profile", ...NO_INDEX };
  }

  const view = await getRankIQProfileView(username);
  if (!view) {
    return { title: "Profile", ...NO_INDEX };
  }

  if (visibility && !visibility.publicVisible) {
    return {
      title: "Profile",
      description: "Private RankEyeQ profile.",
      ...NO_INDEX,
    };
  }

  const sourceKind = visibility?.expertSource?.sourceKind ?? null;
  const isIndexableBenchmark =
    visibility?.profileType === "BENCHMARK" &&
    visibility.publicVisible &&
    visibility.competitorActive &&
    !isOfficialBenchmarkUsername(view.username) &&
    (sourceKind === EXPERT_SOURCE_KIND.ANALYST ||
      isPublisherConsensusSource(sourceKind));

  const isLegacyPublisherShell =
    visibility?.profileType === "BENCHMARK" && !isIndexableBenchmark;

  if (isLegacyPublisherShell) {
    return {
      title: view.displayName,
      description:
        "Legacy RankEyeQ publisher shell — not an active Expert or Publisher Consensus competitor.",
      ...NO_INDEX,
    };
  }

  const name = view.displayName;
  const classLabel = isPublisherConsensusSource(sourceKind)
    ? "Publisher Consensus"
    : visibility?.profileType === "BENCHMARK"
      ? "Expert"
      : visibility?.profileType === "CREATOR"
        ? "Creator"
        : null;
  const headline = view.headline?.trim();
  const verified =
    view.ownershipVerified || view.creatorVerified
      ? "Verified "
      : "";
  const identityBit = headline
    ? headline
    : classLabel
      ? `${verified}${classLabel}`
      : "fantasy rankings competitor";

  return publicPageMetadata({
    title: `${name} — RankEyeQ`,
    absoluteTitle: true,
    description: `${name} on RankEyeQ — ${identityBit}. Weekly fantasy rankings, Season EyeQ, and contest results versus the Public, Experts, Creators, and AI.`,
    path: `/profile/${view.username}`,
  });
}

export default async function ProfilePage(
  props: PageProps<"/profile/[username]">,
) {
  const { username } = await props.params;
  const searchParams = await props.searchParams;
  const tabParam = searchParams?.tab;
  const requestedTab =
    typeof tabParam === "string" &&
    ["overview", "rankiq", "handicap-hero", "fantasytrack"].includes(tabParam)
      ? (tabParam as ProductKey)
      : null;

  const authCtx = await getAuthContext();
  const includeTest = resolveIncludeTestWeeks({
    isAdmin: authCtx?.user?.role ? isAdminRole(authCtx.user.role) : false,
    adminTestPreview: isAdminTestPreviewRequested(
      typeof searchParams === "object" && searchParams
        ? (searchParams as Record<string, string | undefined>)
        : undefined,
    ),
  });

  const isAdmin = authCtx?.user.role === "ADMIN";
  const view = await getRankIQProfileView(username, {
    includeTest,
    allowPrivate: isAdmin,
  });
  if (!view) notFound();

  const viewerProfile = authCtx?.universalProfile ?? null;
  const isOwner =
    viewerProfile?.id != null && viewerProfile.id === view.profileId;

  const profileRecord = await prisma.universalProfile.findUnique({
    where: { username },
    select: { publicVisible: true, bio: true },
  });
  if (profileRecord && !profileRecord.publicVisible && !isOwner && !isAdmin) {
    notFound();
  }

  trackEvent("ranker_profile_viewed", { contestsPlayed: view.contestsPlayed });
  const [followCounts, viewerIsFollowing, qualification, weekBoards, competitive] =
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
      getCompetitiveResume({
        profileId: view.profileId,
        username: view.username,
        profileType: view.profileType,
        expertSourceKind: view.expertSourceKind,
        includeTest,
      }),
    ]);

  const isPublisherConsensus = isPublisherConsensusSource(view.expertSourceKind);
  const scoringDisclosure =
    view.profileType === "BENCHMARK"
      ? formatBenchmarkScoringDisclosure({
          scoringFormat: view.expertScoringFormat,
        })
      : null;

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
    ownershipVerified: view.ownershipVerified,
    headline: view.headline,
    affiliation: view.affiliation,
    websiteUrl: view.websiteUrl,
    xUrl: view.xUrl,
    youtubeUrl: view.youtubeUrl,
    instagramUrl: view.instagramUrl,
    tiktokUrl: view.tiktokUrl,
    podcastUrl: view.podcastUrl,
    featuredLinkTitle: view.featuredLinkTitle,
    featuredLinkUrl: view.featuredLinkUrl,
    bio:
      view.bio ??
      profileRecord?.bio ??
      (view.status === "SUSPENDED"
        ? "This profile is unavailable."
        : view.profileType === "AI"
          ? "AI competitor — rankings are submitted through RankEyeQ's administrative workflow."
          : view.profileType === "BENCHMARK"
            ? isPublisherConsensus
              ? "Publisher Consensus benchmark on RankEyeQ."
              : "Independent RankEyeQ Expert."
            : view.profileType === "CREATOR"
              ? "Independent RankEyeQ Creator competitor."
              : undefined),
    rankiq: view.stats,
  };

  const showClaimCta =
    !isOwner &&
    (view.profileType === "BENCHMARK" || view.profileType === "CREATOR") &&
    !view.hasAuthUser &&
    !view.ownershipVerified;

  // Expert / Creator: RankEyeQ performance is the centerpiece by default.
  const initialTab: ProductKey =
    requestedTab ??
    (view.profileType === "BENCHMARK" || view.profileType === "CREATOR"
      ? "rankiq"
      : "overview");

  const overview = await buildProfileOverview({
    profileId: view.profileId,
    username: view.username,
    rankiqContestsPlayed: view.contestsPlayed,
    recentHistory: view.history.slice(0, 5).map((item) => ({
      weekLabel: item.weekLabel,
      position: item.position,
      normalizedScore: item.normalizedScore,
      href: profileBoardHref(view.username, item.seasonYear, item.weekNumber, item.position),
    })),
  });

  const followControl = followControlFor({
    viewer: {
      signedIn: Boolean(authCtx),
      profileId: viewerProfile?.id ?? null,
      profileType: viewerProfile?.profileType ?? null,
      status: viewerProfile?.status ?? null,
    },
    target: {
      profileId: view.profileId,
      profileType: view.profileType,
      expertSourceKind: view.expertSourceKind,
      status: view.status,
    },
  });

  return (
    <Container className="py-12 sm:py-16">
      <ProfileHeader
        profile={profile}
        profileId={view.profileId}
        profileType={view.profileType}
        isOwner={isOwner}
        signedIn={Boolean(authCtx)}
        showClaimCta={showClaimCta}
        followerCount={followCounts.followers}
        followingCount={followCounts.following}
        scoringDisclosure={scoringDisclosure}
        expertSourceKind={view.expertSourceKind}
        follow={
          followControl === "hidden"
            ? undefined
            : {
                signedIn: Boolean(authCtx),
                viewerIsFollowing,
                canFollow: followControl === "follow",
                targetProfileId: view.profileId,
              }
        }
        creator={{
          enabled: qualification.status === "ENABLED",
          qualified:
            qualification.status === "ELIGIBLE" ||
            qualification.status === "ENABLED",
        }}
      />

      <SeasonStanding standing={competitive.standing} />
      <TrophyCase trophyCase={competitive.trophyCase} />
      <ResumeStats
        stats={view.stats}
        counts={competitive.trophyCase.counts}
        contestsPlayed={view.contestsPlayed}
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

import {
  authorizePublicUpdate,
  demoteToPrivateTracked,
  resolveCompetitorVisibility,
  setInactiveVisibility,
  supportsPrivateTracking,
  type AuthorizeHistoryMode,
  type CompetitorVisibilityState,
} from "@/lib/competitor-visibility";
import { prisma } from "@/lib/db";
import { EXPERT_SOURCE_KIND } from "@/lib/expert-identity";
import type { ContestPosition, ProfileType } from "@/lib/generated/prisma/client";

export class CompetitorAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompetitorAuthorizationError";
  }
}

export async function resolveCurrentPublicGateWeekId(): Promise<string | null> {
  const season = await prisma.season.findFirst({
    where: { active: true, sport: "NFL" },
    include: {
      weeks: {
        where: { isTest: false },
        orderBy: { weekNumber: "asc" },
      },
    },
  });
  if (!season?.weeks.length) return null;
  const week =
    season.weeks.find((w) => w.status === "OPEN" || w.status === "LOCKED") ??
    season.weeks.find((w) => w.status === "COMPLETE") ??
    season.weeks[season.weeks.length - 1];
  return week?.id ?? null;
}

/**
 * Authorize a PRIVATE_TRACKED Expert/Creator for public surfaces.
 * Preserves all historical boards/scores; historyMode controls public exposure.
 */
export async function authorizeCompetitorPublic(input: {
  universalProfileId: string;
  historyMode: AuthorizeHistoryMode;
  currentWeekId?: string | null;
}) {
  const profile = await prisma.universalProfile.findUnique({
    where: { id: input.universalProfileId },
    select: {
      id: true,
      profileType: true,
      competitorActive: true,
      publicVisible: true,
      username: true,
    },
  });
  if (!profile) {
    throw new CompetitorAuthorizationError("Competitor profile not found");
  }
  if (!supportsPrivateTracking(profile.profileType)) {
    throw new CompetitorAuthorizationError(
      "Only Experts and Creators use private-tracking authorization",
    );
  }

  const currentWeekId =
    input.historyMode === "from_now"
      ? (input.currentWeekId ?? (await resolveCurrentPublicGateWeekId()))
      : null;
  if (input.historyMode === "from_now" && !currentWeekId) {
    throw new CompetitorAuthorizationError(
      "No active week available to gate public history from",
    );
  }

  const data = authorizePublicUpdate({
    historyMode: input.historyMode,
    currentWeekId,
  });

  return prisma.universalProfile.update({
    where: { id: profile.id },
    data,
  });
}

export async function setCompetitorVisibilityState(input: {
  universalProfileId: string;
  state: CompetitorVisibilityState;
  historyMode?: AuthorizeHistoryMode;
  currentWeekId?: string | null;
}) {
  const profile = await prisma.universalProfile.findUnique({
    where: { id: input.universalProfileId },
    select: {
      id: true,
      profileType: true,
      competitorActive: true,
      publicVisible: true,
    },
  });
  if (!profile) {
    throw new CompetitorAuthorizationError("Competitor profile not found");
  }
  if (!supportsPrivateTracking(profile.profileType)) {
    throw new CompetitorAuthorizationError(
      "Only Experts and Creators use private-tracking authorization",
    );
  }

  const current = resolveCompetitorVisibility(profile);
  if (input.state === current && input.state !== "AUTHORIZED_PUBLIC") {
    return profile;
  }

  if (input.state === "AUTHORIZED_PUBLIC") {
    return authorizeCompetitorPublic({
      universalProfileId: profile.id,
      historyMode: input.historyMode ?? "from_now",
      currentWeekId: input.currentWeekId,
    });
  }

  if (input.state === "PRIVATE_TRACKED") {
    return prisma.universalProfile.update({
      where: { id: profile.id },
      data: demoteToPrivateTracked(),
    });
  }

  return prisma.universalProfile.update({
    where: { id: profile.id },
    data: setInactiveVisibility(),
  });
}

export type CompetitorOutreachSummary = {
  profileId: string;
  displayName: string;
  competitorClass: "EXPERT" | "CREATOR";
  visibilityState: CompetitorVisibilityState;
  weeksTracked: number;
  avgEyeq: number | null;
  bestWeeklyFinish: number | null;
  bestWeeklyFinishLabel: string | null;
  bestPosition: ContestPosition | null;
  overallInternalRank: number | null;
  topPercent: number | null;
};

/**
 * Admin-only outreach card stats from internal graded boards (includes private).
 */
export async function getCompetitorOutreachSummary(input: {
  universalProfileId: string;
}): Promise<CompetitorOutreachSummary | null> {
  const profile = await prisma.universalProfile.findUnique({
    where: { id: input.universalProfileId },
    include: { expertSource: true },
  });
  if (!profile || !supportsPrivateTracking(profile.profileType)) return null;

  const competitorClass: "EXPERT" | "CREATOR" =
    profile.profileType === "CREATOR" ? "CREATOR" : "EXPERT";

  const submissions = await prisma.rankingSubmission.findMany({
    where: {
      universalProfileId: profile.id,
      status: "GRADED",
      normalizedScore: { not: null },
      picks: { some: {} },
      contest: { week: { isTest: false }, status: { in: ["FINAL", "ARCHIVED"] } },
    },
    include: {
      contest: { include: { week: true } },
    },
  });

  const weekIds = new Set(submissions.map((s) => s.contest.weekId));
  const scores = submissions
    .map((s) => s.normalizedScore)
    .filter((v): v is number => v != null);
  const avgEyeq =
    scores.length === 0
      ? null
      : scores.reduce((sum, v) => sum + v, 0) / scores.length;

  // Best weekly finish: best average score rank among peers in same class that week.
  let bestWeeklyFinish: number | null = null;
  let bestWeeklyFinishLabel: string | null = null;
  let bestPosition: ContestPosition | null = null;
  let bestPositionScore = -1;

  for (const submission of submissions) {
    if (
      submission.normalizedScore != null &&
      submission.normalizedScore > bestPositionScore
    ) {
      bestPositionScore = submission.normalizedScore;
      bestPosition = submission.contest.position;
    }
  }

  const weekGroups = new Map<string, typeof submissions>();
  for (const submission of submissions) {
    const list = weekGroups.get(submission.contest.weekId) ?? [];
    list.push(submission);
    weekGroups.set(submission.contest.weekId, list);
  }

  for (const [weekId, weekSubs] of weekGroups) {
    const peerSubs = await prisma.rankingSubmission.findMany({
      where: {
        contest: { weekId, status: { in: ["FINAL", "ARCHIVED"] } },
        status: "GRADED",
        normalizedScore: { not: null },
        picks: { some: {} },
        universalProfile: {
          profileType: profile.profileType as ProfileType,
          competitorActive: true,
          ...(profile.profileType === "BENCHMARK"
            ? {
            OR: [
              { expertSource: { sourceKind: EXPERT_SOURCE_KIND.ANALYST } },
              { expertSource: null },
            ],
          }
        : {}),
        },
      },
      select: {
        universalProfileId: true,
        normalizedScore: true,
      },
    });

    const byProfile = new Map<string, number[]>();
    for (const row of peerSubs) {
      if (row.normalizedScore == null) continue;
      const list = byProfile.get(row.universalProfileId) ?? [];
      list.push(row.normalizedScore);
      byProfile.set(row.universalProfileId, list);
    }
    const averages = [...byProfile.entries()].map(([id, vals]) => ({
      id,
      avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    }));
    averages.sort((a, b) => b.avg - a.avg);
    const finish = averages.findIndex((row) => row.id === profile.id) + 1;
    if (finish > 0 && (bestWeeklyFinish == null || finish < bestWeeklyFinish)) {
      bestWeeklyFinish = finish;
      const weekLabel = weekSubs[0]?.contest.week.label ?? weekId;
      bestWeeklyFinishLabel = `#${finish} ${competitorClass === "CREATOR" ? "Creator" : "Expert"} · ${weekLabel}`;
    }
  }

  // Overall internal rank among active peers (includes private tracked).
  const peerProfiles = await prisma.universalProfile.findMany({
    where: {
      profileType: profile.profileType,
      competitorActive: true,
      ...(profile.profileType === "BENCHMARK"
        ? {
            OR: [
              { expertSource: { sourceKind: EXPERT_SOURCE_KIND.ANALYST } },
              { expertSource: null },
            ],
          }
        : {}),
    },
    select: { id: true },
  });
  const peerIds = peerProfiles.map((p) => p.id);
  const peerGrades =
    peerIds.length === 0
      ? []
      : await prisma.rankingSubmission.findMany({
          where: {
            universalProfileId: { in: peerIds },
            status: "GRADED",
            normalizedScore: { not: null },
            picks: { some: {} },
            contest: {
              week: { isTest: false },
              status: { in: ["FINAL", "ARCHIVED"] },
            },
          },
          select: {
            universalProfileId: true,
            normalizedScore: true,
          },
        });

  const peerAvg = new Map<string, number[]>();
  for (const row of peerGrades) {
    if (row.normalizedScore == null) continue;
    const list = peerAvg.get(row.universalProfileId) ?? [];
    list.push(row.normalizedScore);
    peerAvg.set(row.universalProfileId, list);
  }
  const ranked = [...peerAvg.entries()]
    .map(([id, vals]) => ({
      id,
      avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    }))
    .sort((a, b) => b.avg - a.avg);
  const overallInternalRank =
    ranked.findIndex((row) => row.id === profile.id) + 1 || null;
  const topPercent =
    overallInternalRank != null && ranked.length > 0
      ? Math.max(
          1,
          Math.round((overallInternalRank / ranked.length) * 100),
        )
      : null;

  return {
    profileId: profile.id,
    displayName: profile.displayName,
    competitorClass,
    visibilityState: resolveCompetitorVisibility(profile),
    weeksTracked: weekIds.size,
    avgEyeq,
    bestWeeklyFinish,
    bestWeeklyFinishLabel,
    bestPosition,
    overallInternalRank: overallInternalRank || null,
    topPercent,
  };
}

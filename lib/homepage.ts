import { prisma } from "@/lib/db";
import { getWeeklyLeaderboard, type LeaderboardRow } from "@/lib/leaderboards";
import { submissionIsEligible } from "@/lib/contest-lifecycle";
import { toUiPosition } from "@/lib/contest-defaults";
import { ctaForContestState } from "@/lib/homepage-cta";
import type {
  ContestStatus,
  SubmissionStatus,
} from "@/lib/generated/prisma/client";
import type { Position } from "@/types/contest";

export { ctaForContestState } from "@/lib/homepage-cta";

export type HomepageWeek = {
  id: string;
  label: string;
  weekNumber: number;
  status: string;
  startsAt: Date;
  endsAt: Date;
  seasonYear: number;
};

export type HomepageChallengeCard = {
  contestId: string;
  position: Position;
  shortLabel: string;
  rankingDepth: number;
  contestStatus: ContestStatus;
  lockLabel: string;
  locksAt: Date | null;
  submittedCount: number;
  profileSubmissionStatus: SubmissionStatus | null;
  ctaLabel: string;
  href: string;
};

export type HomepageRecentResult = {
  contestId: string;
  position: string;
  weekLabel: string;
  winningScore: number | null;
  topPerformerUsername: string | null;
  topPerformerDisplayName: string | null;
  topPerformerIsAi: boolean;
  actualNumberOneName: string | null;
  href: string;
};

export type AiVsHumanSummary = {
  weekLabel: string;
  humanAverage: number | null;
  expertAverage: number | null;
  aiAverage: number | null;
  topHuman: LeaderboardRow | null;
  topExpert: LeaderboardRow | null;
  topAi: LeaderboardRow | null;
  sampleHumans: number;
  sampleExperts: number;
  sampleAi: number;
};

function formatLockLabel(locksAt: Date | null) {
  if (!locksAt) return "Lock time TBD";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
    timeZoneName: "short",
  }).format(locksAt);
}

async function findLatestGradedWeek(
  weeks: { id: string; label: string; weekNumber: number; status: string }[],
) {
  for (const candidate of [...weeks].reverse()) {
    const graded = await prisma.rankingSubmission.count({
      where: {
        status: "GRADED",
        contest: { weekId: candidate.id },
      },
    });
    if (graded > 0) return candidate;
  }
  return null;
}

export async function getHomepageData(activeProfileId?: string | null) {
  const season = await prisma.season.findFirst({
    where: { active: true, sport: "NFL" },
    include: {
      weeks: { where: { isTest: false }, orderBy: { weekNumber: "asc" } },
    },
  });

  if (!season) {
    return {
      week: null as HomepageWeek | null,
      challenges: [] as HomepageChallengeCard[],
      weeklyLeaders: [] as LeaderboardRow[],
      aiVsHuman: null as AiVsHumanSummary | null,
      recentResults: [] as HomepageRecentResult[],
      gradedWeekId: null as string | null,
    };
  }

  const week =
    season.weeks.find((w) => w.status === "OPEN") ??
    season.weeks.find((w) => w.status === "LOCKED") ??
    season.weeks.find((w) => w.status === "COMPLETE") ??
    season.weeks[0] ??
    null;

  const contests = week
    ? await prisma.rankIQContest.findMany({
        where: { weekId: week.id },
        include: {
          submissions: {
            select: {
              status: true,
              universalProfileId: true,
              universalProfile: { select: { profileType: true } },
            },
          },
        },
        orderBy: { position: "asc" },
      })
    : [];

  const challenges: HomepageChallengeCard[] = contests.map((contest) => {
    const submittedCount = contest.submissions.filter(
      (s) =>
        submissionIsEligible(s.status) &&
        s.universalProfile.profileType !== "BENCHMARK",
    ).length;
    const profileSubmission =
      contest.submissions.find(
        (s) => s.universalProfileId === activeProfileId,
      ) ?? null;
    const position = toUiPosition(contest.position);

    return {
      contestId: contest.id,
      position,
      shortLabel: contest.position,
      rankingDepth: contest.rankingDepth,
      contestStatus: contest.status,
      lockLabel: formatLockLabel(contest.locksAt),
      locksAt: contest.locksAt,
      submittedCount,
      profileSubmissionStatus: profileSubmission?.status ?? null,
      ctaLabel: ctaForContestState(
        contest.status,
        profileSubmission?.status ?? null,
      ),
      href:
        contest.status === "FINAL" || contest.status === "ARCHIVED"
          ? `/results?contestId=${contest.id}`
          : `/rank/${position}`,
    };
  });

  const latestGradedWeek = await findLatestGradedWeek(season.weeks);

  const weeklyLeaders = latestGradedWeek
    ? (
        await getWeeklyLeaderboard({
          weekId: latestGradedWeek.id,
          filter: "ALL",
        })
      ).slice(0, 5)
    : [];

  const humans = latestGradedWeek
    ? await getWeeklyLeaderboard({
        weekId: latestGradedWeek.id,
        filter: "HUMAN",
      })
    : [];
  const ais = latestGradedWeek
    ? await getWeeklyLeaderboard({
        weekId: latestGradedWeek.id,
        filter: "AI",
      })
    : [];

  const experts = latestGradedWeek
    ? await getWeeklyLeaderboard({
        weekId: latestGradedWeek.id,
        filter: "EXPERT",
      })
    : [];

  const avg = (rows: LeaderboardRow[]) =>
    rows.length === 0
      ? null
      : rows.reduce((sum, row) => sum + row.averageScore, 0) / rows.length;

  const aiVsHuman: AiVsHumanSummary | null = latestGradedWeek
    ? {
        weekLabel: latestGradedWeek.label,
        humanAverage: avg(humans),
        expertAverage: avg(experts),
        aiAverage: avg(ais),
        topHuman: humans[0] ?? null,
        topExpert: experts[0] ?? null,
        topAi: ais[0] ?? null,
        sampleHumans: humans.length,
        sampleExperts: experts.length,
        sampleAi: ais.length,
      }
    : null;

  const finalized = await prisma.rankIQContest.findMany({
    where: {
      seasonId: season.id,
      status: { in: ["FINAL", "ARCHIVED"] },
    },
    include: {
      week: true,
      entries: {
        where: { actualRank: 1 },
        include: { rankableEntry: true },
        take: 1,
      },
      submissions: {
        where: { status: "GRADED", normalizedScore: { not: null } },
        include: { universalProfile: true },
        orderBy: { normalizedScore: "desc" },
        take: 1,
      },
    },
    orderBy: [{ week: { weekNumber: "desc" } }, { updatedAt: "desc" }],
    take: 5,
  });

  const recentResults: HomepageRecentResult[] = finalized.map((contest) => {
    const top = contest.submissions[0];
    return {
      contestId: contest.id,
      position: contest.position,
      weekLabel: contest.week.label,
      winningScore: top?.normalizedScore ?? null,
      topPerformerUsername: top?.universalProfile.username ?? null,
      topPerformerDisplayName: top?.universalProfile.displayName ?? null,
      topPerformerIsAi: top?.universalProfile.profileType === "AI",
      actualNumberOneName: contest.entries[0]?.rankableEntry.name ?? null,
      href: `/results?contestId=${contest.id}`,
    };
  });

  return {
    week: week
      ? {
          id: week.id,
          label: week.label,
          weekNumber: week.weekNumber,
          status: week.status,
          startsAt: week.startsAt,
          endsAt: week.endsAt,
          seasonYear: season.year,
        }
      : null,
    challenges,
    weeklyLeaders,
    aiVsHuman,
    recentResults,
    gradedWeekId: latestGradedWeek?.id ?? null,
  };
}

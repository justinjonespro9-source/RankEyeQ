import { prisma } from "@/lib/db";
import type { BoardRevealPreference } from "@/lib/generated/prisma/client";
import {
  evaluateCreatorQualification,
  getQualificationRules,
  type QualificationResult,
  type QualificationRules,
} from "@/lib/social/qualification";

export class CreatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreatorError";
  }
}

export async function countGradedContests(profileId: string) {
  return prisma.rankingSubmission.count({
    where: {
      universalProfileId: profileId,
      status: "GRADED",
    },
  });
}

export async function getCreatorProfile(universalProfileId: string) {
  return prisma.creatorProfile.findUnique({
    where: { universalProfileId },
  });
}

export async function evaluateProfileQualification(
  profileId: string,
  rules?: QualificationRules,
): Promise<
  QualificationResult & {
    gradedContestCount: number;
    creatorEnabled: boolean;
    defaultRevealPreference: BoardRevealPreference;
  }
> {
  const profile = await prisma.universalProfile.findUnique({
    where: { id: profileId },
    include: { creatorProfile: true },
  });
  if (!profile) {
    throw new CreatorError("Profile not found");
  }

  const gradedContestCount = await countGradedContests(profileId);
  const creatorEnabled = profile.creatorProfile?.enabled === true;
  const evaluation = evaluateCreatorQualification(
    {
      profileType: profile.profileType,
      status: profile.status,
      gradedContestCount,
      creatorEnabled,
    },
    rules ?? getQualificationRules(),
  );

  return {
    ...evaluation,
    gradedContestCount,
    creatorEnabled,
    defaultRevealPreference:
      profile.creatorProfile?.defaultRevealPreference ?? "FREE_REVEAL",
  };
}

export async function setCreatorOptIn(input: {
  profileId: string;
  enabled: boolean;
}) {
  const profile = await prisma.universalProfile.findUnique({
    where: { id: input.profileId },
  });
  if (!profile) throw new CreatorError("Profile not found");
  if (profile.profileType !== "HUMAN") {
    throw new CreatorError(
      "AI and benchmark profiles cannot become payout creators",
    );
  }

  const evaluation = await evaluateProfileQualification(profile.id);
  if (input.enabled && !evaluation.eligible) {
    throw new CreatorError(
      evaluation.reasons[0] ?? "Not eligible for creator mode",
    );
  }

  return prisma.creatorProfile.upsert({
    where: { universalProfileId: profile.id },
    create: {
      universalProfileId: profile.id,
      enabled: input.enabled,
    },
    update: { enabled: input.enabled },
  });
}

export async function setDefaultRevealPreference(input: {
  profileId: string;
  preference: BoardRevealPreference;
  applyToCurrentWeek?: boolean;
  now?: Date;
}) {
  const evaluation = await evaluateProfileQualification(input.profileId);
  if (evaluation.status !== "ENABLED") {
    throw new CreatorError("Creator mode must be enabled to set reveal preference");
  }

  const creator = await prisma.creatorProfile.update({
    where: { universalProfileId: input.profileId },
    data: { defaultRevealPreference: input.preference },
  });

  if (input.applyToCurrentWeek !== false) {
    await applyRevealPreferenceToCurrentWeekBoards({
      profileId: input.profileId,
      preference: input.preference,
      now: input.now,
    });
  }

  return creator;
}

export async function setSubmissionRevealPreference(input: {
  profileId: string;
  contestId: string;
  preference: BoardRevealPreference;
}) {
  const evaluation = await evaluateProfileQualification(input.profileId);
  if (evaluation.status !== "ENABLED") {
    throw new CreatorError("Creator mode must be enabled to set board reveal preference");
  }

  const submission = await prisma.rankingSubmission.findUnique({
    where: {
      contestId_universalProfileId: {
        contestId: input.contestId,
        universalProfileId: input.profileId,
      },
    },
    include: { contest: { include: { week: true } } },
  });
  if (!submission) throw new CreatorError("Board not found");
  if (submission.universalProfileId !== input.profileId) {
    throw new CreatorError("You cannot modify another creator’s reveal setting");
  }

  const week = submission.contest.week;
  const now = new Date();
  if (
    week.status === "COMPLETE" ||
    week.status === "ARCHIVED" ||
    (week.publicReleaseAt && now >= week.publicReleaseAt)
  ) {
    throw new CreatorError("Historical boards stay public after release");
  }

  return prisma.rankingSubmission.update({
    where: { id: submission.id },
    data: { revealPreference: input.preference },
  });
}

export async function applyRevealPreferenceToCurrentWeekBoards(input: {
  profileId: string;
  preference: BoardRevealPreference;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const currentWeek = await prisma.week.findFirst({
    where: {
      season: { active: true },
      status: { in: ["UPCOMING", "OPEN", "LOCKED"] },
      OR: [{ publicReleaseAt: null }, { publicReleaseAt: { gt: now } }],
    },
    orderBy: { weekNumber: "desc" },
  });
  if (!currentWeek) return 0;

  const result = await prisma.rankingSubmission.updateMany({
    where: {
      universalProfileId: input.profileId,
      contest: { weekId: currentWeek.id },
    },
    data: { revealPreference: input.preference },
  });
  return result.count;
}

export async function resolveRevealPreferenceForNewSubmission(
  profileId: string,
): Promise<BoardRevealPreference> {
  const creator = await prisma.creatorProfile.findUnique({
    where: { universalProfileId: profileId },
  });
  if (creator?.enabled) return creator.defaultRevealPreference;
  return "FREE_REVEAL";
}

export function isPremiumRevealBoard(input: {
  creatorEnabled: boolean;
  revealPreference: BoardRevealPreference | null | undefined;
}) {
  return (
    input.creatorEnabled && input.revealPreference === "PREMIUM_REVEAL"
  );
}

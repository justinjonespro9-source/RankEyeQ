import { prisma } from "@/lib/db";
import { submissionIsEligible } from "@/lib/contest-lifecycle";

/** Profiles a user follows — notification targeting primitive. */
export async function queryFollowedProfiles(followerProfileId: string) {
  const rows = await prisma.profileFollow.findMany({
    where: { followerProfileId },
    select: {
      followedProfileId: true,
      followed: {
        select: {
          id: true,
          username: true,
          displayName: true,
          profileType: true,
          status: true,
        },
      },
    },
  });
  return rows.map((row) => row.followed);
}

/** Followed creators (or any followed profiles) with a submitted current-week board. */
export async function queryFollowedWithSubmittedCurrentWeekBoards(input: {
  followerProfileId: string;
  weekId: string;
}) {
  const follows = await prisma.profileFollow.findMany({
    where: { followerProfileId: input.followerProfileId },
    select: { followedProfileId: true },
  });
  const profileIds = follows.map((row) => row.followedProfileId);
  if (profileIds.length === 0) return [];

  const submissions = await prisma.rankingSubmission.findMany({
    where: {
      universalProfileId: { in: profileIds },
      status: { in: ["SUBMITTED", "LOCKED", "GRADED"] },
      contest: { weekId: input.weekId },
    },
    include: {
      universalProfile: {
        select: {
          id: true,
          username: true,
          displayName: true,
          profileType: true,
          creatorProfile: { select: { enabled: true } },
        },
      },
      contest: { select: { id: true, position: true, title: true } },
    },
  });

  return submissions.filter((row) => submissionIsEligible(row.status));
}

/** Followed boards that become viewable at Sunday 10 AM lock (FREE_REVEAL / default). */
export async function queryFollowedBoardsBecomingAvailableAtLock(input: {
  followerProfileId: string;
  weekId: string;
}) {
  const submitted = await queryFollowedWithSubmittedCurrentWeekBoards(input);
  return submitted.filter((row) => {
    const creatorEnabled = row.universalProfile.creatorProfile?.enabled === true;
    return !creatorEnabled || row.revealPreference === "FREE_REVEAL";
  });
}

/** Followed rankers with a notable Thursday receipt (committed #1 on a Thu kickoff player). */
export async function queryFollowedRankersWithThursdayReceipts(input: {
  followerProfileId: string;
  weekId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const follows = await prisma.profileFollow.findMany({
    where: { followerProfileId: input.followerProfileId },
    select: { followedProfileId: true },
  });
  const profileIds = follows.map((row) => row.followedProfileId);
  if (profileIds.length === 0) return [];

  const submissions = await prisma.rankingSubmission.findMany({
    where: {
      universalProfileId: { in: profileIds },
      status: { in: ["SUBMITTED", "LOCKED", "GRADED"] },
      contest: { weekId: input.weekId },
    },
    include: {
      universalProfile: {
        select: { id: true, username: true, displayName: true },
      },
      contest: { select: { position: true } },
      picks: {
        include: {
          rankableEntry: {
            include: { game: true },
          },
        },
      },
    },
  });

  return submissions.flatMap((submission) => {
    const notable = submission.picks.filter((pick) => {
      const kickoff = pick.rankableEntry.game?.startsAt ?? pick.rankableEntry.gameStartsAt;
      if (!kickoff || kickoff > now) return false;
      const rank = pick.lockedRank ?? pick.predictedRank;
      const proof = pick.committedAt ?? pick.lockedAt;
      if (!proof || proof.getTime() > kickoff.getTime()) return false;
      return rank === 1;
    });
    if (notable.length === 0) return [];
    return [
      {
        profileId: submission.universalProfile.id,
        username: submission.universalProfile.username,
        displayName: submission.universalProfile.displayName,
        position: submission.contest.position,
        numberOneCalls: notable.map((pick) => ({
          name: pick.rankableEntry.name,
          team: pick.rankableEntry.team,
        })),
      },
    ];
  });
}

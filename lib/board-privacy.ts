import { prisma } from "@/lib/db";
import {
  profileAppearsOnPublicSurfaces,
  weekIsPubliclyVisibleForProfile,
} from "@/lib/competitor-visibility";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import { canViewCurrentWeekBoard } from "@/lib/timing/board-access";

export type BoardIndexability = {
  exists: boolean;
  public: boolean;
  isTest: boolean;
  username: string | null;
};

/** Stranger (unsigned, non-admin) view — used for robots/metadata. Never loads picks. */
export async function getBoardIndexability(input: {
  username: string;
  weekNumber: number;
  position: ContestPosition;
  now?: Date;
}): Promise<BoardIndexability> {
  const now = input.now ?? new Date();
  const profile = await prisma.universalProfile.findUnique({
    where: { username: input.username },
    select: {
      id: true,
      username: true,
      profileType: true,
      competitorActive: true,
      publicVisible: true,
      publicFromWeekId: true,
      publicFromWeek: true,
    },
  });
  if (!profile) {
    return { exists: false, public: false, isTest: false, username: null };
  }

  const visibility = {
    profileType: profile.profileType,
    competitorActive: profile.competitorActive,
    publicVisible: profile.publicVisible,
    publicFromWeekId: profile.publicFromWeekId,
    publicFromWeek: profile.publicFromWeek,
  };
  if (!profileAppearsOnPublicSurfaces(visibility)) {
    return {
      exists: false,
      public: false,
      isTest: false,
      username: null,
    };
  }

  const week = await prisma.week.findFirst({
    where: {
      weekNumber: input.weekNumber,
      season: { active: true, sport: "NFL" },
      isTest: false,
    },
  });
  if (!week) {
    return {
      exists: false,
      public: false,
      isTest: false,
      username: profile.username,
    };
  }

  if (
    !weekIsPubliclyVisibleForProfile(visibility, {
      id: week.id,
      seasonId: week.seasonId,
      weekNumber: week.weekNumber,
      startsAt: week.startsAt,
    })
  ) {
    return {
      exists: false,
      public: false,
      isTest: false,
      username: null,
    };
  }

  const contest = await prisma.rankIQContest.findUnique({
    where: { weekId_position: { weekId: week.id, position: input.position } },
    select: { status: true, id: true },
  });
  if (!contest) {
    return {
      exists: false,
      public: false,
      isTest: week.isTest,
      username: profile.username,
    };
  }

  const publicToStranger = canViewCurrentWeekBoard({
    viewer: { profileId: null, isAdmin: false },
    targetProfileId: profile.id,
    week,
    contest,
    now,
  });

  return {
    exists: true,
    public: publicToStranger && !week.isTest,
    isTest: week.isTest,
    username: profile.username,
  };
}

import { prisma } from "@/lib/db";
import {
  CONTEST_POSITIONS,
  rankingDepthForPosition,
} from "@/lib/contest-defaults";
import type { ContestPosition, WeekStatus } from "@/lib/generated/prisma/client";
import { getActiveRankingScoringVersion } from "@/lib/ranking-scoring-versions";
import { computeNflTimingWindows } from "@/lib/timing/week-windows";

export class WeekSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeekSetupError";
  }
}

export function defaultContestTitle(position: ContestPosition) {
  return `${position} Top ${rankingDepthForPosition(position)}`;
}

export async function createWeek(input: {
  seasonId: string;
  weekNumber: number;
  label?: string;
  startsAt: Date;
  endsAt: Date;
  status?: WeekStatus;
  rankingsOpenAt?: Date | null;
  fullLockAt?: Date | null;
  revealStartsAt?: Date | null;
  publicReleaseAt?: Date | null;
  isTest?: boolean;
}) {
  if (!Number.isInteger(input.weekNumber) || input.weekNumber < 1) {
    throw new WeekSetupError("Week number must be a positive integer");
  }
  if (Number.isNaN(input.startsAt.getTime()) || Number.isNaN(input.endsAt.getTime())) {
    throw new WeekSetupError("Week start and end times are required");
  }
  if (input.endsAt <= input.startsAt) {
    throw new WeekSetupError("Week end must be after start");
  }

  const existing = await prisma.week.findUnique({
    where: {
      seasonId_weekNumber: {
        seasonId: input.seasonId,
        weekNumber: input.weekNumber,
      },
    },
  });
  if (existing) {
    throw new WeekSetupError(
      `Week ${input.weekNumber} already exists for this season`,
    );
  }

  const season = await prisma.season.findUniqueOrThrow({
    where: { id: input.seasonId },
  });

  const timing = computeNflTimingWindows(input.startsAt, input.endsAt);

  return prisma.week.create({
    data: {
      seasonId: input.seasonId,
      weekNumber: input.weekNumber,
      label: input.label?.trim() || `Week ${input.weekNumber}`,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      status: input.status ?? "UPCOMING",
      fantasyScoringVersion: season.fantasyScoringVersion,
      rankingsOpenAt: input.rankingsOpenAt ?? timing.rankingsOpenAt,
      fullLockAt: input.fullLockAt ?? timing.fullLockAt,
      revealStartsAt: input.revealStartsAt ?? timing.revealStartsAt,
      publicReleaseAt: input.publicReleaseAt ?? timing.publicReleaseAt,
      isTest: input.isTest ?? false,
    },
  });
}

export async function updateWeekTiming(input: {
  weekId: string;
  label?: string;
  startsAt?: Date;
  endsAt?: Date;
  status?: WeekStatus;
  rankingsOpenAt?: Date | null;
  fullLockAt?: Date | null;
  revealStartsAt?: Date | null;
  publicReleaseAt?: Date | null;
}) {
  const week = await prisma.week.findUnique({ where: { id: input.weekId } });
  if (!week) throw new WeekSetupError("Week not found");

  return prisma.week.update({
    where: { id: input.weekId },
    data: {
      ...(input.label != null ? { label: input.label } : {}),
      ...(input.startsAt ? { startsAt: input.startsAt } : {}),
      ...(input.endsAt ? { endsAt: input.endsAt } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.rankingsOpenAt !== undefined
        ? { rankingsOpenAt: input.rankingsOpenAt }
        : {}),
      ...(input.fullLockAt !== undefined ? { fullLockAt: input.fullLockAt } : {}),
      ...(input.revealStartsAt !== undefined
        ? { revealStartsAt: input.revealStartsAt }
        : {}),
      ...(input.publicReleaseAt !== undefined
        ? { publicReleaseAt: input.publicReleaseAt }
        : {}),
    },
  });
}

export async function ensureFivePositionContests(weekId: string) {
  const week = await prisma.week.findUniqueOrThrow({
    where: { id: weekId },
    include: { season: true },
  });

  const activeVersion =
    week.season.activeRankingScoringVersionId ??
    (await getActiveRankingScoringVersion())?.id ??
    null;

  const created: ContestPosition[] = [];
  const skipped: ContestPosition[] = [];

  for (const position of CONTEST_POSITIONS) {
    const existing = await prisma.rankIQContest.findUnique({
      where: { weekId_position: { weekId, position } },
    });
    if (existing) {
      skipped.push(position);
      continue;
    }

    const rankingDepth = rankingDepthForPosition(position);
    await prisma.rankIQContest.create({
      data: {
        seasonId: week.seasonId,
        weekId,
        position,
        title: defaultContestTitle(position),
        rankingDepth,
        status: week.status === "OPEN" ? "OPEN" : "DRAFT",
        opensAt: week.rankingsOpenAt,
        locksAt: week.fullLockAt,
        rankingScoringVersionId: activeVersion,
      },
    });
    created.push(position);
  }

  return { created, skipped, weekId };
}

export async function archiveWeek(weekId: string) {
  const week = await prisma.week.findUniqueOrThrow({
    where: { id: weekId },
    include: { contests: true },
  });

  await prisma.week.update({
    where: { id: weekId },
    data: { status: "ARCHIVED" },
  });

  for (const contest of week.contests) {
    if (contest.status !== "ARCHIVED") {
      await prisma.rankIQContest.update({
        where: { id: contest.id },
        data: { status: "ARCHIVED" },
      });
    }
  }

  return { weekId };
}

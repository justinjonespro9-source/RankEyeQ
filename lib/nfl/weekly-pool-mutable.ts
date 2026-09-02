import { prisma } from "@/lib/db";
import type { ContestStatus, WeekStatus } from "@/lib/generated/prisma/client";

const IMMUTABLE_WEEK_STATUSES = new Set<WeekStatus>([
  "LOCKED",
  "COMPLETE",
  "ARCHIVED",
]);

const IMMUTABLE_CONTEST_STATUSES = new Set<ContestStatus>([
  "LOCKED",
  "FINAL",
  "ARCHIVED",
]);

export function isMutableWeekStatus(status: WeekStatus): boolean {
  return !IMMUTABLE_WEEK_STATUSES.has(status);
}

export function isMutableContestStatus(status: ContestStatus): boolean {
  return !IMMUTABLE_CONTEST_STATUSES.has(status);
}

export async function isMutableWeeklyPool(weekId: string): Promise<boolean> {
  const week = await prisma.week.findUnique({
    where: { id: weekId },
    include: { contests: { select: { status: true } } },
  });
  if (!week) return false;
  if (!isMutableWeekStatus(week.status)) return false;
  return week.contests.every((contest) => isMutableContestStatus(contest.status));
}

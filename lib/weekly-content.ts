/**
 * Owner-attached weekly content links. Noncompetitive: never reads or writes
 * submissions, Official Board versions, scoring, grading or authority.
 */
import { isOwnerManagedProfile } from "@/lib/boards/authority";
import { validatePublicHttpUrl } from "@/lib/creator-verification-shared";
import { prisma } from "@/lib/db";
import type {
  ContestPosition,
  ProfileType,
  WeeklyContentType,
} from "@/lib/generated/prisma/client";
import {
  WEEKLY_CONTENT_MAX_PER_WEEK,
  WEEKLY_CONTENT_MAX_TITLE,
  WEEKLY_CONTENT_TYPES,
  type WeeklyContentItem,
} from "@/lib/weekly-content-shared";

const POSITIONS: ContestPosition[] = ["QB", "RB", "WR", "TE", "DEF"];

export class WeeklyContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeeklyContentError";
  }
}

export type WeeklyContentInput = {
  title: string;
  url: string;
  type: string;
  position?: string | null;
};

export type ValidWeeklyContent = {
  title: string;
  url: string;
  type: WeeklyContentType;
  position: ContestPosition | null;
};

/** HUMAN or owner-managed CREATOR only (same rule as owner-authored boards). */
export function canAuthorWeeklyContent(input: {
  profileType: ProfileType;
  hasLinkedUser: boolean;
}): boolean {
  return isOwnerManagedProfile(input);
}

export function validateWeeklyContentInput(
  input: WeeklyContentInput,
): ValidWeeklyContent {
  const title = input.title?.trim() ?? "";
  if (!title) throw new WeeklyContentError("Title is required.");
  if (title.length > WEEKLY_CONTENT_MAX_TITLE) {
    throw new WeeklyContentError("Title is too long.");
  }
  const checked = validatePublicHttpUrl(input.url ?? "", "Link");
  if (!checked.ok) throw new WeeklyContentError(checked.error);
  const parsed = new URL(checked.url);
  if (parsed.username || parsed.password) {
    throw new WeeklyContentError("Link must not include credentials.");
  }
  if (!WEEKLY_CONTENT_TYPES.includes(input.type as WeeklyContentType)) {
    throw new WeeklyContentError("Choose a content type.");
  }
  const rawPosition = input.position?.trim().toUpperCase() || null;
  if (rawPosition && !POSITIONS.includes(rawPosition as ContestPosition)) {
    throw new WeeklyContentError("Unknown position.");
  }
  return {
    title,
    url: checked.url,
    type: input.type as WeeklyContentType,
    position: (rawPosition as ContestPosition | null) ?? null,
  };
}

async function resolveAuthor(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { universalProfile: true },
  });
  const profile = user?.universalProfile;
  if (
    !profile ||
    !canAuthorWeeklyContent({
      profileType: profile.profileType,
      hasLinkedUser: true,
    })
  ) {
    throw new WeeklyContentError(
      "Only ranking-workspace competitors can attach weekly content.",
    );
  }
  if (profile.status === "SUSPENDED") {
    throw new WeeklyContentError("This profile is suspended.");
  }
  return profile;
}

/** Profile is always the session user's own — never a client-supplied id. */
export async function createWeeklyContent(input: {
  userId: string;
  weekId: string;
  content: WeeklyContentInput;
}) {
  const profile = await resolveAuthor(input.userId);
  const valid = validateWeeklyContentInput(input.content);
  const week = await prisma.week.findUnique({
    where: { id: input.weekId },
    select: { id: true },
  });
  if (!week) throw new WeeklyContentError("Week not found.");
  const existing = await prisma.weeklyContent.count({
    where: { profileId: profile.id, weekId: week.id },
  });
  if (existing >= WEEKLY_CONTENT_MAX_PER_WEEK) {
    throw new WeeklyContentError(
      `You can attach up to ${WEEKLY_CONTENT_MAX_PER_WEEK} links per week.`,
    );
  }
  return prisma.weeklyContent.create({
    data: { profileId: profile.id, weekId: week.id, ...valid },
  });
}

async function ownedRow(userId: string, id: string) {
  const profile = await resolveAuthor(userId);
  const row = await prisma.weeklyContent.findUnique({ where: { id } });
  if (!row || row.profileId !== profile.id) {
    throw new WeeklyContentError("Weekly content not found.");
  }
  return row;
}

export async function updateWeeklyContent(input: {
  userId: string;
  id: string;
  content: WeeklyContentInput;
}) {
  const row = await ownedRow(input.userId, input.id);
  const valid = validateWeeklyContentInput(input.content);
  return prisma.weeklyContent.update({ where: { id: row.id }, data: valid });
}

export async function deleteWeeklyContent(input: { userId: string; id: string }) {
  const row = await ownedRow(input.userId, input.id);
  await prisma.weeklyContent.delete({ where: { id: row.id } });
  return row;
}

/**
 * Items for a week; a position filter keeps week-wide (position null) items.
 * Moderation-suppressed items are public-hidden; only the owner's workspace
 * passes includeSuppressed to see them (flagged hiddenByModeration).
 */
export async function listWeeklyContent(input: {
  profileId: string;
  weekId: string;
  position?: ContestPosition | null;
  includeSuppressed?: boolean;
}): Promise<WeeklyContentItem[]> {
  const rows = await prisma.weeklyContent.findMany({
    where: {
      profileId: input.profileId,
      weekId: input.weekId,
      ...(input.includeSuppressed ? {} : { suppressedAt: null }),
      ...(input.position
        ? { OR: [{ position: null }, { position: input.position }] }
        : {}),
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      title: true,
      url: true,
      type: true,
      position: true,
      suppressedAt: true,
    },
  });
  return rows.map(({ suppressedAt, ...item }) =>
    input.includeSuppressed
      ? { ...item, hiddenByModeration: suppressedAt != null }
      : item,
  );
}

import { prisma } from "@/lib/db";
import type { UnlockAccessType } from "@/lib/generated/prisma/client";

export async function recordBoardUnlockEvent(input: {
  viewerProfileId: string | null;
  creatorProfileId: string;
  contestId: string;
  entitlementId?: string | null;
  accessType: UnlockAccessType;
}) {
  if (!input.viewerProfileId) return null;

  return prisma.boardUnlockEvent.upsert({
    where: {
      viewerProfileId_creatorProfileId_contestId: {
        viewerProfileId: input.viewerProfileId,
        creatorProfileId: input.creatorProfileId,
        contestId: input.contestId,
      },
    },
    create: {
      viewerProfileId: input.viewerProfileId,
      creatorProfileId: input.creatorProfileId,
      contestId: input.contestId,
      entitlementId: input.entitlementId ?? null,
      accessType: input.accessType,
    },
    update: {},
  });
}

export async function countUnlocksForCreator(creatorProfileId: string) {
  return prisma.boardUnlockEvent.count({
    where: { creatorProfileId },
  });
}

export async function countUnlocksForContest(contestId: string) {
  return prisma.boardUnlockEvent.count({
    where: { contestId },
  });
}

export async function listUnlocksForCreator(
  creatorProfileId: string,
  limit = 50,
) {
  return prisma.boardUnlockEvent.findMany({
    where: { creatorProfileId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      viewer: {
        select: { username: true, displayName: true, profileType: true },
      },
      contest: {
        select: { position: true, title: true, weekId: true },
      },
    },
  });
}

export function resolveUnlockAccessType(input: {
  isOwner: boolean;
  isAdmin: boolean;
  historicallyPublic: boolean;
  premiumReveal: boolean;
  hasMatchingEntitlement: boolean;
}): UnlockAccessType {
  if (input.isOwner) return "OWNER";
  if (input.isAdmin) return "ADMIN";
  if (input.historicallyPublic) return "PUBLIC_AFTER_RELEASE";
  if (input.premiumReveal && input.hasMatchingEntitlement) {
    return "PREMIUM_ENTITLEMENT";
  }
  return "FREE_REVEAL";
}

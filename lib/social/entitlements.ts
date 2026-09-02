import { assertAdminRole } from "@/lib/admin/access";
import { prisma } from "@/lib/db";
import type {
  EntitlementType,
  UserRole,
} from "@/lib/generated/prisma/client";

export type EntitlementMatchContext = {
  viewerProfileId: string;
  creatorProfileId: string;
  contestId: string;
  weekId: string;
  now: Date;
};

export type EntitlementRecord = {
  viewerProfileId: string;
  entitlementType: EntitlementType;
  contestId: string | null;
  creatorProfileId: string | null;
  weekId: string | null;
  startsAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

export function entitlementMatches(
  entitlement: EntitlementRecord,
  ctx: EntitlementMatchContext,
): boolean {
  if (entitlement.revokedAt) return false;
  if (entitlement.viewerProfileId !== ctx.viewerProfileId) return false;
  if (ctx.now < entitlement.startsAt) return false;
  if (entitlement.expiresAt && ctx.now >= entitlement.expiresAt) return false;

  switch (entitlement.entitlementType) {
    case "SINGLE_BOARD":
      return (
        entitlement.contestId === ctx.contestId &&
        (!entitlement.creatorProfileId ||
          entitlement.creatorProfileId === ctx.creatorProfileId)
      );
    case "CREATOR_WEEK":
      return (
        entitlement.creatorProfileId === ctx.creatorProfileId &&
        entitlement.weekId === ctx.weekId
      );
    case "POSITION_WEEK":
      return (
        entitlement.weekId === ctx.weekId &&
        entitlement.contestId === ctx.contestId
      );
    case "WEEK_ALL_ACCESS":
      return entitlement.weekId === ctx.weekId;
    case "SUBSCRIPTION":
      if (!entitlement.creatorProfileId) return true;
      return entitlement.creatorProfileId === ctx.creatorProfileId;
    default:
      return false;
  }
}

export async function listActiveEntitlementsForViewer(viewerProfileId: string) {
  return prisma.boardEntitlement.findMany({
    where: {
      viewerProfileId,
      revokedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function findMatchingEntitlement(
  ctx: EntitlementMatchContext,
) {
  const entitlements = await listActiveEntitlementsForViewer(ctx.viewerProfileId);
  return entitlements.find((row) => entitlementMatches(row, ctx)) ?? null;
}

export type GrantEntitlementInput = {
  viewerProfileId: string;
  entitlementType: EntitlementType;
  contestId?: string | null;
  creatorProfileId?: string | null;
  weekId?: string | null;
  startsAt?: Date;
  expiresAt?: Date | null;
  source?: string;
};

export async function grantBoardEntitlement(input: GrantEntitlementInput) {
  return prisma.boardEntitlement.create({
    data: {
      viewerProfileId: input.viewerProfileId,
      entitlementType: input.entitlementType,
      contestId: input.contestId ?? null,
      creatorProfileId: input.creatorProfileId ?? null,
      weekId: input.weekId ?? null,
      startsAt: input.startsAt ?? new Date(),
      expiresAt: input.expiresAt ?? null,
      source: input.source ?? "admin",
    },
  });
}

export async function revokeBoardEntitlement(entitlementId: string, now = new Date()) {
  return prisma.boardEntitlement.update({
    where: { id: entitlementId },
    data: { revokedAt: now },
  });
}

export async function grantBoardEntitlementAsActor(input: GrantEntitlementInput & {
  actorRole: UserRole;
}) {
  assertAdminRole(input.actorRole);
  return grantBoardEntitlement(input);
}

export async function revokeBoardEntitlementAsActor(input: {
  actorRole: UserRole;
  entitlementId: string;
  now?: Date;
}) {
  assertAdminRole(input.actorRole);
  return revokeBoardEntitlement(input.entitlementId, input.now);
}

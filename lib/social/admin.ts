import { prisma } from "@/lib/db";
import type { ProfileType } from "@/lib/generated/prisma/client";
import {
  evaluateCreatorQualification,
  getQualificationRules,
} from "@/lib/social/qualification";

export type AdminCreatorRow = {
  profileId: string;
  username: string;
  displayName: string;
  profileType: ProfileType;
  status: "ACTIVE" | "SUSPENDED";
  gradedContestCount: number;
  followerCount: number;
  creatorEnabled: boolean;
  defaultRevealPreference: "FREE_REVEAL" | "PREMIUM_REVEAL";
  qualificationStatus: "NOT_ELIGIBLE" | "ELIGIBLE" | "ENABLED";
  reasons: string[];
};

export async function listAdminCreators(input?: {
  query?: string;
  status?: "ALL" | "NOT_ELIGIBLE" | "ELIGIBLE" | "ENABLED";
  profileType?: ProfileType | "ALL";
}): Promise<AdminCreatorRow[]> {
  const query = input?.query?.trim();
  const profiles = await prisma.universalProfile.findMany({
    where: {
      ...(input?.profileType && input.profileType !== "ALL"
        ? { profileType: input.profileType }
        : {}),
      ...(query
        ? {
            OR: [
              { username: { contains: query, mode: "insensitive" } },
              { displayName: { contains: query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: {
      creatorProfile: true,
      _count: {
        select: {
          followsReceived: true,
        },
      },
    },
    orderBy: { username: "asc" },
    take: 200,
  });

  const graded = await prisma.rankingSubmission.groupBy({
    by: ["universalProfileId"],
    where: {
      universalProfileId: { in: profiles.map((p) => p.id) },
      status: "GRADED",
    },
    _count: { _all: true },
  });
  const gradedMap = new Map(
    graded.map((row) => [row.universalProfileId, row._count._all]),
  );
  const rules = getQualificationRules();

  const rows: AdminCreatorRow[] = profiles.map((profile) => {
    const gradedContestCount = gradedMap.get(profile.id) ?? 0;
    const creatorEnabled = profile.creatorProfile?.enabled === true;
    const evaluation = evaluateCreatorQualification({
      profileType: profile.profileType,
      status: profile.status,
      gradedContestCount,
      creatorEnabled,
    }, rules);
    return {
      profileId: profile.id,
      username: profile.username,
      displayName: profile.displayName,
      profileType: profile.profileType,
      status: profile.status,
      gradedContestCount,
      followerCount: profile._count.followsReceived,
      creatorEnabled,
      defaultRevealPreference:
        profile.creatorProfile?.defaultRevealPreference ?? "FREE_REVEAL",
      qualificationStatus: evaluation.status,
      reasons: evaluation.reasons,
    };
  });

  if (!input?.status || input.status === "ALL") return rows;
  return rows.filter((row) => row.qualificationStatus === input.status);
}

export async function getAdminCreatorDetail(profileId: string) {
  const row =
    (await listAdminCreators()).find((item) => item.profileId === profileId) ??
    null;
  if (!row) return null;

  const [entitlements, unlocks, ledger, boards] = await Promise.all([
    prisma.boardEntitlement.findMany({
      where: {
        OR: [{ creatorProfileId: profileId }, { viewerProfileId: profileId }],
      },
      orderBy: { createdAt: "desc" },
      take: 40,
      include: {
        viewer: { select: { username: true } },
        creator: { select: { username: true } },
      },
    }),
    prisma.boardUnlockEvent.findMany({
      where: { creatorProfileId: profileId },
      orderBy: { createdAt: "desc" },
      take: 40,
      include: {
        viewer: { select: { username: true, displayName: true } },
        contest: { select: { position: true, title: true } },
      },
    }),
    prisma.creatorLedgerEntry.findMany({
      where: { creatorProfileId: profileId },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
    prisma.rankingSubmission.findMany({
      where: { universalProfileId: profileId },
      orderBy: { updatedAt: "desc" },
      take: 20,
      include: {
        contest: { include: { week: true } },
      },
    }),
  ]);

  return { ...row, entitlements, unlocks, ledger, boards };
}

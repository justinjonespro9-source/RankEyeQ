/**
 * Generalized ownership claims for tracked BENCHMARK (Expert) and CREATOR profiles.
 *
 * Claiming links User → existing UniversalProfile. It never rewrites target
 * RankingSubmissions, scores, or profileType.
 */
import { prisma } from "@/lib/db";
import { normalizeUsername } from "@/lib/username";
import {
  sanitizeSocialHandle,
  validatePublicHttpUrl,
} from "@/lib/creator-verification-shared";
import type { ProfileType } from "@/lib/generated/prisma/client";

export class ProfileClaimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileClaimError";
  }
}

const MAX_NOTE_LENGTH = 500;
const CLAIMABLE_TYPES = new Set<ProfileType>(["BENCHMARK", "CREATOR"]);

export type ProfileClaimCollision = {
  contestId: string;
  position: string;
  weekNumber: number;
  claimantSubmissionId: string;
  targetSubmissionId: string;
};

export async function analyzeProfileClaimCollisions(input: {
  claimantProfileId: string;
  targetProfileId: string;
}): Promise<{
  claimantSubmissionCount: number;
  targetSubmissionCount: number;
  collisions: ProfileClaimCollision[];
}> {
  const [claimantSubs, targetSubs] = await Promise.all([
    prisma.rankingSubmission.findMany({
      where: { universalProfileId: input.claimantProfileId },
      select: {
        id: true,
        contestId: true,
        contest: { select: { position: true, week: { select: { weekNumber: true } } } },
      },
    }),
    prisma.rankingSubmission.findMany({
      where: { universalProfileId: input.targetProfileId },
      select: {
        id: true,
        contestId: true,
        contest: { select: { position: true, week: { select: { weekNumber: true } } } },
      },
    }),
  ]);

  const targetByContest = new Map(
    targetSubs.map((row) => [row.contestId, row] as const),
  );
  const collisions: ProfileClaimCollision[] = [];
  for (const sub of claimantSubs) {
    const target = targetByContest.get(sub.contestId);
    if (!target) continue;
    collisions.push({
      contestId: sub.contestId,
      position: sub.contest.position,
      weekNumber: sub.contest.week.weekNumber,
      claimantSubmissionId: sub.id,
      targetSubmissionId: target.id,
    });
  }

  return {
    claimantSubmissionCount: claimantSubs.length,
    targetSubmissionCount: targetSubs.length,
    collisions,
  };
}

export type RequestProfileClaimInput = {
  claimantUserId: string;
  claimantProfileId: string;
  targetUsername: string;
  creatorSiteUrl: string;
  socialHandle: string;
  publicProofUrl: string;
  claimNote?: string | null;
};

export async function requestProfileClaim(input: RequestProfileClaimInput) {
  const claimant = await prisma.universalProfile.findUnique({
    where: { id: input.claimantProfileId },
    include: { authUser: true },
  });
  if (!claimant) throw new ProfileClaimError("Profile not found.");
  if (claimant.profileType !== "HUMAN") {
    throw new ProfileClaimError("Only PUBLIC accounts can request a profile claim.");
  }
  if (!claimant.authUser || claimant.authUser.id !== input.claimantUserId) {
    throw new ProfileClaimError("Sign in with the account that owns this profile.");
  }

  const pending = await prisma.profileClaimRequest.findFirst({
    where: {
      claimantProfileId: claimant.id,
      status: "REQUESTED",
    },
  });
  if (pending) {
    throw new ProfileClaimError(
      "A profile claim is already awaiting RankEyeQ review.",
    );
  }

  const username = normalizeUsername(input.targetUsername);
  const target = await prisma.universalProfile.findUnique({
    where: { username },
    include: {
      authUser: true,
      creatorCompetitor: true,
    },
  });
  if (!target || !CLAIMABLE_TYPES.has(target.profileType)) {
    throw new ProfileClaimError(
      "Claim target must be an existing Expert or Creator profile username.",
    );
  }
  if (target.authUser) {
    throw new ProfileClaimError("That profile is already linked to an account.");
  }
  if (target.ownershipVerifiedAt) {
    throw new ProfileClaimError("That profile is already verified.");
  }
  if (
    target.profileType === "CREATOR" &&
    target.creatorCompetitor?.claimStatus === "VERIFIED"
  ) {
    throw new ProfileClaimError("That Creator profile is already verified.");
  }

  const site = validatePublicHttpUrl(input.creatorSiteUrl, "Creator content URL");
  if (!site.ok) throw new ProfileClaimError(site.error);
  const proof = validatePublicHttpUrl(input.publicProofUrl, "RankEyeQ proof URL");
  if (!proof.ok) throw new ProfileClaimError(proof.error);
  const handle = sanitizeSocialHandle(input.socialHandle);
  if (handle.length < 2) {
    throw new ProfileClaimError("Primary platform or handle is required.");
  }
  const note = input.claimNote?.trim() || null;
  if (note && note.length > MAX_NOTE_LENGTH) {
    throw new ProfileClaimError("Note is too long.");
  }

  const openOnTarget = await prisma.profileClaimRequest.findFirst({
    where: { targetProfileId: target.id, status: "REQUESTED" },
  });
  if (openOnTarget) {
    throw new ProfileClaimError(
      "Another claim for that profile is already under review.",
    );
  }

  return prisma.profileClaimRequest.create({
    data: {
      claimantUserId: input.claimantUserId,
      claimantProfileId: claimant.id,
      targetProfileId: target.id,
      status: "REQUESTED",
      creatorSiteUrl: site.url,
      socialHandle: handle,
      publicProofUrl: proof.url,
      claimNote: note,
    },
  });
}

export async function listProfileClaimQueue() {
  return prisma.profileClaimRequest.findMany({
    where: { status: "REQUESTED" },
    include: {
      claimantUser: { select: { id: true, email: true, name: true } },
      claimantProfile: {
        select: {
          id: true,
          username: true,
          displayName: true,
          profileType: true,
        },
      },
      targetProfile: {
        select: {
          id: true,
          username: true,
          displayName: true,
          profileType: true,
          ownershipVerifiedAt: true,
          creatorCompetitor: { select: { claimStatus: true, brandName: true } },
          expertSource: {
            select: { publicationName: true, analystName: true },
          },
        },
      },
    },
    orderBy: { requestedAt: "asc" },
  });
}

/**
 * Approve ownership link onto an existing BENCHMARK or CREATOR UniversalProfile.
 *
 * - profileType unchanged
 * - target RankingSubmissions unchanged
 * - claimant RankingSubmissions remain on the retired HUMAN shell
 * - collisions are reported but never auto-deleted
 */
export async function approveProfileClaimLink(input: {
  claimRequestId: string;
  adminUserId: string;
  verificationNotes?: string | null;
  /** Required when contest collisions exist — Admin acknowledges leaving both histories. */
  acknowledgeCollisions?: boolean;
}) {
  const claim = await prisma.profileClaimRequest.findUnique({
    where: { id: input.claimRequestId },
    include: {
      claimantProfile: true,
      claimantUser: true,
      targetProfile: { include: { creatorCompetitor: true, authUser: true } },
    },
  });
  if (!claim) throw new ProfileClaimError("Claim request not found.");
  if (claim.status !== "REQUESTED") {
    throw new ProfileClaimError("Claim is not awaiting review.");
  }
  if (claim.claimantProfile.profileType !== "HUMAN") {
    throw new ProfileClaimError("Claimant must still be a PUBLIC profile.");
  }
  if (!CLAIMABLE_TYPES.has(claim.targetProfile.profileType)) {
    throw new ProfileClaimError("Target must be Expert or Creator.");
  }
  if (claim.targetProfile.authUser) {
    throw new ProfileClaimError("Target profile is already linked.");
  }

  const analysis = await analyzeProfileClaimCollisions({
    claimantProfileId: claim.claimantProfileId,
    targetProfileId: claim.targetProfileId,
  });
  if (analysis.collisions.length > 0 && !input.acknowledgeCollisions) {
    throw new ProfileClaimError(
      `Contest collisions require Admin acknowledgment (${analysis.collisions.length} overlapping contest(s)). Both histories will be preserved — target boards stay on the Expert/Creator; claimant boards stay on the retired PUBLIC shell.`,
    );
  }

  const targetType = claim.targetProfile.profileType;
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    // Move auth ownership only — never rewrite target competitive rows.
    await tx.user.update({
      where: { id: claim.claimantUserId },
      data: { universalProfileId: claim.targetProfileId },
    });

    await tx.universalProfile.update({
      where: { id: claim.targetProfileId },
      data: {
        ownershipVerifiedAt: now,
        competitorActive: true,
        publicVisible: true,
        status: "ACTIVE",
        websiteUrl:
          claim.targetProfile.websiteUrl ?? claim.creatorSiteUrl ?? undefined,
      },
    });

    if (
      targetType === "CREATOR" &&
      claim.targetProfile.creatorCompetitor
    ) {
      await tx.creatorCompetitorProfile.update({
        where: { id: claim.targetProfile.creatorCompetitor.id },
        data: {
          claimStatus: "VERIFIED",
          verifiedAt: now,
          verifiedByUserId: input.adminUserId,
          rejectedAt: null,
          active: true,
          creatorSiteUrl:
            claim.creatorSiteUrl ??
            claim.targetProfile.creatorCompetitor.creatorSiteUrl,
          socialHandle:
            claim.socialHandle ??
            claim.targetProfile.creatorCompetitor.socialHandle,
          publicProofUrl:
            claim.publicProofUrl ??
            claim.targetProfile.creatorCompetitor.publicProofUrl,
          verificationNotes: input.verificationNotes?.trim() || null,
        },
      });
    }

    // Retire HUMAN shell; keep its RankingSubmissions attached (no deletes).
    await tx.universalProfile.update({
      where: { id: claim.claimantProfileId },
      data: {
        publicVisible: false,
        competitorActive: false,
        status: "SUSPENDED",
      },
    });

    const updated = await tx.profileClaimRequest.update({
      where: { id: claim.id },
      data: {
        status: "APPROVED",
        reviewedAt: now,
        reviewedByUserId: input.adminUserId,
        verificationNotes: input.verificationNotes?.trim() || null,
      },
    });

    return {
      claim: updated,
      targetProfileId: claim.targetProfileId,
      targetProfileType: targetType,
      username: claim.targetProfile.username,
      collisionsPreserved: analysis.collisions.length,
      claimantSubmissionCount: analysis.claimantSubmissionCount,
      targetSubmissionCount: analysis.targetSubmissionCount,
    };
  });
}

export async function rejectProfileClaim(input: {
  claimRequestId: string;
  adminUserId: string;
  verificationNotes?: string | null;
}) {
  const claim = await prisma.profileClaimRequest.findUnique({
    where: { id: input.claimRequestId },
  });
  if (!claim) throw new ProfileClaimError("Claim request not found.");
  if (claim.status !== "REQUESTED") {
    throw new ProfileClaimError("Claim is not awaiting review.");
  }

  return prisma.profileClaimRequest.update({
    where: { id: claim.id },
    data: {
      status: "REJECTED",
      reviewedAt: new Date(),
      reviewedByUserId: input.adminUserId,
      verificationNotes: input.verificationNotes?.trim() || null,
    },
  });
}

export function isOwnershipVerified(input: {
  ownershipVerifiedAt?: Date | null;
  profileType: ProfileType;
  creatorClaimStatus?: string | null;
  hasAuthUser?: boolean;
}): boolean {
  if (input.ownershipVerifiedAt) return true;
  if (
    input.profileType === "CREATOR" &&
    input.creatorClaimStatus === "VERIFIED"
  ) {
    return true;
  }
  return false;
}

export function isProfileClaimablePublicly(input: {
  profileType: ProfileType;
  hasAuthUser: boolean;
  ownershipVerifiedAt?: Date | null;
  creatorClaimStatus?: string | null;
}): boolean {
  if (!CLAIMABLE_TYPES.has(input.profileType)) return false;
  if (input.hasAuthUser) return false;
  if (isOwnershipVerified(input)) return false;
  return true;
}

import { prisma } from "@/lib/db";
import { normalizeUsername } from "@/lib/username";
import {
  CREATOR_CLAIM_REVIEW_COPY,
  CREATOR_TRACKED_DISCLAIMER,
  CREATOR_VERIFICATION_CRITERIA,
  isCreatorVerified,
  sanitizeSocialHandle,
  validatePublicHttpUrl,
} from "@/lib/creator-verification-shared";

export {
  CREATOR_CLAIM_REVIEW_COPY,
  CREATOR_TRACKED_DISCLAIMER,
  CREATOR_VERIFICATION_CRITERIA,
  isCreatorVerified,
  sanitizeSocialHandle,
  validatePublicHttpUrl,
};

export class CreatorVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreatorVerificationError";
  }
}

const MAX_NOTE_LENGTH = 500;
const MAX_BRAND_LENGTH = 80;

export type CreatorClaimRequestInput = {
  profileId: string;
  creatorSiteUrl: string;
  socialHandle: string;
  publicProofUrl: string;
  claimNote?: string | null;
  /** Optional tracked creator username to claim instead of promoting in place. */
  claimTargetUsername?: string | null;
  brandName?: string | null;
};

/**
 * PUBLIC (HUMAN) user requests Creator verification.
 * Never changes profileType — admin approval is required.
 */
export async function requestCreatorVerification(
  input: CreatorClaimRequestInput,
) {
  const profile = await prisma.universalProfile.findUnique({
    where: { id: input.profileId },
    include: { creatorCompetitor: true, authUser: true },
  });
  if (!profile) {
    throw new CreatorVerificationError("Profile not found.");
  }
  if (profile.profileType !== "HUMAN") {
    throw new CreatorVerificationError(
      "Only PUBLIC accounts can request Creator verification.",
    );
  }
  if (!profile.authUser) {
    throw new CreatorVerificationError(
      "Sign in with a linked account to request Creator verification.",
    );
  }
  if (profile.creatorCompetitor?.claimStatus === "VERIFIED") {
    throw new CreatorVerificationError("This account is already verified.");
  }
  if (profile.creatorCompetitor?.claimStatus === "REQUESTED") {
    throw new CreatorVerificationError(
      "Creator verification is already requested. RankEyeQ reviews requests manually.",
    );
  }

  const site = validatePublicHttpUrl(input.creatorSiteUrl, "Creator content URL");
  if (!site.ok) throw new CreatorVerificationError(site.error);
  const proof = validatePublicHttpUrl(input.publicProofUrl, "RankEyeQ proof URL");
  if (!proof.ok) throw new CreatorVerificationError(proof.error);

  const handle = sanitizeSocialHandle(input.socialHandle);
  if (handle.length < 2) {
    throw new CreatorVerificationError(
      "Primary platform or handle is required.",
    );
  }

  const note = input.claimNote?.trim() || null;
  if (note && note.length > MAX_NOTE_LENGTH) {
    throw new CreatorVerificationError("Note is too long.");
  }

  let brandName = input.brandName?.trim() || null;
  if (brandName && brandName.length > MAX_BRAND_LENGTH) {
    throw new CreatorVerificationError("Brand / show name is too long.");
  }

  let claimTargetProfileId: string | null = null;
  const targetUsername = input.claimTargetUsername?.trim();
  if (targetUsername) {
    const username = normalizeUsername(targetUsername);
    const target = await prisma.universalProfile.findUnique({
      where: { username },
      include: { creatorCompetitor: true, authUser: true },
    });
    if (!target || target.profileType !== "CREATOR") {
      throw new CreatorVerificationError(
        "Claim target must be an existing tracked Creator profile username.",
      );
    }
    if (target.authUser) {
      throw new CreatorVerificationError(
        "That Creator profile is already linked to an account.",
      );
    }
    if (target.creatorCompetitor?.claimStatus === "VERIFIED") {
      throw new CreatorVerificationError(
        "That Creator profile is already verified.",
      );
    }
    claimTargetProfileId = target.id;
    brandName =
      brandName ||
      target.creatorCompetitor?.brandName ||
      target.displayName;
  }

  const data = {
    claimStatus: "REQUESTED" as const,
    claimRequestedAt: new Date(),
    rejectedAt: null,
    creatorSiteUrl: site.url,
    socialHandle: handle,
    publicProofUrl: proof.url,
    claimNote: note,
    brandName:
      brandName ||
      profile.creatorCompetitor?.brandName ||
      profile.displayName,
    personName:
      profile.creatorCompetitor?.personName || profile.displayName,
    claimTargetProfileId,
    verificationNotes: null,
    active: profile.creatorCompetitor?.active ?? true,
  };

  if (profile.creatorCompetitor) {
    return prisma.creatorCompetitorProfile.update({
      where: { id: profile.creatorCompetitor.id },
      data,
    });
  }

  return prisma.creatorCompetitorProfile.create({
    data: {
      universalProfileId: profile.id,
      ...data,
    },
  });
}

export async function listCreatorVerificationQueue() {
  return prisma.creatorCompetitorProfile.findMany({
    where: { claimStatus: "REQUESTED" },
    include: {
      universalProfile: {
        include: { authUser: true },
      },
      claimTargetProfile: {
        include: { creatorCompetitor: true },
      },
    },
    orderBy: { claimRequestedAt: "asc" },
  });
}

/**
 * Approve in place: promote the requesting HUMAN profile to CREATOR + VERIFIED.
 * Preserves the same UniversalProfile id (historical rankings stay attached).
 */
export async function approveCreatorVerificationInPlace(input: {
  requestingProfileId: string;
  adminUserId: string;
  verificationNotes?: string | null;
}) {
  const profile = await prisma.universalProfile.findUnique({
    where: { id: input.requestingProfileId },
    include: { creatorCompetitor: true, authUser: true },
  });
  if (!profile?.creatorCompetitor) {
    throw new CreatorVerificationError("No Creator verification request found.");
  }
  if (profile.creatorCompetitor.claimStatus !== "REQUESTED") {
    throw new CreatorVerificationError("Request is not awaiting review.");
  }
  if (profile.profileType !== "HUMAN") {
    throw new CreatorVerificationError(
      "In-place approval requires a PUBLIC (HUMAN) requesting profile.",
    );
  }
  if (profile.creatorCompetitor.claimTargetProfileId) {
    throw new CreatorVerificationError(
      "This request targets a tracked Creator. Use link approval instead.",
    );
  }
  if (!profile.authUser) {
    throw new CreatorVerificationError(
      "Requesting profile has no linked auth account.",
    );
  }

  return prisma.$transaction(async (tx) => {
    await tx.universalProfile.update({
      where: { id: profile.id },
      data: {
        profileType: "CREATOR",
        competitorActive: true,
        publicVisible: true,
        status: "ACTIVE",
      },
    });
    const competitor = await tx.creatorCompetitorProfile.update({
      where: { id: profile.creatorCompetitor!.id },
      data: {
        claimStatus: "VERIFIED",
        verifiedAt: new Date(),
        verifiedByUserId: input.adminUserId,
        rejectedAt: null,
        active: true,
        verificationNotes: input.verificationNotes?.trim() || null,
        personName:
          profile.creatorCompetitor!.personName || profile.displayName,
        brandName:
          profile.creatorCompetitor!.brandName || profile.displayName,
      },
    });
    return { profileId: profile.id, competitor };
  });
}

/**
 * Manually link a requesting HUMAN auth user onto an existing tracked CREATOR
 * UniversalProfile. Prefer tracked historical boards when contest collisions exist.
 * Does not auto-match by name/email/handle.
 */
export async function approveCreatorClaimLink(input: {
  requestingProfileId: string;
  targetCreatorProfileId: string;
  adminUserId: string;
  verificationNotes?: string | null;
}) {
  const requesting = await prisma.universalProfile.findUnique({
    where: { id: input.requestingProfileId },
    include: { creatorCompetitor: true, authUser: true },
  });
  if (!requesting?.authUser) {
    throw new CreatorVerificationError(
      "Requesting profile must be a signed-in PUBLIC account.",
    );
  }
  if (requesting.profileType !== "HUMAN") {
    throw new CreatorVerificationError(
      "Only PUBLIC profiles can be linked onto a tracked Creator.",
    );
  }
  if (requesting.creatorCompetitor?.claimStatus !== "REQUESTED") {
    throw new CreatorVerificationError("Request is not awaiting review.");
  }

  const target = await prisma.universalProfile.findUnique({
    where: { id: input.targetCreatorProfileId },
    include: { creatorCompetitor: true, authUser: true },
  });
  if (!target || target.profileType !== "CREATOR" || !target.creatorCompetitor) {
    throw new CreatorVerificationError("Tracked Creator profile not found.");
  }
  if (target.authUser) {
    throw new CreatorVerificationError(
      "Tracked Creator is already linked to an account.",
    );
  }
  if (target.creatorCompetitor.claimStatus === "VERIFIED") {
    throw new CreatorVerificationError("Tracked Creator is already verified.");
  }

  const requestedTarget =
    requesting.creatorCompetitor.claimTargetProfileId ?? null;
  if (requestedTarget && requestedTarget !== target.id) {
    throw new CreatorVerificationError(
      "Admin target does not match the creator named in the request.",
    );
  }

  return prisma.$transaction(async (tx) => {
    const humanSubs = await tx.rankingSubmission.findMany({
      where: { universalProfileId: requesting.id },
      select: { id: true, contestId: true },
    });
    const creatorContestIds = new Set(
      (
        await tx.rankingSubmission.findMany({
          where: { universalProfileId: target.id },
          select: { contestId: true },
        })
      ).map((row) => row.contestId),
    );

    for (const sub of humanSubs) {
      if (creatorContestIds.has(sub.contestId)) {
        // Keep tracked creator board; drop duplicate human contest row.
        await tx.rankingPick.deleteMany({ where: { submissionId: sub.id } });
        await tx.rankingSubmission.delete({ where: { id: sub.id } });
      } else {
        await tx.rankingSubmission.update({
          where: { id: sub.id },
          data: { universalProfileId: target.id },
        });
      }
    }

    // Move auth link to tracked creator — same User, preserve identity resolution.
    await tx.user.update({
      where: { id: requesting.authUser!.id },
      data: { universalProfileId: target.id },
    });

    const proof = requesting.creatorCompetitor!;
    await tx.creatorCompetitorProfile.update({
      where: { id: target.creatorCompetitor!.id },
      data: {
        claimStatus: "VERIFIED",
        verifiedAt: new Date(),
        verifiedByUserId: input.adminUserId,
        rejectedAt: null,
        active: true,
        creatorSiteUrl: proof.creatorSiteUrl ?? target.creatorCompetitor!.sourceUrl,
        socialHandle: proof.socialHandle,
        socialUrl: proof.socialUrl,
        publicProofUrl: proof.publicProofUrl,
        claimNote: proof.claimNote,
        verificationNotes: input.verificationNotes?.trim() || null,
      },
    });

    // Retire the orphan HUMAN request shell without deleting contest history moves.
    await tx.creatorCompetitorProfile.delete({
      where: { id: proof.id },
    });
    await tx.universalProfile.update({
      where: { id: requesting.id },
      data: {
        publicVisible: false,
        competitorActive: false,
        status: "SUSPENDED",
      },
    });
    await tx.universalProfile.update({
      where: { id: target.id },
      data: {
        competitorActive: true,
        publicVisible: true,
        status: "ACTIVE",
      },
    });

    return {
      requestingProfileId: requesting.id,
      targetProfileId: target.id,
      username: target.username,
    };
  });
}

export async function rejectCreatorVerification(input: {
  requestingProfileId: string;
  adminUserId: string;
  verificationNotes?: string | null;
}) {
  const profile = await prisma.universalProfile.findUnique({
    where: { id: input.requestingProfileId },
    include: { creatorCompetitor: true },
  });
  if (!profile?.creatorCompetitor) {
    throw new CreatorVerificationError("No Creator verification request found.");
  }
  if (profile.creatorCompetitor.claimStatus !== "REQUESTED") {
    throw new CreatorVerificationError("Request is not awaiting review.");
  }

  // Remain PUBLIC — never escalate profileType on reject.
  if (profile.profileType === "HUMAN") {
    await prisma.universalProfile.update({
      where: { id: profile.id },
      data: { profileType: "HUMAN" },
    });
  }

  return prisma.creatorCompetitorProfile.update({
    where: { id: profile.creatorCompetitor.id },
    data: {
      claimStatus: "REJECTED",
      rejectedAt: new Date(),
      verifiedAt: null,
      verifiedByUserId: null,
      verificationNotes: input.verificationNotes?.trim() || null,
    },
  });
}

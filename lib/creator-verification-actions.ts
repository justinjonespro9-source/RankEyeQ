"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertAdmin, requireUniversalProfile } from "@/lib/auth/session";
import {
  CreatorVerificationError,
  approveCreatorVerificationInPlace,
  rejectCreatorVerification,
  requestCreatorVerification,
} from "@/lib/creator-verification";
import {
  ProfileClaimError,
  approveProfileClaimLink,
  rejectProfileClaim,
} from "@/lib/profile-claim";
import { logServerEvent } from "@/lib/log";
import { RATE_LIMITS, rateLimit, rateLimitErrorMessage } from "@/lib/rate-limit";
import { rateLimitKey } from "@/lib/request-ip";

export async function requestCreatorVerificationAction(formData: FormData) {
  const { user, universalProfile } = await requireUniversalProfile();

  const limited = rateLimit({
    key: await rateLimitKey("creator-claim", universalProfile.id),
    ...RATE_LIMITS.creatorClaim,
  });
  if (!limited.ok) {
    return {
      ok: false as const,
      error: rateLimitErrorMessage(limited),
    };
  }

  try {
    await requestCreatorVerification({
      profileId: universalProfile.id,
      creatorSiteUrl: String(formData.get("creatorSiteUrl") || ""),
      socialHandle: String(formData.get("socialHandle") || ""),
      publicProofUrl: String(formData.get("publicProofUrl") || ""),
      claimNote: String(formData.get("claimNote") || "") || null,
      claimTargetUsername:
        String(formData.get("claimTargetUsername") || "") || null,
      brandName: String(formData.get("brandName") || "") || null,
    });
  } catch (error) {
    logServerEvent(
      "creator.verification_request_failed",
      {
        route: "/account",
        profileId: universalProfile.id,
        step: "request",
        userId: user.id,
      },
      "warn",
    );
    return {
      ok: false as const,
      error:
        error instanceof CreatorVerificationError ||
        error instanceof ProfileClaimError
          ? error.message
          : "Unable to submit Creator verification request.",
    };
  }

  revalidatePath("/account");
  revalidatePath(`/profile/${universalProfile.username}`);
  revalidatePath("/admin/creators/verification");
  return { ok: true as const };
}

export async function approveCreatorVerificationAction(formData: FormData) {
  const admin = await assertAdmin();
  const requestingProfileId = String(formData.get("requestingProfileId") || "");
  const profileClaimRequestId = String(
    formData.get("profileClaimRequestId") || "",
  ).trim();
  const targetCreatorProfileId = String(
    formData.get("targetCreatorProfileId") || "",
  ).trim();
  const verificationNotes =
    String(formData.get("verificationNotes") || "") || null;
  const acknowledgeCollisions =
    String(formData.get("acknowledgeCollisions") || "") === "1";

  try {
    if (profileClaimRequestId) {
      await approveProfileClaimLink({
        claimRequestId: profileClaimRequestId,
        adminUserId: admin.user.id,
        verificationNotes,
        acknowledgeCollisions,
      });
    } else if (targetCreatorProfileId) {
      // Legacy CreatorCompetitorProfile link path — prefer ProfileClaimRequest.
      const { approveCreatorClaimLink } = await import(
        "@/lib/creator-verification"
      );
      await approveCreatorClaimLink({
        requestingProfileId,
        targetCreatorProfileId,
        adminUserId: admin.user.id,
        verificationNotes,
      });
    } else {
      await approveCreatorVerificationInPlace({
        requestingProfileId,
        adminUserId: admin.user.id,
        verificationNotes,
      });
    }
  } catch (error) {
    logServerEvent(
      "creator.verification_approve_failed",
      {
        route: "/admin/creators/verification",
        step: profileClaimRequestId
          ? "approve_profile_claim"
          : targetCreatorProfileId
            ? "approve_link"
            : "approve_inplace",
      },
      "warn",
    );
    redirect(
      `/admin/creators/verification?error=${encodeURIComponent(
        error instanceof CreatorVerificationError ||
          error instanceof ProfileClaimError
          ? error.message
          : "Approval failed",
      )}`,
    );
  }

  revalidatePath("/admin/creators/verification");
  revalidatePath("/admin/creators");
  revalidatePath("/leaderboards");
  revalidatePath("/account");
  redirect(
    "/admin/creators/verification?notice=" +
      encodeURIComponent("Profile claim / verification approved."),
  );
}

export async function rejectCreatorVerificationAction(formData: FormData) {
  const admin = await assertAdmin();
  const requestingProfileId = String(formData.get("requestingProfileId") || "");
  const profileClaimRequestId = String(
    formData.get("profileClaimRequestId") || "",
  ).trim();
  const verificationNotes =
    String(formData.get("verificationNotes") || "") || null;

  try {
    if (profileClaimRequestId) {
      await rejectProfileClaim({
        claimRequestId: profileClaimRequestId,
        adminUserId: admin.user.id,
        verificationNotes,
      });
    } else {
      await rejectCreatorVerification({
        requestingProfileId,
        adminUserId: admin.user.id,
        verificationNotes,
      });
    }
  } catch (error) {
    redirect(
      `/admin/creators/verification?error=${encodeURIComponent(
        error instanceof CreatorVerificationError ||
          error instanceof ProfileClaimError
          ? error.message
          : "Rejection failed",
      )}`,
    );
  }

  revalidatePath("/admin/creators/verification");
  revalidatePath("/account");
  redirect(
    "/admin/creators/verification?notice=" +
      encodeURIComponent("Claim / verification rejected."),
  );
}

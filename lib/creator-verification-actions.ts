"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertAdmin, requireUniversalProfile } from "@/lib/auth/session";
import {
  CreatorVerificationError,
  approveCreatorClaimLink,
  approveCreatorVerificationInPlace,
  rejectCreatorVerification,
  requestCreatorVerification,
} from "@/lib/creator-verification";
import { logServerEvent } from "@/lib/log";

export async function requestCreatorVerificationAction(formData: FormData) {
  const { universalProfile } = await requireUniversalProfile();

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
      },
      "warn",
    );
    return {
      ok: false as const,
      error:
        error instanceof CreatorVerificationError
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
  const targetCreatorProfileId = String(
    formData.get("targetCreatorProfileId") || "",
  ).trim();
  const verificationNotes =
    String(formData.get("verificationNotes") || "") || null;

  try {
    if (targetCreatorProfileId) {
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
        step: targetCreatorProfileId ? "approve_link" : "approve_inplace",
      },
      "warn",
    );
    redirect(
      `/admin/creators/verification?error=${encodeURIComponent(
        error instanceof CreatorVerificationError
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
      encodeURIComponent("Creator verification approved."),
  );
}

export async function rejectCreatorVerificationAction(formData: FormData) {
  const admin = await assertAdmin();
  const requestingProfileId = String(formData.get("requestingProfileId") || "");
  const verificationNotes =
    String(formData.get("verificationNotes") || "") || null;

  try {
    await rejectCreatorVerification({
      requestingProfileId,
      adminUserId: admin.user.id,
      verificationNotes,
    });
  } catch (error) {
    redirect(
      `/admin/creators/verification?error=${encodeURIComponent(
        error instanceof CreatorVerificationError
          ? error.message
          : "Rejection failed",
      )}`,
    );
  }

  revalidatePath("/admin/creators/verification");
  revalidatePath("/account");
  redirect(
    "/admin/creators/verification?notice=" +
      encodeURIComponent("Creator verification rejected."),
  );
}

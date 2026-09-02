"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { trackEvent } from "@/lib/analytics";
import { recordPolicyAcceptances } from "@/lib/legal/policy-acceptance";
import { requireAuthContext } from "@/lib/auth/session";
import {
  createOrResolveUniversalProfile,
  ProfileLinkError,
  updateOwnedUniversalProfile,
} from "@/lib/auth/profile-link";

export async function completeProfileSetupAction(formData: FormData) {
  const ctx = await requireAuthContext();
  if (ctx.universalProfile) {
    redirect("/account");
  }

  try {
    await createOrResolveUniversalProfile({
      userId: ctx.user.id,
      username: String(formData.get("username") || ""),
      displayName: String(formData.get("displayName") || ""),
      avatarUrl: String(formData.get("avatarUrl") || "") || null,
    });
    if (formData.get("acceptPolicies") === "on") {
      await recordPolicyAcceptances(ctx.user.id, ["terms", "privacy"]);
    }
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof ProfileLinkError
          ? error.message
          : "Unable to create profile",
    };
  }

  revalidatePath("/");
  revalidatePath("/account");
  revalidatePath("/rank");
  trackEvent("signup_completed");
  redirect("/rank");
}

export async function updateAccountProfileAction(formData: FormData) {
  const ctx = await requireAuthContext();
  if (!ctx.universalProfile) {
    redirect("/account/setup");
  }

  try {
    const profile = await updateOwnedUniversalProfile({
      userId: ctx.user.id,
      username: String(formData.get("username") || ""),
      displayName: String(formData.get("displayName") || ""),
      avatarUrl: String(formData.get("avatarUrl") || "") || null,
    });
    revalidatePath("/account");
    revalidatePath(`/profile/${profile.username}`);
    revalidatePath("/");
    return { ok: true as const, username: profile.username };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof ProfileLinkError
          ? error.message
          : "Unable to update profile",
    };
  }
}

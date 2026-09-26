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
import {
  AvatarStorageError,
  deleteUploadedAvatarIfOwned,
  isAvatarUploadConfigured,
  uploadProfileAvatarBlob,
} from "@/lib/avatar-storage";
import { isUploadedAvatarUrl } from "@/lib/avatar";

export async function completeProfileSetupAction(formData: FormData) {
  const ctx = await requireAuthContext();
  if (ctx.universalProfile) {
    redirect("/account");
  }

  try {
    // Optional hidden field set only after a successful upload during setup.
    // Empty → seed Google User.image inside createOrResolveUniversalProfile.
    const uploaded = String(formData.get("avatarUrl") || "").trim() || null;
    await createOrResolveUniversalProfile({
      userId: ctx.user.id,
      username: String(formData.get("username") || ""),
      displayName: String(formData.get("displayName") || ""),
      avatarUrl: uploaded,
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
    const { updateOwnedProfileContent } = await import("@/lib/profile-content");
    const profile = await updateOwnedProfileContent({
      userId: ctx.user.id,
      username: String(formData.get("username") || ""),
      displayName: String(formData.get("displayName") || ""),
      headline: formData.has("headline")
        ? String(formData.get("headline") || "")
        : undefined,
      bio: formData.has("bio") ? String(formData.get("bio") || "") : undefined,
      affiliation: formData.has("affiliation")
        ? String(formData.get("affiliation") || "")
        : undefined,
      websiteUrl: formData.has("websiteUrl")
        ? String(formData.get("websiteUrl") || "")
        : undefined,
      xUrl: formData.has("xUrl") ? String(formData.get("xUrl") || "") : undefined,
      youtubeUrl: formData.has("youtubeUrl")
        ? String(formData.get("youtubeUrl") || "")
        : undefined,
      instagramUrl: formData.has("instagramUrl")
        ? String(formData.get("instagramUrl") || "")
        : undefined,
      tiktokUrl: formData.has("tiktokUrl")
        ? String(formData.get("tiktokUrl") || "")
        : undefined,
      podcastUrl: formData.has("podcastUrl")
        ? String(formData.get("podcastUrl") || "")
        : undefined,
      featuredLinkTitle: formData.has("featuredLinkTitle")
        ? String(formData.get("featuredLinkTitle") || "")
        : undefined,
      featuredLinkUrl: formData.has("featuredLinkUrl")
        ? String(formData.get("featuredLinkUrl") || "")
        : undefined,
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

/**
 * Upload (or replace) the signed-in human's profile photo.
 * During setup (no UniversalProfile yet), returns the Blob URL for a hidden field.
 */
export async function uploadProfilePhotoAction(formData: FormData) {
  const ctx = await requireAuthContext();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false as const, error: "Choose a photo to upload." };
  }

  try {
    const url = await uploadProfileAvatarBlob({
      userId: ctx.user.id,
      file,
    });

    if (ctx.universalProfile) {
      const previous = ctx.universalProfile.avatarUrl;
      await updateOwnedUniversalProfile({
        userId: ctx.user.id,
        username: ctx.universalProfile.username,
        displayName: ctx.universalProfile.displayName,
        avatarUrl: url,
      });
      if (previous && previous !== url) {
        await deleteUploadedAvatarIfOwned(previous);
      }
      revalidatePath("/account");
      revalidatePath(`/profile/${ctx.universalProfile.username}`);
      revalidatePath("/");
    }

    return { ok: true as const, url };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof AvatarStorageError || error instanceof ProfileLinkError
          ? error.message
          : "Unable to upload photo",
    };
  }
}

/**
 * Clear custom photo and fall back to Google (User.image) when available.
 */
export async function removeProfilePhotoAction() {
  const ctx = await requireAuthContext();
  if (!ctx.universalProfile) {
    return { ok: false as const, error: "Complete profile setup first." };
  }

  try {
    const previous = ctx.universalProfile.avatarUrl;
    const fallback = ctx.user.image?.trim() || null;
    // If current is already the Google image, clearing yields initials.
    const next =
      previous && fallback && previous === fallback ? null : fallback;

    await updateOwnedUniversalProfile({
      userId: ctx.user.id,
      username: ctx.universalProfile.username,
      displayName: ctx.universalProfile.displayName,
      avatarUrl: next,
    });

    if (isUploadedAvatarUrl(previous)) {
      await deleteUploadedAvatarIfOwned(previous);
    }

    revalidatePath("/account");
    revalidatePath(`/profile/${ctx.universalProfile.username}`);
    revalidatePath("/");
    return { ok: true as const, avatarUrl: next };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof ProfileLinkError
          ? error.message
          : "Unable to remove photo",
    };
  }
}

export async function getAvatarUploadAvailability() {
  return isAvatarUploadConfigured();
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logAdminAction } from "@/lib/admin/audit";
import { assertAdmin } from "@/lib/auth/session";
import type { ContestPosition } from "@/lib/generated/prisma/client";
import {
  ExpertIdentityError,
  createExpertAnalyst,
  setExpertDirectoryActive,
  updateExpertAnalystMetadata,
} from "@/lib/expert-identity";

function revalidateExperts() {
  revalidatePath("/admin/experts");
  revalidatePath("/admin/benchmarks");
  revalidatePath("/rankers");
  revalidatePath("/leaderboards");
}

function parsePositions(formData: FormData): ContestPosition[] {
  const raw = formData.getAll("positions").map(String);
  const allowed = new Set(["QB", "RB", "WR", "TE", "DEF"]);
  return raw.filter((value): value is ContestPosition => allowed.has(value));
}

export async function createExpertAnalystAction(formData: FormData) {
  const admin = await assertAdmin();
  try {
    const profile = await createExpertAnalyst({
      analystName: String(formData.get("analystName") || ""),
      publicationName: String(formData.get("publicationName") || ""),
      username: String(formData.get("username") || "").trim() || undefined,
      sourceUrl: String(formData.get("sourceUrl") || "").trim() || null,
      positionsCovered: parsePositions(formData),
      competitorActive: formData.get("competitorActive") !== "false",
      notes: String(formData.get("notes") || "").trim() || null,
    });
    await logAdminAction({
      adminUserId: admin.user.id,
      action: "expert.analyst_created",
      entityType: "UniversalProfile",
      entityId: profile.id,
      metadata: {
        username: profile.username,
        displayName: profile.displayName,
      },
    });
  } catch (error) {
    const message =
      error instanceof ExpertIdentityError
        ? error.message
        : "Unable to create Expert";
    redirect(`/admin/experts?error=${encodeURIComponent(message)}`);
  }
  revalidateExperts();
  redirect("/admin/experts?created=1");
}

export async function setExpertActiveAction(formData: FormData) {
  const admin = await assertAdmin();
  const profileId = String(formData.get("universalProfileId") || "");
  const active = String(formData.get("active") || "") === "true";
  try {
    await setExpertDirectoryActive({
      universalProfileId: profileId,
      active,
    });
    await logAdminAction({
      adminUserId: admin.user.id,
      action: active ? "expert.activated" : "expert.deactivated",
      entityType: "UniversalProfile",
      entityId: profileId,
    });
  } catch (error) {
    const message =
      error instanceof ExpertIdentityError
        ? error.message
        : "Unable to update Expert status";
    redirect(`/admin/experts?error=${encodeURIComponent(message)}`);
  }
  revalidateExperts();
  redirect("/admin/experts");
}

export async function updateExpertMetadataAction(formData: FormData) {
  const admin = await assertAdmin();
  const profileId = String(formData.get("universalProfileId") || "");
  try {
    await updateExpertAnalystMetadata({
      universalProfileId: profileId,
      analystName: String(formData.get("analystName") || "") || undefined,
      publicationName:
        String(formData.get("publicationName") || "") || undefined,
      sourceUrl: String(formData.get("sourceUrl") || "").trim() || null,
      positionsCovered: parsePositions(formData),
      notes: String(formData.get("notes") || "").trim() || null,
    });
    await logAdminAction({
      adminUserId: admin.user.id,
      action: "expert.metadata_updated",
      entityType: "UniversalProfile",
      entityId: profileId,
    });
  } catch (error) {
    const message =
      error instanceof ExpertIdentityError
        ? error.message
        : "Unable to update Expert";
    redirect(`/admin/experts?error=${encodeURIComponent(message)}`);
  }
  revalidateExperts();
  redirect("/admin/experts?updated=1");
}

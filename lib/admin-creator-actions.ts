"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logAdminAction } from "@/lib/admin/audit";
import { logAdminImpact } from "@/lib/log";
import { assertAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import type {
  EntitlementType,
  LedgerEntryStatus,
  LedgerEntryType,
} from "@/lib/generated/prisma/client";
import { CreatorError, setCreatorOptIn } from "@/lib/social/creator";
import {
  grantBoardEntitlement,
  revokeBoardEntitlement,
} from "@/lib/social/entitlements";
import { createCreatorLedgerEntry } from "@/lib/social/ledger";

function revalidateCreatorAdmin(profileId?: string) {
  revalidatePath("/admin/creators");
  revalidatePath("/creator");
  revalidatePath("/rankers");
  if (profileId) {
    revalidatePath(`/admin/creators/${profileId}`);
  }
}

async function resolveProfile(usernameOrId: string) {
  const value = usernameOrId.trim();
  if (!value) return null;
  return prisma.universalProfile.findFirst({
    where: {
      OR: [{ id: value }, { username: value.toLowerCase() }],
    },
  });
}

export async function adminSetCreatorEnabledAction(formData: FormData) {
  const admin = await assertAdmin();
  const profileId = String(formData.get("profileId") || "");
  const enabled = String(formData.get("enabled") || "") === "true";

  try {
    await setCreatorOptIn({ profileId, enabled });
  } catch (error) {
    redirect(
      `/admin/creators/${profileId}?error=${encodeURIComponent(
        error instanceof CreatorError ? error.message : "Unable to update creator",
      )}`,
    );
  }

  await logAdminAction({
    adminUserId: admin.user.id,
    action: enabled ? "creator.enable" : "creator.disable",
    entityType: "UniversalProfile",
    entityId: profileId,
    metadata: { enabled },
  });

  revalidateCreatorAdmin(profileId);
  redirect(`/admin/creators/${profileId}?notice=${enabled ? "Creator enabled" : "Creator disabled"}`);
}

export async function adminGrantEntitlementAction(formData: FormData) {
  const admin = await assertAdmin();
  logAdminImpact("entitlement.grant", { adminUserId: admin.user.id });
  const viewer = await resolveProfile(String(formData.get("viewer") || ""));
  if (!viewer) {
    redirect("/admin/creators?error=Viewer%20profile%20not%20found");
  }

  const entitlementType = String(
    formData.get("entitlementType") || "SINGLE_BOARD",
  ) as EntitlementType;
  const creatorRaw = String(formData.get("creator") || "").trim();
  const contestId = String(formData.get("contestId") || "").trim() || null;
  const weekId = String(formData.get("weekId") || "").trim() || null;
  const creator = creatorRaw ? await resolveProfile(creatorRaw) : null;
  const source = String(formData.get("source") || "admin");
  const expiresRaw = String(formData.get("expiresAt") || "").trim();

  const entitlement = await grantBoardEntitlement({
    viewerProfileId: viewer.id,
    entitlementType,
    contestId,
    creatorProfileId: creator?.id ?? null,
    weekId,
    source,
    expiresAt: expiresRaw ? new Date(expiresRaw) : null,
  });

  await logAdminAction({
    adminUserId: admin.user.id,
    action: "entitlement.grant",
    entityType: "BoardEntitlement",
    entityId: entitlement.id,
    metadata: {
      viewerProfileId: viewer.id,
      entitlementType,
      contestId,
      creatorProfileId: creator?.id ?? null,
      weekId,
      source,
    },
  });

  revalidateCreatorAdmin(creator?.id ?? viewer.id);
  redirect(
    `/admin/creators?notice=${encodeURIComponent("Entitlement granted")}`,
  );
}

export async function adminRevokeEntitlementAction(formData: FormData) {
  const admin = await assertAdmin();
  logAdminImpact("entitlement.revoke", { adminUserId: admin.user.id });
  const entitlementId = String(formData.get("entitlementId") || "");
  const profileId = String(formData.get("profileId") || "");
  await revokeBoardEntitlement(entitlementId);

  await logAdminAction({
    adminUserId: admin.user.id,
    action: "entitlement.revoke",
    entityType: "BoardEntitlement",
    entityId: entitlementId,
  });

  revalidateCreatorAdmin(profileId || undefined);
  redirect(
    profileId
      ? `/admin/creators/${profileId}?notice=${encodeURIComponent("Entitlement revoked")}`
      : `/admin/creators?notice=${encodeURIComponent("Entitlement revoked")}`,
  );
}

export async function adminCreateTestLedgerEntryAction(formData: FormData) {
  const admin = await assertAdmin();
  const creator = await resolveProfile(String(formData.get("creator") || ""));
  if (!creator) {
    redirect("/admin/creators?error=Creator%20profile%20not%20found");
  }

  const viewerRaw = String(formData.get("viewer") || "").trim();
  const viewer = viewerRaw ? await resolveProfile(viewerRaw) : null;
  const contestId = String(formData.get("contestId") || "").trim() || null;
  const type = (String(formData.get("type") || "TEST") as LedgerEntryType) || "TEST";
  const status =
    (String(formData.get("status") || "PENDING") as LedgerEntryStatus) ||
    "PENDING";

  const entry = await createCreatorLedgerEntry({
    creatorProfileId: creator.id,
    viewerProfileId: viewer?.id ?? null,
    contestId,
    type,
    status,
    grossAmountMinor: Number(formData.get("grossAmountMinor") || 0) || 0,
    platformFeeMinor: Number(formData.get("platformFeeMinor") || 0) || 0,
    creatorAmountMinor: Number(formData.get("creatorAmountMinor") || 0) || 0,
  });

  await logAdminAction({
    adminUserId: admin.user.id,
    action: "ledger.test_create",
    entityType: "CreatorLedgerEntry",
    entityId: entry.id,
    metadata: {
      creatorProfileId: creator.id,
      type,
      status,
    },
  });

  revalidateCreatorAdmin(creator.id);
  redirect(
    `/admin/creators/${creator.id}?notice=${encodeURIComponent("Test ledger entry created")}`,
  );
}

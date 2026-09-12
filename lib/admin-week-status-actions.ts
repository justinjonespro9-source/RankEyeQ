"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin } from "@/lib/auth/session";
import {
  isWeeklyAvailability,
  setRankableAvailability,
  syncWeekAvailabilityFromSeasonPlayers,
} from "@/lib/admin/week-status";
import { logAdminAction } from "@/lib/admin/audit";

function revalidateWeekStatus(weekId?: string) {
  revalidatePath("/admin/week-status");
  revalidatePath("/admin/ai");
  revalidatePath("/rank");
  if (weekId) {
    revalidatePath(`/admin/week-status?weekId=${weekId}`);
  }
  for (const position of ["qb", "rb", "wr", "te", "def"]) {
    revalidatePath(`/rank/${position}`);
  }
}

export async function setWeekPlayerStatusAction(formData: FormData) {
  const admin = await assertAdmin();
  const weekId = String(formData.get("weekId") || "");
  const availability = String(formData.get("availability") || "").toUpperCase();
  const ids = formData
    .getAll("rankableEntryId")
    .map((value) => String(value))
    .filter(Boolean);

  if (!isWeeklyAvailability(availability)) {
    throw new Error("Invalid availability status");
  }
  if (ids.length === 0) {
    throw new Error("Select at least one player");
  }

  await setRankableAvailability({
    rankableEntryIds: ids,
    availability,
  });
  await logAdminAction({
    adminUserId: admin.user.id,
    action: "week_status.updated",
    entityType: "Week",
    entityId: weekId || "unknown",
    metadata: { availability, count: ids.length, ids: ids.slice(0, 20) },
  });
  revalidateWeekStatus(weekId);
}

export async function bulkMarkOutAction(formData: FormData) {
  formData.set("availability", "OUT");
  await setWeekPlayerStatusAction(formData);
}

export async function bulkMarkActiveAction(formData: FormData) {
  formData.set("availability", "ACTIVE");
  await setWeekPlayerStatusAction(formData);
}

export async function syncWeekStatusFromProviderAction(formData: FormData) {
  const admin = await assertAdmin();
  const weekId = String(formData.get("weekId") || "");
  if (!weekId) throw new Error("weekId required");
  const result = await syncWeekAvailabilityFromSeasonPlayers(weekId);
  await logAdminAction({
    adminUserId: admin.user.id,
    action: "week_status.synced_from_season",
    entityType: "Week",
    entityId: weekId,
    metadata: { updated: result.updated },
  });
  revalidateWeekStatus(weekId);
}

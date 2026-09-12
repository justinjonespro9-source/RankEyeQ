"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertAdmin } from "@/lib/auth/session";
import {
  isWeeklyAvailability,
  setRankableAvailability,
  syncWeekAvailabilityFromSeasonPlayers,
} from "@/lib/admin/week-status";
import { logAdminAction } from "@/lib/admin/audit";
import { syncWeekInjuriesFromNflCom } from "@/lib/nfl/injury-sync";

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

export async function syncNflInjuryStatusAction(formData: FormData) {
  const admin = await assertAdmin();
  const weekId = String(formData.get("weekId") || "");
  const position = String(formData.get("position") || "ALL");
  if (!weekId) throw new Error("weekId required");

  const result = await syncWeekInjuriesFromNflCom({
    weekId,
    apply: true,
    useCbsFallback: true,
  });

  await logAdminAction({
    adminUserId: admin.user.id,
    action: "week_status.injury_synced",
    entityType: "Week",
    entityId: weekId,
    metadata: {
      ok: result.ok,
      source: result.source,
      sourceUrl: result.sourceUrl,
      matched: result.matched,
      updated: result.updated,
      unchanged: result.unchanged,
      questionable: result.questionable,
      doubtful: result.doubtful,
      out: result.out,
      unmatched: result.unmatched,
      ambiguous: result.ambiguous,
      errors: result.errors.slice(0, 10),
      unmatchedNames: result.matches
        .filter((m) => m.status !== "matched")
        .slice(0, 30)
        .map((m) => `${m.row.name} (${m.row.team})`),
    },
  });

  revalidateWeekStatus(weekId);

  const params = new URLSearchParams({
    weekId,
    position,
    synced: result.ok ? "1" : "0",
    matched: String(result.matched),
    updated: String(result.updated),
    unchanged: String(result.unchanged),
    questionable: String(result.questionable),
    doubtful: String(result.doubtful),
    out: String(result.out),
    unmatched: String(result.unmatched),
    source: result.source,
  });
  if (result.errors[0]) {
    params.set("syncError", result.errors[0].slice(0, 180));
  }
  redirect(`/admin/week-status?${params.toString()}`);
}

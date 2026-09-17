"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { assertAdmin } from "@/lib/auth/session";
import {
  clearWeekManualOverrides,
  isWeeklyDesignation,
  setWeekPlayerDesignations,
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
  if (!weekId) throw new Error("weekId required");

  const designationRaw = String(
    formData.get("designation") || formData.get("availability") || "",
  ).toUpperCase();
  const designation =
    designationRaw === "ACTIVE" ? "AVAILABLE" : designationRaw;

  if (!isWeeklyDesignation(designation)) {
    throw new Error("Invalid weekly availability designation");
  }

  const ids = formData
    .getAll("rankableEntryId")
    .map((value) => String(value))
    .filter(Boolean);
  if (ids.length === 0) {
    throw new Error("Select at least one player");
  }

  const injuryDescription = String(formData.get("injuryDescription") || "").trim();
  const sourceUrl = String(formData.get("sourceUrl") || "").trim();
  const sourcePublishedAtRaw = String(
    formData.get("sourcePublishedAt") || "",
  ).trim();
  const sourcePublishedAt = sourcePublishedAtRaw
    ? new Date(sourcePublishedAtRaw)
    : null;
  if (sourcePublishedAtRaw && Number.isNaN(sourcePublishedAt?.getTime())) {
    throw new Error("Invalid source timestamp");
  }

  const clearOverride = formData.get("clearManualOverride") === "1";

  const result = await setWeekPlayerDesignations({
    weekId,
    rankableEntryIds: ids,
    designation,
    injuryDescription: injuryDescription || null,
    sourceUrl: sourceUrl || null,
    sourcePublishedAt,
    updatedByUserId: admin.user.id,
    clearManualOverride: clearOverride,
  });

  await logAdminAction({
    adminUserId: admin.user.id,
    action: "week_status.updated",
    entityType: "Week",
    entityId: weekId,
    metadata: {
      designation,
      count: ids.length,
      updated: result.updated,
      skippedKickoff: result.skippedKickoff,
      clearOverride,
      ids: ids.slice(0, 20),
    },
  });
  revalidateWeekStatus(weekId);
}

export async function bulkMarkOutAction(formData: FormData) {
  formData.set("designation", "OUT");
  await setWeekPlayerStatusAction(formData);
}

export async function bulkMarkAvailableAction(formData: FormData) {
  formData.set("designation", "AVAILABLE");
  await setWeekPlayerStatusAction(formData);
}

/** @deprecated Use bulkMarkAvailableAction */
export async function bulkMarkActiveAction(formData: FormData) {
  await bulkMarkAvailableAction(formData);
}

export async function clearWeekManualOverrideAction(formData: FormData) {
  const admin = await assertAdmin();
  const weekId = String(formData.get("weekId") || "");
  if (!weekId) throw new Error("weekId required");
  const ids = formData
    .getAll("rankableEntryId")
    .map((value) => String(value))
    .filter(Boolean);
  if (ids.length === 0) throw new Error("Select at least one player");

  const result = await clearWeekManualOverrides({
    weekId,
    rankableEntryIds: ids,
    updatedByUserId: admin.user.id,
  });
  await logAdminAction({
    adminUserId: admin.user.id,
    action: "week_status.override_cleared",
    entityType: "Week",
    entityId: weekId,
    metadata: { cleared: result.cleared, ids: ids.slice(0, 20) },
  });
  revalidateWeekStatus(weekId);
}

/** Sync SeasonPlayer roster membership/status → RankableEntry (not weekly injuries). */
export async function syncWeekStatusFromProviderAction(formData: FormData) {
  const admin = await assertAdmin();
  const weekId = String(formData.get("weekId") || "");
  const position = String(formData.get("position") || "ALL");
  if (!weekId) throw new Error("weekId required");
  const result = await syncWeekAvailabilityFromSeasonPlayers(weekId);
  await logAdminAction({
    adminUserId: admin.user.id,
    action: "week_status.synced_from_season",
    entityType: "Week",
    entityId: weekId,
    metadata: {
      updated: result.updated,
      designationsUnchanged: result.designationsUnchanged,
      matchupsUnchanged: result.matchupsUnchanged,
    },
  });
  revalidateWeekStatus(weekId);
  const params = new URLSearchParams({
    weekId,
    position,
    rosterSynced: "1",
    rosterUpdated: String(result.updated),
  });
  redirect(`/admin/week-status?${params.toString()}`);
}

/** Sync official weekly injury report from NFL.com only (CBS disabled). */
export async function syncNflInjuryStatusAction(formData: FormData) {
  const admin = await assertAdmin();
  const weekId = String(formData.get("weekId") || "");
  const position = String(formData.get("position") || "ALL");
  if (!weekId) throw new Error("weekId required");

  const result = await syncWeekInjuriesFromNflCom({
    weekId,
    apply: true,
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
      skippedManual: result.skippedManual,
      skippedKickoff: result.skippedKickoff,
      failed: result.failed,
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
    skippedManual: String(result.skippedManual),
    skippedKickoff: String(result.skippedKickoff),
    failed: String(result.failed),
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

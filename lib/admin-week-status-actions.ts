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
import { syncWeekInjuriesFromNflCom, formatInjurySyncOperatorMessage } from "@/lib/nfl/injury-sync";
import {
  applyPostKickoffFactualCorrection,
  isPostKickoffCorrectionDesignation,
  logPostKickoffCorrectionRegrade,
  resolveContestsForPostKickoffCorrectionRegrade,
} from "@/lib/eligibility/post-kickoff-factual-correction";
import { gradeContest } from "@/lib/grading";

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
  const position = String(formData.get("position") || "ALL");

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

  const params = new URLSearchParams({
    weekId,
    position,
    designationSaved: "1",
    designation: designation,
    updated: String(result.updated),
    skippedKickoff: String(result.skippedKickoff),
  });
  redirect(`/admin/week-status?${params.toString()}`);
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

  const unmatchedNames = result.matches
    .filter((m) => m.status !== "matched")
    .slice(0, 30)
    .map((m) => `${m.row.name} (${m.row.team})`);

  await logAdminAction({
    adminUserId: admin.user.id,
    action: "week_status.injury_synced",
    entityType: "Week",
    entityId: weekId,
    metadata: {
      ok: result.ok,
      source: result.source,
      sourceUrl: result.sourceUrl,
      syncedAt: result.syncedAt.toISOString(),
      sourceRowCount: result.sourceRowCount,
      officialGameStatusCount: result.officialGameStatusCount,
      blankGameStatusCount: result.blankGameStatusCount,
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
      unmatchedNames,
      operatorMessage: formatInjurySyncOperatorMessage(result),
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
    sourceRows: String(result.sourceRowCount),
    officialGs: String(result.officialGameStatusCount),
    blankGs: String(result.blankGameStatusCount),
    syncedAt: result.syncedAt.toISOString(),
  });
  if (result.errors[0]) {
    params.set("syncError", result.errors[0].slice(0, 180));
  }
  if (unmatchedNames.length > 0) {
    params.set(
      "unmatchedPreview",
      unmatchedNames.slice(0, 15).join(" · ").slice(0, 500),
    );
  }
  redirect(`/admin/week-status?${params.toString()}`);
}

/** Dry-run injury sync — same pipeline, no writes. */
export async function previewNflInjuryStatusAction(formData: FormData) {
  await assertAdmin();
  const weekId = String(formData.get("weekId") || "");
  const position = String(formData.get("position") || "ALL");
  if (!weekId) throw new Error("weekId required");

  const result = await syncWeekInjuriesFromNflCom({
    weekId,
    apply: false,
  });

  const unmatchedNames = result.matches
    .filter((m) => m.status !== "matched")
    .slice(0, 30)
    .map((m) => `${m.row.name} (${m.row.team})`);

  const params = new URLSearchParams({
    weekId,
    position,
    previewed: result.ok ? "1" : "0",
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
    sourceRows: String(result.sourceRowCount),
    officialGs: String(result.officialGameStatusCount),
    blankGs: String(result.blankGameStatusCount),
    syncedAt: result.syncedAt.toISOString(),
  });
  if (result.errors[0]) {
    params.set("syncError", result.errors[0].slice(0, 180));
  }
  if (unmatchedNames.length > 0) {
    params.set(
      "unmatchedPreview",
      unmatchedNames.slice(0, 15).join(" · ").slice(0, 500),
    );
  }
  redirect(`/admin/week-status?${params.toString()}`);
}

/**
 * Admin-only Post-Kickoff Factual Correction (OUT/INACTIVE).
 * Bypasses ordinary skipAfterKickoff; revises freeze; does not auto-regrade.
 */
export async function postKickoffFactualCorrectionAction(formData: FormData) {
  const admin = await assertAdmin();
  const weekId = String(formData.get("weekId") || "");
  const position = String(formData.get("position") || "ALL");
  if (!weekId) throw new Error("weekId required");

  const rankableEntryId = String(formData.get("rankableEntryId") || "").trim();
  if (!rankableEntryId) throw new Error("Select exactly one player");

  const designationRaw = String(formData.get("designation") || "")
    .trim()
    .toUpperCase();
  if (!isPostKickoffCorrectionDesignation(designationRaw)) {
    throw new Error("Post-kickoff correction allows OUT or INACTIVE only");
  }

  const reason = String(formData.get("reason") || "");
  const sourceReference = String(
    formData.get("sourceReference") || formData.get("sourceUrl") || "",
  );

  const result = await applyPostKickoffFactualCorrection({
    weekId,
    rankableEntryId,
    designation: designationRaw,
    reason,
    sourceReference,
    adminUserId: admin.user.id,
  });

  revalidateWeekStatus(weekId);
  revalidatePath("/results");
  revalidatePath("/leaderboards");
  revalidatePath("/my-ranks");

  const params = new URLSearchParams({
    weekId,
    position,
  });

  if (!result.ok) {
    params.set("correctionError", result.message.slice(0, 220));
    params.set("correctionOk", "0");
    redirect(`/admin/week-status?${params.toString()}`);
  }

  params.set("correctionOk", "1");
  params.set("correctionRequiresRegrade", result.requiresRegrade ? "1" : "0");
  params.set("correctionFreezePicks", String(result.freezePicksUpdated));
  params.set(
    "correctionContests",
    result.affectedContestIds.join(",").slice(0, 200),
  );
  params.set("correctionAuditId", result.auditLogId);
  params.set(
    "correctionMsg",
    "Correction saved — affected graded results require regrade.",
  );
  redirect(`/admin/week-status?${params.toString()}`);
}

/**
 * Explicit regrade after a post-kickoff factual correction.
 * Contest set is derived server-side from the correction audit — browser
 * contestIds are ignored for authorization.
 */
export async function regradeContestsAfterFactualCorrectionAction(
  formData: FormData,
) {
  const admin = await assertAdmin();
  const weekId = String(formData.get("weekId") || "");
  const position = String(formData.get("position") || "ALL");
  const correctionAuditId = String(formData.get("correctionAuditId") || "");

  if (!weekId) throw new Error("weekId required");

  const resolved = await resolveContestsForPostKickoffCorrectionRegrade({
    weekId,
    correctionAuditLogId: correctionAuditId,
  });

  if (!resolved.ok) {
    const params = new URLSearchParams({
      weekId,
      position,
      correctionOk: "0",
      correctionError: resolved.message.slice(0, 220),
    });
    redirect(`/admin/week-status?${params.toString()}`);
  }

  for (const contestId of resolved.contestIds) {
    await gradeContest(contestId);
  }

  await logPostKickoffCorrectionRegrade({
    adminUserId: admin.user.id,
    weekId,
    contestIds: resolved.contestIds,
    correctionAuditLogId: resolved.correctionAuditLogId,
  });

  revalidateWeekStatus(weekId);
  revalidatePath("/results");
  revalidatePath("/leaderboards");
  revalidatePath("/leaderboards/live");
  revalidatePath("/my-ranks");
  revalidatePath("/admin");
  revalidatePath("/admin/contests");

  const params = new URLSearchParams({
    weekId,
    position,
    regradeOk: "1",
    regraded: String(resolved.contestIds.length),
  });
  redirect(`/admin/week-status?${params.toString()}`);
}

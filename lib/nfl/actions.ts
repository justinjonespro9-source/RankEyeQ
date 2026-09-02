"use server";

import { revalidatePath } from "next/cache";
import { logAdminAction } from "@/lib/admin/audit";
import { assertAdmin } from "@/lib/auth/session";
import { logAdminImpact, logServerEvent } from "@/lib/log";
import { ImportValidationError } from "@/lib/nfl/import-validation";
import { RATE_LIMITS, rateLimit, rateLimitErrorMessage } from "@/lib/rate-limit";
import { rateLimitKey } from "@/lib/request-ip";
import { prisma } from "@/lib/db";
import {
  commitWeeklyImport,
  previewWeeklyImport,
  syncWeekFromSchedule,
} from "@/lib/nfl/import";
import {
  addManualContestEntry,
  buildRankIqPositionPools,
  setContestEntryExcluded,
} from "@/lib/nfl/pool-builder";
import { calculateActualFinishesForWeek } from "@/lib/nfl/actual-finishes";
import {
  finalizeWeek,
  getFinalizeWeekReadiness,
} from "@/lib/nfl/finalize-week";
import {
  commitWeekResults,
  previewWeekResults,
} from "@/lib/nfl/results-import";
import { createNflDataProvider } from "@/lib/providers/nfl";
import { gradeContest } from "@/lib/grading";

function revalidateDataPaths(weekId?: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/ops");
  revalidatePath("/admin/data");
  revalidatePath("/admin/contests");
  revalidatePath("/rank");
  revalidatePath("/results");
  revalidatePath("/leaderboards");
  for (const position of ["qb", "rb", "wr", "te", "def"]) {
    revalidatePath(`/rank/${position}`);
  }
  if (weekId) {
    revalidatePath(`/admin/data?weekId=${weekId}`);
  }
}

async function assertAdminImportRateLimit() {
  const limited = rateLimit({
    key: await rateLimitKey("admin-import"),
    ...RATE_LIMITS.adminImport,
  });
  if (!limited.ok) {
    throw new Error(rateLimitErrorMessage(limited));
  }
}

function safeImportError(error: unknown) {
  if (error instanceof ImportValidationError) return error.message;
  if (error instanceof Error && !/api[_-]?key|secret|token/i.test(error.message)) {
    return error.message;
  }
  return "Import failed. Check server logs — credentials are not shown.";
}

export async function previewNflImportAction(formData: FormData) {
  await assertAdmin();
  await assertAdminImportRateLimit();
  const weekId = String(formData.get("weekId") || "");
  const week = await prisma.week.findUniqueOrThrow({
    where: { id: weekId },
    include: { season: true },
  });

  const preview = await previewWeeklyImport({
    seasonYear: week.season.year,
    weekNumber: week.weekNumber,
  });

  return { ok: true as const, preview };
}

export async function commitNflImportAction(formData: FormData) {
  await assertAdmin();
  await assertAdminImportRateLimit();
  const weekId = String(formData.get("weekId") || "");
  const week = await prisma.week.findUniqueOrThrow({
    where: { id: weekId },
    include: { season: true },
  });

  try {
    const counts = await commitWeeklyImport({
      seasonId: week.seasonId,
      weekId: week.id,
      seasonYear: week.season.year,
      weekNumber: week.weekNumber,
    });
    logAdminImpact("nfl.import_commit", { weekId, provider: "configured" });
    revalidateDataPaths(weekId);
    return { ok: true as const, counts };
  } catch (error) {
    logServerEvent("import.commit_failed", { weekId }, "error");
    return { ok: false as const, error: safeImportError(error) };
  }
}

export async function syncWeekFromProviderAction(formData: FormData) {
  await assertAdmin();
  const seasonId = String(formData.get("seasonId") || "");
  const weekNumber = Number(formData.get("weekNumber"));
  const season = await prisma.season.findUniqueOrThrow({
    where: { id: seasonId },
  });

  const week = await syncWeekFromSchedule({
    seasonId,
    weekNumber,
    seasonYear: season.year,
  });

  revalidateDataPaths(week.id);
  revalidatePath("/admin/seasons");
  return { ok: true as const, weekId: week.id };
}

export async function buildPositionPoolsAction(formData: FormData) {
  await assertAdmin();
  const weekId = String(formData.get("weekId") || "");
  const result = await buildRankIqPositionPools({ weekId });
  revalidateDataPaths(weekId);
  return { ok: true as const, result };
}

export async function excludeContestEntryAction(formData: FormData) {
  await assertAdmin();
  const contestEntryId = String(formData.get("contestEntryId") || "");
  const excluded = formData.get("excluded") === "1";
  await setContestEntryExcluded({ contestEntryId, excluded });
  revalidateDataPaths();
  return { ok: true as const };
}

export async function restoreContestEntryAction(formData: FormData) {
  await assertAdmin();
  const contestEntryId = String(formData.get("contestEntryId") || "");
  await setContestEntryExcluded({ contestEntryId, excluded: false });
  revalidateDataPaths();
  return { ok: true as const };
}

export async function addOmittedPlayerAction(formData: FormData) {
  await assertAdmin();
  const contestId = String(formData.get("contestId") || "");
  const rankableEntryId = String(formData.get("rankableEntryId") || "");
  await addManualContestEntry({ contestId, rankableEntryId });
  revalidateDataPaths();
  return { ok: true as const };
}

export async function getProviderStatusAction() {
  await assertAdmin();
  const provider = createNflDataProvider();
  return {
    ok: true as const,
    name: provider.name,
    hasSportsDataKey: Boolean(process.env.SPORTSDATAIO_API_KEY),
  };
}

export async function previewWeekResultsAction(formData: FormData) {
  await assertAdmin();
  const weekId = String(formData.get("weekId") || "");
  const preview = await previewWeekResults({ weekId });
  return { ok: true as const, preview };
}

export async function commitWeekResultsAction(formData: FormData) {
  const admin = await assertAdmin();
  const weekId = String(formData.get("weekId") || "");
  const counts = await commitWeekResults({ weekId });
  await logAdminAction({
    adminUserId: admin.user.id,
    action: "results.committed",
    entityType: "Week",
    entityId: weekId,
    metadata: counts as never,
  });
  revalidateDataPaths(weekId);
  return { ok: true as const, counts };
}

export async function calculateActualFinishesAction(formData: FormData) {
  await assertAdmin();
  const weekId = String(formData.get("weekId") || "");
  const results = await calculateActualFinishesForWeek(weekId);
  revalidateDataPaths(weekId);
  return { ok: true as const, results };
}

export async function gradeWeekContestsAction(formData: FormData) {
  const admin = await assertAdmin();
  const weekId = String(formData.get("weekId") || "");
  logAdminImpact("week.grade", { weekId, adminUserId: admin.user.id });
  const contests = await prisma.rankIQContest.findMany({ where: { weekId } });
  for (const contest of contests) {
    await gradeContest(contest.id);
  }
  await logAdminAction({
    adminUserId: admin.user.id,
    action: "week.graded",
    entityType: "Week",
    entityId: weekId,
    metadata: { graded: contests.length },
  });
  revalidateDataPaths(weekId);
  revalidatePath("/profile");
  return { ok: true as const, graded: contests.length };
}

export async function regradeWeekContestsAction(formData: FormData) {
  return gradeWeekContestsAction(formData);
}

export async function getFinalizeReadinessAction(formData: FormData) {
  await assertAdmin();
  const weekId = String(formData.get("weekId") || "");
  const readiness = await getFinalizeWeekReadiness(weekId);
  return { ok: true as const, readiness };
}

export async function finalizeWeekAction(formData: FormData) {
  const admin = await assertAdmin();
  const weekId = String(formData.get("weekId") || "");
  const resultsVerified = String(formData.get("resultsVerified") || "") === "1";
  logAdminImpact("week.finalize", { weekId, adminUserId: admin.user.id });
  const result = await finalizeWeek({
    weekId,
    resultsVerified,
    adminUserId: admin.user.id,
  });
  await logAdminAction({
    adminUserId: admin.user.id,
    action: "week.finalized",
    entityType: "Week",
    entityId: weekId,
    metadata: { resultsVerified, manualMode: result.readiness.manualMode },
  });
  revalidateDataPaths(weekId);
  revalidatePath("/profile");
  return { ok: true as const, result };
}

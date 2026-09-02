"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logAdminAction } from "@/lib/admin/audit";
import {
  archiveWeek,
  createWeek,
  ensureFivePositionContests,
  updateWeekTiming,
  WeekSetupError,
} from "@/lib/admin/weeks";
import {
  AdminUserError,
  changeUserRole,
  createAiUniversalProfile,
  setProfileStatus,
  updateUniversalProfileAdmin,
} from "@/lib/admin/users";
import { assertAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import type {
  ProfileStatus,
  UserRole,
  WeekStatus,
} from "@/lib/generated/prisma/client";
import { logAdminImpact } from "@/lib/log";
import { RATE_LIMITS, rateLimit, rateLimitErrorMessage } from "@/lib/rate-limit";
import { rateLimitKey } from "@/lib/request-ip";
import { parseChicagoDateTimeLocal } from "@/lib/timing/chicago";
import {
  saveSubmissionPicks,
  submitRanking,
  SubmissionError,
} from "@/lib/submissions";

function revalidateCommand(weekId?: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/ops");
  revalidatePath("/admin/seasons");
  revalidatePath("/admin/contests");
  revalidatePath("/admin/ai");
  revalidatePath("/admin/users");
  revalidatePath("/admin/data");
  if (weekId) {
    revalidatePath(`/admin?weekId=${weekId}`);
    revalidatePath(`/admin/ai?weekId=${weekId}`);
    revalidatePath(`/admin/data?weekId=${weekId}`);
  }
}

function parseRequiredChicago(value: FormDataEntryValue | null, label: string) {
  const parsed = parseChicagoDateTimeLocal(String(value || ""));
  if (!parsed) throw new WeekSetupError(`${label} must be a valid date/time`);
  return parsed;
}

function parseOptionalChicago(value: FormDataEntryValue | null) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return parseChicagoDateTimeLocal(raw);
}

export async function commandCreateWeekAction(formData: FormData) {
  const admin = await assertAdmin();
  let week;
  try {
    week = await createWeek({
      seasonId: String(formData.get("seasonId")),
      weekNumber: Number(formData.get("weekNumber")),
      label: String(formData.get("label") || ""),
      startsAt: parseRequiredChicago(formData.get("startsAt"), "Start"),
      endsAt: parseRequiredChicago(formData.get("endsAt"), "End"),
      status: String(formData.get("status") || "UPCOMING") as WeekStatus,
    });
  } catch (error) {
    const message =
      error instanceof WeekSetupError ? error.message : "Unable to create week";
    redirect(`/admin?error=${encodeURIComponent(message)}`);
  }
  await logAdminAction({
    adminUserId: admin.user.id,
    action: "week.created",
    entityType: "Week",
    entityId: week.id,
    metadata: { weekNumber: week.weekNumber, label: week.label },
  });
  revalidateCommand(week.id);
  redirect(`/admin?weekId=${week.id}&notice=Week+created`);
}

export async function commandUpdateWeekTimingAction(formData: FormData) {
  const admin = await assertAdmin();
  const weekId = String(formData.get("weekId"));
  try {
    await updateWeekTiming({
      weekId,
      label: String(formData.get("label") || ""),
      startsAt: parseOptionalChicago(formData.get("startsAt")) ?? undefined,
      endsAt: parseOptionalChicago(formData.get("endsAt")) ?? undefined,
      status: String(formData.get("status") || "") as WeekStatus,
      rankingsOpenAt: parseOptionalChicago(formData.get("rankingsOpenAt")),
      fullLockAt: parseOptionalChicago(formData.get("fullLockAt")),
      revealStartsAt: parseOptionalChicago(formData.get("revealStartsAt")),
      publicReleaseAt: parseOptionalChicago(formData.get("publicReleaseAt")),
    });
  } catch (error) {
    const message =
      error instanceof WeekSetupError ? error.message : "Unable to update timing";
    redirect(`/admin?weekId=${weekId}&error=${encodeURIComponent(message)}`);
  }
  await logAdminAction({
    adminUserId: admin.user.id,
    action: "week.timing_updated",
    entityType: "Week",
    entityId: weekId,
  });
  revalidateCommand(weekId);
  redirect(`/admin?weekId=${weekId}&notice=Timing+updated`);
}

export async function commandEnsureContestsAction(formData: FormData) {
  const admin = await assertAdmin();
  const weekId = String(formData.get("weekId"));
  const result = await ensureFivePositionContests(weekId);
  if (result.created.length > 0) {
    await logAdminAction({
      adminUserId: admin.user.id,
      action: "contest.bulk_created",
      entityType: "Week",
      entityId: weekId,
      metadata: { created: result.created, skipped: result.skipped },
    });
  }
  revalidateCommand(weekId);
  redirect(
    `/admin?weekId=${weekId}&notice=${encodeURIComponent(
      result.created.length
        ? `Created ${result.created.join(", ")}`
        : "All five contests already exist",
    )}`,
  );
}

export async function commandArchiveWeekAction(formData: FormData) {
  const admin = await assertAdmin();
  const weekId = String(formData.get("weekId"));
  logAdminImpact("week.archive", { weekId, adminUserId: admin.user.id });
  await archiveWeek(weekId);
  await logAdminAction({
    adminUserId: admin.user.id,
    action: "week.archived",
    entityType: "Week",
    entityId: weekId,
  });
  revalidateCommand(weekId);
  redirect(`/admin?weekId=${weekId}&notice=Week+archived`);
}

export async function adminSaveParsedBotBoardAction(input: {
  contestId: string;
  profileId: string;
  rankedEntryIds: (string | null)[];
  submit: boolean;
  weekId?: string;
}) {
  const admin = await assertAdmin();
  const limited = rateLimit({
    key: await rateLimitKey("admin-parser", admin.user.id),
    ...RATE_LIMITS.adminParser,
  });
  if (!limited.ok) {
    return { ok: false as const, error: rateLimitErrorMessage(limited) };
  }
  const profile = await prisma.universalProfile.findUnique({
    where: { id: input.profileId },
  });
  if (!profile || profile.profileType !== "AI") {
    return { ok: false as const, error: "Bot submissions require an AI UniversalProfile" };
  }

  try {
    if (input.submit) {
      await submitRanking({
        contestId: input.contestId,
        universalProfileId: input.profileId,
        rankedEntryIds: input.rankedEntryIds,
      });
    } else {
      await saveSubmissionPicks({
        contestId: input.contestId,
        universalProfileId: input.profileId,
        rankedEntryIds: input.rankedEntryIds,
        requireComplete: false,
      });
    }
    await logAdminAction({
      adminUserId: admin.user.id,
      action: input.submit ? "ai.board_submitted" : "ai.board_drafted",
      entityType: "RankingSubmission",
      entityId: input.contestId,
      metadata: { profileId: input.profileId, username: profile.username },
    });
    revalidateCommand(input.weekId);
    revalidatePath(`/admin/contests/${input.contestId}`);
    revalidatePath(`/admin/ai/${input.profileId}/${input.contestId}`);
    return { ok: true as const, status: input.submit ? "SUBMITTED" : "DRAFT" };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof SubmissionError
          ? error.message
          : "Unable to save bot board",
    };
  }
}

export async function createAiProfileAction(formData: FormData) {
  const admin = await assertAdmin();
  let profile;
  try {
    profile = await createAiUniversalProfile({
      username: String(formData.get("username") || ""),
      displayName: String(formData.get("displayName") || ""),
      avatarUrl: String(formData.get("avatarUrl") || "") || null,
    });
  } catch (error) {
    const message =
      error instanceof AdminUserError ? error.message : "Unable to create AI profile";
    redirect(`/admin/users?error=${encodeURIComponent(message)}`);
  }
  await logAdminAction({
    adminUserId: admin.user.id,
    action: "ai.profile_created",
    entityType: "UniversalProfile",
    entityId: profile.id,
    metadata: { username: profile.username },
  });
  revalidateCommand();
  redirect(`/admin/users?notice=AI+profile+created`);
}

export async function updateAdminProfileAction(formData: FormData) {
  const admin = await assertAdmin();
  const profileId = String(formData.get("profileId"));
  try {
    await updateUniversalProfileAdmin({
      profileId,
      username: String(formData.get("username") || ""),
      displayName: String(formData.get("displayName") || ""),
      avatarUrl: String(formData.get("avatarUrl") || "") || null,
    });
  } catch (error) {
    const message =
      error instanceof AdminUserError ? error.message : "Unable to update profile";
    redirect(`/admin/users?error=${encodeURIComponent(message)}`);
  }
  await logAdminAction({
    adminUserId: admin.user.id,
    action: "user.profile_updated",
    entityType: "UniversalProfile",
    entityId: profileId,
  });
  revalidateCommand();
  redirect(`/admin/users?notice=Profile+updated`);
}

export async function changeUserRoleAction(formData: FormData) {
  const admin = await assertAdmin();
  const targetUserId = String(formData.get("userId"));
  const role = String(formData.get("role")) as UserRole;
  try {
    await changeUserRole({
      actorUserId: admin.user.id,
      targetUserId,
      role,
    });
  } catch (error) {
    const message =
      error instanceof AdminUserError ? error.message : "Unable to change role";
    redirect(`/admin/users?error=${encodeURIComponent(message)}`);
  }
  await logAdminAction({
    adminUserId: admin.user.id,
    action: "user.role_changed",
    entityType: "User",
    entityId: targetUserId,
    metadata: { role },
  });
  revalidateCommand();
  redirect(`/admin/users?notice=Role+updated`);
}

export async function setProfileStatusAction(formData: FormData) {
  const admin = await assertAdmin();
  const profileId = String(formData.get("profileId"));
  const status = String(formData.get("status")) as ProfileStatus;
  try {
    await setProfileStatus({ profileId, status });
  } catch (error) {
    const message =
      error instanceof AdminUserError ? error.message : "Unable to update status";
    redirect(`/admin/users?error=${encodeURIComponent(message)}`);
  }
  await logAdminAction({
    adminUserId: admin.user.id,
    action: status === "SUSPENDED" ? "user.suspended" : "user.reactivated",
    entityType: "UniversalProfile",
    entityId: profileId,
    metadata: { status },
  });
  const creatorProfile = await prisma.creatorProfile.findUnique({
    where: { universalProfileId: profileId },
  });
  if (creatorProfile) {
    await logAdminAction({
      adminUserId: admin.user.id,
      action:
        status === "SUSPENDED" ? "creator.suspended" : "creator.reactivated",
      entityType: "CreatorProfile",
      entityId: creatorProfile.id,
      metadata: {
        profileId,
        status,
        creatorEnabled: creatorProfile.enabled,
      },
    });
  }
  revalidateCommand();
  redirect(
    `/admin/users?notice=${status === "SUSPENDED" ? "User+suspended" : "User+reactivated"}`,
  );
}

export async function commandOpenWeekRankingsAction(formData: FormData) {
  const admin = await assertAdmin();
  const weekId = String(formData.get("weekId") || "");
  if (!weekId) {
    return { ok: false as const, error: "Week is required." };
  }

  try {
    const { openWeekRankings } = await import("@/lib/admin/open-week-rankings");
    const result = await openWeekRankings({
      weekId,
      adminUserId: admin.user.id,
    });
    revalidateCommand(weekId);
    return {
      ok: true as const,
      alreadyOpen: "alreadyOpen" in result && Boolean(result.alreadyOpen),
      opened: result.opened.length,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "OpenWeekRankingsError") {
      const typed = error as InstanceType<
        typeof import("@/lib/admin/open-week-rankings").OpenWeekRankingsError
      >;
      return {
        ok: false as const,
        error: typed.message,
        blockers: typed.blockers,
      };
    }
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Unable to open week rankings.",
    };
  }
}

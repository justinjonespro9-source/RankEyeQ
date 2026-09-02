"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logAdminAction } from "@/lib/admin/audit";
import { createWeek, WeekSetupError } from "@/lib/admin/weeks";
import { assertAdmin } from "@/lib/auth/session";
import {
  ContestPosition,
  ContestStatus,
  EntryAvailability,
  RankableEntryType,
  WeekStatus,
} from "@/lib/generated/prisma/client";
import { rankingDepthForPosition } from "@/lib/contest-defaults";
import { prisma } from "@/lib/db";
import { logAdminImpact } from "@/lib/log";

function revalidateAdmin(contestId?: string) {
  revalidatePath("/admin");
  revalidatePath("/admin/seasons");
  revalidatePath("/admin/contests");
  revalidatePath("/rank");
  if (contestId) {
    revalidatePath(`/admin/contests/${contestId}`);
  }
  for (const position of ["qb", "rb", "wr", "te", "def"]) {
    revalidatePath(`/rank/${position}`);
  }
}

export async function createSeasonAction(formData: FormData) {
  await assertAdmin();
  const year = Number(formData.get("year"));
  const sport = String(formData.get("sport") || "NFL");
  const active = formData.get("active") === "on";

  if (!Number.isFinite(year)) {
    throw new Error("Invalid season year");
  }

  const season = await prisma.season.create({
    data: { year, sport, active },
  });

  if (active) {
    await prisma.season.updateMany({
      where: { NOT: { id: season.id } },
      data: { active: false },
    });
  }

  revalidateAdmin();
  redirect("/admin/seasons");
}

export async function setActiveSeasonAction(formData: FormData) {
  await assertAdmin();
  const seasonId = String(formData.get("seasonId"));
  await prisma.season.updateMany({ data: { active: false } });
  await prisma.season.update({
    where: { id: seasonId },
    data: { active: true },
  });
  revalidateAdmin();
}

export async function createWeekAction(formData: FormData) {
  const admin = await assertAdmin();
  const seasonId = String(formData.get("seasonId"));
  const weekNumber = Number(formData.get("weekNumber"));
  const label = String(formData.get("label") || `Week ${weekNumber}`);
  const startsAt = new Date(String(formData.get("startsAt")));
  const endsAt = new Date(String(formData.get("endsAt")));
  const status = String(formData.get("status") || "UPCOMING") as WeekStatus;

  try {
    const week = await createWeek({
      seasonId,
      weekNumber,
      label,
      startsAt,
      endsAt,
      status,
    });
    await logAdminAction({
      adminUserId: admin.user.id,
      action: "week.created",
      entityType: "Week",
      entityId: week.id,
      metadata: { weekNumber, label: week.label },
    });
  } catch (error) {
    if (error instanceof WeekSetupError) {
      throw error;
    }
    throw error;
  }

  revalidateAdmin();
  redirect("/admin/seasons");
}

export async function createContestAction(formData: FormData) {
  await assertAdmin();
  const weekId = String(formData.get("weekId"));
  const position = String(formData.get("position")) as ContestPosition;
  const title = String(formData.get("title") || "").trim();
  const opensAtRaw = String(formData.get("opensAt") || "");
  const locksAtRaw = String(formData.get("locksAt") || "");
  const status = String(formData.get("status") || "DRAFT") as ContestStatus;

  const week = await prisma.week.findUniqueOrThrow({ where: { id: weekId } });
  const rankingDepth = rankingDepthForPosition(position);

  const contest = await prisma.rankIQContest.create({
    data: {
      seasonId: week.seasonId,
      weekId,
      position,
      title:
        title ||
        `Week ${week.weekNumber} ${position} Top ${rankingDepth}`,
      rankingDepth,
      status,
      opensAt: opensAtRaw ? new Date(opensAtRaw) : null,
      locksAt: locksAtRaw ? new Date(locksAtRaw) : null,
    },
  });

  revalidateAdmin(contest.id);
  redirect(`/admin/contests/${contest.id}`);
}

export async function updateContestAction(formData: FormData) {
  await assertAdmin();
  const contestId = String(formData.get("contestId"));
  const title = String(formData.get("title") || "").trim();
  const status = String(formData.get("status")) as ContestStatus;
  const opensAtRaw = String(formData.get("opensAt") || "");
  const locksAtRaw = String(formData.get("locksAt") || "");

  await prisma.rankIQContest.update({
    where: { id: contestId },
    data: {
      title,
      status,
      opensAt: opensAtRaw ? new Date(opensAtRaw) : null,
      locksAt: locksAtRaw ? new Date(locksAtRaw) : null,
    },
  });

  revalidateAdmin(contestId);
}

export async function createRankableEntryAction(formData: FormData) {
  await assertAdmin();
  const contestId = String(formData.get("contestId"));
  const contest = await prisma.rankIQContest.findUniqueOrThrow({
    where: { id: contestId },
  });

  const name = String(formData.get("name") || "").trim();
  const shortName = String(formData.get("shortName") || name).trim();
  const team = String(formData.get("team") || "").trim().toUpperCase();
  const opponent = String(formData.get("opponent") || "").trim();
  const gameStartsAt = new Date(String(formData.get("gameStartsAt")));
  const availability = String(
    formData.get("availability") || "ACTIVE",
  ) as EntryAvailability;
  const type =
    contest.position === "DEF"
      ? RankableEntryType.DEFENSE
      : RankableEntryType.PLAYER;

  if (!name || !team) {
    throw new Error("Name and team are required");
  }

  const entry = await prisma.rankableEntry.create({
    data: {
      provider: "manual",
      externalId: `manual-${crypto.randomUUID()}`,
      name,
      shortName,
      team,
      opponent,
      position: contest.position,
      type,
      gameStartsAt,
      availability,
      active: true,
    },
  });

  await prisma.contestEntry.create({
    data: {
      contestId,
      rankableEntryId: entry.id,
    },
  });

  revalidateAdmin(contestId);
}

export async function associateExistingEntryAction(formData: FormData) {
  await assertAdmin();
  const contestId = String(formData.get("contestId"));
  const rankableEntryId = String(formData.get("rankableEntryId"));

  await prisma.contestEntry.create({
    data: { contestId, rankableEntryId },
  });

  revalidateAdmin(contestId);
}

export async function removeContestEntryAction(formData: FormData) {
  await assertAdmin();
  const contestEntryId = String(formData.get("contestEntryId"));
  const contestId = String(formData.get("contestId"));

  await prisma.contestEntry.delete({ where: { id: contestEntryId } });
  revalidateAdmin(contestId);
}

export async function updateContestResultsAction(formData: FormData) {
  await assertAdmin();
  const contestId = String(formData.get("contestId"));
  const entryIds = formData.getAll("entryId").map(String);

  for (const entryId of entryIds) {
    const pointsRaw = formData.get(`fantasyPoints_${entryId}`);
    const rankRaw = formData.get(`actualRank_${entryId}`);

    const fantasyPoints =
      pointsRaw === null || String(pointsRaw).trim() === ""
        ? null
        : Number(pointsRaw);
    const actualRank =
      rankRaw === null || String(rankRaw).trim() === ""
        ? null
        : Number(rankRaw);

    await prisma.contestEntry.update({
      where: { id: entryId },
      data: {
        fantasyPoints:
          fantasyPoints !== null && Number.isFinite(fantasyPoints)
            ? fantasyPoints
            : null,
        actualRank:
          actualRank !== null && Number.isFinite(actualRank)
            ? actualRank
            : null,
      },
    });
  }

  revalidateAdmin(contestId);
}

export async function autoRankByFantasyPointsAction(formData: FormData) {
  await assertAdmin();
  const contestId = String(formData.get("contestId"));
  const { calculateActualFinishesForContest } = await import(
    "@/lib/nfl/actual-finishes"
  );
  await calculateActualFinishesForContest(contestId);
  revalidateAdmin(contestId);
}

export async function transitionContestStatusAction(formData: FormData) {
  const admin = await assertAdmin();
  logAdminImpact("contest.transition", {
    contestId: String(formData.get("contestId") || ""),
    status: String(formData.get("status") || ""),
    adminUserId: admin.user.id,
  });
  const contestId = String(formData.get("contestId"));
  const nextStatus = String(formData.get("status")) as ContestStatus;

  const contest = await prisma.rankIQContest.findUniqueOrThrow({
    where: { id: contestId },
  });

  const { canTransitionContest } = await import("@/lib/contest-lifecycle");
  if (!canTransitionContest(contest.status, nextStatus)) {
    throw new Error(
      `Invalid transition ${contest.status} → ${nextStatus}`,
    );
  }

  if (nextStatus === "LOCKED") {
    const { lockContestSubmissions } = await import("@/lib/submissions");
    await lockContestSubmissions(contestId);
  } else {
    await prisma.rankIQContest.update({
      where: { id: contestId },
      data: { status: nextStatus },
    });
  }

  await logAdminAction({
    adminUserId: admin.user.id,
    action:
      nextStatus === "OPEN"
        ? "contest.opened"
        : nextStatus === "LOCKED"
          ? "contest.locked"
          : `contest.status_${nextStatus.toLowerCase()}`,
    entityType: "RankIQContest",
    entityId: contestId,
    metadata: { status: nextStatus },
  });

  revalidateAdmin(contestId);
  revalidatePath("/leaderboards");
  revalidatePath("/results");
}

export async function gradeContestAction(formData: FormData) {
  const admin = await assertAdmin();
  logAdminImpact("contest.grade", {
    contestId: String(formData.get("contestId") || ""),
    adminUserId: admin.user.id,
  });
  const contestId = String(formData.get("contestId"));
  const { gradeContest, GradingError } = await import("@/lib/grading");

  try {
    await gradeContest(contestId);
  } catch (error) {
    if (error instanceof GradingError) {
      throw error;
    }
    throw error;
  }

  await logAdminAction({
    adminUserId: admin.user.id,
    action: "contest.graded",
    entityType: "RankIQContest",
    entityId: contestId,
  });

  revalidateAdmin(contestId);
  revalidatePath("/leaderboards");
  revalidatePath("/results");
  revalidatePath("/profile");
}

export async function adminSaveBotSubmissionAction(formData: FormData) {
  const admin = await assertAdmin();
  const contestId = String(formData.get("contestId"));
  const profileId = String(formData.get("profileId"));
  const submit = formData.get("submit") === "1";
  const rankedEntryIds = formData
    .getAll("rankedEntryId")
    .map((value) => String(value))
    .filter(Boolean);

  const profile = await prisma.universalProfile.findUnique({
    where: { id: profileId },
  });
  if (!profile || profile.profileType !== "AI") {
    throw new Error("Bot submissions require an AI UniversalProfile");
  }

  const { saveSubmissionPicks, submitRanking, SubmissionError } = await import(
    "@/lib/submissions"
  );

  try {
    if (submit) {
      await submitRanking({
        contestId,
        universalProfileId: profileId,
        rankedEntryIds,
      });
    } else {
      await saveSubmissionPicks({
        contestId,
        universalProfileId: profileId,
        rankedEntryIds,
        requireComplete: false,
      });
    }
  } catch (error) {
    if (error instanceof SubmissionError) {
      throw new Error(error.message);
    }
    throw error;
  }

  await logAdminAction({
    adminUserId: admin.user.id,
    action: submit ? "ai.board_submitted" : "ai.board_drafted",
    entityType: "RankIQContest",
    entityId: contestId,
    metadata: { profileId, username: profile.username },
  });

  revalidateAdmin(contestId);
}

import { prisma } from "@/lib/db";
import {
  submissionAllowsEdits,
  submissionIsEligible,
} from "@/lib/contest-lifecycle";
import type { SubmissionStatus } from "@/lib/generated/prisma/client";
import { applyKickoffLocksToSubmission } from "@/lib/timing/apply-locks";
import { validatePartialLockEdit } from "@/lib/timing/partial-lock";
import { isSelectableAvailability } from "@/lib/eligibility/weekly-status";
import { rankingEditWindowError } from "@/lib/timing/submission-window";
import { getWeekTimingState } from "@/lib/timing/week-windows";

export class SubmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubmissionError";
  }
}

/**
 * Relation payload for ranking UI. Loaded with find* only — never combine with
 * create/update/include on the same call. Prisma runs write+include inside an
 * implicit transaction and Promise.all's sibling relations on one PoolClient,
 * which triggers pg's concurrent-query deprecation (hard error in pg@9).
 */
const submissionDetailInclude = {
  picks: {
    include: { rankableEntry: { include: { game: true } } },
    orderBy: { predictedRank: "asc" as const },
  },
  universalProfile: true,
  contest: true,
} as const;

async function loadSubmissionDetail(submissionId: string) {
  return prisma.rankingSubmission.findUniqueOrThrow({
    where: { id: submissionId },
    include: submissionDetailInclude,
  });
}

export async function getSubmissionForProfile(
  contestId: string,
  universalProfileId: string,
  now = new Date(),
) {
  const existing = await prisma.rankingSubmission.findUnique({
    where: {
      contestId_universalProfileId: { contestId, universalProfileId },
    },
    include: submissionDetailInclude,
  });
  if (!existing) return null;
  return applyKickoffLocksToSubmission(existing.id, now);
}

async function assertProfileCanSubmit(universalProfileId: string) {
  const profile = await prisma.universalProfile.findUnique({
    where: { id: universalProfileId },
    select: { status: true },
  });
  if (!profile) throw new SubmissionError("Profile not found");
  if (profile.status === "SUSPENDED") {
    throw new SubmissionError(
      "This profile is suspended and cannot submit rankings",
    );
  }
}

export async function getOrCreateDraftSubmission(
  contestId: string,
  universalProfileId: string,
  now = new Date(),
) {
  const existing = await getSubmissionForProfile(
    contestId,
    universalProfileId,
    now,
  );
  if (existing) return existing;
  await assertProfileCanSubmit(universalProfileId);

  const contest = await prisma.rankIQContest.findUnique({
    where: { id: contestId },
    include: { week: true },
  });
  if (!contest) throw new SubmissionError("Contest not found");

  const windowError = rankingEditWindowError({
    contestStatus: contest.status,
    weekStatus: contest.week.status,
    rankingsOpenAt: contest.week.rankingsOpenAt,
    fullLockAt: contest.week.fullLockAt,
    revealStartsAt: contest.week.revealStartsAt,
    publicReleaseAt: contest.week.publicReleaseAt,
    now,
    action: "draft",
  });
  if (windowError) throw new SubmissionError(windowError);

  const { resolveRevealPreferenceForNewSubmission } = await import(
    "@/lib/social/creator"
  );
  const revealPreference =
    await resolveRevealPreferenceForNewSubmission(universalProfileId);

  const created = await prisma.rankingSubmission.create({
    data: {
      contestId,
      universalProfileId,
      status: "DRAFT",
      revealPreference,
    },
  });
  return loadSubmissionDetail(created.id);
}

function assertUniqueOrderedPicks(
  rankedEntryIds: string[],
  rankingDepth: number,
) {
  if (rankedEntryIds.length !== rankingDepth) {
    throw new SubmissionError(
      `Exactly ${rankingDepth} picks are required (received ${rankedEntryIds.length})`,
    );
  }

  const unique = new Set(rankedEntryIds);
  if (unique.size !== rankedEntryIds.length) {
    throw new SubmissionError("Duplicate entries are not allowed");
  }
}

async function assertEntriesBelongToContest(
  contestId: string,
  rankedEntryIds: string[],
) {
  const count = await prisma.contestEntry.count({
    where: {
      contestId,
      rankableEntryId: { in: rankedEntryIds },
      excluded: false,
    },
  });
  if (count !== rankedEntryIds.length) {
    throw new SubmissionError(
      "One or more picks are not eligible for this contest",
    );
  }
}

async function loadKickoffMap(contestId: string) {
  const entries = await prisma.contestEntry.findMany({
    where: { contestId, excluded: false },
    include: {
      game: true,
      rankableEntry: { include: { game: true } },
    },
  });
  const map = new Map<string, Date | null>();
  const names = new Map<string, string>();
  const availabilityByEntryId = new Map<string, string>();
  for (const entry of entries) {
    map.set(
      entry.rankableEntryId,
      entry.game?.startsAt ??
        entry.rankableEntry.game?.startsAt ??
        entry.rankableEntry.gameStartsAt ??
        null,
    );
    names.set(entry.rankableEntryId, entry.rankableEntry.name);
    availabilityByEntryId.set(
      entry.rankableEntryId,
      entry.rankableEntry.availability,
    );
  }
  return { kickoffByEntryId: map, playerNamesById: names, availabilityByEntryId };
}

/**
 * Persist ordered picks. Slot indexes are preserved (no compacting) so
 * kickoff-locked players keep their committed ranks.
 */
export async function saveSubmissionPicks(input: {
  contestId: string;
  universalProfileId: string;
  rankedEntryIds: (string | null)[];
  requireComplete?: boolean;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const contest = await prisma.rankIQContest.findUnique({
    where: { id: input.contestId },
    include: { week: true },
  });
  if (!contest) throw new SubmissionError("Contest not found");
  await assertProfileCanSubmit(input.universalProfileId);

  const timing = getWeekTimingState({
    rankingsOpenAt: contest.week.rankingsOpenAt,
    fullLockAt: contest.week.fullLockAt,
    revealStartsAt: contest.week.revealStartsAt,
    publicReleaseAt: contest.week.publicReleaseAt,
    weekStatus: contest.week.status,
    now,
  });
  const windowError = rankingEditWindowError({
    contestStatus: contest.status,
    weekStatus: contest.week.status,
    rankingsOpenAt: contest.week.rankingsOpenAt,
    fullLockAt: contest.week.fullLockAt,
    revealStartsAt: contest.week.revealStartsAt,
    publicReleaseAt: contest.week.publicReleaseAt,
    now,
    action: "edit",
  });
  if (windowError) throw new SubmissionError(windowError);

  const submission = await getOrCreateDraftSubmission(
    input.contestId,
    input.universalProfileId,
    now,
  );

  if (!submissionAllowsEdits(contest.status, submission.status)) {
    throw new SubmissionError("This ranking can no longer be edited");
  }

  await applyKickoffLocksToSubmission(submission.id, now);
  const previous = await prisma.rankingPick.findMany({
    where: { submissionId: submission.id },
  });

  const slots = input.rankedEntryIds.slice(0, contest.rankingDepth);
  while (slots.length < contest.rankingDepth) slots.push(null);

  const filled = slots.filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );

  if (input.requireComplete) {
    assertUniqueOrderedPicks(filled, contest.rankingDepth);
  } else {
    const unique = new Set(filled);
    if (unique.size !== filled.length) {
      throw new SubmissionError("Duplicate entries are not allowed");
    }
  }

  if (filled.length > 0) {
    await assertEntriesBelongToContest(input.contestId, filled);
  }

  const { kickoffByEntryId, playerNamesById, availabilityByEntryId } =
    await loadKickoffMap(input.contestId);
  const lockCheck = validatePartialLockEdit({
    previous: previous.map((pick) => ({
      rankableEntryId: pick.rankableEntryId,
      predictedRank: pick.predictedRank,
      slotLocked: pick.slotLocked,
      lockedRank: pick.lockedRank,
    })),
    nextRankedIds: slots,
    kickoffByEntryId,
    now,
    fullLockAt: contest.week.fullLockAt,
    rankingsOpenAt: contest.week.rankingsOpenAt,
    playerNamesById,
  });
  if (!lockCheck.ok) {
    throw new SubmissionError(lockCheck.error);
  }

  const previousById = new Map(
    previous.map((pick) => [pick.rankableEntryId, pick]),
  );

  for (const id of filled) {
    if (previousById.has(id)) continue;
    const availability = availabilityByEntryId.get(id) ?? "ACTIVE";
    if (!isSelectableAvailability(availability)) {
      const name = playerNamesById.get(id) ?? "player";
      throw new SubmissionError(
        `Cannot add ${name} — status is ${availability} (not eligible for new selection)`,
      );
    }
  }

  const nextStatus: SubmissionStatus =
    submission.status === "SUBMITTED" ? "SUBMITTED" : "DRAFT";

  await prisma.$transaction(async (tx) => {
    await tx.rankingPick.deleteMany({
      where: { submissionId: submission.id },
    });

    const rows = slots
      .map((rankableEntryId, index) =>
        rankableEntryId
          ? {
              rankableEntryId,
              predictedRank: index + 1,
            }
          : null,
      )
      .filter((row): row is { rankableEntryId: string; predictedRank: number } =>
        Boolean(row),
      );

    for (const row of rows) {
      const prior = previousById.get(row.rankableEntryId);
      const kickoff = kickoffByEntryId.get(row.rankableEntryId) ?? null;
      const alreadyLocked = Boolean(prior?.slotLocked);
      const slotLocked =
        alreadyLocked ||
        Boolean(kickoff && now >= kickoff) ||
        timing.fullBoardLocked;

      await tx.rankingPick.create({
        data: {
          submissionId: submission.id,
          rankableEntryId: row.rankableEntryId,
          predictedRank: row.predictedRank,
          slotLocked,
          lockedRank: slotLocked
            ? (prior?.lockedRank ?? row.predictedRank)
            : null,
          lockedAt: slotLocked
            ? (prior?.lockedAt ?? kickoff ?? contest.week.fullLockAt ?? now)
            : null,
          committedAt: slotLocked
            ? (prior?.committedAt ?? now)
            : now,
        },
      });
    }

    await tx.rankingSubmission.update({
      where: { id: submission.id },
      data: { status: nextStatus },
    });
  });

  return loadSubmissionDetail(submission.id);
}

export async function submitRanking(input: {
  contestId: string;
  universalProfileId: string;
  rankedEntryIds: (string | null)[];
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const contest = await prisma.rankIQContest.findUnique({
    where: { id: input.contestId },
    include: { week: true },
  });
  if (!contest) throw new SubmissionError("Contest not found");

  const windowError = rankingEditWindowError({
    contestStatus: contest.status,
    weekStatus: contest.week.status,
    rankingsOpenAt: contest.week.rankingsOpenAt,
    fullLockAt: contest.week.fullLockAt,
    revealStartsAt: contest.week.revealStartsAt,
    publicReleaseAt: contest.week.publicReleaseAt,
    now,
    action: "submit",
  });
  if (windowError) throw new SubmissionError(windowError);

  const filled = input.rankedEntryIds.filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  assertUniqueOrderedPicks(filled, contest.rankingDepth);
  await assertEntriesBelongToContest(input.contestId, filled);

  const saved = await saveSubmissionPicks({
    ...input,
    rankedEntryIds: input.rankedEntryIds,
    requireComplete: true,
    now,
  });

  await prisma.rankingSubmission.update({
    where: { id: saved.id },
    data: {
      status: "SUBMITTED",
      submittedAt: saved.submittedAt ?? now,
    },
  });
  return loadSubmissionDetail(saved.id);
}

/**
 * V1 lock rule: only explicitly SUBMITTED rankings become LOCKED competitors.
 * Incomplete or complete-but-unsubmitted DRAFT boards stay DRAFT and do not compete.
 */
export async function lockContestSubmissions(contestId: string, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    const contest = await tx.rankIQContest.update({
      where: { id: contestId },
      data: {
        status: "LOCKED",
        locksAt: now,
      },
    });

    const locked = await tx.rankingSubmission.updateMany({
      where: {
        contestId,
        status: "SUBMITTED",
      },
      data: {
        status: "LOCKED",
        lockedAt: now,
      },
    });

    return { contest, lockedCount: locked.count };
  });
}

export function picksToRankedIds(
  picks: { predictedRank: number; rankableEntryId: string }[],
  rankingDepth: number,
): (string | null)[] {
  const slots: (string | null)[] = Array.from(
    { length: rankingDepth },
    () => null,
  );
  for (const pick of picks) {
    if (pick.predictedRank >= 1 && pick.predictedRank <= rankingDepth) {
      slots[pick.predictedRank - 1] = pick.rankableEntryId;
    }
  }
  return slots;
}

export { submissionIsEligible };

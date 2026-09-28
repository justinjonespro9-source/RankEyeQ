/**
 * Official RankEyeQ Board publication + immutable versions (PUBLISHED / FINAL).
 *
 * Presentation and history only. RankingSubmission + RankingPick remain the
 * sole competitive source of truth; grading, scoring, reserves, availability,
 * kickoff freezes and consensus must never import this module
 * (enforced by lib/boards/official-board.architecture.test.ts).
 *
 * FINAL preserves the immutable full-lock ranking and the slot-lock state at
 * that boundary. Kickoff availability (wasUnavailableAtKickoff and related
 * freezes) stays authoritative on RankingPick; it may be combined with FINAL
 * to explain the eventual Scoring Board, but FINAL is never mutated later.
 */
import { createHash } from "node:crypto";
import {
  isOwnerManagedProfile,
  resolveSubmissionAuthority,
} from "@/lib/boards/authority";
import {
  isGradeablePickCount,
  reserveSlotNumber,
  submissionDepthFromScoring,
} from "@/lib/contest-defaults";
import {
  submissionAllowsRankingEdits,
  submissionIsEligible,
} from "@/lib/contest-lifecycle";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import type {
  ContestStatus,
  ProfileType,
  SubmissionAuthority,
  SubmissionStatus,
} from "@/lib/generated/prisma/client";
import { logServerEvent } from "@/lib/log";
import { getWeekTimingState } from "@/lib/timing/week-windows";

/**
 * FINAL receipts are prospective: only weeks whose full lock is at/after this
 * instant get one (2026 Week 4 onward). Weeks 1–3 are never backfilled.
 */
export const OFFICIAL_BOARD_FINALS_START_AT = new Date(
  "2026-09-28T00:00:00.000Z",
);

export const OFFICIAL_BOARD_LOCKED_MESSAGE =
  "Official Board Locked — the Sunday lock has passed, so the published board can no longer change.";
export const OFFICIAL_BOARD_NOT_OWNER_MESSAGE =
  "Only the owner of an Official RankEyeQ Board can publish it.";
export const OFFICIAL_BOARD_INCOMPLETE_MESSAGE =
  "Submit a complete board (every ranked slot and reserve) before publishing.";
export const OFFICIAL_BOARD_CLAIM_BLOCKED_MESSAGE =
  "This person has an Official Board with published or final versions for a contest the tracked Creator also has a board for. Board versions are never deleted — resolve the duplicate board before approving.";

export class OfficialBoardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfficialBoardError";
  }
}

type BoardSlot = { predictedRank: number; rankableEntryId: string };

/** Deterministic identity of the competitive board (every slot, incl. reserves). */
export function officialBoardFingerprint(input: {
  rankingDepth: number;
  reserveCount: number;
  picks: ReadonlyArray<BoardSlot>;
}): string {
  const slots = [...input.picks]
    .sort((a, b) => a.predictedRank - b.predictedRank)
    .map((pick) => `${pick.predictedRank}:${pick.rankableEntryId}`);
  return createHash("sha256")
    .update(
      JSON.stringify({
        depth: input.rankingDepth,
        reserves: input.reserveCount,
        slots,
      }),
    )
    .digest("hex");
}

/** Every slot 1..submission depth filled exactly once. */
export function isCompleteOfficialBoard(input: {
  rankingDepth: number;
  reserveCount: number;
  picks: ReadonlyArray<BoardSlot>;
}): boolean {
  const depth = submissionDepthFromScoring(
    input.rankingDepth,
    input.reserveCount,
  );
  if (input.picks.length !== depth) return false;
  const ranks = new Set(input.picks.map((pick) => pick.predictedRank));
  const entries = new Set(input.picks.map((pick) => pick.rankableEntryId));
  if (ranks.size !== depth || entries.size !== depth) return false;
  for (let rank = 1; rank <= depth; rank += 1) {
    if (!ranks.has(rank)) return false;
  }
  return true;
}

/** Owner-authored board on a workspace-capable profile with a linked account. */
export function isOfficialBoardOwnerAuthored(input: {
  profileType: ProfileType;
  hasLinkedUser: boolean;
  submission: {
    authority: SubmissionAuthority | null;
    picks: ReadonlyArray<{ sourceRank: number | null }>;
  } | null;
}): boolean {
  if (!isOwnerManagedProfile(input)) return false;
  return (
    resolveSubmissionAuthority({
      profileType: input.profileType,
      submission: input.submission,
    }) === "OWNER_AUTHORED"
  );
}

type LivePick = {
  rankableEntryId: string;
  predictedRank: number;
  slotLocked: boolean;
  lockedAt: Date | null;
  lockedRank: number | null;
  committedAt: Date | null;
  rankableEntry: { name: string; team: string };
};

function versionPickRows(input: {
  picks: ReadonlyArray<LivePick>;
  rankingDepth: number;
  weekTeamByEntryId: Map<string, string | null>;
}) {
  return [...input.picks]
    .sort((a, b) => a.predictedRank - b.predictedRank)
    .map((pick) => {
      const reserveSlot = reserveSlotNumber(
        pick.predictedRank,
        input.rankingDepth,
      );
      return {
        rankableEntryId: pick.rankableEntryId,
        boardRank: pick.predictedRank,
        isReserve: reserveSlot != null,
        reserveSlot,
        displayName: pick.rankableEntry.name,
        displayTeam:
          input.weekTeamByEntryId.get(pick.rankableEntryId) ||
          pick.rankableEntry.team,
        slotLocked: pick.slotLocked,
        lockedAt: pick.lockedAt,
        lockedRank: pick.lockedRank,
        committedAt: pick.committedAt,
      };
    });
}

async function loadWeekTeams(contestId: string) {
  const entries = await prisma.contestEntry.findMany({
    where: { contestId },
    select: { rankableEntryId: true, weekTeam: true },
  });
  return new Map(entries.map((row) => [row.rankableEntryId, row.weekTeam]));
}

function isUniqueViolation(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function boardIsEditable(input: {
  contestStatus: ContestStatus;
  submissionStatus: SubmissionStatus;
  week: {
    rankingsOpenAt: Date | null;
    fullLockAt: Date | null;
    revealStartsAt: Date | null;
    publicReleaseAt: Date | null;
    status: string;
  };
  now: Date;
}) {
  const timing = getWeekTimingState({
    rankingsOpenAt: input.week.rankingsOpenAt,
    fullLockAt: input.week.fullLockAt,
    revealStartsAt: input.week.revealStartsAt,
    publicReleaseAt: input.week.publicReleaseAt,
    weekStatus: input.week.status,
    now: input.now,
  });
  return submissionAllowsRankingEdits({
    contestStatus: input.contestStatus,
    submissionStatus: input.submissionStatus,
    fullBoardLocked: timing.fullBoardLocked,
    fullLockAt: input.week.fullLockAt,
    now: input.now,
  });
}

export type PublishOfficialBoardResult = {
  outcome: "published" | "updated" | "unchanged";
  versionNumber: number;
};

/**
 * Publish My Board / Update Published Board. The caller passes the session's
 * user id; the profile is resolved from that user, never from client input.
 * Creates an immutable PUBLISHED version only when the competitive board's
 * fingerprint differs from the latest published version. Never touches locks,
 * reserves, availability, grading or scoring.
 */
export async function publishOfficialBoard(input: {
  userId: string;
  contestId: string;
  now?: Date;
}): Promise<PublishOfficialBoardResult> {
  const now = input.now ?? new Date();
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    include: { universalProfile: true },
  });
  const profile = user?.universalProfile;
  if (!user || !profile) {
    throw new OfficialBoardError(OFFICIAL_BOARD_NOT_OWNER_MESSAGE);
  }
  if (profile.status === "SUSPENDED") {
    throw new OfficialBoardError(
      "This profile is suspended and cannot publish boards.",
    );
  }

  const contest = await prisma.rankIQContest.findUnique({
    where: { id: input.contestId },
    include: { week: true },
  });
  if (!contest) throw new OfficialBoardError("Contest not found.");

  const submission = await prisma.rankingSubmission.findUnique({
    where: {
      contestId_universalProfileId: {
        contestId: contest.id,
        universalProfileId: profile.id,
      },
    },
    include: {
      picks: {
        include: { rankableEntry: true },
        orderBy: { predictedRank: "asc" },
      },
    },
  });
  if (
    !submission ||
    !isOfficialBoardOwnerAuthored({
      profileType: profile.profileType,
      hasLinkedUser: true,
      submission,
    })
  ) {
    throw new OfficialBoardError(OFFICIAL_BOARD_NOT_OWNER_MESSAGE);
  }

  if (
    !boardIsEditable({
      contestStatus: contest.status,
      submissionStatus: submission.status,
      week: contest.week,
      now,
    })
  ) {
    throw new OfficialBoardError(OFFICIAL_BOARD_LOCKED_MESSAGE);
  }

  // Premature LOCKED before full lock behaves as SUBMITTED (editable above).
  const submitted =
    submission.status === "SUBMITTED" || submission.status === "LOCKED";
  const boardShape = {
    rankingDepth: contest.rankingDepth,
    reserveCount: contest.reserveCount,
    picks: submission.picks,
  };
  if (!submitted || !isCompleteOfficialBoard(boardShape)) {
    throw new OfficialBoardError(OFFICIAL_BOARD_INCOMPLETE_MESSAGE);
  }

  const fingerprint = officialBoardFingerprint(boardShape);
  const weekTeamByEntryId = await loadWeekTeams(contest.id);
  const pickRows = versionPickRows({
    picks: submission.picks,
    rankingDepth: contest.rankingDepth,
    weekTeamByEntryId,
  });

  const latestPublished = async () =>
    prisma.officialBoardPublication.findUnique({
      where: { submissionId: submission.id },
      include: {
        latestPublishedVersion: {
          select: { fingerprint: true, versionNumber: true },
        },
      },
    });

  try {
    return await prisma.$transaction(async (tx) => {
      const publication = await tx.officialBoardPublication.findUnique({
        where: { submissionId: submission.id },
        include: {
          latestPublishedVersion: {
            select: { fingerprint: true, versionNumber: true },
          },
        },
      });
      if (publication?.latestPublishedVersion.fingerprint === fingerprint) {
        return {
          outcome: "unchanged" as const,
          versionNumber: publication.latestPublishedVersion.versionNumber,
        };
      }
      const previous = await tx.officialBoardVersion.findFirst({
        where: { submissionId: submission.id, kind: "PUBLISHED" },
        orderBy: { versionNumber: "desc" },
        select: { versionNumber: true },
      });
      const versionNumber = (previous?.versionNumber ?? 0) + 1;
      const version = await tx.officialBoardVersion.create({
        data: {
          submissionId: submission.id,
          contestId: contest.id,
          profileId: profile.id,
          kind: "PUBLISHED",
          versionNumber,
          authorUserId: user.id,
          rankingDepth: contest.rankingDepth,
          reserveCount: contest.reserveCount,
          fingerprint,
          picks: { create: pickRows },
        },
        select: { id: true },
      });
      if (publication) {
        await tx.officialBoardPublication.update({
          where: { id: publication.id },
          data: {
            lastPublishedAt: now,
            latestPublishedVersionId: version.id,
          },
        });
      } else {
        await tx.officialBoardPublication.create({
          data: {
            submissionId: submission.id,
            contestId: contest.id,
            profileId: profile.id,
            firstPublishedAt: now,
            lastPublishedAt: now,
            latestPublishedVersionId: version.id,
          },
        });
      }
      return {
        outcome: publication ? ("updated" as const) : ("published" as const),
        versionNumber,
      };
    });
  } catch (error) {
    // Concurrent identical presses: the other request already wrote this board.
    if (isUniqueViolation(error)) {
      const current = await latestPublished();
      if (current?.latestPublishedVersion.fingerprint === fingerprint) {
        return {
          outcome: "unchanged",
          versionNumber: current.latestPublishedVersion.versionNumber,
        };
      }
      throw new OfficialBoardError(
        "Your board changed while publishing — try again.",
      );
    }
    throw error;
  }
}

export type FinalsSkipReason =
  | "contest_not_found"
  | "historical_contest"
  | "before_finals_start"
  | "before_full_lock";

export type EnsureFinalsResult = {
  contestId: string;
  created: number;
  existing: number;
  skipped: null | FinalsSkipReason;
};

export class OfficialBoardFinalsIncompleteError extends OfficialBoardError {
  constructor(contestId: string, missing: number) {
    super(
      `Required FINAL Official Board receipts are missing for ${missing} board(s) in contest ${contestId}; grading is blocked until they are captured.`,
    );
    this.name = "OfficialBoardFinalsIncompleteError";
  }
}

/** Whether a week participates in FINAL receipts at all (prospective cutoff). */
export function weekHasOfficialBoardFinals(
  fullLockAt: Date | null,
  finalsStartAt: Date = OFFICIAL_BOARD_FINALS_START_AT,
): boolean {
  return fullLockAt != null && fullLockAt >= finalsStartAt;
}

async function loadFinalsCandidates(
  contestId: string,
  now: Date,
  finalsStartAt: Date,
) {
  const contest = await prisma.rankIQContest.findUnique({
    where: { id: contestId },
    include: { week: true },
  });
  if (!contest) return { skipped: "contest_not_found" as const };
  if (contest.status === "FINAL" || contest.status === "ARCHIVED") {
    return { skipped: "historical_contest" as const };
  }
  const fullLockAt = contest.week.fullLockAt;
  if (fullLockAt && !weekHasOfficialBoardFinals(fullLockAt, finalsStartAt)) {
    return { skipped: "before_finals_start" as const };
  }
  if (!fullLockAt || now < fullLockAt) {
    return { skipped: "before_full_lock" as const };
  }

  const submissions = await prisma.rankingSubmission.findMany({
    where: {
      contestId,
      status: { in: ["SUBMITTED", "LOCKED", "GRADED"] },
      universalProfile: { profileType: { in: ["HUMAN", "CREATOR"] } },
    },
    include: {
      universalProfile: { select: { profileType: true } },
      picks: {
        include: { rankableEntry: true },
        orderBy: { predictedRank: "asc" },
      },
      officialBoardVersions: {
        where: { kind: "FINAL" },
        select: { id: true },
      },
    },
  });
  const existing = submissions.filter(
    (submission) => submission.officialBoardVersions.length > 0,
  );
  const missing = submissions.filter(
    (submission) =>
      submission.officialBoardVersions.length === 0 &&
      submissionIsEligible(submission.status) &&
      resolveSubmissionAuthority({
        profileType: submission.universalProfile.profileType,
        submission,
      }) === "OWNER_AUTHORED" &&
      isGradeablePickCount(submission.picks.length, contest.rankingDepth),
  );
  return { skipped: null, contest, fullLockAt, existing, missing };
}

export type OfficialBoardFinalsPlan = {
  contestId: string;
  skipped: null | FinalsSkipReason;
  existingSubmissionIds: string[];
  missing: Array<{ submissionId: string; profileId: string }>;
};

/**
 * Zero-write preview of what the canonical FINAL capture would do right now.
 * Same eligibility and cutoff rules as ensureOfficialBoardFinalsForContest.
 */
export async function planOfficialBoardFinalsForContest(
  contestId: string,
  now = new Date(),
): Promise<OfficialBoardFinalsPlan> {
  const loaded = await loadFinalsCandidates(
    contestId,
    now,
    OFFICIAL_BOARD_FINALS_START_AT,
  );
  if (loaded.skipped) {
    return {
      contestId,
      skipped: loaded.skipped,
      existingSubmissionIds: [],
      missing: [],
    };
  }
  return {
    contestId,
    skipped: null,
    existingSubmissionIds: loaded.existing.map((submission) => submission.id),
    missing: loaded.missing.map((submission) => ({
      submissionId: submission.id,
      profileId: submission.universalProfileId,
    })),
  };
}

/**
 * Canonical FINAL capture (full-lock lifecycle, pre-grade backstop, admin
 * repair). Idempotently creates exactly one immutable FINAL per eligible
 * owner-authored board once the week has fully locked; an existing FINAL is
 * never replaced. FINAL is the full-lock ranking + slot-lock state only —
 * later kickoff-unavailability freezes are never copied into it — and it is
 * never a grading input. Pre-activation weeks and FINAL / ARCHIVED contests
 * are never backfilled. Throws when a required FINAL is still missing after
 * capture so grading entry points stay blocked.
 */
export async function ensureOfficialBoardFinalsForContest(
  contestId: string,
  now = new Date(),
  options?: { finalsStartAt?: Date },
): Promise<EnsureFinalsResult> {
  const result: EnsureFinalsResult = {
    contestId,
    created: 0,
    existing: 0,
    skipped: null,
  };
  const loaded = await loadFinalsCandidates(
    contestId,
    now,
    options?.finalsStartAt ?? OFFICIAL_BOARD_FINALS_START_AT,
  );
  if (loaded.skipped) return { ...result, skipped: loaded.skipped };
  const { contest, fullLockAt } = loaded;
  result.existing = loaded.existing.length;

  const weekTeamByEntryId = await loadWeekTeams(contestId);
  for (const submission of loaded.missing) {
    try {
      await prisma.officialBoardVersion.create({
        data: {
          submissionId: submission.id,
          contestId,
          profileId: submission.universalProfileId,
          kind: "FINAL",
          versionNumber: 1,
          authorUserId: null,
          rankingDepth: contest.rankingDepth,
          reserveCount: contest.reserveCount,
          fingerprint: officialBoardFingerprint({
            rankingDepth: contest.rankingDepth,
            reserveCount: contest.reserveCount,
            picks: submission.picks,
          }),
          boardLockedAt: fullLockAt,
          picks: {
            create: versionPickRows({
              picks: submission.picks,
              rankingDepth: contest.rankingDepth,
              weekTeamByEntryId,
            }),
          },
        },
        select: { id: true },
      });
      result.created += 1;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      result.existing += 1;
    }
  }

  const requiredIds = loaded.missing.map((submission) => submission.id);
  if (requiredIds.length > 0) {
    const captured = await prisma.officialBoardVersion.count({
      where: { kind: "FINAL", submissionId: { in: requiredIds } },
    });
    if (captured < requiredIds.length) {
      throw new OfficialBoardFinalsIncompleteError(
        contestId,
        requiredIds.length - captured,
      );
    }
  }

  if (result.created > 0) {
    logServerEvent("official_board.finals_captured", {
      contestId,
      created: result.created,
      existing: result.existing,
    });
  }
  return result;
}

/**
 * Full-lock lifecycle hook (lazy, runs from ensureWeekFullLock). Cheap no-op
 * once every eligible board already has its FINAL.
 */
export async function ensureOfficialBoardFinalsForWeek(
  weekId: string,
  now = new Date(),
  options?: { finalsStartAt?: Date },
) {
  const week = await prisma.week.findUnique({
    where: { id: weekId },
    select: { fullLockAt: true },
  });
  const startAt = options?.finalsStartAt ?? OFFICIAL_BOARD_FINALS_START_AT;
  if (
    !week?.fullLockAt ||
    now < week.fullLockAt ||
    !weekHasOfficialBoardFinals(week.fullLockAt, startAt)
  ) {
    return [];
  }
  const pending = await prisma.rankingSubmission.findMany({
    where: {
      contest: { weekId, status: { notIn: ["FINAL", "ARCHIVED"] } },
      status: { in: ["SUBMITTED", "LOCKED", "GRADED"] },
      universalProfile: { profileType: { in: ["HUMAN", "CREATOR"] } },
      officialBoardVersions: { none: { kind: "FINAL" } },
    },
    select: { contestId: true },
    distinct: ["contestId"],
  });
  const results: EnsureFinalsResult[] = [];
  for (const row of pending) {
    results.push(
      await ensureOfficialBoardFinalsForContest(row.contestId, now, options),
    );
  }
  return results;
}

/** Contests in a week whose boards already have FINAL receipts (heal guard). */
export async function contestIdsWithFinalReceipts(
  weekId: string,
): Promise<Set<string>> {
  const rows = await prisma.officialBoardVersion.findMany({
    where: { kind: "FINAL", contest: { weekId } },
    select: { contestId: true },
    distinct: ["contestId"],
  });
  return new Set(rows.map((row) => row.contestId));
}

export type OfficialBoardVersionView = {
  versionNumber: number;
  kind: "PUBLISHED" | "FINAL";
  createdAt: Date;
  boardLockedAt: Date | null;
  picks: Array<{
    rankableEntryId: string;
    boardRank: number;
    isReserve: boolean;
    reserveSlot: number | null;
    displayName: string;
    displayTeam: string;
    slotLocked: boolean;
    lockedAt: Date | null;
    lockedRank: number | null;
    committedAt: Date | null;
  }>;
};

const versionViewSelect = {
  versionNumber: true,
  kind: true,
  createdAt: true,
  boardLockedAt: true,
  picks: {
    orderBy: { boardRank: "asc" as const },
    select: {
      rankableEntryId: true,
      boardRank: true,
      isReserve: true,
      reserveSlot: true,
      displayName: true,
      displayTeam: true,
      slotLocked: true,
      lockedAt: true,
      lockedRank: true,
      committedAt: true,
    },
  },
} as const;

export async function loadOfficialBoardVersions(submissionId: string): Promise<{
  published: (OfficialBoardVersionView & {
    firstPublishedAt: Date;
    lastPublishedAt: Date;
  }) | null;
  final: OfficialBoardVersionView | null;
}> {
  const publication = await prisma.officialBoardPublication.findUnique({
    where: { submissionId },
    select: {
      firstPublishedAt: true,
      lastPublishedAt: true,
      latestPublishedVersion: { select: versionViewSelect },
    },
  });
  const final = await prisma.officialBoardVersion.findFirst({
    where: { submissionId, kind: "FINAL" },
    select: versionViewSelect,
  });
  return {
    published: publication
      ? {
          ...publication.latestPublishedVersion,
          firstPublishedAt: publication.firstPublishedAt,
          lastPublishedAt: publication.lastPublishedAt,
        }
      : null,
    final,
  };
}

export type OwnerOfficialBoardStatus =
  | { state: "UNAVAILABLE" }
  | {
      state: "PROTECTED";
      canPublish: boolean;
      blockedReason: string | null;
    }
  | {
      state: "PUBLISHED";
      versionNumber: number;
      lastPublishedAt: Date;
      hasPendingChanges: boolean;
      canUpdate: boolean;
      blockedReason: string | null;
    }
  | { state: "LOCKED"; publishedVersionNumber: number | null };

/** Workspace owner panel state for the signed-in owner's own board. */
export async function getOwnerOfficialBoardStatus(input: {
  profileId: string;
  profileType: ProfileType;
  contestId: string;
  now?: Date;
}): Promise<OwnerOfficialBoardStatus> {
  const now = input.now ?? new Date();
  const contest = await prisma.rankIQContest.findUnique({
    where: { id: input.contestId },
    include: { week: true },
  });
  if (!contest) return { state: "UNAVAILABLE" };
  const submission = await prisma.rankingSubmission.findUnique({
    where: {
      contestId_universalProfileId: {
        contestId: contest.id,
        universalProfileId: input.profileId,
      },
    },
    include: { picks: { orderBy: { predictedRank: "asc" } } },
  });
  const hasBoardContent = Boolean(submission && submission.picks.length > 0);
  const ownerAuthored =
    submission != null &&
    (!hasBoardContent ||
      isOfficialBoardOwnerAuthored({
        profileType: input.profileType,
        hasLinkedUser: true,
        submission,
      }));
  if (
    !isOwnerManagedProfile({
      profileType: input.profileType,
      hasLinkedUser: true,
    }) ||
    (submission != null && !ownerAuthored)
  ) {
    return { state: "UNAVAILABLE" };
  }

  const publication = submission
    ? await prisma.officialBoardPublication.findUnique({
        where: { submissionId: submission.id },
        include: {
          latestPublishedVersion: {
            select: { fingerprint: true, versionNumber: true },
          },
        },
      })
    : null;

  const editable =
    submission != null &&
    boardIsEditable({
      contestStatus: contest.status,
      submissionStatus: submission.status,
      week: contest.week,
      now,
    });
  const lockedByTime =
    contest.week.fullLockAt != null && now >= contest.week.fullLockAt;
  if (lockedByTime || (submission != null && !editable)) {
    return {
      state: "LOCKED",
      publishedVersionNumber:
        publication?.latestPublishedVersion.versionNumber ?? null,
    };
  }

  const boardShape = submission
    ? {
        rankingDepth: contest.rankingDepth,
        reserveCount: contest.reserveCount,
        picks: submission.picks,
      }
    : null;
  const submitted =
    submission?.status === "SUBMITTED" || submission?.status === "LOCKED";
  const complete =
    boardShape != null && submitted && isCompleteOfficialBoard(boardShape);
  const blockedReason = complete ? null : OFFICIAL_BOARD_INCOMPLETE_MESSAGE;

  if (!publication) {
    return { state: "PROTECTED", canPublish: complete, blockedReason };
  }
  const hasPendingChanges =
    boardShape == null ||
    officialBoardFingerprint(boardShape) !==
      publication.latestPublishedVersion.fingerprint;
  return {
    state: "PUBLISHED",
    versionNumber: publication.latestPublishedVersion.versionNumber,
    lastPublishedAt: publication.lastPublishedAt,
    hasPendingChanges,
    canUpdate: hasPendingChanges && complete,
    blockedReason: hasPendingChanges ? blockedReason : null,
  };
}

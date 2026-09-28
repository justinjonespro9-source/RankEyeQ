/**
 * Official Boards Admin Operations — inspection, diagnostics and narrow repair.
 *
 * Not a competitive authority. Reads RankingSubmission / RankingPick and the
 * immutable Official Board version tables. The only writes are:
 *  - Capture Missing FINALs, through the canonical lifecycle/grading service
 *    (ensureOfficialBoardFinalsForContest), honoring OFFICIAL_BOARD_FINALS_START_AT;
 *  - audited WeeklyContent moderation (suppress / restore public display).
 * Never publishes or updates another user's board, unpublishes, edits or
 * deletes PUBLISHED / FINAL versions, changes SubmissionAuthority or touches
 * competitive picks (enforced by lib/admin/official-boards.test.ts).
 */
import { assertAdminRole } from "@/lib/admin/access";
import {
  isOwnerManagedProfile,
  resolveSubmissionAuthority,
} from "@/lib/boards/authority";
import {
  OFFICIAL_BOARD_FINALS_START_AT,
  ensureOfficialBoardFinalsForContest,
  officialBoardFingerprint,
  planOfficialBoardFinalsForContest,
  weekHasOfficialBoardFinals,
  type EnsureFinalsResult,
  type FinalsSkipReason,
} from "@/lib/boards/official-board";
import { isGradeablePickCount } from "@/lib/contest-defaults";
import { submissionIsEligible } from "@/lib/contest-lifecycle";
import { prisma } from "@/lib/db";
import type {
  ContestPosition,
  ContestStatus,
  OfficialBoardVersionKind,
  ProfileType,
  SubmissionAuthority,
  SubmissionStatus,
  WeeklyContentType,
} from "@/lib/generated/prisma/client";
import {
  reconstructStoredScoringBoard,
  type StoredScoringBoardRow,
} from "@/lib/reserves/stored-scoring-board";

export class OfficialBoardsAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfficialBoardsAdminError";
  }
}

export const WEEKLY_CONTENT_SUPPRESSION_REASON_MAX = 200;

const POSITION_ORDER: ContestPosition[] = ["QB", "RB", "WR", "TE", "DEF"];

export type DiagnosticSeverity = "error" | "warning" | "info";

export type OfficialBoardDiagnostic = {
  code:
    | "MISSING_FINAL"
    | "MISSING_FINAL_HISTORICAL"
    | "FINAL_ON_PRE_ACTIVATION_WEEK"
    | "FINAL_DIFFERS_FROM_COMPETITIVE_BOARD"
    | "PUBLISHED_AFTER_LOCK"
    | "VERSIONS_ON_NON_OFFICIAL_BOARD"
    | "VERSION_PROFILE_MOVED";
  severity: DiagnosticSeverity;
  message: string;
};

export type FinalReadinessState =
  | "PRE_ACTIVATION"
  | "BEFORE_FULL_LOCK"
  | "HISTORICAL"
  | "READY"
  | "MISSING";

export type ContestFinalReadiness = {
  contestId: string;
  position: ContestPosition;
  contestStatus: ContestStatus;
  state: FinalReadinessState;
  captured: number;
  missing: number;
  missingSubmissionIds: string[];
  /** Grading entry points refuse to grade until the missing FINALs exist. */
  gradingBlockedUntilCaptured: boolean;
  message: string;
};

export type FinalRowState =
  | "CAPTURED"
  | "MISSING"
  | "PENDING_FULL_LOCK"
  | "PRE_ACTIVATION"
  | "NOT_REQUIRED";

export type OfficialBoardAdminRow = {
  submissionId: string;
  contestId: string;
  position: ContestPosition;
  contestStatus: ContestStatus;
  profileId: string;
  username: string;
  displayName: string;
  profileType: ProfileType;
  storedAuthority: SubmissionAuthority | null;
  resolvedAuthority: SubmissionAuthority | null;
  /** Owner-authored board on an owner-managed profile (has an Official Board). */
  officialBoard: boolean;
  submissionStatus: SubmissionStatus;
  pickCount: number;
  /** Eligible for FINAL capture (competed at full lock). */
  eligible: boolean;
  publication: {
    state: "PROTECTED" | "PUBLISHED";
    firstPublishedAt: Date | null;
    lastPublishedAt: Date | null;
    latestVersionNumber: number | null;
  };
  publishedVersionCount: number;
  final: {
    state: FinalRowState;
    createdAt: Date | null;
    boardLockedAt: Date | null;
  };
  weeklyContent: {
    count: number;
    types: WeeklyContentType[];
    suppressed: number;
  };
  grading: {
    graded: boolean;
    normalizedScore: number | null;
  };
  diagnostics: OfficialBoardDiagnostic[];
};

export type WeeklyContentModerationRow = {
  id: string;
  profileId: string;
  username: string;
  displayName: string;
  title: string;
  url: string;
  host: string | null;
  type: WeeklyContentType;
  position: ContestPosition | null;
  suppressedAt: Date | null;
  suppressionReason: string | null;
  suppressedByEmail: string | null;
};

export type OfficialBoardsWeekOps = {
  week: {
    id: string;
    label: string;
    weekNumber: number;
    seasonYear: number;
    status: string;
    fullLockAt: Date | null;
  };
  activation: {
    finalsStartAt: Date;
    /** Week participates in FINAL receipts (full lock at/after the cutoff). */
    active: boolean;
    /** Active and past full lock: eligible boards must have FINAL. */
    finalsRequired: boolean;
  };
  summary: {
    eligibleOwnerAuthored: number;
    protected: number;
    published: number;
    finalComplete: number;
    missingFinal: number;
    weeklyContentAttached: number;
    weeklyContentSuppressed: number;
    diagnostics: number;
  };
  contests: ContestFinalReadiness[];
  rows: OfficialBoardAdminRow[];
  weeklyContent: WeeklyContentModerationRow[];
};

/** Defense in depth behind the actions' assertAdmin session check. */
async function assertAdminUser(adminUserId: string) {
  const user = await prisma.user.findUnique({
    where: { id: adminUserId },
    select: { role: true },
  });
  assertAdminRole(user?.role);
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function readinessFor(input: {
  contestId: string;
  position: ContestPosition;
  contestStatus: ContestStatus;
  fullLockAt: Date | null;
  captured: number;
  plan: { skipped: FinalsSkipReason | null; missingSubmissionIds: string[] };
}): ContestFinalReadiness {
  const base = {
    contestId: input.contestId,
    position: input.position,
    contestStatus: input.contestStatus,
    captured: input.captured,
    missing: 0,
    missingSubmissionIds: [],
    gradingBlockedUntilCaptured: false,
  };
  if (input.fullLockAt && !weekHasOfficialBoardFinals(input.fullLockAt)) {
    return {
      ...base,
      state: "PRE_ACTIVATION",
      message:
        "Before Official Boards FINAL activation — no FINAL receipts are required or created.",
    };
  }
  if (input.plan.skipped === "historical_contest") {
    return {
      ...base,
      state: "HISTORICAL",
      message: "Contest is finalized — FINAL receipts are never backfilled.",
    };
  }
  if (input.plan.skipped) {
    return {
      ...base,
      state: "BEFORE_FULL_LOCK",
      message: "FINAL receipts are captured at the Sunday full lock.",
    };
  }
  const missing = input.plan.missingSubmissionIds.length;
  if (missing > 0) {
    return {
      ...base,
      state: "MISSING",
      missing,
      missingSubmissionIds: input.plan.missingSubmissionIds,
      gradingBlockedUntilCaptured: true,
      message: `${missing} required FINAL receipt(s) missing — grading runs the canonical capture first and is blocked if it cannot preserve them. Capture Missing FINALs to resolve.`,
    };
  }
  return {
    ...base,
    state: "READY",
    message: "Every eligible Official Board has its FINAL receipt.",
  };
}

/**
 * FINAL readiness for every contest in a week (zero-write). Shared by the
 * Official Boards page, Ops Status, Diagnostics and Contest Admin.
 */
export async function getOfficialBoardFinalReadiness(
  weekId: string,
  now = new Date(),
): Promise<ContestFinalReadiness[]> {
  const week = await prisma.week.findUnique({
    where: { id: weekId },
    select: {
      fullLockAt: true,
      contests: { select: { id: true, position: true, status: true } },
    },
  });
  if (!week) return [];
  const capturedByContest = new Map(
    (
      await prisma.officialBoardVersion.groupBy({
        by: ["contestId"],
        where: { kind: "FINAL", contest: { weekId } },
        _count: { _all: true },
      })
    ).map((row) => [row.contestId, row._count._all]),
  );
  const contests = [...week.contests].sort(
    (a, b) =>
      POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position),
  );
  const out: ContestFinalReadiness[] = [];
  for (const contest of contests) {
    const plan = await planOfficialBoardFinalsForContest(contest.id, now);
    out.push(
      readinessFor({
        contestId: contest.id,
        position: contest.position,
        contestStatus: contest.status,
        fullLockAt: week.fullLockAt,
        captured: capturedByContest.get(contest.id) ?? 0,
        plan: {
          skipped: plan.skipped,
          missingSubmissionIds: plan.missing.map((row) => row.submissionId),
        },
      }),
    );
  }
  return out;
}

export async function getContestFinalReadiness(
  contestId: string,
  now = new Date(),
): Promise<ContestFinalReadiness | null> {
  const contest = await prisma.rankIQContest.findUnique({
    where: { id: contestId },
    select: { weekId: true },
  });
  if (!contest) return null;
  const all = await getOfficialBoardFinalReadiness(contest.weekId, now);
  return all.find((row) => row.contestId === contestId) ?? null;
}

/** Week-first Official Boards inspection (zero-write). */
export async function getOfficialBoardsWeekOps(
  weekId: string,
  now = new Date(),
): Promise<OfficialBoardsWeekOps | null> {
  const week = await prisma.week.findUnique({
    where: { id: weekId },
    include: { season: { select: { year: true } } },
  });
  if (!week) return null;

  const active = weekHasOfficialBoardFinals(week.fullLockAt);
  const pastFullLock = week.fullLockAt != null && now >= week.fullLockAt;
  const finalsRequired = active && pastFullLock;
  const contests = await getOfficialBoardFinalReadiness(weekId, now);
  const missingSubmissionIds = new Set(
    contests.flatMap((contest) => contest.missingSubmissionIds),
  );

  const submissions = await prisma.rankingSubmission.findMany({
    where: {
      contest: { weekId },
      OR: [
        {
          universalProfile: { profileType: { in: ["HUMAN", "CREATOR"] } },
          picks: { some: {} },
        },
        { officialBoardVersions: { some: {} } },
      ],
    },
    include: {
      contest: {
        select: {
          id: true,
          position: true,
          status: true,
          rankingDepth: true,
          reserveCount: true,
        },
      },
      universalProfile: {
        select: {
          id: true,
          username: true,
          displayName: true,
          profileType: true,
          authUser: { select: { id: true } },
        },
      },
      picks: {
        select: { predictedRank: true, rankableEntryId: true, sourceRank: true },
        orderBy: { predictedRank: "asc" },
      },
      officialBoardPublication: {
        select: {
          firstPublishedAt: true,
          lastPublishedAt: true,
          latestPublishedVersion: { select: { versionNumber: true } },
        },
      },
      officialBoardVersions: {
        select: {
          kind: true,
          versionNumber: true,
          profileId: true,
          fingerprint: true,
          createdAt: true,
          boardLockedAt: true,
        },
      },
    },
  });

  const contentRows = await prisma.weeklyContent.findMany({
    where: { weekId },
    orderBy: [{ profileId: "asc" }, { createdAt: "asc" }],
    include: {
      profile: { select: { username: true, displayName: true } },
      suppressedBy: { select: { email: true } },
    },
  });

  const rows: OfficialBoardAdminRow[] = submissions.map((submission) => {
    const profile = submission.universalProfile;
    const contest = submission.contest;
    const hasLinkedUser = profile.authUser != null;
    const resolvedAuthority = resolveSubmissionAuthority({
      profileType: profile.profileType,
      submission,
    });
    const officialBoard =
      isOwnerManagedProfile({ profileType: profile.profileType, hasLinkedUser }) &&
      resolvedAuthority === "OWNER_AUTHORED";
    const eligible =
      officialBoard &&
      submissionIsEligible(submission.status) &&
      isGradeablePickCount(submission.picks.length, contest.rankingDepth);
    const published = submission.officialBoardVersions.filter(
      (version) => version.kind === "PUBLISHED",
    );
    const final =
      submission.officialBoardVersions.find((version) => version.kind === "FINAL") ??
      null;
    const contestHistorical =
      contest.status === "FINAL" || contest.status === "ARCHIVED";

    let finalState: FinalRowState = "NOT_REQUIRED";
    if (final) finalState = "CAPTURED";
    else if (missingSubmissionIds.has(submission.id)) finalState = "MISSING";
    else if (eligible && !active && week.fullLockAt) finalState = "PRE_ACTIVATION";
    else if (eligible && active && !pastFullLock) finalState = "PENDING_FULL_LOCK";

    const diagnostics: OfficialBoardDiagnostic[] = [];
    if (finalState === "MISSING") {
      diagnostics.push({
        code: "MISSING_FINAL",
        severity: "error",
        message:
          "Required FINAL receipt missing — grading is blocked until it is captured.",
      });
    } else if (eligible && finalsRequired && !final && contestHistorical) {
      diagnostics.push({
        code: "MISSING_FINAL_HISTORICAL",
        severity: "warning",
        message:
          "Contest was finalized without this FINAL receipt; FINAL is never backfilled.",
      });
    }
    if (final && !active) {
      diagnostics.push({
        code: "FINAL_ON_PRE_ACTIVATION_WEEK",
        severity: "error",
        message: "A FINAL receipt exists for a week before Official Boards activation.",
      });
    }
    if (final && submission.picks.length > 0) {
      const liveFingerprint = officialBoardFingerprint({
        rankingDepth: contest.rankingDepth,
        reserveCount: contest.reserveCount,
        picks: submission.picks,
      });
      if (liveFingerprint !== final.fingerprint) {
        diagnostics.push({
          code: "FINAL_DIFFERS_FROM_COMPETITIVE_BOARD",
          severity: "warning",
          message:
            "The competitive submission no longer matches its FINAL receipt (post-lock change). FINAL is unchanged and never feeds grading.",
        });
      }
    }
    if (
      week.fullLockAt &&
      published.some((version) => version.createdAt >= week.fullLockAt!)
    ) {
      diagnostics.push({
        code: "PUBLISHED_AFTER_LOCK",
        severity: "error",
        message: "A PUBLISHED version was created after the Sunday full lock.",
      });
    }
    if (!officialBoard && submission.officialBoardVersions.length > 0) {
      diagnostics.push({
        code: "VERSIONS_ON_NON_OFFICIAL_BOARD",
        severity: "warning",
        message:
          "Board versions exist but this board is no longer owner-authored on an owner-managed profile.",
      });
    }
    if (
      submission.officialBoardVersions.some(
        (version) => version.profileId !== submission.universalProfileId,
      )
    ) {
      diagnostics.push({
        code: "VERSION_PROFILE_MOVED",
        severity: "info",
        message:
          "Board moved by a claim; versions keep the original authoring profile.",
      });
    }

    const content = contentRows.filter(
      (item) =>
        item.profileId === profile.id &&
        (item.position == null || item.position === contest.position),
    );

    return {
      submissionId: submission.id,
      contestId: contest.id,
      position: contest.position,
      contestStatus: contest.status,
      profileId: profile.id,
      username: profile.username,
      displayName: profile.displayName,
      profileType: profile.profileType,
      storedAuthority: submission.authority,
      resolvedAuthority,
      officialBoard,
      submissionStatus: submission.status,
      pickCount: submission.picks.length,
      eligible,
      publication: submission.officialBoardPublication
        ? {
            state: "PUBLISHED",
            firstPublishedAt: submission.officialBoardPublication.firstPublishedAt,
            lastPublishedAt: submission.officialBoardPublication.lastPublishedAt,
            latestVersionNumber:
              submission.officialBoardPublication.latestPublishedVersion
                .versionNumber,
          }
        : {
            state: "PROTECTED",
            firstPublishedAt: null,
            lastPublishedAt: null,
            latestVersionNumber: null,
          },
      publishedVersionCount: published.length,
      final: {
        state: finalState,
        createdAt: final?.createdAt ?? null,
        boardLockedAt: final?.boardLockedAt ?? null,
      },
      weeklyContent: {
        count: content.length,
        types: [...new Set(content.map((item) => item.type))],
        suppressed: content.filter((item) => item.suppressedAt != null).length,
      },
      grading: {
        graded: submission.status === "GRADED",
        normalizedScore: submission.normalizedScore,
      },
      diagnostics,
    };
  });

  rows.sort(
    (a, b) =>
      Number(b.officialBoard) - Number(a.officialBoard) ||
      POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position) ||
      a.username.localeCompare(b.username),
  );

  const officialRows = rows.filter((row) => row.officialBoard);
  const flaggedRows = rows.filter((row) =>
    row.diagnostics.some((diagnostic) => diagnostic.severity !== "info"),
  ).length;

  return {
    week: {
      id: week.id,
      label: week.label,
      weekNumber: week.weekNumber,
      seasonYear: week.season.year,
      status: week.status,
      fullLockAt: week.fullLockAt,
    },
    activation: {
      finalsStartAt: OFFICIAL_BOARD_FINALS_START_AT,
      active,
      finalsRequired,
    },
    summary: {
      eligibleOwnerAuthored: officialRows.filter((row) => row.eligible).length,
      protected: officialRows.filter((row) => row.publication.state === "PROTECTED")
        .length,
      published: officialRows.filter((row) => row.publication.state === "PUBLISHED")
        .length,
      finalComplete: rows.filter((row) => row.final.state === "CAPTURED").length,
      missingFinal: rows.filter((row) => row.final.state === "MISSING").length,
      weeklyContentAttached: contentRows.length,
      weeklyContentSuppressed: contentRows.filter((row) => row.suppressedAt != null)
        .length,
      diagnostics: flaggedRows,
    },
    contests,
    rows,
    weeklyContent: contentRows.map((item) => ({
      id: item.id,
      profileId: item.profileId,
      username: item.profile.username,
      displayName: item.profile.displayName,
      title: item.title,
      url: item.url,
      host: hostOf(item.url),
      type: item.type,
      position: item.position,
      suppressedAt: item.suppressedAt,
      suppressionReason: item.suppressionReason,
      suppressedByEmail: item.suppressedBy?.email ?? null,
    })),
  };
}

export type AdminBoardVersionView = {
  id: string;
  kind: OfficialBoardVersionKind;
  versionNumber: number;
  fingerprint: string;
  createdAt: Date;
  boardLockedAt: Date | null;
  authorEmail: string | null;
  profileId: string;
  picks: Array<{
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

export type OfficialBoardAdminDetail = {
  submission: {
    id: string;
    status: SubmissionStatus;
    storedAuthority: SubmissionAuthority | null;
    resolvedAuthority: SubmissionAuthority | null;
    submittedAt: Date | null;
    lockedAt: Date | null;
    normalizedScore: number | null;
    fingerprint: string;
    picks: Array<{
      predictedRank: number;
      name: string;
      team: string;
      slotLocked: boolean;
      lockedAt: Date | null;
      wasUnavailableAtKickoff: boolean | null;
    }>;
  };
  profile: {
    id: string;
    username: string;
    displayName: string;
    profileType: ProfileType;
  };
  contest: {
    id: string;
    position: ContestPosition;
    status: ContestStatus;
    rankingDepth: number;
    reserveCount: number;
  };
  week: { id: string; label: string; fullLockAt: Date | null };
  publication: { firstPublishedAt: Date; lastPublishedAt: Date } | null;
  published: AdminBoardVersionView[];
  final: AdminBoardVersionView | null;
  weeklyContent: WeeklyContentModerationRow[];
  /** Stored scoring board (what produced normalizedScore) once graded. */
  scoringBoard: StoredScoringBoardRow[] | null;
};

/** Drill-down for one board (zero-write; no lifecycle side effects). */
export async function getOfficialBoardAdminDetail(
  submissionId: string,
): Promise<OfficialBoardAdminDetail | null> {
  const submission = await prisma.rankingSubmission.findUnique({
    where: { id: submissionId },
    include: {
      universalProfile: {
        select: { id: true, username: true, displayName: true, profileType: true },
      },
      contest: { include: { week: true } },
      picks: {
        include: { rankableEntry: { select: { name: true, team: true } } },
        orderBy: { predictedRank: "asc" },
      },
      officialBoardPublication: {
        select: { firstPublishedAt: true, lastPublishedAt: true },
      },
      officialBoardVersions: {
        include: {
          authorUser: { select: { email: true } },
          picks: { orderBy: { boardRank: "asc" } },
        },
        orderBy: [{ kind: "asc" }, { versionNumber: "asc" }],
      },
    },
  });
  if (!submission) return null;
  const contest = submission.contest;
  const toView = (
    version: (typeof submission.officialBoardVersions)[number],
  ): AdminBoardVersionView => ({
    id: version.id,
    kind: version.kind,
    versionNumber: version.versionNumber,
    fingerprint: version.fingerprint,
    createdAt: version.createdAt,
    boardLockedAt: version.boardLockedAt,
    authorEmail: version.authorUser?.email ?? null,
    profileId: version.profileId,
    picks: version.picks.map((pick) => ({
      boardRank: pick.boardRank,
      isReserve: pick.isReserve,
      reserveSlot: pick.reserveSlot,
      displayName: pick.displayName,
      displayTeam: pick.displayTeam,
      slotLocked: pick.slotLocked,
      lockedAt: pick.lockedAt,
      lockedRank: pick.lockedRank,
      committedAt: pick.committedAt,
    })),
  });
  const final = submission.officialBoardVersions.find(
    (version) => version.kind === "FINAL",
  );
  const content = await prisma.weeklyContent.findMany({
    where: {
      profileId: submission.universalProfileId,
      weekId: contest.weekId,
      OR: [{ position: null }, { position: contest.position }],
    },
    orderBy: { createdAt: "asc" },
    include: {
      profile: { select: { username: true, displayName: true } },
      suppressedBy: { select: { email: true } },
    },
  });

  return {
    submission: {
      id: submission.id,
      status: submission.status,
      storedAuthority: submission.authority,
      resolvedAuthority: resolveSubmissionAuthority({
        profileType: submission.universalProfile.profileType,
        submission,
      }),
      submittedAt: submission.submittedAt,
      lockedAt: submission.lockedAt,
      normalizedScore: submission.normalizedScore,
      fingerprint: officialBoardFingerprint({
        rankingDepth: contest.rankingDepth,
        reserveCount: contest.reserveCount,
        picks: submission.picks,
      }),
      picks: submission.picks.map((pick) => ({
        predictedRank: pick.predictedRank,
        name: pick.rankableEntry.name,
        team: pick.rankableEntry.team,
        slotLocked: pick.slotLocked,
        lockedAt: pick.lockedAt,
        wasUnavailableAtKickoff: pick.wasUnavailableAtKickoff,
      })),
    },
    profile: submission.universalProfile,
    contest: {
      id: contest.id,
      position: contest.position,
      status: contest.status,
      rankingDepth: contest.rankingDepth,
      reserveCount: contest.reserveCount,
    },
    week: {
      id: contest.week.id,
      label: contest.week.label,
      fullLockAt: contest.week.fullLockAt,
    },
    publication: submission.officialBoardPublication,
    published: submission.officialBoardVersions
      .filter((version) => version.kind === "PUBLISHED")
      .map(toView),
    final: final ? toView(final) : null,
    weeklyContent: content.map((item) => ({
      id: item.id,
      profileId: item.profileId,
      username: item.profile.username,
      displayName: item.profile.displayName,
      title: item.title,
      url: item.url,
      host: hostOf(item.url),
      type: item.type,
      position: item.position,
      suppressedAt: item.suppressedAt,
      suppressionReason: item.suppressionReason,
      suppressedByEmail: item.suppressedBy?.email ?? null,
    })),
    scoringBoard:
      submission.status === "GRADED"
        ? reconstructStoredScoringBoard({
            picks: submission.picks.map((pick) => ({
              rankableEntryId: pick.rankableEntryId,
              predictedRank: pick.predictedRank,
              totalPoints: pick.totalPoints,
              wasUnavailableAtKickoff: pick.wasUnavailableAtKickoff,
              name: pick.rankableEntry.name,
              team: pick.rankableEntry.team,
              actualRank: pick.actualRank,
              basePoints: pick.basePoints,
              accuracyPoints: pick.accuracyPoints,
              podiumPoints: pick.podiumPoints,
            })),
            scoringDepth: contest.rankingDepth,
          })
        : null,
  };
}

export type MissingFinalsPreview = {
  weekId: string;
  activation: { active: boolean; finalsRequired: boolean };
  contests: Array<{
    contestId: string;
    position: ContestPosition;
    skipped: FinalsSkipReason | null;
    wouldCreate: Array<{ submissionId: string; username: string }>;
    alreadyCaptured: number;
  }>;
  totalWouldCreate: number;
};

/** Preview Missing FINALs — the canonical planner only; performs zero writes. */
export async function previewMissingOfficialBoardFinals(
  weekId: string,
  now = new Date(),
): Promise<MissingFinalsPreview> {
  const week = await prisma.week.findUnique({
    where: { id: weekId },
    select: {
      fullLockAt: true,
      contests: { select: { id: true, position: true } },
    },
  });
  if (!week) throw new OfficialBoardsAdminError("Week not found.");
  const active = weekHasOfficialBoardFinals(week.fullLockAt);
  const contests: MissingFinalsPreview["contests"] = [];
  for (const contest of [...week.contests].sort(
    (a, b) =>
      POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position),
  )) {
    const plan = await planOfficialBoardFinalsForContest(contest.id, now);
    const profiles = plan.missing.length
      ? await prisma.universalProfile.findMany({
          where: { id: { in: plan.missing.map((row) => row.profileId) } },
          select: { id: true, username: true },
        })
      : [];
    const usernameById = new Map(profiles.map((row) => [row.id, row.username]));
    contests.push({
      contestId: contest.id,
      position: contest.position,
      skipped: plan.skipped,
      wouldCreate: plan.missing.map((row) => ({
        submissionId: row.submissionId,
        username: usernameById.get(row.profileId) ?? row.profileId,
      })),
      alreadyCaptured: plan.existingSubmissionIds.length,
    });
  }
  return {
    weekId,
    activation: {
      active,
      finalsRequired:
        active && week.fullLockAt != null && now >= week.fullLockAt,
    },
    contests,
    totalWouldCreate: contests.reduce(
      (sum, contest) => sum + contest.wouldCreate.length,
      0,
    ),
  };
}

export type CaptureMissingFinalsResult = {
  weekId: string;
  created: number;
  existing: number;
  contests: EnsureFinalsResult[];
};

/**
 * Capture Missing FINALs — runs the canonical capture (the same service the
 * full-lock lifecycle and grading backstop use) for every contest in the
 * week. Idempotent; never replaces an existing FINAL; honors the activation
 * cutoff (no FINAL for pre-activation weeks). Audited.
 */
export async function captureMissingOfficialBoardFinals(input: {
  adminUserId: string;
  weekId: string;
  now?: Date;
}): Promise<CaptureMissingFinalsResult> {
  await assertAdminUser(input.adminUserId);
  const now = input.now ?? new Date();
  const week = await prisma.week.findUnique({
    where: { id: input.weekId },
    select: {
      id: true,
      label: true,
      fullLockAt: true,
      contests: { select: { id: true } },
    },
  });
  if (!week) throw new OfficialBoardsAdminError("Week not found.");
  const contests: EnsureFinalsResult[] = [];
  try {
    for (const contest of week.contests) {
      contests.push(await ensureOfficialBoardFinalsForContest(contest.id, now));
    }
  } catch (error) {
    await prisma.adminAuditLog.create({
      data: {
        adminUserId: input.adminUserId,
        action: "official_board.capture_missing_finals_failed",
        entityType: "Week",
        entityId: week.id,
        metadata: {
          weekLabel: week.label,
          message: error instanceof Error ? error.message.slice(0, 300) : "unknown",
        },
      },
    });
    throw error;
  }
  const result: CaptureMissingFinalsResult = {
    weekId: week.id,
    created: contests.reduce((sum, row) => sum + row.created, 0),
    existing: contests.reduce((sum, row) => sum + row.existing, 0),
    contests,
  };
  await prisma.adminAuditLog.create({
    data: {
      adminUserId: input.adminUserId,
      action: "official_board.capture_missing_finals",
      entityType: "Week",
      entityId: week.id,
      metadata: {
        weekLabel: week.label,
        activated: weekHasOfficialBoardFinals(week.fullLockAt),
        created: result.created,
        existing: result.existing,
        contests: contests.map((row) => ({
          contestId: row.contestId,
          created: row.created,
          existing: row.existing,
          skipped: row.skipped,
        })),
      },
    },
  });
  return result;
}

/**
 * Hide a WeeklyContent item from public display. Noncompetitive: writes only
 * the item's moderation fields plus an AdminAuditLog row.
 */
export async function suppressWeeklyContent(input: {
  adminUserId: string;
  id: string;
  reason: string;
  now?: Date;
}) {
  await assertAdminUser(input.adminUserId);
  const reason = input.reason.trim();
  if (!reason) throw new OfficialBoardsAdminError("A moderation reason is required.");
  if (reason.length > WEEKLY_CONTENT_SUPPRESSION_REASON_MAX) {
    throw new OfficialBoardsAdminError("Moderation reason is too long.");
  }
  return prisma.$transaction(async (tx) => {
    const row = await tx.weeklyContent.findUnique({ where: { id: input.id } });
    if (!row) throw new OfficialBoardsAdminError("Weekly content not found.");
    if (row.suppressedAt) {
      throw new OfficialBoardsAdminError("This link is already hidden.");
    }
    const updated = await tx.weeklyContent.update({
      where: { id: row.id },
      data: {
        suppressedAt: input.now ?? new Date(),
        suppressedByUserId: input.adminUserId,
        suppressionReason: reason,
      },
    });
    await tx.adminAuditLog.create({
      data: {
        adminUserId: input.adminUserId,
        action: "weekly_content.suppress",
        entityType: "WeeklyContent",
        entityId: row.id,
        metadata: {
          profileId: row.profileId,
          weekId: row.weekId,
          host: hostOf(row.url),
          reason,
        },
      },
    });
    return updated;
  });
}

/** Restore a suppressed WeeklyContent item to public display (audited). */
export async function restoreWeeklyContent(input: {
  adminUserId: string;
  id: string;
}) {
  await assertAdminUser(input.adminUserId);
  return prisma.$transaction(async (tx) => {
    const row = await tx.weeklyContent.findUnique({ where: { id: input.id } });
    if (!row) throw new OfficialBoardsAdminError("Weekly content not found.");
    if (!row.suppressedAt) {
      throw new OfficialBoardsAdminError("This link is not hidden.");
    }
    const updated = await tx.weeklyContent.update({
      where: { id: row.id },
      data: {
        suppressedAt: null,
        suppressedByUserId: null,
        suppressionReason: null,
      },
    });
    await tx.adminAuditLog.create({
      data: {
        adminUserId: input.adminUserId,
        action: "weekly_content.restore",
        entityType: "WeeklyContent",
        entityId: row.id,
        metadata: {
          profileId: row.profileId,
          weekId: row.weekId,
          previousReason: row.suppressionReason,
        },
      },
    });
    return updated;
  });
}

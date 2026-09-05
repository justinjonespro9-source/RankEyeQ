import { prisma } from "@/lib/db";
import { CONTEST_POSITIONS, rankingDepthForPosition } from "@/lib/contest-defaults";
import { logAdminAction } from "@/lib/admin/audit";
import { getActiveRankingScoringVersion } from "@/lib/ranking-scoring-versions";
import { FANTASYTRACK_NFL_HALF_PPR_V2 } from "@/lib/fantasy/scoring-config";
import { auditAllPools } from "@/lib/nfl/manual/pool-audit";
import { validateWeeklyPoolCanonicalUniqueness } from "@/lib/nfl/pool-canonical-uniqueness";
import { getWeeklyExceptionReview } from "@/lib/nfl/weekly-exceptions";
import {
  buildWeekTimingDisplay,
  type WeekTimingWarning,
} from "@/lib/admin/week-timing-validation";
import type { ContestPosition, ContestStatus } from "@/lib/generated/prisma/client";

export class OpenWeekRankingsError extends Error {
  constructor(
    message: string,
    readonly blockers: string[] = [],
  ) {
    super(message);
    this.name = "OpenWeekRankingsError";
  }
}

export type ContestOpenStatus = {
  position: ContestPosition;
  contestId: string;
  status: ContestStatus;
};

export type OpenWeekRankingsReadiness = {
  ready: boolean;
  blockers: string[];
  warnings: WeekTimingWarning[];
  contestStatuses: ContestOpenStatus[];
  weekId: string;
  weekLabel: string;
};

export async function getOpenWeekRankingsReadiness(
  weekId: string,
  now = new Date(),
): Promise<OpenWeekRankingsReadiness> {
  const week = await prisma.week.findUnique({
    where: { id: weekId },
    include: {
      season: { include: { activeRankingScoringVersion: true } },
      games: true,
      contests: { orderBy: { position: "asc" } },
    },
  });

  const blockers: string[] = [];

  if (!week) {
    return {
      ready: false,
      blockers: ["Week not found — select or create a week first."],
      warnings: [],
      contestStatuses: [],
      weekId,
      weekLabel: "",
    };
  }

  if (!week.season) {
    blockers.push("Season is missing for this week.");
  }

  if (week.games.length === 0) {
    blockers.push(
      "No schedule imported — paste or sync NFL games before opening rankings.",
    );
  }

  const missingPositions = CONTEST_POSITIONS.filter(
    (position) => !week.contests.some((contest) => contest.position === position),
  );
  if (missingPositions.length > 0) {
    blockers.push(
      `Missing contests for: ${missingPositions.join(", ")}. Create all five position contests first.`,
    );
  }

  for (const position of CONTEST_POSITIONS) {
    const contest = week.contests.find((row) => row.position === position);
    const expectedDepth = rankingDepthForPosition(position);
    if (contest && contest.rankingDepth !== expectedDepth) {
      blockers.push(
        `${position} contest depth is Top ${contest.rankingDepth}; expected Top ${expectedDepth}.`,
      );
    }
  }

  const poolAudit = await auditAllPools(weekId);
  if (!poolAudit.ready) {
    for (const blocker of poolAudit.blockers.slice(0, 5)) {
      blockers.push(`Pool: ${blocker}`);
    }
    if (poolAudit.blockers.length > 5) {
      blockers.push(
        `Pool: …and ${poolAudit.blockers.length - 5} more issue(s). See weekly pools audit.`,
      );
    }
  }

  const poolUniqueness = await validateWeeklyPoolCanonicalUniqueness(weekId);
  if (!poolUniqueness.ok) {
    for (const blocker of poolUniqueness.blockers.slice(0, 5)) {
      blockers.push(`Duplicate player: ${blocker}`);
    }
    if (poolUniqueness.blockers.length > 5) {
      blockers.push(
        `Duplicate player: …and ${poolUniqueness.blockers.length - 5} more duplicate canonical player(s).`,
      );
    }
  }

  const exceptions = await getWeeklyExceptionReview(weekId);
  const criticalExceptions = exceptions.exceptions.filter(
    (row) =>
      row.kind === "missing_pool_entry" ||
      row.kind === "unknown_eligibility",
  );
  if (criticalExceptions.length > 0) {
    blockers.push(
      `${criticalExceptions.length} unresolved eligibility exception(s) — review Weekly Exceptions before opening.`,
    );
  }

  const scoringVersion =
    week.season.activeRankingScoringVersion ??
    (await getActiveRankingScoringVersion());
  if (!scoringVersion) {
    blockers.push(
      "RankEyeQ scoring version is not configured — activate rankeyeq-v1 in admin scoring settings.",
    );
  }

  const fantasyVersion =
    week.fantasyScoringVersion || week.season.fantasyScoringVersion;
  if (!fantasyVersion) {
    blockers.push(
      "Fantasy scoring version is not set on the season or week.",
    );
  } else if (fantasyVersion !== FANTASYTRACK_NFL_HALF_PPR_V2) {
    blockers.push(
      `Fantasy scoring version is ${fantasyVersion}; expected ${FANTASYTRACK_NFL_HALF_PPR_V2} (Half PPR + yardage bonuses) for new weeks.`,
    );
  }

  if (!week.rankingsOpenAt || !week.fullLockAt) {
    blockers.push(
      "Week timing is incomplete — set rankings open and Sunday full lock times.",
    );
  }
  if (!week.revealStartsAt && !week.fullLockAt) {
    blockers.push("Reveal start time is not configured.");
  }
  if (!week.publicReleaseAt) {
    blockers.push("Public release (reveal end) time is not configured.");
  }

  const timing = buildWeekTimingDisplay({
    rankingsOpenAt: week.rankingsOpenAt,
    fullLockAt: week.fullLockAt,
    revealStartsAt: week.revealStartsAt,
    publicReleaseAt: week.publicReleaseAt,
    contestStatuses: week.contests.map((c) => c.status),
    now,
  });

  const timingBlockers = timing.warnings.filter((warning) =>
    ["rankings_open_after_lock", "lock_before_rankings_open"].includes(
      warning.code,
    ),
  );
  for (const warning of timingBlockers) {
    blockers.push(warning.message);
  }

  const lockedOrFinal = week.contests.filter(
    (contest) =>
      contest.status === "LOCKED" ||
      contest.status === "FINAL" ||
      contest.status === "ARCHIVED",
  );
  if (lockedOrFinal.length > 0) {
    blockers.push(
      `Cannot open — ${lockedOrFinal.map((c) => `${c.position} is ${c.status}`).join(", ")}.`,
    );
  }

  const allOpen =
    week.contests.length === 5 &&
    week.contests.every((contest) => contest.status === "OPEN");

  if (allOpen) {
    return {
      ready: true,
      blockers: [],
      warnings: timing.warnings,
      contestStatuses: CONTEST_POSITIONS.map((position) => {
        const contest = week.contests.find((row) => row.position === position)!;
        return {
          position,
          contestId: contest.id,
          status: contest.status,
        };
      }),
      weekId: week.id,
      weekLabel: week.label,
    };
  }

  const contestStatuses: ContestOpenStatus[] = CONTEST_POSITIONS.map(
    (position) => {
      const contest = week.contests.find((row) => row.position === position);
      return {
        position,
        contestId: contest?.id ?? "",
        status: contest?.status ?? "DRAFT",
      };
    },
  );

  return {
    ready: blockers.length === 0,
    blockers,
    warnings: timing.warnings,
    contestStatuses,
    weekId: week.id,
    weekLabel: week.label,
  };
}

/**
 * Open all five position contests after validation. Does not partially open on failure.
 */
export async function openWeekRankings(input: {
  weekId: string;
  adminUserId: string;
  now?: Date;
}) {
  const readiness = await getOpenWeekRankingsReadiness(input.weekId, input.now);
  if (!readiness.ready) {
    throw new OpenWeekRankingsError(
      readiness.blockers[0] ?? "Week is not ready to open.",
      readiness.blockers,
    );
  }

  const alreadyOpen = readiness.contestStatuses.every(
    (row) => row.status === "OPEN",
  );
  if (alreadyOpen) {
    return { opened: readiness.contestStatuses, readiness, alreadyOpen: true };
  }

  const scoringVersion = await getActiveRankingScoringVersion();

  const result = await prisma.$transaction(async (tx) => {
    const contests = await tx.rankIQContest.findMany({
      where: { weekId: input.weekId },
    });

    if (contests.length !== 5) {
      throw new OpenWeekRankingsError(
        `Expected 5 contests; found ${contests.length}.`,
      );
    }

    const notDraft = contests.filter((c) => c.status !== "DRAFT" && c.status !== "OPEN");
    if (notDraft.length > 0) {
      throw new OpenWeekRankingsError(
        `Cannot open — ${notDraft.map((c) => `${c.position} is ${c.status}`).join(", ")}.`,
      );
    }

    const week = await tx.week.findUniqueOrThrow({
      where: { id: input.weekId },
      include: { season: true },
    });

    for (const contest of contests) {
      await tx.rankIQContest.update({
        where: { id: contest.id },
        data: {
          status: "OPEN",
          opensAt: week.rankingsOpenAt,
          locksAt: week.fullLockAt,
          ...(scoringVersion && !contest.rankingScoringVersionId
            ? { rankingScoringVersionId: scoringVersion.id }
            : {}),
        },
      });
    }

    if (week.status === "UPCOMING") {
      await tx.week.update({
        where: { id: week.id },
        data: { status: "OPEN" },
      });
    }

    return contests.map((contest) => ({
      position: contest.position as ContestPosition,
      contestId: contest.id,
      status: "OPEN" as const,
    }));
  });

  await logAdminAction({
    adminUserId: input.adminUserId,
    action: "week.rankings_opened",
    entityType: "Week",
    entityId: input.weekId,
    metadata: { contests: result.length },
  });

  return {
    opened: result,
    readiness,
  };
}

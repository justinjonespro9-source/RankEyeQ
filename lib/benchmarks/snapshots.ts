import { prisma } from "@/lib/db";
import { LATE_CAPTURE_WARNING } from "@/lib/benchmark-sources";
import {
  HISTORICAL_LATE_WARNING,
  HISTORICAL_OFFICIAL_NOTICE,
  HISTORICAL_SOURCE_REQUIRED,
  competitiveCaptureTimestamp,
  historicalBackfillAuditFlags,
  isCompetitivelyLate,
} from "@/lib/benchmarks/historical-backfill";
import {
  isLateCapture,
  isThursdayKickoff,
  mergeSundayWithThursdayLocks,
  type MergePick,
  type MergedSlot,
} from "@/lib/benchmarks/merge";
import { rankingDepthForPosition, submissionDepthFromScoring, isScorablePickCount } from "@/lib/contest-defaults";
import { scoreContest, type ScoreablePick } from "@/lib/scoring";
import { resolveWeekScopedKickoff } from "@/lib/timing/resolve-contest-kickoff";
import {
  WeekMatchupNotStampedError,
  assertWeekMatchupsStamped,
} from "@/lib/nfl/week-matchup-health";
import type {
  BenchmarkCaptureType,
  BenchmarkSnapshotStatus,
  Prisma,
} from "@/lib/generated/prisma/client";

type Tx = Prisma.TransactionClient;

export class BenchmarkCaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BenchmarkCaptureError";
  }
}

/**
 * When an official benchmark/creator board is written to RankingSubmission,
 * decide whether to immediately score it from ContestEntry actuals.
 *
 * - Normal live capture → false (board stays LOCKED until gradeContest).
 * - Historical backfill → true (Week COMPLETE; grade when actuals exist).
 * - Re-capture of already-GRADED board → true (refresh scores).
 */
export function shouldAutoGradeOfficialBenchmarkSubmission(input: {
  historicalBackfill?: boolean;
  existingStatus?: string | null;
}): boolean {
  if (input.historicalBackfill) return true;
  if (input.existingStatus === "GRADED") return true;
  return false;
}

export type SnapshotPickInput = {
  sourceRank: number;
  rawName: string;
  rankableEntryId: string | null;
  rankIqRank: number | null;
  excluded: boolean;
  exclusionReason: string | null;
  issue: string | null;
  selected: boolean;
};

async function loadKickoffMap(contestId: string, db: Tx | typeof prisma = prisma) {
  const contest = await db.rankIQContest.findUnique({
    where: { id: contestId },
    select: { weekId: true },
  });
  const entries = await db.contestEntry.findMany({
    where: { contestId, excluded: false },
    include: {
      game: true,
      rankableEntry: { select: { id: true } },
    },
  });
  const map = new Map<string, Date | null>();
  for (const entry of entries) {
    map.set(
      entry.rankableEntryId,
      contest
        ? resolveWeekScopedKickoff({
            weekId: contest.weekId,
            contestGame: entry.game,
          })
        : null,
    );
  }
  return map;
}

function selectedMergePicks(
  picks: SnapshotPickInput[],
  kickoffs: Map<string, Date | null>,
): MergePick[] {
  return picks
    .filter(
      (pick): pick is SnapshotPickInput & { rankableEntryId: string; rankIqRank: number } =>
        pick.selected && Boolean(pick.rankableEntryId) && pick.rankIqRank != null,
    )
    .map((pick) => ({
      rankableEntryId: pick.rankableEntryId,
      sourceRank: pick.sourceRank,
      rankIqRank: pick.rankIqRank,
      kickoffAt: kickoffs.get(pick.rankableEntryId) ?? null,
      rawName: pick.rawName,
    }));
}

export async function latestBenchmarkSnapshot(input: {
  contestId: string;
  universalProfileId: string;
}) {
  return prisma.benchmarkSnapshot.findFirst({
    where: {
      contestId: input.contestId,
      universalProfileId: input.universalProfileId,
    },
    orderBy: { createdAt: "desc" },
    include: { picks: { orderBy: { sourceRank: "asc" } } },
  });
}

async function latestCaptureOfType(
  input: {
    contestId: string;
    universalProfileId: string;
    captureType: BenchmarkCaptureType;
  },
  db: Tx | typeof prisma = prisma,
) {
  return db.benchmarkSnapshot.findFirst({
    where: {
      contestId: input.contestId,
      universalProfileId: input.universalProfileId,
      captureType: input.captureType,
      status: { not: "NOT_AVAILABLE" },
    },
    orderBy: { createdAt: "desc" },
    include: { picks: { orderBy: { sourceRank: "asc" } } },
  });
}

async function regradeSubmissionIfActualsExist(
  submissionId: string,
  db: Tx | typeof prisma = prisma,
) {
  const submission = await db.rankingSubmission.findUnique({
    where: { id: submissionId },
    include: {
      picks: { orderBy: { predictedRank: "asc" } },
      contest: {
        include: {
          entries: {
            include: {
              game: {
                select: {
                  id: true,
                  weekId: true,
                  homeTeam: true,
                  awayTeam: true,
                  startsAt: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (!submission) return;
  const ranked = submission.contest.entries.filter(
    (entry) => entry.actualRank != null && entry.actualRank > 0,
  );
  if (ranked.length < submission.contest.rankingDepth) return;
  if (
    !isScorablePickCount(
      submission.picks.length,
      submission.contest.rankingDepth,
      submission.contest.reserveCount ?? 0,
    )
  ) {
    return;
  }

  const actualByEntryId = new Map(
    submission.contest.entries
      .filter((entry) => entry.actualRank != null)
      .map((entry) => [
        entry.rankableEntryId,
        {
          actualRank: entry.actualRank as number,
          fantasyPoints: entry.fantasyPoints,
        },
      ]),
  );

  const { scoreableEffectivePicks } = await import(
    "@/lib/reserves/from-submission"
  );
  const { buildContestWeekKickoffMap } = await import(
    "@/lib/reserves/contest-week-kickoffs"
  );
  const kickoffByEntryId = buildContestWeekKickoffMap({
    weekId: submission.contest.weekId,
    entries: submission.contest.entries,
  });
  const effective = scoreableEffectivePicks({
    picks: submission.picks,
    scoringDepth: submission.contest.rankingDepth,
    kickoffByEntryId,
  });
  const scoreable: ScoreablePick[] = effective.map((pick) => {
    const result = actualByEntryId.get(pick.playerId);
    return {
      playerId: pick.playerId,
      playerName: pick.playerId,
      predictedRank: pick.predictedRank,
      actualRank: result?.actualRank ?? submission.contest.rankingDepth + 100,
    };
  });
  const summary = scoreContest(scoreable, submission.contest.rankingDepth);

  for (const row of summary.players) {
    const pick = submission.picks.find((p) => p.rankableEntryId === row.playerId);
    if (!pick) continue;
    const result = actualByEntryId.get(row.playerId);
    await db.rankingPick.update({
      where: { id: pick.id },
      data: {
        actualRank: row.actualRank,
        fantasyPoints: result?.fantasyPoints ?? null,
        basePoints: row.basePoints,
        accuracyPoints: row.accuracyPoints,
        podiumPoints: row.podiumPoints,
        totalPoints: row.totalPoints,
      },
    });
  }

  await db.rankingSubmission.update({
    where: { id: submission.id },
    data: {
      status: "GRADED",
      rawScore: summary.rawPoints,
      normalizedScore: summary.rankIqScore,
    },
  });
}

async function upsertOfficialBenchmarkSubmission(
  input: {
    contestId: string;
    universalProfileId: string;
    rankingDepth: number;
    /** Competitive clock — sourcePublishedAt for backfill, else capturedAt. */
    competitiveAt: Date;
    historicalBackfill?: boolean;
    slots: MergedSlot[];
  },
  db: Tx | typeof prisma = prisma,
) {
  const existing = await db.rankingSubmission.findUnique({
    where: {
      contestId_universalProfileId: {
        contestId: input.contestId,
        universalProfileId: input.universalProfileId,
      },
    },
  });

  if (input.slots.length !== input.rankingDepth) {
    throw new BenchmarkCaptureError(
      `Official board requires exactly ${input.rankingDepth} slots (got ${input.slots.length})`,
    );
  }

  const submission = existing
    ? await db.rankingSubmission.update({
        where: { id: existing.id },
        data: {
          status: existing.status === "GRADED" ? "GRADED" : "LOCKED",
          submittedAt: existing.submittedAt ?? input.competitiveAt,
          lockedAt: existing.lockedAt ?? input.competitiveAt,
          historicalBackfill:
            existing.historicalBackfill || Boolean(input.historicalBackfill),
        },
      })
    : await db.rankingSubmission.create({
        data: {
          contestId: input.contestId,
          universalProfileId: input.universalProfileId,
          status: "LOCKED",
          submittedAt: input.competitiveAt,
          lockedAt: input.competitiveAt,
          historicalBackfill: Boolean(input.historicalBackfill),
        },
      });

  await db.rankingPick.deleteMany({ where: { submissionId: submission.id } });

  await db.rankingPick.createMany({
    data: input.slots.map((slot) => ({
      submissionId: submission.id,
      rankableEntryId: slot.rankableEntryId,
      predictedRank: slot.rankIqRank,
      sourceRank: slot.sourceRank,
      slotLocked: slot.slotLocked,
      lockedAt: slot.lockedAt,
      lockedRank: slot.lockedRank,
      committedAt: slot.lockedAt ?? input.competitiveAt,
    })),
  });

  /**
   * Lifecycle:
   * - Normal Thursday/Sunday official capture → LOCKED competitor board.
   *   Do NOT auto-grade merely because ContestEntry actuals happen to exist
   *   (fixtures / early result pastes). Week grading remains gradeContest().
   * - Historical backfill after Week COMPLETE → grade immediately when actuals exist.
   * - Re-capture of an already-GRADED board → refresh scores when actuals exist.
   */
  if (
    shouldAutoGradeOfficialBenchmarkSubmission({
      historicalBackfill: input.historicalBackfill,
      existingStatus: existing?.status,
    })
  ) {
    await regradeSubmissionIfActualsExist(submission.id, db);
  }

  return submission.id;
}

export async function captureBenchmarkSnapshot(input: {
  contestId: string;
  universalProfileId: string;
  adminUserId: string;
  captureType: BenchmarkCaptureType;
  capturedAt: Date;
  sourcePublishedAt?: Date | null;
  sourceUrl?: string | null;
  notes?: string | null;
  rawText?: string | null;
  publicBoardAllowed?: boolean;
  picks: SnapshotPickInput[];
  correctionOfId?: string | null;
  correctionReason?: string | null;
  commitOfficial?: boolean;
  /** Admin-only Historical / Backfill Entry. */
  historicalBackfill?: boolean;
}) {
  const [profile, contest] = await Promise.all([
    prisma.universalProfile.findUnique({
      where: { id: input.universalProfileId },
    }),
    prisma.rankIQContest.findUnique({
      where: { id: input.contestId },
      include: { week: true },
    }),
  ]);

  if (!profile || (profile.profileType !== "BENCHMARK" && profile.profileType !== "CREATOR")) {
    throw new BenchmarkCaptureError(
      "Captures require a BENCHMARK (Expert) or CREATOR profile",
    );
  }
  if (profile.status === "SUSPENDED") {
    throw new BenchmarkCaptureError("This benchmark source is suspended");
  }
  if (!contest) throw new BenchmarkCaptureError("Contest not found");

  if (!input.historicalBackfill) {
    try {
      await assertWeekMatchupsStamped(contest.weekId);
    } catch (error) {
      if (error instanceof WeekMatchupNotStampedError) {
        throw new BenchmarkCaptureError(error.message);
      }
      throw error;
    }
  }

  const warnings: string[] = [];
  const expectedDepth = rankingDepthForPosition(contest.position);
  // WR Top 15 is launch-critical — never capture against a truncated WR contest.
  if (contest.position === "WR" && contest.rankingDepth !== expectedDepth) {
    throw new BenchmarkCaptureError(
      `WR contest must use Top ${expectedDepth} (found Top ${contest.rankingDepth})`,
    );
  }
  if (contest.rankingDepth !== expectedDepth && contest.position !== "WR") {
    // Non-WR test fixtures may use smaller depths; production contests should match defaults.
    warnings.push(
      `Contest rankingDepth Top ${contest.rankingDepth} differs from default Top ${expectedDepth} for ${contest.position}.`,
    );
  }

  const isCorrection = Boolean(input.correctionOfId);
  if (isCorrection && !input.correctionReason?.trim()) {
    throw new BenchmarkCaptureError("Corrections require a reason");
  }

  const historicalBackfill = Boolean(input.historicalBackfill);
  if (historicalBackfill && !input.sourcePublishedAt) {
    throw new BenchmarkCaptureError(HISTORICAL_SOURCE_REQUIRED);
  }

  const selectedCount = input.picks.filter((pick) => pick.selected).length;
  const reserveCount = contest.reserveCount ?? 0;
  if (!isScorablePickCount(selectedCount, contest.rankingDepth, reserveCount)) {
    throw new BenchmarkCaptureError(
      `Selected eligible picks must be Top ${contest.rankingDepth}–${submissionDepthFromScoring(contest.rankingDepth, reserveCount)} (received ${selectedCount}). Do not fabricate reserves.`,
    );
  }

  // Capture-time availability warning (does not rewrite historical boards).
  // Full as-of historical reconstruction is out of V2 scope.
  try {
    const selectedIds = input.picks
      .filter((pick) => pick.selected && pick.rankableEntryId)
      .map((pick) => pick.rankableEntryId as string);
    if (selectedIds.length > 0) {
      const { loadResolvedStatusesForWeek } = await import(
        "@/lib/eligibility/player-week-availability-store"
      );
      const resolved = await loadResolvedStatusesForWeek({
        weekId: contest.weekId,
        seasonId: contest.week.seasonId,
        rankableEntryIds: selectedIds,
      });
      const hardUnavail = selectedIds.filter((id) => {
        const status = resolved.get(id);
        return status != null && !status.selectable;
      });
      if (hardUnavail.length > 0) {
        warnings.push(
          `${hardUnavail.length} selected pick(s) are currently hard-unavailable as of capture time (roster IR/PUP/SUS/etc. or weekly OUT). Source fidelity preserved — review before treating as normally eligible.`,
        );
      }
    }
  } catch {
    // Non-fatal — capture continues if resolution fails.
  }

  let competitiveAt: Date;
  try {
    competitiveAt = competitiveCaptureTimestamp({
      historicalBackfill,
      sourcePublishedAt: input.sourcePublishedAt,
      capturedAt: input.capturedAt,
    });
  } catch (error) {
    throw new BenchmarkCaptureError(
      error instanceof Error ? error.message : HISTORICAL_SOURCE_REQUIRED,
    );
  }

  // Competitive lateness uses historical source time in backfill mode,
  // otherwise wall-clock capturedAt (existing behavior).
  const late =
    !isCorrection && isCompetitivelyLate(competitiveAt, contest.week.fullLockAt);
  const wallClockLate = isLateCapture(
    input.capturedAt,
    contest.week.fullLockAt,
  );
  const kickoffs = await loadKickoffMap(input.contestId);
  const audit = historicalBackfillAuditFlags({
    historicalBackfill,
    wallClockNow: input.capturedAt,
    fullLockAt: contest.week.fullLockAt,
    weekStatus: contest.week.status,
  });

  if (late) {
    warnings.push(
      historicalBackfill ? HISTORICAL_LATE_WARNING : LATE_CAPTURE_WARNING,
    );
  } else if (historicalBackfill && wallClockLate) {
    warnings.push(HISTORICAL_OFFICIAL_NOTICE);
  }

  const shouldAttemptOfficial =
    input.commitOfficial !== false &&
    !late &&
    (input.captureType === "SUNDAY" || input.captureType === "MANUAL_FINAL");

  let officialSlots: MergedSlot[] | null = null;
  if (shouldAttemptOfficial) {
    const thursdaySnap = await latestCaptureOfType({
      contestId: input.contestId,
      universalProfileId: input.universalProfileId,
      captureType: "THURSDAY",
    });
    const thursdayPicks: MergePick[] = (thursdaySnap?.picks ?? [])
      .filter(
        (pick) =>
          pick.selected && pick.rankableEntryId && pick.rankIqRank != null,
      )
      .map((pick) => ({
        rankableEntryId: pick.rankableEntryId as string,
        sourceRank: pick.sourceRank,
        rankIqRank: pick.rankIqRank as number,
        kickoffAt: pick.kickoffAt,
        rawName: pick.rawName,
      }));

    // Backfill evaluates Thursday kickoff locks against the historical source
    // time so later admin transcription does not invent kickoff blocks.
    const merged = mergeSundayWithThursdayLocks({
      rankingDepth: selectedCount,
      now: competitiveAt,
      thursday: thursdaySnap
        ? { capturedAt: thursdaySnap.capturedAt, selected: thursdayPicks }
        : null,
      sunday: {
        capturedAt: competitiveAt,
        selected: selectedMergePicks(input.picks, kickoffs),
      },
    });
    warnings.push(...merged.warnings);

    if (merged.complete) {
      officialSlots = merged.slots.filter(
        (slot): slot is MergedSlot => slot != null,
      );
    } else if (isCorrection) {
      // Corrections still record evidence even when Thursday locks prevent a full
      // official board — do not invent slots.
      officialSlots = null;
    } else {
      throw new BenchmarkCaptureError(
        merged.warnings.join(" ") ||
          `Cannot lock official board (${selectedCount} slots) — merged board incomplete.`,
      );
    }
  }

  const status: BenchmarkSnapshotStatus = late
    ? "LATE"
    : officialSlots
      ? "LOCKED"
      : "CAPTURED";

  const snapshotMeta = {
    universalProfileId: input.universalProfileId,
    contestId: input.contestId,
    weekId: contest.weekId,
    captureType: input.captureType,
    capturedAt: input.capturedAt,
    sourcePublishedAt: input.sourcePublishedAt ?? null,
    sourceUrl: input.sourceUrl?.trim() || null,
    notes: input.notes?.trim() || null,
    rawText: input.rawText ?? null,
    status,
    publicBoardAllowed: input.publicBoardAllowed ?? true,
    late,
    historicalBackfill: audit.historicalBackfill,
    backfilledAt: audit.backfilledAt,
    enteredAfterFullLock: audit.enteredAfterFullLock,
    enteredAfterWeekComplete: audit.enteredAfterWeekComplete,
    adminUserId: input.adminUserId,
    correctionOfId: input.correctionOfId ?? null,
    correctionReason: input.correctionReason?.trim() || null,
  };

  const pickRows = input.picks.map((pick) => {
    const kickoff = pick.rankableEntryId
      ? (kickoffs.get(pick.rankableEntryId) ?? null)
      : null;
    const thursdayLock =
      pick.selected &&
      input.captureType === "THURSDAY" &&
      isThursdayKickoff(kickoff);
    return {
      rankableEntryId: pick.rankableEntryId,
      rawName: pick.rawName,
      sourceRank: pick.sourceRank,
      rankIqRank: pick.rankIqRank,
      excluded: pick.excluded,
      exclusionReason: pick.exclusionReason,
      issue: pick.issue,
      selected: pick.selected,
      slotLocked: thursdayLock,
      lockedAt: thursdayLock ? competitiveAt : null,
      lockedRank: thursdayLock ? pick.rankIqRank : null,
      kickoffAt: kickoff,
    };
  });

  const snapshotId = await prisma.$transaction(async (tx) => {
    let snapshotIdLocal: string;

    if (!isCorrection) {
      const reusable = await tx.benchmarkSnapshot.findFirst({
        where: {
          contestId: input.contestId,
          universalProfileId: input.universalProfileId,
          captureType: input.captureType,
          status: { in: ["CAPTURED", "LATE", "LOCKED"] },
          correctionOfId: null,
        },
        orderBy: { createdAt: "desc" },
      });
      if (reusable) {
        await tx.benchmarkSnapshotPick.deleteMany({
          where: { snapshotId: reusable.id },
        });
        await tx.benchmarkSnapshot.update({
          where: { id: reusable.id },
          data: snapshotMeta,
        });
        snapshotIdLocal = reusable.id;
      } else {
        const created = await tx.benchmarkSnapshot.create({
          data: snapshotMeta,
        });
        snapshotIdLocal = created.id;
      }
    } else {
      const created = await tx.benchmarkSnapshot.create({
        data: snapshotMeta,
      });
      snapshotIdLocal = created.id;
    }

    await tx.benchmarkSnapshotPick.createMany({
      data: pickRows.map((pick) => ({
        snapshotId: snapshotIdLocal,
        ...pick,
      })),
    });

    if (officialSlots) {
      await upsertOfficialBenchmarkSubmission(
        {
          contestId: input.contestId,
          universalProfileId: input.universalProfileId,
          rankingDepth: officialSlots.length,
          competitiveAt,
          historicalBackfill,
          slots: officialSlots,
        },
        tx,
      );
    }

    return snapshotIdLocal;
  });

  const saved = await prisma.benchmarkSnapshot.findUniqueOrThrow({
    where: { id: snapshotId },
    include: { picks: { orderBy: { sourceRank: "asc" } } },
  });

  return {
    snapshot: saved,
    late,
    official: Boolean(officialSlots),
    historicalBackfill,
    warnings,
  };
}

export async function markBenchmarkNotAvailable(input: {
  contestId: string;
  universalProfileId: string;
  adminUserId: string;
  notes?: string | null;
}) {
  const [profile, contest] = await Promise.all([
    prisma.universalProfile.findUnique({
      where: { id: input.universalProfileId },
    }),
    prisma.rankIQContest.findUnique({ where: { id: input.contestId } }),
  ]);
  if (!profile || (profile.profileType !== "BENCHMARK" && profile.profileType !== "CREATOR")) {
    throw new BenchmarkCaptureError(
      "Captures require a BENCHMARK (Expert) or CREATOR profile",
    );
  }
  if (!contest) throw new BenchmarkCaptureError("Contest not found");

  const snapshot = await prisma.benchmarkSnapshot.create({
    data: {
      universalProfileId: input.universalProfileId,
      contestId: input.contestId,
      weekId: contest.weekId,
      captureType: "MANUAL_FINAL",
      capturedAt: new Date(),
      notes: input.notes?.trim() || "Source did not publish a compatible ranking",
      status: "NOT_AVAILABLE",
      publicBoardAllowed: false,
      late: false,
      adminUserId: input.adminUserId,
    },
  });

  return snapshot;
}

export async function latestSnapshotAllowsPublicBoard(input: {
  contestId: string;
  universalProfileId: string;
}) {
  const latest = await prisma.benchmarkSnapshot.findFirst({
    where: {
      contestId: input.contestId,
      universalProfileId: input.universalProfileId,
    },
    orderBy: { createdAt: "desc" },
    select: { publicBoardAllowed: true, status: true },
  });
  if (!latest) return true;
  if (latest.status === "NOT_AVAILABLE") return false;
  return latest.publicBoardAllowed;
}

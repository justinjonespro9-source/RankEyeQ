import { prisma } from "@/lib/db";
import { LATE_CAPTURE_WARNING } from "@/lib/benchmark-sources";
import {
  isLateCapture,
  isThursdayKickoff,
  mergeSundayWithThursdayLocks,
  type MergePick,
  type MergedSlot,
} from "@/lib/benchmarks/merge";
import { rankingDepthForPosition } from "@/lib/contest-defaults";
import { scoreContest, type ScoreablePick } from "@/lib/scoring";
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
  const entries = await db.contestEntry.findMany({
    where: { contestId, excluded: false },
    include: {
      game: true,
      rankableEntry: { include: { game: true } },
    },
  });
  const map = new Map<string, Date | null>();
  for (const entry of entries) {
    map.set(
      entry.rankableEntryId,
      entry.game?.startsAt ??
        entry.rankableEntry.game?.startsAt ??
        entry.rankableEntry.gameStartsAt ??
        null,
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
      contest: { include: { entries: true } },
    },
  });
  if (!submission) return;
  const ranked = submission.contest.entries.filter(
    (entry) => entry.actualRank != null && entry.actualRank > 0,
  );
  if (ranked.length < submission.contest.rankingDepth) return;
  if (submission.picks.length !== submission.contest.rankingDepth) return;

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

  const scoreable: ScoreablePick[] = submission.picks.map((pick) => {
    const result = actualByEntryId.get(pick.rankableEntryId);
    return {
      playerId: pick.rankableEntryId,
      playerName: pick.rankableEntryId,
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
    capturedAt: Date;
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
          submittedAt: existing.submittedAt ?? input.capturedAt,
          lockedAt: existing.lockedAt ?? input.capturedAt,
        },
      })
    : await db.rankingSubmission.create({
        data: {
          contestId: input.contestId,
          universalProfileId: input.universalProfileId,
          status: "LOCKED",
          submittedAt: input.capturedAt,
          lockedAt: input.capturedAt,
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
      committedAt: slot.lockedAt ?? input.capturedAt,
    })),
  });

  if (existing?.status === "GRADED") {
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

  const selectedCount = input.picks.filter((pick) => pick.selected).length;
  if (selectedCount !== contest.rankingDepth) {
    throw new BenchmarkCaptureError(
      `Exactly ${contest.rankingDepth} selected eligible picks are required (received ${selectedCount})`,
    );
  }

  const late =
    !isCorrection && isLateCapture(input.capturedAt, contest.week.fullLockAt);
  const kickoffs = await loadKickoffMap(input.contestId);

  if (late) warnings.push(LATE_CAPTURE_WARNING);

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

    const merged = mergeSundayWithThursdayLocks({
      rankingDepth: contest.rankingDepth,
      now: input.capturedAt,
      thursday: thursdaySnap
        ? { capturedAt: thursdaySnap.capturedAt, selected: thursdayPicks }
        : null,
      sunday: {
        capturedAt: input.capturedAt,
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
          `Cannot lock official Top ${contest.rankingDepth} board — merged board incomplete.`,
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
      lockedAt: thursdayLock ? input.capturedAt : null,
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
          rankingDepth: contest.rankingDepth,
          capturedAt: input.capturedAt,
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
